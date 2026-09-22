import type { District, Flow } from '../types';

/**
 * SQLSimCity models a single MySQL 8.4 server running InnoDB.
 * Every district is one real mechanism; every building is a real component,
 * thread, or on-disk structure. Numbers quoted are MySQL 8.4 defaults.
 */
export const DISTRICTS: District[] = [
  {
    id: 'thread-city',
    hotkey: '1',
    name: 'Thread City',
    subtitle: 'Connections, parser, optimizer',
    mechanism: 'The SQL layer: one thread per connection, parse → optimize → handler calls',
    color: 0xff9448,
    accent: 0xffd0a3,
    center: [-120, 0],
    radius: 36,
    blurb:
      'Every client connection is met at the gate and handed its own thread. That thread carries one statement all the way through parsing, optimizing, and execution, then calls down into the storage engine. Nothing below this district knows what SQL is.',
    bullets: [
      'Default thread_handling is one-thread-per-connection: a connection = an OS thread.',
      'Threads are recycled through the thread cache, not destroyed, so reconnect storms stay cheap.',
      'The optimizer picks a plan using cost constants and index statistics, then the executor issues row-by-row calls across the handler API.',
      'Per-session buffers (sort, join, read) are allocated per thread — max_connections multiplies them.',
    ],
    view: { offset: [0, 62, 88] },
    buildings: [
      {
        id: 'connection-gate',
        name: 'Connection Gate',
        role: 'Listener + authentication',
        kind: 'gate',
        pos: [-22, 14],
        size: [16, 10, 6],
        summary:
          'The listener socket accepts a TCP or Unix socket connection, runs the authentication handshake, then hands the session to a thread.',
        details: [
          'max_connections caps concurrent sessions; one extra slot is reserved for a SUPER/CONNECTION_ADMIN user so you can still log in to fix things.',
          'Every accepted connection gets a THD object — the session state: user, current database, transaction, temp tables, session variables.',
          'Failed handshakes are counted in Aborted_connects; dropped mid-session connections show up as Aborted_clients.',
        ],
        vars: [
          ['max_connections', 'Concurrent client sessions allowed (default 151)'],
          ['back_log', 'Pending connections queued by the OS while the listener is busy'],
        ],
        observe: "SHOW STATUS LIKE 'Threads_connected';",
      },
      {
        id: 'thread-cache',
        name: 'Thread Depot',
        role: 'Thread cache',
        kind: 'block',
        pos: [-4, 20],
        size: [14, 12, 12],
        summary:
          'Finished threads park here instead of being destroyed, so the next connection reuses a warm thread.',
        details: [
          'Threads_created only rises when the cache is empty — a fast-growing counter means thread_cache_size is too small for your connection churn.',
          'Threads_cached shows how many are idle and parked right now.',
          'Connection pools in the application do the same job one layer up; using both is normal.',
        ],
        vars: [['thread_cache_size', 'How many threads may be parked for reuse']],
        observe: "SHOW STATUS WHERE Variable_name IN ('Threads_created','Threads_cached');",
      },
      {
        id: 'parser',
        name: 'Parser Hall',
        role: 'SQL text → parse tree',
        kind: 'slab',
        pos: [16, 16],
        size: [18, 14, 10],
        summary:
          'Statement text is tokenized and parsed into a tree, then resolved: names to tables, columns to fields, privileges checked.',
        details: [
          'MySQL 8.0 removed the old query cache entirely, so every statement is parsed. Prepared statements let you skip re-parsing.',
          'Resolution needs the data dictionary, which since 8.0 lives in transactional InnoDB tables (mysql.ibd), not .frm files.',
          'Syntax errors die here, before the optimizer ever sees the statement.',
        ],
        observe: 'EXPLAIN FORMAT=TREE SELECT ...;',
      },
      {
        id: 'optimizer',
        name: 'Optimizer Spire',
        role: 'Cost-based plan selection',
        kind: 'tower',
        pos: [0, -6],
        size: [16, 40, 16],
        landmark: true,
        summary:
          'The optimizer estimates the cost of access paths — index lookups, ranges, scans, join orders — and picks the cheapest plan it can find.',
        details: [
          'Costs come from index statistics (cardinality sampled by innodb_stats_persistent_sample_pages) plus fixed cost constants in mysql.server_cost and mysql.engine_cost.',
          'Bad plans are usually stale or badly sampled statistics, not a "wrong" optimizer. ANALYZE TABLE refreshes them.',
          'Histograms (ANALYZE TABLE ... UPDATE HISTOGRAM) help columns that are skewed and unindexed.',
          'EXPLAIN ANALYZE actually runs the statement and prints measured time per plan node next to the estimates.',
        ],
        vars: [
          ['optimizer_switch', 'Toggles for individual optimizations (MRR, BKA, index merge, hash join...)'],
          ['innodb_stats_persistent_sample_pages', 'Pages sampled per index when statistics are recalculated'],
        ],
        observe: 'EXPLAIN ANALYZE SELECT ...;',
      },
      {
        id: 'executor',
        name: 'Executor Works',
        role: 'Handler API calls into InnoDB',
        kind: 'stack',
        pos: [20, -12],
        size: [16, 24, 14],
        summary:
          'The executor walks the plan and asks the storage engine for rows one interface call at a time: position an index, read next, read row by primary key.',
        details: [
          'This handler API is the boundary between "MySQL the server" and "InnoDB the engine" — the same interface any storage engine implements.',
          'Every row fetched costs a call, which is why a plan reading 10 million rows to return 10 is slow even with a warm buffer pool.',
          'Rows_examined vs Rows_sent in the slow log is the single most useful ratio for spotting bad plans.',
        ],
        observe:
          "SELECT * FROM sys.statements_with_full_table_scans ORDER BY no_index_used_count DESC LIMIT 10;",
      },
      {
        id: 'session-buffers',
        name: 'Session Buffer Yard',
        role: 'Per-thread working memory',
        kind: 'silo',
        pos: [-20, -16],
        size: [12, 20, 12],
        summary:
          'Sorts, joins, and intermediate results need memory. These buffers are allocated per session, on demand, outside the buffer pool.',
        details: [
          'sort_buffer_size, join_buffer_size, and read_rnd_buffer_size are per-session and can be allocated more than once per query.',
          'Internal temporary tables use the TempTable engine in memory first (temptable_max_ram, 1 GB default), spilling to disk after that.',
          'Oversized per-session buffers are a classic way to OOM a server: the risk is roughly value × concurrent sessions.',
        ],
        vars: [
          ['sort_buffer_size', 'Per-sort memory before a merge sort spills to disk'],
          ['join_buffer_size', 'Buffer for joins that cannot use an index'],
          ['temptable_max_ram', 'RAM the TempTable engine may use before spilling'],
        ],
        observe:
          "SHOW STATUS WHERE Variable_name IN ('Created_tmp_tables','Created_tmp_disk_tables','Sort_merge_passes');",
      },
    ],
  },

  {
    id: 'buffer-pool',
    hotkey: '2',
    name: 'Buffer Pool Central',
    subtitle: 'The in-memory page cache',
    mechanism: 'innodb_buffer_pool: 16 KB pages, LRU young/old sublists, free list, flush list',
    color: 0x45d7ff,
    accent: 0xbdf1ff,
    center: [0, 0],
    radius: 44,
    blurb:
      'InnoDB never touches a row on disk. Everything — tables, indexes, undo — is read into 16 KB pages here first, modified here, and written back later. This district is where MySQL actually lives, and it is why RAM size dominates performance.',
    bullets: [
      'A page is 16 KB by default (innodb_page_size, fixed at initialization).',
      'The LRU list is split: a young sublist (hot) and an old sublist (newly read). A page must survive innodb_old_blocks_time before it can be promoted — that is what keeps a big table scan from flushing your hot working set.',
      'Modified pages are "dirty": they live in the flush list, ordered by the LSN of their oldest unwritten change.',
      'The free list holds pages ready to be used. When it runs dry, a query has to evict before it can read — user threads start doing the janitor work.',
    ],
    view: { offset: [0, 78, 96] },
    buildings: [
      {
        id: 'page-grid',
        name: 'The Page Grid',
        role: 'Buffer pool pages, live',
        kind: 'slab',
        pos: [0, 0],
        size: [46, 3, 46],
        landmark: true,
        summary:
          'Each tile is a 16 KB page frame. Watch the colors: cyan = clean, magenta = dirty, dark = free, bright = hot/young.',
        details: [
          'The pool is carved into instances (innodb_buffer_pool_instances) to cut mutex contention, and each instance into 128 MB chunks so the pool can be resized online.',
          'Resizing with SET GLOBAL innodb_buffer_pool_size is online but not instant; it moves in chunk units.',
          'Rule of thumb on a dedicated server: 50–75% of RAM. innodb_dedicated_server=ON derives it for you.',
          'Buffer_pool_reads (had to hit disk) vs Buffer_pool_read_requests (logical reads) gives the hit rate on the HUD.',
        ],
        vars: [
          ['innodb_buffer_pool_size', 'Total pool bytes; the single most important InnoDB setting'],
          ['innodb_buffer_pool_instances', 'Independent pool shards, each with its own mutexes and lists'],
          ['innodb_buffer_pool_chunk_size', 'Resize granularity, default 128 MB'],
        ],
        observe:
          "SELECT POOL_ID, POOL_SIZE, FREE_BUFFERS, DATABASE_PAGES, MODIFIED_DATABASE_PAGES FROM information_schema.INNODB_BUFFER_POOL_STATS;",
      },
      {
        id: 'lru-young',
        name: 'Young Sublist Heights',
        role: 'Hot pages (≈5/8 of the LRU)',
        kind: 'tower',
        pos: [-26, -16],
        size: [14, 34, 14],
        summary:
          'Pages that were accessed again after their probation period get promoted here, to the head of the young sublist.',
        details: [
          'Re-access moves a page to the head of the young list, but only if it is at least innodb_old_blocks_time old — repeated hits within a few milliseconds (the same query scanning the page) do not count as "hot".',
          'This is the working set: the pages your workload keeps returning to.',
          'A high buffer pool hit rate with a small young list usually means the working set fits comfortably.',
        ],
        vars: [['innodb_old_blocks_pct', 'Share of the LRU held as the old sublist (default 37)']],
      },
      {
        id: 'lru-old',
        name: 'Old Sublist Docks',
        role: 'Newly read pages on probation',
        kind: 'block',
        pos: [26, -16],
        size: [16, 20, 16],
        summary:
          'Every newly read page is inserted at the head of the old sublist — the midpoint of the LRU — not the top.',
        details: [
          'Midpoint insertion is scan resistance: a one-off full table scan fills the old sublist and drains out again without evicting your hot pages.',
          'innodb_old_blocks_time (default 1000 ms) is the probation window before a re-read can promote a page.',
          'Read-ahead pages land here too; if they are never touched, they are evicted having cost only I/O.',
        ],
        vars: [
          ['innodb_old_blocks_time', 'Milliseconds a page must sit in old before promotion is allowed'],
        ],
        observe:
          "SELECT * FROM information_schema.INNODB_BUFFER_POOL_STATS\\G  -- see YOUNG_MAKE_PER_THOUSAND_GETS",
      },
      {
        id: 'free-list',
        name: 'Free List Yard',
        role: 'Empty frames ready to fill',
        kind: 'silo',
        pos: [0, 30],
        size: [12, 16, 12],
        summary:
          'Pre-freed page frames. A read that finds a free frame is cheap; a read that finds none must evict first.',
        details: [
          'Page cleaner threads keep the free list stocked in the background (innodb_lru_scan_depth per instance).',
          'When the free list empties, user threads do single-page flushes themselves — visible as latency spikes and a rising Innodb_buffer_pool_wait_free.',
          'That counter climbing above zero under load is a direct signal to raise innodb_io_capacity or the pool size.',
        ],
        vars: [['innodb_lru_scan_depth', 'How far down each instance LRU a cleaner scans per pass']],
        observe: "SHOW STATUS LIKE 'Innodb_buffer_pool_wait_free';",
      },
      {
        id: 'flush-list',
        name: 'Flush List Terminal',
        role: 'Dirty pages, ordered by oldest LSN',
        kind: 'stack',
        pos: [-28, 20],
        size: [16, 26, 14],
        summary:
          'Every dirty page sits here keyed by the LSN of its oldest unwritten modification. The lowest LSN in this list is what pins the checkpoint.',
        details: [
          'The checkpoint LSN can only advance past changes whose pages have been written. One ancient dirty page holds the whole checkpoint back.',
          'Checkpoint age = current LSN − checkpoint LSN. That number, against redo capacity, drives how hard InnoDB flushes.',
          'This is why a workload that repeatedly dirties a few pages still needs flushing: durability of the redo log depends on it.',
        ],
        observe:
          "SELECT MAX(OLDEST_MODIFICATION) FROM information_schema.INNODB_BUFFER_PAGE WHERE OLDEST_MODIFICATION > 0;",
      },
      {
        id: 'change-buffer',
        name: 'Change Buffer Annex',
        role: 'Deferred secondary-index maintenance (off by default in 8.4)',
        kind: 'dome',
        pos: [28, 22],
        size: [14, 14, 14],
        summary:
          'Historically, changes to non-unique secondary index pages that were not in memory were buffered and merged later, to avoid random reads.',
        details: [
          'In MySQL 8.4 innodb_change_buffering defaults to none — the change buffer is effectively off, and the variable is deprecated.',
          'The reason: on modern storage the random reads it avoided are cheap, while the merge cost and recovery complexity were not.',
          'On 8.0 and earlier it defaults to all, and a large buffered set shows up as slow crash recovery.',
        ],
        vars: [['innodb_change_buffering', 'none in 8.4 (was all); deprecated']],
      },
      {
        id: 'adaptive-hash',
        name: 'Adaptive Hash Pavilion',
        role: 'Hash shortcut into B+tree pages (off by default in 8.4)',
        kind: 'ring',
        pos: [0, -32],
        size: [18, 8, 18],
        summary:
          'InnoDB can notice repeated index lookups with the same prefix and build a hash index into buffer pool pages, skipping tree descent.',
        details: [
          'Default changed to OFF in MySQL 8.4: on high-concurrency workloads its internal latches cost more than the tree descent it saves.',
          'It is a pure cache — it is never persisted and is rebuilt from scratch after restart.',
          'If enabled, watch for "btr0sea" contention in SHOW ENGINE INNODB STATUS under heavy concurrency.',
        ],
        vars: [['innodb_adaptive_hash_index', 'OFF in 8.4 (was ON in 8.0)']],
      },
      {
        id: 'read-ahead',
        name: 'Read-Ahead Station',
        role: 'Speculative page prefetch',
        kind: 'gate',
        pos: [-30, 0],
        size: [14, 10, 6],
        summary:
          'When enough pages of a 64-page extent are accessed in order, InnoDB prefetches the rest of the extent asynchronously.',
        details: [
          'Linear read-ahead triggers at innodb_read_ahead_threshold sequential pages (default 56 of 64).',
          'Random read-ahead is off by default (innodb_random_read_ahead).',
          'Prefetched pages that go untouched are wasted I/O — Innodb_buffer_pool_read_ahead_evicted tells you how much.',
        ],
        vars: [['innodb_read_ahead_threshold', 'Sequential pages of an extent needed to trigger prefetch']],
        observe: "SHOW STATUS LIKE 'Innodb_buffer_pool_read_ahead%';",
      },
    ],
  },

  {
    id: 'redo-wharf',
    hotkey: '3',
    name: 'Redo Wharf',
    subtitle: 'Write-ahead logging and commit durability',
    mechanism: 'InnoDB redo log: log buffer → #innodb_redo files, LSN, group commit',
    color: 0xffc93c,
    accent: 0xfff0b8,
    center: [120, 0],
    radius: 36,
    blurb:
      'A commit does not wait for data pages to reach disk. It waits for the redo log. Changes are described as physical redo records, appended to the log, and made durable — the data pages catch up later. This is write-ahead logging, and it is the reason MySQL is both fast and crash-safe.',
    bullets: [
      'Every change is first recorded as a redo record inside a mini-transaction (mtr) that covers one atomic page change set.',
      'The LSN is a monotonically increasing byte offset into the log stream. Every page carries the LSN of its last change.',
      'Rule: a dirty page may never reach disk before the redo describing it. Log first, page later.',
      'On crash recovery InnoDB replays redo from the checkpoint LSN forward, then rolls back uncommitted transactions using undo.',
    ],
    view: { offset: [0, 58, 84] },
    buildings: [
      {
        id: 'log-buffer',
        name: 'Log Buffer Silo',
        role: 'In-memory redo staging',
        kind: 'silo',
        pos: [-22, 10],
        size: [14, 22, 14],
        summary:
          'Redo records are appended to a shared in-memory ring buffer before they are written to the log files.',
        details: [
          'Default 16 MB (innodb_log_buffer_size). Big transactions that overflow it force early writes — Innodb_log_waits counts those stalls.',
          'MySQL 8.0 redesigned this path: user threads write into the buffer lock-free, and dedicated threads take it from there.',
          'The buffer is flushed at commit (depending on flush_log_at_trx_commit), when it gets full, and once per second regardless.',
        ],
        vars: [['innodb_log_buffer_size', 'Redo staging RAM, default 16 MB']],
        observe: "SHOW STATUS LIKE 'Innodb_log_waits';",
      },
      {
        id: 'log-writer',
        name: 'Log Writer Tower',
        role: 'Dedicated write / flush threads',
        kind: 'tower',
        pos: [0, -4],
        size: [16, 42, 16],
        landmark: true,
        summary:
          'Since 8.0 the redo path has its own thread team: log_writer writes the buffer to the OS, log_flusher fsyncs it, and notifier threads wake the waiting user threads.',
        details: [
          'Splitting write from fsync is what makes group commit efficient: one fsync can make hundreds of transactions durable.',
          'User threads waiting on durability sleep on the notifier, so a commit costs a wait, not a spin.',
          'Innodb_os_log_fsyncs divided by commits tells you how well transactions are grouping.',
        ],
        observe:
          "SELECT NAME, COUNT_STAR FROM performance_schema.events_waits_summary_global_by_event_name WHERE NAME LIKE '%innodb_log%' ORDER BY COUNT_STAR DESC LIMIT 5;",
      },
      {
        id: 'redo-files',
        name: 'Redo File Docks',
        role: '#innodb_redo/ — 32 rotating files',
        kind: 'slab',
        pos: [24, 6],
        size: [30, 8, 18],
        summary:
          'The redo log is a fixed-size circular stream on disk. Since 8.0.30 its total size is one variable, innodb_redo_log_capacity (default 100 MB).',
        details: [
          'Files live in #innodb_redo/ inside the data directory and rotate; innodb_log_file_size and innodb_log_files_in_group are deprecated.',
          'Capacity is resizable online: SET GLOBAL innodb_redo_log_capacity = ... — InnoDB adds or drops files in the background.',
          'Too small a capacity means the checkpoint can never fall behind, so InnoDB flushes furiously and write throughput collapses. 100 MB is a starting point, not a production value.',
          'Async flushing kicks in around 75% of capacity consumed; sync flushing (a hard stall) near the limit.',
        ],
        vars: [
          ['innodb_redo_log_capacity', 'Total redo bytes on disk, default 100 MB, dynamic'],
          ['innodb_dedicated_server', 'Auto-sizes pool, redo capacity, and flush method from host RAM'],
        ],
        observe:
          "SELECT * FROM performance_schema.innodb_redo_log_files;",
      },
      {
        id: 'commit-fsync',
        name: 'Durability Lighthouse',
        role: 'innodb_flush_log_at_trx_commit',
        kind: 'tower',
        pos: [-6, 24],
        size: [10, 30, 10],
        summary:
          'The switch that decides what "committed" means. Flip it in the Control Room and watch the fsync beacon change rhythm.',
        details: [
          '1 (default, ACID): write + fsync at every commit. Survives OS crash and power loss. Costs one durable write per commit group.',
          '2: write to the OS page cache at commit, fsync once per second. Survives a mysqld crash, loses up to ~1s on power loss.',
          '0: write and fsync once per second. Loses up to ~1s even on a clean mysqld crash. Fastest, least safe.',
          'For real durability the whole chain matters: fsync must actually reach stable media, so disable volatile write caches.',
        ],
        vars: [
          ['innodb_flush_log_at_trx_commit', '1 = fsync per commit, 2 = fsync per second, 0 = both deferred'],
          ['innodb_flush_method', 'O_DIRECT is typical on Linux to avoid double-caching data pages'],
        ],
        observe: "SHOW STATUS LIKE 'Innodb_os_log_fsyncs';",
      },
      {
        id: 'group-commit',
        name: 'Group Commit Quay',
        role: 'Batching concurrent commits',
        kind: 'ring',
        pos: [18, -22],
        size: [18, 8, 18],
        summary:
          'Concurrent commits queue and are made durable together, so throughput does not fall to one transaction per fsync.',
        details: [
          'InnoDB groups redo fsyncs; the binary log runs its own group commit with flush, sync, and commit stages.',
          'binlog_group_commit_sync_delay deliberately waits microseconds to collect a bigger group — trading a little latency for far fewer fsyncs.',
          'Under concurrency, throughput can improve when you add clients precisely because groups get bigger.',
        ],
        vars: [
          ['binlog_group_commit_sync_delay', 'Microseconds to wait to build a larger commit group'],
          ['binlog_group_commit_sync_no_delay_count', 'Group size that ends the wait early'],
        ],
      },
      {
        id: 'recovery-yard',
        name: 'Crash Recovery Yard',
        role: 'Redo replay + undo rollback on startup',
        kind: 'block',
        pos: [-24, -20],
        size: [18, 16, 16],
        summary:
          'On restart after a crash, InnoDB replays redo from the last checkpoint, then rolls back transactions that never committed.',
        details: [
          'Recovery time is roughly proportional to checkpoint age at crash time — the redo you left unflushed is the redo you must replay.',
          'Redo is physical (page-level) and idempotent, so replay is safe even over pages that already made it to disk.',
          'Torn pages during the crash are repaired from the doublewrite buffer before replay begins.',
        ],
        observe: "SELECT * FROM performance_schema.log_status\\G",
      },
    ],
  },

  {
    id: 'storage-yards',
    hotkey: '4',
    name: 'Storage Yards',
    subtitle: 'Tablespaces, B+trees, rows on disk',
    mechanism: 'file-per-table .ibd files, clustered index, extents and segments, doublewrite',
    color: 0x62d97b,
    accent: 0xc8f7d4,
    center: [60, 104],
    radius: 36,
    blurb:
      'The durable copy of your data. Every InnoDB table is a B+tree keyed by its primary key, with the full row stored in the leaf — that is the clustered index. Secondary indexes store the primary key, not a row pointer, which is why a fat primary key makes every index fat.',
    bullets: [
      'Page 16 KB → extent 1 MB (64 pages) → segment (one per index, two actually: leaf and non-leaf) → tablespace file.',
      'innodb_file_per_table (default ON) gives each table its own .ibd file, so DROP/TRUNCATE returns space to the filesystem.',
      'A secondary index lookup is two descents: index → primary key → clustered index. A covering index skips the second.',
      'The doublewrite buffer protects against torn 16 KB writes on 4 KB-sector hardware.',
    ],
    view: { offset: [0, 60, 86] },
    buildings: [
      {
        id: 'clustered-index',
        name: 'Clustered Index Pyramid',
        role: 'The table is its primary key B+tree',
        kind: 'tower',
        pos: [0, -4],
        size: [26, 38, 26],
        landmark: true,
        summary:
          'Root page at the top, internal pages routing by key, leaf pages holding the actual rows in primary key order.',
        details: [
          'A tree of depth 3–4 reaches billions of rows: three page reads, and the top levels are always in the buffer pool.',
          'No explicit primary key? InnoDB uses the first UNIQUE NOT NULL index, or generates a hidden 6-byte row ID — a global counter and a contention point.',
          'Rows are physically ordered by primary key, so a random PK (UUIDv4) turns inserts into random page writes and page splits. Monotonic keys append at the right edge.',
          'A page split happens when an insert does not fit; the page is split roughly in half, permanently fragmenting the tree unless you rebuild.',
        ],
        vars: [['innodb_page_size', 'Page size, fixed at initialization, default 16 KB']],
        observe:
          "SELECT NAME, INDEX_ID, N_LEAF_PAGES, SIZE FROM information_schema.INNODB_TABLESTATS JOIN information_schema.INNODB_INDEXES USING (TABLE_ID) LIMIT 10;",
      },
      {
        id: 'secondary-index',
        name: 'Secondary Index Row',
        role: 'Key → primary key',
        kind: 'stack',
        pos: [-26, 8],
        size: [16, 26, 14],
        summary:
          'Each secondary index is its own B+tree whose leaves hold the indexed columns plus the primary key value.',
        details: [
          'That is why a wide primary key inflates every secondary index on the table.',
          'A covering index — one that contains every column the query needs — avoids the second descent entirely. EXPLAIN shows "Using index".',
          'Index-only visibility checks need the page to be marked all-visible; otherwise InnoDB still consults the clustered index for row versions.',
        ],
        observe:
          "SELECT * FROM sys.schema_unused_indexes;",
      },
      {
        id: 'ibd-files',
        name: 'Tablespace Docks',
        role: '.ibd files, one per table',
        kind: 'slab',
        pos: [26, 10],
        size: [30, 8, 20],
        summary:
          'File-per-table tablespaces hold the table and all its indexes. General tablespaces can hold many tables in one file.',
        details: [
          'The system tablespace (ibdata1) still holds the doublewrite metadata, change buffer, and internal structures.',
          'The data dictionary lives in mysql.ibd as transactional InnoDB tables since 8.0 — no more .frm files, and DDL is atomic.',
          'Deleting rows does not shrink the file; freed pages return to the tablespace free list. OPTIMIZE TABLE rebuilds and reclaims.',
        ],
        vars: [
          ['innodb_file_per_table', 'ON by default: a .ibd per table'],
          ['innodb_data_file_path', 'System tablespace layout'],
        ],
        observe:
          "SELECT NAME, FILE_SIZE, ALLOCATED_SIZE FROM information_schema.INNODB_TABLESPACES ORDER BY FILE_SIZE DESC LIMIT 10;",
      },
      {
        id: 'doublewrite',
        name: 'Doublewrite Basin',
        role: 'Torn-page protection',
        kind: 'dome',
        pos: [-8, 28],
        size: [18, 16, 18],
        summary:
          'Before a page is written to its real home, it is written to a sequential doublewrite file. If a crash tears the home write, the intact copy is used at recovery.',
        details: [
          'Needed because a 16 KB page write is not atomic on 4 KB-sector devices — half-old, half-new pages are unrecoverable by redo alone (redo assumes a consistent page).',
          'Since 8.0.20 doublewrite lives in its own files (#ib_16384_0.dblwr), can be moved to a fast device with innodb_doublewrite_dir, and is written in parallel batches.',
          'The write amplification is smaller than it looks: writes are sequential and batched.',
          'Only turn it off on storage with genuinely atomic page writes.',
        ],
        vars: [
          ['innodb_doublewrite', 'ON by default'],
          ['innodb_doublewrite_pages', 'Batch size per cleaner thread'],
        ],
      },
      {
        id: 'row-format',
        name: 'Row Format Works',
        role: 'DYNAMIC rows, off-page overflow',
        kind: 'block',
        pos: [22, -22],
        size: [18, 16, 16],
        summary:
          'A row must fit within roughly half a page. Long VARCHAR/BLOB/TEXT columns overflow to external pages with a 20-byte pointer left behind.',
        details: [
          'DYNAMIC (the default) stores overflowing columns entirely off-page; COMPACT kept a 768-byte prefix in the row.',
          'COMPRESSED trades CPU for space using zlib per page; it also needs its own in-pool space for the uncompressed copy.',
          'SELECT * on a table with big BLOBs pays extra page reads for overflow pages, even when you never look at the column.',
        ],
        vars: [['innodb_default_row_format', 'DYNAMIC by default']],
      },
      {
        id: 'fsp-maps',
        name: 'Space Map Sheds',
        role: 'Extents, segments, free space',
        kind: 'silo',
        pos: [-26, -20],
        size: [12, 18, 12],
        summary:
          'Tablespace header pages track which extents are free, fragmented, or fully used, and which segment owns them.',
        details: [
          'Small tables start in fragment pages inside shared extents and graduate to full extents once they exceed 32 pages.',
          'Each index owns two segments — one for leaf pages, one for internal pages — so ranges stay sequential on disk.',
          'This is what lets InnoDB grow a file in 1 MB chunks (or innodb_autoextend_increment) instead of page at a time.',
        ],
        vars: [['innodb_autoextend_increment', 'MB added when the system tablespace grows']],
      },
    ],
  },

  {
    id: 'checkpoint-heights',
    hotkey: '5',
    name: 'Checkpoint Heights',
    subtitle: 'Page cleaners and adaptive flushing',
    mechanism: 'Fuzzy checkpointing: page cleaner threads, flush list, LRU flushing, io_capacity',
    color: 0xa97bff,
    accent: 0xe0ccff,
    center: [-60, -104],
    radius: 36,
    blurb:
      'MySQL never stops the world to checkpoint. Page cleaner threads continuously write the oldest dirty pages to disk, which lets the checkpoint LSN creep forward and frees redo space for reuse. The whole art is flushing steadily instead of in panicked bursts.',
    bullets: [
      'Checkpoint age = current LSN − checkpoint LSN. It is the amount of redo that would have to be replayed after a crash.',
      'Adaptive flushing scales the flush rate with redo generation speed and dirty page ratio, so the rate rises smoothly instead of stalling at the wall.',
      'Two flush jobs: flush-list flushing (oldest LSN first, advances the checkpoint) and LRU flushing (frees frames at the cold end).',
      'innodb_io_capacity tells InnoDB how much I/O the device really has. Set it wrong and it either dawdles or floods.',
    ],
    view: { offset: [0, 58, 84] },
    buildings: [
      {
        id: 'page-cleaners',
        name: 'Page Cleaner Depot',
        role: 'Background flush threads',
        kind: 'tower',
        pos: [0, -2],
        size: [18, 36, 18],
        landmark: true,
        summary:
          'Cleaner threads pull the oldest pages off the flush list, write them through the doublewrite buffer, and mark them clean.',
        details: [
          'In 8.4 innodb_page_cleaners defaults to the number of buffer pool instances, so each instance gets its own cleaner.',
          'Each pass also scans innodb_lru_scan_depth pages per instance at the cold end to keep free frames available.',
          'If cleaners cannot keep up, user threads perform single-page flushes inline — the worst case for latency.',
        ],
        vars: [
          ['innodb_page_cleaners', 'Cleaner threads (defaults to buffer pool instances in 8.4)'],
          ['innodb_lru_scan_depth', 'Cold-end scan depth per instance per pass'],
        ],
        observe:
          "SHOW STATUS WHERE Variable_name LIKE 'Innodb_buffer_pool_pages_flushed' OR Variable_name = 'Innodb_buffer_pool_wait_free';",
      },
      {
        id: 'checkpoint-lsn',
        name: 'Checkpoint Beacon',
        role: 'The LSN watermark',
        kind: 'ring',
        pos: [-24, 14],
        size: [20, 10, 20],
        summary:
          'Marks the LSN below which every change is safely on disk. Recovery starts here. Watch it chase the current LSN.',
        details: [
          'The checkpoint cannot pass the oldest unflushed page modification, so the flush list head literally sets this value.',
          'Checkpoint age against innodb_redo_log_capacity determines flushing urgency: comfortable, async, then sync (stall).',
          'A permanently high checkpoint age means slow recovery after a crash, even if throughput looks fine.',
        ],
        observe:
          "SHOW ENGINE INNODB STATUS\\G  -- see LOG section: 'Log sequence number' vs 'Last checkpoint at'",
      },
      {
        id: 'adaptive-flush',
        name: 'Adaptive Flush Control',
        role: 'Rate governor',
        kind: 'block',
        pos: [24, 14],
        size: [18, 18, 16],
        summary:
          'Computes how many pages per second to write, from redo generation rate and dirty page percentage.',
        details: [
          'innodb_adaptive_flushing_lwm (default 10% of redo capacity) is where adaptive flushing starts caring.',
          'innodb_max_dirty_pages_pct (90) is the target ceiling; innodb_max_dirty_pages_pct_lwm (10) is where preflushing begins.',
          'Turn adaptive flushing off in the Control Room to watch checkpoint age sawtooth and stall — that is the pre-adaptive world.',
        ],
        vars: [
          ['innodb_adaptive_flushing', 'ON: scale flush rate with workload'],
          ['innodb_max_dirty_pages_pct', 'Dirty page target, default 90'],
          ['innodb_adaptive_flushing_lwm', 'Redo capacity % where adaptive flushing engages'],
        ],
      },
      {
        id: 'io-capacity',
        name: 'I/O Capacity Gauge',
        role: 'The device budget',
        kind: 'silo',
        pos: [0, 28],
        size: [12, 20, 12],
        summary:
          'Your declared IOPS budget for background work. InnoDB spends it on flushing, and borrows up to io_capacity_max under pressure.',
        details: [
          'Default innodb_io_capacity is 10000 in modern 8.x, tuned for SSDs; on spinning disks that number is fantasy and will drown the device.',
          'innodb_io_capacity_max caps emergency flushing bursts.',
          'Measure real device throughput before setting these — they are a promise InnoDB believes.',
        ],
        vars: [
          ['innodb_io_capacity', 'Background IOPS budget'],
          ['innodb_io_capacity_max', 'Emergency ceiling'],
          ['innodb_flush_neighbors', '0 on SSD (default); 1 batches contiguous pages, useful on HDD'],
        ],
      },
      {
        id: 'sync-wall',
        name: 'Sync Flush Wall',
        role: 'What a redo stall looks like',
        kind: 'slab',
        pos: [-26, -20],
        size: [26, 14, 10],
        summary:
          'If checkpoint age approaches redo capacity, InnoDB forces synchronous flushing and user threads simply wait.',
        details: [
          'Symptom: throughput collapses periodically while disk writes spike — a sawtooth, not a plateau.',
          'Cure is usually more redo capacity (innodb_redo_log_capacity), not more flushing.',
          'Bigger redo = longer crash recovery. That is the actual tradeoff being made.',
        ],
        observe:
          "SELECT COUNT_STAR, SUM_TIMER_WAIT FROM performance_schema.events_waits_summary_global_by_event_name WHERE EVENT_NAME LIKE '%log_write_up_to%';",
      },
    ],
  },

  {
    id: 'purge-gardens',
    hotkey: '6',
    name: 'Purge Gardens',
    subtitle: 'MVCC, undo logs, and cleanup',
    mechanism: 'Undo tablespaces, read views, purge threads, history list length',
    color: 0xff5fa2,
    accent: 0xffc2da,
    center: [60, -104],
    radius: 36,
    blurb:
      'A DELETE does not delete. An UPDATE does not overwrite. InnoDB keeps old row versions in undo logs so readers never block writers, and purge threads collect the garbage once no transaction can still see it. A long-running transaction stops the collectors — that is the classic MySQL bloat story.',
    bullets: [
      'Each row carries hidden columns: DB_TRX_ID (last transaction to modify it) and DB_ROLL_PTR (pointer to the previous version in undo).',
      'A read view is a snapshot of which transaction ids were active; readers walk the undo chain backwards until they find a version they may see.',
      'Deleted rows are only delete-marked. Purge removes the record and its index entries later.',
      'History list length is the queue of un-purged versions. Growing = something old is still open.',
    ],
    view: { offset: [0, 56, 82] },
    buildings: [
      {
        id: 'undo-tablespaces',
        name: 'Undo Vaults',
        role: 'undo_001, undo_002, and friends',
        kind: 'silo',
        pos: [-22, 12],
        size: [14, 26, 14],
        landmark: true,
        summary:
          'Old row versions and rollback information live here, organized into rollback segments inside undo tablespaces.',
        details: [
          'Two undo tablespaces exist by default and more can be created; each holds 128 rollback segments.',
          'Automatic truncation (innodb_undo_log_truncate, ON) reclaims space once a tablespace exceeds innodb_max_undo_log_size (1 GB) — but only if purge has caught up.',
          'Undo is also redo-logged: recovery can roll back an uncommitted transaction after a crash.',
        ],
        vars: [
          ['innodb_undo_log_truncate', 'Reclaim oversized undo tablespaces automatically'],
          ['innodb_max_undo_log_size', 'Size that makes a tablespace eligible for truncation'],
          ['innodb_rollback_segments', 'Rollback segments per undo tablespace'],
        ],
        observe:
          "SELECT NAME, FILE_SIZE FROM information_schema.INNODB_TABLESPACES WHERE NAME LIKE 'innodb_undo%';",
      },
      {
        id: 'read-view',
        name: 'Read View Observatory',
        role: 'Consistent snapshots',
        kind: 'dome',
        pos: [4, -6],
        size: [20, 18, 20],
        summary:
          'At REPEATABLE READ, the first read takes a snapshot of active transaction ids and every later read in the transaction uses it.',
        details: [
          'READ COMMITTED takes a fresh read view per statement, which is why it holds fewer old versions and purges better.',
          'A consistent read never sets locks — readers do not block writers and writers do not block readers.',
          'SELECT ... FOR UPDATE / FOR SHARE are locking reads and always see the latest committed row, not the snapshot.',
        ],
        vars: [['transaction_isolation', 'REPEATABLE-READ by default in MySQL']],
        observe:
          "SELECT trx_id, trx_started, TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS age_s, trx_state FROM information_schema.INNODB_TRX ORDER BY trx_started LIMIT 5;",
      },
      {
        id: 'purge-threads',
        name: 'Purge Crew Yard',
        role: 'The collectors',
        kind: 'block',
        pos: [26, 8],
        size: [18, 18, 16],
        summary:
          'Purge threads remove delete-marked records and undo records once no read view can still need them.',
        details: [
          'innodb_purge_threads defaults to 4; a coordinator distributes batches of innodb_purge_batch_size undo pages.',
          'Purge also removes the corresponding secondary index entries — this is real work, not just freeing space.',
          'If purge lags, both undo and indexes bloat, and reads walk longer version chains to find visible rows.',
        ],
        vars: [
          ['innodb_purge_threads', 'Purge worker threads, default 4'],
          ['innodb_purge_batch_size', 'Undo log pages parsed per batch'],
        ],
      },
      {
        id: 'history-list',
        name: 'History List Monument',
        role: 'The bloat gauge',
        kind: 'tower',
        pos: [-4, 26],
        size: [12, 34, 12],
        summary:
          'The count of un-purged transaction histories. Flat is healthy; a steady climb means purge is blocked.',
        details: [
          'One idle transaction that ran a single SELECT hours ago can pin the entire history — the read view is still open.',
          'Symptoms: undo tablespaces growing, queries slowly getting worse, disk filling with no new data.',
          'Find the culprit in information_schema.INNODB_TRX ordered by trx_started, and kill it.',
        ],
        observe:
          "SELECT COUNT FROM information_schema.INNODB_METRICS WHERE NAME = 'trx_rseg_history_len';",
      },
      {
        id: 'row-locks',
        name: 'Lock Exchange',
        role: 'Record, gap, and next-key locks',
        kind: 'ring',
        pos: [22, -20],
        size: [18, 8, 18],
        summary:
          'Writers take row locks on index records. At REPEATABLE READ, InnoDB also locks the gaps between records to prevent phantoms.',
        details: [
          'Next-key lock = record lock + gap before it. This is why a range UPDATE can block inserts into rows that do not exist yet.',
          'Locks are taken on index records, so a statement with no usable index can end up locking far more than it changes.',
          'Deadlocks are detected and one transaction is rolled back; SHOW ENGINE INNODB STATUS keeps the latest one.',
        ],
        vars: [['innodb_lock_wait_timeout', 'Seconds a statement waits for a row lock, default 50']],
        observe:
          "SELECT * FROM performance_schema.data_lock_waits;",
      },
    ],
  },

  {
    id: 'replica-harbor',
    hotkey: '7',
    name: 'Replica Harbor',
    subtitle: 'Binary log and replication',
    mechanism: 'Binary log, dump thread, replica receiver + relay log + parallel applier, GTIDs',
    color: 0x6f8cff,
    accent: 0xc9d5ff,
    center: [-60, 104],
    radius: 38,
    blurb:
      'The binary log is a second, logical log — separate from redo — describing what changed, in commit order. Replicas stream it, store it as a relay log, and apply it. Point-in-time recovery reads the same file. Redo makes a server durable; the binlog makes a fleet.',
    bullets: [
      'Two logs, one commit: InnoDB redo and the binary log are kept consistent by internal two-phase commit (prepare redo → write binlog → commit).',
      'binlog_format=ROW by default: actual before/after row images, not the statement text. Deterministic and safe.',
      'GTIDs give every transaction a global id, which makes failover and reconnection possible without manual file/position bookkeeping.',
      'Replication is asynchronous by default. Semisynchronous makes the source wait for a replica to acknowledge receipt — not application.',
    ],
    view: { offset: [0, 62, 92] },
    buildings: [
      {
        id: 'binlog',
        name: 'Binlog Terminal',
        role: 'The ordered change stream',
        kind: 'slab',
        pos: [-14, 8],
        size: [32, 10, 20],
        landmark: true,
        summary:
          'A sequence of numbered files holding events in commit order, with an index file listing them.',
        details: [
          'log_bin is ON by default since 8.0. sync_binlog=1 (default) fsyncs the binlog at each commit group.',
          'sync_binlog=1 plus innodb_flush_log_at_trx_commit=1 is the only fully crash-safe combination — the pair usually costs two fsyncs per commit group.',
          'binlog_expire_logs_seconds (30 days default) governs automatic purging. Purge too eagerly and you break replicas that fell behind.',
          'mysqlbinlog reads these files for point-in-time recovery: restore a backup, then replay events up to a timestamp or GTID.',
        ],
        vars: [
          ['sync_binlog', '1 = fsync per commit group (default)'],
          ['binlog_format', 'ROW by default'],
          ['binlog_row_image', 'FULL by default; MINIMAL logs fewer columns'],
          ['binlog_expire_logs_seconds', 'Retention, default 2592000 (30 days)'],
        ],
        observe: 'SHOW BINARY LOGS;',
      },
      {
        id: 'two-phase-commit',
        name: 'Two-Phase Commit Bridge',
        role: 'Keeping redo and binlog in step',
        kind: 'gate',
        pos: [8, 24],
        size: [22, 14, 8],
        summary:
          'A commit prepares in InnoDB (redo written and flushed), writes the binlog event, then commits in InnoDB.',
        details: [
          'If a crash happens between prepare and binlog write, recovery rolls the transaction back — it never reached a replica.',
          'If the binlog event made it, recovery commits the prepared transaction — replicas already saw it, so the source must agree.',
          'This ordering is what makes the binlog a trustworthy source of truth for the fleet.',
        ],
        observe: "SHOW ENGINE INNODB STATUS\\G  -- see the TRANSACTIONS section for prepared trx",
      },
      {
        id: 'dump-thread',
        name: 'Dump Thread Pier',
        role: 'Source side of the stream',
        kind: 'tower',
        pos: [-30, -12],
        size: [12, 30, 12],
        summary:
          'One binlog dump thread per connected replica reads the binlog and pushes events down the wire.',
        details: [
          'The dump thread is a normal connection: you can see it in SHOW PROCESSLIST as "Binlog Dump GTID".',
          'It reads the binlog file, so a replica that is far behind causes source-side disk reads instead of page cache hits.',
          'With semisynchronous replication the commit waits for an ACK from at least rpl_semi_sync_source_wait_for_replica_count replicas.',
        ],
        vars: [
          ['rpl_semi_sync_source_enabled', 'Wait for replica acknowledgement of receipt'],
          ['rpl_semi_sync_source_timeout', 'Fall back to async after this many ms'],
        ],
        observe: "SELECT * FROM performance_schema.replication_connection_status\\G",
      },
      {
        id: 'relay-log',
        name: 'Relay Log Warehouse',
        role: 'Replica-side landing zone',
        kind: 'block',
        pos: [12, -18],
        size: [20, 16, 16],
        summary:
          'The replica receiver (I/O) thread writes incoming events to relay log files; the applier reads from there.',
        details: [
          'Decoupling receive from apply means network hiccups and slow apply are separate problems with separate metrics.',
          'Replica position is crash-safe in mysql.slave_relay_log_info (InnoDB tables), not files.',
          'Seconds_Behind_Source measures the applier, not the receiver — a replica can be fully caught up on receipt but hours behind on apply.',
        ],
        observe: 'SHOW REPLICA STATUS\\G',
      },
      {
        id: 'applier-workers',
        name: 'Applier Yard',
        role: 'Parallel replication workers',
        kind: 'stack',
        pos: [30, 6],
        size: [16, 24, 14],
        summary:
          'Multiple worker threads apply transactions in parallel while preserving the commit order you observe.',
        details: [
          'replica_parallel_workers defaults to 4 in modern releases, with replica_parallel_type=LOGICAL_CLOCK.',
          'MySQL 8.4 always uses writeset-based dependency tracking on the source: transactions touching disjoint rows can be applied concurrently even if they committed one after another.',
          'replica_preserve_commit_order is ON by default, so replicas never expose a state the source never had.',
        ],
        vars: [
          ['replica_parallel_workers', 'Applier threads, default 4'],
          ['replica_preserve_commit_order', 'ON: commits become visible in source order'],
        ],
        observe:
          "SELECT * FROM performance_schema.replication_applier_status_by_worker\\G",
      },
      {
        id: 'gtid',
        name: 'GTID Registry',
        role: 'Global transaction identifiers',
        kind: 'ring',
        pos: [-8, -32],
        size: [20, 10, 20],
        summary:
          'Every transaction gets a source_uuid:number id. A replica knows exactly what it has applied, so it can reconnect anywhere.',
        details: [
          'gtid_executed is the set already applied; gtid_purged is what the binlogs no longer contain.',
          'Failover becomes: point the replica at a new source with SOURCE_AUTO_POSITION=1 and let GTIDs sort out the rest.',
          'Errant transactions — executed on a replica but not the source — poison failover, which is why replicas should run with read_only/super_read_only.',
        ],
        vars: [
          ['gtid_mode', 'ON to use GTIDs'],
          ['enforce_gtid_consistency', 'Rejects statements that cannot be logged safely with GTIDs'],
          ['super_read_only', 'Prevents even privileged writes on a replica'],
        ],
        observe: "SELECT @@GLOBAL.gtid_executed;",
      },
    ],
  },
];

