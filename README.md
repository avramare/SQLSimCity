# SQLSimCity

An explorable 3D city that models **how MySQL 8.4 / InnoDB actually works**.

Every district is a real database mechanism. Every building is a real component, thread, or on-disk
structure. The traffic between them is the real path a statement takes — from the connection gate,
through the buffer pool, into the redo log, out to replicas, and eventually down to disk.

It is a single static browser app. No server, no database, no network calls at runtime.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
npm run preview  # serve the built bundle
```

---

## What you can do

| | |
|---|---|
| **Orbit / zoom / pan** | drag, wheel, right-drag |
| **Walk in first person** | `F`, then `WASD` (`shift` to run), `Esc` to leave |
| **Jump to a district** | `1`–`7`, or `0` for the city overview |
| **Inspect a building** | click it — the panel explains the mechanism, its system variables, and a query that shows it on a real server |
| **Command palette** | `Ctrl`/`⌘` + `K` — fuzzy search every district, building, and action |
| **Guided tour** | `T` — 14 steps following one `UPDATE` through the entire server |
| **Cycle labels** | `L` (all → districts only → none) |
| **Drive the simulation** | Control Room, bottom left: workload, `innodb_flush_log_at_trx_commit`, `sync_binlog`, adaptive flushing, an idle long transaction |
| **Pause / workload** | `space`, `[`, `]` |
| **Help** | `H` or `?` |

Deep links work: `index.html#redo-wharf` or `index.html#page-grid` opens the app framed on that
district or building.

---

## The city

| Key | District | MySQL mechanism |
|---|---|---|
| `1` | **Thread City** | Connection handling, thread cache, parser, cost-based optimizer, executor, per-session buffers |
| `2` | **Buffer Pool Central** | `innodb_buffer_pool` — 16 KB pages, LRU young/old sublists, free list, flush list, change buffer, adaptive hash index, read-ahead |
| `3` | **Redo Wharf** | Write-ahead logging — log buffer, log writer/flusher threads, `#innodb_redo` files, LSN, group commit, crash recovery |
| `4` | **Storage Yards** | Tablespaces — `.ibd` files, clustered index B+tree, secondary indexes, doublewrite buffer, row formats, extents and segments |
| `5` | **Checkpoint Heights** | Fuzzy checkpointing — page cleaner threads, checkpoint LSN, adaptive flushing, I/O capacity, sync-flush stalls |
| `6` | **Purge Gardens** | MVCC — undo tablespaces, read views, purge threads, history list length, record/gap/next-key locks |
| `7` | **Replica Harbor** | Binary log — two-phase commit with redo, dump thread, relay log, parallel appliers, GTIDs |

The lanes between districts are labelled with what actually flows along them: page requests, redo
records, dirty page flushes, old row versions, binlog events, checkpoint LSN advances. Focusing a
district dims the lanes that do not touch it.

---

## The live model

The Control Room drives a small simulation whose feedback loops are the ones that matter in
production:

- **writes → redo → checkpoint age.** More write throughput generates redo faster, which pushes
  checkpoint age (current LSN − checkpoint LSN) up against `innodb_redo_log_capacity`.
- **checkpoint age → flushing.** Adaptive flushing raises the page cleaner rate as redo fills.
  Turn it off and watch checkpoint age sawtooth into a stall — the pre-adaptive world.
- **durability → fsync rhythm.** `innodb_flush_log_at_trx_commit = 1` makes the Durability
  Lighthouse flash per commit group; `2` slows it to once per second.
- **open transactions → purge.** Tick *idle long transaction* and history list length climbs
  without limit, exactly as it does when someone leaves a `SELECT` open in a shell.

The buffer pool floor is instanced geometry: one tile per page frame, coloured clean / dirty / free
and re-heighted every frame from the simulated state.

It is a teaching model of the feedback loops, not a MySQL emulator. Numbers, defaults, and behaviour
descriptions follow the MySQL 8.4 reference manual — see [`docs/MYSQL-MODEL.md`](docs/MYSQL-MODEL.md)
for the mapping and the sources.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the app is put together and how a frame runs.
- [`docs/MYSQL-MODEL.md`](docs/MYSQL-MODEL.md) — district-by-district mapping to real MySQL
  mechanisms, the simulated feedback loops, and what is deliberately simplified.
- [`docs/CONTENT.md`](docs/CONTENT.md) — how to add or edit a district, a building, a flow lane, or a
  tour step.
- [`STATUS.md`](STATUS.md) — current state and open ideas.
- [`CHANGELOG.md`](CHANGELOG.md) — release history.

## Stack

- [three.js](https://threejs.org) r185 (WebGL renderer, `CSS2DRenderer` for the floating labels,
  `OrbitControls` + `PointerLockControls`)
- TypeScript 5.9, strict
- Vite 7 — `base: './'`, so `dist/` can be served from any path, including `file://`-style static
  hosts, GitHub Pages, S3, or Netlify with no configuration.

No runtime dependencies beyond three.js; no fonts, images, or scripts are fetched from the network.

## License

MIT.
