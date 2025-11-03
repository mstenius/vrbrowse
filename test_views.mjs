// Test parsing of views_examples.vr

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';

// load the parser as an ES module relative to this file
import('./js/vrparser.js').then(mod => {
  const text = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'samples', 'views_examples.vr'), 'utf8');
  const scene = mod.emtpyScene();
  mod.parseVrIntoScene(scene, text);
  console.log('Objects:', scene.objects.length);
  scene.objects.forEach((obj, i) => {
    console.log(`Object ${i}: ${obj.name}, views: ${obj.views ? obj.views.length : 0}, materials: ${obj.materials.length}`);
    if (obj.views) {
      obj.views.forEach((v, j) => console.log(`  View ${j}: type=${v.type}`));
    }
  });
}).catch(err => { console.error('import error', err); process.exit(1); });
