// Minimal WebGL .vr viewer

import { emtpyScene, parseVrIntoScene } from './vrparser.js';
import { Mat4, degToRad } from './mat4.js';
import { initGL as createGL, createProgram, enableDepth, setViewportIfNeeded, createBuffer } from './gl.js';
import { createCube, createCylinder, createSphere, uploadMeshToGPU } from './geometry.js';

(function () {
    const canvas = document.getElementById('glcanvas');
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

    // WebGL setup
    let gl = null;
    let prog = null;
    let attribs = {}, uniforms = {};
    let defaultTexture = null;

    function initGL() {
        try {
            gl = createGL(canvas, { antialias: true });
        } catch (err) {
            alert('WebGL not available');
            console.error('initGL failed', err);
            return;
        }
        const vs = `attribute vec3 aPosition;attribute vec3 aNormal;attribute vec2 aTexCoord;uniform mat4 uModel;uniform mat4 uViewProj;varying vec3 vNormal;varying vec3 vPos;varying vec2 vTexCoord;void main(){vNormal = mat3(uModel)*aNormal; vPos=(uModel*vec4(aPosition,1.0)).xyz; vTexCoord = aTexCoord; gl_Position = uViewProj * uModel * vec4(aPosition,1.0);} `;
        const fs = `precision mediump float;varying vec3 vNormal;varying vec3 vPos;varying vec2 vTexCoord;uniform vec3 uColor;uniform vec3 uAmbient;uniform vec3 uEmission;uniform vec3 uSpecular;uniform float uSpecPower;uniform float uTransparency;uniform vec3 uLightDir;uniform sampler2D uTexture;uniform int uUseTexture;void main(){
    vec3 N = normalize(vNormal);
    vec3 L = normalize(-uLightDir);
    vec3 V = normalize(-vPos);
    float diff = max(dot(N, L), 0.0);
    vec3 diffuse = uColor * diff;
    vec3 ambient = uAmbient;
    vec3 emission = uEmission;
    vec3 specular = vec3(0.0);
    if(uSpecPower > 0.0 && diff > 0.0){
        vec3 R = reflect(-L, N);
        float s = pow(max(dot(R, V), 0.0), uSpecPower);
        specular = uSpecular * s;
    }
    vec3 base = ambient + diffuse + specular;
    if(uUseTexture==1){
        vec4 t = texture2D(uTexture, vTexCoord);
        base *= t.rgb;
    }
    // Add emission as additive (not affected by lighting)
    vec3 finalCol = base + emission;
    float alpha = 1.0 - clamp(uTransparency, 0.0, 1.0);
    gl_FragColor = vec4(finalCol, alpha);
    if(alpha < 1.0) {
        gl_FragColor.rgb = mix(gl_FragColor.rgb, emission, uTransparency);
    }
}`;
    prog = createProgram(gl, vs, fs);
    attribs.aPosition = gl.getAttribLocation(prog, 'aPosition');
    attribs.aNormal = gl.getAttribLocation(prog, 'aNormal');
    attribs.aTexCoord = gl.getAttribLocation(prog, 'aTexCoord');
    uniforms.uModel = gl.getUniformLocation(prog, 'uModel');
    uniforms.uViewProj = gl.getUniformLocation(prog, 'uViewProj');
    uniforms.uColor = gl.getUniformLocation(prog, 'uColor');
    uniforms.uAmbient = gl.getUniformLocation(prog, 'uAmbient');
    uniforms.uEmission = gl.getUniformLocation(prog, 'uEmission');
    uniforms.uSpecular = gl.getUniformLocation(prog, 'uSpecular');
    uniforms.uSpecPower = gl.getUniformLocation(prog, 'uSpecPower');
    uniforms.uTransparency = gl.getUniformLocation(prog, 'uTransparency');
    uniforms.uLightDir = gl.getUniformLocation(prog, 'uLightDir');
    uniforms.uTexture = gl.getUniformLocation(prog, 'uTexture');
    uniforms.uUseTexture = gl.getUniformLocation(prog, 'uUseTexture');
    // Enable blending for transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        enableDepth(gl);
        // Debug info
        console.log('initGL: attribs', { aPosition: attribs.aPosition, aNormal: attribs.aNormal });
        console.log('initGL: uniforms', { uModel: !!uniforms.uModel, uViewProj: !!uniforms.uViewProj, uColor: !!uniforms.uColor, uLightDir: !!uniforms.uLightDir });
        // create a default 1x1 white texture to use as a graceful fallback
        try {
            defaultTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, defaultTexture);
            const white = new Uint8Array([255, 255, 255, 255]);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, white);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.bindTexture(gl.TEXTURE_2D, null);
        } catch (e) {
            console.warn('initGL: default texture creation failed', e);
            defaultTexture = null;
        }
    }

    let vboPos = null, vboNorm = null, ibo = null;
    let cylVboPos = null, cylVboNorm = null, cylIbo = null, cylIndexCount = 0;
    // dynamically loaded meshes from parsed scenes
    let sceneGpuMeshes = [];

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
        // upload cylinder mesh
        try {
            const cyl = createCylinder(36);
            const cg = uploadMeshToGPU(gl, cyl);
            cylVboPos = cg.vboPos; cylVboNorm = cg.vboNorm; cylIbo = cg.ibo; cylIndexCount = cg.indexCount;
            console.log('uploadGeometry: cylinder uploaded, indices=', cylIndexCount);
        } catch (e) {
            console.warn('uploadGeometry: cylinder upload failed', e);
        }
    }

    function computeNormals(positions, indices) {
        const nverts = positions.length / 3;
        const normals = new Float32Array(nverts * 3);
        for (let i = 0; i < indices.length; i += 3) {
            const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
            const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
            const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
            const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
            const ux = bx - ax, uy = by - ay, uz = bz - az;
            const vx = cx - ax, vy = cy - ay, vz = cz - az;
            // cross u x v
            const nx = uy * vz - uz * vy;
            const ny = uz * vx - ux * vz;
            const nz = ux * vy - uy * vx;
            // accumulate
            normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
            normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
            normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
        }
        // normalize
        for (let i = 0; i < nverts; i++) {
            const ix = i * 3, iy = ix + 1, iz = ix + 2;
            const nx = normals[ix], ny = normals[iy], nz = normals[iz];
            const l = Math.hypot(nx, ny, nz) || 1.0;
            normals[ix] = nx / l; normals[iy] = ny / l; normals[iz] = nz / l;
        }
        return normals;
    }

    function disposeSceneGpu() {
        try {
            for (const g of sceneGpuMeshes) {
                if (g.vboPos) gl.deleteBuffer(g.vboPos);
                if (g.vboNorm) gl.deleteBuffer(g.vboNorm);
                if (g.ibo) gl.deleteBuffer(g.ibo);
            }
        } catch (e) { /* ignore */ }
        sceneGpuMeshes = [];
    }

    function uploadSceneMeshes(scene) {
        if (!gl) return;
        disposeSceneGpu();
        sceneGpuMeshes = [];
        if (!scene.objects) return;
        
        // Helper to recursively process objects and their children
        function processObject(obj, parentTransform) {
            // Compute this object's local transform
            let localTransform = Mat4.identity();
            if (obj.transforms && obj.transforms.length > 0) {
                for (const t of obj.transforms) {
                    if (t.type === 'translation') {
                        localTransform = Mat4.translate(localTransform, t.value);
                    } else if (t.type === 'eulerxyz') {
                        localTransform = Mat4.eulerXYZ(localTransform, t.value);
                    } else if (t.type === 'fixedxyz') {
                        localTransform = Mat4.fixedXYZ(localTransform, t.value);
                    } else if (t.type === 'rotation') {
                        // rotation is 3 basis vectors (rows of rotation matrix)
                        const basis = Mat4.fromBasis(t.value[0], t.value[1], t.value[2]);
                        localTransform = Mat4.multiply(localTransform, basis);
                    }
                }
            }
            
            // Compute world transform by combining with parent
            const worldTransform = parentTransform ? Mat4.multiply(parentTransform, localTransform) : localTransform;
            
            // Process views in this object
            if (obj.views) {
                for (const view of obj.views) {
                    if (view.type === 'mesh') {
                        const positions = (view.positions instanceof Float32Array) ? view.positions : new Float32Array(view.positions || []);
                        const indices = (view.indices instanceof Uint16Array || view.indices instanceof Uint32Array) ? view.indices : new Uint16Array(view.indices || []);

                        // basic validation
                        if (positions.length % 3 !== 0) { console.warn('uploadSceneMeshes: positions length not multiple of 3, skipping mesh'); continue; }
                        if (indices.length === 0) { console.warn('uploadSceneMeshes: empty indices, skipping mesh'); continue; }
                        if (indices.length % 3 !== 0) { console.warn('uploadSceneMeshes: indices length not a multiple of 3 (not triangles)'); }

                        // normals: prefer provided, else compute. If provided but wrong size, recompute.
                        let normalsArr = null;
                        if (view.normals && view.normals.length > 0) {
                            if (view.normals.length === positions.length) {
                                normalsArr = (view.normals instanceof Float32Array) ? view.normals : new Float32Array(view.normals);
                            } else {
                                console.warn('uploadSceneMeshes: provided normals length mismatch, recomputing normals');
                                normalsArr = computeNormals(positions, indices);
                            }
                        } else {
                            normalsArr = computeNormals(positions, indices);
                        }

                        // texcoords: validate size (2 floats per vertex). If mismatch, ignore.
                        let texcoordsArr = null;
                        if (view.texcoords && view.texcoords.length > 0) {
                            const expected = (positions.length / 3) * 2;
                            if (view.texcoords.length === expected) {
                                texcoordsArr = (view.texcoords instanceof Float32Array) ? view.texcoords : new Float32Array(view.texcoords);
                            } else {
                                console.warn('uploadSceneMeshes: texcoords length mismatch (got', view.texcoords.length, 'expected', expected, '), ignoring texcoords');
                            }
                        }

                        const gpu = uploadMeshToGPU(gl, { positions, normals: normalsArr, indices });
                        // attach texcoord buffer if present
                        if (texcoordsArr) { gpu.vboTex = createBuffer(gl, texcoordsArr, gl.ARRAY_BUFFER, gl.STATIC_DRAW); gpu.hasTexcoords = true; }
                        gpu.indexCount = indices.length;

                        // if view.texture is a string, start loading the image and create GL texture when loaded
                        const item = { kind: 'mesh', gpu, material: view.material || null, texturePath: view.texture || null, transform: worldTransform };
                        if (item.texturePath) {
                            const img = new Image();
                            img.crossOrigin = '';
                            img.onload = () => {
                                try {
                                    const tex = gl.createTexture();
                                    gl.bindTexture(gl.TEXTURE_2D, tex);
                                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
                                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                                    gl.generateMipmap(gl.TEXTURE_2D);
                                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                                    item.gpu.texture = tex;
                                } catch (e) { console.warn('texture creation failed for', item.texturePath, e); }
                            };
                            img.onerror = () => { console.warn('Failed to load texture:', item.texturePath); };
                            // resolve relative paths against current location
                            try { img.src = view.texture; } catch (e) { console.warn('setting texture src failed', e); }
                        }
                        sceneGpuMeshes.push(item);
                    } else if (view.type === 'lines') {
                        const positions = new Float32Array(view.positions);
                        const indices = new Uint16Array(view.indices);
                        // create empty normals (copy position as dummy)
                        const normals = new Float32Array(positions.length);
                        const vboPos = createBuffer(gl, positions, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
                        const vboNorm = createBuffer(gl, normals, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
                        const ibo = createBuffer(gl, indices, gl.ELEMENT_ARRAY_BUFFER, gl.STATIC_DRAW);
                        sceneGpuMeshes.push({ kind: 'lines', vboPos, vboNorm, ibo, indexCount: indices.length, material: view.material || null, transform: worldTransform });
                    } else if (view.type === 'sphere') {
                        // tessellate a unit sphere and scale in model matrix when drawing
                        const sph = createSphere(16, 16);
                        const gpu = uploadMeshToGPU(gl, sph);
                        gpu.indexCount = sph.indices.length;
                        sceneGpuMeshes.push({ kind: 'sphere', gpu, rx: view.rx, ry: view.ry, rz: view.rz, material: view.material || null, transform: worldTransform });
                    } else if (view.type === 'rbox') {
                        // Store rbox views as items to be drawn using the cube geometry
                        sceneGpuMeshes.push({ kind: 'rbox', center: view.center, size: view.size, material: view.material || null, transform: worldTransform });
                    } else if (view.type === 'cylinder') {
                        // Store cylinder views
                        sceneGpuMeshes.push({ kind: 'cylinder', center: view.center, rx: view.rx, ry: view.ry, height: view.height, material: view.material || null, transform: worldTransform });
                    }
                }
            }
            
            // Recursively process children
            if (obj.children && obj.children.length > 0) {
                for (const child of obj.children) {
                    processObject(child, worldTransform);
                }
            }
        }
        
        // Traverse all top-level objects
        for (const obj of scene.objects) {
            processObject(obj, null);
        }
        
        console.log('uploadSceneMeshes: uploaded', sceneGpuMeshes.length, 'views');
    }

    // Scene: boxes and world settings (from parser module)
    let scene = emtpyScene();

    // Camera
    // Camera: add 1.8m Y offset to simulate eye height above ground
    const cam = { pos: [0, 1.8, 3], yaw: 0, pitch: 0 };
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

        // draw scene objects and their views
        if (sceneGpuMeshes.length > 0) {
            for (const item of sceneGpuMeshes) {
                // Helper: get material property or fallback
                function matProp(mat, key, fallback) {
                    return (mat && mat[key] !== undefined) ? mat[key] : fallback;
                }
                if (item.kind === 'rbox') {
                    gl.bindBuffer(gl.ARRAY_BUFFER, vboPos); gl.enableVertexAttribArray(attribs.aPosition); gl.vertexAttribPointer(attribs.aPosition, 3, gl.FLOAT, false, 0, 0);
                    gl.bindBuffer(gl.ARRAY_BUFFER, vboNorm); gl.enableVertexAttribArray(attribs.aNormal); gl.vertexAttribPointer(attribs.aNormal, 3, gl.FLOAT, false, 0, 0);
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
                    let M = item.transform || Mat4.identity();
                    M = Mat4.translate(M, item.center);
                    const sx = item.size[0], sy = item.size[1], sz = item.size[2];
                    M[0] *= sx; M[1] *= sx; M[2] *= sx; M[4] *= sy; M[5] *= sy; M[6] *= sy; M[8] *= sz; M[9] *= sz; M[10] *= sz;
                    gl.uniformMatrix4fv(uniforms.uModel, false, M);
                    gl.uniform3fv(uniforms.uColor, new Float32Array(matProp(item.material, 'diffuse', [0.5,0.5,0.5])));
                    gl.uniform3fv(uniforms.uAmbient, new Float32Array(matProp(item.material, 'ambient', [0.0,0.0,0.0])));
                    gl.uniform3fv(uniforms.uEmission, new Float32Array(matProp(item.material, 'emission', [0.0,0.0,0.0])));
                    gl.uniform3fv(uniforms.uSpecular, new Float32Array(matProp(item.material, 'specular', [0.0,0.0,0.0])));
                    // Map spec_power from [0,1] to [1,128] for shader
                    let sp = matProp(item.material, 'spec_power', 0.0);
                    sp = Math.max(0.0, Math.min(1.0, sp));
                    sp = 1.0 + sp * 127.0;
                    gl.uniform1f(uniforms.uSpecPower, sp);
                    gl.uniform1f(uniforms.uTransparency, matProp(item.material, 'transparency', 0.0));
                    gl.uniform1i(uniforms.uUseTexture, 0);
                    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
                } else if (item.kind === 'cylinder') {
                    if (cylIbo) {
                        gl.bindBuffer(gl.ARRAY_BUFFER, cylVboPos); gl.enableVertexAttribArray(attribs.aPosition); gl.vertexAttribPointer(attribs.aPosition, 3, gl.FLOAT, false, 0, 0);
                        gl.bindBuffer(gl.ARRAY_BUFFER, cylVboNorm); gl.enableVertexAttribArray(attribs.aNormal); gl.vertexAttribPointer(attribs.aNormal, 3, gl.FLOAT, false, 0, 0);
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cylIbo);
                        let M = item.transform || Mat4.identity();
                        M = Mat4.translate(M, item.center);
                        const sx = item.rx * 2; const sy = item.height; const sz = item.ry * 2;
                        M[0] *= sx; M[1] *= sx; M[2] *= sx; M[4] *= sy; M[5] *= sy; M[6] *= sy; M[8] *= sz; M[9] *= sz; M[10] *= sz;
                        gl.uniformMatrix4fv(uniforms.uModel, false, M);
                        gl.uniform3fv(uniforms.uColor, new Float32Array(matProp(item.material, 'diffuse', [0.5,0.5,0.5])));
                        gl.uniform3fv(uniforms.uAmbient, new Float32Array(matProp(item.material, 'ambient', [0.0,0.0,0.0])));
                        gl.uniform3fv(uniforms.uEmission, new Float32Array(matProp(item.material, 'emission', [0.0,0.0,0.0])));
                        gl.uniform3fv(uniforms.uSpecular, new Float32Array(matProp(item.material, 'specular', [0.0,0.0,0.0])));
                        let sp = matProp(item.material, 'spec_power', 0.0);
                        sp = Math.max(0.0, Math.min(1.0, sp));
                        sp = 1.0 + sp * 127.0;
                        gl.uniform1f(uniforms.uSpecPower, sp);
                        gl.uniform1f(uniforms.uTransparency, matProp(item.material, 'transparency', 0.0));
                        gl.uniform1i(uniforms.uUseTexture, 0);
                        gl.drawElements(gl.TRIANGLES, cylIndexCount, gl.UNSIGNED_SHORT, 0);
                    }
                } else if (item.kind === 'mesh') {
                    const gpu = item.gpu;
                    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.vboPos); gl.enableVertexAttribArray(attribs.aPosition); gl.vertexAttribPointer(attribs.aPosition, 3, gl.FLOAT, false, 0, 0);
                    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.vboNorm); gl.enableVertexAttribArray(attribs.aNormal); gl.vertexAttribPointer(attribs.aNormal, 3, gl.FLOAT, false, 0, 0);
                    if (gpu.vboTex && attribs.aTexCoord >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, gpu.vboTex); gl.enableVertexAttribArray(attribs.aTexCoord); gl.vertexAttribPointer(attribs.aTexCoord, 2, gl.FLOAT, false, 0, 0); }
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.ibo);
                    gl.uniformMatrix4fv(uniforms.uModel, false, item.transform || Mat4.identity());
                    gl.uniform3fv(uniforms.uColor, new Float32Array(matProp(item.material, 'diffuse', [0.8,0.8,0.8])));
                    gl.uniform3fv(uniforms.uAmbient, new Float32Array(matProp(item.material, 'ambient', [0.0,0.0,0.0])));
                    gl.uniform3fv(uniforms.uEmission, new Float32Array(matProp(item.material, 'emission', [0.0,0.0,0.0])));
                    gl.uniform3fv(uniforms.uSpecular, new Float32Array(matProp(item.material, 'specular', [0.0,0.0,0.0])));
                    let sp = matProp(item.material, 'spec_power', 0.0);
                    sp = Math.max(0.0, Math.min(1.0, sp));
                    sp = 1.0 + sp * 127.0;
                    gl.uniform1f(uniforms.uSpecPower, sp);
                    gl.uniform1f(uniforms.uTransparency, matProp(item.material, 'transparency', 0.0));
                    gl.activeTexture(gl.TEXTURE0);
                    if (gpu.texture) {
                        gl.bindTexture(gl.TEXTURE_2D, gpu.texture);
                    } else if (defaultTexture) {
                        gl.bindTexture(gl.TEXTURE_2D, defaultTexture);
                    } else {
                        gl.bindTexture(gl.TEXTURE_2D, null);
                    }
                    gl.uniform1i(uniforms.uTexture, 0);
                    gl.uniform1i(uniforms.uUseTexture, 1);
                    if (!(gpu.vboTex && attribs.aTexCoord >= 0) && attribs.aTexCoord >= 0) {
                        gl.disableVertexAttribArray(attribs.aTexCoord);
                        gl.vertexAttrib2f(attribs.aTexCoord, 0.0, 0.0);
                    }
                    gl.drawElements(gl.TRIANGLES, gpu.indexCount, gl.UNSIGNED_SHORT, 0);
                    if (gpu.vboTex && attribs.aTexCoord >= 0) { gl.disableVertexAttribArray(attribs.aTexCoord); }
                } else if (item.kind === 'lines') {
                    gl.bindBuffer(gl.ARRAY_BUFFER, item.vboPos); gl.enableVertexAttribArray(attribs.aPosition); gl.vertexAttribPointer(attribs.aPosition, 3, gl.FLOAT, false, 0, 0);
                    gl.bindBuffer(gl.ARRAY_BUFFER, item.vboNorm); gl.enableVertexAttribArray(attribs.aNormal); gl.vertexAttribPointer(attribs.aNormal, 3, gl.FLOAT, false, 0, 0);
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, item.ibo);
                    gl.uniformMatrix4fv(uniforms.uModel, false, item.transform || Mat4.identity());
                    gl.uniform3fv(uniforms.uColor, new Float32Array(matProp(item.material, 'diffuse', [1.0,0.5,0.0])));
                    gl.uniform3fv(uniforms.uAmbient, new Float32Array(matProp(item.material, 'ambient', [0.0,0.0,0.0])));
                    gl.uniform3fv(uniforms.uEmission, new Float32Array(matProp(item.material, 'emission', [0.0,0.0,0.0])));
                    gl.uniform3fv(uniforms.uSpecular, new Float32Array(matProp(item.material, 'specular', [0.0,0.0,0.0])));
                    let sp = matProp(item.material, 'spec_power', 0.0);
                    sp = Math.max(0.0, Math.min(1.0, sp));
                    sp = 1.0 + sp * 127.0;
                    gl.uniform1f(uniforms.uSpecPower, sp);
                    gl.uniform1f(uniforms.uTransparency, matProp(item.material, 'transparency', 0.0));
                    gl.uniform1i(uniforms.uUseTexture, 0);
                    gl.drawElements(gl.LINES, item.indexCount, gl.UNSIGNED_SHORT, 0);
                } else if (item.kind === 'sphere') {
                    const gpu = item.gpu;
                    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.vboPos); gl.enableVertexAttribArray(attribs.aPosition); gl.vertexAttribPointer(attribs.aPosition, 3, gl.FLOAT, false, 0, 0);
                    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.vboNorm); gl.enableVertexAttribArray(attribs.aNormal); gl.vertexAttribPointer(attribs.aNormal, 3, gl.FLOAT, false, 0, 0);
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.ibo);
                    let M = item.transform || Mat4.identity();
                    const scaleM = new Float32Array([
                        item.rx * 2, 0, 0, 0,
                        0, item.ry * 2, 0, 0,
                        0, 0, item.rz * 2, 0,
                        0, 0, 0, 1
                    ]);
                    M = Mat4.multiply(M, scaleM);
                    gl.uniformMatrix4fv(uniforms.uModel, false, M);
                    gl.uniform3fv(uniforms.uColor, new Float32Array(matProp(item.material, 'diffuse', [0.6,0.9,0.6])));
                    gl.uniform3fv(uniforms.uAmbient, new Float32Array(matProp(item.material, 'ambient', [0.0,0.0,0.0])));
                    gl.uniform3fv(uniforms.uEmission, new Float32Array(matProp(item.material, 'emission', [0.0,0.0,0.0])));
                    gl.uniform3fv(uniforms.uSpecular, new Float32Array(matProp(item.material, 'specular', [0.0,0.0,0.0])));
                    let sp = matProp(item.material, 'spec_power', 0.0);
                    sp = Math.max(0.0, Math.min(1.0, sp));
                    sp = 1.0 + sp * 127.0;
                    gl.uniform1f(uniforms.uSpecPower, sp);
                    gl.uniform1f(uniforms.uTransparency, matProp(item.material, 'transparency', 0.0));
                    gl.uniform1i(uniforms.uUseTexture, 0);
                    gl.drawElements(gl.TRIANGLES, gpu.indexCount, gl.UNSIGNED_SHORT, 0);
                }
            }
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
            // Add 1.8m Y offset to camera position for eye height
            if (cam.pos.length >= 2) cam.pos[1] += 1.8;
            // upload meshes parsed from the scene into GPU buffers
            try { uploadSceneMeshes(scene); } catch (e) { console.warn('uploadSceneMeshes failed', e); }
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
        // Add 1.8m Y offset to camera position for eye height
        if (cam.pos.length >= 2) cam.pos[1] += 1.8;
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
