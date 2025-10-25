// Minimal WebGL .vr viewer
// Supports: world { background R G B; start v x y z } and view { RBOX v x0 y0 z0 v x1 y1 z1 }

import { emtpyScene, parseVrIntoScene } from './vrparser.js';
import { Mat4, degToRad } from './mat4.js';
import { initGL as createGL, createProgram, enableDepth, setViewportIfNeeded } from './gl.js';
import { createCube, uploadMeshToGPU } from './geometry.js';

(function () {
    const canvas    = document.getElementById('glcanvas');
    const fileInput = document.getElementById('fileInput');

    // Resize canvas to fill
    function resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth * dpr | 0;
        const h = canvas.clientHeight * dpr | 0;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w; canvas.height = h;
            if (gl) gl.viewport(0, 0, w, h);
        }
    }

    // Mat4 utilities have been moved to ./mat4.js

    // WebGL setup
    let gl = null;
    let prog = null;
    let attribs = {}, uniforms = {};

    function initGL() {
        try {
            gl = createGL(canvas, { antialias: true });
        } catch (err) {
            alert('WebGL not available');
            console.error('initGL failed', err);
            return;
        }
        const vs = `attribute vec3 aPosition;attribute vec3 aNormal;uniform mat4 uModel;uniform mat4 uViewProj;varying vec3 vNormal;varying vec3 vPos;void main(){vNormal = mat3(uModel)*aNormal; vPos=(uModel*vec4(aPosition,1.0)).xyz; gl_Position = uViewProj * uModel * vec4(aPosition,1.0);} `;
        const fs = `precision mediump float;varying vec3 vNormal;varying vec3 vPos;uniform vec3 uColor;uniform vec3 uLightDir;void main(){vec3 N = normalize(vNormal); float d = max(dot(N, -uLightDir), 0.0); vec3 base = uColor * 0.6 + 0.4*uColor*d; gl_FragColor = vec4(base,1.0);} `;
        prog = createProgram(gl, vs, fs);
        attribs.aPosition = gl.getAttribLocation(prog, 'aPosition');
        attribs.aNormal = gl.getAttribLocation(prog, 'aNormal');
        uniforms.uModel = gl.getUniformLocation(prog, 'uModel');
        uniforms.uViewProj = gl.getUniformLocation(prog, 'uViewProj');
        uniforms.uColor = gl.getUniformLocation(prog, 'uColor');
        uniforms.uLightDir = gl.getUniformLocation(prog, 'uLightDir');
        enableDepth(gl);
        // Debug info
        console.log('initGL: attribs', { aPosition: attribs.aPosition, aNormal: attribs.aNormal });
        console.log('initGL: uniforms', { uModel: !!uniforms.uModel, uViewProj: !!uniforms.uViewProj, uColor: !!uniforms.uColor, uLightDir: !!uniforms.uLightDir });
    }

    let vboPos = null, vboNorm = null, ibo = null;

    function uploadGeometry() {
        const mesh = createCube();
        const gpu = uploadMeshToGPU(gl, mesh);
        vboPos = gpu.vboPos; vboNorm = gpu.vboNorm; ibo = gpu.ibo;
        // Log buffer sizes (if available)
        try {
            gl.bindBuffer(gl.ARRAY_BUFFER, vboPos); const posBytes = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
            gl.bindBuffer(gl.ARRAY_BUFFER, vboNorm); const normBytes = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); const idxBytes = gl.getBufferParameter(gl.ELEMENT_ARRAY_BUFFER, gl.BUFFER_SIZE);
            console.log('uploadGeometry: buffers', { posBytes, normBytes, idxBytes });
        } catch (e) {
            // getBufferParameter may fail in some contexts; ignore
            console.log('uploadGeometry: buffers uploaded');
        }
    }

    // Scene: boxes and world settings (from parser module)
    let scene = emtpyScene();

    // Camera
    const cam = { pos: [0, 0, 3], yaw: 0, pitch: 0 };
    const keys = {};
    let dragging = false, lastMouse = [0, 0];
    let isPointerLocked = false;

    function onPointerMove(e) {
        const dx = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
        const dy = e.movementY || e.mozMovementY || e.webkitMovementY || 0;
        const sensitivity = 0.0025;
        // moving mouse right should increase yaw (turn right)
        cam.yaw += dx * sensitivity;
        cam.pitch -= dy * sensitivity;
        cam.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, cam.pitch));
    }

    // Bind keyboard and mouse controls
    function bindControls() {

        window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
        window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

        // Pointer lock (mouselook) when available. Click the canvas to lock the pointer.
        const plSupported = !!(canvas.requestPointerLock || canvas.mozRequestPointerLock || canvas.webkitRequestPointerLock);
        if (plSupported) {
            canvas.style.cursor = 'crosshair';
            canvas.addEventListener('click', () => {
                try {
                    canvas.requestPointerLock();
                } catch (e) {
                    console.warn('pointer lock request failed', e);
                }
            });

            document.addEventListener('pointerlockchange', () => {
                const pl = document.pointerLockElement === canvas;
                isPointerLocked = pl;
                if (pl) {
                    document.addEventListener('mousemove', onPointerMove);
                    canvas.style.cursor = 'none';
                } else {
                    document.removeEventListener('mousemove', onPointerMove);
                    canvas.style.cursor = 'crosshair';
                }
            });

            // vendor-prefixed events
            document.addEventListener('mozpointerlockchange', () => {
                const pl = document.mozPointerLockElement === canvas; isPointerLocked = pl;
            });
            document.addEventListener('webkitpointerlockchange', () => {
                const pl = document.webkitPointerLockElement === canvas; isPointerLocked = pl;
            });

        } else {            
            // Fallback: click-and-drag behaviour
            canvas.addEventListener('mousedown', e => {
                dragging = true;
                lastMouse = [e.clientX, e.clientY];
                canvas.style.cursor = 'grabbing';
            });
            window.addEventListener('mouseup', e => {
                dragging = false;
                canvas.style.cursor = 'default';
            });
            window.addEventListener('mousemove', e => {
                if (!dragging) return;
                const dx = (e.clientX - lastMouse[0]);
                const dy = (e.clientY - lastMouse[1]);
                lastMouse = [e.clientX, e.clientY];
                cam.yaw += dx * 0.0025;
                cam.pitch -= dy * 0.0025;
                cam.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, cam.pitch));
            });
        }
    }

    // Update camera position based on keys pressed and time delta
    function updateCamera(dt) {
        const speed = 3.0; // m/s
        let forward = 0, right = 0, up = 0;

        if (keys['w']) forward += 1;
        if (keys['s']) forward -= 1;

        if (keys['a']) right -= 1;
        if (keys['d']) right += 1;

        if (keys['q']) up -= 1;
        if (keys['e']) up += 1;

        const len = Math.hypot(forward, right) || 1;
        forward /= len;
        right /= len;

        const yaw = cam.yaw;

        cam.pos[0] += ((Math.sin(yaw) * forward) + (Math.cos(yaw) * right)) * speed * dt;
        cam.pos[1] += up * speed * dt;
        cam.pos[2] += ((Math.cos(yaw) * -forward) + (Math.sin(yaw) * right)) * speed * dt;
    }

    // Render loop
    let lastT = 0;
    function frame(t) {
        resize();
        const dt = Math.min(0.1, (t - lastT) / 1000 || 0); lastT = t;
        updateCamera(dt);

        gl.clearColor(scene.world.background[0], scene.world.background[1], scene.world.background[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(prog);
        gl.uniform3fv(uniforms.uLightDir, new Float32Array([0.5, 0.7, 0.4]));

        const aspect = canvas.width / canvas.height;
        const proj = Mat4.perspective(60 * Math.PI / 180, aspect, 0.1, 1000);

        // compute forward direction (camera looks towards -Z in world when yaw=0)
        const dirX = Math.cos(cam.pitch) * Math.sin(cam.yaw);
        const dirY = Math.sin(cam.pitch);
        const dirZ = -Math.cos(cam.pitch) * Math.cos(cam.yaw);
        const center = [cam.pos[0] + dirX, cam.pos[1] + dirY, cam.pos[2] + dirZ];
        const view = Mat4.lookAt(cam.pos, center, [0, 1, 0]);
        const viewProj = Mat4.multiply(proj, view);
        gl.uniformMatrix4fv(uniforms.uViewProj, false, viewProj);

        // bind geometry
        gl.bindBuffer(gl.ARRAY_BUFFER, vboPos); gl.enableVertexAttribArray(attribs.aPosition); gl.vertexAttribPointer(attribs.aPosition, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, vboNorm); gl.enableVertexAttribArray(attribs.aNormal); gl.vertexAttribPointer(attribs.aNormal, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);

        for (const b of scene.boxes) {
            // model matrix: scale then translate
            let M = Mat4.identity();
            M = Mat4.translate(M, b.center);
            // apply scale by multiplying columns (cheap hack)
            const sx = b.size[0], sy = b.size[1], sz = b.size[2];
            M[0] *= sx; M[1] *= sx; M[2] *= sx; M[4] *= sy; M[5] *= sy; M[6] *= sy; M[8] *= sz; M[9] *= sz; M[10] *= sz;
            gl.uniformMatrix4fv(uniforms.uModel, false, M);
            gl.uniform3fv(uniforms.uColor, new Float32Array(b.color));
            gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
        }

        requestAnimationFrame(frame);
    }

    // File handling
    fileInput.addEventListener('change', e => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = ev => {
            scene = parseVrIntoScene(emtpyScene(), ev.target.result);
            cam.pos = scene.world.start.slice();
        };
        reader.readAsText(f);
    });

    // Initialize and start render loop
    function startup() {
        initGL();
        uploadGeometry();
        bindControls();
        resize();
        cam.pos = scene.world.start.slice();
        requestAnimationFrame(frame);
    }

    window.addEventListener('resize', resize);
    startup();

    // Try to auto-load the sample when served over HTTP so the scene appears immediately
    // if(window.location.protocol.startsWith('http')){
    //   fetch('samples/simple.vr').then(r=>r.text()).then(t=>{ parseVR(t); cam.pos = scene.world.start.slice(); }).catch(err=>{ console.warn('Auto-load sample failed:', err); });
    // }

    // expose parse for dev
    // window.__vr_parse = parseVR;
})();
