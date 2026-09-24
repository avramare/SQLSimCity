# What the city maps to

The model is **MySQL 8.4 with InnoDB**, a single server plus replicas. Defaults quoted in the app are
8.4 defaults; where 8.4 changed a default from 8.0, the app says so.

## Districts

### 1 · Thread City — the SQL layer
One thread per connection (`thread_handling` default), recycled through the thread cache. A statement
is parsed, resolved against the transactional data dictionary (`mysql.ibd`), costed by the optimizer
using index statistics and the cost constant tables, then executed as a stream of handler-API calls
into the storage engine. Per-session buffers (`sort_buffer_size`, `join_buffer_size`, TempTable) are
allocated here, per thread — which is why they multiply by `max_connections`.

**Key idea:** nothing below this district understands SQL.

### 2 · Buffer Pool Central — the page cache
16 KB pages (`innodb_page_size`), carved into instances and 128 MB chunks so the pool can be resized
online. The LRU is split into a young sublist and an old sublist with midpoint insertion
(`innodb_old_blocks_pct` 37, `innodb_old_blocks_time` 1000 ms) — that is what makes a big scan
scan-resistant. Dirty pages hang on the flush list keyed by their oldest unwritten LSN. The free list
holds ready frames; when it empties, user threads flush inline and `Innodb_buffer_pool_wait_free`
climbs.

Also modelled: the change buffer (`innodb_change_buffering` now **`none`** in 8.4, deprecated), the
adaptive hash index (now **`OFF`** in 8.4), and linear read-ahead
(`innodb_read_ahead_threshold` 56).

**Key idea:** InnoDB never touches a row on disk; it touches pages in memory.

### 3 · Redo Wharf — write-ahead logging
Changes become redo records inside mini-transactions, appended to the 16 MB log buffer, written by
the dedicated `log_writer` thread and fsynced by `log_flusher`. On disk the redo log is a fixed-size
circular set of files under `#innodb_redo/`, sized by `innodb_redo_log_capacity` (default 100 MB,
resizable online; `innodb_log_file_size` / `innodb_log_files_in_group` are deprecated).

`innodb_flush_log_at_trx_commit` decides what "committed" means (1 = fsync per commit group,
2 = fsync per second, 0 = write and fsync per second). Group commit amortises fsyncs across
concurrent transactions. Crash recovery replays redo from the checkpoint LSN, then rolls back
uncommitted transactions using undo.

**Key idea:** a commit waits for the log, not for the data pages.

### 4 · Storage Yards — the durable copy
Page (16 KB) → extent (1 MB / 64 pages) → segment (per index, leaf and non-leaf) → tablespace file.
`innodb_file_per_table` gives each table its own `.ibd`. The table *is* its primary key B+tree
(clustered index) with full rows in the leaves; secondary indexes store the primary key, so a wide PK
inflates every index and a random PK turns inserts into random writes and page splits. The
doublewrite buffer (its own files since 8.0.20) repairs torn 16 KB writes at recovery. `DYNAMIC` row
format pushes long columns off-page.

**Key idea:** the shape of your primary key is the shape of your storage.

### 5 · Checkpoint Heights — flushing
Fuzzy checkpointing: page cleaner threads (`innodb_page_cleaners`, in 8.4 defaulting to the number of
buffer pool instances) continuously write the oldest dirty pages and scan `innodb_lru_scan_depth`
pages at the cold end to keep frames free. Adaptive flushing scales the rate from redo generation and
dirty ratio (`innodb_adaptive_flushing_lwm`, `innodb_max_dirty_pages_pct`), spending an
`innodb_io_capacity` budget (default 10000 in modern 8.x, tuned for SSDs) up to
`innodb_io_capacity_max`.

Checkpoint age = current LSN − checkpoint LSN. As it approaches redo capacity, InnoDB moves from
comfortable to async to synchronous flushing, and synchronous flushing is a stall.

**Key idea:** flush steadily or stall periodically; there is no third option.

