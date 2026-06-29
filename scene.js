// scene.js — Three.js rendering for iLab Moon
import * as THREE from 'three';
import { groundHeightAtXZ, CRATERS } from './terrain.js';

// ─── Module-level objects ─────────────────────────────────────────────────────

let renderer, scene, camera, composer;
let sun, ambientLight, engineLight;
let terrainMesh, landerGroup;
let earthMesh, starfield;
let exhaustPoints, dustPoints, rcsLPoints, rcsRPoints;
let exhaustPosAttr, dustPosAttr, rcsLPosAttr, rcsRPosAttr;

const MAX_EXHAUST = 600;
const MAX_DUST    = 200;
const MAX_RCS     = 80;

let groundFn;
let camX = 0, camY = 350;
let useComposer = true;

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initScene(groundHeightAt) {
  groundFn = groundHeightAt;

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  // PCFShadowMap = hard-edged, airless lunar shadows (not PCFSoft)
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFShadowMap;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace    = THREE.SRGBColorSpace;
  document.getElementById('mount').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000005);

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 14000);
  camera.position.set(0, 350, 140);
  camera.lookAt(0, 300, 0);

  setupLights();
  buildTerrain();
  buildLander();
  buildParticleSystems();
  buildStarfield();
  buildEarth();

  // Bloom post-processing — dynamic import so a CDN hiccup never kills the game
  setupBloom().catch(e => {
    console.warn('Bloom unavailable, falling back to direct render:', e.message);
    useComposer = false;
  });

  window.addEventListener('resize', onResize);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
}

async function setupBloom() {
  const [
    { EffectComposer },
    { RenderPass },
    { UnrealBloomPass },
    { OutputPass },
  ] = await Promise.all([
    import('three/addons/postprocessing/EffectComposer.js'),
    import('three/addons/postprocessing/RenderPass.js'),
    import('three/addons/postprocessing/UnrealBloomPass.js'),
    import('three/addons/postprocessing/OutputPass.js'),
  ]);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.75, 0.55, 0.22
  ));
  composer.addPass(new OutputPass());
  useComposer = true;
}

// ─── Lights ───────────────────────────────────────────────────────────────────

function setupLights() {
  // Minimal ambient — moon has no atmospheric scatter
  ambientLight = new THREE.AmbientLight(0x18243a, 0.10);
  scene.add(ambientLight);

  // Sun: low-angle hard directional light, warm white, like Apollo footage
  sun = new THREE.DirectionalLight(0xfff5e0, 4.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left   = -220;
  sun.shadow.camera.right  = 220;
  sun.shadow.camera.top    = 180;
  sun.shadow.camera.bottom = -60;
  sun.shadow.camera.near   = 1;
  sun.shadow.camera.far    = 950;
  sun.shadow.bias = -0.0006;
  // Hard edges: no normalBias smoothing
  sun.shadow.normalBias = 0;
  scene.add(sun);
  scene.add(sun.target);

  // Engine plume point light — illuminates terrain below nozzle while thrusting
  engineLight = new THREE.PointLight(0xff8833, 0, 100, 1.8);
  scene.add(engineLight);
}

// ─── Procedural textures ──────────────────────────────────────────────────────

// Shared heightfield used for both color and normal map generation
function generateCraterField(size, craterCount) {
  const h = new Float32Array(size * size);
  h.fill(0.5);

  // Large rolling hills via low-freq noise
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size, ny = y / size;
      h[y * size + x] += 0.08 * Math.sin(nx * 6.2 + 1.1) * Math.cos(ny * 4.7 + 0.5)
                        + 0.04 * Math.sin(nx * 14 + 3.3) * Math.cos(ny * 11 + 2.1);
    }
  }

  // Impact craters — dark bowl with bright ejecta rim
  for (let c = 0; c < craterCount; c++) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    const r  = 6 + Math.random() * 32;
    for (let dy = -Math.ceil(r * 1.4); dy <= Math.ceil(r * 1.4); dy++) {
      for (let dx = -Math.ceil(r * 1.4); dx <= Math.ceil(r * 1.4); dx++) {
        const px = ((cx + dx) % size + size) % size;
        const py = ((cy + dy) % size + size) % size;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < r * 1.35) {
          const t = d / r;
          // Bowl inside, ejecta rim at edge
          const delta = t < 0.85
            ? -(1 - t / 0.85) * 0.28  // bowl
            : (t - 0.85) / 0.5 * 0.12; // rim
          h[py * size + px] = Math.max(0, Math.min(1, h[py * size + px] + delta));
        }
      }
    }
  }
  return h;
}

