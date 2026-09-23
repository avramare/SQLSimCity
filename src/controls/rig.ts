import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

export interface Collider {
  x: number;
  z: number;
  r: number;
}

export type RigMode = 'orbit' | 'walk';

export interface Rig {
  mode: RigMode;
  orbit: OrbitControls;
  walk: PointerLockControls;
  isTweening: boolean;
  update(dt: number): void;
  flyTo(position: THREE.Vector3, target: THREE.Vector3, ms?: number): void;
  enterWalk(at?: THREE.Vector3): void;
  exitWalk(): void;
  toggleWalk(): void;
  setColliders(colliders: Collider[]): void;
  onModeChange(cb: (mode: RigMode) => void): void;
}

const EYE_HEIGHT = 7.5;
const WALK_SPEED = 42;
const SPRINT_MULTIPLIER = 2.4;

export function createRig(camera: THREE.PerspectiveCamera, dom: HTMLElement): Rig {
  const orbit = new OrbitControls(camera, dom);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.screenSpacePanning = false;
  orbit.minDistance = 18;
  orbit.maxDistance = 620;
  orbit.maxPolarAngle = Math.PI * 0.49;
  orbit.target.set(0, 6, 0);

  const walk = new PointerLockControls(camera, dom);
  walk.enabled = false;

  const keys = new Set<string>();
  let colliders: Collider[] = [];
  let mode: RigMode = 'orbit';
  const modeListeners: Array<(m: RigMode) => void> = [];

  // Fly-to tween state
  let tween: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    t: number;
    dur: number;
  } | null = null;

  const velocity = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  walk.addEventListener('unlock', () => {
    if (mode === 'walk') exitWalk();
  });

  function setMode(next: RigMode): void {
    if (mode === next) return;
    mode = next;
    modeListeners.forEach((cb) => cb(mode));
  }

  function enterWalk(at?: THREE.Vector3): void {
    tween = null;
    const spot = at ? at.clone() : orbit.target.clone();
    camera.position.set(spot.x, groundHeightAt(spot.x, spot.z) + EYE_HEIGHT, spot.z + 34);
    camera.lookAt(spot.x, groundHeightAt(spot.x, spot.z) + EYE_HEIGHT, spot.z);
    orbit.enabled = false;
    walk.enabled = true;
    setMode('walk');
    walk.lock();
  }

  function exitWalk(): void {
    walk.enabled = false;
    if (walk.isLocked) walk.unlock();
    orbit.enabled = true;
    // Put the orbit target where the walker was looking so the view does not jump.
    camera.getWorldDirection(forward);
    orbit.target.copy(camera.position).addScaledVector(forward, 45);
    orbit.target.y = Math.max(4, orbit.target.y);
    setMode('orbit');
  }

  function groundHeightAt(x: number, z: number): number {
    // District plates stand 2.4 units above the base plane.
    for (const c of colliders) {
      if (c.r > 30) {
        const dx = x - c.x;
        const dz = z - c.z;
        if (dx * dx + dz * dz < c.r * c.r) return 2.4;
      }
    }
    return 0;
  }

  function resolveCollisions(): void {
    const p = camera.position;
    for (const c of colliders) {
      if (c.r > 30) continue; // district plates are walkable, not solid
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const distSq = dx * dx + dz * dz;
      const min = c.r + 2.2;
      if (distSq < min * min && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        p.x = c.x + (dx / dist) * min;
        p.z = c.z + (dz / dist) * min;
      }
    }
    const limit = 340;
    p.x = THREE.MathUtils.clamp(p.x, -limit, limit);
    p.z = THREE.MathUtils.clamp(p.z, -limit, limit);
  }

  function update(dt: number): void {
    if (tween) {
      tween.t = Math.min(1, tween.t + (dt * 1000) / tween.dur);
      const k = easeInOutCubic(tween.t);
      camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
      orbit.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
      if (tween.t >= 1) {
        tween = null;
        orbit.enabled = true;
      }
    }

    if (mode === 'walk') {
      const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT_MULTIPLIER : 1;
      const speed = WALK_SPEED * sprint;
      let fwd = 0;
      let strafe = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;

      right.set(strafe, 0, -fwd);
      if (right.lengthSq() > 0) right.normalize().multiplyScalar(speed);
      velocity.lerp(right, Math.min(1, dt * 12));

      if (velocity.lengthSq() > 0.0001) {
        walk.moveRight(velocity.x * dt);
        walk.moveForward(-velocity.z * dt);
      }

      resolveCollisions();
      const groundY = groundHeightAt(camera.position.x, camera.position.z) + EYE_HEIGHT;
      camera.position.y += (groundY - camera.position.y) * Math.min(1, dt * 8);
    } else {
      orbit.update();
    }
  }

  return {
    get mode() {
      return mode;
    },
    orbit,
    walk,
    get isTweening() {
      return tween !== null;
    },
    update,
    flyTo(position, target, ms = 1100) {
      if (mode === 'walk') exitWalk();
      orbit.enabled = false;
      tween = {
        fromPos: camera.position.clone(),
        toPos: position.clone(),
        fromTarget: orbit.target.clone(),
        toTarget: target.clone(),
        t: 0,
        dur: ms,
      };
    },
    enterWalk,
    exitWalk,
    toggleWalk() {
      if (mode === 'walk') exitWalk();
      else enterWalk();
    },
    setColliders(next) {
      colliders = next;
    },
    onModeChange(cb) {
      modeListeners.push(cb);
    },
  };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
