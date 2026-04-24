import * as THREE from 'three';

function makeCircleTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0,   'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class Particles {
  constructor(count) {
    this._count = count;
    const positions = new Float32Array(count * 3);
    this._speeds  = new Float32Array(count);
    this._offsets = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const r = 0.3 + Math.random() * 2.5;
      const theta = Math.random() * Math.PI * 2;
      positions[i * 3]     = Math.cos(theta) * r;
      positions[i * 3 + 1] = Math.random() * 4.5;
      positions[i * 3 + 2] = Math.sin(theta) * r;
      this._speeds[i]  = 0.08 + Math.random() * 0.18;
      this._offsets[i] = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._positions = positions;

    const mat = new THREE.PointsMaterial({
      color: 0xff4444,
      size: 0.055,
      map: makeCircleTexture(),
      transparent: true,
      opacity: 0.7,
      alphaTest: 0.01,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geo, mat);
  }

  update(t) {
    const pos = this._positions;
    for (let i = 0; i < this._count; i++) {
      pos[i * 3 + 1] += this._speeds[i] * 0.008;
      pos[i * 3]     += Math.sin(t * 0.4 + this._offsets[i]) * 0.0008;
      pos[i * 3 + 2] += Math.cos(t * 0.4 + this._offsets[i]) * 0.0008;
      if (pos[i * 3 + 1] > 5.0) pos[i * 3 + 1] = 0;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
