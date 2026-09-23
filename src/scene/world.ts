import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export interface World {
  renderer: THREE.WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  setShadows(on: boolean): void;
  resize(): void;
}

const SKY_TOP = new THREE.Color(0x0a0f2b);
const SKY_BOTTOM = new THREE.Color(0x1d2a5e);

export function createWorld(canvas: HTMLCanvasElement, labelHost: HTMLElement): World {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap is deprecated for WebGLRenderer as of r185; PCF is soft now.
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const labelRenderer = new CSS2DRenderer({ element: labelHost });
  labelRenderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = SKY_TOP.clone();
  scene.fog = new THREE.Fog(0x111a44, 220, 620);

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.5, 2000);
  camera.position.set(150, 140, 210);

  scene.add(createSkyDome());
  scene.add(createGround());

  const hemi = new THREE.HemisphereLight(0x9fc4ff, 0x1a1f45, 1.35);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0d6, 2.1);
  sun.position.set(-150, 210, 120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -230;
  sun.shadow.camera.right = 230;
  sun.shadow.camera.top = 230;
  sun.shadow.camera.bottom = -230;
  sun.shadow.camera.near = 40;
  sun.shadow.camera.far = 520;
  sun.shadow.bias = -0.0009;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  scene.add(sun.target);

  // A cool rim light from the opposite side so dark facades keep their shape.
  const rim = new THREE.DirectionalLight(0x5f7bff, 0.85);
  rim.position.set(180, 90, -160);
  scene.add(rim);

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }

  window.addEventListener('resize', resize);

  return {
    renderer,
    labelRenderer,
    scene,
    camera,
    sun,
    setShadows(on: boolean) {
      renderer.shadowMap.enabled = on;
      sun.castShadow = on;
      scene.traverse((obj) => {
        const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => (m.needsUpdate = true));
        else if (mat) mat.needsUpdate = true;
      });
    },
    resize,
  };
}

function createSkyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: SKY_TOP },
      bottomColor: { value: SKY_BOTTOM },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      varying vec3 vWorld;
      void main() {
        float h = clamp(normalize(vWorld).y * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = mix(bottomColor, topColor, pow(h, 0.85));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.renderOrder = -1;
  return mesh;
}

function createGround(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ground';

  const grid = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshStandardMaterial({
      color: 0x121a3d,
      roughness: 0.95,
      metalness: 0.05,
      map: makeGridTexture(),
    }),
  );
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = -0.05;
  grid.receiveShadow = true;
  group.add(grid);

  return group;
}

function makeGridTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#141d44';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(120, 160, 255, 0.16)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(120, 160, 255, 0.07)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const p = (size / 4) * i;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(70, 70);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
