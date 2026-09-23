import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { DISTRICT_BY_ID, FLOWS } from '../data/districts';
import type { Flow } from '../types';
import type { Sim } from '../sim';
import type { LabelMode } from './city';

interface Lane {
  data: Flow;
  curve: THREE.QuadraticBezierCurve3;
  points: THREE.Points;
  tube: THREE.Mesh;
  positions: Float32Array;
  offsets: Float32Array;
  speeds: Float32Array;
  count: number;
  labelEl: HTMLDivElement;
}

export interface Flows {
  group: THREE.Group;
  update(dt: number, sim: Sim): void;
  setLabelMode(mode: LabelMode): void;
  focusDistrict(districtId: string | null): void;
  laneNotes(): Array<{ label: string; note: string; color: string }>;
}

export function createFlows(): Flows {
  const group = new THREE.Group();
  group.name = 'flows';
  const lanes: Lane[] = [];
  const sprite = particleSprite();

  for (const flow of FLOWS) {
    const from = DISTRICT_BY_ID.get(flow.from);
    const to = DISTRICT_BY_ID.get(flow.to);
    if (!from || !to) continue;

    const a = new THREE.Vector3(from.center[0], 8, from.center[1]);
    const b = new THREE.Vector3(to.center[0], 8, to.center[1]);

    // Start and end at the district edge, not the centre, so lanes look like roads.
    const dir = b.clone().sub(a).normalize();
    const start = a.clone().addScaledVector(dir, from.radius * 0.85);
    const end = b.clone().addScaledVector(dir, -to.radius * 0.85);

    const mid = start.clone().lerp(end, 0.5);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    mid.addScaledVector(side, flow.bow);
    mid.y += 26 + Math.abs(flow.bow) * 0.35;

    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const color = new THREE.Color(flow.color);

    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 48, 0.32, 6, false),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2 }),
    );
    group.add(tube);

    const count = flow.density;
    const positions = new Float32Array(count * 3);
    const offsets = new Float32Array(count);
    const speeds = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      offsets[i] = Math.random();
      speeds[i] = 0.7 + Math.random() * 0.6;
      const c = color.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.25);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 2.6,
        map: sprite,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    points.frustumCulled = false;
    group.add(points);

    const labelEl = document.createElement('div');
    labelEl.className = 'label label-lane';
    labelEl.textContent = flow.label;
    labelEl.style.setProperty('--label-color', '#' + color.getHexString());
    const label = new CSS2DObject(labelEl);
    label.position.copy(curve.getPoint(0.5));
    group.add(label);

    lanes.push({ data: flow, curve, points, tube, positions, offsets, speeds, count, labelEl });
  }

  const tmp = new THREE.Vector3();
  let focused: string | null = null;

  return {
    group,

    update(dt, sim) {
      const base = sim.config.paused ? 0 : 0.06 + sim.intensity * 0.34;
      for (const lane of lanes) {
        const speedScale = base * (0.5 + lane.data.loadFactor * 0.9) * sim.config.speed;
        const active = Math.max(
          6,
          Math.round(lane.count * (0.15 + sim.intensity * lane.data.loadFactor * 0.85)),
        );
        for (let i = 0; i < lane.count; i++) {
          if (i < active) {
            lane.offsets[i] = (lane.offsets[i] + dt * speedScale * lane.speeds[i]) % 1;
            lane.curve.getPoint(lane.offsets[i], tmp);
            lane.positions[i * 3] = tmp.x;
            lane.positions[i * 3 + 1] = tmp.y + Math.sin(lane.offsets[i] * 14 + i) * 0.5;
            lane.positions[i * 3 + 2] = tmp.z;
          } else {
            // Park unused particles far below the city instead of resizing buffers.
            lane.positions[i * 3 + 1] = -9999;
          }
        }
        lane.points.geometry.attributes.position.needsUpdate = true;

        const dim =
          focused === null || focused === lane.data.from || focused === lane.data.to ? 1 : 0.18;
        (lane.points.material as THREE.PointsMaterial).opacity = dim;
        (lane.tube.material as THREE.MeshBasicMaterial).opacity = 0.2 * dim;
        lane.labelEl.classList.toggle('is-dim', dim < 1);
      }
    },

    setLabelMode(mode) {
      for (const lane of lanes) {
        lane.labelEl.style.display = mode === 'all' ? '' : 'none';
      }
    },

    focusDistrict(id) {
      focused = id;
    },

    laneNotes() {
      return FLOWS.map((f) => ({
        label: f.label,
        note: f.note,
        color: '#' + new THREE.Color(f.color).getHexString(),
      }));
    },
  };
}

function particleSprite(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
