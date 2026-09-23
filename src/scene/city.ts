import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { DISTRICTS } from '../data/districts';
import type { Building, District } from '../types';
import type { Sim } from '../sim';

export type LabelMode = 'all' | 'districts' | 'none';

// Reusable scratch objects — nothing here is allocated per frame.
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3(1, 1, 1);
const _quat = new THREE.Quaternion();

export interface CityBuilding {
  data: Building;
  district: District;
  group: THREE.Group;
  /** Meshes registered for raycasting. */
  pick: THREE.Object3D[];
  label: CSS2DObject;
  labelEl: HTMLDivElement;
  /** World position of the roof, used for camera framing. */
  top: THREE.Vector3;
  materials: THREE.MeshStandardMaterial[];
  baseEmissive: number;
}

export interface CityDistrict {
  data: District;
  group: THREE.Group;
  label: CSS2DObject;
  labelEl: HTMLDivElement;
  ring: THREE.Mesh;
  center: THREE.Vector3;
}

export interface City {
  group: THREE.Group;
  districts: Map<string, CityDistrict>;
  buildings: Map<string, CityBuilding>;
  pickables: THREE.Object3D[];
  update(dt: number, elapsed: number, sim: Sim, camera: THREE.Camera): void;
  setLabelMode(mode: LabelMode): void;
  setSelected(buildingId: string | null): void;
  setHovered(buildingId: string | null): void;
  focusDistrict(districtId: string | null): void;
}

