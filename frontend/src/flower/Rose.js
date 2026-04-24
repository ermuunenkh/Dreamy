import * as THREE from 'three';
import { PetalMesh } from './Petal.js';

// ── Golden ratio / angle ───────────────────────────────────────────────────
// φ = (1+√5)/2  →  golden angle = 2π − 2π/φ  ≈ 137.508°
// Every petal in nature is rotated by this angle from the previous one,
// producing a spiral that never repeats and packs petals most efficiently.
const PHI          = (1.0 + Math.sqrt(5.0)) / 2.0;   // 1.6180…
const GOLDEN_ANGLE = 2.0 * Math.PI * (1.0 - 1.0 / PHI); // 2.3999… rad

export class Rose {
  constructor() {
    this.group   = new THREE.Group();
    this._petals = [];
    this._buildPetals();
    this._buildStem();
  }

  _buildPetals() {
    const N = 28; // total petals in the spiral

    for (let i = 0; i < N; i++) {
      const t = i / (N - 1); // 0 = innermost, 1 = outermost

      // ── Scale: inner tiny, outer full-size ──────────────────────────
      const scale = 0.12 + t * 0.24; // 0.12 → 0.36

      // ── Tilt outward (negative Z rotation opens the petal away from
      //    the centre axis): inner petals upright, outer ones spread ──
      const tiltZ = -(0.05 + t * 0.62); // –0.05 → –0.67 rad

      // ── Height of pivot: inner petals sit higher (bud core at top),
      //    outer ones lower (spreading skirt) ────────────────────────
      const baseY = 0.85 - t * 0.32; // 0.85 → 0.53

      // ── Small radial push so outer petals don't all crowd the axis ─
      const radialX = 0.02 + t * 0.09; // 0.02 → 0.11

      // ── Golden-angle azimuth: each petal 137.508° from the last ────
      const theta = GOLDEN_ANGLE * i;

      // ── Color: inner petals deep crimson, outer ones lighter rose ──
      const r = 0.82 + t * 0.12; // 0.82 → 0.94
      const g = 0.12 + t * 0.14; // 0.12 → 0.26
      const b = 0.22 + t * 0.10; // 0.22 → 0.32
      const glowR = 1.00, glowG = 0.55 + t * 0.10, glowB = 0.30;

      const petal = new PetalMesh(scale, [r, g, b], [glowR, glowG, glowB]);
      this._petals.push(petal);

      // Step 1 – tilt petal along its own Z axis (opens it outward)
      petal.mesh.rotation.z = tiltZ;
      // Step 2 – push it slightly away from the Y axis in its local +X
      petal.mesh.position.x = radialX;

      // Wrap in a pivot so the Y-rotation happens around the global axis
      const pivot = new THREE.Group();
      pivot.add(petal.mesh);
      pivot.rotation.y = theta;   // golden-angle spin
      pivot.position.y = baseY;   // height layer

      this.group.add(pivot);
    }
  }

  _buildStem() {
    const geo  = new THREE.CylinderGeometry(0.022, 0.052, 1.1, 8);
    const mat  = new THREE.MeshStandardMaterial({ color: 0x1a4a1a, roughness: 0.85 });
    const stem = new THREE.Mesh(geo, mat);
    stem.position.y = 0.03; // top of stem meets base of flower at y≈0.58
    this.group.add(stem);
  }

  update(t) {
    // Gentle sway of the whole rose
    this.group.rotation.y = Math.sin(t * 0.22) * 0.05;
    for (const p of this._petals) p.update(t);
  }
}
