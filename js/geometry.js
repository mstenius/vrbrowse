// Geometry helpers: create primitive meshes and upload them to GPU

import { createBuffer } from './gl.js';

export function createCube() {
    const positions = new Float32Array([
        // front
        -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
        // back
        -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
        // top
        -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
        // bottom
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
        // right
        0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5,
        // left
        -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5
    ]);
    const normals = new Float32Array([
        0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
        0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
        0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
        0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
        1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
        -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0
    ]);
    const indices = new Uint16Array([
        0, 1, 2, 0, 2, 3,
        4, 5, 6, 4, 6, 7,
        8, 9, 10, 8, 10, 11,
        12, 13, 14, 12, 14, 15,
        16, 17, 18, 16, 18, 19,
        20, 21, 22, 20, 22, 23
    ]);
    return { positions, normals, indices };
}

export function createCylinder(segments = 36) {
    // Unit cylinder: radius 0.5, height 1.0 (y from -0.5 to 0.5), centered at origin
    const verts = [];
    const norms = [];
    const indices = [];

    // side vertices (top and bottom rings)
    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const x = Math.cos(a) * 0.5;
        const z = Math.sin(a) * 0.5;
        // top vertex (y=0.5)
        verts.push(x, 0.5, z);
        norms.push(Math.cos(a), 0, Math.sin(a));
        // bottom vertex (y=-0.5)
        verts.push(x, -0.5, z);
        norms.push(Math.cos(a), 0, Math.sin(a));
    }

    const ringCount = segments + 1;
    // side indices
    for (let i = 0; i < segments; i++) {
        const ti = i * 2;
        const bi = ti + 1;
        const ti1 = ((i + 1) % ringCount) * 2;
        const bi1 = ti1 + 1;
        // two triangles per quad
        indices.push(ti, bi, ti1);
        indices.push(ti1, bi, bi1);
    }

    // caps: top fan and bottom fan
    const topCenterIndex = verts.length / 3;
    verts.push(0, 0.5, 0); norms.push(0, 1, 0);
    const bottomCenterIndex = verts.length / 3;
    verts.push(0, -0.5, 0); norms.push(0, -1, 0);

    for (let i = 0; i < segments; i++) {
        const ti = i * 2;
        const ti1 = ((i + 1) % ringCount) * 2;
        // top cap: center, ti1(top), ti(top)
        indices.push(topCenterIndex, ti1, ti);
        // bottom cap: center, bi (bottom), bi1(bottom)
        const bi = ti + 1; const bi1 = ti1 + 1;
        indices.push(bottomCenterIndex, bi, bi1);
    }

    return { positions: new Float32Array(verts), normals: new Float32Array(norms), indices: new Uint16Array(indices) };
}

export function createSphere(latBands = 16, longBands = 16) {
    const positions = [];
    const normals = [];
    const indices = [];

    for (let lat = 0; lat <= latBands; lat++) {
        const theta = lat * Math.PI / latBands;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);

        for (let lon = 0; lon <= longBands; lon++) {
            const phi = lon * 2 * Math.PI / longBands;
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);

            const x = cosPhi * sinTheta;
            const y = cosTheta;
            const z = sinPhi * sinTheta;
            positions.push(0.5 * x, 0.5 * y, 0.5 * z);
            normals.push(x, y, z);
        }
    }

    for (let lat = 0; lat < latBands; lat++) {
        for (let lon = 0; lon < longBands; lon++) {
            const first = (lat * (longBands + 1)) + lon;
            const second = first + longBands + 1;
            indices.push(first, second, first + 1);
            indices.push(second, second + 1, first + 1);
        }
    }

    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

export function uploadMeshToGPU(gl, mesh) {
    const vboPos = createBuffer(gl, mesh.positions, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    const vboNorm = createBuffer(gl, mesh.normals, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    const ibo = createBuffer(gl, mesh.indices, gl.ELEMENT_ARRAY_BUFFER, gl.STATIC_DRAW);
    return { vboPos, vboNorm, ibo, indexCount: mesh.indices.length };
}
