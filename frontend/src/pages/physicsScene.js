import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';

let _raf = null, _renderer = null, _panel = null;

// ── Scene constants ─────────────────────────────────────────────────────────
const TABLE_R     = 1.5;
const TABLE_H     = 0.14;
const TABLE_TOP   = TABLE_H / 2;
const BALL_R_INIT = 1.0;
const N_STRAWS    = 6;
const SPRING_K    = 22;
const SPRING_DAMP = 3.8;
const MAX_TILT    = Math.PI * 0.44;

// ── Shape definitions ────────────────────────────────────────────────────────
// Each shape object carries:
//   collisionRadius  – capsule sphere radius used in the physics constraint
//   axisLength       – capsule axis extent used in the constraint clamp
//   yRotFor(angle)   – pivot Y-rotation for a straw placed at table angle `angle`
//   createMesh()     – returns a THREE.Mesh to attach to the pivot group

function makeCylinderShape() {
  const geo = new THREE.CylinderGeometry(0.10, 0.12, 1.6, 16);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x88ccff, roughness: 0.30, metalness: 0.45,
    emissive: 0x002244, emissiveIntensity: 0.7,
  });
  return {
    collisionRadius: 0.12,
    axisLength: 1.6,
    yRotFor: () => 0,
    createMesh() {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 0.8;
      return mesh;
    },
  };
}

function makeOvalShape() {
  const geo = new THREE.SphereGeometry(1, 28, 20);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x77eeff, roughness: 0.22, metalness: 0.30,
    emissive: 0x003355, emissiveIntensity: 1.0,
  });
  const W = 0.35, H = 0.80, D = 0.20;
  return {
    collisionRadius: D,         // depth toward ball centre is the binding dimension
    axisLength: 1.6,
    yRotFor: (angle) => Math.PI / 2 - angle,
    createMesh() {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.set(W, H, D);
      mesh.position.y = H;
      return mesh;
    },
  };
}

// ── Active shape ─────────────────────────────────────────────────────────────
// Swap makeCylinderShape() ↔ makeOvalShape() to change all objects at once.
const ACTIVE_SHAPE = makeCylinderShape();
// const ACTIVE_SHAPE = makeOvalShape();

// ── Straw axis direction ─────────────────────────────────────────────────────
// Pivot Euler order XYZ → combined matrix = Rz(tZ)·Ry(yR)·Rx(tX)
// axis = matrix · (0,1,0)
function strawAxis(tX, tZ, yR) {
  const sx = Math.sin(tX), cx = Math.cos(tX);
  const sz = Math.sin(tZ), cz = Math.cos(tZ);
  const sy = Math.sin(yR), cy = Math.cos(yR);
  return new THREE.Vector3(
    sx * sy * cz - cx * sz,
    sx * sy * sz + cx * cz,
    sx * cy,
  );
}

function strawAxisJac(tX, tZ, yR) {
  const sx = Math.sin(tX), cx = Math.cos(tX);
  const sz = Math.sin(tZ), cz = Math.cos(tZ);
  const sy = Math.sin(yR), cy = Math.cos(yR);
  return {
    dX: new THREE.Vector3( cx*sy*cz + sx*sz,  cx*sy*sz - sx*cz, cx*cy),
    dZ: new THREE.Vector3(-sx*sy*sz - cx*cz,  sx*sy*cz - cx*sz,     0),
  };
}

