import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';

let _raf     = null;
let _renderer = null;
let _panel   = null;

// ── Grid constants ─────────────────────────────────────────────────────────
const COLS       = 42;     // particles across
const ROWS       = 42;     // particles down
const W          = 2.8;    // cloth width  (world units)
const H          = 2.8;    // cloth height
const GRAVITY    = -9.0;
const DAMPING    = 0.992;
const ROD_Y      = 1.35;   // height of the rod
const CURL_DEPTH = 0.42;   // how far the petal edges bow toward the viewer

// ── Petal Z-profile ────────────────────────────────────────────────────────
// U-shape: edges at +CURL_DEPTH, centre at 0 → creates the characteristic
// central fold you see on a real rose petal.
// t ∈ [0,1]  →  left edge … right edge
function petalEdgeZ(t) {
  return CURL_DEPTH * (1.0 - 4.0 * t * (1.0 - t));
}

// ── Petal silhouette ───────────────────────────────────────────────────────
// v = 0 → top (WIDE, pinned row)
// v = 1 → bottom (pointed tip)
//
// Shape matches the reference photo:
//   • Top arch  : gently rounds the upper corners (not a hard right angle)
//   • Broad body: stays near maximum width for the upper half
//   • Taper     : quadratic convergence to a rounded tip
const PEAK_HW = 0.43;   // maximum half-width in u-fraction space

function petalHalfWidth(v) {
  if (v < 0.22) {
    // Rounded top arch: smoothstep from 68% → 100% of peak width
    const t    = v / 0.22;
    const ease = t * t * (3.0 - 2.0 * t);
    return PEAK_HW * (0.68 + 0.32 * ease);
  } else if (v < 0.50) {
    // Broad plateau — petal is widest here
    return PEAK_HW;
  } else {
    // Quadratic taper to pointed tip
    const t = (v - 0.50) / 0.50;
    return PEAK_HW * (1.0 - t * t);
  }
}

function isInPetal(r, c) {
  const v = r / (ROWS - 1);
  const u = c / (COLS - 1);
  return Math.abs(u - 0.5) <= petalHalfWidth(v);
}

// ── Rod geometry ───────────────────────────────────────────────────────────
// Spans the pinned top edge of the petal (wide arch), following the U Z-curve.
function makeRodCurve() {
  const topHW = petalHalfWidth(0);        // half-width fraction at v=0
  const halfX = topHW * W + 0.14;         // world-unit half-span + small overhang
  const pts   = [];
  for (let i = 0; i <= 32; i++) {
    const t  = i / 32;
    const x  = (t - 0.5) * halfX * 2;
    const tZ = x / W + 0.5;
    pts.push(new THREE.Vector3(x, ROD_Y, petalEdgeZ(tZ)));
  }
  return new THREE.CatmullRomCurve3(pts);
}

// ── Particles ──────────────────────────────────────────────────────────────
function makeParticles() {
  const ps = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t      = c / (COLS - 1);
      const x      = (t - 0.5) * W;
      const y      = ROD_Y - (r / (ROWS - 1)) * H;
      const z      = petalEdgeZ(t) + (Math.random() - 0.5) * 0.008;
      const active = isInPetal(r, c);
      ps.push({
        pos:    new THREE.Vector3(x, y, z),
        prev:   new THREE.Vector3(x, y, z),
        rest:   new THREE.Vector3(x, y, petalEdgeZ(t)),
        pinned: r === 0 && active,
        active,
      });
    }
  }
  return ps;
}

// ── Constraints ────────────────────────────────────────────────────────────
function makeConstraints(particles) {
  const cs = [];
  const idx    = (r, c) => r * COLS + c;
  const rlen   = (i, j) => particles[i].pos.distanceTo(particles[j].pos);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(r, c);
      if (!particles[i].active) continue;

      // Structural
      if (c + 1 < COLS && particles[idx(r, c+1)].active)
        cs.push({ i, j: idx(r, c+1), rest: rlen(i, idx(r, c+1)), bend: false });
      if (r + 1 < ROWS && particles[idx(r+1, c)].active)
        cs.push({ i, j: idx(r+1, c), rest: rlen(i, idx(r+1, c)), bend: false });

      // Shear
      if (c + 1 < COLS && r + 1 < ROWS) {
        if (particles[idx(r+1, c+1)].active)
          cs.push({ i, j: idx(r+1, c+1), rest: rlen(i, idx(r+1, c+1)), bend: false });
        if (particles[idx(r, c+1)].active && particles[idx(r+1, c)].active)
          cs.push({ i: idx(r, c+1), j: idx(r+1, c),
                    rest: rlen(idx(r, c+1), idx(r+1, c)), bend: false });
      }

      // Bend (skip-1 — resists folding)
      if (c + 2 < COLS && particles[idx(r, c+2)].active)
        cs.push({ i, j: idx(r, c+2), rest: rlen(i, idx(r, c+2)), bend: true });
      if (r + 2 < ROWS && particles[idx(r+2, c)].active)
        cs.push({ i, j: idx(r+2, c), rest: rlen(i, idx(r+2, c)), bend: true });
    }
  }
  return cs;
}

