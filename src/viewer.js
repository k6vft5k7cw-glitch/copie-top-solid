// Visualiseur 3D : scène, caméra (Z vers le haut), navigation, grille, gizmo de déplacement
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.persp = new THREE.PerspectiveCamera(40, 1, 0.5, 200000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    for (const c of [this.persp, this.ortho]) { c.up.set(0, 0, 1); c.position.set(300, -400, 280); }
    this.camera = this.persp;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.18;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.setNavMode('normal');

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.9);
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(1, -2, 3);
    this.sun = dir;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.bias = -0.0004;
    dir.shadow.normalBias = 0.6;
    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.16 }));
    this.shadowPlane.receiveShadow = true;
    this.shadowPlane.renderOrder = -2;
    this.headLight = new THREE.DirectionalLight(0xffffff, 0.6);
    this.scene.add(hemi, dir, dir.target, this.headLight, this.headLight.target, this.shadowPlane);

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.overlay = new THREE.Group();
    this.scene.add(this.overlay);

    this.buildGrid(1000, 10);
    this.axes = new THREE.AxesHelper(60);
    this.axes.material.depthTest = false;
    this.axes.renderOrder = 2;
    this.scene.add(this.axes);

    this.tc = new TransformControls(this.camera, this.renderer.domElement);
    this.tc.setSize(0.9);
    this.scene.add(this.tc.getHelper());
    this.tc.addEventListener('dragging-changed', (e) => { this.controls.enabled = !e.value; });

    this.raycaster = new THREE.Raycaster();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    this.onFrame = null;
    const loop = () => {
      requestAnimationFrame(loop);
      this.controls.update();
      this.headLight.position.copy(this.camera.position);
      this.headLight.target.position.copy(this.controls.target);
      if (this.onFrame) this.onFrame();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  /** Cadre les ombres sur la scène (boîte englobante) */
  fitShadows(box, on = true) {
    const sp = this.shadowPlane, d = this.sun;
    d.castShadow = on;
    if (!on || box.isEmpty()) { sp.visible = false; return; }
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const R = Math.max(sz.length() * 0.75, 50);
    d.target.position.copy(c);
    d.position.copy(c).add(new THREE.Vector3(0.35, -0.5, 1).normalize().multiplyScalar(R * 2));
    const cam = d.shadow.camera;
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 0.1; cam.far = R * 5;
    cam.updateProjectionMatrix();
    sp.visible = true;
    sp.scale.set(R * 4, R * 4, 1);
    sp.position.set(c.x, c.y, box.min.z - 0.05);
  }

  buildGrid(size, step) {
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); }
    const div = Math.round(size / step);
    this.grid = new THREE.GridHelper(size, div, 0x9fb3c8, 0xd5dde6);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.7;
    this.grid.material.depthWrite = false;
    this.grid.renderOrder = -1;
    this.scene.add(this.grid);
  }

  setNavMode(mode) {
    const c = this.controls;
    if (mode === 'sketch') {
      c.enableRotate = false;
      c.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
      c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    } else {
      c.enableRotate = true;
      c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
      c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    }
  }

  setOrtho(on) {
    const old = this.camera;
    const cam = on ? this.ortho : this.persp;
    if (cam === old) return;
    cam.position.copy(old.position);
    cam.quaternion.copy(old.quaternion);
    if (on) {
      const d = old.position.distanceTo(this.controls.target);
      const h = 2 * d * Math.tan((this.persp.fov * Math.PI) / 360);
      this.orthoHeight = h;
      cam.zoom = 1;
    } else {
      const h = this.orthoHeight / this.ortho.zoom;
      const d = h / (2 * Math.tan((this.persp.fov * Math.PI) / 360));
      const dirv = old.position.clone().sub(this.controls.target).normalize();
      cam.position.copy(this.controls.target).addScaledVector(dirv, d);
    }
    this.camera = cam;
    this.controls.object = cam;
    this.tc.camera = cam;
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    const oh = this.orthoHeight || 500;
    this.ortho.left = (-oh * w) / h / 2; this.ortho.right = (oh * w) / h / 2;
    this.ortho.top = oh / 2; this.ortho.bottom = -oh / 2;
    this.ortho.updateProjectionMatrix();
  }

  rayFromEvent(ev) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  pick(ev, objects) {
    this.rayFromEvent(ev);
    return this.raycaster.intersectObjects(objects, true);
  }

  toScreen(v) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = v.clone().project(this.camera);
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, z: p.z };
  }

  worldPerPixel(at) {
    const h = this.renderer.domElement.clientHeight || 1;
    if (this.camera.isOrthographicCamera) return (this.ortho.top - this.ortho.bottom) / this.ortho.zoom / h;
    const d = this.camera.position.distanceTo(at);
    return (2 * d * Math.tan((this.persp.fov * Math.PI) / 360)) / h;
  }

  /** Oriente la vue : dir = direction depuis la cible vers la caméra */
  setView(dir, box = null) {
    // évite le pôle exact (vue de dessus / dessous) pour garder Z vers le haut
    dir = dir.clone().normalize();
    if (Math.abs(dir.z) > 0.9999) dir.set(0, -0.001 * Math.sign(dir.z || 1), dir.z).normalize();
    const b = box && !box.isEmpty() ? box : new THREE.Box3(new THREE.Vector3(-100, -100, 0), new THREE.Vector3(100, 100, 100));
    const center = b.getCenter(new THREE.Vector3());
    const radius = Math.max(b.getSize(new THREE.Vector3()).length() / 2, 10);
    const dist = radius / Math.sin((this.persp.fov * Math.PI) / 360) * 1.15;
    this.camera.up.set(0, 0, 1);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.controls.target.copy(center);
    this.camera.lookAt(center);
    if (this.camera.isOrthographicCamera) {
      this.orthoHeight = radius * 2.3;
      this.ortho.zoom = 1;
      this.resize();
    }
    this.controls.update();
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}
