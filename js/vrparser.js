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

// Naive .vr parser for the minimal constructs this viewer supports.
// It only parses: world { background R G B; start v x y z } and RBOX primitives.
// To be completely replaced later with a full-featured parser.
export function parseVrIntoScene(theScene, text) {
    // remove block comments /* */ and % line comments
    text = text.replace(/\/\*[\s\S]*?\*\//g, '\n');
    text = text.replace(/%.*$/gm, '');

    // world background and start
    const worldMatch = /world\s+"?[\w\- ]*"?\s*\{([\s\S]*?)\}/m.exec(text);
    if (worldMatch) {
        const inner = worldMatch[1];
        const bg = /background\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)/.exec(inner);
        if (bg) theScene.world.background = [parseFloat(bg[1]), parseFloat(bg[2]), parseFloat(bg[3])];
        const st = /start\s+v\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)/.exec(inner);
        if (st) theScene.world.start = [parseFloat(st[1]), parseFloat(st[2]), parseFloat(st[3])];
    }

    // Find every RBOX (anywhere): pattern RBOX v x y z v x y z
    const rboxRe = /RBOX\s+v\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)\s+v\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)/g;
    let m;
    while ((m = rboxRe.exec(text))) {
        const x0 = parseFloat(m[1]), y0 = parseFloat(m[2]), z0 = parseFloat(m[3]);
        const x1 = parseFloat(m[4]), y1 = parseFloat(m[5]), z1 = parseFloat(m[6]);
        const minx = Math.min(x0, x1), maxx = Math.max(x0, x1);
        const miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
        const minz = Math.min(z0, z1), maxz = Math.max(z0, z1);
        const center = [(minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2];
        const size = [maxx - minx, maxy - miny, maxz - minz];
        // default color: vary by position for visual separation
        const color = [
            (0.3 + (center[0] % 1 + 1) % 1 * 0.7),
            (0.3 + (center[1] % 1 + 1) % 1 * 0.7),
            (0.3 + (center[2] % 1 + 1) % 1 * 0.7)
        ];
        theScene.boxes.push({ center, size, color });
    }
    console.log('parseVrIntoScene: boxes parsed =', theScene.boxes.length);
    return theScene;
}