export function createCity(): City {
  const group = new THREE.Group();
  group.name = 'city';

  const districts = new Map<string, CityDistrict>();
  const buildings = new Map<string, CityBuilding>();
  const pickables: THREE.Object3D[] = [];

  // Shared animated pieces, filled in while building the districts.
  let pageGrid: PageGrid | null = null;
  let checkpointRing: THREE.Mesh | null = null;
  let historyTower: THREE.Group | null = null;
  let fsyncBeacon: THREE.Mesh | null = null;
  let redoBand: THREE.InstancedMesh | null = null;

  for (const district of DISTRICTS) {
    const dGroup = new THREE.Group();
    dGroup.position.set(district.center[0], 0, district.center[1]);
    dGroup.name = `district:${district.id}`;
    group.add(dGroup);

    const color = new THREE.Color(district.color);
    const accent = new THREE.Color(district.accent);

    // Platform
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(district.radius, district.radius + 1.5, 2.4, 64),
      new THREE.MeshStandardMaterial({
        color: color.clone().multiplyScalar(0.16).addScalar(0.03),
        roughness: 0.85,
        metalness: 0.1,
      }),
    );
    plate.position.y = 1.2;
    plate.receiveShadow = true;
    dGroup.add(plate);

    // Glowing rim
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(district.radius + 0.6, 0.5, 8, 96),
      new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 1.4,
        roughness: 0.4,
        toneMapped: true,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 2.5;
    dGroup.add(ring);

    // Inner deck pattern
    const deck = new THREE.Mesh(
      new THREE.RingGeometry(district.radius * 0.42, district.radius * 0.46, 64),
      new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
      }),
    );
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = 2.45;
    dGroup.add(deck);

    // District label
    const dLabelEl = document.createElement('div');
    dLabelEl.className = 'label label-district';
    dLabelEl.innerHTML =
      `<span class="label-key">${district.hotkey}</span>` +
      `<span class="label-name">${district.name}</span>` +
      `<span class="label-sub">${district.subtitle}</span>`;
    dLabelEl.style.setProperty('--label-color', '#' + color.getHexString());
    const dLabel = new CSS2DObject(dLabelEl);
    dLabel.position.set(0, 54, 0);
    dGroup.add(dLabel);

    districts.set(district.id, {
      data: district,
      group: dGroup,
      label: dLabel,
      labelEl: dLabelEl,
      ring,
      center: new THREE.Vector3(district.center[0], 0, district.center[1]),
    });

    for (const b of district.buildings) {
      const built = buildBuilding(b, district, color, accent);
      dGroup.add(built.group);
      buildings.set(b.id, built);
      pickables.push(...built.pick);

      if (b.id === 'page-grid') pageGrid = attachPageGrid(built.group);
      if (b.id === 'checkpoint-lsn') checkpointRing = built.group.getObjectByName('spinner') as THREE.Mesh;
      if (b.id === 'history-list') historyTower = built.group;
      if (b.id === 'commit-fsync') fsyncBeacon = built.group.getObjectByName('beacon') as THREE.Mesh;
      if (b.id === 'redo-files') redoBand = attachRedoBand(built.group);
    }
  }

  // Selection marker, parked off-screen until something is selected.
  const marker = new THREE.Mesh(
    new THREE.TorusGeometry(9, 0.4, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  group.add(marker);

  let selectedId: string | null = null;
  let hoveredId: string | null = null;
  let labelMode: LabelMode = 'all';
  let focusedDistrict: string | null = null;

  const camPos = new THREE.Vector3();

  function applyLabelVisibility(camera: THREE.Camera): void {
    camera.getWorldPosition(camPos);
    for (const d of districts.values()) {
      d.labelEl.style.display = labelMode === 'none' ? 'none' : '';
      d.labelEl.classList.toggle('is-focused', focusedDistrict === d.data.id);
    }
    for (const b of buildings.values()) {
      const dist = camPos.distanceTo(b.top);
      const near = dist < 170;
      const show =
        labelMode === 'all' &&
        (near || b.data.landmark === true) &&
        (focusedDistrict === null || focusedDistrict === b.district.id || dist < 120);
      b.labelEl.style.display = show ? '' : 'none';
      b.labelEl.classList.toggle('is-selected', selectedId === b.data.id);
      b.labelEl.classList.toggle('is-hovered', hoveredId === b.data.id);
      if (show) {
        b.labelEl.style.opacity = String(Math.max(0.25, Math.min(1, (200 - dist) / 90)));
      }
    }
  }

  return {
    group,
    districts,
    buildings,
    pickables,

    update(dt, elapsed, sim, camera) {
      const s = sim.state;

      // District rims breathe with overall throughput.
      const pulse = 1.1 + Math.sin(elapsed * 2) * 0.15 + sim.intensity * 0.8;
      for (const d of districts.values()) {
        const mat = d.ring.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = focusedDistrict === d.data.id ? pulse * 1.8 : pulse;
      }

      pageGrid?.update(elapsed, sim);

      if (checkpointRing) {
        checkpointRing.rotation.z += dt * (0.4 + sim.intensity * 2.2);
        const load = s.redoUsedPct / 100;
        const mat = checkpointRing.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 1 + load * 5;
        mat.color.setHSL(0.75 - load * 0.72, 0.85, 0.55);
        mat.emissive.copy(mat.color);
      }

      if (historyTower) {
        const h = Math.min(3.2, 0.35 + s.historyLen / 4000);
        historyTower.scale.y += (h - historyTower.scale.y) * Math.min(1, dt * 2);
      }

      if (fsyncBeacon) {
        const mat = fsyncBeacon.material as THREE.MeshStandardMaterial;
        const flash = sim.pulses.fsync;
        mat.emissiveIntensity = 0.8 + flash * 9;
        fsyncBeacon.scale.setScalar(1 + flash * 0.35);
      }

      if (redoBand) {
        const speed = 0.3 + sim.intensity * 5;
        const count = redoBand.count;
        for (let i = 0; i < count; i++) {
          const t = (elapsed * speed + i / count) % 1;
          const lit = t < s.redoUsedPct / 100 ? 1 : 0.22;
          const height = 1 + lit * 2.4;
          _pos.set(-13 + t * 26, 1.6 + height / 2, ((i % 3) - 1) * 5);
          _scl.set(1.6, height, 3.2);
          _mat4.compose(_pos, _quat, _scl);
          redoBand.setMatrixAt(i, _mat4);
        }
        redoBand.instanceMatrix.needsUpdate = true;
      }

      applyLabelVisibility(camera);

      if (selectedId) {
        const b = buildings.get(selectedId);
        if (b) {
          marker.position.set(b.top.x, 2.8, b.top.z);
          const r = Math.max(b.data.size[0], b.data.size[2]) * 0.75 + 3;
          marker.scale.setScalar(r / 9);
          marker.rotation.z = elapsed * 0.8;
          marker.visible = true;
        }
      } else {
        marker.visible = false;
      }

      for (const b of buildings.values()) {
        const want =
          b.baseEmissive *
          (selectedId === b.data.id ? 3.4 : hoveredId === b.data.id ? 2.1 : 1) *
          (0.92 + Math.sin(elapsed * 1.4 + b.top.x * 0.05) * 0.08);
        for (const m of b.materials) {
          m.emissiveIntensity += (want - m.emissiveIntensity) * Math.min(1, dt * 8);
        }
      }
    },

    setLabelMode(mode) {
      labelMode = mode;
    },
    setSelected(id) {
      selectedId = id;
    },
    setHovered(id) {
      hoveredId = id;
    },
    focusDistrict(id) {
      focusedDistrict = id;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Building construction                                               */
/* ------------------------------------------------------------------ */

const windowTextures = new Map<string, THREE.Texture>();

function windowTexture(repeatX: number, repeatY: number): THREE.Texture {
  const key = `${repeatX}:${repeatY}`;
  const cached = windowTextures.get(key);
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  const cols = 4;
  const rows = 5;
  const cw = size / cols;
  const rh = size / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = Math.random();
      if (lit < 0.28) continue;
      ctx.fillStyle = `rgba(255,255,255,${0.35 + lit * 0.65})`;
      ctx.fillRect(x * cw + cw * 0.22, y * rh + rh * 0.22, cw * 0.56, rh * 0.42);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  windowTextures.set(key, tex);
  return tex;
}

function bucket(n: number): number {
  return Math.max(1, Math.round(n));
}

function buildBuilding(
  b: Building,
  district: District,
  color: THREE.Color,
  accent: THREE.Color,
): CityBuilding {
  const group = new THREE.Group();
  group.name = `building:${b.id}`;
  group.position.set(b.pos[0], 2.4, b.pos[1]);

  const [w, h, d] = b.size;
  const materials: THREE.MeshStandardMaterial[] = [];
  const pick: THREE.Object3D[] = [];

  const bodyColor = color.clone().lerp(new THREE.Color(0x0b1030), 0.45);
  const baseEmissive = b.landmark ? 1.5 : 0.85;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.55,
    metalness: 0.25,
    emissive: accent.clone().multiplyScalar(0.9),
    emissiveIntensity: baseEmissive,
    emissiveMap: windowTexture(bucket(w / 4), bucket(h / 5)),
  });
  materials.push(bodyMat);

  const trimMat = new THREE.MeshStandardMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: baseEmissive * 1.2,
    roughness: 0.35,
    metalness: 0.4,
  });
  materials.push(trimMat);

  const add = (mesh: THREE.Mesh, pickable = true): THREE.Mesh => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.buildingId = b.id;
    mesh.userData.districtId = district.id;
    group.add(mesh);
    if (pickable) pick.push(mesh);
    return mesh;
  };

  switch (b.kind) {
    case 'tower': {
      const body = add(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.34, w * 0.5, h, 4), bodyMat));
      body.rotation.y = Math.PI / 4;
      body.position.y = h / 2;
      const cap = add(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.1, w * 0.3, h * 0.16, 4), trimMat), false);
      cap.rotation.y = Math.PI / 4;
      cap.position.y = h + h * 0.08;
      const beacon = new THREE.Mesh(
        new THREE.IcosahedronGeometry(Math.max(1.2, w * 0.14), 1),
        new THREE.MeshStandardMaterial({
          color: accent,
          emissive: accent,
          emissiveIntensity: 2.5,
          roughness: 0.2,
        }),
      );
      beacon.name = 'beacon';
      beacon.position.y = h + h * 0.2;
      group.add(beacon);
      break;
    }
    case 'block': {
      const body = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat));
      body.position.y = h / 2;
      const roof = add(new THREE.Mesh(new THREE.BoxGeometry(w * 1.05, h * 0.08, d * 1.05), trimMat), false);
      roof.position.y = h + h * 0.04;
      break;
    }
    case 'slab': {
      const body = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat));
      body.position.y = h / 2;
      const stripe = add(
        new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, h * 0.12, d * 0.2), trimMat),
        false,
      );
      stripe.position.y = h * 0.72;
      break;
    }
    case 'silo': {
      const body = add(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5, w * 0.5, h, 20), bodyMat));
      body.position.y = h / 2;
      const lid = add(
        new THREE.Mesh(new THREE.SphereGeometry(w * 0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), trimMat),
        false,
      );
      lid.position.y = h;
      break;
    }
    case 'dome': {
      const base = add(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5, w * 0.55, h * 0.35, 24), bodyMat));
      base.position.y = h * 0.175;
      const dome = add(
        new THREE.Mesh(new THREE.SphereGeometry(w * 0.5, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), trimMat),
      );
      dome.position.y = h * 0.35;
      break;
    }
    case 'stack': {
      const levels = 3;
      for (let i = 0; i < levels; i++) {
        const f = 1 - i * 0.22;
        const lh = h / levels;
        const seg = add(new THREE.Mesh(new THREE.BoxGeometry(w * f, lh * 0.86, d * f), i === 0 ? bodyMat : trimMat));
        seg.position.y = lh * i + lh * 0.43;
      }
      break;
    }
    case 'ring': {
      const spinner = add(new THREE.Mesh(new THREE.TorusGeometry(w * 0.45, w * 0.07, 10, 40), trimMat));
      spinner.name = 'spinner';
      spinner.rotation.x = -Math.PI / 2;
      spinner.position.y = h * 0.8;
      const post = add(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.09, w * 0.12, h * 0.85, 12), bodyMat));
      post.position.y = h * 0.42;
      break;
    }
    case 'gate': {
      const left = add(new THREE.Mesh(new THREE.BoxGeometry(w * 0.16, h, d), bodyMat));
      left.position.set(-w * 0.42, h / 2, 0);
      const right = add(new THREE.Mesh(new THREE.BoxGeometry(w * 0.16, h, d), bodyMat));
      right.position.set(w * 0.42, h / 2, 0);
      const lintel = add(new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.18, d * 1.1), trimMat));
      lintel.position.y = h;
      break;
    }
  }

  const labelEl = document.createElement('div');
  labelEl.className = 'label label-building' + (b.landmark ? ' is-landmark' : '');
  labelEl.innerHTML =
    `<span class="label-name">${b.name}</span><span class="label-sub">${b.role}</span>`;
  labelEl.style.setProperty('--label-color', '#' + color.getHexString());
  labelEl.dataset.buildingId = b.id;
  const label = new CSS2DObject(labelEl);
  label.position.set(0, h + 8, 0);
  group.add(label);

  const top = new THREE.Vector3(
    district.center[0] + b.pos[0],
    h + 2.4,
    district.center[1] + b.pos[1],
  );

  return { data: b, district, group, pick, label, labelEl, top, materials, baseEmissive };
}

