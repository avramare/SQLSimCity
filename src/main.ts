import './style.css';
import * as THREE from 'three';
import { createWorld } from './scene/world';
import { createCity, type LabelMode } from './scene/city';
import { createFlows } from './scene/flows';
import { createRig, type Collider } from './controls/rig';
import { createHud } from './ui/hud';
import { createInspector } from './ui/inspector';
import { createPalette, type PaletteCommand } from './ui/palette';
import { createTour } from './ui/tour';
import { DISTRICTS, DISTRICT_BY_ID, findBuilding } from './data/districts';
import { Sim } from './sim';
import type { District } from './types';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const labelHost = document.getElementById('labels') as HTMLElement;

const world = createWorld(canvas, labelHost);
const city = createCity();
const flows = createFlows();
world.scene.add(city.group);
world.scene.add(flows.group);

const rig = createRig(world.camera, canvas);
const sim = new Sim();

/* ------------------------------------------------------------------ */
/* Colliders for first-person walking                                  */
/* ------------------------------------------------------------------ */

const colliders: Collider[] = [];
for (const d of DISTRICTS) {
  colliders.push({ x: d.center[0], z: d.center[1], r: d.radius });
  for (const b of d.buildings) {
    colliders.push({
      x: d.center[0] + b.pos[0],
      z: d.center[1] + b.pos[1],
      r: Math.max(b.size[0], b.size[2]) * 0.5,
    });
  }
}
rig.setColliders(colliders);

/* ------------------------------------------------------------------ */
/* Camera framing                                                      */
/* ------------------------------------------------------------------ */

const OVERVIEW_POS = new THREE.Vector3(0, 290, 330);
const OVERVIEW_TARGET = new THREE.Vector3(0, 0, 0);

let activeDistrictId: string | null = null;

/** Single place that records where we are, so every surface agrees. */
function setActiveDistrict(id: string | null): void {
  activeDistrictId = id;
  city.focusDistrict(id);
  flows.focusDistrict(id);
  hud.setActiveDistrict(id);
}

function goOverview(): void {
  setActiveDistrict(null);
  city.setSelected(null);
  rig.flyTo(OVERVIEW_POS, OVERVIEW_TARGET, 1200);
}

function goDistrict(id: string, openPanel = true): void {
  const district = DISTRICT_BY_ID.get(id);
  if (!district) return;
  setActiveDistrict(id);
  city.setSelected(null);

  const center = new THREE.Vector3(district.center[0], 10, district.center[1]);
  const off = district.view.offset;
  // Approach from the side that faces the middle of the city, so the camera
  // never ends up looking through a neighbouring district.
  const outward = center.clone().setY(0).normalize();
  const pos = center
    .clone()
    .add(new THREE.Vector3(0, off[1], 0))
    .addScaledVector(outward, Math.hypot(off[0], off[2]) + district.radius * 0.6);
  rig.flyTo(pos, center, 1100);
  if (openPanel) inspector.showDistrict(district);
}

function goBuilding(id: string, openPanel = true): void {
  const found = findBuilding(id);
  const cityBuilding = city.buildings.get(id);
  if (!found || !cityBuilding) return;

  setActiveDistrict(found.district.id);
  city.setSelected(id);

  const top = cityBuilding.top;
  const target = new THREE.Vector3(top.x, Math.max(6, top.y * 0.62), top.z);
  const footprint = Math.max(found.building.size[0], found.building.size[2], found.building.size[1]);
  const dist = footprint * 1.9 + 34;
  const outward = new THREE.Vector3(top.x, 0, top.z).normalize();
  if (outward.lengthSq() < 0.001) outward.set(0, 0, 1);
  const pos = target
    .clone()
    .addScaledVector(outward, dist)
    .add(new THREE.Vector3(0, dist * 0.55, 0));
  rig.flyTo(pos, target, 950);
  if (openPanel) inspector.showBuilding(found.building, found.district);
}

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */

const inspector = createInspector({
  onBuilding: (id) => goBuilding(id),
  onDistrict: (id) => goDistrict(id),
});

const hud = createHud({
  onDistrict: (id) => goDistrict(id),
  onShadows: (on) => world.setShadows(on),
  onLabelCycle: cycleLabels,
  onPauseToggle: togglePause,
});

