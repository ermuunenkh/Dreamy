import * as THREE from 'three';
import { PetalMesh } from './Petal.js';

// Golden angle ≈ 137.508°
const PHI          = (1.0 + Math.sqrt(5.0)) / 2.0;
const GOLDEN_ANGLE = 2.0 * Math.PI * (1.0 - 1.0 / PHI);

function placePetal(group, petals, idx, cfg) {
  const { scale, vScale, tiltZ, propellerY = 0, baseY, radialX, color, glow } = cfg;
  const petal = new PetalMesh(scale, color, glow, vScale);
  petals.push(petal);

  petal.mesh.rotation.z = tiltZ;          // lean inward/outward
  petal.mesh.rotation.y = propellerY;     // ← twist off-radial → spiral look
  petal.mesh.position.x = radialX;

  const pivot = new THREE.Group();
  pivot.add(petal.mesh);
  pivot.rotation.y = GOLDEN_ANGLE * idx;  // golden-angle spin
  pivot.position.y = baseY;
  group.add(pivot);
}

export class Rose {
  constructor() {
    this.group   = new THREE.Group();
    this._petals = [];

    let idx = 0;
    idx = this._whorl(idx);        // 14 petals — tight twirling centre
    idx = this._innerCup(idx);     // 14 petals — cupped inner ring
    idx = this._midRing(idx);      // 12 petals — opening mid ring
    idx = this._guardPetals(idx);  //  8 petals — large outer guard
    this._buildStem();
  }

  // ── Layer 1 · Whorl (14 petals) ───────────────────────────────────────────
  // propellerY rotates each petal off-radial like a pinwheel blade.
  // Combined with the golden angle and upright stance this creates the
  // tight inward-coiling spiral seen at the heart of a real rose.
  _whorl(startIdx) {
    const N = 14;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      placePetal(this.group, this._petals, startIdx + i, {
        scale:      0.09 + t * 0.05,       // 0.09 → 0.14
        vScale:     0.55 + t * 0.20,       // 0.55 → 0.75  — wide enough to close gaps
        tiltZ:      0.08 - t * 0.16,       // +0.08 → –0.08  (inward-tip → upright)
        propellerY: 0.40 - t * 0.10,       // 0.40 → 0.30 rad off-radial twist
        baseY:      1.06 - t * 0.10,       // 1.06 → 0.96
        radialX:    0.002 + t * 0.010,
        color:      [0.66 + t*0.08, 0.07 + t*0.04, 0.13 + t*0.05],
        glow:       [1.0, 0.44, 0.24],
      });
    }
    return startIdx + N;
  }

  // ── Layer 2 · Inner cup (14 petals) ───────────────────────────────────────
  // Still slightly off-radial to extend the spiral feel outward.
  _innerCup(startIdx) {
    const N = 14;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      placePetal(this.group, this._petals, startIdx + i, {
        scale:      0.14 + t * 0.09,       // 0.14 → 0.23
        vScale:     0.72 + t * 0.20,       // 0.72 → 0.92
        tiltZ:      -(0.10 + t * 0.18),    // –0.10 → –0.28
        propellerY: 0.22 - t * 0.12,       // 0.22 → 0.10  (fading twist)
        baseY:      0.94 - t * 0.11,       // 0.94 → 0.83
        radialX:    0.008 + t * 0.020,
        color:      [0.74 + t*0.08, 0.10 + t*0.05, 0.19 + t*0.05],
        glow:       [1.0, 0.50, 0.27],
      });
    }
    return startIdx + N;
  }

  // ── Layer 3 · Mid ring (12 petals) ────────────────────────────────────────
  // No propeller twist — petals face radially outward, full opening begins.
  _midRing(startIdx) {
    const N = 12;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      placePetal(this.group, this._petals, startIdx + i, {
        scale:      0.23 + t * 0.10,       // 0.23 → 0.33
        vScale:     0.90 + t * 0.18,       // 0.90 → 1.08
        tiltZ:      -(0.30 + t * 0.18),    // –0.30 → –0.48
        propellerY: 0,
        baseY:      0.81 - t * 0.13,       // 0.81 → 0.68
        radialX:    0.018 + t * 0.024,
        color:      [0.82 + t*0.07, 0.14 + t*0.07, 0.24 + t*0.05],
        glow:       [1.0, 0.54, 0.29],
      });
    }
    return startIdx + N;
  }

  // ── Layer 4 · Guard petals (8 petals) ─────────────────────────────────────
  // Large, nearly flat — the classic wide open outer petals.
  _guardPetals(startIdx) {
    const N = 8;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      placePetal(this.group, this._petals, startIdx + i, {
        scale:      0.31 + t * 0.12,       // 0.31 → 0.43
        vScale:     1.00 + t * 0.18,       // 1.00 → 1.18
        tiltZ:      -(0.50 + t * 0.18),    // –0.50 → –0.68 rad (quite flat)
        propellerY: 0,
        baseY:      0.66 - t * 0.14,       // 0.66 → 0.52
        radialX:    0.030 + t * 0.028,
        color:      [0.88 + t*0.06, 0.18 + t*0.10, 0.27 + t*0.06],
        glow:       [1.0, 0.58 + t*0.10, 0.30],
      });
    }
    return startIdx + N;
  }

  _buildStem() {
    const geo  = new THREE.CylinderGeometry(0.022, 0.052, 1.1, 8);
    const mat  = new THREE.MeshStandardMaterial({ color: 0x1a4a1a, roughness: 0.85 });
    const stem = new THREE.Mesh(geo, mat);
    stem.position.y = 0.03;
    this.group.add(stem);
  }

  update(t) {
    this.group.rotation.y = Math.sin(t * 0.22) * 0.05;
    for (const p of this._petals) p.update(t);
  }
}