// ── PBD step ───────────────────────────────────────────────────────────────
function stepCloth(particles, constraints, dt, stiffness) {
  const substeps = Math.round(8 + stiffness * 22);
  const iters    = Math.round(1 + stiffness * 4);
  const subDt2   = (dt / substeps) ** 2;
  const bendK    = stiffness < 0.5 ? stiffness * stiffness * 2 : stiffness;

  for (let s = 0; s < substeps; s++) {
    for (const p of particles) {
      if (p.pinned || !p.active) continue;
      const vx = (p.pos.x - p.prev.x) * DAMPING;
      const vy = (p.pos.y - p.prev.y) * DAMPING;
      const vz = (p.pos.z - p.prev.z) * DAMPING;
      p.prev.copy(p.pos);
      p.pos.x += vx;
      p.pos.y += vy + GRAVITY * subDt2;
      p.pos.z += vz;
    }

    for (let iter = 0; iter < iters; iter++) {
      for (const c of constraints) {
        const pa = particles[c.i], pb = particles[c.j];
        const k  = c.bend ? bendK : stiffness;
        const dx = pb.pos.x - pa.pos.x;
        const dy = pb.pos.y - pa.pos.y;
        const dz = pb.pos.z - pa.pos.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dist < 1e-6) continue;
        const diff = (dist - c.rest) / dist * k * 0.5;
        if (!pa.pinned) { pa.pos.x += dx*diff; pa.pos.y += dy*diff; pa.pos.z += dz*diff; }
        if (!pb.pinned) { pb.pos.x -= dx*diff; pb.pos.y -= dy*diff; pb.pos.z -= dz*diff; }
      }
    }
  }

  // Shape restoration — rigidity = stiffness³
  const rigidity = stiffness * stiffness * stiffness;
  if (rigidity < 0.001) return;
  for (const p of particles) {
    if (p.pinned || !p.active) continue;
    const rx = p.rest.x - p.pos.x;
    const ry = p.rest.y - p.pos.y;
    const rz = p.rest.z - p.pos.z;
    p.pos.x += rx * rigidity;
    p.pos.y += ry * rigidity;
    p.pos.z += rz * rigidity;
    p.prev.x = p.pos.x - (p.pos.x - p.prev.x) * (1 - rigidity);
    p.prev.y = p.pos.y - (p.pos.y - p.prev.y) * (1 - rigidity);
    p.prev.z = p.pos.z - (p.pos.z - p.prev.z) * (1 - rigidity);
  }
}

// ── Smooth alpha map ───────────────────────────────────────────────────────
// Renders the petal outline at full texture resolution, with a soft fade zone
// of FADE UV-units. This removes the staircase from the geometry edge.
function buildPetalAlphaMap() {
  const SIZE = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx    = canvas.getContext('2d');
  const img    = ctx.createImageData(SIZE, SIZE);
  const data   = img.data;
  const FADE   = 0.022;   // softness in UV space (≈ 1 grid step wide)

  for (let py = 0; py < SIZE; py++) {
    // With tex.flipY = false, canvas py=0 → uvY=1 (top of petal, v=0)
    const v  = py / (SIZE - 1);           // 0 = top (wide), 1 = bottom (tip)
    const hw = petalHalfWidth(v);

    for (let px = 0; px < SIZE; px++) {
      const u     = px / (SIZE - 1);
      const dist  = Math.abs(u - 0.5) - hw;   // negative = inside, positive = outside
      const alpha = Math.max(0.0, Math.min(1.0, -dist / FADE));
      const i4    = (py * SIZE + px) * 4;
      data[i4]     = 255;
      data[i4 + 1] = 255;
      data[i4 + 2] = 255;
      data[i4 + 3] = Math.round(alpha * 255);
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;   // our UVs already place row-0 at uvY=1
  return tex;
}

// ── Build geometry ─────────────────────────────────────────────────────────
function buildClothGeo(particles) {
  const posArr = new Float32Array(particles.length * 3);
  const uvArr  = new Float32Array(particles.length * 2);
  const idxArr = [];

  for (let i = 0; i < particles.length; i++) {
    const r = Math.floor(i / COLS), c = i % COLS;
    posArr[i*3]   = particles[i].pos.x;
    posArr[i*3+1] = particles[i].pos.y;
    posArr[i*3+2] = particles[i].pos.z;
    uvArr[i*2]    = c / (COLS - 1);
    uvArr[i*2+1]  = 1 - r / (ROWS - 1);
  }

  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const a = r * COLS + c, b = a + 1, d = a + COLS, e = d + 1;
      // Only emit triangles where every vertex is inside the petal
      if (particles[a].active && particles[d].active && particles[b].active)
        idxArr.push(a, d, b);
      if (particles[b].active && particles[d].active && particles[e].active)
        idxArr.push(b, d, e);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(uvArr,  2));
  geo.setIndex(idxArr);
  geo.computeVertexNormals();
  return geo;
}

function syncGeo(geo, particles) {
  const arr = geo.attributes.position.array;
  for (let i = 0; i < particles.length; i++) {
    arr[i*3]   = particles[i].pos.x;
    arr[i*3+1] = particles[i].pos.y;
    arr[i*3+2] = particles[i].pos.z;
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
}

// ── Control panel ──────────────────────────────────────────────────────────
function createPanel(onStiffnessChange, onReset, onWind) {
  const panel = document.createElement('div');
  panel.id = 'physics-panel';
  panel.innerHTML = `
    <div class="panel-title">🌸 Petal Physics</div>

    <label class="param-row">
      <span class="param-label">Stiffness</span>
      <input type="range" id="stiffness-slider" min="1" max="100" value="35" step="1">
      <span class="param-val" id="stiffness-val">35%</span>
    </label>
    <div class="param-hint" id="stiffness-hint">Silk — gentle drape</div>

    <div class="panel-buttons">
      <button id="reset-btn">↺ Reset</button>
      <button id="wind-btn">💨 Wind</button>
    </div>
  `;
  document.body.appendChild(panel);

  const slider   = panel.querySelector('#stiffness-slider');
  const valLabel = panel.querySelector('#stiffness-val');
  const hint     = panel.querySelector('#stiffness-hint');

  const hints = [
    [0,  15,  'Rubber — stretches wildly'],
    [15, 35,  'Very soft and elastic'],
    [35, 55,  'Silk — gentle drape'],
    [55, 72,  'Cotton — natural petal'],
    [72, 88,  'Stiff — barely flexes'],
    [88, 96,  'Cardboard — almost rigid'],
    [96, 101, 'Solid — no deformation'],
  ];

  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    valLabel.textContent = v + '%';
    const h = hints.find(([lo, hi]) => v >= lo && v < hi);
    if (h) hint.textContent = h[2];
    onStiffnessChange(v / 100);
  });
  panel.querySelector('#reset-btn').addEventListener('click', onReset);
  panel.querySelector('#wind-btn').addEventListener('click', onWind);

  return panel;
}