function makeNormalMap(h, size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx   = canvas.getContext('2d');
  const img   = ctx.createImageData(size, size);
  const str   = 6.0; // bumpiness strength

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + Math.max(0, x - 1)];
      const r = h[y * size + Math.min(size - 1, x + 1)];
      const u = h[Math.max(0, y - 1) * size + x];
      const d = h[Math.min(size - 1, y + 1) * size + x];

      let nx = (l - r) * str, ny = (d - u) * str, nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len; nz /= len;

      const i = (y * size + x) * 4;
      img.data[i]     = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeColorMap(h, size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);

  for (let i = 0; i < size * size; i++) {
    const v = h[i];
    // Realistic regolith: warm mid-gray, dark in crater bowls, bright on rims
    const base = 148 + (v - 0.5) * 90;
    const r = Math.min(255, Math.max(0, base + 6));
    const g = Math.min(255, Math.max(0, base));
    const b = Math.min(255, Math.max(0, base - 10));
    img.data[i * 4]     = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeMoonTextures() {
  // Must be power-of-2 for mipmaps and the wrap-around indexing in generateCraterField
  const size = 512;
  const h    = generateCraterField(size, 55);
  const colorTex  = makeColorMap(h, size);
  const normalTex = makeNormalMap(h, size);
  colorTex.repeat.set(18, 3);
  normalTex.repeat.set(18, 3);
  return { colorTex, normalTex };
}

function makeEarthTexture() {
  const size = 512;
  const c  = document.createElement('canvas');
  c.width  = c.height = size;
  const cx = c.getContext('2d');

  // Deep ocean — realistic blue-green
  cx.fillStyle = '#0d4b82';
  cx.fillRect(0, 0, size, size);

  // Shallow water / ocean variation
  for (let i = 0; i < 80; i++) {
    cx.fillStyle = `rgba(${20 + Math.random() * 20},${80 + Math.random() * 40},${140 + Math.random() * 30},0.15)`;
    cx.beginPath();
    cx.ellipse(Math.random() * size, Math.random() * size,
      20 + Math.random() * 60, 15 + Math.random() * 40, Math.random() * Math.PI, 0, Math.PI * 2);
    cx.fill();
  }

  // Continents with realistic green-brown mix
  const continents = [
    { x: 0.14, y: 0.27, rx: 0.10, ry: 0.14, r: '#3a7a2e', label: 'NAm' },
    { x: 0.22, y: 0.54, rx: 0.06, ry: 0.10, r: '#3a7020', label: 'SAm' },
    { x: 0.46, y: 0.24, rx: 0.06, ry: 0.12, r: '#5a6030', label: 'Eur' },
    { x: 0.52, y: 0.45, rx: 0.10, ry: 0.14, r: '#4a6820', label: 'Afr' },
    { x: 0.65, y: 0.28, rx: 0.12, ry: 0.16, r: '#5a5828', label: 'Asi' },
    { x: 0.80, y: 0.58, rx: 0.06, ry: 0.05, r: '#5a7030', label: 'Aus' },
  ];
  for (const ct of continents) {
    // Base land
    cx.fillStyle = ct.r;
    cx.beginPath();
    cx.ellipse(ct.x * size, ct.y * size, ct.rx * size, ct.ry * size, Math.random() * 0.4, 0, Math.PI * 2);
    cx.fill();
    // Desert / arid variation
    cx.fillStyle = `rgba(160,130,60,0.25)`;
    cx.beginPath();
    cx.ellipse(ct.x * size + 8, ct.y * size + 5, ct.rx * size * 0.5, ct.ry * size * 0.4, 0.5, 0, Math.PI * 2);
    cx.fill();
  }

  // Antarctic ice cap
  const iceGrad = cx.createRadialGradient(size / 2, size, 0, size / 2, size, size * 0.16);
  iceGrad.addColorStop(0, '#eef5ff');
  iceGrad.addColorStop(1, 'rgba(220,240,255,0)');
  cx.fillStyle = iceGrad;
  cx.fillRect(0, 0, size, size);

  // Arctic
  const arcticGrad = cx.createRadialGradient(size / 2, 0, 0, size / 2, 0, size * 0.12);
  arcticGrad.addColorStop(0, '#ddeeff');
  arcticGrad.addColorStop(1, 'rgba(200,230,255,0)');
  cx.fillStyle = arcticGrad;
  cx.fillRect(0, 0, size, size);

  // Cloud layer — wispy bands
  cx.globalAlpha = 0.3;
  for (let i = 0; i < 28; i++) {
    cx.fillStyle = '#ffffff';
    cx.beginPath();
    cx.ellipse(Math.random() * size, Math.random() * size,
      20 + Math.random() * 50, 4 + Math.random() * 12,
      Math.random() * Math.PI, 0, Math.PI * 2);
    cx.fill();
  }
  cx.globalAlpha = 1;

  return new THREE.CanvasTexture(c);
}

// ─── Terrain ──────────────────────────────────────────────────────────────────

function buildCraterRims() {
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xc8beb0, roughness: 0.94, metalness: 0.0,
    emissive: 0x282018, emissiveIntensity: 0.1,
  });
  const group = new THREE.Group();

  for (const c of CRATERS) {
    if (c.r < 40) continue;
    const rimY = groundHeightAtXZ(c.x, c.z) + c.rim * 0.35;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(c.r * 0.7, c.r * 1.08, 32),
      rimMat,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(c.x, rimY + 0.2, c.z);
    ring.receiveShadow = true;
    group.add(ring);
  }
  scene.add(group);
}

