export type BuildingKind = 'tower' | 'block' | 'silo' | 'dome' | 'slab' | 'stack' | 'ring' | 'gate';

export interface Building {
  /** Stable id, used by the command palette and deep links. */
  id: string;
  name: string;
  /** One-line role, shown under the name in the inspector and on hover. */
  role: string;
  kind: BuildingKind;
  /** Local position inside the district, in world units. */
  pos: [number, number];
  /** width, height, depth */
  size: [number, number, number];
  /** Marks the signature building of the district (brighter, taller label). */
  landmark?: boolean;
  summary: string;
  details: string[];
  /** MySQL system variables that govern this mechanism. */
  vars?: Array<[string, string]>;
  /** A query you can run on a real server to observe this mechanism. */
  observe?: string;
}

export interface District {
  id: string;
  /** Keyboard shortcut digit. */
  hotkey: string;
  name: string;
  subtitle: string;
  /** The real MySQL mechanism this district stands for. */
  mechanism: string;
  color: number;
  accent: number;
  center: [number, number];
  radius: number;
  blurb: string;
  bullets: string[];
  buildings: Building[];
  /** Camera framing used when you jump to the district. */
  view: { offset: [number, number, number] };
}

export interface Flow {
  id: string;
  from: string;
  to: string;
  label: string;
  color: number;
  /** Lateral bow of the lane, in world units. */
  bow: number;
  /** Base particles per lane. */
  density: number;
  /** How strongly workload level scales the traffic. */
  loadFactor: number;
  note: string;
}

export interface TourStep {
  id: string;
  title: string;
  district: string;
  building?: string;
  body: string;
  /** Optional sim nudge applied when the step opens. */
  set?: Partial<SimConfig>;
}

export interface SimConfig {
  /** 0 idle, 1 steady, 2 busy, 3 spike */
  workload: number;
  flushLogAtTrxCommit: 0 | 1 | 2;
  syncBinlog: 0 | 1;
  adaptiveFlushing: boolean;
  paused: boolean;
  speed: number;
}

export interface SimState {
  qps: number;
  lsn: number;
  checkpointLsn: number;
  dirtyPct: number;
  freePct: number;
  hitRate: number;
  historyLen: number;
  replicaLagMs: number;
  fsyncPerSec: number;
  redoUsedPct: number;
}
