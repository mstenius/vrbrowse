# Copilot instructions for `vrbrowse`

Purpose: Help AI agents contribute productively to this browser-based viewer for DIVE `.vr` files by summarizing the architecture, workflows, conventions, and gotchas specific to this repo.

## Big picture
- Pure browser app (no bundler): open `index.html` to run. WebGL rendering in `js/viewer.js`; parsing in `js/vrparser.js`; math/GL/geometry helpers in `js/{mat4.js,gl.js,geometry.js}`.
- Data flow: `.vr` text → tokenizer/recursive-descent parser → plain JS scene object → viewer uploads geometry to GPU and renders.
- Scene model: `{ world, objects[] }`. Each object has `{ name?, materials[], textures[], transforms[], views[], children[] }`. Views are primitive descriptors (box/cyl/sphere/mesh/lines/quad_grid) optionally with `material_index`, `texture_index`, and `view_index`.

## Core files to know
- `js/vrparser.js`: comment-aware tokenizer + conservative recursive-descent parser. Emits views: `rbox`, `cylinder`, `sphere`, `mesh`, `lines`, `quad_grid`. Implements `indexed_poly` triangulation. Adds default gray material if none.
- `js/viewer.js`: WebGL pipeline, camera + controls, GPU upload for parsed views, draw loop, and world lighting/fog. Loads `materials.json` at startup. Key uniforms: world light `color/ambient/position`, fog, and per-material properties (diffuse/ambient/emission/specular/spec_power/transparency).
- `js/geometry.js`: creates primitive meshes and uploads buffers.
- `js/gl.js`: thin wrappers for context, shaders, programs, buffers.
- `js/mat4.js`: minimal column‑major 4×4 ops (translate/euler/fixed/rotate/perspective/lookAt).
- `doc/dive_vr_format_spec_for_agents.md`: implementation-ready notes for `.vr` grammar and semantics used here.

## Developer workflows
- Run the viewer: open `index.html` in a WebGL-capable browser. Use the file picker to load samples from `samples/`.
- Tests/debug (Node ESM): run individual scripts like `node test_debug_tokens.mjs`, `node test_views.mjs`, etc. These import the parser dynamically and read from `samples/*.vr`.
  - Note: tests currently expect `emtpyScene` and `parseVrIntoScene` to be exported from `js/vrparser.js`. If missing, either export them there or adjust tests to import from the module that defines `emtpyScene`.
- Project is ESM (`package.json` has `{ "type": "module" }`). Use `import` paths relative to repo root.

## Parsing conventions and patterns
- Tokenization strips C-style `/* ... */`, `% ...`, and `// ...` comments while preserving positions.
- Identifiers: hyphens allowed in names. Vectors use optional `v` prefix: `v x y z`.
- Wrapper properties for `view` may appear before or inside `{ ... }`: support `name`, `material_index`, `texture_index`, `texture_mode`. Optional `view INDEX` is supported.
- Implemented world props: `background`, `start`, `fog`, `color`, `ambient`, `position` → map directly to uniforms/state in `viewer.js`.
- Materials on an object support three forms: named string (looked up in `materials.json`), `rgb r g b`, or a property block; unresolved names fall back to defaults.
- `indexed_poly`: collects vertex/normal/texcoord lists and poly/normal/texture index lists, triangulates faces (ear‑clipping), and builds a `mesh` view with arrays; recomputes normals if sizes mismatch.

## Rendering conventions
- Camera: WASD + Q/E, pointer‑lock if available; `Mat4.lookAt` with yaw/pitch, simulated eye height `+1.8m` on Y.
- Materials to shader: `spec_power` input is remapped from [0..1] to [1..128] before use.
- Transparency: uses alpha from `1 - transparency`; blending enabled with `SRC_ALPHA/ONE_MINUS_SRC_ALPHA`.
- Textures: `texture_index` picks from object `textures[]`; images load asynchronously with `Image()`; a 1×1 white fallback texture is precreated.

## Extending the system (follow these steps)
- New view primitive: (1) add parse method in `vrparser.js` to emit a view descriptor; (2) handle it in `uploadSceneMeshes` and the draw switch in `viewer.js`.
- New world/object property: parse in `vrparser.js` and map to viewer state/uniforms as needed.
- Materials: add names to `materials.json` or ensure parser’s named lookup matches uppercase keys (e.g., `"GRAY"`).

## Common pitfalls specific to this repo
- The function name is intentionally `emtpyScene` (typo) and referenced by tests; be consistent unless you rename across repo.
- All modules are browser‑friendly ESM; avoid Node‑only APIs in `js/*` except in test scripts.
- Parser is intentionally strict on numeric arity; prefer `try/catch` and `console.warn` for non‑fatal parse issues (see existing patterns).
- Triangulation assumes reasonably planar `indexed_poly` faces.

## Useful examples
- Samples: `samples/views_examples.vr`, `samples/simple.vr`, etc.
- Inspect tokens: `test_debug_tokens.mjs` uses `debugTokens()`.
- End‑to‑end parse to scene: `test_views.mjs`, `test_sphere_geometry.mjs`.
