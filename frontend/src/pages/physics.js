import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';

let _raf      = null;
let _renderer = null;
let _panel    = null;

// ── Grid constants ─────────────────────────────────────────────────────────
const COLS       = 48;
const ROWS       = 48;
const W          = 2.8;    // cloth width  (world units)
const H          = 2.8;    // cloth height
const GRAVITY    = 0;      // disabled — user will enable later
const DAMPING    = 0.986;
const ROD_Y      = 1.35;
const CURL_DEPTH = 0.32;

// U-shape Z: edges bow toward viewer, centre sits back
function petalEdgeZ(t) { return CURL_DEPTH * (1.0 - 4.0 * t * (1.0 - t)); }

// ── Desmos shape — analytical boundary ────────────────────────────────────
//
// The shape is built from three Desmos curves mapped into UV space.
// v = 0 → top of cloth (y_math = 3, pointed tip)
// v = 1 → bottom of cloth (y_math = -1, base of ellipse)
// y_math = 3 - 4*v
//
// Bottom (y≤0): half-ellipse  x²/4 + y² = 1
// Upper arcs  (y≥0): rotated ellipse  ((dx·cos k − dy·sin k)²/6 + (dx·sin k + dy·cos k)² = R
//   Right arc: center=(c11,c12)=(0.5218,1.3), k=-2.2, R=0.8
//   Left arc : mirror by symmetry (same hw)
//
// SCALE maps math x [0,2] → UV half-width [0, 0.48]  (preserves ~1:1 aspect)
const _SCALE = 0.24;

// Pre-compute the right-arc constants once (k1 = -2.2, P = 6, R1 = 0.8)
const _c11 = 0.5217794, _c12 = 1.3;
const _k1  = -2.2,  _P = 6.0, _R1 = 0.8;
const _a   = Math.cos(_k1);          //  cos(-2.2) ≈ -0.58850
const _b   = Math.sin(_k1);          //  sin(-2.2) ≈ -0.80850
const _A   = _a*_a/_P + _b*_b;       // quadratic coeff, constant across y

function petalHalfWidth(v) {
  const y = 3.0 - 4.0 * v;                  // math y: 3 → top, -1 → bottom

  if (y < -1.0) return 0;

  if (y <= 0.0) {
    // Bottom half-ellipse: x = 2·√(1 − y²)
    return 2.0 * Math.sqrt(Math.max(0, 1.0 - y * y)) * _SCALE;
  }

  // Upper right arc — solve the rotated ellipse for x (larger root = outer boundary)
  const dy = y - _c12;
  const B  = 2.0 * dy * _a * _b * (1.0 - 1.0 / _P);
  const C  = dy*dy * (_b*_b/_P + _a*_a) - _R1;
  const disc = B*B - 4.0*_A*C;
  if (disc < 0) return 0;

  const xRight = (-B + Math.sqrt(disc)) / (2.0 * _A) + _c11;
  return Math.max(0, xRight) * _SCALE;
}

function isInPetal(r, c) {
  const v = r / (ROWS - 1);
  const u = c / (COLS - 1);
  return Math.abs(u - 0.5) <= petalHalfWidth(v);
}

// ── Rod (tiny — matches the narrow petal tip) ──────────────────────────────
function makeRodCurve() {
  // Span the actual geometry at v≈0.06 (a few rows below the very tip)
  const halfX = petalHalfWidth(0.06) * W + 0.10;
  const pts   = [];
  for (let i = 0; i <= 12; i++) {
    const t  = i / 12;
    const x  = (t - 0.5) * halfX * 2;
    const tZ = x / W + 0.5;
    pts.push(new THREE.Vector3(x, -ROD_Y, petalEdgeZ(tZ)));
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
      const y      = -ROD_Y + (r / (ROWS - 1)) * H;
      const z      = petalEdgeZ(t) + (Math.random() - 0.5) * 0.006;
      const active = isInPetal(r, c);
      ps.push({
        pos:    new THREE.Vector3(x, y, z),
        prev:   new THREE.Vector3(x, y, z),
        rest:   new THREE.Vector3(x, -ROD_Y + (r / (ROWS - 1)) * H, petalEdgeZ(t)),
        pinned: false,  // no bar → shape-restoration keeps the petal in place
        active,
      });
    }
  }
  return ps;
}

// ── Constraints ────────────────────────────────────────────────────────────
function makeConstraints(particles) {
  const cs  = [];
  const idx = (r, c) => r * COLS + c;
  const rl  = (i, j) => particles[i].pos.distanceTo(particles[j].pos);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(r, c);
      if (!particles[i].active) continue;
      if (c + 1 < COLS && particles[idx(r, c+1)].active)
        cs.push({ i, j: idx(r, c+1), rest: rl(i, idx(r, c+1)), bend: false });
      if (r + 1 < ROWS && particles[idx(r+1, c)].active)
        cs.push({ i, j: idx(r+1, c), rest: rl(i, idx(r+1, c)), bend: false });
      if (c + 1 < COLS && r + 1 < ROWS) {
        if (particles[idx(r+1, c+1)].active)
          cs.push({ i, j: idx(r+1, c+1), rest: rl(i, idx(r+1, c+1)), bend: false });
        if (particles[idx(r, c+1)].active && particles[idx(r+1, c)].active)
          cs.push({ i: idx(r, c+1), j: idx(r+1, c),
                    rest: rl(idx(r, c+1), idx(r+1, c)), bend: false });
      }
      if (c + 2 < COLS && particles[idx(r, c+2)].active)
        cs.push({ i, j: idx(r, c+2), rest: rl(i, idx(r, c+2)), bend: true });
      if (r + 2 < ROWS && particles[idx(r+2, c)].active)
        cs.push({ i, j: idx(r+2, c), rest: rl(i, idx(r+2, c)), bend: true });
    }
  }
  return cs;
}

