// Small module that contains .vr parsing utilities

export function emtpyScene() {
    return {
        world: {
            background: [0.2, 0.2, 0.25],
            start: [0, 0, 3]
        },
        objects: [], // Top-level objects, each containing views (geometry)
    };
}

// Structured, small parser for a subset of the DIVE .vr format.
// - Follows a tokenization + recursive-descent approach for maintainability.
// - Currently supports: world { background R G B; start v X Y Z } and
//   RBOX v x0 y0 z0 v x1 y1 z1 (anywhere in the file).
// - The parser is intentionally conservative and easy to extend: add new
//   parseXYZ() methods and wire them into parseTopLevelToken.

// --- Tokenizer --------------------------------------------------------------
function removeComments(input) {
    // block comments /* */ -> replace with whitespace to preserve positions
    input = input.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
    // line comments starting with % to end of line
    input = input.replace(/%.*$/gm, (m) => ' '.repeat(m.length));
    // line comments starting with // to end of line (common in samples)
    input = input.replace(/\/\/.*$/gm, (m) => ' '.repeat(m.length));
    return input;
}

function isIdentStart(ch) {
    return /[A-Za-z_]/.test(ch);
}

function isIdent(ch) {
    return /[A-Za-z0-9_\-]/.test(ch);
}

function tokenize(input) {
    input = removeComments(input);
    const tokens = [];
    let i = 0;
    const len = input.length;

    while (i < len) {
        const ch = input[i];
        // whitespace
        if (/\s/.test(ch)) { 
            i++;
            continue;
        }

        // punctuation
        if (ch === '{' || ch === '}' || ch === '(' || ch === ')' || ch === ',' || ch === ';') {
            tokens.push({ type: ch, value: ch });
            i++;
            continue;
        }

        // quoted string
        if (ch === '"') {
            let j = i + 1;
            let str = '';
            while (j < len) {
                const cc = input[j];
                if (cc === '\\' && j + 1 < len) {
                    // simple escape handling
                    str += input[j + 1];
                    j += 2;
                    continue;
                }
                if (cc === '"') {
                    j++;
                    break;
                }
                str += cc; j++;
            }
            tokens.push({ type: 'string', value: str });
            i = j; 
            continue;
        }

        // number (int or float, with optional exponent)
        const numMatch = /^[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/.exec(input.slice(i));
        if (numMatch) {
            tokens.push({ type: 'number', value: parseFloat(numMatch[0]), raw: numMatch[0] });
            i += numMatch[0].length;
            continue;
        }

        // identifier / keyword (allow hyphen in names)
        if (isIdentStart(ch)) {
            let j = i + 1;
            while (j < len && isIdent(input[j])) j++;
            const word = input.slice(i, j);
            tokens.push({ type: 'ident', value: word });
            i = j;
            continue;
        }

        // unknown single char: emit as symbol
        tokens.push({ type: input[i], value: input[i] });
        i++;
    }

    tokens.push({ type: 'EOF' });
    return tokens;
}

// Debug helper (exported) to inspect token stream during development
export function debugTokens(text) {
    return tokenize(text);
}

// --- Parser -----------------------------------------------------------------
class Parser {
    constructor(tokens) {
        this.tokens = tokens; this.i = 0;
    }

    peek(n = 0) {
        return this.tokens[this.i + n] || { type: 'EOF' };
    }

    next() {
        const t = this.peek();
        this.i++;
        return t;
    }

    // convenience: check upcoming token type/value without advancing
    peekIs(type, value) {
        const t = this.peek(); 
        return t.type === type && (value === undefined || t.value === value);
    }

    expect(type, value) {
        const t = this.next();
        if (t.type !== type || (value !== undefined && t.value !== value)) {
            throw new Error(`Unexpected token: expected ${type}${value ? ' ' + value : ''}, got ${t.type} ${t.value}`);
        }
        return t;
    }

    // Try to consume a token, return it or null
    accept(type, value) {
        const t = this.peek();
        if (t.type === type && (value === undefined || t.value === value)) {
            this.i++;
            return t;
        }
        return null;
    }

    // Consume a single value for unknown properties: string, number, or v-vector
    skipValue() {
        const t = this.peek();
        if (!t) return;
        if (t.type === 'string' || t.type === 'number') {
            this.next(); return;
        }
        if (t.type === 'ident' && t.value === 'v') {
            // consume 'v' then three numbers if present
            this.next();
            for (let k = 0; k < 3; k++) {
                if (this.peek().type === 'number') this.next();
                else break;
            }
            return;
        }
        // fallback: consume one token
        this.next();
    }

    // Skip or parse tokens until matching closing brace; used for unknown blocks.
    // Might be discarded entirely when full parsing is implemented.
    skipBlock() {
        if (!this.accept('{')) return;

        while (true) {
            // just consume until matching brace
            // count nested braces to skip correctly
            let depth = 0;
            while (true) {
                const u = this.next();
                if (!u || u.type === 'EOF') return;
                if (u.type === '{') depth++;
                else if (u.type === '}') {
                    if (depth === 0) {
                        return;
                    }
                    else { 
                        depth--;
                    }
                }
            }
        }
    }

    // Parse a 'v' vector: v number number number
    parseVector() {
        // consume optional leading 'v'
        if (this.peekIs('ident', 'v')) this.next();

        const xTok = this.next();
        if (xTok.type !== 'number') throw new Error('Expected number for vector X');

        const yTok = this.next();
        if (yTok.type !== 'number') throw new Error('Expected number for vector Y');

        const zTok = this.next();
        if (zTok.type !== 'number') throw new Error('Expected number for vector Z');

        return [xTok.value, yTok.value, zTok.value];
    }

    parseWorld(scene) {
        // assume 'world' identifier already consumed
        // optional name string
        if (this.peek().type === 'string') this.next();
        this.expect('{');
        while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
            const t = this.next();
            if (t.type === 'ident') {
                const key = t.value;
                if (key === 'background') {
                    // three numbers expected
                    const r = this.expect('number').value;
                    const g = this.expect('number').value;
                    const b = this.expect('number').value;
                    scene.world.background = [r, g, b];
                    // tmp logging to console
                    console.log(`World background set to: [${r}, ${g}, ${b}]`);
                } else if (key === 'start') {
                    // expect a vector (may be prefixed by 'v')
                    const vec = this.parseVector();
                    scene.world.start = vec;
                } else {
                    // unknown world property: skip a single value (string/number/vector) or a block
                    // This is just a cushion until we have all expected world properties implemented
                    // or at least parsed.
                    if (this.peek().type === '{') this.skipBlock(false);
                    else this.skipValue();
                }
            } else {
                // skip unexpected tokens within world
                this.next();
            }
        }
        this.accept('}');
    }

    parseRBox(scene, parentObject = null, material_index = null, view_index = null) {
        // 'RBOX' already consumed
        // Expect optional 'v' then vec then optional 'v' then vec
        // parse two vectors (each may be prefixed by 'v')
        const a = this.parseVector();
        const b = this.parseVector();

        const x0 = a[0], y0 = a[1], z0 = a[2];
        const x1 = b[0], y1 = b[1], z1 = b[2];
        const minx = Math.min(x0, x1), maxx = Math.max(x0, x1);
        const miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
        const minz = Math.min(z0, z1), maxz = Math.max(z0, z1);
        const center = [(minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2];
        const size = [maxx - minx, maxy - miny, maxz - minz];
        const view = { type: 'rbox', center, size, material_index };
        if (view_index !== null) view.view_index = view_index;
        if (parentObject && parentObject.materials && parentObject.materials.length > 0) {
            if (material_index !== null && parentObject.materials[material_index]) {
                view.material = parentObject.materials[material_index];
            }
            else {
                view.material = parentObject.materials[0];
            }
        }
        if (parentObject) {
            parentObject.views = parentObject.views || [];
            parentObject.views.push(view);
        }
    }

    parseCyl(scene, parentObject = null, material_index = null, view_index = null) {
        // Accept optional leading 'v' center, then rx ry height [ratio] [PART_TOP|PART_BOTTOM]
        let center = [0, 0, 0];
        if (this.peekIs('ident', 'v')) {
            try { center = this.parseVector(); } catch (e) { /* ignore, leave at origin */ }
        }

        // Next tokens: expect at least three numbers (rx ry height)
        const rxTok = this.peek();
        if (rxTok.type !== 'number') throw new Error('CYL expected rx number');
        const rx = this.next().value;

        const ryTok = this.peek();
        if (ryTok.type !== 'number') throw new Error('CYL expected ry number');
        const ry = this.next().value;

        const hTok = this.peek();
        if (hTok.type !== 'number') throw new Error('CYL expected height number');
        const height = this.next().value;

        // optional ratio or flags - skip any following numbers/idents until semicolon or end of view block
        while (this.peek().type !== '}' && this.peek().type !== 'EOF' && this.peek().type !== ';') {
            const t = this.peek();
            if (t.type === 'number' || t.type === 'ident' || t.type === 'string') this.next();
            else break;
        }
        this.accept(';');

        const view = { type: 'cylinder', center, rx, ry, height, material_index };
        if (view_index !== null) view.view_index = view_index;
        if (parentObject && parentObject.materials && parentObject.materials.length > 0) {
            if (material_index !== null && parentObject.materials[material_index]) {
                view.material = parentObject.materials[material_index];
            }
            else {
                view.material = parentObject.materials[0];
            }
        }
        if (parentObject) {
            parentObject.views = parentObject.views || [];
            parentObject.views.push(view);
        }
    }

    parseView(scene, parentObject) {
        // assume 'view' identifier already consumed
        
        // Per DIVE spec EBNF: View := 'view' [ ViewIndex ] '{' ...
        // Optional view index may appear immediately after 'view' keyword, before any wrapper
        // properties or opening brace. Example:
        //   view 0 { RBOX ... }
        //   view 5 material_index 0 { SPHERE ... }
        // If present, the index is stored in the view object as view.view_index
        let view_index = null;
        if (this.peek().type === 'number') {
            view_index = this.next().value;
        }
        
        // wrapper properties may appear before the '{', e.g. name "...", material_index N, texture_index N
        let material_index = null;
        let texture_index = null;


        while (this.peek().type === 'ident') {

            const value = this.peek().value;
            if (value === 'name') {
                // consume name and following string
                this.next();
                if (this.peek().type === 'string') this.next();
                continue;
            }

            if (value === 'material_index') {
                this.next();
                const n = this.expect('number').value;
                material_index = n;
                continue;
            }

            if (value === 'texture_index') {
                this.next();
                const n = this.expect('number').value;
                texture_index = n;
                continue;
            }

            if (value === 'texture_mode') {
                // TODO: Handle TEXTURE_DECAL, TEXTURE_MODULATE, TEXTURE_BLEND
                this.next();
                this.next();
                continue;
            }

            // TODO: Handle those flags that can be applied to views:
            // visibility, wireframe, gouraud, nobackface, concave

            // if we hit a primitive keyword or the block-start, stop
            if (this.peek().type === '{') {
                break;
            }

            // If the ident is one of known primitives, stop so the following code handles them
            if (['RBOX', 'CYL', 'SPHERE', 'indexed_poly', 'N_LINE', 'LINE', 'QUAD_GRID', 'N_POLY'].includes(this.peek().value)) {
                break;
            }

            // unknown wrapper ident: consume it and any immediate value
            // Maybe later: Fail silently or warn?
            this.next();
            if (this.peek().type === 'string' || this.peek().type === 'number') {
                this.next();
            }

            continue;
        }

        // expect block
        if (this.peek().type === '{') {
            this.next();
            while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
                const t = this.peek();
                if (t.type === 'ident') {
                    const value = this.next().value;

                    // Handle wrapper properties that can appear inside the block too
                    if (value === 'name') {
                        if (this.peek().type === 'string') this.next();
                        continue;
                    }
                    
                    if (value === 'material_index') {
                        const n = this.expect('number').value;
                        material_index = n;
                        continue;
                    }
                    
                    if (value === 'texture_index') {
                        const n = this.expect('number').value;
                        texture_index = n;
                        continue;
                    }

                    if (value === 'RBOX') {
                        this.parseRBox(scene, parentObject, material_index, view_index);

                    } else if (value === 'CYL') {
                        try { this.parseCyl(scene, parentObject, material_index, view_index); } 
                        catch (e) { console.warn('CYL parse error in view:', e.message); } 

                    }  else if (value === 'indexed_poly') {
                        try { this.parseIndexedPoly(scene, material_index, texture_index, parentObject, view_index); } 
                        catch (e) { console.warn('indexed_poly parse error in view:', e.message); }

                    } else if (value === 'N_LINE' || value === 'LINE') {
                        try { this.parseLinePrimitive(scene, value.toUpperCase(), parentObject, material_index, texture_index, view_index); } 
                        catch (e) { console.warn('N_LINE/LINE parse error in view:', e.message); }

                    } else if (value === 'SPHERE') {
                        try { this.parseSphereInView(scene, parentObject, material_index, texture_index, view_index); }
                        catch (e) { console.warn('SPHERE parse error in view:', e.message); }

                    } else if (value === 'QUAD_GRID') {
                        try { this.parseQuadGrid(scene, parentObject, material_index, texture_index, view_index); }
                        catch (e) { console.warn('QUAD_GRID parse error in view:', e.message); }

                    } else if (value === 'N_POLY') {
                        try { this.parseNPoly(scene, parentObject, material_index, texture_index, view_index); }
                        catch (e) { console.warn('N_POLY parse error in view:', e.message); }

                    } else {
                        this.skipValue();
                        this.accept(';');
                    }

                } else if (t.type === '{') {
                    // unexpected block: skip
                    // Maybe later: Fail silently or warn?
                    this.skipBlock(false);

                } else {
                    // unexpected token: skip
                    // Maybe later: Fail silently or warn?
                    this.next();
                }
            }
            this.accept('}');

        } else if (this.peek().type === 'ident') {
            // single-line view containing a primitive:
            // view RBOX v ... or view CYL ...

            const value = this.peek().value;
            if (value === 'RBOX') {
                this.next();
                this.parseRBox(scene, parentObject, material_index, view_index);

            } else if (value === 'CYL') {
                this.next();
                try { this.parseCyl(scene, parentObject, material_index, view_index); }
                catch (e) { console.warn('CYL parse error in single-line view:', e.message); }

            } else if (value === 'QUAD_GRID') {
                this.next();
                try { this.parseQuadGrid(scene, parentObject, material_index, texture_index, view_index); }
                catch (e) { console.warn('QUAD_GRID parse error in single-line view:', e.message); }

            } else if (value === 'N_POLY') {
                this.next();
                try { this.parseNPoly(scene, parentObject, material_index, texture_index, view_index); }
                catch (e) { console.warn('N_POLY parse error in single-line view:', e.message); }

            } else {
                // else: unhandled single-line view primitive
                this.skipValue();
            }
        }
    }

    // Parse an object block: collect materials and textures and parse child views/objects
    parseObject(scene, parentObj = null) {
        // assume 'object' identifier already consumed
        // optional name or string may follow inside block
        let obj = { name: null, materials: [], textures: [], children: [], transforms: [] };
        // if next token is a string (uncommon) or ident, we'll handle inside the block
        if (this.peek().type === 'string') this.next();
        this.expect('{');
        while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
            if (this.peek().type === 'ident') {
                const id = this.next().value.toLowerCase();
                if (id === 'id') {
                    obj.id = this.expect('number').value;
                    continue;
                }
                if (id === 'name' && this.peek().type === 'string') { 
                    obj.name = this.next().value; 
                    continue; 
                }
                if (id === 'material') {
                    // three forms: material "NAME" | material rgb r g b | material { ... }
                    if (this.peek().type === 'string') {
                        const nm = this.next().value;
                        // TODO: Should be looked up later or filled in here from material library
                        obj.materials.push({
                            name: nm,
                            ambient: [0.0, 0.0, 0.0],
                            diffuse: [0.8, 0.8, 0.8],
                            emission: [0.0, 0.0, 0.0],
                            specular: [0.0, 0.0, 0.0],
                            spec_power: 0.0,
                            transparency: 0.0
                        });
                    } else if (this.peek().type === 'ident' && this.peek().value.toLowerCase() === 'rgb') {
                        this.next();
                        const r = this.expect('number').value;
                        const g = this.expect('number').value;
                        const b = this.expect('number').value;
                        // According to spec, rgb sets both ambient and diffuse
                        obj.materials.push({
                            ambient: [r, g, b],
                            diffuse: [r, g, b],
                            emission: [0.0, 0.0, 0.0],
                            specular: [0.0, 0.0, 0.0],
                            spec_power: 0.0,
                            transparency: 0.0
                        });
                    } else if (this.peek().type === '{') {
                        this.next(); // consume '{'
                        // Parse material property block
                        let mat = {
                            ambient: [0.0, 0.0, 0.0],
                            diffuse: [0.8, 0.8, 0.8],
                            emission: [0.0, 0.0, 0.0],
                            specular: [0.0, 0.0, 0.0],
                            spec_power: 0.0,
                            transparency: 0.0
                        };
                        while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
                            if (this.peek().type === 'ident') {
                                const prop = this.next().value.toLowerCase();
                                if (['ambient','diffuse','emission','specular'].includes(prop)) {
                                    // expect 3 numbers
                                    const r = this.expect('number').value;
                                    const g = this.expect('number').value;
                                    const b = this.expect('number').value;
                                    mat[prop] = [r, g, b];
                                } else if (prop === 'spec_power') {
                                    mat.spec_power = this.expect('number').value;
                                } else if (prop === 'transparency') {
                                    mat.transparency = this.expect('number').value;
                                } else {
                                    // skip unknown property
                                    this.skipValue();
                                }
                            } else {
                                this.skipValue();
                            }
                        }
                        this.accept('}');
                        obj.materials.push(mat);
                    } else {
                        console.warn('Unexpected material format, got:', this.peek());
                        this.skipValue();
                    }
                    continue;
                }
                if (id === 'texture') {
                    if (this.peek().type === 'string') {
                        obj.textures.push(this.next().value);
                    } else {
                        console.warn('Expected texture name string, got:', this.peek());
                        this.skipValue();
                    }
                    continue;
                }
                if (id === 'translation') {
                    const vec = this.parseVector();
                    obj.transforms.push({ type: 'translation', value: vec });
                    continue;
                }
                if (id === 'eulerxyz') {
                    const vec = this.parseVector();
                    obj.transforms.push({ type: 'eulerxyz', value: vec });
                    continue;
                }
                if (id === 'fixedxyz') {
                    const vec = this.parseVector();
                    obj.transforms.push({ type: 'fixedxyz', value: vec });
                    continue;
                }
                if (id === 'rotation') {
                    // rotation v X1 Y1 Z1 v X2 Y2 Z2 v X3 Y3 Z3 (3 basis vectors)
                    const v1 = this.parseVector();
                    const v2 = this.parseVector();
                    const v3 = this.parseVector();
                    obj.transforms.push({ type: 'rotation', value: [v1, v2, v3] });
                    continue;
                }
                if (id === 'view') { 
                    try {
                        this.parseView(scene, obj);
                    }
                    catch (e) {
                        console.warn('View parse error in object:', e && e.message);
                        this.skipBlock(false);
                    } 
                    continue; 
                }
                if (id === 'object') {
                    try {
                        const childObj = this.parseObject(scene, obj);
                        obj.children.push(childObj);
                    } catch (e) {
                        console.warn('Nested object parse error:', e && e.message);
                        this.skipBlock(false);
                    }
                    continue;
                }

                //
                // TODO: Add billboard, lod, switch
                // TODO: Add flags, gateway, property, method, light, object-level inline, legacy lod
                //                
                // Until then, skip unknown identifiers and their values
                //
                if (this.peek().type === '{') { this.skipBlock(false); continue; }
                this.skipValue(); this.accept(';');

            } else if (this.peek().type === '{') { 
                // This is probably an error, but skip it
                // Maybe later: Fail silently or warn?
                this.skipBlock(false);

            } else {
                // unexpected token: skip.
                // Maybe later: Fail silently or warn?
                this.next();
            }
        }
        this.accept('}');
        // attach to scene if parent is null (top-level object)
        if (!parentObj) {
            scene.objects = scene.objects || [];
            scene.objects.push(obj);
        }
        return obj;
    }

    // parse a simple sphere primitive inside a view: SPHERE rx ry rz  (or single radius)
    parseSphereInView(scene, parentObject, material_index, texture_index, view_index = null) {
        // read up to three numbers
        const nums = [];
        for (let k = 0; k < 3; k++) {
            const p = this.peek();
            if (p.type === 'number') nums.push(this.next().value);
            else break;
        }
        // default to uniform radius if only one given
        let rx = 0.5, ry = 0.5, rz = 0.5;
        if (nums.length === 1) { rx = ry = rz = nums[0]; }
        else if (nums.length === 3) { rx = nums[0]; ry = nums[1]; rz = nums[2]; }
        // push a sphere descriptor as a view in the parent object
        const view = { type: 'sphere', rx, ry, rz, material_index, texture_index };
        if (view_index !== null) view.view_index = view_index;
        if (parentObject && parentObject.materials && parentObject.materials.length > 0) {
            if (material_index !== null && parentObject.materials[material_index]) {
                view.material = parentObject.materials[material_index];
            }
            else {
                view.material = parentObject.materials[0];
            }
        }
        if (parentObject) {
            parentObject.views = parentObject.views || [];
            parentObject.views.push(view);
        }
    }

    // parse QUAD_GRID NX NY v p0 v p1 v p2 v p3
    parseQuadGrid(scene, parentObject, material_index, texture_index, view_index = null) {
        // expect two ints
        const nxTok = this.expect('number'); const nyTok = this.expect('number');
        const nx = nxTok.value | 0; const ny = nyTok.value | 0;
        // four corner positions (each may be prefixed by 'v')
        const pts = [];
        for (let i = 0; i < 4; i++) {
            pts.push(this.parseVector());
        }
        // generate grid vertices and indices (triangles)
        const positions = [];
        const indices = [];
        for (let iy = 0; iy < ny; iy++) {
            const ty = ny === 1 ? 0.5 : iy / (ny - 1);
            for (let ix = 0; ix < nx; ix++) {
                const tx = nx === 1 ? 0.5 : ix / (nx - 1);
                // bilinear interpolate among pts: p0 (0,0), p1 (0,1), p2 (1,0), p3 (1,1)
                const x = (1 - tx) * (1 - ty) * pts[0][0] + (1 - tx) * ty * pts[1][0] + tx * (1 - ty) * pts[2][0] + tx * ty * pts[3][0];
                const y = (1 - tx) * (1 - ty) * pts[0][1] + (1 - tx) * ty * pts[1][1] + tx * (1 - ty) * pts[2][1] + tx * ty * pts[3][1];
                const z = (1 - tx) * (1 - ty) * pts[0][2] + (1 - tx) * ty * pts[1][2] + tx * (1 - ty) * pts[2][2] + tx * ty * pts[3][2];
                positions.push(x, y, z);
            }
        }
        for (let iy = 0; iy < ny - 1; iy++) {
            for (let ix = 0; ix < nx - 1; ix++) {
                const i0 = iy * nx + ix;
                const i1 = i0 + 1;
                const i2 = i0 + nx;
                const i3 = i2 + 1;
                // two triangles per quad
                indices.push(i0, i2, i1);
                indices.push(i1, i2, i3);
            }
        }
        const view = { type: 'mesh', positions, indices, material_index, texture_index };
        if (view_index !== null) view.view_index = view_index;
        if (parentObject) {
            parentObject.views = parentObject.views || [];
            parentObject.views.push(view);
        }
    }

    // parse N_POLY N v x y z [t u v] ...
    parseNPoly(scene, parentObject, material_index, texture_index, view_index = null) {
        // expect count
        const countTok = this.expect('number');
        const count = countTok.value | 0;
        if (count < 3) {
            console.warn('N_POLY: need at least 3 vertices, got', count);
            return;
        }
        
        const positions = [];
        const texcoords = [];
        let hasTexcoords = false;
        
        // read N vertices
        for (let i = 0; i < count; i++) {
            // expect 'v' x y z
            const pos = this.parseVector();
            positions.push(pos[0], pos[1], pos[2]);
            
            // optional 't' u v
            if (this.peekIs('ident', 't')) {
                this.next(); // consume 't'
                const u = this.expect('number').value;
                const v = this.expect('number').value;
                texcoords.push(u, v);
                hasTexcoords = true;
            } else if (hasTexcoords) {
                // if previous vertices had texcoords, add default for consistency
                texcoords.push(0, 0);
            }
        }
        
        // triangulate the polygon using a simple fan from vertex 0
        const indices = [];
        for (let i = 1; i < count - 1; i++) {
            indices.push(0, i, i + 1);
        }
        
        const view = { type: 'mesh', positions, indices, material_index, texture_index };
        if (view_index !== null) view.view_index = view_index;
        if (hasTexcoords && texcoords.length === (count * 2)) {
            view.texcoords = texcoords;
        }
        if (parentObject) {
            parentObject.views = parentObject.views || [];
            parentObject.views.push(view);
        }
    }

    // parse N_LINE / LINE primitives inside a view
    parseLinePrimitive(scene, kind, parentObject, material_index, texture_index, view_index = null) {
        // If kind == 'N_LINE' the next token may be a count
        let count = null;
        if (kind === 'N_LINE' && this.peek().type === 'number') { count = this.next().value | 0; }
        const verts = [];
        // read vectors until '}' or until count reached
        while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
            if (this.peekIs('ident', 'v')) { try { const v = this.parseVector(); verts.push(...v); } catch (e) { break; } }
            else break;
            if (count !== null && verts.length / 3 >= count) break;
        }
        // build line indices: consecutive segments
        const indices = [];
        const vcount = verts.length / 3;
        for (let i = 0; i < vcount - 1; i++) indices.push(i, i + 1);
        const view = { type: 'lines', positions: verts, indices, material_index, texture_index };
        if (view_index !== null) view.view_index = view_index;
        if (parentObject) {
            parentObject.views = parentObject.views || [];
            parentObject.views.push(view);
        }
    }

    // parse indexed_poly { ... } minimal support: vertexlist & polylist
    parseIndexedPoly(scene, material_index, texture_index, parentObject, view_index = null) {
        // parseIndexedPoly entered
        // after 'indexed_poly' we expect prim type and optional flags (skip them)
        if (this.peek().type === 'ident') this.next(); // PRIM_TYPE
        // skip any additional flags/numbers until we hit a known list keyword
        while (this.peek().type === 'number' || (this.peek().type === 'ident' && !['vertexlist', 'normallist', 'texturelist', 'polylist', 'normalindexlist', 'textureindexlist', 'materiallist', 'colourlist'].includes(this.peek().value.toLowerCase()))) {
            this.next();
        }
        const vertices = [];
        const normallist = [];
        const texturelist = [];
        const normalindexlist = [];
        const textureindexlist = [];
        const polylist = [];
        while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
            if (this.peek().type === 'ident') {
                const id = this.next().value.toLowerCase();
                if (id === 'vertexlist') {
                    // expect '{'
                    this.expect('{');
                    // read triples until '}'
                    while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
                        const t = this.peek();
                        if (t.type === 'number') {
                            const x = this.next().value;
                            const y = this.expect('number').value;
                            const z = this.expect('number').value;
                            // optional comma
                            if (this.peek().type === ',') this.next();
                            vertices.push(x, y, z);
                            continue;
                        }
                        // skip unexpected tokens
                        this.next();
                    }
                    this.expect('}');
                    continue;
                }
                if (id === 'polylist') {
                    this.expect('{');
                    // polylist: sequences of ints terminated by -1; commas optional
                    let current = [];
                    while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
                        const t = this.next();
                        if (t.type === 'number') {
                            const v = t.value | 0;
                            if (v === -1) { if (current.length > 0) { polylist.push(current); current = []; } }
                            else current.push(v);
                            // consume optional comma
                            if (this.peek().type === ',') this.next();
                            continue;
                        }
                        // skip
                    }
                    if (current.length > 0) polylist.push(current);
                    this.expect('}');
                    continue;
                }
                if (id === 'normallist') {
                    this.expect('{');
                    while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
                        if (this.peek().type === 'number') {
                            const nx = this.next().value; const ny = this.expect('number').value; const nz = this.expect('number').value;
                            if (this.peek().type === ',') this.next();
                            normallist.push([nx, ny, nz]); continue;
                        }
                        this.next();
                    }
                    this.expect('}'); continue;
                }
                if (id === 'texturelist') {
                    this.expect('{');
                    while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
                        if (this.peek().type === 'number') {
                            const u = this.next().value; const v = this.expect('number').value; if (this.peek().type === ',') this.next(); texturelist.push([u, v]); continue;
                        }
                        this.next();
                    }
                    this.expect('}'); continue;
                }
                if (id === 'normalindexlist') {
                    this.expect('{');
                    let current = [];
                    while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
                        const t = this.next();
                        if (t.type === 'number') {
                            const v = t.value | 0;
                            if (v === -1) { if (current.length > 0) { normalindexlist.push(current); current = []; } }
                            else current.push(v);
                            if (this.peek().type === ',') this.next();
                            continue;
                        }
                    }
                    if (current.length > 0) normalindexlist.push(current);
                    this.expect('}'); continue;
                }
                if (id === 'textureindexlist') {
                    this.expect('{');
                    let current = [];
                    while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
                        const t = this.next();
                        if (t.type === 'number') {
                            const v = t.value | 0;
                            if (v === -1) { if (current.length > 0) { textureindexlist.push(current); current = []; } }
                            else current.push(v);
                            if (this.peek().type === ',') this.next();
                            continue;
                        }
                    }
                    if (current.length > 0) textureindexlist.push(current);
                    this.expect('}'); continue;
                }
                // skip other lists for now
                if (this.peek().type === '{') { this.skipBlock(false); continue; }
                this.skipValue();
            } else {
                this.next();
            }
        }
        // Don't consume closing brace - that belongs to the view block

        // Helper: compute polygon normal via Newell's method
        const computeNormalNewell = (pts) => {
            let nx = 0, ny = 0, nz = 0;
            const n = pts.length;
            for (let i = 0; i < n; i++) {
                const [x1, y1, z1] = pts[i];
                const [x2, y2, z2] = pts[(i + 1) % n];
                nx += (y1 - y2) * (z1 + z2);
                ny += (z1 - z2) * (x1 + x2);
                nz += (x1 - x2) * (y1 + y2);
            }
            const len = Math.hypot(nx, ny, nz) || 1; return [nx / len, ny / len, nz / len];
        };

        // Helper: ear-clipping triangulation for a polygon given array of 3D points
        const triangulateEarClip = (polyPts) => {
            const n = polyPts.length;
            if (n < 3) return [];
            // Project to 2D plane by dropping the largest normal component
            const normal = computeNormalNewell(polyPts);
            const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2]);
            let projection = 'xy';
            if (ax > ay && ax > az) projection = 'yz';
            else if (ay > az && ay > ax) projection = 'xz';

            const proj = (p) => {
                if (projection === 'xy') return [p[0], p[1]];
                if (projection === 'yz') return [p[1], p[2]];
                return [p[0], p[2]];
            };

            const v2 = polyPts.map(proj);
            const V = [];
            for (let i = 0; i < n; i++) V.push(i);

            const area2 = (a, b, c) => ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
            const isEar = (i0, i1, i2) => {
                const a = v2[i0], b = v2[i1], c = v2[i2];
                if (area2(a, b, c) <= 1e-8) return false;
                // check no other point is inside triangle
                for (const j of V) {
                    if (j === i0 || j === i1 || j === i2) continue;
                    const p = v2[j];
                    // barycentric / point-in-triangle
                    const A = area2(a, b, c);
                    const A1 = area2(p, b, c), A2 = area2(a, p, c), A3 = area2(a, b, p);
                    if (A1 >= -1e-9 && A2 >= -1e-9 && A3 >= -1e-9 && Math.abs(A1 + A2 + A3 - A) < 1e-6) return false;
                }
                return true;
            };

            const triangles = [];
            let safety = 0;
            while (V.length > 3 && safety++ < 10000) {
                let clipped = false;
                for (let i = 0; i < V.length; i++) {
                    const i0 = V[(i - 1 + V.length) % V.length];
                    const i1 = V[i];
                    const i2 = V[(i + 1) % V.length];
                    if (isEar(i0, i1, i2)) {
                        triangles.push([i0, i1, i2]);
                        V.splice(i, 1);
                        clipped = true; break;
                    }
                }
                if (!clipped) break; // give up
            }
            if (V.length === 3) triangles.push([V[0], V[1], V[2]]);
            // triangles are indices into original polygon array
            return triangles;
        };

        // Build expanded vertex arrays (positions, normals, texcoords) by triangulating each poly
        const outPositions = [];
        const outNormals = [];
        const outTexcoords = [];
        const outIndices = [];
        let nextIndex = 0;

        for (let faceIdx = 0; faceIdx < polylist.length; faceIdx++) {
            const poly = polylist[faceIdx];
            if (!poly || poly.length < 3) continue;
            const polyPts = poly.map(i => [vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]]);
            const tris = triangulateEarClip(polyPts);
            for (const tri of tris) {
                // tri contains indices into poly (local indices)
                for (let k = 0; k < 3; k++) {
                    const localIdx = tri[k];
                    const vertIdx = poly[localIdx];
                    // position
                    outPositions.push(vertices[vertIdx * 3], vertices[vertIdx * 3 + 1], vertices[vertIdx * 3 + 2]);
                    // normal: try normalindexlist -> normallist
                    let nx = 0, ny = 0, nz = 0;
                    if (normalindexlist && normalindexlist[faceIdx] && normalindexlist[faceIdx][localIdx] !== undefined) {
                        const ni = normalindexlist[faceIdx][localIdx];
                        if (normallist[ni]) { nx = normallist[ni][0]; ny = normallist[ni][1]; nz = normallist[ni][2]; }
                    } else if (normallist && normallist[vertIdx]) { nx = normallist[vertIdx][0]; ny = normallist[vertIdx][1]; nz = normallist[vertIdx][2]; }
                    outNormals.push(nx, ny, nz);
                    // texcoord: similar
                    if (textureindexlist && textureindexlist[faceIdx] && textureindexlist[faceIdx][localIdx] !== undefined) {
                        const ti = textureindexlist[faceIdx][localIdx];
                        const tt = texturelist[ti] || [0, 0]; outTexcoords.push(tt[0], tt[1]);
                    } else if (texturelist && texturelist[vertIdx]) { outTexcoords.push(texturelist[vertIdx][0], texturelist[vertIdx][1]); }
                    else { outTexcoords.push(0, 0); }
                    outIndices.push(nextIndex++);
                }
            }
        }

        const view = { type: 'mesh', positions: outPositions, indices: outIndices, material_index, texture_index };
        if (view_index !== null) view.view_index = view_index;
        if (outNormals.some(v => v !== 0)) view.normals = outNormals;
        if (outTexcoords.some(v => v !== 0)) view.texcoords = outTexcoords;
        // resolve material/texture strings from parentObject if available
        if (parentObject) {
            if (material_index !== null && parentObject.materials && parentObject.materials[material_index]) view.material = parentObject.materials[material_index];
            if (texture_index !== null && parentObject.textures && parentObject.textures[texture_index]) view.texture = parentObject.textures[texture_index];
            parentObject.views = parentObject.views || [];
            parentObject.views.push(view);
        }
    }

    // Top-level: handle known keywords, otherwise skip unknown blocks or tokens
    parseTopLevel(scene) {
        while (this.peek().type !== 'EOF') {
            const t = this.peek();
            if (t.type === 'ident') {
                const kw = t.value;
                // top-level identifier
                // consume the identifier
                this.next();
                // object handling falls through to block parsing
                if (kw.toLowerCase() === 'world') {
                    try { this.parseWorld(scene); }
                    catch (e) { console.warn('world parse error:', e.message); this.skipBlock(false); }
                    continue;
                }
                if (kw.toLowerCase() === 'object') {
                    try { this.parseObject(scene); }
                    catch (e) { console.warn('object parse error:', e && e.message); this.skipBlock(false); }
                    continue;
                }
                // TODO: Add billboard, lod, switch, top-level inline

                // unknown identifier:
                // if followed by '{', skip the block, otherwise skip until semicolon
                // Maybe later: Fail silently or warn?
                if (this.peek().type === '{') {
                    this.skipBlock(false); 
                    continue;
                }
                while (this.peek().type !== ';' && this.peek().type !== 'EOF' && this.peek().type !== '}') {
                    this.next(); 
                }
                this.accept(';');

            } else if (t.type === '{') {
                // stray block
                // Maybe later: Fail silently or warn?
                this.skipBlock(false);
            } else {
                // punctuation or unexpected token, just consume
                // Maybe later: Fail silently or warn?
                this.next();
            }
        }
    }
}

// Public API
export function parseVrIntoScene(theScene, text) {
    try {
        const tokens = tokenize(text);
        const parser = new Parser(tokens);
        parser.parseTopLevel(theScene);
    } catch (e) {
        // report fatal parse error to console.error (kept minimal)
        console.error('parseVrIntoScene: fatal parse error', e && e.message);
        console.error('Stack:', e && e.stack);
    }

    // Post-process parsed objects and ensure each object has at least one
    // material: X11-like "GRAY" diffuse
    theScene.objects = theScene.objects || [];
    const x11Gray = [128 / 255, 128 / 255, 128 / 255]; // #808080
    for (const obj of theScene.objects) {
        obj.materials = obj.materials || [];
        if (obj.materials.length === 0) obj.materials.push({ name: 'GRAY', diffuse: x11Gray });
    }

    return theScene;
}