const tour = createTour((step) => {
  if (step.set) Object.assign(sim.config, step.set);
  hud.syncControls(sim);
  if (step.building) goBuilding(step.building, true);
  else goDistrict(step.district, true);
});

const palette = createPalette(buildCommands);

let labelMode: LabelMode = 'all';
function cycleLabels(): void {
  labelMode = labelMode === 'all' ? 'districts' : labelMode === 'districts' ? 'none' : 'all';
  city.setLabelMode(labelMode);
  flows.setLabelMode(labelMode);
  hud.setLabelMode(labelMode);
}

function togglePause(): void {
  sim.config.paused = !sim.config.paused;
  hud.setPaused(sim.config.paused);
}

/* Control room inputs -------------------------------------------------- */

const workloadInput = document.getElementById('workload') as HTMLInputElement;
workloadInput.addEventListener('input', () => {
  sim.config.workload = Number(workloadInput.value);
  hud.syncControls(sim);
});

(document.getElementById('flushLog') as HTMLSelectElement).addEventListener('change', (e) => {
  sim.config.flushLogAtTrxCommit = Number((e.target as HTMLSelectElement).value) as 0 | 1 | 2;
});

(document.getElementById('syncBinlog') as HTMLSelectElement).addEventListener('change', (e) => {
  sim.config.syncBinlog = Number((e.target as HTMLSelectElement).value) as 0 | 1;
});

(document.getElementById('adaptiveFlush') as HTMLInputElement).addEventListener('change', (e) => {
  sim.config.adaptiveFlushing = (e.target as HTMLInputElement).checked;
});

(document.getElementById('longTrx') as HTMLInputElement).addEventListener('change', (e) => {
  sim.longTransaction = (e.target as HTMLInputElement).checked;
});

/* Help overlay --------------------------------------------------------- */

const helpEl = document.getElementById('help') as HTMLElement;
const legendEl = document.getElementById('legend') as HTMLElement;
legendEl.innerHTML = flows
  .laneNotes()
  .map((l) => `<li><i style="background:${l.color}"></i><span><b>${l.label}</b> — ${l.note}</span></li>`)
  .join('');

function toggleHelp(force?: boolean): void {
  helpEl.hidden = force !== undefined ? !force : !helpEl.hidden;
}

document.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
  switch (action) {
    case 'help':
      toggleHelp(true);
      break;
    case 'help-close':
      toggleHelp(false);
      break;
    case 'palette':
      palette.toggle();
      break;
    case 'tour':
      tour.toggle();
      break;
    case 'tour-next':
      tour.next();
      break;
    case 'tour-prev':
      tour.prev();
      break;
    case 'tour-close':
      tour.stop();
      break;
    case 'close-inspector':
      inspector.close();
      city.setSelected(null);
      break;
  }
});

helpEl.addEventListener('mousedown', (e) => {
  if (e.target === helpEl) toggleHelp(false);
});

/* ------------------------------------------------------------------ */
/* Picking                                                             */
/* ------------------------------------------------------------------ */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const center = new THREE.Vector2(0, 0);
let downAt: { x: number; y: number; t: number } | null = null;
let hoverId: string | null = null;

canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});

canvas.addEventListener('pointerup', (e) => {
  if (rig.mode === 'walk') {
    pickAt(center, true);
    return;
  }
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  const held = performance.now() - downAt.t;
  downAt = null;
  if (moved > 6 || held > 450) return; // a drag, not a click
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pickAt(pointer, true);
});

canvas.addEventListener('pointermove', (e) => {
  if (rig.mode === 'walk') return;
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
});

function pickAt(coords: THREE.Vector2, select: boolean): string | null {
  raycaster.setFromCamera(coords, world.camera);
  const hits = raycaster.intersectObjects(city.pickables, false);
  const id = (hits[0]?.object.userData.buildingId as string | undefined) ?? null;
  if (select && id) {
    const found = findBuilding(id);
    if (found) {
      city.setSelected(id);
      setActiveDistrict(found.district.id);
      inspector.showBuilding(found.building, found.district);
    }
  }
  return id;
}

/* ------------------------------------------------------------------ */
/* Keyboard                                                            */
/* ------------------------------------------------------------------ */

