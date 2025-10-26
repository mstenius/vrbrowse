// Small module that contains .vr parsing utilities

export function emtpyScene() {
    return {
        boxes: [],
        cylinders: [],
        meshes: [],
        world: {
            background: [0.2, 0.2, 0.25],
            start: [0, 0, 3]
        }
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
        if (/\s/.test(ch)) { i++; continue; }

        // punctuation
        if (ch === '{' || ch === '}' || ch === '(' || ch === ')' || ch === ',' || ch === ';') {
            tokens.push({ type: ch, value: ch }); i++; continue;
        }

        // quoted string
        if (ch === '"') {
            let j = i + 1;
            let str = '';
            while (j < len) {
                const cc = input[j];
                if (cc === '\\' && j + 1 < len) {
                    // simple escape handling
                    str += input[j + 1]; j += 2; continue;
                }
                if (cc === '"') { j++; break; }
                str += cc; j++;
            }
            tokens.push({ type: 'string', value: str });
            i = j; continue;
        }

        // number (int or float, with optional exponent)
        const numMatch = /^[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/.exec(input.slice(i));
        if (numMatch) {
            tokens.push({ type: 'number', value: parseFloat(numMatch[0]), raw: numMatch[0] });
            i += numMatch[0].length; continue;
        }

        // identifier / keyword (allow hyphen in names)
        if (isIdentStart(ch)) {
            let j = i + 1;
            while (j < len && isIdent(input[j])) j++;
            const word = input.slice(i, j);
            tokens.push({ type: 'ident', value: word });
            i = j; continue;
        }

        // unknown single char: emit as symbol
        tokens.push({ type: input[i], value: input[i] }); i++;
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
    constructor(tokens) { this.tokens = tokens; this.i = 0; }
    peek(n = 0) { return this.tokens[this.i + n] || { type: 'EOF' }; }
    next() { const t = this.peek(); this.i++; return t; }
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
        if (t.type === type && (value === undefined || t.value === value)) { this.i++; return t; }
        return null;
    }

    // Consume a single value for unknown properties: string, number, or v-vector
    skipValue() {
        const t = this.peek();
        if (!t) return;
        if (t.type === 'string' || t.type === 'number') { this.next(); return; }
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
    // If parseChildren is true we will look for known constructs (world, RBOX)
    // inside the block; otherwise we just skip it.
    skipBlock(parseChildren = true, scene = null) {
        if (!this.accept('{')) return;
        // console.debug('skipBlock enter, parseChildren=', parseChildren);
        while (true) {
            const t = this.peek();
            if (!t || t.type === 'EOF') break;
            if (t.type === '}') { this.next(); break; }
            if (!parseChildren) {
                // just consume until matching brace
                // count nested braces to skip correctly
                let depth = 0;
                while (true) {
                    const u = this.next();
                    if (!u || u.type === 'EOF') return;
                    if (u.type === '{') depth++;
                    else if (u.type === '}') {
                        if (depth === 0) return; else depth--;
                    }
                }
            }

            // If parsing children, handle identifiers and nested blocks recursively
            if (this.peek().type === 'ident') {
                const id = this.next().value;
                if (id.toLowerCase() === 'world') {
                    try { this.parseWorld(scene); } catch (e) { console.warn('world parse error in block:', e.message); this.skipBlock(false); }
                    continue;
                }
                if (id.toUpperCase() === 'RBOX') {
                    try { this.parseRBox(scene); } catch (e) { console.warn('RBOX parse error in block:', e.message); }
                    continue;
                }
                if (id.toLowerCase() === 'view') {
                    try { this.parseView(scene); } catch (e) { console.warn('view parse error in block:', e.message); this.skipBlock(false); }
                    continue;
                }

                // if next token is a block, recurse into it (parse children)
                if (this.peek().type === '{') { this.skipBlock(true, scene); continue; }

                // otherwise skip a single value (string/number/vector) and continue
                this.skipValue();
                this.accept(';');
                continue;
            }

            if (this.peek().type === '{') { this.skipBlock(true, scene); continue; }
            // other tokens: just consume
            this.next();
        }
    }

    // Parse a 'v' vector: v number number number
    parseVector() {
        // consume optional leading 'v'
        if (this.peek().type === 'ident' && this.peek().value === 'v') this.next();
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
                const key = t.value.toLowerCase();
                if (key === 'background') {
                    // three numbers expected
                    const r = this.expect('number').value;
                    const g = this.expect('number').value;
                    const b = this.expect('number').value;
                    scene.world.background = [r, g, b];
                } else if (key === 'start') {
                    // expect 'v' then three numbers
                    const maybeV = this.peek();
                    if (maybeV.type === 'ident' && maybeV.value === 'v') this.next();
                    const vec = this.parseVector();
                    scene.world.start = vec;
                } else {
                    // unknown world property: skip a single value (string/number/vector) or a block
                    // do NOT parse children inside world
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

    parseRBox(scene) {
        // 'RBOX' already consumed
        // Expect optional 'v' then vec then optional 'v' then vec
        const maybe = this.peek();
        if (maybe.type === 'ident' && maybe.value === 'v') this.next();
        const a = this.parseVector();
        if (this.peek().type === 'ident' && this.peek().value === 'v') this.next();
        const b = this.parseVector();

        const x0 = a[0], y0 = a[1], z0 = a[2];
        const x1 = b[0], y1 = b[1], z1 = b[2];
        const minx = Math.min(x0, x1), maxx = Math.max(x0, x1);
        const miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
        const minz = Math.min(z0, z1), maxz = Math.max(z0, z1);
        const center = [(minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2];
        const size = [maxx - minx, maxy - miny, maxz - minz];
        const color = [
            (0.3 + (center[0] % 1 + 1) % 1 * 0.7),
            (0.3 + (center[1] % 1 + 1) % 1 * 0.7),
            (0.3 + (center[2] % 1 + 1) % 1 * 0.7)
        ];
        scene.boxes.push({ center, size, color });
    }

    parseCyl(scene) {
        // Accept optional leading 'v' center, then rx ry height [ratio] [PART_TOP|PART_BOTTOM]
        let center = [0, 0, 0];
        if (this.peek().type === 'ident' && this.peek().value === 'v') {
            this.next();
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

        // color based on center (similar heuristic used for RBOX)
        const color = [
            (0.3 + (center[0] % 1 + 1) % 1 * 0.7),
            (0.3 + (center[1] % 1 + 1) % 1 * 0.7),
            (0.3 + (center[2] % 1 + 1) % 1 * 0.7)
        ];
        scene.cylinders.push({ center, rx, ry, height, color });
    }

    parseView(scene, parentObject) {
        // assume 'view' identifier already consumed
        // wrapper properties may appear before the '{', e.g. name "...", material_index N, texture_index N
        let material_index = null;
        let texture_index = null;
        while (this.peek().type === 'ident') {
            const k = this.peek().value.toLowerCase();
            if (k === 'name') {
                // consume name and following string
                this.next();
                if (this.peek().type === 'string') this.next();
                continue;
            }
            if (k === 'material_index') {
                this.next();
                const n = this.expect('number').value; material_index = n; continue;
            }
            if (k === 'texture_index') {
                this.next();
                const n = this.expect('number').value; texture_index = n; continue;
            }
            if (k === 'texture_mode') { this.next(); this.next(); continue; }
            // if we hit a primitive keyword or the block-start, stop
            if (this.peek().type === '{') break;
            // If the ident is one of known primitives, stop so the following code handles them
            const up = this.peek().value.toUpperCase();
            if (['RBOX', 'CYL', 'SPHERE', 'INDEXED_POLY', 'N_LINE', 'LINE', 'QUAD_GRID'].includes(up)) break;
            // unknown wrapper ident: consume it and any immediate value
            this.next();
            if (this.peek().type === 'string' || this.peek().type === 'number') this.next();
            continue;
        }

        // expect block
        if (this.peek().type === '{') {
            this.next();
            while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
                const t = this.peek();
                if (t.type === 'ident') {
                    const id = this.next().value;
                    // parseView saw id
                    if (id.toUpperCase() === 'RBOX') { this.parseRBox(scene); continue; }
                    if (id.toUpperCase() === 'CYL') { try { this.parseCyl(scene); } catch (e) { console.warn('CYL parse error in view:', e.message); } continue; }
                    if (id.toLowerCase() === 'indexed_poly') { try { this.parseIndexedPoly(scene, material_index, texture_index, parentObject); } catch (e) { console.warn('indexed_poly parse error in view:', e.message); } continue; }
                    if (id.toUpperCase() === 'N_LINE' || id.toUpperCase() === 'LINE') { try { this.parseLinePrimitive(scene, id.toUpperCase()); } catch (e) { console.warn('N_LINE/LINE parse error in view:', e.message); } continue; }
                    if (id.toUpperCase() === 'SPHERE') { try { this.parseSphereInView(scene); } catch (e) { console.warn('SPHERE parse error in view:', e.message); } continue; }
                    if (id.toUpperCase() === 'QUAD_GRID') { try { this.parseQuadGrid(scene); } catch (e) { console.warn('QUAD_GRID parse error in view:', e.message); } continue; }
                    // unknown view-level token: if block, skip; else skip a single value
                    if (this.peek().type === '{') { this.skipBlock(true, scene); continue; }
                    this.skipValue();
                    this.accept(';');
                } else if (t.type === '{') { this.skipBlock(true, scene); }
                else this.next();
            }
            this.accept('}');
        } else {
            // single-line view containing a primitive: e.g., view RBOX v ... or view CYL ...
            if (this.peek().type === 'ident') {
                const id = this.peek().value.toUpperCase();
                if (id === 'RBOX') { this.next(); this.parseRBox(scene); }
                else if (id === 'CYL') { this.next(); try { this.parseCyl(scene); } catch (e) { console.warn('CYL parse error in single-line view:', e.message); } }
                else if (id === 'SPHERE') { this.next(); try { this.parseSphereInView(scene); } catch (e) { console.warn('SPHERE parse error in single-line view:', e.message); } }
            }
        }
    }

    // Parse an object block: collect materials and textures and parse child views/objects
    parseObject(scene) {
        // assume 'object' identifier already consumed
        // optional name or string may follow inside block
        let obj = { name: null, materials: [], textures: [], children: [] };
        // if next token is a string (uncommon) or ident, we'll handle inside the block
        if (this.peek().type === 'string') this.next();
        this.expect('{');
        while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
            if (this.peek().type === 'ident') {
                const id = this.next().value.toLowerCase();
                if (id === 'name' && this.peek().type === 'string') { obj.name = this.next().value; continue; }
                if (id === 'material') {
                    // three forms: material "NAME" | material rgb r g b | material { ... }
                    if (this.peek().type === 'string') {
                        const nm = this.next().value; obj.materials.push({ name: nm, diffuse: [0.8, 0.8, 0.8] }); continue;
                    }
                    if (this.peek().type === 'ident' && this.peek().value.toLowerCase() === 'rgb') {
                        this.next();
                        const r = this.expect('number').value; const g = this.expect('number').value; const b = this.expect('number').value;
                        obj.materials.push({ diffuse: [r, g, b] }); continue;
                    }
                    if (this.peek().type === '{') { this.skipBlock(false); obj.materials.push({ diffuse: [0.8, 0.8, 0.8] }); continue; }
                    // fallback
                    this.skipValue(); continue;
                }
                if (id === 'texture') {
                    if (this.peek().type === 'string') { obj.textures.push(this.next().value); } else this.skipValue(); continue;
                }
                if (id === 'view') { try { this.parseView(scene, obj); } catch (e) { console.warn('view parse error in object:', e && e.message); this.skipBlock(true); } continue; }
                if (id === 'object') { try { this.parseObject(scene); } catch (e) { console.warn('nested object parse error:', e && e.message); this.skipBlock(true); } continue; }
                // other known tokens: inline, lodrange etc — skip
                if (this.peek().type === '{') { this.skipBlock(true); continue; }
                this.skipValue(); this.accept(';');
            } else if (this.peek().type === '{') { this.skipBlock(true); }
            else this.next();
        }
        this.accept('}');
        // attach to scene if needed (scene does not currently keep objects list, but meshes from views reference materials/textures via parentObject)
        // For debugging, we store top-level objects collection
        scene.objects = scene.objects || [];
        scene.objects.push(obj);
        return obj;
    }

    // parse a simple sphere primitive inside a view: SPHERE rx ry rz  (or single radius)
    parseSphereInView(scene) {
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
        // push a sphere descriptor to scene.meshes; viewer will tessellate
        scene.meshes = scene.meshes || [];
        scene.meshes.push({ type: 'sphere', rx, ry, rz });
    }

    // parse QUAD_GRID NX NY v p0 v p1 v p2 v p3
    parseQuadGrid(scene) {
        // expect two ints
        const nxTok = this.expect('number'); const nyTok = this.expect('number');
        const nx = nxTok.value | 0; const ny = nyTok.value | 0;
        // four corner positions (each may be prefixed by 'v')
        const pts = [];
        for (let i = 0; i < 4; i++) {
            if (this.peek().type === 'ident' && this.peek().value === 'v') this.next();
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
        scene.meshes = scene.meshes || [];
        scene.meshes.push({ type: 'mesh', positions, indices });
    }

    // parse N_LINE / LINE primitives inside a view
    parseLinePrimitive(scene, kind) {
        // If kind == 'N_LINE' the next token may be a count
        let count = null;
        if (kind === 'N_LINE' && this.peek().type === 'number') { count = this.next().value | 0; }
        const verts = [];
        // read vectors until '}' or until count reached
        while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
            if (this.peek().type === 'ident' && this.peek().value === 'v') { this.next(); try { const v = this.parseVector(); verts.push(...v); } catch (e) { break; } }
            else break;
            if (count !== null && verts.length / 3 >= count) break;
        }
        // build line indices: consecutive segments
        const indices = [];
        const vcount = verts.length / 3;
        for (let i = 0; i < vcount - 1; i++) indices.push(i, i + 1);
        scene.meshes = scene.meshes || [];
        scene.meshes.push({ type: 'lines', positions: verts, indices });
    }

    // parse indexed_poly { ... } minimal support: vertexlist & polylist
    parseIndexedPoly(scene, material_index, texture_index, parentObject) {
        // parseIndexedPoly entered
        // after 'indexed_poly' we expect prim type and optional flags (skip them)
        if (this.peek().type === 'ident') this.next(); // PRIM_TYPE
        // skip until block
        if (this.peek().type === '{') this.next();
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
        this.accept('}');

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

        scene.meshes = scene.meshes || [];
        const meshObj = { type: 'mesh', positions: outPositions, indices: outIndices };
        if (outNormals.some(v => v !== 0)) meshObj.normals = outNormals;
        if (outTexcoords.some(v => v !== 0)) meshObj.texcoords = outTexcoords;
        // resolve material/texture strings from parentObject if available
        if (parentObject) {
            if (material_index !== null && parentObject.materials && parentObject.materials[material_index]) meshObj.material = parentObject.materials[material_index];
            if (texture_index !== null && parentObject.textures && parentObject.textures[texture_index]) meshObj.texture = parentObject.textures[texture_index];
        }
        scene.meshes.push(meshObj);
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
                    try { this.parseWorld(scene); } catch (e) { console.warn('world parse error:', e.message); this.skipBlock(true, scene); }
                    continue;
                }
                if (kw.toLowerCase() === 'object') {
                    try { this.parseObject(scene); } catch (e) { console.warn('object parse error:', e && e.message); this.skipBlock(true, scene); }
                    continue;
                }
                if (kw.toLowerCase() === 'view') {
                    try { this.parseView(scene); } catch (e) { console.warn('view parse error:', e.message); this.skipBlock(true, scene); }
                    continue;
                }
                if (kw.toUpperCase() === 'RBOX') {
                    try { this.parseRBox(scene); } catch (e) { console.warn('RBOX parse error:', e.message); }
                    continue;
                }

                // unknown identifier: if followed by '{', skip the block, otherwise skip until semicolon
                if (this.peek().type === '{') { this.skipBlock(true, scene); continue; }
                // otherwise consume tokens until semicolon or newline or next top-level ident
                while (this.peek().type !== ';' && this.peek().type !== 'EOF' && this.peek().type !== '}') this.next();
                this.accept(';');
            } else if (t.type === '{') {
                // stray block
                this.skipBlock(true, scene);
            } else {
                // punctuation or unexpected token, just consume
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
    }
    return theScene;
}