function buildTerrain() {
  const xMin = -2800, xMax = 2800, xStep = 8;
  const zHalf = 240, zSegs = 10;
  const xCount = Math.round((xMax - xMin) / xStep) + 1;
  const zCount = zSegs + 1;

  const positions = new Float32Array(xCount * zCount * 3);
  const uvs       = new Float32Array(xCount * zCount * 2);
  const indices   = [];

  for (let zi = 0; zi < zCount; zi++) {
    const z = -zHalf + (zi / zSegs) * zHalf * 2;
    for (let xi = 0; xi < xCount; xi++) {
      const x = xMin + xi * xStep;
      const y = groundHeightAtXZ(x, z) - 1.2;
      const i = zi * xCount + xi;
      positions[i * 3]     = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      uvs[i * 2]     = (xi / xCount) * 16;
      uvs[i * 2 + 1] = (zi / zSegs) * 3.5;
    }
  }

  for (let zi = 0; zi < zCount - 1; zi++) {
    for (let xi = 0; xi < xCount - 1; xi++) {
      const a = zi * xCount + xi,     b = zi * xCount + xi + 1;
      const c = (zi + 1) * xCount + xi, d = (zi + 1) * xCount + xi + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const { colorTex, normalTex } = makeMoonTextures();

  const mat = new THREE.MeshStandardMaterial({
    map:         colorTex,
    normalMap:   normalTex,
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughness:   0.97,
    metalness:   0.0,
    color:       0xb0a898,
  });

  terrainMesh = new THREE.Mesh(geo, mat);
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  buildCraterRims();

  // Deep fill-plane for visual depth below the terrain ribbon
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(10000, 800),
    new THREE.MeshStandardMaterial({ color: 0x282624, roughness: 1, metalness: 0 })
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = -100;
  fill.receiveShadow = true;
  scene.add(fill);
}

// ─── Lander ───────────────────────────────────────────────────────────────────
// Leg dimensions match physics constants in game.js:
//   footpad at local (±4.67, -10.0) → LEG_SPAN=4.67, LEG_DROP=10.0
//   engine bell bottom at local (0, -7.6) → BELL_DROP=7.6

function buildLander() {
  landerGroup = new THREE.Group();

  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xc08010, metalness: 0.82, roughness: 0.28,
    emissive: 0x200800, emissiveIntensity: 0.12,
  });
  const ascentMat = new THREE.MeshStandardMaterial({
    color: 0xd0d8e0, metalness: 0.52, roughness: 0.40,
  });
  const bellMat = new THREE.MeshStandardMaterial({
    color: 0x303438, metalness: 0.94, roughness: 0.16, side: THREE.DoubleSide,
  });
  const legMat  = new THREE.MeshStandardMaterial({ color: 0x727278, metalness: 0.4, roughness: 0.75 });
  const footMat = new THREE.MeshStandardMaterial({ color: 0x909090, metalness: 0.3, roughness: 0.85 });
  const foilMat = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.65, roughness: 0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a2030, metalness: 0.2, roughness: 0.85 });

  // Descent stage body (octagonal)
  add(new THREE.CylinderGeometry(4.5, 4.5, 6, 8), goldMat, 0, -1.5, 0);
  add(new THREE.CylinderGeometry(4.5, 3.8, 1.5, 8), goldMat, 0, -5, 0);

  // Tank band + panel lines on descent stage
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x9a7010, metalness: 0.7, roughness: 0.4 });
  add(new THREE.TorusGeometry(4.52, 0.12, 6, 24), bandMat, 0, -3.8, 0).rotation.x = Math.PI / 2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const panel = add(new THREE.BoxGeometry(0.06, 5.2, 1.8), bandMat,
      Math.sin(a) * 4.48, -2.2, Math.cos(a) * 4.48);
    panel.rotation.y = -a;
  }

  // Ascent stage
  add(new THREE.CylinderGeometry(2.9, 3.3, 5.5, 8), ascentMat, 0, 5.75, 0);
  add(new THREE.SphereGeometry(2.9, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), ascentMat, 0, 8.5, 0);

  // Docking port
  const portMat = new THREE.MeshStandardMaterial({ color: 0x888898, metalness: 0.82, roughness: 0.22 });
  add(new THREE.CylinderGeometry(0.8, 0.8, 1.2, 10), portMat, 0, 9.7, 0);

  // Commander's window (recessed dark pane)
  add(new THREE.BoxGeometry(1.1, 0.75, 0.15), foilMat, 2.55, 7.2, 0);
  add(new THREE.BoxGeometry(0.85, 0.55, 0.08), darkMat, 2.62, 7.2, 0.04);

  // VHF rod antennas on ascent module
  const antRodMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.78, roughness: 0.32 });
  const rodL = add(new THREE.CylinderGeometry(0.05, 0.05, 2.8, 5), antRodMat, -1.8, 10.2, 0.6);
  rodL.rotation.z = -0.35;
  const rodR = add(new THREE.CylinderGeometry(0.05, 0.04, 2.2, 5), antRodMat, 1.6, 10.5, -0.5);
  rodR.rotation.z = 0.28;
  add(new THREE.SphereGeometry(0.09, 6, 6), antRodMat, -1.85, 11.5, 0.65);
  add(new THREE.SphereGeometry(0.07, 6, 6), antRodMat, 1.62, 11.5, -0.52);

  // S-band steerable dish — iconic LM comm antenna
  const dishGroup = new THREE.Group();
  dishGroup.position.set(-3.2, 2.5, 0);
  dishGroup.rotation.z = 0.55;
  const dishArm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.2, 6), antRodMat);
  dishArm.position.set(0, 2.1, 0);
  dishArm.rotation.z = Math.PI / 2;
  dishGroup.add(dishArm);
  const dishMat = new THREE.MeshStandardMaterial({ color: 0xd8dce0, metalness: 0.85, roughness: 0.25 });
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.35, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), dishMat);
  dish.position.set(4.0, 2.1, 0);
  dish.rotation.z = -0.35;
  dishGroup.add(dish);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 5), antRodMat);
  feed.position.set(3.35, 2.0, 0);
  feed.rotation.z = Math.PI / 2;
  dishGroup.add(feed);
  landerGroup.add(dishGroup);

  // Rendezvous radar (small foil dish on opposite side)
  const radarGroup = new THREE.Group();
  radarGroup.position.set(2.8, 4.0, 0);
  radarGroup.rotation.z = -0.4;
  const radarArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.4), foilMat);
  radarArm.position.set(0, 1.2, 0);
  radarGroup.add(radarArm);
  const radarDish = new THREE.Mesh(
    new THREE.SphereGeometry(0.75, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.38),
    foilMat,
  );
  radarDish.position.set(0, 2.5, 0);
  radarGroup.add(radarDish);
  landerGroup.add(radarGroup);

  // RCS thruster clusters (four quads around ascent stage)
  const rcsMat = new THREE.MeshStandardMaterial({ color: 0x606468, metalness: 0.9, roughness: 0.2 });
  for (const [rx, ry, rz, rzRot] of [
    [2.6, 6.5, 1.8, 0.4], [-2.4, 6.8, 1.6, -0.35],
    [2.4, 4.2, -1.9, -0.3], [-2.6, 4.5, -1.7, 0.38],
  ]) {
    const rcs = add(new THREE.CylinderGeometry(0.18, 0.22, 0.55, 6), rcsMat, rx, ry, rz);
    rcs.rotation.x = rzRot;
    add(new THREE.CylinderGeometry(0.08, 0.12, 0.25, 5), rcsMat, rx, ry - 0.35, rz);
  }

  // Engine bell (open cone)
  add(new THREE.CylinderGeometry(0.9, 2.8, 3.2, 14, 1, true), bellMat, 0, -6, 0);

  // Glow ring at bell mouth — emissiveIntensity driven by throttle in syncScene
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xff8844, emissive: 0xff5500, emissiveIntensity: 0,
  });
  const glowRing = add(new THREE.TorusGeometry(0.9, 0.14, 8, 24), glowMat, 0, -4.5, 0);
  glowRing.name = 'glowRing';

  // Layered engine flame — visible from first throttle touch, scales with thrust
  const flameGroup = new THREE.Group();
  flameGroup.name = 'flameGroup';
  flameGroup.position.set(0, -7.5, 0);

  const flameCoreMat = new THREE.MeshBasicMaterial({
    color: 0xfffff0, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const flameMidMat = new THREE.MeshBasicMaterial({
    color: 0xffaa44, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const flameOuterMat = new THREE.MeshBasicMaterial({
    color: 0xff4400, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });

  const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.45, 3.0, 10), flameCoreMat);
  flameCore.rotation.x = Math.PI;
  flameCore.position.y = -1.5;
  flameCore.name = 'flameCore';
  flameGroup.add(flameCore);

  const flameMid = new THREE.Mesh(new THREE.ConeGeometry(0.85, 5.0, 12), flameMidMat);
  flameMid.rotation.x = Math.PI;
  flameMid.position.y = -2.5;
  flameMid.name = 'flameMid';
  flameGroup.add(flameMid);

  const flameOuter = new THREE.Mesh(new THREE.ConeGeometry(1.35, 7.5, 14), flameOuterMat);
  flameOuter.rotation.x = Math.PI;
  flameOuter.position.y = -3.75;
  flameOuter.name = 'flameOuter';
  flameGroup.add(flameOuter);

  flameGroup.userData.mats = { core: flameCoreMat, mid: flameMidMat, outer: flameOuterMat };
  landerGroup.add(flameGroup);

  // Four landing legs at 90° intervals (45° offset so legs face ±X, ±Z)
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const lx = Math.sin(ang), lz = Math.cos(ang);

    const strut = add(new THREE.CylinderGeometry(0.22, 0.22, 9.5, 6), legMat,
      lx * 3.8, -5.8, lz * 3.8);
    strut.rotation.z =  lx * 0.42;
    strut.rotation.x = -lz * 0.42;

    const brace = add(new THREE.CylinderGeometry(0.13, 0.13, 5.2, 6), legMat,
      lx * 2.0, -3.2, lz * 2.0);
    brace.rotation.z =  lx * 0.65;
    brace.rotation.x = -lz * 0.65;

    add(new THREE.CylinderGeometry(1.4, 1.4, 0.4, 10), footMat, lx * 6.6, -10.0, lz * 6.6);

    // Ladder on front-right leg
    if (i === 0) {
      for (let r = 0; r < 5; r++) {
        add(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 4), legMat,
          lx * 5.2 + 0.35, -8.5 + r * 1.6, lz * 5.2);
      }
      add(new THREE.CylinderGeometry(0.035, 0.035, 7.5, 4), legMat, lx * 5.5, -6.2, lz * 5.5);
      add(new THREE.CylinderGeometry(0.035, 0.035, 7.5, 4), legMat, lx * 4.9, -6.2, lz * 4.9);
    }
  }

  landerGroup.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // Flame meshes should not cast shadows
  flameGroup.traverse(o => { if (o.isMesh) o.castShadow = false; });
  scene.add(landerGroup);

  function add(geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    landerGroup.add(m);
    return m;
  }
}

