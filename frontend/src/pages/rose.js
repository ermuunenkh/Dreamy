import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';
import { Rose } from '../flower/Rose.js';
import { Particles } from '../flower/Particles.js';

let _raf = null;
let _renderer = null;

export function mountRose(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010108);
  scene.fog = new THREE.FogExp2(0x010108, 0.055);

  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 1.9, 2.6);

  _renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  _renderer.setSize(container.clientWidth, container.clientHeight);
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _renderer.toneMapping = THREE.ACESFilmicToneMapping;
  _renderer.toneMappingExposure = 1.2;
  container.appendChild(_renderer.domElement);

  const controls = new OrbitControls(camera, _renderer.domElement);
  controls.target.set(0, 0.85, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 0.8;
  controls.maxDistance = 7;
  controls.maxPolarAngle = Math.PI * 0.85;
  controls.update();

  const composer = new EffectComposer(_renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, new BloomEffect({
    intensity: 2.0, luminanceThreshold: 0.14,
    luminanceSmoothing: 0.80, radius: 0.90,
  })));

  scene.add(new THREE.AmbientLight(0x1a0508, 1.5));
  const keyLight = new THREE.PointLight(0xff7755, 5.0, 10);
  keyLight.position.set(0.8, 3.0, 2.0);
  scene.add(keyLight);
  const rimLight = new THREE.PointLight(0x2233cc, 1.8, 8);
  rimLight.position.set(-1.5, 1.5, -2.5);
  scene.add(rimLight);
  const fillLight = new THREE.PointLight(0xff3333, 0.8, 6);
  fillLight.position.set(0.2, 0.0, 1.5);
  scene.add(fillLight);

  const rose = new Rose();
  scene.add(rose.group);
  const particles = new Particles(400);
  scene.add(particles.points);

  const onResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    _renderer.setSize(container.clientWidth, container.clientHeight);
    composer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', onResize);

  const clock = new THREE.Clock();
  function animate() {
    _raf = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    controls.update();
    rose.update(t);
    particles.update(t);
    composer.render();
  }
  animate();

  // store cleanup refs on the renderer so unmount can reach them
  _renderer._onResize = onResize;
}

export function unmountRose(container) {
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  if (_renderer) {
    window.removeEventListener('resize', _renderer._onResize);
    _renderer.dispose();
    if (_renderer.domElement.parentNode === container) {
      container.removeChild(_renderer.domElement);
    }
    _renderer = null;
  }
}
