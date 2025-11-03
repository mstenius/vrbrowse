// Matrix utilities (column-major 4x4) and helpers

export function degToRad(d) { return d * Math.PI / 180 }

export const Mat4 = {

    // Identity matrix
    identity() {
        return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    },

    // Multiply: out = a * b
    multiply(a, b) {
        const out = new Float32Array(16);
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                let s = 0.0;
                for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[col * 4 + k];
                out[col * 4 + row] = s;
            }
        }
        return out;
    },

    // Translation: out = m * T(v)
    translate(m, v) {
        // Create translation matrix and multiply
        const t = new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            v[0], v[1], v[2], 1
        ]);
        return Mat4.multiply(m, t);
    },

    // Rotation around X axis
    rotateX(m, rad) {
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        const rot = new Float32Array([
            1, 0, 0, 0,
            0, c, s, 0,
            0, -s, c, 0,
            0, 0, 0, 1
        ]);
        return Mat4.multiply(m, rot);
    },

    // Rotation around Y axis
    rotateY(m, rad) {
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        const rot = new Float32Array([
            c, 0, -s, 0,
            0, 1, 0, 0,
            s, 0, c, 0,
            0, 0, 0, 1
        ]);
        return Mat4.multiply(m, rot);
    },

    // Rotation around Z axis
    rotateZ(m, rad) {
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        const rot = new Float32Array([
            c, s, 0, 0,
            -s, c, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ]);
        return Mat4.multiply(m, rot);
    },

    // Euler XYZ rotation (rotating frame): rotate around local X, then local Y, then local Z
    eulerXYZ(m, angles) {
        let result = m;
        result = Mat4.rotateX(result, angles[0]);
        result = Mat4.rotateY(result, angles[1]);
        result = Mat4.rotateZ(result, angles[2]);
        return result;
    },

    // Fixed XYZ rotation (world frame): rotate around world X, Y, Z
    fixedXYZ(m, angles) {
        let result = m;
        result = Mat4.rotateZ(result, angles[2]);
        result = Mat4.rotateY(result, angles[1]);
        result = Mat4.rotateX(result, angles[0]);
        return result;
    },

    // Scale matrix
    scale(m, v) {
        const out = new Float32Array(m);
        out[0] *= v[0]; out[1] *= v[0]; out[2] *= v[0]; out[3] *= v[0];
        out[4] *= v[1]; out[5] *= v[1]; out[6] *= v[1]; out[7] *= v[1];
        out[8] *= v[2]; out[9] *= v[2]; out[10] *= v[2]; out[11] *= v[2];
        return out;
    },

    // Create matrix from 3x3 rotation basis (rows = basis vectors)
    fromBasis(v1, v2, v3) {
        return new Float32Array([
            v1[0], v1[1], v1[2], 0,
            v2[0], v2[1], v2[2], 0,
            v3[0], v3[1], v3[2], 0,
            0, 0, 0, 1
        ]);
    },

    // Perspective matrix
    perspective(fovy, aspect, near, far) {
        const f = 1.0 / Math.tan(fovy / 2);
        const nf = 1 / (near - far);
        const out = new Float32Array(16);

        out[0] = f / aspect;
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;

        out[4] = 0;
        out[5] = f;
        out[6] = 0;
        out[7] = 0;

        out[8] = 0;
        out[9] = 0;
        out[10] = (far + near) * nf;
        out[11] = -1;

        out[12] = 0;
        out[13] = 0;
        out[14] = (2 * far * near) * nf;
        out[15] = 0;
        return out;
    },

    // lookAt (camera) matrix
    lookAt(eye, center, up) {
        const zx = eye[0] - center[0];
        const zy = eye[1] - center[1];
        const zz = eye[2] - center[2];
        let len = Math.hypot(zx, zy, zz);
        let z0 = zx / len;
        let z1 = zy / len;
        let z2 = zz / len;
        if (!isFinite(z0) || !isFinite(z1) || !isFinite(z2)) {
            z0 = 0; z1 = 0; z2 = 1;
        }

        // x = up cross z
        let x0 = up[1] * z2 - up[2] * z1;
        let x1 = up[2] * z0 - up[0] * z2;
        let x2 = up[0] * z1 - up[1] * z0;
        let xlen = Math.hypot(x0, x1, x2);
        if (xlen === 0) { x0 = 1; x1 = 0; x2 = 0; xlen = 1; }
        x0 /= xlen; x1 /= xlen; x2 /= xlen;

        // y = z cross x
        const y0 = z1 * x2 - z2 * x1;
        const y1 = z2 * x0 - z0 * x2;
        const y2 = z0 * x1 - z1 * x0;

        const out = new Float32Array(16);
        out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
        out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
        out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;

        out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
        out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
        out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
        out[15] = 1;
        return out;
    }
};