// ─── Particle systems ─────────────────────────────────────────────────────────

function buildParticleSystems() {
  // Main engine exhaust — additive bright white/orange
  exhaustPoints = makePoints(MAX_EXHAUST, { color: 0xffeecc, size: 4.2, additive: true, opacity: 0.95 });
  exhaustPosAttr = exhaustPoints.geometry.getAttribute('position');

  // Regolith dust — muted gray, no additive
  dustPoints = makePoints(MAX_DUST, { color: 0xb0a898, size: 4.8, additive: false, opacity: 0.5 });
  dustPosAttr = dustPoints.geometry.getAttribute('position');

  // RCS left thruster puffs
  rcsLPoints = makePoints(MAX_RCS, { color: 0xaadeff, size: 2.4, additive: true, opacity: 0.75 });
  rcsLPosAttr = rcsLPoints.geometry.getAttribute('position');

  // RCS right thruster puffs
  rcsRPoints = makePoints(MAX_RCS, { color: 0xaadeff, size: 2.4, additive: true, opacity: 0.75 });
  rcsRPosAttr = rcsRPoints.geometry.getAttribute('position');
}

function makePoints(count, { color, size, additive, opacity }) {
  const pos = new Float32Array(count * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({
    color,
    size,
    sizeAttenuation: true,
    transparent:     true,
    opacity,
    blending:   additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return pts;
}

// ─── Starfield ────────────────────────────────────────────────────────────────

function buildStarfield() {
  const count = 3500;
  const pos   = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u  = Math.random(), v = Math.random();
    const th = 2 * Math.PI * u;
    const ph = Math.acos(2 * v - 1);
    const r  = 5000 + Math.random() * 1200;
    pos[i * 3]     = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    pos[i * 3 + 2] = r * Math.cos(ph);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  starfield = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xffffff, size: 2.6, sizeAttenuation: true, transparent: true, opacity: 0.90,
  }));
  scene.add(starfield);
}

