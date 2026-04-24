import * as THREE from 'three';

// ── Domain constants (mirrored in GLSL) ───────────────────────────────────
const U1 = 0.1;
const U2 = 2.6 / 3.0;   // ≈ 0.8667
const A0 = 0.5;
const A1 = 1.1;
const P  = 0.1;
const H  = 0.13;

// ── Desmos profile functions ───────────────────────────────────────────────
function B0(u) { return 1.6 * Math.pow(u, 0.55) * Math.exp(-Math.pow(u / 0.3, 2)); }
function B1(u) { return 0.58 * Math.pow(Math.max(0, Math.sin(Math.PI * u)), 1.35); }
function Nf(u) { return 1.1 * u; }
function F0(u) { return Math.exp(-Math.pow((u - 1.0) / 0.16, 2)); }
function R(u)  { return B0(u) + B1(u) + Nf(u) + F0(u); }

// ── Domain boundary helpers ────────────────────────────────────────────────
function W(u) { return A0 + (A1 - A0) * Math.pow(Math.max(0, (u - U1) / (U2 - U1)), P); }
function T(v) { return U2 - H * Math.pow(v / A1, 2); }

// ── Build parametric mesh ─────────────────────────────────────────────────
export function buildPetalGeometry(scale = 0.4, uSegs = 100, vSegs = 100) {
  const positions   = [];
  const petalCoords = []; // raw (u, v) for boundary math in fragment shader
  const uvs         = [];
  const indices     = [];

  for (let j = 0; j <= vSegs; j++) {
    const vt = j / vSegs;
    const v  = -A1 + vt * 2.0 * A1;  // v ∈ [-A1, +A1]

    for (let i = 0; i <= uSegs; i++) {
      const ut = i / uSegs;
      const u  = U1 + ut * (U2 - U1); // u ∈ [U1, U2]

      const r = R(u);
      // Desmos → Three.js: X = R·cos(v), Y = 3u (height), Z = R·sin(v)
      positions.push(r * Math.cos(v) * scale, 3.0 * u * scale, r * Math.sin(v) * scale);
      petalCoords.push(u, v);
      uvs.push(ut, vt);
    }
  }

  for (let j = 0; j < vSegs; j++) {
    for (let i = 0; i < uSegs; i++) {
      const a = j * (uSegs + 1) + i;
      const b = a + 1, c = a + uSegs + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',    new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aPetalCoord', new THREE.Float32BufferAttribute(petalCoords, 2));
  geo.setAttribute('uv',          new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ── Vertex shader ──────────────────────────────────────────────────────────
const vertexShader = /* glsl */`
  attribute vec2 aPetalCoord;
  varying   vec2 vPC;
  varying   vec3 vNormal;
  varying   vec3 vViewPos;

  void main() {
    vPC       = aPetalCoord;
    vNormal   = normalize(normalMatrix * normal);
    vec4 mv   = modelViewMatrix * vec4(position, 1.0);
    vViewPos  = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

// ── Fragment shader ────────────────────────────────────────────────────────
const fragmentShader = /* glsl */`
  varying vec2 vPC;
  varying vec3 vNormal;
  varying vec3 vViewPos;

  uniform vec3  uColor;
  uniform vec3  uGlowColor;
  uniform float uTime;

  // Domain constants
  const float U1    = 0.1;
  const float U2    = 2.6 / 3.0;
  const float A0    = 0.5;
  const float A1    = 1.1;
  const float PPOW  = 0.1;
  const float HVAL  = 0.13;

  // Angular half-width at height u
  float W(float u) {
    float qu = clamp((u - U1) / (U2 - U1), 0.0, 1.0);
    return A0 + (A1 - A0) * pow(max(1e-5, qu), PPOW);
  }

  // Upper u-bound at angle v (parabolic top edge)
  float T(float v) {
    return U2 - HVAL * pow(v / A1, 2.0);
  }

  void main() {
    float u = vPC.x;
    float v = vPC.y;

    float Wu = W(u);
    float Tv = T(v);

    // ── Soft boundary masks ────────────────────────────────────────────
    // Angular edges: fade 0.11 rad wide on each side
    float angAlpha = smoothstep(0.0, 0.11, Wu - abs(v));

    // Top parabolic edge: rounds the tip
    float topAlpha = smoothstep(0.0, 0.07, Tv - u);

    // Base taper: fade over the bottom 22% of the u-range uniformly in v.
    // Because this is a function of u only (not v), the fade is perfectly
    // even across the full width — no V-dip or notch at the centre.
    float uNorm   = (u - U1) / (U2 - U1);   // 0 at base → 1 at tip
    float botAlpha = smoothstep(0.0, 0.22, uNorm);

    float alpha = angAlpha * topAlpha * botAlpha;
    if (alpha < 0.004) discard;

    vec3  normal  = normalize(vNormal);
    vec3  viewDir = normalize(vViewPos);

    // Warm key light from upper-front
    float diff    = max(dot(normal, normalize(vec3(0.7, 2.0, 1.0))), 0.0);
    // Cool back-rim
    float backRim = max(dot(normal, normalize(vec3(-0.5, 0.3, -1.0))), 0.0) * 0.25;
    // Fresnel edge glow
    float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 2.5);

    // Darker at base, brighter near tip
    float heightFade = smoothstep(U1, U2, u) * 0.35 + 0.65;

    vec3 color = uColor * (0.15 + 0.75 * diff + backRim) * heightFade;
    color += fresnel * uGlowColor * 1.0;
    // Soft edge tint: boundary pixels blend toward the glow color
    color = mix(uGlowColor * 0.5, color, alpha);
    // Gentle pulse
    color *= 1.0 + sin(uTime * 0.55) * 0.04;

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), alpha);
  }
`;

// ── PetalMesh ──────────────────────────────────────────────────────────────
export class PetalMesh {
  constructor(scale = 0.4, color = [0.88, 0.20, 0.28], glowColor = [1.00, 0.60, 0.35]) {
    const geo = buildPetalGeometry(scale, 70, 70);
    this._mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor:     { value: new THREE.Color(...color) },
        uGlowColor: { value: new THREE.Color(...glowColor) },
        uTime:      { value: 0 },
      },
      side:        THREE.DoubleSide,
      transparent: true,
      depthWrite:  true,
    });
    this.mesh = new THREE.Mesh(geo, this._mat);
  }

  update(t) { this._mat.uniforms.uTime.value = t; }
}