window.addEventListener('keydown', (e) => {
  const typing =
    e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || palette.isOpen;

  if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    palette.toggle();
    return;
  }

  if (typing) return;

  if (e.key >= '1' && e.key <= '9') {
    const district = DISTRICTS.find((d) => d.hotkey === e.key);
    if (district) goDistrict(district.id);
    return;
  }

  switch (e.key) {
    case '0':
      goOverview();
      break;
    case 'f':
    case 'F':
      rig.toggleWalk();
      break;
    case 'g':
    case 'G':
      if (rig.mode === 'walk') rig.exitWalk();
      else goOverview();
      break;
    case 't':
    case 'T':
      tour.toggle();
      break;
    case 'l':
    case 'L':
      cycleLabels();
      break;
    case 'h':
    case 'H':
    case '?':
      toggleHelp();
      break;
    case ' ':
      e.preventDefault();
      togglePause();
      break;
    case '[':
      sim.config.workload = Math.max(0, sim.config.workload - 1);
      hud.syncControls(sim);
      break;
    case ']':
      sim.config.workload = Math.min(3, sim.config.workload + 1);
      hud.syncControls(sim);
      break;
    case 'ArrowRight':
      if (tour.isActive) tour.next();
      break;
    case 'ArrowLeft':
      if (tour.isActive) tour.prev();
      break;
    case 'Escape':
      if (!helpEl.hidden) toggleHelp(false);
      else if (rig.mode === 'walk') rig.exitWalk();
      else if (tour.isActive) tour.stop();
      else if (inspector.isOpen) {
        inspector.close();
        city.setSelected(null);
      }
      break;
  }
});

rig.onModeChange((mode) => {
  document.body.classList.toggle('is-walking', mode === 'walk');
});

/* ------------------------------------------------------------------ */
/* Command palette contents                                            */
/* ------------------------------------------------------------------ */

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function buildCommands(): PaletteCommand[] {
  const cmds: PaletteCommand[] = [];

  for (const d of DISTRICTS) {
    cmds.push({
      id: `district:${d.id}`,
      name: d.name,
      sub: d.mechanism,
      glyph: d.hotkey,
      color: hex(d.color),
      hint: `key ${d.hotkey}`,
      keywords: `district ${d.subtitle} ${d.bullets.join(' ')}`,
      run: () => goDistrict(d.id),
    });
    for (const b of d.buildings) {
      cmds.push({
        id: `building:${b.id}`,
        name: b.name,
        sub: `${d.name} · ${b.role}`,
        glyph: '▣',
        color: hex(d.color),
        keywords: `${b.summary} ${(b.vars ?? []).map((v) => v[0]).join(' ')}`,
        run: () => goBuilding(b.id),
      });
    }
  }

  const action = (
    id: string,
    name: string,
    sub: string,
    hint: string,
    run: () => void,
    keywords = '',
  ): PaletteCommand => ({ id, name, sub, glyph: '⌘', color: '#8ea3ff', hint, keywords, run });

  cmds.push(
    action(
      'city-overview',
      'City overview',
      activeDistrictId
        ? `Leave ${DISTRICT_BY_ID.get(activeDistrictId)?.name ?? 'the district'} and see the whole server`
        : 'Pull back and see the whole server',
      '0',
      goOverview,
      'zoom out home reset',
    ),
    action(
      'walk',
      rig.mode === 'walk' ? 'Leave first person' : 'Walk in first person',
      'WASD to move, shift to run, Esc to leave',
      'F',
      () => rig.toggleWalk(),
      'fps pointer lock street level',
    ),
    action('tour', tour.isActive ? 'Stop the guided tour' : 'Start the guided tour', 'Follow one UPDATE through the whole server', 'T', () => tour.toggle(), 'guide walkthrough explain'),
    action('labels', 'Cycle labels', `Currently: ${labelMode}`, 'L', cycleLabels, 'hide show text'),
    action('pause', sim.config.paused ? 'Resume the simulation' : 'Pause the simulation', 'Freeze traffic and metrics', 'space', togglePause, 'stop play'),
    action('help', 'Help and keyboard shortcuts', 'Everything you can press', 'H', () => toggleHelp(true), 'keys controls legend'),
  );

  for (let i = 0; i < 4; i++) {
    const names = ['idle', 'steady', 'busy', 'spike'];
    cmds.push({
      id: `workload:${i}`,
      name: `Workload: ${names[i]}`,
      sub: 'Change how hard the simulated server is being driven',
      glyph: '≋',
      color: '#ffc93c',
      keywords: 'load traffic qps throughput',
      run: () => {
        sim.config.workload = i;
        hud.syncControls(sim);
      },
    });
  }

  cmds.push(
    {
      id: 'durability:1',
      name: 'Set innodb_flush_log_at_trx_commit = 1',
      sub: 'fsync at every commit — full ACID durability',
      glyph: '⚑',
      color: '#62d97b',
      keywords: 'durability acid fsync commit',
      run: () => {
        sim.config.flushLogAtTrxCommit = 1;
        hud.syncControls(sim);
        goBuilding('commit-fsync');
      },
    },
    {
      id: 'durability:2',
      name: 'Set innodb_flush_log_at_trx_commit = 2',
      sub: 'fsync once per second — faster, up to 1s of loss on power failure',
      glyph: '⚑',
      color: '#ffc93c',
      keywords: 'durability fsync commit performance',
      run: () => {
        sim.config.flushLogAtTrxCommit = 2;
        hud.syncControls(sim);
        goBuilding('commit-fsync');
      },
    },
    {
      id: 'adaptive:off',
      name: sim.config.adaptiveFlushing ? 'Turn adaptive flushing off' : 'Turn adaptive flushing on',
      sub: 'Watch checkpoint age sawtooth and stall without it',
      glyph: '⚙',
      color: '#a97bff',
      keywords: 'innodb_adaptive_flushing checkpoint page cleaner',
      run: () => {
        sim.config.adaptiveFlushing = !sim.config.adaptiveFlushing;
        hud.syncControls(sim);
        goDistrict('checkpoint-heights');
      },
    },
    {
      id: 'longtrx',
      name: sim.longTransaction ? 'Close the idle long transaction' : 'Open an idle long transaction',
      sub: 'Pin the read view and watch history list length climb',
      glyph: '⧗',
      color: '#ff5fa2',
      keywords: 'mvcc purge undo bloat history list',
      run: () => {
        sim.longTransaction = !sim.longTransaction;
        hud.syncControls(sim);
        goDistrict('purge-gardens');
      },
    },
  );

  return cmds;
}

