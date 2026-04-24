import * as THREE from 'three';

// ── Profile radius function ──────────────────────────────────────────────────
export function profileRadius(u, p) {
  const logArg = -(u + (p.logShift || 0)) + 20;
  if (logArg <= 0) return 0;
  const r = p.amp * Math.sin(p.freq * u + p.phaseAdj + 6 * Math.PI)
          - 6.2
          + (-p.logAmp * Math.log10(logArg) + 1)
          + p.offset;
  return Math.max(0, r);
}

// ── Revolution surface geometry ──────────────────────────────────────────────
export function buildRevolutionGeometry(profile, uMax, scale, flowerY, uSegs = 64, vSegs = 80) {
  const positions = [], uvs = [], indices = [];

  for (let j = 0; j <= vSegs; j++) {
    const vt = j / vSegs;
    const theta = vt * Math.PI * 2;
    const cosT = Math.cos(theta), sinT = Math.sin(theta);

    for (let i = 0; i <= uSegs; i++) {
      const ut = i / uSegs;
      const u  = ut * uMax;
      const r  = profileRadius(u, profile) * scale;
      positions.push(r * cosT, u * scale + flowerY, r * sinT);
      uvs.push(ut, vt);
    }
  }

  for (let j = 0; j < vSegs; j++) {
    for (let i = 0; i < uSegs; i++) {
      const a = j * (uSegs + 1) + i, b = a + 1, c = a + uSegs + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ── Shaders ───────────────────────────────────────────────────────────────────
const vertexShader = /* glsl */`
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vViewPos;

  void main() {
    vec4 wpos = modelMatrix * vec4(position, 1.0);
    vWorldPos = wpos.xyz;
    vNormal   = normalize(normalMatrix * normal);
    vec4 mvpos = modelViewMatrix * vec4(position, 1.0);
    vViewPos  = -mvpos.xyz;
    gl_Position = projectionMatrix * mvpos;
  }
`;

const fragmentShader = /* glsl */`
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vViewPos;

  uniform vec3  uColor;
  uniform vec3  uGlowColor;
  uniform float uTime;
  uniform float uScale;
  uniform float uFlowerY;

  uniform float uClipType;
  uniform float uClipNx;
  uniform float uClipNy;
  uniform float uClipGT;
  uniform float uEllipseA2;
  uniform float uEllipseB2;
  uniform float uEllipseCZ;

  void main() {
    float dx = vWorldPos.x / uScale;
    float dy = vWorldPos.z / uScale;
    float dz = (vWorldPos.y - uFlowerY) / uScale;

    // Half-plane clip
    if (uClipType > 0.5 && uClipType < 1.5) {
      float val = uClipNx * dx + uClipNy * dy;
      if (uClipGT > 0.5) { if (val <= 0.0) discard; }
      else               { if (val >= 0.0) discard; }
    }
    // Ellipse on X
    if (uClipType > 1.5 && uClipType < 2.5) {
      if (dx*dx/uEllipseA2 + (dz-uEllipseCZ)*(dz-uEllipseCZ)/uEllipseB2 >= 1.0) discard;
    }
    // Ellipse on Y
    if (uClipType > 2.5 && uClipType < 3.5) {
      if (dy*dy/uEllipseA2 + (dz-uEllipseCZ)*(dz-uEllipseCZ)/uEllipseB2 >= 1.0) discard;
    }
    // Ellipse on (X+Y)
    if (uClipType > 3.5 && uClipType < 4.5) {
      float s = dx + dy;
      if (s*s/uEllipseA2 + (dz-uEllipseCZ)*(dz-uEllipseCZ)/uEllipseB2 >= 1.0) discard;
    }
    // Ellipse on (X-Y)
    if (uClipType > 4.5 && uClipType < 5.5) {
      float s = dx - dy;
      if (s*s/uEllipseA2 + (dz-uEllipseCZ)*(dz-uEllipseCZ)/uEllipseB2 >= 1.0) discard;
    }

    vec3  normal  = normalize(vNormal);
    vec3  viewDir = normalize(vViewPos);

    // Key light from above-front (warm)
    vec3  keyDir  = normalize(vec3(0.5, 2.0, 1.0));
    float diff    = max(dot(normal, keyDir), 0.0);

    // Soft fill from front-below (cool)
    vec3  fillDir = normalize(vec3(0.0, -0.5, 1.0));
    float fill    = max(dot(normal, fillDir), 0.0) * 0.25;

    // Depth shadow: surfaces deeper inside the bud (low dz) are darker
    float depthShade = smoothstep(0.0, 3.5, dz);

    // Fresnel rim
    float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 2.5);

    float lit = 0.15 + 0.70 * diff * depthShade + fill;
    vec3 color = uColor * lit;
    color += fresnel * uGlowColor * 0.6;
    color *= 1.0 + sin(uTime * 0.5) * 0.03;

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

// ── RoseSurface ───────────────────────────────────────────────────────────────
export class RoseSurface {
  constructor(geometry, clip, colorRGB, glowRGB, scale, flowerY) {
    const c = clip;
    this._mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime:      { value: 0 },
        uColor:     { value: new THREE.Color(colorRGB[0]/255, colorRGB[1]/255, colorRGB[2]/255) },
        uGlowColor: { value: new THREE.Color(glowRGB[0]/255,  glowRGB[1]/255,  glowRGB[2]/255) },
        uScale:     { value: scale },
        uFlowerY:   { value: flowerY },
        uClipType:  { value: c.type  ?? 0 },
        uClipNx:    { value: c.nx    ?? 0 },
        uClipNy:    { value: c.ny    ?? 0 },
        uClipGT:    { value: c.gt    ?? 0 },
        uEllipseA2: { value: c.ea2   ?? 1 },
        uEllipseB2: { value: c.eb2   ?? 1 },
        uEllipseCZ: { value: c.cz    ?? 0 },
      },
      side:        THREE.DoubleSide,
      transparent: false,
      depthWrite:  true,
    });

    this.mesh = new THREE.Mesh(geometry, this._mat);
    this.mesh.castShadow    = true;
    this.mesh.receiveShadow = true;
  }

  update(t) { this._mat.uniforms.uTime.value = t; }
}
