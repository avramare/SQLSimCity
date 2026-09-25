# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [1.0.0] — 2026-08-24

First release.

### Added

- **Seven districts** modelling MySQL 8.4 / InnoDB: Thread City, Buffer Pool Central, Redo Wharf,
  Storage Yards, Checkpoint Heights, Purge Gardens, Replica Harbor — 40 inspectable buildings in
  total, each with a summary, details, the system variables that govern it, and a query that shows it
  on a real server.
- **Nine labelled flow lanes** between districts (page requests, redo records, dirty page flushes,
  old row versions, binlog events, checkpoint LSN advances) with traffic that scales with workload.
- **Navigation**: orbit/zoom/pan, `1`–`7` district jumps with camera fly-to, `0` overview,
  click-to-inspect with hover highlighting, and deep links (`#redo-wharf`, `#page-grid`).
- **First-person walk mode** (`F`) with `WASD`, sprint, building collisions, and step-up onto
  district platforms.
- **Command palette** (`Ctrl`/`⌘ K`) with fuzzy ranking over every district, building, and action.
- **Guided tour** (`T`) — 14 steps following one `UPDATE` from the connection gate to purge.
- **Live simulation** with a Control Room: workload level, `innodb_flush_log_at_trx_commit`,
  `sync_binlog`, adaptive flushing, and an idle long transaction that blocks purge. Drives the HUD
  metrics, the instanced buffer pool floor, the redo band, and the checkpoint beacon.
- **Floating CSS2D labels** with distance fading and three label modes (`L`).
- Help overlay with a full keymap and a flow legend (`H`).
- Docs: `docs/ARCHITECTURE.md`, `docs/MYSQL-MODEL.md`, `docs/CONTENT.md`.

[1.0.0]: https://github.com/