// ── Non-penetration constraint ───────────────────────────────────────────────
// Pushes straw tiltX/tiltZ so closest capsule point is >= md from ball centre.
// axisLen comes from the active shape so it matches the mesh geometry exactly.
function enforceConstraint(s, bc, md, axisLen) {
  const base = new THREE.Vector3(s.bx, TABLE_TOP, s.bz);
  const dir  = strawAxis(s.tiltX, s.tiltZ, s.yRot);

  const toBC = bc.clone().sub(base);
  const t    = Math.max(0.0, Math.min(axisLen, toBC.dot(dir)));
  const cp   = base.clone().addScaledVector(dir, t);

  const diff = cp.clone().sub(bc);
  const dist = diff.length();
  if (dist >= md || dist < 1e-8) return;

  const pen = md - dist;
  const n   = diff.clone().divideScalar(dist);
  const { dX, dZ } = strawAxisJac(s.tiltX, s.tiltZ, s.yRot);

  let jX, jZ;
  if (t > 1e-4 && t < axisLen - 1e-4) {
    const dtX = toBC.dot(dX), dtZ = toBC.dot(dZ);
    jX = dX.clone().multiplyScalar(t).addScaledVector(dir, dtX);
    jZ = dZ.clone().multiplyScalar(t).addScaledVector(dir, dtZ);
  } else {
    jX = dX.clone().multiplyScalar(t);
    jZ = dZ.clone().multiplyScalar(t);
  }

  const cjX   = n.dot(jX), cjZ = n.dot(jZ);
  const denom = cjX * cjX + cjZ * cjZ;
  if (denom < 1e-8) return;

  s.tiltX += cjX * pen / denom;
  s.tiltZ += cjZ * pen / denom;

  const cv = cjX * s.velTiltX + cjZ * s.velTiltZ;
  if (cv < 0) {
    s.velTiltX -= cjX * cv / denom;
    s.velTiltZ -= cjZ * cv / denom;
  }
}

// ── Spawn straws from a shape definition ─────────────────────────────────────
function spawnStraws(shape, scene) {
  const arr = [];
  for (let i = 0; i < N_STRAWS; i++) {
    const angle = (i / N_STRAWS) * Math.PI * 2;
    const bx    = TABLE_R * Math.cos(angle);
    const bz    = TABLE_R * Math.sin(angle);
    const yRot  = shape.yRotFor(angle);

    const pivot = new THREE.Group();
    pivot.position.set(bx, TABLE_TOP, bz);
    pivot.rotation.y = yRot;

    const body = shape.createMesh();
    pivot.add(body);
    scene.add(pivot);

    arr.push({
      pivot, body, bx, bz, yRot,
      tiltX: 0, tiltZ: 0,
      velTiltX: 0, velTiltZ: 0,
      grabbed: false, grabHeight: 0.8,
    });
  }
  return arr;
}

// ── Panel ─────────────────────────────────────────────────────────────────────
function createPanel({ onReset, onBallRadius }) {
  const panel = document.createElement('div');
  panel.id = 'scene-panel';
  panel.innerHTML = `
    <div class="panel-title">⚡ Physics</div>
    <div class="panel-subtitle">Drag the straws · Grow the ball</div>
    <label class="param-row">
      <span class="param-label">Ball Size</span>
      <input type="range" id="ball-size-slider" min="100" max="300" value="100" step="1">
      <span class="param-val" id="ball-size-val">1.00</span>
    </label>
    <div class="panel-buttons">
      <button id="scene-reset-btn">↺ Reset</button>
    </div>
  `;
  document.body.appendChild(panel);

  const slider = panel.querySelector('#ball-size-slider');
  const valEl  = panel.querySelector('#ball-size-val');
  slider.addEventListener('input', () => {
    const r = Number(slider.value) / 100;
    valEl.textContent = r.toFixed(2);
    onBallRadius(r);
  });
  panel.querySelector('#scene-reset-btn').addEventListener('click', () => {
    slider.value = '100';
    valEl.textContent = '1.00';
    onBallRadius(1.0);
    onReset();
  });
  return panel;
}