export const FLOWS: Flow[] = [
  {
    id: 'query-in',
    from: 'thread-city',
    to: 'buffer-pool',
    label: 'page requests',
    color: 0xff9448,
    bow: 16,
    density: 110,
    loadFactor: 1,
    note: 'The executor asks InnoDB for rows; InnoDB answers from pages in the buffer pool.',
  },
  {
    id: 'page-read',
    from: 'storage-yards',
    to: 'buffer-pool',
    label: 'page reads (miss)',
    color: 0x62d97b,
    bow: -20,
    density: 40,
    loadFactor: 0.55,
    note: 'A buffer pool miss becomes a 16 KB random read from the tablespace file.',
  },
  {
    id: 'redo-records',
    from: 'buffer-pool',
    to: 'redo-wharf',
    label: 'redo records',
    color: 0xffc93c,
    bow: 14,
    density: 90,
    loadFactor: 1,
    note: 'Every page modification produces redo, written before the page is allowed to reach disk.',
  },
  {
    id: 'dirty-flush',
    from: 'buffer-pool',
    to: 'storage-yards',
    label: 'dirty page flush',
    color: 0xa97bff,
    bow: 22,
    density: 45,
    loadFactor: 0.7,
    note: 'Page cleaners write dirty pages through the doublewrite buffer to their home tablespace.',
  },
  {
    id: 'cleaner-control',
    from: 'checkpoint-heights',
    to: 'buffer-pool',
    label: 'cleaner passes',
    color: 0xa97bff,
    bow: -14,
    density: 34,
    loadFactor: 0.6,
    note: 'Cleaner threads walk the flush list and the cold end of the LRU on every pass.',
  },
  {
    id: 'undo-write',
    from: 'buffer-pool',
    to: 'purge-gardens',
    label: 'old row versions',
    color: 0xff5fa2,
    bow: -16,
    density: 55,
    loadFactor: 0.9,
    note: 'Updates and deletes push the previous version into an undo log so readers keep their snapshot.',
  },
  {
    id: 'purge-back',
    from: 'purge-gardens',
    to: 'storage-yards',
    label: 'purged records',
    color: 0xff5fa2,
    bow: 26,
    density: 30,
    loadFactor: 0.7,
    note: 'Purge removes delete-marked rows and their index entries once no read view needs them.',
  },
  {
    id: 'binlog-events',
    from: 'thread-city',
    to: 'replica-harbor',
    label: 'binlog events',
    color: 0x6f8cff,
    bow: 20,
    density: 60,
    loadFactor: 1,
    note: 'At commit, the transaction is written to the binary log in commit order, then shipped to replicas.',
  },
  {
    id: 'checkpoint-advance',
    from: 'checkpoint-heights',
    to: 'redo-wharf',
    label: 'checkpoint LSN',
    color: 0xffc93c,
    bow: -40,
    density: 22,
    loadFactor: 0.4,
    note: 'Flushed pages let the checkpoint LSN advance, releasing redo space for reuse.',
  },
];

export const DISTRICT_BY_ID = new Map(DISTRICTS.map((d) => [d.id, d]));

export function findBuilding(id: string): { district: District; building: District['buildings'][number] } | undefined {
  for (const district of DISTRICTS) {
    const building = district.buildings.find((b) => b.id === id);
    if (building) return { district, building };
  }
  return undefined;
}
