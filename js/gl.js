// WebGL helper utilities
// Lightweight wrappers for context creation, shader/program compilation and buffer creation.

export function initGL(canvas, options = { antialias: true }) {
    if (!canvas) throw new Error('No canvas element provided to initGL');
    const contextNames = ['webgl2', 'webgl', 'experimental-webgl'];
    let gl = null;
    const tried = [];
    for (const name of contextNames) {
        try {
            gl = canvas.getContext(name, options);
        } catch (e) {
            // ignore
        }
        tried.push(name);
        if (gl) {
            console.log(`initGL: created context '${name}'`);
            break;
        }
    }
    if (!gl) {
        const msg = `No WebGL context available. Tried: ${tried.join(', ')}. ` +
            'Check your browser GPU settings, try enabling hardware acceleration, or visit chrome://gpu for diagnostics.';
        throw new Error(msg);
    }
    return gl;
}

export function createShader(gl, src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const msg = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error(msg);
    }
    return s;
}

export function createProgram(gl, vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, createShader(gl, vsSrc, gl.VERTEX_SHADER));
    gl.attachShader(p, createShader(gl, fsSrc, gl.FRAGMENT_SHADER));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const msg = gl.getProgramInfoLog(p);
        gl.deleteProgram(p);
        throw new Error(msg);
    }
    return p;
}

export function createBuffer(gl, data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) {
    const buf = gl.createBuffer();
    gl.bindBuffer(target, buf);
    gl.bufferData(target, data, usage);
    return buf;
}

export function setViewportIfNeeded(gl, w, h) {
    const vp = gl.getParameter(gl.VIEWPORT);
    if (!vp || vp[2] !== w || vp[3] !== h) {
        gl.viewport(0, 0, w, h);
    }
}

export function enableDepth(gl) {
    gl.enable(gl.DEPTH_TEST);
}
