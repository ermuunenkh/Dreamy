import { mountRose,    unmountRose    } from './pages/rose.js';
import { mountPhysics, unmountPhysics } from './pages/physics.js';
import { mountScene,   unmountScene   } from './pages/physicsScene.js';

const ROUTES = {
  '/rose':    { mount: mountRose,    unmount: unmountRose    },
  '/physics': { mount: mountPhysics, unmount: unmountPhysics },
  '/scene':   { mount: mountScene,   unmount: unmountScene   },
};

let _current = null;   // { unmount, path }

function navigate(path) {
  const route = ROUTES[path] ?? ROUTES['/rose'];
  if (_current?.path === path) return;   // already here

  // Tear down previous page
  if (_current) _current.unmount(document.getElementById('app'));

  // Mount new page
  const app = document.getElementById('app');
  app.innerHTML = '';                    // clear any leftover DOM
  route.mount(app);
  _current = { unmount: route.unmount, path };

  // Sync nav highlight
  document.querySelectorAll('[data-route]').forEach(el => {
    el.classList.toggle('active', el.dataset.route === path);
  });
}

function currentPath() {
  return window.location.hash.replace('#', '') || '/rose';
}

export function initRouter() {
  window.addEventListener('hashchange', () => navigate(currentPath()));
  navigate(currentPath());
}
