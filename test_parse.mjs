
// To use for testing the vrparser module with node.js.
// Run with:  node test_parse.mjs

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';

// load the parser as an ES module relative to this file
import('./js/vrparser.js').then(mod => {
  const text = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'samples', 'simple.vr'), 'utf8');
  const scene = mod.emtpyScene();
  mod.parseVrIntoScene(scene, text);
  console.log('Scene.world:', scene.world);
  console.log('boxes count:', scene.boxes.length);
  console.log('boxes:', JSON.stringify(scene.boxes, null, 2));
}).catch(err => { console.error('import error', err); process.exit(1); });