// ── PBD step ───────────────────────────────────────────────────────────────
function stepCloth(particles, constraints, dt, stiffness, windAccelZ = 0) {
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
      p.pos.y += vy + GRAVITY * subDt2;       // GRAVITY = 0 for now
      p.pos.z += vz + windAccelZ * subDt2;
    }
    for (let iter = 0; iter < iters; iter++) {
      for (const c of constraints) {
        const pa = particles[c.i], pb = particles[c.j];
        const k  = c.bend ? bendK : stiffness;
        const dx = pb.pos.x - pa.pos.x, dy = pb.pos.y - pa.pos.y, dz = pb.pos.z - pa.pos.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dist < 1e-6) continue;
        const diff = (dist - c.rest) / dist * k * 0.5;
        if (!pa.pinned) { pa.pos.x += dx*diff; pa.pos.y += dy*diff; pa.pos.z += dz*diff; }
        if (!pb.pinned) { pb.pos.x -= dx*diff; pb.pos.y -= dy*diff; pb.pos.z -= dz*diff; }
      }
    }
  }

  const rigidity = stiffness * stiffness * stiffness;
  if (rigidity < 0.001) return;
  for (const p of particles) {
    if (p.pinned || !p.active) continue;
    const rx = p.rest.x - p.pos.x, ry = p.rest.y - p.pos.y, rz = p.rest.z - p.pos.z;
    p.pos.x += rx * rigidity; p.pos.y += ry * rigidity; p.pos.z += rz * rigidity;
    p.prev.x = p.pos.x - (p.pos.x - p.prev.x) * (1 - rigidity);
    p.prev.y = p.pos.y - (p.pos.y - p.prev.y) * (1 - rigidity);
    p.prev.z = p.pos.z - (p.pos.z - p.prev.z) * (1 - rigidity);
  }
}

// ── Build geometry (full rect — shader handles the cutout) ─────────────────
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
    uvArr[i*2+1]  = 1 - r / (ROWS - 1);  // 1 at top, 0 at bottom
  }
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const a = r*COLS+c, b = a+1, d = a+COLS, e = d+1;
      idxArr.push(a, d, b,  b, d, e);
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

// ── GLSL petal boundary (same maths as JS, runs per-pixel) ─────────────────
// Pre-bake the constants from JS so GLSL never has to call cos/sin at runtime.
const PETAL_GLSL = /* glsl */`
float petalHW(float vp) {
  float y     = 3.0 - 4.0 * vp;
  float SCALE = ${_SCALE.toFixed(6)};
  float c11   = ${_c11.toFixed(7)};
  float c12   = ${_c12.toFixed(7)};
  float P     = ${_P.toFixed(1)};
  float R1    = ${_R1.toFixed(1)};
  float a     = ${_a.toFixed(8)};
  float b     = ${_b.toFixed(8)};
  float A     = ${_A.toFixed(8)};

  if (y < -1.0) return 0.0;

  if (y <= 0.0) {
    // Bottom half-ellipse: x²/4 + y² = 1
    return 2.0 * sqrt(max(0.0, 1.0 - y * y)) * SCALE;
  }

  // Right upper arc — solve rotated ellipse quadratic for x
  float dy   = y - c12;
  float B    = 2.0 * dy * a * b * (1.0 - 1.0/P);
  float C    = dy*dy * (b*b/P + a*a) - R1;
  float disc = B*B - 4.0*A*C;
  if (disc < 0.0) return 0.0;

  float xRight = (-B + sqrt(disc)) / (2.0*A) + c11;
  return max(0.0, xRight * SCALE);
}
`;

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

  const geo = buildClothGeo(particles);

  const mat = new THREE.MeshStandardMaterial({
    color:             0xdd1111,
    emissive:          0x550000,
    emissiveIntensity: 0.30,
    roughness:         0.55,
    metalness:         0.02,
    side:        THREE.DoubleSide,
    transparent: true,
  });

  // Force UV varying to be compiled even without a texture map
  mat.defines = mat.defines || {};
  mat.defines['USE_UV'] = '';

  mat.onBeforeCompile = (shader) => {
    // Inject the petal boundary function after #include <common>
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\n' + PETAL_GLSL
    );
    // Per-pixel smooth clip before the alpha test
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      `{
        float vp   = 1.0 - vUv.y;              // 0 = top, 1 = bottom
        float hw   = petalHW(vp);
        float dist = abs(vUv.x - 0.5) - hw;    // negative = inside
        float a    = smoothstep(0.006, -0.003, dist);
        if (a < 0.001) discard;
        diffuseColor.a *= a;
      }
      #include <alphatest_fragment>`
    );
  };

  scene.add(new THREE.Mesh(geo, mat));

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

    const windAccelZ = windOn ? Math.sin(windTime * 0.8) * 3.5 : 0;
    stepCloth(particles, constraints, dt, stiffness, windAccelZ);
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
