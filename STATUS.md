# Status

_Last updated: 2026-08-24_

## Where things stand

v1.0.0 is complete and builds clean. Seven districts, 40 buildings, 9 flow lanes, a 14-step guided
tour, command palette, first-person walk mode, and a live simulation driven from the Control Room.

- `npm run typecheck` — clean (TypeScript strict, `noUnusedLocals`).
- `npm run build` — clean, no warnings. Output ≈ 648 kB JS / 173 kB gzipped, 16 kB CSS.

## Not yet verified

**The app has not been opened in a browser yet.** Typecheck and production build both pass, and the
three.js APIs used are type-checked against `@types/three` 0.185, but no runtime smoke test has been
run. First thing to do next session:

```bash
npm run dev
```

and check: labels render and fade with distance, clicking a building opens the inspector, `1`–`7`
fly between districts, `F` enters pointer-lock walk mode, `Ctrl/⌘ K` opens the palette, `T` runs the
tour, and the page grid animates with the workload slider.

## Ideas, not commitments

- A lock/deadlock district (record, gap, next-key locks are currently only described inside Purge
  Gardens).
- A "what breaks" mode: force a scenario (redo too small, purge blocked, pool too small) and let the
  city visibly degrade, with the diagnosis written out.
- Query path replay: type a `SELECT` and watch the specific lanes it lights up.
- Screenshot/permalink of the current camera + sim state.
- MySQL vs PostgreSQL toggle — the district layout maps almost one-to-one (buffer pool ↔ shared
  buffers, redo ↔ WAL, purge ↔ autovacuum), and the original brief mentioned both.
- Touch controls; the app is desktop-first today.
