# DIVE “.vr” File Format — Implementation-Ready Spec (v3.2 / 3.3x)

## About this Document
This is a generated description suited for someone implementing a basic 
viewer for the DIVE (Distributed Interactive Virtual Environment) .vr file
format. The description that follows was made using an LLM with the official
`.vr` file format description `[1]` as input.

## Purpose of the DIVE ".vr" File format
Defines DIVE worlds and objects (geometry, appearance, behavior, hierarchy).  
A `.vr` file is a scene-graph description with optional preprocessing (C preprocessor).

## Top-Level Structure
A `.vr` file contains:
- Optional world declaration:
  - `world "NAME" { ... }`
- Zero or more objects or top-level inlines:
  - `( object { ... } | inline "URL" )*`

Notes:
- Views (geometry) are only valid inside objects (or sibling divenodes like `lod`/`billboard`/`switch`).

---

## 1) File Scope & Lexing

- URL / name scope:
  - Filenames may be plain names or full URLs.
  - Scheme `dive:` (and bare names) resolve via `DIVEPATH` (colon-separated directories).
  - Scheme `file:` disables `DIVEPATH` lookup.

- Preprocessor (entire file is run through a C preprocessor):
  - `#include "file"`, `#define` (with args), `#if`/`#ifdef`/`#ifndef` ... `#else` `#endif`.
  - Include search uses `DIVEPATH` (unless absolute path). `inline` vs `include`: `include` needs local access; `inline` can fetch remotely.

- Comments:
  - Block: `/* ... */`
  - Line: `% ...` (to end of line). Avoid `%` inside multiline macros.
  - Note: avoid `#` at column 0 inside `begin.tcl`/`end.tcl` blocks (due to CPP).

- Numeric expressions:
  - Any numeric field may be an expression evaluated at load time (supports `+ - * /`).
  - Special names: `rnd` (uniform `0..1`), `lrnd` (previous `rnd`). Example:
    ```
    v 0 (34*42 + (rnd-0.5)*1000) 0
    ```

- Conventions:
  - Keywords lower-case; strings in double quotes; vectors as: `v x y z`.
  - Angles in radians; distances in meters unless noted.

---

## 2) World Declaration

Syntax:
```
world "NAME" {
  [ start v X Y Z ]                 // default (0,0,0)
  [ info "STRING" ]
  [ background R G B ]              // fog uses the same color
  [ fog INTENSITY ]                 // 0..1
  [ terrain URL ]
  [ color R G B ]                   // world light color; default (1,1,1)
  [ ambient R G B ]                 // world light ambient; default (0.6,0.6,0.6)
  [ position X Y Z ]                // world light pos; default (-3,2,-1)
  [ far_clip MAX_Z ]                // default = engine constant
  [ near_clip MIN_Z ]               // default = engine constant
}
```

Notes:
- Only one world declaration is expected; it must precede objects if present.
- Views are not valid directly under `world`; place geometry inside objects.

---

## 3) Objects

Generic structure (order flexible EXCEPT children must be last):
```
object {
  [ id NUMBER ]
  [ name "STRING" ]

  // Appearance vectors & flags
  [ material ... ]*                  // 0..N materials (vector; indices 0..N-1)
  [ texture "FILE_OR_URL" ]*         // 0..N textures (vector; indices 0..N-1)
  [ FLAG <keyword> on|off ]*         // object flags

  // Semantics & transforms
  [ gateway "WORLD_NAME" v X Y Z ]
  [ eulerxyz  v AX AY AZ ]*
  [ fixedxyz  v AX AY AZ ]*
  [ rotation  v X1 Y1 Z1 v X2 Y2 Z2 v X3 Y3 Z3 ]*
  [ translation v X Y Z ]*

  // App-level data & behavior
  [ prop "NAME" TYPE_INT|TYPE_FLOAT|TYPE_STRING VALUE [GLOBAL_PROP] ]*
  [ begin.tcl ... end.tcl ] | [ inline.tcl "URL" [args...] ]
  [ light { LIGHT_DESCR } ]*

  // Composition
  [ inline "URL" ]*                  // insert as child (DIVE .vr or VRML .wrl)
  [ lodrange { D1 D2 ... } ]         // legacy LOD (prefer node “lod { … }”)

  // Children (scene graph):
  ( view { ... } | object { ... } | billboard { ... } | lod { ... } | switch { ... } )*
}
```

