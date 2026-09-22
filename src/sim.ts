import type { SimConfig, SimState } from './types';

/**
 * A deliberately small model of a running server. It is not a MySQL emulator —
 * it reproduces the feedback loops that matter for intuition:
 *   writes generate redo → redo pins the checkpoint → flushing releases it,
 *   and open transactions hold back purge.
 */

const REDO_CAPACITY = 100 * 1024 * 1024; // innodb_redo_log_capacity default: 100 MB
const REDO_PER_TRX = 3800; // bytes of redo per write transaction, roughly

export const WORKLOAD_NAMES = ['idle', 'steady', 'busy', 'spike'] as const;

export const defaultConfig: SimConfig = {
  workload: 1,
  flushLogAtTrxCommit: 1,
  syncBinlog: 1,
  adaptiveFlushing: true,
  paused: false,
  speed: 1,
};

export class Sim {
  config: SimConfig = { ...defaultConfig };

  state: SimState = {
    qps: 0,
    lsn: 21_474_836_480,
    checkpointLsn: 21_474_836_480,
    dirtyPct: 4,
    freePct: 22,
    hitRate: 99.2,
    historyLen: 120,
    replicaLagMs: 40,
    fsyncPerSec: 0,
    redoUsedPct: 0,
  };

  /** Pulses other modules can read: commit beacon, cleaner pass, purge sweep. */
  pulses = { commit: 0, flush: 0, purge: 0, fsync: 0 };

  private fsyncAccumulator = 0;
  private secondTimer = 0;
  private fsyncsThisSecond = 0;
  /** A long-running transaction pinning the read view, toggled from the UI. */
  longTransaction = false;

  private targetQps(): number {
    return [0, 900, 4200, 11000][this.config.workload] ?? 900;
  }

  tick(dt: number): void {
    if (this.config.paused) return;
    const t = Math.min(dt, 0.1) * this.config.speed;
    const s = this.state;

    // Throughput eases toward the workload target, with a little jitter so the
    // city never looks like it is running from a script.
    const target = this.targetQps() * (0.92 + Math.random() * 0.16);
    s.qps += (target - s.qps) * Math.min(1, t * 1.6);

    const writeShare = 0.35;
    const writesPerSec = s.qps * writeShare;

    // Redo generation: every write transaction appends redo, so the LSN climbs.
    s.lsn += writesPerSec * REDO_PER_TRX * t;

    // Dirty pages accumulate with writes and drain at the flush rate.
    const dirtyGain = writesPerSec * 0.0022 * t;
    const urgency = this.config.adaptiveFlushing
      ? 0.35 + Math.pow(s.redoUsedPct / 100, 1.6) * 6 + Math.max(0, s.dirtyPct - 10) * 0.05
      : s.dirtyPct > 88 || s.redoUsedPct > 92
        ? 7 // no adaptive flushing: nothing happens until the wall, then panic
        : 0.3;
    const flushRate = urgency * 26 * t;
    s.dirtyPct = clamp(s.dirtyPct + dirtyGain - flushRate * 0.05, 0, 96);

    // Flushed pages let the checkpoint advance behind the current LSN.
    const checkpointGain = flushRate * REDO_PER_TRX * 62;
    s.checkpointLsn = Math.min(s.lsn, s.checkpointLsn + checkpointGain);
    const checkpointAge = s.lsn - s.checkpointLsn;
    s.redoUsedPct = clamp((checkpointAge / REDO_CAPACITY) * 100, 0, 100);

    // Free frames: pressure from reads, replenished by LRU flushing.
    s.freePct = clamp(s.freePct + (22 - s.freePct) * t * 0.8 - s.qps * 0.0000045, 0.2, 40);

    // Hit rate degrades a little as the pool churns harder.
    const hitTarget = 99.6 - Math.min(3.2, s.qps / 4200) - (s.freePct < 2 ? 1.5 : 0);
    s.hitRate += (hitTarget - s.hitRate) * t * 0.6;

    // MVCC: old versions pile up; purge drains them unless a read view is pinned.
    const purgeRate = this.longTransaction ? 0 : writesPerSec * 0.9;
    s.historyLen = Math.max(0, s.historyLen + (writesPerSec * 0.85 - purgeRate) * t + (this.longTransaction ? writesPerSec * 0.6 * t : 0));
    if (!this.longTransaction) s.historyLen += (140 - s.historyLen) * t * 0.35;

    // Replication lag grows with write pressure and with commit-order backpressure.
    const lagTarget = 25 + writesPerSec * 0.02 + (this.config.syncBinlog === 1 ? 8 : 0);
    s.replicaLagMs += (lagTarget - s.replicaLagMs) * t * 0.7;

    // Durability rhythm: per commit group, or once per second.
    if (this.config.flushLogAtTrxCommit === 1) {
      // Commits group: the busier the server, the more transactions per fsync.
      const groupSize = 1 + s.qps * writeShare * 0.004;
      this.fsyncAccumulator += (writesPerSec / groupSize) * t;
    } else {
      this.fsyncAccumulator += t; // one per second
    }
    while (this.fsyncAccumulator >= 1) {
      this.fsyncAccumulator -= 1;
      this.fsyncsThisSecond++;
      this.pulses.fsync = 1;
    }

    this.secondTimer += t;
    if (this.secondTimer >= 1) {
      this.secondTimer -= 1;
      s.fsyncPerSec = this.fsyncsThisSecond;
      this.fsyncsThisSecond = 0;
    }

    // Decay the visual pulses.
    this.pulses.commit = Math.max(0, this.pulses.commit - t * 3);
    this.pulses.flush = Math.max(0, this.pulses.flush - t * 2);
    this.pulses.purge = Math.max(0, this.pulses.purge - t * 2);
    this.pulses.fsync = Math.max(0, this.pulses.fsync - t * 6);

    if (Math.random() < writesPerSec * t * 0.002) this.pulses.commit = 1;
    if (Math.random() < flushRate * t * 2) this.pulses.flush = 1;
    if (Math.random() < purgeRate * t * 0.0015) this.pulses.purge = 1;
  }

  /** 0..1 traffic multiplier used by the flow lanes. */
  get intensity(): number {
    return clamp(this.state.qps / 11000, 0.04, 1);
  }

  get checkpointAgeBytes(): number {
    return this.state.lsn - this.state.checkpointLsn;
  }
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
