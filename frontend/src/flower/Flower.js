import * as THREE from 'three';
import { buildRevolutionGeometry, profileRadius, RoseSurface } from './RoseSurface.js';

const API_URL = 'http://localhost:8000/api/flower';

export class Flower {
  constructor() {
    this.group = new THREE.Group();
    this._surfaces = [];
    this._buildStem();
  }

  async init() {
    const res  = await fetch(API_URL);
    const data = await res.json();
    const { profiles, surfaces, scale, flowerY } = data;

    for (const s of surfaces) {
      const profile = profiles[s.profileId];
      const geo     = buildRevolutionGeometry(profile, s.uMax, scale, flowerY);
      const surface = new RoseSurface(geo, s.clip, s.color, s.glowColor, scale, flowerY);
      this.group.add(surface.mesh);
      this._surfaces.push(surface);
    }

    return this;
  }

  _buildStem() {
    // Simple green cylinder stem
    const geo = new THREE.CylinderGeometry(0.035, 0.07, 2.0, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a4a1a, roughness: 0.85 });
    const stem = new THREE.Mesh(geo, mat);
    stem.position.y = 0;
    this.group.add(stem);
  }

  update(t) {
    this.group.rotation.y = Math.sin(t * 0.20) * 0.04;
    for (const s of this._surfaces) s.update(t);
  }
}