### 3.1 Materials (`material`)
Three forms; each pushes one element to the object’s material vector:

1. Named:
   - `material "NAME"` — resolve in `materials.data`; else X11 color DB.
   - Sets `ambient`/`diffuse`; `specular`/`spec_power`/`transparency` default to `0`.

2. RGB shortcut:
   - `material rgb R G B` — sets `ambient`/`diffuse`; others default to `0`.

3. Property list:
   ```
   material {
     ambient  r g b
     diffuse  r g b
     emission r g b
     specular r g b
     spec_power S
     transparency T
   }
   ```
- Floats in `[0..1]`.
- If an object lacks materials, it inherits from the nearest ancestor.
- If no material can be found in the transitive chain of ancestors, assume: `material RGB "GRAY"`
  (addendum to the reference file format).

### 3.2 Textures (`texture`)
```
texture "FILE_OR_URL"
```
- Pushes a string onto the object’s texture vector.
- Mapping controlled in views via per-vertex `t u v` coords and `texture_index`.
- Texture blend mode per view: `TEXTURE_DECAL | TEXTURE_MODULATE` (default) | `TEXTURE_BLEND`.

### 3.3 Object flags
Examples:
```
FLAG visibility on|off       // default on
FLAG wireframe on|off
FLAG solid on|off
FLAG collision on|off
FLAG nograsp on|off
FLAG nobackface on|off
FLAG realobj on|off
FLAG propagate on|off        // only meaningful if realobj is set
FLAG clipping_plane on|off   // plane through object origin; normal = +Z in world
FLAG gouraud on|off
FLAG lwgroup on|off
FLAG localgroup on|off
FLAG concave on|off
FLAG proc_bound on|off
```
Alternative bitmask API:
```
set   (MASK_EXPR)            // names from dive.vh
clear (MASK_EXPR)
```

### 3.4 Gateway
```
gateway "WORLD_NAME" v X Y Z
```
- Declares a portal into another world at a start position.

### 3.5 Transformations
Applied in order in local space:
- `eulerxyz v AX AY AZ` — rotate around object X, then Y, then Z (rotating frame)
- `fixedxyz v AX AY AZ` — rotate around fixed world axes X, Y, Z
- `rotation v X1 Y1 Z1 v X2 Y2 Z2 v X3 Y3 Z3` — explicit 3×3 basis (rows); normalized
- `translation v X Y Z` — relative translate

### 3.6 Properties & Methods
Properties:
```
prop "NAME" TYPE_INT|TYPE_FLOAT|TYPE_STRING VALUE [GLOBAL_PROP|LOCAL_PROP]
```
- Common special property:
  `prop "camera" TYPE_FLOAT 0 GLOBAL_PROP` — mark viewpoints for tools/renderers

Methods (Tcl behavior):
- Block form:
  ```
  begin.tcl
    ... Dive/Tcl code ...
  end.tcl
  ```
- Or inline Tcl file:
  ```
  inline.tcl "URL" [args...]
  ```

### 3.7 Lights
```
light {
  [ name "STRING" ]
  DLIGHT [ambient r g b] [color r g b]
| PLIGHT [ambient r g b] [color r g b]
| SLIGHT [ambient r g b] [color r g b] [exponent s] [spread a]
}
```
- `DLIGHT`: directional (direction = object +Z; position ignored).
- `PLIGHT`: point light at object position.
- `SLIGHT`: spotlight; direction = object +Z; exponent `0..128`; spread `0..π/2` (radians).
- If the object is invisible, the light is disabled.

### 3.8 Inline (child-level)
```
object { inline "URL" }
```
- Inserts referenced DIVE `.vr` or VRML `.wrl` as a child.

---

## 4) Views (Geometry) — `view { ... }`

