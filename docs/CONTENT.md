# Editing the city

All content lives in two plain-data files. Neither imports three.js or touches the DOM.

- `src/data/districts.ts` — districts, buildings, flow lanes
- `src/data/tour.ts` — the guided tour

Types are in `src/types.ts`; `tsc` will tell you what you missed.

## Add a building

Append to a district's `buildings` array:

```ts
{
  id: 'lock-monitor',              // unique across the whole city; also the deep-link hash
  name: 'Lock Monitor',
  role: 'Waits and deadlocks',     // one line, shown under the name and on the label
  kind: 'tower',                   // tower | block | slab | silo | dome | stack | ring | gate
  pos: [12, -18],                  // x, z within the district (keep inside `radius`)
  size: [14, 26, 14],              // width, height, depth
  landmark: false,                 // landmarks stay labelled at any distance and glow harder
  summary: 'One paragraph explaining what this component does.',
  details: [
    'A specific, checkable fact.',
    'A consequence an operator would actually notice.',
  ],
  vars: [['innodb_lock_wait_timeout', 'Seconds a statement waits for a row lock']],
  observe: 'SELECT * FROM performance_schema.data_lock_waits;',
}
```

That one object gives you the mesh, the floating label, an inspector page, a palette entry, a
first-person collider, and the deep link `#lock-monitor`. Nothing else needs editing.

Layout rules of thumb: keep `pos` within about `radius - size/2` of the centre, keep buildings at
least ~14 units apart so labels do not collide, and give each district exactly one `landmark`.

## Add a district

Append to `DISTRICTS`. Required extras beyond the building list:

- `hotkey` — a digit, `1`–`9`. It becomes the keyboard shortcut and shows in the rail and labels.
- `center` — `[x, z]` in world units. The existing seven sit on a hexagon of radius ~120 around the
  buffer pool at the origin; keep new districts off that ring or it will look crowded.
- `color` / `accent` — hex numbers. `color` drives the rim, labels, chip, and inspector accent;
  `accent` is the emissive window colour. Pick something clearly distinct from the seven in use.
- `view.offset` — `[_, height, distance]`; the camera framing used when you jump to it. The x
  component is ignored: the approach direction is derived from the district's position so the camera
  always looks inward.
- `mechanism`, `blurb`, `bullets` — the teaching copy shown in the inspector.

## Add a flow lane

Append to `FLOWS`:

```ts
{
  id: 'undo-read',
  from: 'purge-gardens',       // district id
  to: 'buffer-pool',           // district id
  label: 'version chain reads',// lowercase; drawn at the midpoint of the lane
  color: 0xff5fa2,
  bow: -18,                    // lateral bow in world units; sign flips the side
  density: 40,                 // particle budget
  loadFactor: 0.6,             // how strongly workload scales this lane's traffic
  note: 'Shown in the Help legend.',
}
```

Give lanes between the same pair of districts opposite `bow` signs so they do not overlap.

## Add a tour step

Append to `TOUR` in `src/data/tour.ts`:

```ts
{
  id: 'locks',
  title: 'Where writers actually wait',
  district: 'purge-gardens',
  building: 'row-locks',       // optional; frames the building instead of the district
  body: 'Two or three sentences. Written to be read aloud.',
  set: { workload: 2 },        // optional; nudges the simulation when the step opens
}
```

The step counter, dots, and keyboard navigation all derive from the array length.

## Editing the simulation

`src/sim.ts` is intentionally small. `SimConfig` is what the Control Room sets, `SimState` is what
the model produces, and `tick(dt)` is one page of arithmetic. If you add a state field, add its
readout in `index.html` (a `.metric` block) and in `ui/hud.ts` (`update`), and drive whatever geometry
should react to it from `scene/city.ts`.

## House style for the copy

- Say the real identifier: `innodb_redo_log_capacity`, not "the redo setting".
- Prefer the consequence an operator would see over the internal detail alone.
- Quote 8.4 defaults, and call out where 8.4 changed a default from 8.0.
- Keep `details` bullets to one idea each. They are read on a panel, not on a page.
