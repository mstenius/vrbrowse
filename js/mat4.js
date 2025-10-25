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

    // Translation: out = m translated by v
    translate(m, v) {
        const out = new Float32Array(m);
        out[12] += v[0];
        out[13] += v[1];
        out[14] += v[2];
        return out;
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
