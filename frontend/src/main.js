import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';
import { Rose } from './flower/Rose.js';
import { Particles } from './flower/Particles.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x010108);
scene.fog = new THREE.FogExp2(0x010108, 0.055);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
// Positioned above-front to see the rose from a 3/4 angle
camera.position.set(0, 1.9, 2.6);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.getElementById('app').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.85, 0);  // centre of the rose cluster
controls.enableDamping  = true;
controls.dampingFactor  = 0.05;
controls.minDistance    = 0.8;
controls.maxDistance    = 7;
controls.maxPolarAngle  = Math.PI * 0.85;
controls.update();

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new EffectPass(camera, new BloomEffect({
  intensity: 2.0,
  luminanceThreshold: 0.14,
  luminanceSmoothing: 0.80,
  radius: 0.90,
})));

// Dark moody ambient
scene.add(new THREE.AmbientLight(0x1a0508, 1.5));

// Warm key light — upper-front, main illumination
const keyLight = new THREE.PointLight(0xff7755, 5.0, 10);
keyLight.position.set(0.8, 3.0, 2.0);
scene.add(keyLight);

// Cool blue-purple rim from behind — depth separation
const rimLight = new THREE.PointLight(0x2233cc, 1.8, 8);
rimLight.position.set(-1.5, 1.5, -2.5);
scene.add(rimLight);

// Soft pink underfill — simulates light bouncing off a surface
const fillLight = new THREE.PointLight(0xff3333, 0.8, 6);
fillLight.position.set(0.2, 0.0, 1.5);
scene.add(fillLight);

const rose = new Rose();
scene.add(rose.group);

const particles = new Particles(400);
scene.add(particles.points);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  controls.update();
  rose.update(t);
  particles.update(t);
  composer.render();
}
animate();