### 6 · Purge Gardens — MVCC
Rows carry `DB_TRX_ID` and `DB_ROLL_PTR`; previous versions live in undo tablespaces (128 rollback
segments each, auto-truncated past `innodb_max_undo_log_size`). A read view is a snapshot of active
transaction ids — `REPEATABLE READ` takes one per transaction, `READ COMMITTED` one per statement.
Deletes only delete-mark; purge threads (`innodb_purge_threads` 4) remove records and their secondary
index entries once no read view needs them. History list length is the un-purged backlog. Writers
take record, gap, and next-key locks on index records.

**Key idea:** one idle open transaction can block all cleanup, forever.

### 7 · Replica Harbor — the binary log
The binlog is a second, logical, commit-ordered log (`log_bin` ON by default, `binlog_format=ROW`,
`sync_binlog=1`). Internal two-phase commit keeps it consistent with redo: prepare in InnoDB, write
the binlog, commit in InnoDB. A dump thread streams events per replica; the replica's receiver thread
writes the relay log and parallel appliers (`replica_parallel_workers` 4,
`replica_preserve_commit_order` ON) apply it. MySQL 8.4 always uses writeset-based dependency
tracking on the source — `binlog_transaction_dependency_tracking` was removed and the behaviour is
internal now. GTIDs make failover and reconnection possible without file/position bookkeeping.

**Key idea:** redo makes a server crash-safe; the binlog makes a fleet.

## The simulated feedback loops

`src/sim.ts` models four loops and nothing else:

| Loop | In the app |
|---|---|
| write throughput → redo generation → checkpoint age | *checkpoint age* metric, redo band fill, checkpoint beacon hue |
| checkpoint age + dirty ratio → flush rate → checkpoint advance | dirty page tiles draining, *dirty pages* metric |
| `innodb_flush_log_at_trx_commit` → fsync rhythm | Durability Lighthouse flash, *fsyncs/s* metric |
| open read view → purge blocked → history growth | *history list* metric, History List Monument height |

## What is deliberately simplified

- Throughput, hit rate, and replica lag are eased toward plausible targets; they are not derived from
  a real workload, a real plan, or real I/O timings.
- There is one buffer pool instance visually (484 tiles), not `innodb_buffer_pool_instances` of them.
- Redo is treated as a single circular stream with a percentage used, not 32 real files with real
  LSN arithmetic.
- Locking, deadlock detection, DDL, group replication, and the performance schema are described in
  the inspector but are not simulated.
- The `observe` query on each building is a real query you can run on a real server — it is not run
  by the app.

## Sources

All defaults and behaviour statements were checked against the MySQL 8.4 reference manual:

- [InnoDB Startup Options and System Variables](https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html)
  — `innodb_change_buffering` default `none` in 8.4 (was `all`), `innodb_adaptive_hash_index` default
  `OFF` in 8.4 (was `ON`), `innodb_buffer_pool_chunk_size` 128 MB, deprecation of
  `innodb_log_file_size` / `innodb_log_files_in_group`.
- [Redo Log](https://dev.mysql.com/doc/refman/8.4/en/innodb-redo-log.html) and
  [Optimizing InnoDB Redo Logging](https://dev.mysql.com/doc/refman/8.4/en/optimizing-innodb-logging.html)
  — `innodb_redo_log_capacity`, `innodb_log_buffer_size` 16 MB.
- [Configuring Buffer Pool Flushing](https://dev.mysql.com/doc/refman/8.4/en/innodb-buffer-pool-flushing.html)
  and [Configuring InnoDB I/O Capacity](https://dev.mysql.com/doc/refman/8.4/en/innodb-configuring-io-capacity.html)
  — page cleaners, adaptive flushing, `innodb_io_capacity`.
- [Purge Configuration](https://dev.mysql.com/doc/refman/8.4/en/innodb-purge-configuration.html)
  — `innodb_purge_threads` default 4.
- [What Is New in MySQL 8.4 since MySQL 8.0](https://dev.mysql.com/doc/refman/8.4/en/mysql-nutshell.html)
  and [Replica Server Options and Variables](https://dev.mysql.com/doc/refman/8.4/en/replication-options-replica.html)
  — `replica_parallel_workers` 4, removal of `binlog_transaction_dependency_tracking` with writesets
  always used.