/* ------------------------------------------------------------------ */
/* Animated set pieces                                                 */
/* ------------------------------------------------------------------ */

interface PageGrid {
  update(elapsed: number, sim: Sim): void;
}

/** The buffer pool floor: one instanced tile per page frame. */
function attachPageGrid(parent: THREE.Group): PageGrid {
  const cols = 22;
  const rows = 22;
  const count = cols * rows;
  const gap = 1.9;

  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.5, 1, 1.5),
    new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1, emissiveIntensity: 1.2 }),
    count,
  );
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  parent.add(mesh);

  // Each frame gets a stable random rank so state changes look like a real pool
  // rather than noise: low ranks go dirty first, high ranks stay free longest.
  const rank = new Float32Array(count);
  for (let i = 0; i < count; i++) rank[i] = Math.random();

  const clean = new THREE.Color(0x2fc4ff);
  const dirty = new THREE.Color(0xff54b0);
  const free = new THREE.Color(0x101a3a);
  const hot = new THREE.Color(0xa8f0ff);
  const tmp = new THREE.Color();
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  const quat = new THREE.Quaternion();

  for (let i = 0; i < count; i++) {
    const x = (i % cols) - (cols - 1) / 2;
    const z = Math.floor(i / cols) - (rows - 1) / 2;
    pos.set(x * gap, 1.4, z * gap);
    m.compose(pos, quat, scl);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, clean);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return {
    update(elapsed, sim) {
      const dirtyCut = sim.state.dirtyPct / 100;
      const freeCut = 1 - sim.state.freePct / 100;
      for (let i = 0; i < count; i++) {
        const r = rank[i];
        let height = 1;
        if (r < dirtyCut) {
          const wob = 0.5 + 0.5 * Math.sin(elapsed * 6 + i);
          tmp.copy(dirty).lerp(hot, wob * 0.25);
          height = 2.4 + wob * 1.2;
        } else if (r > freeCut) {
          tmp.copy(free);
          height = 0.35;
        } else {
          const heat = 0.5 + 0.5 * Math.sin(elapsed * 1.5 + r * 30);
          tmp.copy(clean).lerp(hot, heat * sim.intensity);
          height = 1 + heat * 0.9;
        }
        mesh.setColorAt(i, tmp);

        const x = (i % cols) - (cols - 1) / 2;
        const z = Math.floor(i / cols) - (rows - 1) / 2;
        pos.set(x * gap, height / 2 + 0.9, z * gap);
        scl.set(1, height, 1);
        m.compose(pos, quat, scl);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}

/** Redo files: a marching band of log blocks whose lit portion is checkpoint age. */
function attachRedoBand(parent: THREE.Group): THREE.InstancedMesh {
  const count = 30;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0xffc93c,
      emissive: 0xffb020,
      emissiveIntensity: 1.6,
      roughness: 0.4,
    }),
    count,
  );
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