// ── Mount / Unmount ────────────────────────────────────────────────────────
export function mountPhysics(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  const camera = new THREE.PerspectiveCamera(44, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 0.0, 5.5);

  _renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  _renderer.setSize(container.clientWidth, container.clientHeight);
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _renderer.toneMapping = THREE.ACESFilmicToneMapping;
  _renderer.toneMappingExposure = 0.95;
  container.appendChild(_renderer.domElement);

  const controls = new OrbitControls(camera, _renderer.domElement);
  controls.target.set(0, -0.1, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.update();

  const composer = new EffectComposer(_renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, new BloomEffect({
    intensity: 0.30, luminanceThreshold: 0.78,
    luminanceSmoothing: 0.55, radius: 0.45,
  })));

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 2.2));
  const key = new THREE.DirectionalLight(0xfff4ee, 2.8);
  key.position.set(2, 4, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffeedd, 1.2);
  fill.position.set(-3, 1, 2);
  scene.add(fill);

  // ── Petal ──
  let particles   = makeParticles();
  let constraints = makeConstraints(particles);
  let stiffness   = 0.35;
  let windOn      = false;
  let windTime    = 0;

  const geo      = buildClothGeo(particles);
  const alphaTex = buildPetalAlphaMap();
  const mat = new THREE.MeshStandardMaterial({
    color:             0xdd1111,
    emissive:          0x550000,
    emissiveIntensity: 0.30,
    roughness:         0.55,
    metalness:         0.02,
    side:        THREE.DoubleSide,
    transparent: true,
    alphaMap:    alphaTex,
    depthWrite:  true,
  });
  scene.add(new THREE.Mesh(geo, mat));

  // ── Rod ──
  const rodCurve = makeRodCurve();
  const rodGeo   = new THREE.TubeGeometry(rodCurve, 32, 0.016, 8, false);
  const rodMat   = new THREE.MeshStandardMaterial({ color: 0x886655, roughness: 0.4, metalness: 0.6 });
  scene.add(new THREE.Mesh(rodGeo, rodMat));

  // ── Panel ──
  _panel = createPanel(
    v  => { stiffness = v; },
    () => { particles = makeParticles(); constraints = makeConstraints(particles); },
    () => { windOn = !windOn; }
  );

  // ── Resize ──
  const onResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    _renderer.setSize(container.clientWidth, container.clientHeight);
    composer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', onResize);
  _renderer._onResize = onResize;

  // ── Animate ──
  const clock = new THREE.Clock();
  function animate() {
    _raf = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.033);
    windTime += dt;

    if (windOn) {
      const wStrength = Math.sin(windTime * 1.2) * 0.18;
      for (const p of particles) {
        if (!p.pinned && p.active) p.pos.z += wStrength * dt;
      }
    }

    stepCloth(particles, constraints, dt, stiffness);
    syncGeo(geo, particles);
    controls.update();
    composer.render();
  }
  animate();
}

export function unmountPhysics(container) {
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  if (_panel) { _panel.remove(); _panel = null; }
  if (_renderer) {
    window.removeEventListener('resize', _renderer._onResize);
    _renderer.dispose();
    if (_renderer.domElement.parentNode === container) container.removeChild(_renderer.domElement);
    _renderer = null;
  }
}
