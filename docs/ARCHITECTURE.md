# Architecture

SQLSimCity is a static single-page app. Everything runs in the browser: there is no server, no
database, and no network traffic after the bundle loads.

```
index.html          static chrome: topbar, district rail, inspector, control room,
                    tour, palette, help overlay, boot screen
src/
  main.ts           composition root — wiring, picking, keyboard, palette contents, frame loop
  sim.ts            the simulated server (metrics + feedback loops)
  types.ts          shared content and state types
  style.css         all UI and floating-label styling
  data/
    districts.ts    THE CONTENT: 7 districts, 40 buildings, 9 flow lanes
    tour.ts         14-step guided tour
  scene/
    world.ts        renderer, camera, lights, sky, ground, resize
    city.ts         builds districts and buildings from data; animated set pieces; labels
    flows.ts        curved particle lanes between districts
  controls/
    rig.ts          camera rig: orbit, fly-to tween, first-person walk with collisions
  ui/
    hud.ts          metrics readout, district rail, control room wiring
    inspector.ts    right-hand panel renderer
    palette.ts      command palette with fuzzy ranking
    tour.ts         tour panel controller
```

## Data flows one way

`data/districts.ts` is the single source of truth. It is plain data — no three.js, no DOM. Three
consumers read it:

1. **`scene/city.ts`** turns each district into a platform, a glowing rim, floating labels, and one
   mesh group per building. Meshes carry `userData.buildingId` / `userData.districtId`, which is
   what raycast picking reads back.
2. **`ui/*`** renders the same data as HTML — the district rail, the inspector panel, the palette
   entries.
3. **`main.ts`** derives camera framing and first-person colliders from it.

Adding a building to the data file therefore adds it to the 3D scene, the inspector, the palette,
and the collision set at once. See [`CONTENT.md`](CONTENT.md).

## The frame loop

`main.ts` runs one `requestAnimationFrame` loop:

```
sim.tick(dt)                     advance the simulated server
rig.update(dt)                   fly-to tween, orbit damping, or walk movement + collisions
city.update(dt, t, sim, camera)  page grid, redo band, beacons, label visibility, selection
flows.update(dt, sim)            move lane particles, dim unfocused lanes
hud.update(sim)                  metric values and warning tones
[every 3rd frame]                hover raycast
renderer.render()                WebGL
labelRenderer.render()           CSS2D labels
```

Nothing allocates per frame in the hot paths: scratch `Vector3`/`Matrix4`/`Quaternion` objects are
module-level, particle positions live in preallocated `Float32Array`s, and unused particles are
parked below the world rather than resized out of the buffer.

## Rendering notes

- **Labels** are real DOM elements positioned by `CSS2DRenderer`, so they stay crisp at any zoom and
  can be styled with CSS. Visibility is driven by camera distance, the current label mode
  (`all` / `districts` / `none`), and which district is focused.
- **The buffer pool floor** is a single `InstancedMesh` of 484 tiles. Each frame every instance gets
  a new colour and height from the simulated dirty/free ratios, so the pool visibly fills, dirties,
  and drains.
- **Flow lanes** are `QuadraticBezierCurve3`s with a translucent tube plus additive `Points`. Lane
  traffic density and speed scale with simulated throughput and each lane's `loadFactor`.
- **Shadows** use `PCFShadowMap` — `PCFSoftShadowMap` is deprecated for `WebGLRenderer` as of three
  r185 and PCF is soft there now. They can be switched off in the Control Room.
- **Lighting** is hemisphere + directional + a cool rim light, with ACES tone mapping. Buildings use
  an emissive window texture generated on a canvas at startup; nothing is loaded from disk.

## Camera rig

`controls/rig.ts` owns the camera in two modes:

- **orbit** — `OrbitControls` with damping. `flyTo(position, target, ms)` disables the controls,
  tweens both the camera and the orbit target with an ease-in-out cubic, then re-enables them. This
  is what district jumps, building focus, palette entries, and tour steps all use.
- **walk** — `PointerLockControls` with `WASD`, sprint on shift, eye height 7.5 units, circle
  collision against every building, and a step-up onto district platforms. Leaving walk mode places
  the orbit target 45 units ahead of where the walker was looking, so the view never jumps.

## The simulation

`sim.ts` holds a `SimConfig` (what the user sets) and a `SimState` (what the model produces). It is
about 100 lines and deliberately readable: throughput eases toward the workload target, writes
generate redo, redo pins the checkpoint, flushing releases it, and open read views block purge.

Its output drives the HUD numbers, the page grid colours, the redo band fill, the checkpoint beacon
hue, the history-list tower height, the fsync beacon flash, and every lane's particle rate.

## Build and deploy

`npm run build` runs `tsc --noEmit` and then Vite. Output is a static `dist/` with hashed assets and
`base: './'`, so it works from any subdirectory — GitHub Pages, S3, Netlify, or a plain file server —
without configuration.