Wrapper:
```
view {
  [ name "STRING" ]
  [ material_index I ]              // into parent object’s material vector
  [ texture_index  I ]              // into parent object’s texture vector
  [ texture_mode TEXTURE_DECAL|TEXTURE_MODULATE|TEXTURE_BLEND ]
  [ FLAG visibility|wireframe|gouraud|nobackface|concave on|off ]*
  VIEW_PRIMITIVE                    // one of the primitives below
}
```

Primitives (summary):
- LINE / N_LINE
  - `view { LINE v x y z v x y z }`
  - `view { N_LINE N v ... }` — N vertices → N-1 segments

- RBOX (axis-aligned box by 2 corners)
  - `view { RBOX v x0 y0 z0 v x1 y1 z1 }`

- N_POLY (single convex polygon)
  ```
  view { N_POLY N
          v x y z [t u v]
          ... (N vertices) }
  ```

- N_M_POLY / QMESH / TMESH (multi-polygons/meshes)
  - Complex format with flags; support per-vertex or per-primitive attributes.

- indexed_poly (preferred since 3.2)
  ```
  view {
    indexed_poly PRIM_TYPE FLAGS
      vertexlist { x y z, ... }
      [ normallist { nx ny nz, ... } ]
      [ texturelist { u v, ... } ]
      polylist { i0 i1 i2 ... -1,  i0 i1 ... -1, ... }  // REQUIRED; -1 ends a primitive
      [ normalindexlist { ... } ]
      [ textureindexlist { ... } ]
      [ materiallist { ... } ]
      [ colourlist { r g b, ... } ]
  }
  ```
  - `PRIM_TYPE ∈ { PRIM_POINTS | PRIM_LINES | PRIM_POLY | PRIM_TMESH | PRIM_QMESH }`
  - `FLAGS` indicate per-vertex/primitive attributes (normals, texcoords, materials, etc.)

- SPHERE / ELLIPSE / CYL
  - `SPHERE rx ry rz` — ellipsoid when non-uniform
  - `ELLIPSE rx ry`
  - `CYL rx ry height [ratio] [PART_TOP|PART_BOTTOM]` — axis = +Y

- QUAD_GRID
  - `QUAD_GRID NX NY v p0 v p1 v p2 v p3`

- TEXT / LTEXT / CTEXT / RTEXT
  - `CTEXT HEIGHT "string" "font"` — HEIGHT in meters; font `"default"`→`"ccp"`; `"2d"` is screen-fixed

- BACKGROUND (environment)
  Two modes:
  1. Spherical: set `texture_index I` in the wrapper, then use `BACKGROUND` (seam on -Z).
  2. Cubemap:
     ```
     BACKGROUND
       texture_indices L R F B T Bo
     ```
  - Only the first encountered `BACKGROUND` is used by the renderer.

---

## 5) Scene Graph Nodes Besides `object`

### `billboard { ... }`
```
billboard {
  [ name "STRING" ]
  axis X Y Z              // rotation axis; (0,0,0)=screen-aligned
  [ FLAGS ... ] [ inline ... ]
  ( view | object | billboard | lod | switch )*
}
```
- Rotates children so their +Z faces the viewer; upright sprites use axis `0 1 0`.

### `lod { ... }` (modern LOD)
```
lod {
  [ name "STRING" ]
  range { d1, d2, ... } | angle { a1, a2, ... }  // distances (m) or angles (radians)
  ( children ... )
}
```
- `range`: child 0 in `[0..d1)`, child 1 in `[d1..d2)`, child 2 in `[d2..∞)`.
- `angle`: select by angular threshold to viewer.

Legacy: `lodrange { … }` inside `object` exists; prefer node form.

### `switch { ... }`
```
switch {
  [ name "STRING" ]
  choice I                 // 0-based; -1 = none; -3 = render all
  ( children ... )
}
```
- Typically controlled by Tcl at runtime.

### Top-level inline
```
inline "URL"
```
- Top-level embedding (DIVE `.vr` or VRML `.wrl`).
- For DIVE inlines, you may append CPP defines (e.g., `-DDIST=4`).

