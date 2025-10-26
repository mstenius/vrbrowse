// Small module that contains .vr parsing utilities

export function emtpyScene() {
    return {
        boxes: [],
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
                    str += input[j+1]; j += 2; continue;
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
            throw new Error(`Unexpected token: expected ${type}${value ? ' '+value : ''}, got ${t.type} ${t.value}`);
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
                        if (depth === 0) return; else depth--; }
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
        // allow optional leading 'v' or just three numbers (be permissive)
        if (this.accept('ident') && this.tokens[this.i-1].value === 'v') {
            // consumed v
        } else if (this.peek(-1) && this.peek(-1).type === 'ident' && this.peek(-1).value === 'v') {
            // already consumed by caller
        } else {
            // We might have consumed an ident that wasn't 'v'. Rewind if so.
            const p = this.peek();
            if (p.type === 'number') {
                // permissive: allow number number number
            } else {
                // ensure we didn't accidentally consume something else
            }
        }

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

    parseView(scene) {
        // assume 'view' identifier already consumed
        // optional name string
        if (this.peek().type === 'string') this.next();
        // optional material_index / texture_index / texture_mode
        let material_index = null;
        let texture_index = null;
        while (this.peek().type === 'ident') {
            const k = this.peek().value.toLowerCase();
            if (k === 'material_index') {
                this.next();
                const n = this.expect('number').value; material_index = n; continue;
            }
            if (k === 'texture_index') {
                this.next();
                const n = this.expect('number').value; texture_index = n; continue;
            }
            if (k === 'texture_mode') { this.next(); this.next(); continue; }
            break;
        }

        // expect block
        if (this.peek().type === '{') {
            this.next();
            while (this.peek().type !== '}' && this.peek().type !== 'EOF') {
                const t = this.peek();
                if (t.type === 'ident') {
                    const id = this.next().value;
                    if (id.toUpperCase() === 'RBOX') { this.parseRBox(scene); continue; }
                    // unknown view-level token: if block, skip; else skip a single value
                    if (this.peek().type === '{') { this.skipBlock(true, scene); continue; }
                    this.skipValue();
                    this.accept(';');
                } else if (t.type === '{') { this.skipBlock(true, scene); }
                else this.next();
            }
            this.accept('}');
        } else {
            // single-line view containing a primitive: e.g., view RBOX v ...
            if (this.peek().type === 'ident' && this.peek().value.toUpperCase() === 'RBOX') {
                this.next(); this.parseRBox(scene);
            }
        }
    }

    // Top-level: handle known keywords, otherwise skip unknown blocks or tokens
    parseTopLevel(scene) {
        while (this.peek().type !== 'EOF') {
            const t = this.peek();
            if (t.type === 'ident') {
                const kw = t.value;
                // consume the identifier
                this.next();
                if (kw.toLowerCase() === 'world') {
                    try { this.parseWorld(scene); } catch (e) { console.warn('world parse error:', e.message); this.skipBlock(true, scene); }
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
        console.error('parseVrIntoScene: fatal parse error', e && e.message);
    }
    console.log('parseVrIntoScene: boxes parsed =', theScene.boxes.length);
    return theScene;
}