// ── Mount ─────────────────────────────────────────────────────────────────────
export function mountScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010108);

  const w = container.clientWidth, h = container.clientHeight;
  const camera = new THREE.PerspectiveCamera(44, w / h, 0.1, 100);
  camera.position.set(0, 4.5, 7.5);

  _renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  _renderer.setSize(w, h);
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _renderer.toneMapping = THREE.ACESFilmicToneMapping;
  _renderer.toneMappingExposure = 1.05;
  container.appendChild(_renderer.domElement);

  const controls = new OrbitControls(camera, _renderer.domElement);
  controls.target.set(0, 0.9, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 2.5;
  controls.maxDistance = 18;
  controls.update();

  const composer = new EffectComposer(_renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, new BloomEffect({
    intensity: 1.6, luminanceThreshold: 0.18,
    luminanceSmoothing: 0.75, radius: 0.88,
  })));

  // ── Lights ──
  scene.add(new THREE.AmbientLight(0x18102a, 3.5));
  const key = new THREE.PointLight(0xfff0ee, 8, 22);
  key.position.set(3, 7, 5);
  scene.add(key);
  const fill = new THREE.PointLight(0x2255ff, 2.8, 16);
  fill.position.set(-4, 2, -3);
  scene.add(fill);
  const under = new THREE.PointLight(0xff44aa, 1.2, 6);
  under.position.set(0, -1.5, 0);
  scene.add(under);

  // ── Table ──
  scene.add(new THREE.Mesh(
    new THREE.CylinderGeometry(TABLE_R, TABLE_R, TABLE_H, 80),
    new THREE.MeshStandardMaterial({
      color: 0x5533bb, roughness: 0.22, metalness: 0.82,
      emissive: 0x220055, emissiveIntensity: 0.55,
    }),
  ));
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(TABLE_R, 0.022, 12, 100),
    new THREE.MeshStandardMaterial({
      color: 0xbb66ff, emissive: 0xbb66ff, emissiveIntensity: 2.2,
      roughness: 0.2, metalness: 0.4,
    }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = TABLE_TOP;
  scene.add(rim);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(TABLE_R - 0.02, 80),
    new THREE.MeshStandardMaterial({
      color: 0x3a2288, roughness: 0.35, metalness: 0.5,
      emissive: 0x150033, emissiveIntensity: 0.4,
    }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = TABLE_TOP + 0.001;
  scene.add(disc);

  // ── Ball (static) ──
  const ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R_INIT, 48, 48),
    new THREE.MeshStandardMaterial({
      color: 0xff2244, roughness: 0.12, metalness: 0.55,
      emissive: 0x660011, emissiveIntensity: 0.45,
    }),
  );
  scene.add(ballMesh);

  // ── Mutable ball state ──
  let ballR = BALL_R_INIT;
  const ballC = new THREE.Vector3(0, TABLE_TOP + ballR, 0);
  let   minD  = ballR + ACTIVE_SHAPE.collisionRadius;
  ballMesh.position.copy(ballC);

  // ── Spawn straws ──
  const straws = spawnStraws(ACTIVE_SHAPE, scene);
  const axisLen = ACTIVE_SHAPE.axisLength;

  // Solve constraint to full convergence for all straws
  function solveAll() {
    for (const s of straws) {
      for (let iter = 0; iter < 8; iter++) enforceConstraint(s, ballC, minD, axisLen);
      s.pivot.rotation.x = s.tiltX;
      s.pivot.rotation.z = s.tiltZ;
    }
  }

  function applyBallRadius(r) {
    ballR = r;
    ballC.y = TABLE_TOP + r;
    minD = r + ACTIVE_SHAPE.collisionRadius;
    ballMesh.position.y = TABLE_TOP + r;
    ballMesh.scale.setScalar(r / BALL_R_INIT);
    solveAll();
  }

  function resetAll() {
    for (const s of straws) {
      s.tiltX = 0; s.tiltZ = 0; s.velTiltX = 0; s.velTiltZ = 0;
      s.grabbed = false;
      s.pivot.rotation.x = 0;
      s.pivot.rotation.z = 0;
    }
  }

  // ── Mouse: drag straws ────────────────────────────────────────────────────
  let activeStraw  = null;
  const raycaster  = new THREE.Raycaster();
  const mNDC       = new THREE.Vector2();
  const dragPt     = new THREE.Vector3();
  let lastMoveTime = 0, prevTiltX = 0, prevTiltZ = 0;

  function ndcOf(e) {
    const r = _renderer.domElement.getBoundingClientRect();
    mNDC.set(
      ((e.clientX - r.left) / r.width)  *  2 - 1,
      -((e.clientY - r.top)  / r.height) *  2 + 1,
    );
    return mNDC;
  }

  function onDown(e) {
    if (e.button !== 0) return;
    raycaster.setFromCamera(ndcOf(e), camera);
    const hits = raycaster.intersectObjects(straws.map(s => s.body));
    if (!hits.length) return;
    const hit = hits[0];
    const s   = straws.find(st => st.body === hit.object);
    if (!s) return;
    activeStraw  = s;
    s.grabbed    = true;
    s.velTiltX   = 0;
    s.velTiltZ   = 0;
    s.grabHeight = Math.max(0.25, hit.point.y - TABLE_TOP);
    prevTiltX    = s.tiltX;
    prevTiltZ    = s.tiltZ;
    lastMoveTime = performance.now();
    controls.enabled = false;
    _renderer.domElement.style.cursor = 'grabbing';
  }

  function onMove(e) {
    ndcOf(e);
    if (!activeStraw) {
      raycaster.setFromCamera(mNDC, camera);
      _renderer.domElement.style.cursor =
        raycaster.intersectObjects(straws.map(s => s.body)).length ? 'grab' : '';
      return;
    }
    const s = activeStraw;
    raycaster.setFromCamera(mNDC, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(TABLE_TOP + s.grabHeight));
    if (!raycaster.ray.intersectPlane(plane, dragPt)) return;

    prevTiltX = s.tiltX;
    prevTiltZ = s.tiltZ;
    s.tiltX = Math.max(-MAX_TILT, Math.min(MAX_TILT,  (dragPt.z - s.bz) / s.grabHeight));
    s.tiltZ = Math.max(-MAX_TILT, Math.min(MAX_TILT, -(dragPt.x - s.bx) / s.grabHeight));

    for (let iter = 0; iter < 5; iter++) enforceConstraint(s, ballC, minD, axisLen);
    s.pivot.rotation.x = s.tiltX;
    s.pivot.rotation.z = s.tiltZ;

    const now = performance.now();
    const dt  = Math.max(1, now - lastMoveTime);
    s.velTiltX = (s.tiltX - prevTiltX) / (dt * 0.001);
    s.velTiltZ = (s.tiltZ - prevTiltZ) / (dt * 0.001);
    lastMoveTime = now;
  }

  function onUp() {
    if (!activeStraw) return;
    activeStraw.grabbed = false;
    activeStraw = null;
    controls.enabled = true;
    _renderer.domElement.style.cursor = '';
  }

  _renderer.domElement.addEventListener('mousedown', onDown);
  _renderer.domElement.addEventListener('mousemove', onMove);
  _renderer.domElement.addEventListener('mouseup',   onUp);

  // ── Physics step ──────────────────────────────────────────────────────────
  function stepPhysics(dt) {
    for (const s of straws) {
      if (s.grabbed) continue;
      s.velTiltX += (-SPRING_K * s.tiltX - SPRING_DAMP * s.velTiltX) * dt;
      s.velTiltZ += (-SPRING_K * s.tiltZ - SPRING_DAMP * s.velTiltZ) * dt;
      s.tiltX += s.velTiltX * dt;
      s.tiltZ += s.velTiltZ * dt;
      s.tiltX = Math.max(-MAX_TILT, Math.min(MAX_TILT, s.tiltX));
      s.tiltZ = Math.max(-MAX_TILT, Math.min(MAX_TILT, s.tiltZ));
      for (let iter = 0; iter < 5; iter++) enforceConstraint(s, ballC, minD, axisLen);
      s.pivot.rotation.x = s.tiltX;
      s.pivot.rotation.z = s.tiltZ;
    }
  }

  // ── Panel ──
  _panel = createPanel({ onReset: resetAll, onBallRadius: applyBallRadius });

  // ── Resize ──
  const onResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    _renderer.setSize(container.clientWidth, container.clientHeight);
    composer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', onResize);
  _renderer._cleanup = () => {
    window.removeEventListener('resize', onResize);
    _renderer.domElement.removeEventListener('mousedown', onDown);
    _renderer.domElement.removeEventListener('mousemove', onMove);
    _renderer.domElement.removeEventListener('mouseup',   onUp);
  };

  // ── Animate ──
  const clock = new THREE.Clock();
  function animate() {
    _raf = requestAnimationFrame(animate);
    stepPhysics(Math.min(clock.getDelta(), 0.033));
    controls.update();
    composer.render();
  }
  animate();
}

// ── Unmount ────────────────────────────────────────────────────────────────
export function unmountScene(container) {
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  if (_panel) { _panel.remove(); _panel = null; }
  if (_renderer) {
    _renderer._cleanup?.();
    _renderer.dispose();
    if (_renderer.domElement.parentNode === container) container.removeChild(_renderer.domElement);
    _renderer = null;
  }
}