---

## 6) Minimal Grammar (EBNF-style)
```
File          := [WorldDecl] (ObjectNode | InlineTop)*

WorldDecl     := 'world' String '{' WorldProp* '}'
WorldProp     := 'start' 'v' Float Float Float
               | 'info' String
               | 'background' Float Float Float
               | 'fog' Float
               | 'terrain' URL
               | 'color' Float Float Float
               | 'ambient' Float Float Float
               | 'position' Float Float Float
               | 'far_clip' Float
               | 'near_clip' Float

ObjectNode    := Object | Billboard | Lod | Switch

Object        := 'object' '{'
                 [ 'id' Int ] [ 'name' String ]
                 MaterialDecl* TextureDecl* FlagsDecl*
                 [ GatewayDecl ] Transformation*
                 PropertyDecl* MethodDecl* LightDecl*
                 InlineDecl* [ LegacyLODDecl ]
                 ( View | ObjectNode )*
                 '}'

Billboard     := 'billboard' '{'
                 [ 'name' String ] 'axis' Float Float Float
                 FlagsDecl* InlineDecl* ( View | ObjectNode )*
                 '}'

Lod           := 'lod' '{'
                 [ 'name' String ]
                 ( 'range' '{' FloatList '}' | 'angle' '{' FloatList '}' )
                 FlagsDecl* InlineDecl* ( View | ObjectNode )*
                 '}'

Switch        := 'switch' '{'
                 [ 'name' String ] 'choice' Int
                 FlagsDecl* InlineDecl* ( View | ObjectNode )*
                 '}'

View          := 'view' '{'
                 [ 'name' String ] [ 'material_index' Int ]
                 [ 'texture_index' Int ] [ 'texture_mode' TexMode ]
                 ViewFlags*
                 ViewPrim
                 '}'

ViewPrim      := Line | NLine | RBox | NPoly | N_M_Poly | IndexedPoly
               | Sphere | Ellipse | Cyl | QuadGrid
               | TextView | Background

Line          := 'LINE' 'v' V3 'v' V3
NLine         := 'N_LINE' Int ( 'v' V3 )+
RBox          := 'RBOX' 'v' V3 'v' V3
NPoly         := 'N_POLY' Int ( 'v' V3 [ 't' Float Float ] )+
N_M_Poly      := ( 'N_M_POLY' | 'QMESH' | 'TMESH' ) Int Int Flags
                 ( N_POLY ( [ 'm' Int ] ) )+
IndexedPoly   := 'indexed_poly' PrimType Flags
                 ( VertexList | NormalList | TextureList
                   | PolyList | NormalIndexList | TextureIndexList
                   | MaterialList | ColourList )+
Sphere        := 'SPHERE' Float Float Float
Ellipse       := 'ELLIPSE' Float Float
Cyl           := 'CYL' Float Float Float [ Float [ 'PART_TOP' | 'PART_BOTTOM' ] ]
QuadGrid      := 'QUAD_GRID' Int Int 'v' V3 'v' V3 'v' V3 'v' V3
TextView      := ( 'TEXT' | 'LTEXT' | 'CTEXT' | 'RTEXT' ) Float String String
Background    := 'BACKGROUND' [ 'texture_indices' Int Int Int Int Int Int ]

MaterialDecl  := 'material' ( String | 'rgb' Float Float Float | '{' MaterialProps '}' )
TextureDecl   := 'texture' String
FlagsDecl     := 'FLAG' FlagKey ('on'|'off') | 'set' '(' MaskExpr ')' | 'clear' '(' MaskExpr ')'
GatewayDecl   := 'gateway' String 'v' V3
Transformation:= 'eulerxyz' 'v' V3 | 'fixedxyz' 'v' V3
               | 'rotation' 'v' V3 'v' V3 'v' V3 | 'translation' 'v' V3
PropertyDecl  := 'prop' String TypeKw Value [ 'GLOBAL_PROP' ]
MethodDecl    := 'begin.tcl' TclText 'end.tcl' | 'inline.tcl' String ( String )*
LightDecl     := 'light' '{' [ 'name' String ] (DLight|PLight|SLight) '}'
LegacyLODDecl := 'lodrange' '{' FloatList '}'
InlineDecl    := 'inline' String
InlineTop     := 'inline' String

// Helpers
V3            := Float Float Float
FloatList     := Float ( [',' ] Float )*
Flags         := ( FlagName )*               // OR-combo: C_PER_* N_PER_* T_PER_* M_PER_*
ViewFlags     := ( 'FLAG' (visibility|wireframe|gouraud|nobackface|concave) ('on'|'off') )*
PrimType      := 'PRIM_POINTS' | 'PRIM_LINES' | 'PRIM_POLY' | 'PRIM_TMESH' | 'PRIM_QMESH'
TexMode       := 'TEXTURE_DECAL' | 'TEXTURE_MODULATE' | 'TEXTURE_BLEND'
VertexList    := 'vertexlist' '{' ( V3 ',' )* V3 '}'
NormalList    := 'normallist' '{' ( V3 ',' )* V3 '}'
TextureList   := 'texturelist' '{' ( Float Float ',' )* Float Float '}'
PolyList      := 'polylist' '{' ( (Int ' ')+ '-1' ',' )* (Int ' ')+ '-1' '}'
NormalIndexList  := 'normalindexlist' '{' ( Int ',' )* Int '}'
TextureIndexList := 'textureindexlist' '{' ( Int ',' )* Int '}'
MaterialList     := 'materiallist' '{' ( Int ',' )* Int '}'
ColourList       := 'colourlist' '{' ( Float Float Float ',' )* Float Float Float '}'
TypeKw        := 'TYPE_INT' | 'TYPE_FLOAT' | 'TYPE_STRING'
```

