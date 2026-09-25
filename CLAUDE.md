# SQLSimCity — working notes

A static 3D explorable city that models MySQL 8.4 / InnoDB. See `STATUS.md` for current work.

## Commands

```bash
npm run dev        # vite dev server on :5173
npm run build      # tsc --noEmit && vite build → dist/
npm run preview    # serve the built bundle
npm run typecheck  # tsc --noEmit
```

`npm run build` gates on a clean typecheck. Keep it warning-free.

## Architecture in one paragraph

`src/data/districts.ts` is the single source of truth: plain data, no three.js, no DOM. `scene/city.ts`
turns it into geometry, `ui/*` renders it as HTML, `main.ts` derives camera framing and colliders from
it. Add a building to the data file and it appears in the scene, the inspector, the command palette,
the collision set, and as a deep link — no other edits. Details in `docs/ARCHITECTURE.md`, content
authoring in `docs/CONTENT.md`.

## Conventions

- **Content accuracy is the product.** Every number, default, and variable name in
  `src/data/districts.ts` must match the MySQL 8.4 reference manual. Check the docs before changing
  one; note where 8.4 changed a default from 8.0. Sources are listed in `docs/MYSQL-MODEL.md`.
- **No network at runtime.** No CDN scripts, no web fonts, no remote assets. Textures are generated
  on a canvas at startup.
- **Nothing allocates in the frame loop.** Scratch `Vector3`/`Matrix4`/`Quaternion` live at module
  scope; particle buffers are preallocated `Float32Array`s.
- three.js r185: `PCFSoftShadowMap` is deprecated for `WebGLRenderer` — use `PCFShadowMap`. Lights are
  physically-based; there is no legacy lighting mode.
- Addons import from `three/addons/...`, which resolves through the `three` package exports map.
- TypeScript is strict with `noUnusedLocals`/`noUnusedParameters`. Keep it that way.

## Gotchas

- Building `id`s must be unique across the entire city — they are the palette key, the deep-link
  hash, and the raycast `userData` key.
- District plates are colliders with `r > 30`; `controls/rig.ts` treats those as walkable ground and
  everything smaller as solid. Do not give a building a radius above 30.
- `CSS2DRenderer` is constructed over the existing `#labels` element; it writes inline
  `width`/`height` on it, so leave the positioning to the stylesheet.
