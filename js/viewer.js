// Minimal WebGL .vr viewer

import { parseVrIntoScene } from './vrparser.js';
import { Mat4, degToRad } from './mat4.js';
import { initGL as createGL, createProgram, enableDepth, setViewportIfNeeded, createBuffer } from './gl.js';
import { createCube, createCylinder, createSphere, uploadMeshToGPU } from './geometry.js';

(function () {
    const canvas = document.getElementById('glcanvas');
    const fileInput = document.getElementById('fileInput');
    const urlInput = document.getElementById('urlInput');
    const loadUrlBtn = document.getElementById('loadUrlBtn');
    const gatewaySelect = document.getElementById('gatewaySelect');
    const enterGatewayBtn = document.getElementById('enterGatewayBtn');

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
    // Base URL of currently loaded .vr file, used to resolve relative assets (textures, includes later)
    let sceneBaseUrl = null;

    function initGL() {
        try {
            gl = createGL(canvas, { antialias: true });
        } catch (err) {
            alert('WebGL not available');
            console.error('initGL failed', err);
            return;
        }
        const vs = `attribute vec3 aPosition;attribute vec3 aNormal;attribute vec2 aTexCoord;uniform mat4 uModel;uniform mat4 uViewProj;varying vec3 vNormal;varying vec3 vPos;varying vec2 vTexCoord;void main(){vNormal = mat3(uModel)*aNormal; vPos=(uModel*vec4(aPosition,1.0)).xyz; vTexCoord = aTexCoord; gl_Position = uViewProj * uModel * vec4(aPosition,1.0);} `;
        const fs = `precision mediump float;varying vec3 vNormal;varying vec3 vPos;varying vec2 vTexCoord;uniform vec3 uColor;uniform vec3 uAmbient;uniform vec3 uEmission;uniform vec3 uSpecular;uniform float uSpecPower;uniform float uTransparency;uniform vec3 uLightDir;uniform vec3 uLightPos;uniform vec3 uLightColor;uniform vec3 uWorldAmbient;uniform float uFogIntensity;uniform vec3 uFogColor;uniform vec3 uCameraPos;uniform sampler2D uTexture;uniform int uUseTexture;void main(){
    vec3 N = normalize(vNormal);
    vec3 L;
    // Use light position if provided, otherwise use directional light
    if(length(uLightPos) > 0.0) {
        L = normalize(uLightPos - vPos);
    } else {
        L = normalize(-uLightDir);
    }
    vec3 V = normalize(uCameraPos - vPos);
    float diff = max(dot(N, L), 0.0);
    vec3 diffuse = uColor * diff * uLightColor;
    vec3 ambient = uAmbient * uWorldAmbient;
    vec3 emission = uEmission;
    vec3 specular = vec3(0.0);
    if(uSpecPower > 0.0 && diff > 0.0){
        vec3 R = reflect(-L, N);
        float s = pow(max(dot(R, V), 0.0), uSpecPower);
        specular = uSpecular * s * uLightColor;
    }
    vec3 base = ambient + diffuse + specular;
    if(uUseTexture==1){
        vec4 t = texture2D(uTexture, vTexCoord);
        base *= t.rgb;
    }
    // Add emission as additive (not affected by lighting)
    vec3 finalCol = base + emission;
    
    // Apply fog
    if(uFogIntensity > 0.0) {
        float dist = length(vPos - uCameraPos);
        float fogFactor = 1.0 - exp(-uFogIntensity * dist * 0.1);
        fogFactor = clamp(fogFactor, 0.0, 1.0);
        finalCol = mix(finalCol, uFogColor, fogFactor);
    }
    
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
    uniforms.uLightPos = gl.getUniformLocation(prog, 'uLightPos');
    uniforms.uLightColor = gl.getUniformLocation(prog, 'uLightColor');
    uniforms.uWorldAmbient = gl.getUniformLocation(prog, 'uWorldAmbient');
    uniforms.uFogIntensity = gl.getUniformLocation(prog, 'uFogIntensity');
    uniforms.uFogColor = gl.getUniformLocation(prog, 'uFogColor');
    uniforms.uCameraPos = gl.getUniformLocation(prog, 'uCameraPos');
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
    // Gateway triggers computed from objects with gateway declarations
    let gatewayTriggers = [];
    const gatewayInside = new Set();
    let gatewayCooldownUntil = 0;

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

    function transformPoint(m, p) {
        return [
            p[0] * m[0] + p[1] * m[4] + p[2] * m[8] + m[12],
            p[0] * m[1] + p[1] * m[5] + p[2] * m[9] + m[13],
            p[0] * m[2] + p[1] * m[6] + p[2] * m[10] + m[14]
        ];
    }

    function uploadSceneMeshes(scene) {
        if (!gl) return;
        disposeSceneGpu();
        sceneGpuMeshes = [];
        gatewayTriggers = [];
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
            // Also aggregate simple bounds for gateway triggers
            let aggMin = [ Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY ];
            let aggMax = [ Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY ];
            function addSphereAABB(center, radius) {
                aggMin[0] = Math.min(aggMin[0], center[0] - radius);
                aggMin[1] = Math.min(aggMin[1], center[1] - radius);
                aggMin[2] = Math.min(aggMin[2], center[2] - radius);
                aggMax[0] = Math.max(aggMax[0], center[0] + radius);
                aggMax[1] = Math.max(aggMax[1], center[1] + radius);
                aggMax[2] = Math.max(aggMax[2], center[2] + radius);
            }
            function addPointToAABB(pt) {
                aggMin[0] = Math.min(aggMin[0], pt[0]);
                aggMin[1] = Math.min(aggMin[1], pt[1]);
                aggMin[2] = Math.min(aggMin[2], pt[2]);
                aggMax[0] = Math.max(aggMax[0], pt[0]);
                aggMax[1] = Math.max(aggMax[1], pt[1]);
                aggMax[2] = Math.max(aggMax[2], pt[2]);
            }
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
                            // resolve relative paths against scene base URL if available
                            try {
                                const base = sceneBaseUrl || window.location.href;
                                const u = new URL(item.texturePath, base);
                                // add cache buster to favor latest texture during dev
                                u.searchParams.set('_ts', String(Date.now()));
                                img.src = u.toString();
                            } catch (e) { console.warn('setting texture src failed', e); }
                        }
                        sceneGpuMeshes.push(item);
                        // If this mesh originated from an N_POLY, use its vertices to expand gateway bounds
                        if (view.source === 'N_POLY') {
                            const M = worldTransform;
                            for (let vi = 0; vi < positions.length; vi += 3) {
                                const pt = transformPoint(M, [positions[vi], positions[vi+1], positions[vi+2]]);
                                addPointToAABB(pt);
                            }
                        }
                    } else if (view.type === 'lines') {
                        const positions = new Float32Array(view.positions);
                        const indices = new Uint16Array(view.indices);
                        // create empty normals (copy position as dummy)
                        const normals = new Float32Array(positions.length);
                        const vboPos = createBuffer(gl, positions, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
                        const vboNorm = createBuffer(gl, normals, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
                        const ibo = createBuffer(gl, indices, gl.ELEMENT_ARRAY_BUFFER, gl.STATIC_DRAW);
                        sceneGpuMeshes.push({ kind: 'lines', vboPos, vboNorm, ibo, indexCount: indices.length, material: view.material || null, transform: worldTransform });
                        // Expand gateway bounds with line segment endpoints (treat as thin areas)
                        for (let vi = 0; vi < positions.length; vi += 3) {
                            const pt = transformPoint(worldTransform, [positions[vi], positions[vi+1], positions[vi+2]]);
                            addPointToAABB(pt);
                        }
                    } else if (view.type === 'sphere') {
                        // tessellate a unit sphere and scale in model matrix when drawing
                        const sph = createSphere(16, 16);
                        const gpu = uploadMeshToGPU(gl, sph);
                        gpu.indexCount = sph.indices.length;
                        sceneGpuMeshes.push({ kind: 'sphere', gpu, rx: view.rx, ry: view.ry, rz: view.rz, material: view.material || null, transform: worldTransform });
                    } else if (view.type === 'rbox') {
                        // Store rbox views as items to be drawn using the cube geometry
                        sceneGpuMeshes.push({ kind: 'rbox', center: view.center, size: view.size, material: view.material || null, transform: worldTransform });
                        // Bounds contribution for gateway triggers (transform 8 corners)
                        const hx = view.size[0] * 0.5, hy = view.size[1] * 0.5, hz = view.size[2] * 0.5;
                        const M = Mat4.translate(worldTransform, view.center);
                        const corners = [
                            [ -hx, -hy, -hz ], [ hx, -hy, -hz ], [ hx, hy, -hz ], [ -hx, hy, -hz ],
                            [ -hx, -hy, hz ], [ hx, -hy, hz ], [ hx, hy, hz ], [ -hx, hy, hz ]
                        ];
                        for (const c of corners) addPointToAABB(transformPoint(M, c));
                    } else if (view.type === 'cylinder') {
                        // Store cylinder views
                        sceneGpuMeshes.push({ kind: 'cylinder', center: view.center, rx: view.rx, ry: view.ry, height: view.height, material: view.material || null, transform: worldTransform });
                        // Approximate contribution by sphere that encloses cylinder
                        const centerW = transformPoint(worldTransform, view.center);
                        const hx = view.rx, hy = view.height * 0.5, hz = view.ry;
                        const r = Math.hypot(hx, hy, hz);
                        addSphereAABB(centerW, r);
                    } else if (view.type === 'quad_grid') {
                        // QUAD_GRID: four corners given as polygon order p0,p1,p2,p3
                        // Generate exactly nx (u-direction) and ny (v-direction) lines using bilinear interpolation.
                        const nxLines = Math.max(0, view.nx | 0);
                        const nyLines = Math.max(0, view.ny | 0);
                        if (nxLines === 0 && nyLines === 0) continue;
                        const [p0, p1, p2, p3] = view.corners;

                        function bilinear(u, v) {
                            const w0 = (1 - u) * (1 - v);
                            const w1 = u * (1 - v);
                            const w2 = u * v;
                            const w3 = (1 - u) * v;
                            return [
                                w0 * p0[0] + w1 * p1[0] + w2 * p2[0] + w3 * p3[0],
                                w0 * p0[1] + w1 * p1[1] + w2 * p2[1] + w3 * p3[1],
                                w0 * p0[2] + w1 * p1[2] + w2 * p2[2] + w3 * p3[2]
                            ];
                        }

                        const positions = [];
                        const indices = [];
                        let vertIdx = 0;

                        // Lines of constant v (vary u)
                        for (let j = 0; j < nyLines; j++) {
                            const v = (nyLines === 1) ? 0.5 : (j / (nyLines - 1));
                            const start = bilinear(0.0, v);
                            const end = bilinear(1.0, v);
                            positions.push(start[0], start[1], start[2], end[0], end[1], end[2]);
                            indices.push(vertIdx, vertIdx + 1);
                            vertIdx += 2;
                        }

                        // Lines of constant u (vary v)
                        for (let i = 0; i < nxLines; i++) {
                            const u = (nxLines === 1) ? 0.5 : (i / (nxLines - 1));
                            const start = bilinear(u, 0.0);
                            const end = bilinear(u, 1.0);
                            positions.push(start[0], start[1], start[2], end[0], end[1], end[2]);
                            indices.push(vertIdx, vertIdx + 1);
                            vertIdx += 2;
                        }

                        const positionsArr = new Float32Array(positions);
                        const indicesArr = new Uint16Array(indices);
                        const normalsArr = new Float32Array(positionsArr.length); // dummy normals

                        const vboPos = createBuffer(gl, positionsArr, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
                        const vboNorm = createBuffer(gl, normalsArr, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
                        const ibo = createBuffer(gl, indicesArr, gl.ELEMENT_ARRAY_BUFFER, gl.STATIC_DRAW);

                        sceneGpuMeshes.push({
                            kind: 'lines',
                            vboPos,
                            vboNorm,
                            ibo,
                            indexCount: indicesArr.length,
                            material: view.material || null,
                            transform: worldTransform
                        });
                        // Add quad corners to gateway AABB
                        if (view.corners && view.corners.length === 4) {
                            for (const c of view.corners) {
                                addPointToAABB(transformPoint(worldTransform, c));
                            }
                        }
                    }
                }
            }
            // If object has gateways, compute trigger from aggregated AABB
            if (obj.gateways && obj.gateways.length > 0) {
                const hasAABB = Number.isFinite(aggMin[0]) && Number.isFinite(aggMax[0]);
                if (hasAABB) {
                    const c = [ (aggMin[0] + aggMax[0]) * 0.5, (aggMin[1] + aggMax[1]) * 0.5, (aggMin[2] + aggMax[2]) * 0.5 ];
                    const dx = (aggMax[0] - aggMin[0]) * 0.5;
                    const dy = (aggMax[1] - aggMin[1]) * 0.5;
                    const dz = (aggMax[2] - aggMin[2]) * 0.5;
                    const r = Math.hypot(dx, dy, dz) || 1.0;
                    for (const gw of obj.gateways) {
                        const url = resolveGatewayTarget(gw.target);
                        gatewayTriggers.push({ center: c, radius: r, resolvedUrl: url, start: gw.start, objectName: obj.name || '' });
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

    function emtpyScene() {
        return {
            world: {
                start: [0, 0, 0],
                info: '',
                background: [0.25, 0.25, 0.25],
                fog: 0.0,                       // fog intensity 0-1
                terrain: '',                    // URL to terrain file
                color: [1.0, 1.0, 1.0],         // world light color
                ambient: [0.6, 0.6, 0.6],       // world light ambient
                position: [-3.0, 2.0, -1.0],    // world light pos; default (-3,2,-1)
                // far_clip: MAX_Z,
                // near_clip: MIN_Z,
            },
            objects: [], // Top-level objects, each containing views (geometry)
        };
    }

    // Scene: boxes and world settings (from parser module)
    let scene = emtpyScene();
    let materials = {};
    
    // Helper to set scene from text and upload
    function setSceneFromText(text, baseUrl, startOverride /* optional vec3 */) {
        try {
            sceneBaseUrl = baseUrl || null;
            scene = parseVrIntoScene(emtpyScene(), text, materials);
            if (startOverride && Array.isArray(startOverride) && startOverride.length === 3) {
                cam.yaw = 0; cam.pitch = 0;
                cam.pos = [startOverride[0], (startOverride[1] + 1.8), startOverride[2]];
            } else {
                resetCamera();
            }
            uploadSceneMeshes(scene);
            populateGatewaySelect();
        } catch (e) {
            console.error('Failed parsing scene:', e);
            alert('Failed to parse .vr scene. See console for details.');
        }
    }
    
    async function loadVrFromUrl(inputUrl, startOverride) {
        if (!inputUrl) return;
        // Resolve possibly-relative URL against the current page location
        let absUrl;
        try {
            absUrl = new URL(inputUrl, window.location.href).toString();
        } catch (e) {
            console.warn('Invalid URL:', inputUrl, e);
            alert('Invalid URL');
            return;
        }
        try {
            // add a cache-busting query param and disable HTTP cache
            const noCacheUrl = new URL(absUrl);
            noCacheUrl.searchParams.set('_ts', String(Date.now()));
            const resp = await fetch(noCacheUrl.toString(), { mode: 'cors', cache: 'no-store' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const text = await resp.text();
            // Use the final response URL as base in case of redirects
            const finalUrl = resp.url || absUrl;
            const base = new URL('.', finalUrl).toString();
            setSceneFromText(text, base, startOverride);
            // reflect into location bar without reloading
            try {
                const u = new URL(window.location.href);
                u.searchParams.set('src', inputUrl);
                window.history.replaceState({}, '', u.toString());
                if (urlInput) urlInput.value = inputUrl;
            } catch (e) { /* ignore */ }
        } catch (e) {
            console.error('Failed to load URL:', inputUrl, e);
            alert(`Failed to load URL: ${inputUrl}\n${e}`);
        }
    }

    // Resolve gateway targets to URLs per rules:
    // - If target looks like absolute URL, use as-is
    // - Else treat as relative to sceneBaseUrl (or page URL). If no file extension, append .vr
    function resolveGatewayTarget(target) {
        if (!target) return null;
        const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target);
        let name = target;
        // Append .vr if relative and no extension
        if (!hasScheme && !/\.[a-zA-Z0-9]{1,6}(?:$|[?#])/.test(name)) {
            name = name + '.vr';
        }
        try {
            const base = sceneBaseUrl || (new URL('.', window.location.href).toString());
            const abs = new URL(name, base).toString();
            return abs;
        } catch (e) {
            try { return new URL(name).toString(); } catch { return null; }
        }
    }

    function collectGatewaysFromObject(obj, list, parentTransform) {
        if (!obj) return;
        if (obj.gateways && Array.isArray(obj.gateways)) {
            for (const gw of obj.gateways) {
                const resolved = resolveGatewayTarget(gw.target);
                list.push({ target: gw.target, resolvedUrl: resolved, start: gw.start, objectName: obj.name || '' });
            }
        }
        if (obj.children) {
            for (const ch of obj.children) collectGatewaysFromObject(ch, list, parentTransform);
        }
    }

    function populateGatewaySelect() {
        if (!gatewaySelect) return;
        // Clear
        while (gatewaySelect.firstChild) gatewaySelect.removeChild(gatewaySelect.firstChild);
        const none = document.createElement('option');
        none.value = ''; none.textContent = '(none)';
        gatewaySelect.appendChild(none);
        const list = [];
        if (scene && Array.isArray(scene.objects)) {
            for (const o of scene.objects) collectGatewaysFromObject(o, list, null);
        }
        list.forEach((g, idx) => {
            const opt = document.createElement('option');
            const label = `${g.objectName ? g.objectName + ' → ' : ''}${g.target}`;
            opt.value = String(idx);
            opt.textContent = label;
            opt.dataset.url = g.resolvedUrl || '';
            opt.dataset.start = JSON.stringify(g.start || [0,0,0]);
            gatewaySelect.appendChild(opt);
        });
        gatewaySelect.dataset.count = String(list.length);
        // store list for later retrieval
        gatewaySelect._gwList = list;
    }

    async function enterSelectedGateway() {
        if (!gatewaySelect || !gatewaySelect._gwList) return;
        const sel = gatewaySelect.value;
        if (!sel) return;
        const idx = parseInt(sel, 10);
        const entry = gatewaySelect._gwList[idx];
        if (!entry || !entry.resolvedUrl) { alert('Invalid gateway selection'); return; }
        await loadVrFromUrl(entry.resolvedUrl, entry.start);
    }

    // Camera
    // Camera: add 1.8m Y offset to simulate eye height above ground
    const cam = { pos: [0, 1.8, 3], yaw: 0, pitch: 0 };
    const keys = {};
    let dragging = false, lastMouse = [0, 0];
    let isPointerLocked = false;

    // Reset camera to world start and clear orientation
    // Note that we simulate eye height by adding 1.8m to Y.
    // This is a simple approach and may not work well for all scenes,
    // and should at some point be replaced by a more robust system.
    function resetCamera() {
        cam.yaw = 0;
        cam.pitch = 0;
        const start = (scene && scene.world && Array.isArray(scene.world.start)) ? scene.world.start : [0, 0, 0];
        cam.pos = start.slice();
        if (cam.pos.length >= 2) cam.pos[1] += 1.8;
    }

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

        // Quick gateway enter: press 'g' to enter the first gateway if available
        window.addEventListener('keydown', e => {
            if (e.key.toLowerCase() === 'g') {
                if (gatewaySelect && gatewaySelect._gwList && gatewaySelect._gwList.length > 0) {
                    gatewaySelect.value = '0';
                    enterSelectedGateway();
                }
            }
        });

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
        // After movement, test for entering any gateway trigger volumes
        if (t >= gatewayCooldownUntil) {
            for (let i = 0; i < gatewayTriggers.length; i++) {
                const g = gatewayTriggers[i];
                const dx = cam.pos[0] - g.center[0];
                const dy = cam.pos[1] - g.center[1];
                const dz = cam.pos[2] - g.center[2];
                const inside = (dx*dx + dy*dy + dz*dz) <= (g.radius * g.radius);
                const wasInside = gatewayInside.has(i);
                if (inside && !wasInside) {
                    // Enter gateway
                    gatewayCooldownUntil = t + 1000; // 1s cooldown in ms
                    if (g.resolvedUrl) {
                        loadVrFromUrl(g.resolvedUrl, g.start);
                    }
                    gatewayInside.add(i);
                    break; // handle one per frame
                } else if (!inside && wasInside) {
                    gatewayInside.delete(i);
                }
            }
        }

        gl.clearColor(scene.world.background[0], scene.world.background[1], scene.world.background[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(prog);
        
        // Set world light properties
        gl.uniform3fv(uniforms.uLightDir, new Float32Array([0.5, 0.7, 0.4]));
        gl.uniform3fv(uniforms.uLightPos, new Float32Array(scene.world.position || [-3.0, 2.0, -1.0]));
        gl.uniform3fv(uniforms.uLightColor, new Float32Array(scene.world.color || [1.0, 1.0, 1.0]));
        gl.uniform3fv(uniforms.uWorldAmbient, new Float32Array(scene.world.ambient || [0.6, 0.6, 0.6]));
        
        // Set fog properties
        const fogIntensity = (scene.world.fog !== undefined) ? scene.world.fog : 0.0;
        gl.uniform1f(uniforms.uFogIntensity, fogIntensity);
        gl.uniform3fv(uniforms.uFogColor, new Float32Array(scene.world.background));
        
        // Set camera position for fog and specular calculations
        gl.uniform3fv(uniforms.uCameraPos, new Float32Array(cam.pos));

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
            // No reliable base path for local files; keep null to avoid leaking local paths
            sceneBaseUrl = null;
            setSceneFromText(ev.target.result, null);
            // Clean any src parameter from the URL when loading local files
            try {
                const u = new URL(window.location.href);
                u.searchParams.delete('src'); u.searchParams.delete('vr');
                window.history.replaceState({}, '', u.toString());
                if (urlInput) urlInput.value = '';
            } catch (e) { /* ignore */ }
        };
        reader.readAsText(f);
    });

    // URL input events
    if (loadUrlBtn) {
        loadUrlBtn.addEventListener('click', () => {
            const val = (urlInput && urlInput.value) ? urlInput.value.trim() : '';
            if (val) loadVrFromUrl(val);
        });
    }
    if (urlInput) {
        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const val = urlInput.value.trim();
                if (val) loadVrFromUrl(val);
            }
        });
    }

    if (enterGatewayBtn) {
        enterGatewayBtn.addEventListener('click', () => { enterSelectedGateway(); });
    }
    if (gatewaySelect) {
        gatewaySelect.addEventListener('dblclick', () => { enterSelectedGateway(); });
    }

    // Initialize and start render loop
    function startup() {
        initGL();
        uploadGeometry();
    bindControls();
        resize();

        resetCamera(); // ensure initial camera matches world start with neutral orientation

        // Load materials (disable cache), then attempt autoload from query param if present
        (()=>{
            const u = new URL('materials.json', window.location.href);
            u.searchParams.set('_ts', String(Date.now()));
            return fetch(u.toString(), { cache: 'no-store' });
        })()
            .then(response => response.json())
            .then(data => {
                materials = data;
                console.log('Materials loaded:', materials);
            })
            .catch(error => console.error('Error loading materials:', error))
            .finally(() => {
                // Autoload from query param
                try {
                    const u = new URL(window.location.href);
                    const src = u.searchParams.get('src') || u.searchParams.get('vr');
                    if (src) {
                        if (urlInput) urlInput.value = src;
                        loadVrFromUrl(src);
                    }
                } catch (e) { /* ignore */ }
                // Populate gateways for initial blank scene (none)
                populateGatewaySelect();
            });

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