// ─── Earth ────────────────────────────────────────────────────────────────────

function buildEarth() {
  // MeshStandardMaterial so the sun's DirectionalLight creates a natural terminator
  const earthMat = new THREE.MeshStandardMaterial({
    map:       makeEarthTexture(),
    roughness: 0.68,
    metalness: 0.0,
    emissive:  new THREE.Color(0x020e1a),
    emissiveIntensity: 1.0,
  });
  earthMesh = new THREE.Mesh(new THREE.SphereGeometry(90, 40, 40), earthMat);
  // Position set dynamically in syncScene
  earthMesh.position.set(600, 450, -2400);
  scene.add(earthMesh);
}

// ─── Per-frame sync ───────────────────────────────────────────────────────────

export function syncScene(rocket, particles, dust, rcsPuffsL, rcsPuffsR, throttleLevel, isThrusting) {

  // Camera smooth-follow with slight lag
  camX += (rocket.x    - camX) * 0.055;
  camY += (rocket.y + 5 - camY) * 0.042;
  camera.position.set(camX - 8, camY + 52, 140);
  camera.lookAt(camX + 4, camY - 8, 0);

  // Sun follows rocket to keep shadow quality consistent
  sun.position.set(rocket.x + 270, 285, 115);
  sun.target.position.set(rocket.x - 45, 0, 0);
  sun.target.updateMatrixWorld();

  // Lander mesh
  landerGroup.position.set(rocket.x, rocket.y, 0);
  landerGroup.rotation.z = -rocket.angle;

  // Engine bell glow + layered flame plume scale with throttle
  const glowRing = landerGroup.getObjectByName('glowRing');
  const flameGroup = landerGroup.getObjectByName('flameGroup');
  const t = throttleLevel;

  if (glowRing) {
    glowRing.material.emissiveIntensity = t > 0.02
      ? t * (1.8 + Math.random() * 0.9)
      : 0;
  }

  if (flameGroup) {
    const { core, mid, outer } = flameGroup.userData.mats;
    if (t > 0.02) {
      const flick = 0.88 + 0.12 * Math.sin(Date.now() * 0.018) + Math.random() * 0.06;
      const len   = 0.35 + t * 1.55;
      const width = 0.45 + t * 0.85;
      flameGroup.visible = true;
      flameGroup.scale.set(width * flick, len * flick, width * flick);
      core.opacity  = Math.min(1, 0.35 + t * 0.75);
      mid.opacity   = Math.min(0.9, 0.25 + t * 0.6);
      outer.opacity = Math.min(0.65, 0.12 + t * 0.42);
    } else {
      flameGroup.visible = false;
      core.opacity = mid.opacity = outer.opacity = 0;
    }
  }

  // Engine point light — flicker proportional to throttle (visible even at low thrust)
  if (t > 0.02) {
    const ex = rocket.x - Math.sin(rocket.angle) * 11;
    const ey = rocket.y - Math.cos(rocket.angle) * 11;
    engineLight.position.set(ex, ey, 0);
    engineLight.intensity = t * (3.5 + Math.random() * 2.5) + 0.4;
    engineLight.distance  = 70 + t * 45;
  } else {
    engineLight.intensity = 0;
  }

  // Exhaust
  syncParticlePoints(particles, exhaustPosAttr, exhaustPoints, MAX_EXHAUST);

  // Dust
  syncParticlePoints(dust, dustPosAttr, dustPoints, MAX_DUST);

  // RCS puffs
  syncParticlePoints(rcsPuffsL, rcsLPosAttr, rcsLPoints, MAX_RCS);
  syncParticlePoints(rcsPuffsR, rcsRPosAttr, rcsRPoints, MAX_RCS);

  // Earth — fixed sky position, natural terminator from sun
  earthMesh.position.set(camX + 580, camY + 390, -2400);
  earthMesh.rotation.y += 0.00012;

  // Starfield centered on camera (infinite background)
  starfield.position.copy(camera.position);

  // Render
  if (useComposer && composer) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

function syncParticlePoints(particles, attr, points, maxCount) {
  const count = Math.min(particles.length, maxCount);
  const arr   = attr.array;
  for (let i = 0; i < count; i++) {
    const p = particles[i];
    arr[i * 3]     = p.x;
    arr[i * 3 + 1] = p.y;
    // Stable per-particle Z spread seeded from maxLife
    arr[i * 3 + 2] = Math.sin(p.maxLife * 137.5 + i * 2.3) * 6;
  }
  attr.needsUpdate = true;
  points.geometry.setDrawRange(0, count);
}

// ─── Screen shake (called by game.js on crash) ────────────────────────────────

export function triggerScreenShake(intensity) {
  const mount = document.getElementById('mount');
  let frame = 0;
  const dur = 28 + intensity * 14;
  const shake = () => {
    if (frame > dur) { mount.style.transform = ''; return; }
    const mag = (dur - frame) / dur * intensity * 0.4;
    const tx  = (Math.random() - 0.5) * mag * 18;
    const ty  = (Math.random() - 0.5) * mag * 18;
    mount.style.transform = `translate(${tx}px,${ty}px)`;
    frame++;
    requestAnimationFrame(shake);
  };
  requestAnimationFrame(shake);
}
