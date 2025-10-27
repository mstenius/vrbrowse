import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';

import('./js/vrparser.js').then(mod => {
  const text = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'samples', 'views_examples.vr'), 'utf8');
  const scene = mod.emtpyScene();
  mod.parseVrIntoScene(scene, text);
  console.log('Scene.world:', scene.world);
  console.log('objects count:', (scene.objects||[]).length);
  console.log('objects:', JSON.stringify(scene.objects, null, 2));
  console.log('boxes count:', (scene.boxes||[]).length);
  console.log('boxes:', JSON.stringify(scene.boxes, null, 2));
}).catch(err => { console.error('import error', err); process.exit(1); });
