// Minimal WebGL .vr viewer
// Supports: world { background R G B; start v x y z } and view { RBOX v x0 y0 z0 v x1 y1 z1 }

(function(){
  const canvas = document.getElementById('glcanvas');
  const fileInput = document.getElementById('fileInput');
  const loadSampleBtn = document.getElementById('loadSample');
  

  // Resize canvas to fill
  function resize(){
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth * dpr | 0;
    const h = canvas.clientHeight * dpr | 0;
    if(canvas.width !== w || canvas.height !== h){
      canvas.width = w; canvas.height = h;
      if(gl) gl.viewport(0,0,w,h);
    }
  }

  // Tiny mat4 utilities
  function degToRad(d){return d*Math.PI/180}
  const Mat4 = {
    identity(){ return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); },
    // Column-major multiply: out = a * b
    multiply(a,b){
      const out = new Float32Array(16);
      for(let col=0; col<4; col++){
        for(let row=0; row<4; row++){
          let s = 0.0;
          for(let k=0; k<4; k++) s += a[k*4 + row] * b[col*4 + k];
          out[col*4 + row] = s;
        }
      }
      return out;
    },
    translate(m, v){ const out = new Float32Array(m); out[12]+=v[0]; out[13]+=v[1]; out[14]+=v[2]; return out; },
    // Column-major perspective matrix
    perspective(fovy, aspect, near, far){
      const f = 1.0/Math.tan(fovy/2);
      const nf = 1/(near - far);
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
    // Column-major lookAt (camera) matrix
    lookAt(eye, center, up){
      const zx = eye[0] - center[0];
      const zy = eye[1] - center[1];
      const zz = eye[2] - center[2];
      let len = Math.hypot(zx, zy, zz);
      let z0 = zx/len, z1 = zy/len, z2 = zz/len;
      if(!isFinite(z0) || !isFinite(z1) || !isFinite(z2)) { z0=0; z1=0; z2=1; }

      // x = up cross z
      let x0 = up[1]*z2 - up[2]*z1;
      let x1 = up[2]*z0 - up[0]*z2;
      let x2 = up[0]*z1 - up[1]*z0;
      let xlen = Math.hypot(x0,x1,x2);
      if(xlen === 0){ x0 = 1; x1 = 0; x2 = 0; xlen = 1; }
      x0/=xlen; x1/=xlen; x2/=xlen;

      // y = z cross x
      const y0 = z1*x2 - z2*x1;
      const y1 = z2*x0 - z0*x2;
      const y2 = z0*x1 - z1*x0;

      const out = new Float32Array(16);
      out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
      out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
      out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;

      out[12] = -(x0*eye[0] + x1*eye[1] + x2*eye[2]);
      out[13] = -(y0*eye[0] + y1*eye[1] + y2*eye[2]);
      out[14] = -(z0*eye[0] + z1*eye[1] + z2*eye[2]);
      out[15] = 1;
      return out;
    }
  };

  // WebGL setup
  let gl = null;
  let prog = null;
  let attribs = {}, uniforms = {};

  function createShader(src, type){ const s = gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function createProgram(vs,fs){ const p = gl.createProgram(); gl.attachShader(p,createShader(vs,gl.VERTEX_SHADER)); gl.attachShader(p,createShader(fs,gl.FRAGMENT_SHADER)); gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }

  function initGL(){
    gl = canvas.getContext('webgl', {antialias:true});
    if(!gl) { alert('WebGL not available'); return; }
    const vs = `attribute vec3 aPosition;attribute vec3 aNormal;uniform mat4 uModel;uniform mat4 uViewProj;varying vec3 vNormal;varying vec3 vPos;void main(){vNormal = mat3(uModel)*aNormal; vPos=(uModel*vec4(aPosition,1.0)).xyz; gl_Position = uViewProj * uModel * vec4(aPosition,1.0);} `;
    const fs = `precision mediump float;varying vec3 vNormal;varying vec3 vPos;uniform vec3 uColor;uniform vec3 uLightDir;void main(){vec3 N = normalize(vNormal); float d = max(dot(N, -uLightDir), 0.0); vec3 base = uColor * 0.6 + 0.4*uColor*d; gl_FragColor = vec4(base,1.0);} `;
    prog = createProgram(vs,fs);
    attribs.aPosition = gl.getAttribLocation(prog,'aPosition');
    attribs.aNormal = gl.getAttribLocation(prog,'aNormal');
    uniforms.uModel = gl.getUniformLocation(prog,'uModel');
    uniforms.uViewProj = gl.getUniformLocation(prog,'uViewProj');
    uniforms.uColor = gl.getUniformLocation(prog,'uColor');
    uniforms.uLightDir = gl.getUniformLocation(prog,'uLightDir');
    gl.enable(gl.DEPTH_TEST);
    // Debug info
    console.log('initGL: attribs', {aPosition:attribs.aPosition, aNormal:attribs.aNormal});
    console.log('initGL: uniforms', {uModel:!!uniforms.uModel, uViewProj:!!uniforms.uViewProj, uColor:!!uniforms.uColor, uLightDir:!!uniforms.uLightDir});
  }

  // Box geometry (unit cube centered at origin)
  const cube = (function(){
    const positions = new Float32Array([
      // front
      -0.5,-0.5,0.5, 0.5,-0.5,0.5, 0.5,0.5,0.5, -0.5,0.5,0.5,
      // back
      -0.5,-0.5,-0.5, -0.5,0.5,-0.5, 0.5,0.5,-0.5, 0.5,-0.5,-0.5,
      // top
      -0.5,0.5,-0.5, -0.5,0.5,0.5, 0.5,0.5,0.5, 0.5,0.5,-0.5,
      // bottom
      -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,-0.5,0.5, -0.5,-0.5,0.5,
      // right
      0.5,-0.5,-0.5, 0.5,0.5,-0.5, 0.5,0.5,0.5, 0.5,-0.5,0.5,
      // left
      -0.5,-0.5,-0.5, -0.5,-0.5,0.5, -0.5,0.5,0.5, -0.5,0.5,-0.5
    ]);
    const normals = new Float32Array([
      0,0,1, 0,0,1, 0,0,1, 0,0,1,
      0,0,-1,0,0,-1,0,0,-1,0,0,-1,
      0,1,0, 0,1,0, 0,1,0, 0,1,0,
      0,-1,0,0,-1,0,0,-1,0,0,-1,0,
      1,0,0,1,0,0,1,0,0,1,0,0,
      -1,0,0,-1,0,0,-1,0,0,-1,0,0
    ]);
    const indices = new Uint16Array([
      0,1,2, 0,2,3,
      4,5,6, 4,6,7,
      8,9,10, 8,10,11,
      12,13,14, 12,14,15,
      16,17,18, 16,18,19,
      20,21,22, 20,22,23
    ]);
    return {positions, normals, indices};
  })();

  let vboPos=null, vboNorm=null, ibo=null;

  function uploadGeometry(){
    if(!vboPos) vboPos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vboPos); gl.bufferData(gl.ARRAY_BUFFER, cube.positions, gl.STATIC_DRAW);
    if(!vboNorm) vboNorm = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vboNorm); gl.bufferData(gl.ARRAY_BUFFER, cube.normals, gl.STATIC_DRAW);
    if(!ibo) ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cube.indices, gl.STATIC_DRAW);
    // Log buffer sizes
    gl.bindBuffer(gl.ARRAY_BUFFER, vboPos); const posBytes = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
    gl.bindBuffer(gl.ARRAY_BUFFER, vboNorm); const normBytes = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); const idxBytes = gl.getBufferParameter(gl.ELEMENT_ARRAY_BUFFER, gl.BUFFER_SIZE);
    console.log('uploadGeometry: buffers', {posBytes, normBytes, idxBytes});
  }

  // Scene: boxes and world settings
  let scene = { boxes: [], world: { background: [0.2,0.2,0.25], start: [0,0,3] } };

  function clearScene(){ scene.boxes = []; scene.world = { background:[0.2,0.2,0.25], start:[0,0,3] }; }

  // Naive .vr parser for required constructs
  function parseVR(text){
    clearScene();
    // remove comments /* */ and % line comments
    text = text.replace(/\/\*[\s\S]*?\*\//g, '\n');
    text = text.replace(/%.*$/gm, '');

    // world background
    const worldMatch = /world\s+"?[\w\- ]*"?\s*\{([\s\S]*?)\}/m.exec(text);
    if(worldMatch){
      const inner = worldMatch[1];
      const bg = /background\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)/.exec(inner);
      if(bg) scene.world.background = [parseFloat(bg[1]), parseFloat(bg[2]), parseFloat(bg[3])];
      const st = /start\s+v\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)/.exec(inner);
      if(st) scene.world.start = [parseFloat(st[1]), parseFloat(st[2]), parseFloat(st[3])];
    }

    // Find every RBOX (anywhere): pattern RBOX v x y z v x y z
    const rboxRe = /RBOX\s+v\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)\s+v\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)\s+([\d\.eE\-\+]+)/g;
    let m; while((m=rboxRe.exec(text))){
      const x0=parseFloat(m[1]), y0=parseFloat(m[2]), z0=parseFloat(m[3]);
      const x1=parseFloat(m[4]), y1=parseFloat(m[5]), z1=parseFloat(m[6]);
      const minx=Math.min(x0,x1), maxx=Math.max(x0,x1);
      const miny=Math.min(y0,y1), maxy=Math.max(y0,y1);
      const minz=Math.min(z0,z1), maxz=Math.max(z0,z1);
      const center = [(minx+maxx)/2,(miny+maxy)/2,(minz+maxz)/2];
      const size = [maxx-minx, maxy-miny, maxz-minz];
      // default color: vary by position for visual separation
      const color = [ (0.3 + (center[0]%1+1)%1*0.7), (0.3 + (center[1]%1+1)%1*0.7), (0.3 + (center[2]%1+1)%1*0.7) ];
      scene.boxes.push({center,size,color});
    }
    console.log('parseVR: boxes parsed =', scene.boxes.length);
    return scene;
  }

  // Camera
  const cam = { pos: [0,0,3], yaw:0, pitch:0 };
  const keys = {};
  let dragging=false, lastMouse=[0,0];
  let isPointerLocked = false;

  function onPointerMove(e){
    const dx = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
    const dy = e.movementY || e.mozMovementY || e.webkitMovementY || 0;
    const sensitivity = 0.0025;
    // moving mouse right should increase yaw (turn right)
    cam.yaw += dx * sensitivity;
    cam.pitch -= dy * sensitivity;
    cam.pitch = Math.max(-Math.PI/2+0.01, Math.min(Math.PI/2-0.01, cam.pitch));
  }

  function bindControls(){
    window.addEventListener('keydown', e=>{ keys[e.key.toLowerCase()]=true; });
    window.addEventListener('keyup', e=>{ keys[e.key.toLowerCase()]=false; });
    // Pointer lock (mouselook) when available. Click the canvas to lock the pointer.
    const plSupported = !!(canvas.requestPointerLock || canvas.mozRequestPointerLock || canvas.webkitRequestPointerLock);
    if(plSupported){
      canvas.style.cursor = 'crosshair';
      canvas.addEventListener('click', ()=>{
        try{ canvas.requestPointerLock(); }catch(e){ console.warn('pointer lock request failed', e); }
      });

      document.addEventListener('pointerlockchange', ()=>{
        const pl = document.pointerLockElement === canvas;
        isPointerLocked = pl;
        if(pl){
          document.addEventListener('mousemove', onPointerMove);
          canvas.style.cursor = 'none';
        } else {
          document.removeEventListener('mousemove', onPointerMove);
          canvas.style.cursor = 'crosshair';
        }
      });
      // vendor-prefixed events
      document.addEventListener('mozpointerlockchange', ()=>{ const pl = document.mozPointerLockElement === canvas; isPointerLocked = pl; });
      document.addEventListener('webkitpointerlockchange', ()=>{ const pl = document.webkitPointerLockElement === canvas; isPointerLocked = pl; });
    } else {
      // Fallback: click-and-drag behaviour
      canvas.addEventListener('mousedown', e=>{ dragging=true; lastMouse=[e.clientX,e.clientY]; canvas.style.cursor='grabbing'; });
      window.addEventListener('mouseup', e=>{ dragging=false; canvas.style.cursor='default'; });
      window.addEventListener('mousemove', e=>{ if(!dragging) return; const dx=(e.clientX-lastMouse[0]); const dy=(e.clientY-lastMouse[1]); lastMouse=[e.clientX,e.clientY]; cam.yaw += dx*0.0025; cam.pitch -= dy*0.0025; cam.pitch = Math.max(-Math.PI/2+0.01, Math.min(Math.PI/2-0.01, cam.pitch)); });
    }
  }

  function updateCamera(dt){
    const speed = 3.0; // m/s
    let forward = 0, right = 0, up = 0;
    if(keys['w']) forward += 1; if(keys['s']) forward -= 1;
    if(keys['a']) right -= 1; if(keys['d']) right += 1;
    if(keys['q']) up -= 1; if(keys['e']) up += 1;
    const len = Math.hypot(forward,right) || 1;
    forward/=len; right/=len;
    const yaw = cam.yaw;
    cam.pos[0] += ((Math.sin(yaw)*forward) + (Math.cos(yaw)*right)) * speed * dt;
    cam.pos[2] += ((Math.cos(yaw)*-forward) + (Math.sin(yaw)*right)) * speed * dt;
    cam.pos[1] += up * speed * dt;
  }

  // Render loop
  let lastT = 0;
  let _debug_logged_matrices = false;
  function frame(t){
    resize();
    const dt = Math.min(0.1, (t-lastT)/1000 || 0); lastT=t;
    updateCamera(dt);
    // debug camera
    if((t|0) % 2000 < 16) console.log('camera', {pos: cam.pos.slice(), yaw: cam.yaw, pitch: cam.pitch});
    gl.clearColor(scene.world.background[0], scene.world.background[1], scene.world.background[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniform3fv(uniforms.uLightDir, new Float32Array([0.5,0.7,0.4]));

    const aspect = canvas.width / canvas.height;
    const proj = Mat4.perspective(60*Math.PI/180, aspect, 0.1, 1000);
  // compute forward direction (camera looks towards -Z in world when yaw=0)
  const dirX = Math.cos(cam.pitch) * Math.sin(cam.yaw);
  const dirY = Math.sin(cam.pitch);
  const dirZ = -Math.cos(cam.pitch) * Math.cos(cam.yaw);
  const center = [ cam.pos[0] + dirX, cam.pos[1] + dirY, cam.pos[2] + dirZ ];
    const view = Mat4.lookAt(cam.pos, center, [0,1,0]);
    const viewProj = Mat4.multiply(proj, view);
    gl.uniformMatrix4fv(uniforms.uViewProj, false, viewProj);

    if(!_debug_logged_matrices){
      console.log('debug viewProj:', Array.from(viewProj));
      if(scene.boxes.length>0){
        const b = scene.boxes[0];
        let M = Mat4.identity(); M = Mat4.translate(M, b.center);
        const sx=b.size[0], sy=b.size[1], sz=b.size[2];
        M[0]*=sx; M[1]*=sx; M[2]*=sx; M[4]*=sy; M[5]*=sy; M[6]*=sy; M[8]*=sz; M[9]*=sz; M[10]*=sz;
        console.log('debug first box model M:', Array.from(M));
      }
      _debug_logged_matrices = true;
    }

    // bind geometry
    gl.bindBuffer(gl.ARRAY_BUFFER, vboPos); gl.enableVertexAttribArray(attribs.aPosition); gl.vertexAttribPointer(attribs.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, vboNorm); gl.enableVertexAttribArray(attribs.aNormal); gl.vertexAttribPointer(attribs.aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);

    for(const b of scene.boxes){
      // model matrix: scale then translate
      let M = Mat4.identity();
      M = Mat4.translate(M, b.center);
      // apply scale by multiplying columns (cheap hack)
      const sx=b.size[0], sy=b.size[1], sz=b.size[2];
      M[0]*=sx; M[1]*=sx; M[2]*=sx; M[4]*=sy; M[5]*=sy; M[6]*=sy; M[8]*=sz; M[9]*=sz; M[10]*=sz;
      gl.uniformMatrix4fv(uniforms.uModel, false, M);
      gl.uniform3fv(uniforms.uColor, new Float32Array(b.color));
      gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
    }

    requestAnimationFrame(frame);
  }

  // File handling
  fileInput.addEventListener('change', e=>{
    const f = e.target.files && e.target.files[0]; if(!f) return;
    const reader = new FileReader(); reader.onload = ev => { parseVR(ev.target.result); cam.pos = scene.world.start.slice(); }; reader.readAsText(f);
  });
  loadSampleBtn.addEventListener('click', ()=>{
    fetch('samples/simple.vr').then(r=>r.text()).then(t=>{ parseVR(t); cam.pos = scene.world.start.slice(); }).catch(err=>{ console.error('Failed to fetch samples/simple.vr', err); });
  });

  // initialize on page load
  function startup(){ initGL(); uploadGeometry(); bindControls(); resize(); cam.pos = scene.world.start.slice(); requestAnimationFrame(frame); }
  window.addEventListener('resize', resize);
  startup();

// Try to auto-load the sample when served over HTTP so the scene appears immediately
if(window.location.protocol.startsWith('http')){
  fetch('samples/simple.vr').then(r=>r.text()).then(t=>{ parseVR(t); cam.pos = scene.world.start.slice(); }).catch(err=>{ console.warn('Auto-load sample failed:', err); });
}

  // expose parse for dev
  window.__vr_parse = parseVR;
})();