---

## 7) Rendering Notes for a Basic Viewer

- Traversal: apply world settings (background color/fog/clipping/light), then render object hierarchies. Honor object/view flags (`visibility`, `wireframe`, `gouraud`, `nobackface`, `concave`).
- Transforms: compose parent→child. `billboard` overrides child orientation at draw time (axis rule: `(0,1,0)` for upright sprites; `(0,0,0)` = screen-aligned).
- Materials & textures: view-level `material_index`/`texture_index` pick from parent vectors. Texture mode mirrors standard GL behavior.
- Geometry: prefer `indexed_poly` for modern meshes; parse `polylist` into faces, splitting on `-1`. `N_POLY` = single convex face. `N_M_POLY` is older but common; respect per-prim `m I` when present.
- Backgrounds: render only the first `BACKGROUND` found (spherical via `texture_index`, or cubemap via `texture_indices L R F B T Bo`).
- LOD & switch: select lod child by distance (range) or angle; switch by `choice` (`-1` none; `-3` all).
- Inline: for a first implementation, support local includes and inline of local `.vr`; if remote fetch is non-trivial, parse and log unresolved references without failing the whole load.

---

## Version & Compatibility
- Targets DIVE 3.2/3.3x, incorporating legacy constructs (`BOX`/`BOXVECTOR`, object-embedded `lodrange`) with guidance to prefer modern forms (`indexed_poly`, `lod` node).
- Behavior scripts rely on Dive/Tcl; a minimal viewer may ignore `begin.tcl`/`inline.tcl` blocks at first, but should not choke on their syntax.
- Angles are radians. Distances are meters.

---

## Reference

`[1]` Avatare, Frécon, Hagsand, Jää-Aro, Simsarian, Stenius, Ståhl — "DIVE — The Distributed Interactive Virtual Environment: DIVE Files Description (v3.3x)". 

Available from ResearchGate: [DIVE — The Distributed Interactive Virtual Environment: DIVE Files Description (v3.3x)](https://www.researchgate.net/publication/2627184_DIVE_---_The_Distributed_Interactive_Virtual_Environment_DIVE_Files_Description)
Distributed Interactive Virtual Environment - DIVE Files Description for DIVE
version 3.3x - https://www.researchgate.net/publication/2627184_DIVE_---_The_Distributed_Interactive_Virtual_Environment_DIVE_Files_Description