/* ------------------------------------------------------------------ */
/* Frame loop                                                          */
/* ------------------------------------------------------------------ */

const clock = new THREE.Clock();
let hoverFrame = 0;

function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.elapsedTime;

  sim.tick(dt);
  rig.update(dt);
  city.update(dt, elapsed, sim, world.camera);
  flows.update(dt, sim);
  hud.update(sim);

  // Hover highlighting is cheap but not free — every third frame is plenty.
  if (rig.mode === 'orbit' && ++hoverFrame % 3 === 0 && !rig.isTweening) {
    const id = pickAt(pointer, false);
    if (id !== hoverId) {
      hoverId = id;
      city.setHovered(id);
      canvas.style.cursor = id ? 'pointer' : '';
    }
  }

  world.renderer.render(world.scene, world.camera);
  world.labelRenderer.render(world.scene, world.camera);
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function boot(): void {
  hud.syncControls(sim);
  hud.setLabelMode(labelMode);
  hud.setPaused(false);
  world.camera.position.set(210, 240, 300);
  rig.orbit.target.set(0, 6, 0);
  frame();

  requestAnimationFrame(() => {
    document.getElementById('boot')!.classList.add('is-done');
    goOverview();
    hud.fadeHint();
  });

  // Deep link: #buffer-pool or #page-grid
  const hash = location.hash.replace('#', '');
  if (hash) {
    if (DISTRICT_BY_ID.has(hash)) goDistrict(hash);
    else if (findBuilding(hash)) goBuilding(hash);
  }
}

window.addEventListener('hashchange', () => {
  const hash = location.hash.replace('#', '');
  if (DISTRICT_BY_ID.has(hash)) goDistrict(hash);
  else if (findBuilding(hash)) goBuilding(hash);
});

boot();

// Handy for poking at the model from the console.
declare global {
  interface Window {
    SQLSimCity?: { sim: Sim; districts: District[]; goDistrict: typeof goDistrict };
  }
}
window.SQLSimCity = { sim, districts: DISTRICTS, goDistrict };
