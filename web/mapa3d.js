/**
 * aLocateUCB · Mapa real 2D → 3D (prototipo)
 * ==========================================
 * Una sola escena Three.js sirve para las dos vistas:
 *   2D  = cámara cenital y bloques "aplastados" (se ve el plano plano)
 *   3D  = los bloques se levantan y la cámara se inclina; se puede girar como un visor de modelos.
 *
 * Todo vive en píxeles del plano original (campus/campus.json):
 *   x → x del mundo,  y del plano → z del mundo,  altura → y del mundo.
 * Alturas = pisos × 3.2 m (provisionales) ÷ metros-por-píxel.
 *
 * El chat es una DEMOSTRACIÓN con reglas simples (sin IA): sirve para ver el flujo.
 */
import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';
import { classify, thresholds } from './vision/reconocer.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const isDesktop = window.matchMedia('(min-width: 900px)');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FLOOR_M = 3.2;
const WALK_M_PER_MIN = 75;

const SHORT = { 'bloque-a': 'A · Coliseo', 'bloque-b': 'B', 'bloque-c': 'C', 'bloque-d': 'D', 'bloque-f': 'F', 'bloques-g': 'G1 · G2', 'biblioteca-i': 'Biblioteca', 'bloque-l': 'L', 'cafeteria-h': 'Cafetería', 'bloque-j': 'J' };
const ALIASES = {
  'bloque-a': ['bloque a', 'edificio a', 'coliseo'], 'bloque-b': ['bloque b', 'edificio b'], 'bloque-c': ['bloque c', 'edificio c'],
  'bloque-d': ['bloque d', 'edificio d'], 'bloque-f': ['bloque f', 'edificio f'], 'bloques-g': ['bloque g', 'bloques g', 'g1', 'g2'],
  'biblioteca-i': ['biblioteca', 'bloque i', 'edificio i'], 'bloque-l': ['bloque l', 'edificio l'],
  'cafeteria-h': ['cafeteria', 'cafe', 'comedor', 'bloque h'], 'bloque-j': ['bloque j', 'edificio j'],
  ingreso: ['ingreso', 'entrada', 'puerta principal', 'acceso principal'], atrio: ['atrio']
};

const ICONS = {
  arrow: '<path d="M12 19V5m-6 6l6-6 6 6"/>', pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>', route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  swap: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>', play: '<path d="M7 5l12 7-12 7z"/>',
  'chevron-up': '<path d="M6 15l6-6 6 6"/>', spin: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"/>', chat: '<path d="M5 6h14v10H9l-4 3z"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>', stairs: '<path d="M4 20h4v-4h4v-4h4V8h4"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  elevator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 10l3-3 3 3M9 14l3 3 3-3"/>'
};
const icon = (n, style = '') => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${style ? ` style="${style}"` : ''}>${ICONS[n] || ''}</svg>`;
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

let toastTimer = 0;
function toast(msg, ms = 3200) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function tween(ms, onUpdate, onDone) {
  if (reduceMotion.matches) { onUpdate(1); onDone && onDone(); return { cancel() {} }; }
  let raf = 0, dead = false; const t0 = performance.now();
  const tick = (now) => { if (dead) return; const t = clamp((now - t0) / ms, 0, 1); onUpdate(t); if (t < 1) raf = requestAnimationFrame(tick); else onDone && onDone(); };
  raf = requestAnimationFrame(tick);
  return { cancel() { dead = true; cancelAnimationFrame(raf); } };
}

/* ====================================================================
 * Estado y datos
 * ==================================================================== */
const S = {
  data: null, mpp: 0.23, W: 580, H: 506,
  nodes: new Map(), adj: new Map(), places: [], placeById: new Map(),
  origin: 'ingreso', dest: 'biblioteca-i',
  view: '2d', route: null, steps: [], guide: { active: false, i: 0 }, events: [], accessible: false
};

async function loadData() {
  const res = await fetch('campus/campus.json');
  if (!res.ok) throw new Error('No se pudo leer campus/campus.json');
  const d = await res.json();
  S.data = d; S.mpp = d.plan.metersPerPixel; S.W = d.plan.width; S.H = d.plan.height;
  d.nodes.forEach((n, i) => S.nodes.set(n.id, { ...n, n: i + 1 }));
  d.nodes.forEach((n) => S.adj.set(n.id, []));
  d.edges.forEach((e) => {
    const kind = e.kind || 'camino';
    S.adj.get(e.a).push({ to: e.b, m: e.meters, id: e.id, kind }); S.adj.get(e.b).push({ to: e.a, m: e.meters, id: e.id, kind });
  });

  // Lugares: cada bloque (acceso = nodo más cercano) + dos puntos provisionales
  d.buildings.forEach((b) => S.places.push({ id: b.id, name: b.name, short: SHORT[b.id] || b.name, nodeId: b.access, building: b }));
  S.places.push({ id: 'ingreso', name: 'Ingreso principal (provisional)', short: 'Ingreso', nodeId: d.nodes[0].id, provisional: true });
  S.places.push({ id: 'atrio', name: 'Atrio (provisional)', short: 'Atrio', nodeId: d.nodes[39].id, provisional: true });
  // Ágora: el modelo de fotos la reconoce; se asocia al nodo más cercano al centro de la plaza (provisional)
  const agoraNode = d.nodes.reduce((best, n) => (Math.hypot(n.x - 245, n.y - 165) < Math.hypot(best.x - 245, best.y - 165) ? n : best), d.nodes[0]);
  S.places.push({ id: 'agora', name: 'Ágora (provisional)', short: 'Ágora', nodeId: agoraNode.id, provisional: true });

  // Catálogo editable: pisos reales por bloque y aulas (ambientes)
  let cat = null;
  try { const r = await fetch('campus/catalogo.json'); if (r.ok) cat = await r.json(); } catch (_) { /* sin catálogo */ }
  if (cat) {
    for (const [id, ov] of Object.entries(cat.bloques || {})) {
      const b = d.buildings.find((x) => x.id === id);
      if (b && ov.pisos > 0) { b.floors = ov.pisos; b.floorsProvisional = !!ov.pisosAproximados; b.floorNames = ov.nombresPisos; }
      if (b) { b.elevators = (ov.ascensores || []).filter((x) => x && x.nombre); b.zones = ov.zonas || {}; }
    }
    (cat.ambientes || []).forEach((a) => {
      const b = d.buildings.find((x) => x.id === a.bloque);
      if (!b || !a.codigo) return;
      const tipo = a.tipo || 'aula';
      const zona = a.zona && b.zones ? (b.zones[a.zona] || a.zona) : null;
      S.places.push({ id: 'aula:' + a.codigo, name: tipo === 'aula' ? `Aula ${a.codigo}` : a.codigo, short: a.codigo, nodeId: b.access,
        room: { code: a.codigo, tipo, zona, zonaCorta: a.zona ? a.zona.charAt(0).toUpperCase() + a.zona.slice(1) : null, building: b, floor: a.piso | 0, aliases: (a.alias || []).map((x) => norm(x)) } });
    });
  }
  S.places.forEach((p) => S.placeById.set(p.id, p));

  // Límites del campus (para no dejar ver más allá del mapa)
  const campus = (d.zones || []).find((z) => z.kind === 'campus');
  const pts = campus ? campus.outline : [[0, 0], [S.W, 0], [S.W, S.H], [0, S.H]];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  S.bounds = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...ys), z1: Math.max(...ys) };
}

const floorName = (b, f) => (b.floorNames && b.floorNames[f]) || (f === 0 ? 'Planta baja' : `Piso ${f}`);
/** Texto corto de un destino interior: «C201 · Piso 2» o «Bloque D · Piso 5». */
const roomLabel = (p) => {
  const r = p.room, fl = floorName(r.building, r.floor);
  return r.code ? `${r.code} · ${r.zonaCorta ? r.zonaCorta + ', ' : ''}${fl}` : `${r.building.name} · ${fl}`;
};
const roomLookFor = (r) => {
  if (!r.code) return 'Busca el lugar del evento en ese piso';
  const where = r.zonaCorta ? ` (en los ${r.zonaCorta})` : '';
  if (r.tipo === 'capilla') return `Busca la ${r.code}${where}`;
  return r.tipo && r.tipo !== 'aula' ? `Busca el ${r.code}${where}` : `Busca el aula ${r.code}${where}`;
};

/** Destino «bloque + piso» cuando un evento no trae aula exacta (se crea al vuelo). */
function floorPlace(b, floor) {
  const id = `piso:${b.id}:${floor}`;
  if (!S.placeById.has(id)) {
    const p = { id, name: `${b.name} · ${floorName(b, floor)}`, short: `${SHORT[b.id] || b.name} · ${floorName(b, floor)}`, nodeId: b.access, room: { code: null, building: b, floor } };
    S.places.push(p); S.placeById.set(id, p);
  }
  return S.placeById.get(id);
}
const buildingShort = (b) => SHORT[b.id] || b.name;
const alLugar = (name) => (/^(Bloque|Atrio|Ingreso)/.test(name) ? `al ${name}` : `a ${name}`);

function dijkstra(src, dst, accessible = S.accessible) {
  const dist = new Map([[src, 0]]), prev = new Map(), open = new Set(S.nodes.keys());
  while (open.size) {
    let cur = null, best = Infinity;
    for (const id of open) { const v = dist.get(id) ?? Infinity; if (v < best) { best = v; cur = id; } }
    if (cur === null || best === Infinity || cur === dst) break;
    open.delete(cur);
    for (const e of S.adj.get(cur)) { if (accessible && e.kind === 'escaleras') continue; const nd = best + e.m; if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, cur); } }
  }
  if (!dist.has(dst)) return null;
  const path = [dst]; for (let c = dst; c !== src;) { c = prev.get(c); path.unshift(c); }
  return { path, total: dist.get(dst) };
}

/* ====================================================================
 * Escena
 * ==================================================================== */
const canvas = $('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('fallback').hidden = false; $('loading').remove();
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe3eef4);
const camera = new THREE.PerspectiveCamera(32, 1, 5, 5000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.09; controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.9;
controls.screenSpacePanning = true; controls.autoRotateSpeed = 1.1;

const hemi = new THREE.HemisphereLight(0xffffff, 0xb8c9d8, 1.9);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
scene.add(hemi, sun, sun.target);

const world = new THREE.Group(); scene.add(world);
const buildingGroups = []; const bMeshes = [];
const markers = { origin: null, dest: null };
let ground, routeGroup, walker, guideGroup, graphLines;
const labelEls = [];
let rise = 0.02, riseTween = null;
const RISE_FLAT = 0.02;

function setupLights() {
  const cx = S.W / 2, cz = S.H / 2;
  sun.position.set(cx - 260, 420, cz - 200); sun.target.position.set(cx, 0, cz);
  const c = sun.shadow.camera; const r = Math.max(S.W, S.H) * 0.75;
  c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 50; c.far = 1400; c.updateProjectionMatrix();
}

/** Forma de Three.js a partir de un contorno del plano (y del plano → -y de la forma). */
function shapeOf(outline, holes = []) {
  const s = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, -y)));
  holes.forEach((h) => s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, -y)))));
  return s;
}

/**
 * Mapa redibujado en vectores: losa del campus (como una maqueta), plazas y áreas verdes.
 * Se ve nítido a cualquier zoom. El plano original solo se usa para comparar, si está disponible.
 */
function buildBase(texture) {
  const zones = S.data.zones || [];
  const campus = zones.find((z) => z.kind === 'campus');
  const SLAB = 7;
  if (campus) {
    const geo = new THREE.ExtrudeGeometry(shapeOf(campus.outline), { depth: SLAB, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const slab = new THREE.Mesh(geo, [new THREE.MeshLambertMaterial({ color: 0xf4f1e6 }), new THREE.MeshLambertMaterial({ color: 0xb9c8d6 })]);
    slab.position.y = -SLAB; slab.receiveShadow = true; world.add(slab);
    const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(campus.outline.map(([x, y]) => new THREE.Vector3(x, 0.05, y))), new THREE.LineBasicMaterial({ color: 0x9fb2c4 }));
    world.add(edge);
  }
  const style = { plaza: { color: 0xd8dde4, y: 0.12 }, green: { color: 0x9fcf8f, y: 0.25 } };
  for (const kind of ['plaza', 'green']) {
    const mat = new THREE.MeshLambertMaterial({ color: style[kind].color });
    zones.filter((z) => z.kind === kind).forEach((z) => {
      const geo = new THREE.ShapeGeometry(shapeOf(z.outline, z.holes || []));
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat); m.position.y = style[kind].y; m.receiveShadow = true; world.add(m);
    });
  }
  // Fuera del campus: mismo color que el fondo, para que el mapa "flote" y no invite a salir
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(S.W * 10, S.H * 10), new THREE.MeshBasicMaterial({ color: 0xe3eef4 }));
  outer.rotation.x = -Math.PI / 2; outer.position.set(S.W / 2, -SLAB - 0.5, S.H / 2); world.add(outer);

  if (texture) {
    ground = new THREE.Mesh(new THREE.PlaneGeometry(S.W, S.H), new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.85 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(S.W / 2, 0.45, S.H / 2); ground.visible = false; world.add(ground);
    $('planoToggle').hidden = false;
    $('chkPlano').addEventListener('change', (e) => { ground.visible = e.target.checked; });
  }
}

function lighten(hex, k) { const c = new THREE.Color(hex); return c.lerp(new THREE.Color(0xffffff), k); }

function buildBuildings() {
  S.data.buildings.forEach((b) => {
    const h = (b.floors * FLOOR_M) / S.mpp;
    const shape = new THREE.Shape(b.footprint.map(([x, y]) => new THREE.Vector2(x, -y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1 });
    geo.rotateX(-Math.PI / 2);
    // Techo sin sombreado: el color de marca se ve exacto en 2D; las paredes sí reciben luz para dar volumen en 3D
    const top = new THREE.MeshBasicMaterial({ color: lighten(b.color, 0.1) });
    const side = new THREE.MeshStandardMaterial({ color: new THREE.Color(b.color), roughness: 0.9, metalness: 0 });
    const mesh = new THREE.Mesh(geo, [top, side]);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.building = b;
    const pts = b.footprint.map(([x, y]) => new THREE.Vector3(x, h + 0.2, y));
    const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: lighten(b.color, 0.55) }));
    const g = new THREE.Group(); g.add(mesh, outline); g.userData = { b, h, top, side, mesh, outline };
    g.scale.y = rise; world.add(g); buildingGroups.push(g); bMeshes.push(mesh);

    const cx = b.footprint.reduce((s, p) => s + p[0], 0) / b.footprint.length;
    const cy = b.footprint.reduce((s, p) => s + p[1], 0) / b.footprint.length;
    g.userData.center = new THREE.Vector3(cx, h, cy);
    const el = document.createElement('div'); el.className = 'lbl big'; el.textContent = SHORT[b.id] || b.name;
    $('labels').appendChild(el); labelEls.push({ el, world: g.userData.center, group: g, kind: 'building' });
  });
}

/** En 2D los bloques están "aplastados" (se ven como el plano); en 3D se levantan con su altura. */
function applyRise() {
  buildingGroups.forEach((g) => { g.scale.y = rise; });
}

function buildGraphLines() {
  const pos = [];
  S.data.edges.forEach((e) => {
    const a = S.nodes.get(e.a), b = S.nodes.get(e.b);
    const pts = [[a.x, a.y], ...e.waypoints.map((w) => [w.x, w.y]), [b.x, b.y]];
    for (let i = 0; i < pts.length - 1; i++) pos.push(pts[i][0], 0.5, pts[i][1], pts[i + 1][0], 0.5, pts[i + 1][1]);
  });
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  graphLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x5f87ad, transparent: true, opacity: 0.55 }));
  world.add(graphLines);
  // Tramos especiales encima: escaleras (rojo) y rampas o caminos accesibles (verde)
  const special = { escaleras: { color: 0xc0392b, pos: [] }, rampa: { color: 0x1b7f4b, pos: [] } };
  S.data.edges.forEach((e) => {
    const s = special[e.kind]; if (!s) return;
    const a = S.nodes.get(e.a), b = S.nodes.get(e.b), pts = [[a.x, a.y], ...e.waypoints.map((w) => [w.x, w.y]), [b.x, b.y]];
    for (let i = 0; i < pts.length - 1; i++) s.pos.push(pts[i][0], 0.7, pts[i][1], pts[i + 1][0], 0.7, pts[i + 1][1]);
  });
  Object.values(special).forEach((s) => {
    if (!s.pos.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3));
    world.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: s.color })));
  });
  const dotGeo = new THREE.CylinderGeometry(1.8, 1.8, 0.8, 14);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x5f87ad });
  S.data.nodes.forEach((n) => {
    const m = new THREE.Mesh(dotGeo, dotMat); m.position.set(n.x, 0.8, n.y);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.6, 14), ringMat); r.position.set(n.x, 0.55, n.y);
    world.add(r, m);
  });
}

/* ---- marcadores de origen y destino ---- */

/** Personita estilo juguete (cuerpo azul, cabeza amarilla): representa a quien usa la app. */
function makePerson(scale = 1) {
  const p = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(2.4, 4.2, 4, 12), new THREE.MeshStandardMaterial({ color: 0x005289, roughness: 0.55 }));
  body.position.y = 4.6; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(2.3, 18, 14), new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.45 }));
  head.position.y = 10.4; head.castShadow = true;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0b1f33 });
  [-0.8, 0.8].forEach((x) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), eyeMat); e.position.set(x, 10.8, 2.1); p.add(e); });
  p.add(body, head); p.scale.setScalar(scale);
  return p;
}

function makeOriginMarker() {
  const g = new THREE.Group();
  const puck = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.6, 1.6, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
  puck.position.y = 0.9; puck.receiveShadow = true;
  const core = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 1.8, 32), new THREE.MeshStandardMaterial({ color: 0x005289, roughness: 0.5 }));
  core.position.y = 1.0;
  const ring = new THREE.Mesh(new THREE.RingGeometry(7, 8.6, 48), new THREE.MeshBasicMaterial({ color: 0x009dc4, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.6;
  const person = makePerson(0.95); person.position.y = 1.9;
  g.add(puck, core, ring, person); g.userData.ring = ring; g.userData.person = person; return g;
}

/** Pin de destino: gota torneada con brillo, aro azul, anillos en el suelo y un haz de luz visible desde lejos en 3D. */
function makePinMarker() {
  const g = new THREE.Group(); const body = new THREE.Group();
  const profile = [[0, 0], [1.4, 3], [3.4, 7.5], [5.6, 12.5], [7, 17], [7.4, 20.5], [6.8, 24], [5, 27], [2.6, 28.8], [0, 29.4]].map(([x, y]) => new THREE.Vector2(x, y));
  const mat = new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.28, metalness: 0.08, emissive: 0x3d2f00 });
  const drop = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), mat); drop.castShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.95, 12, 48), new THREE.MeshStandardMaterial({ color: 0x003366, roughness: 0.4 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 20.5;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(3, 18, 12), new THREE.MeshStandardMaterial({ color: 0x003366, roughness: 0.35 }));
  dot.position.y = 29.6;
  body.add(drop, ring, dot);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(5.5, 24), new THREE.MeshBasicMaterial({ color: 0x003366, transparent: true, opacity: 0.25 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.8;
  const rings = [0, 1].map(() => { const r = new THREE.Mesh(new THREE.RingGeometry(6, 7.4, 48), new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.6, side: THREE.DoubleSide })); r.rotation.x = -Math.PI / 2; r.position.y = 0.7; return r; });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 6, 160, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  beam.position.y = 80;
  g.add(body, shadow, beam, ...rings); g.userData = { body, rings, beam }; return g;
}

/* ====================================================================
 * Ruta (cinta plana + caminante)
 * ==================================================================== */
const routeMatMain = new THREE.MeshBasicMaterial({ color: 0x005289 });
const routeMatCase = new THREE.MeshBasicMaterial({ color: 0xffffff });
const guideMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
const guideCaseMat = new THREE.MeshBasicMaterial({ color: 0x003366 });

/** Cinta de ancho constante sobre el suelo, con uniones redondas. */
function ribbon(points, width, y, mat) {
  const g = new THREE.Group(); if (points.length < 2) return g;
  const pos = [], r = width / 2;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1]; const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * r, nz = (dx / len) * r;
    pos.push(x0 + nx, y, z0 + nz, x0 - nx, y, z0 - nz, x1 + nx, y, z1 + nz, x1 + nx, y, z1 + nz, x0 - nx, y, z0 - nz, x1 - nx, y, z1 - nz);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(geo, mat); m.material.side = THREE.DoubleSide; g.add(m);
  const cg = new THREE.CircleGeometry(r, 16); cg.rotateX(-Math.PI / 2);
  points.forEach(([x, z]) => { const c = new THREE.Mesh(cg, mat); c.position.set(x, y, z); g.add(c); });
  return g;
}
function disposeGroup(g) { g.traverse((o) => { if (o.geometry && o.geometry !== undefined && !o.userData.keep) o.geometry.dispose?.(); }); }

function polyLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
function pointAt(pts, d) {
  let rem = d;
  for (let i = 1; i < pts.length; i++) { const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (rem <= seg && seg > 0) { const t = rem / seg; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; } rem -= seg; }
  return pts[pts.length - 1];
}
function upTo(pts, d) {
  const out = [pts[0]]; let rem = d;
  for (let i = 1; i < pts.length; i++) { const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (rem >= seg) { out.push(pts[i]); rem -= seg; } else { const t = rem / seg; out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]); break; } }
  return out;
}

/** Puntos (x, z) de la ruta siguiendo los giros de cada conexión. */
function routePoints(path) {
  const pts = [[S.nodes.get(path[0]).x, S.nodes.get(path[0]).y]];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const e = S.data.edges.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    const wps = e.a === a ? e.waypoints : [...e.waypoints].reverse();
    wps.forEach((w) => pts.push([w.x, w.y]));
    pts.push([S.nodes.get(b).x, S.nodes.get(b).y]);
  }
  return pts;
}

let routePts = [], routeLen = 0, routeAnim = null, walkerT0 = 0;

function renderRoute() {
  if (routeGroup) { world.remove(routeGroup); disposeGroup(routeGroup); routeGroup = null; }
  if (guideGroup) { world.remove(guideGroup); disposeGroup(guideGroup); guideGroup = null; }
  routePts = []; routeLen = 0;
  if (!S.route || S.route.path.length < 2) { walker.visible = false; return; }
  routePts = routePoints(S.route.path); routeLen = polyLength(routePts);
  // La personita del origen mira hacia el primer tramo
  if (markers.origin && routePts.length > 1) markers.origin.userData.person.rotation.y = Math.atan2(routePts[1][0] - routePts[0][0], routePts[1][1] - routePts[0][1]);
  routeAnim = { t0: performance.now(), dur: reduceMotion.matches ? 1 : 1100, last: -1 };
  walkerT0 = performance.now() + 1300;
  walker.visible = true;
}

function updateRouteReveal(now) {
  if (!routeAnim) return;
  const p = clamp((now - routeAnim.t0) / routeAnim.dur, 0, 1), e = ease(p);
  if (e === routeAnim.last) return;
  routeAnim.last = e;
  if (routeGroup) { world.remove(routeGroup); disposeGroup(routeGroup); }
  const pts = p >= 1 ? routePts : upTo(routePts, routeLen * e);
  routeGroup = new THREE.Group();
  routeGroup.add(ribbon(pts, 9.5, 1.0, routeMatCase), ribbon(pts, 5.4, 1.4, routeMatMain));
  world.add(routeGroup);
  if (p >= 1) routeAnim = null;
}

/** El caminante es la misma personita, más pequeña, que recorre la ruta. */
function makeWalker() {
  const g = new THREE.Group();
  const person = makePerson(0.75);
  const halo = new THREE.Mesh(new THREE.CircleGeometry(7, 28), new THREE.MeshBasicMaterial({ color: 0x009dc4, transparent: true, opacity: 0.3 }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = 1.6;
  g.add(person, halo); g.visible = false; return g;
}

function updateWalker(now) {
  if (!walker.visible || S.guide.active || !routePts.length || routeAnim) return;
  if (reduceMotion.matches) { walker.visible = false; return; }
  const secs = clamp(routeLen / 60, 4, 10);
  const t = ((now - walkerT0) / (secs * 1000)); if (t < 0) { walker.position.set(routePts[0][0], 0, routePts[0][1]); return; }
  const u = (t % 1.3) / 1.3, d = Math.min(1, u * 1.15) * routeLen; const [x, z] = pointAt(routePts, d);
  const [px, pz] = pointAt(routePts, Math.max(0, d - 3));
  walker.position.set(x, 0, z); walker.children[0].position.y = Math.abs(Math.sin(now / 140)) * 1.4;
  if (x !== px || z !== pz) walker.rotation.y = Math.atan2(x - px, z - pz); // mira hacia donde camina
}

/* ====================================================================
 * Cámara: 2D ↔ 3D, vuelos y encuadres
 * ==================================================================== */
const POLAR_2D = 0.0001, POLAR_3D = 0.95;
let flight = null, autoSpin = false, spinTimer = 0;
const sph = new THREE.Spherical(); const tmp = new THREE.Vector3();

function shortestAngle(from, to) { return from + ((((to - from) + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI); }

function currentRig() { tmp.copy(camera.position).sub(controls.target); sph.setFromVector3(tmp); return { target: controls.target.clone(), dist: sph.radius, polar: sph.phi, az: sph.theta }; }

function guideHeight() { return S.guide.active ? $('guideCard').offsetHeight + 24 : 0; }
function sheetTops() { const h = window.innerHeight; const sh = $('sheet').offsetHeight || h * 0.88; return { full: h - sh, half: h * 0.5, peek: h - 132 }; }
function freeRect(snap) {
  const W = window.innerWidth, H = window.innerHeight;
  if (isDesktop.matches) { const r = $('sheet').getBoundingClientRect(); const x = r.right + 20; return { x, y: 20, w: W - x - 76, h: H - 40 - guideHeight() }; }
  const top = sheetTops()[snap || $('sheet').dataset.snap] ?? sheetTops().half;
  return { x: 12, y: 84, w: W - 24 - 54, h: Math.max(120, top - 84 - 10 - guideHeight()) };
}
function applyViewOffset(snap) {
  const W = window.innerWidth, H = window.innerHeight, f = freeRect(snap);
  const dx = f.x + f.w / 2 - W / 2, dy = f.y + f.h / 2 - H / 2;
  camera.setViewOffset(W, H, -dx, -dy, W, H); camera.updateProjectionMatrix();
}
function distanceFor(radius, snap) {
  const f = freeRect(snap), W = window.innerWidth, H = window.innerHeight;
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (f.h / H);
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * (f.w / W);
  return radius / Math.sin(Math.atan(Math.min(tanV, tanH)));
}

/** Distancia para que un rectángulo (vista cenital) quepa completo en el área libre. Mejor que una esfera en celulares angostos. */
function distanceForBox(w, h, snap) {
  const f = freeRect(snap), W = window.innerWidth, H = window.innerHeight;
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (f.h / H);
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * (f.w / W);
  return Math.max((w / 2) / tanH, (h / 2) / tanV);
}

function flyTo({ target, dist, polar, az }, ms = 1000, then) {
  if (flight) flight.cancel();
  const from = currentRig(); const azTo = shortestAngle(from.az, az ?? from.az);
  controls.enabled = false; controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI * 0.49; controls.enableRotate = true;
  controls.minDistance = 0; controls.maxDistance = Infinity;
  flight = tween(ms, (t) => {
    const e = ease(t);
    controls.target.lerpVectors(from.target, target, e);
    const d = from.dist * Math.pow(dist / from.dist, e), phi = from.polar + (polar - from.polar) * e, th = from.az + (azTo - from.az) * e;
    sph.set(d, phi, th); tmp.setFromSpherical(sph); camera.position.copy(controls.target).add(tmp); camera.lookAt(controls.target);
  }, () => { flight = null; applyScheme(); controls.update(); then && then(); });
}

function applyScheme() {
  const is2d = S.view === '2d';
  controls.enabled = true;
  controls.enableRotate = !is2d;
  // En 3D no se puede inclinar hasta el horizonte: siempre se ve el campus, nunca "el vacío"
  controls.minPolarAngle = is2d ? POLAR_2D : 0.25; controls.maxPolarAngle = is2d ? POLAR_2D + 0.0001 : 1.12;
  controls.mouseButtons = { LEFT: is2d ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: is2d ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  const b = S.bounds || { x0: 0, x1: S.W, z0: 0, z1: S.H };
  controls.minDistance = 55; controls.maxDistance = distanceForBox(b.x1 - b.x0, b.z1 - b.z0) * (is2d ? 1.12 : 1.3);
  controls.autoRotate = autoSpin && !is2d && !S.guide.active;
}

const boundsOf = (pts) => { const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs); return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, r: Math.max(Math.hypot(x1 - x0, z1 - z0) / 2, 20) }; };
function rigFor(pts, { margin = 1.25, minR = 45, az, snap } = {}) {
  const b = boundsOf(pts); const r = Math.max(b.r * margin, minR);
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const bw = Math.max(Math.max(...xs) - Math.min(...xs), minR) * Math.max(margin, 1), bh = Math.max(Math.max(...zs) - Math.min(...zs), minR) * Math.max(margin, 1);
  const dist = S.view === '2d' ? distanceForBox(bw, bh, snap) * 1.06 : distanceFor(r, snap);
  return { target: new THREE.Vector3(b.cx, 0, b.cz), dist, polar: S.view === '2d' ? POLAR_2D : POLAR_3D, az: S.view === '2d' ? 0 : az ?? currentRig().az };
}
const allPts = () => { const b = S.bounds || { x0: 0, x1: S.W, z0: 0, z1: S.H }; return [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]]; };
function focusAll(ms = 900, snap) { flyTo(rigFor(allPts(), { margin: 0.8, snap }), ms); }
function focusRoute(ms = 1000, snap) { routePts.length ? flyTo(rigFor(routePts, { margin: 1.45, minR: 70, snap }), ms) : focusAll(ms, snap); }

function setView(v, ms = 1100) {
  if (S.view === v) return;
  S.view = v;
  $('btn2d').classList.toggle('active', v === '2d'); $('btn3d').classList.toggle('active', v === '3d');
  $('btn2d').setAttribute('aria-pressed', v === '2d'); $('btn3d').setAttribute('aria-pressed', v === '3d');
  if (riseTween) riseTween.cancel();
  const from = rise, to = v === '3d' ? 1 : RISE_FLAT;
  riseTween = tween(ms, (t) => { rise = from + (to - from) * ease(t); applyRise(); });
  const f = S.guide.active ? currentGuideRig() : (routePts.length ? rigFor(routePts, { margin: 1.45, minR: 70 }) : rigFor(allPts(), { margin: 1.0 }));
  if (v === '3d' && !S.guide.active) f.az = -0.55;
  flyTo(f, ms);
}

function clampTarget() {
  const b = S.bounds || { x0: 0, x1: S.W, z0: 0, z1: S.H };
  const t = controls.target; const cx = clamp(t.x, b.x0, b.x1), cz = clamp(t.z, b.z0, b.z1);
  if (cx !== t.x || cz !== t.z) { const dx = cx - t.x, dz = cz - t.z; t.x = cx; t.z = cz; camera.position.x += dx; camera.position.z += dz; }
}

controls.addEventListener('start', () => { if (flight) { flight.cancel(); flight = null; applyScheme(); } controls.autoRotate = false; clearTimeout(spinTimer); hidePop(); });
controls.addEventListener('end', () => { if (autoSpin && S.view === '3d') spinTimer = setTimeout(() => { controls.autoRotate = true; }, 4000); });

function zoomBy(f) { const r = currentRig(); flyTo({ ...r, dist: clamp(r.dist * f, 55, controls.maxDistance || 1500) }, 280); }
$('btnZoomIn').addEventListener('click', () => zoomBy(1 / 1.45));
$('btnZoomOut').addEventListener('click', () => zoomBy(1.45));
$('btnRecenter').addEventListener('click', () => { hidePop(); S.guide.active ? goGuide(S.guide.i) : focusRoute(); });
$('btn2d').addEventListener('click', () => setView('2d'));
$('btn3d').addEventListener('click', () => setView('3d'));
$('btnSpin').addEventListener('click', () => {
  autoSpin = !autoSpin; $('btnSpin').setAttribute('aria-pressed', autoSpin);
  if (autoSpin && S.view === '2d') setView('3d'); else controls.autoRotate = autoSpin && S.view === '3d';
  toast(autoSpin ? 'El mapa girará solo. Tócalo para tomar el control.' : 'Giro automático desactivado.');
});

/* ====================================================================
 * Etiquetas HTML sobre la escena
 * ==================================================================== */
const v3 = new THREE.Vector3();
function project(world, out) { v3.copy(world).project(camera); const W = window.innerWidth, H = window.innerHeight; out.x = (v3.x * 0.5 + 0.5) * W; out.y = (-v3.y * 0.5 + 0.5) * H; out.z = v3.z; return out; }
const scr = { x: 0, y: 0, z: 0 };
function updateLabels() {
  const dist = camera.position.distanceTo(controls.target);
  labelEls.forEach((L) => {
    const w = L.kind === 'building' ? new THREE.Vector3(L.world.x, L.group.userData.h * rise + 1, L.world.z) : L.world;
    project(w, scr);
    const visible = scr.z < 1 && (L.kind !== 'building' || dist < 1600);
    L.el.classList.toggle('hide', !visible);
    L.el.style.transform = `translate(-50%,-50%) translate(${scr.x.toFixed(1)}px,${scr.y.toFixed(1)}px)`;
  });
  if (S.popBuilding) positionPop();
}

/* ====================================================================
 * Selección y tarjeta de información
 * ==================================================================== */
const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(bMeshes, false)[0];
  if (hit) openPop(hit.object.userData.building); else hidePop();
});
function openPop(b) {
  S.popBuilding = b;
  const place = S.placeById.get(b.id);
  $('popCat').textContent = `Bloque · ${b.floors} pisos${b.floorsProvisional ? ' (provisional)' : ''}`;
  $('popName').textContent = b.name;
  const acc = S.nodes.get(b.access);
  const rooms = S.places.filter((p) => p.room && p.room.code && p.room.building === b);
  $('popDesc').textContent = rooms.length
    ? `${rooms.length} ambientes registrados. Acceso más cercano en el grafo: Nodo ${acc.n}.`
    : `Acceso más cercano: Nodo ${acc.n}. Huella ${b.source === 'auto' ? 'detectada del plano' : 'aproximada'}; se corrige desde el editor.`;
  // Pisos y ascensores del bloque (con foto para reconocerlos)
  const extra = $('popExtra'); extra.innerHTML = '';
  if (b.floorNames && !b.floorsProvisional) extra.insertAdjacentHTML('beforeend', `<div class="pop-floors">${b.floorNames.map((n) => `<span>${esc(n)}</span>`).join('')}</div>`);
  const elevs = b.elevators || [];
  if (elevs.length) {
    extra.insertAdjacentHTML('beforeend', `<h4>Ascensores (${elevs.length})</h4>`);
    elevs.forEach((e) => {
      const div = document.createElement('div'); div.className = 'elev';
      div.innerHTML = `${e.foto ? `<img src="${esc(e.foto)}" alt="Foto: ${esc(e.nombre)}" loading="lazy">` : '<span></span>'}
        <div><strong>${esc(e.nombre)}</strong><small>${esc(e.ubicacion || '')}</small>
        <small>${e.desdePiso ? `Parte desde ${esc(floorName(b, e.desdePiso))}` : 'Desde planta baja'}</small>
        ${e.posicionAproximada ? '<small class="approx">Punto del mapa aproximado</small>' : ''}</div>`;
      const img = div.querySelector('img'); if (img) img.addEventListener('click', () => zoomPhoto(e.foto, e.nombre));
      extra.appendChild(div);
    });
  }
  $('nodePop').classList.toggle('wide', elevs.length > 0);
  showElevatorMarkers(b);
  $('nodePop').hidden = false; $('nodePop').dataset.place = place.id; positionPop();
  buildingGroups.forEach((g) => highlight(g, g.userData.b === b));
}
/** Resalta un bloque: techo teñido de amarillo y paredes con un leve brillo. */
const HIGHLIGHT = new THREE.Color(0xffcc00);
function highlight(g, on) {
  const u = g.userData;
  if (!u.topColor) u.topColor = u.top.color.clone();
  u.top.color.copy(on ? u.topColor.clone().lerp(HIGHLIGHT, 0.45) : u.topColor);
  u.side.emissive.setHex(on ? 0x332600 : 0x000000);
}

function zoomPhoto(src, alt) {
  const z = document.createElement('div'); z.className = 'photo-zoom'; z.setAttribute('role', 'dialog'); z.setAttribute('aria-label', alt);
  z.innerHTML = `<img src="${esc(src)}" alt="${esc(alt)}">`; z.addEventListener('click', () => z.remove());
  $('app').appendChild(z);
}

/** Marcadores de ascensor (columna cian) del bloque tocado o del bloque destino. */
let elevGroup = null;
function showElevatorMarkers(b) {
  if (elevGroup) { elevGroup.parent && elevGroup.parent.remove(elevGroup); elevGroup = null; }
  const g = buildingGroups.find((x) => x.userData.b === b);
  const list = (b && b.elevators || []).filter((e) => Number.isFinite(e.x) && Number.isFinite(e.y));
  if (!g || !list.length) return;
  elevGroup = new THREE.Group();
  const h = g.userData.h * 1.08;
  list.forEach((e) => {
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(7, h, 7), new THREE.MeshStandardMaterial({ color: 0x009dc4, emissive: 0x00495c, transparent: true, opacity: 0.9 }));
    shaft.position.set(e.x, h / 2, e.y);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(9, 1.5, 9), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    cap.position.set(e.x, h + 0.8, e.y);
    elevGroup.add(shaft, cap);
  });
  g.add(elevGroup); // dentro del grupo del bloque: sube y baja con él (2D/3D)
}

function hidePop() {
  S.popBuilding = null; $('nodePop').hidden = true;
  const dp = S.placeById.get(S.dest); showElevatorMarkers(dp && dp.room && S.accessible ? dp.room.building : null);
  buildingGroups.forEach((g) => highlight(g, false));
}
function positionPop() {
  const g = buildingGroups.find((x) => x.userData.b === S.popBuilding); if (!g) return;
  project(new THREE.Vector3(g.userData.center.x, g.userData.h * rise, g.userData.center.z), scr);
  // La tarjeta se queda dentro del área libre del mapa (nunca debajo del panel)
  const pop = $('nodePop'), w = pop.offsetWidth, h = pop.offsetHeight, f = freeRect();
  const minX = f.x, maxX = Math.max(f.x, f.x + f.w + 54 - w), minY = Math.max(78, f.y), maxY = Math.max(minY, f.y + f.h - h);
  let top = scr.y - h - 20; if (top < minY) top = scr.y + 24;
  pop.style.left = clamp(scr.x - w / 2, minX, maxX) + 'px'; pop.style.top = clamp(top, minY, maxY) + 'px';
}
$('popClose').addEventListener('click', hidePop);
$('popGo').addEventListener('click', () => { const id = $('nodePop').dataset.place; hidePop(); setDest(id); });
$('popFrom').addEventListener('click', () => { const id = $('nodePop').dataset.place; hidePop(); setOrigin(id); });

/* ====================================================================
 * Ruta: panel, pasos y guía
 * ==================================================================== */
const minutes = (m) => Math.max(1, Math.ceil(m / WALK_M_PER_MIN));
const placeAtNode = (nodeId) => S.places.find((p) => p.nodeId === nodeId && !p.provisional) || S.places.find((p) => p.nodeId === nodeId);

function turnBetween(a, b, c) {
  const v1 = [b.x - a.x, b.y - a.y], v2 = [c.x - b.x, c.y - b.y];
  const ang = Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]) * 180 / Math.PI, abs = Math.abs(ang);
  if (abs < 22) return { text: 'Sigue recto', rot: 0 };
  if (abs > 150) return { text: 'Da la vuelta', rot: 180 };
  const side = ang > 0 ? 'derecha' : 'izquierda';
  return { text: abs < 60 ? `Gira levemente a la ${side}` : `Gira a la ${side}`, rot: clamp(ang, -135, 135) };
}

/** Une tramos casi rectos; corta solo en giros o en lugares con nombre. */
function buildSteps(path, destPlace) {
  const steps = []; let start = 0, meters = 0, first = true, turn = null;
  const edgeM = (a, b) => S.adj.get(a).find((e) => e.to === b).m;
  for (let i = 0; i < path.length - 1; i++) {
    meters += edgeM(path[i], path[i + 1]);
    const last = i === path.length - 2;
    let cut = last, t = null;
    if (!last) { t = turnBetween(S.nodes.get(path[i]), S.nodes.get(path[i + 1]), S.nodes.get(path[i + 2])); cut = t.rot !== 0 || (placeAtNode(path[i + 1]) && !placeAtNode(path[i + 1]).provisional); }
    if (cut) {
      steps.push({ a: start, b: i + 1, meters, turn: first ? { text: 'Camina hacia adelante', rot: 0 } : turn, arrive: last ? destPlace : null });
      start = i + 1; meters = 0; first = false; turn = t;
    }
  }
  return steps;
}

function recalc({ fly = true } = {}) {
  exitGuide(true);
  const o = S.placeById.get(S.origin), d = S.placeById.get(S.dest);
  S.route = o && d ? dijkstra(o.nodeId, d.nodeId) : null;
  S.steps = S.route && S.route.total > 0 ? buildSteps(S.route.path, d) : [];
  renderRoute(); renderMarkers(); renderPanel();
  if (fly) focusRoute();
}

function renderMarkers() {
  const place = (id) => S.nodes.get(S.placeById.get(id).nodeId);
  const o = place(S.origin), d = place(S.dest);
  markers.origin.position.set(o.x, 0, o.y); markers.dest.position.set(d.x, 0, d.y);
  markers.dest.visible = S.dest !== S.origin;
  labelEls.filter((l) => l.kind !== 'building').forEach((l) => l.el.remove());
  for (let i = labelEls.length - 1; i >= 0; i--) if (labelEls[i].kind !== 'building') labelEls.splice(i, 1);
  const mk = (txt, cls, node, y) => { const el = document.createElement('div'); el.className = `lbl place ${cls}`; el.textContent = txt; $('labels').appendChild(el); labelEls.push({ el, world: new THREE.Vector3(node.x, y, node.y), kind: cls }); };
  mk(S.placeById.get(S.origin).short, 'start', o, 14);
  const dp = S.placeById.get(S.dest);
  if (S.dest !== S.origin) mk(dp.room ? roomLabel(dp) : dp.short, 'end', d, 44);
  renderFloorBand(dp);
  if (!S.popBuilding) showElevatorMarkers(dp && dp.room && S.accessible ? dp.room.building : null);
}

/** Si el destino es un aula, resalta su piso dentro del bloque (franja amarilla a la altura del nivel). */
let floorBand = null;
function renderFloorBand(place) {
  if (floorBand) { floorBand.parent.remove(floorBand); floorBand.geometry.dispose(); floorBand = null; }
  if (!place || !place.room) return;
  const g = buildingGroups.find((x) => x.userData.b === place.room.building);
  if (!g) return;
  const b = place.room.building, levelH = FLOOR_M / S.mpp;
  const cx = b.footprint.reduce((s, p) => s + p[0], 0) / b.footprint.length, cy = b.footprint.reduce((s, p) => s + p[1], 0) / b.footprint.length;
  const grown = b.footprint.map(([x, y]) => [cx + (x - cx) * 1.02, cy + (y - cy) * 1.02]);
  const geo = new THREE.ExtrudeGeometry(shapeOf(grown), { depth: levelH * 0.82, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  floorBand = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0x6b5200, transparent: true, opacity: 0.78, roughness: 0.5 }));
  floorBand.position.y = place.room.floor * levelH + levelH * 0.09;
  g.add(floorBand);
}

/**
 * Último paso dentro del bloque: subir de piso. Con «Ruta accesible» se indica el ascensor (con su foto si existe).
 * Las fotos de ascensores se registran en campus/catalogo.json → bloques.<id>.ascensores.
 */
function verticalStep(place) {
  const r = place.room, b = r.building, look = roomLookFor(r);
  // Para la ruta accesible sirve el ascensor que arranca en planta baja; si no hay, el primero registrado
  const elev = (b.elevators || []).find((e) => !e.desdePiso) || (b.elevators || [])[0];
  const photo = elev && elev.foto ? elev.foto : null, photoAlt = elev ? `${elev.nombre} del ${b.name}` : '';
  if (!r.floor) return { icon: 'pin', title: 'Está en planta baja', detail: look, photo: null };
  if (S.accessible) {
    return elev
      ? { icon: 'elevator', title: `Toma el ascensor a ${floorName(b, r.floor)}`, detail: `${elev.nombre}${elev.ubicacion ? ' · ' + elev.ubicacion : ''}. ${look}.`, photo, photoAlt }
      : { icon: 'elevator', title: `Sube a ${floorName(b, r.floor)}`, detail: `Aún no tenemos registrado el ascensor de este bloque. ${look}.`, photo: null };
  }
  return { icon: 'stairs', title: `Sube a ${floorName(b, r.floor)}`, detail: `${elev ? 'Por las gradas o el ascensor' : 'Por las gradas'}. ${look}.`, photo, photoAlt };
}

function renderPanel() {
  const r = S.route, box = $('resultBox'); box.classList.remove('empty', 'noroute');
  const d = S.placeById.get(S.dest);
  if (!r) { box.classList.add('noroute'); $('txtMeters').textContent = '—'; $('txtEta').textContent = 'Sin conexión'; $('txtNote').textContent = 'No encontramos un camino entre esos lugares.'; $('stepsList').innerHTML = ''; }
  else if (r.total === 0) { box.classList.add('empty'); $('txtNote').textContent = 'Ya estás en ese lugar. Elige otro destino.'; $('stepsList').innerHTML = ''; }
  else {
    $('txtMeters').textContent = Math.round(r.total); $('txtEta').textContent = `~${minutes(r.total)} min a pie · ${S.steps.length} ${S.steps.length === 1 ? 'paso' : 'pasos'}`;
    $('accBadge').className = 'badge ok'; $('accBadge').textContent = 'Solo caminos'; $('txtNote').textContent = 'Distancias estimadas con la escala del plano. Toca un paso para verlo en el mapa.';
    const ol = $('stepsList'); ol.innerHTML = '';
    const add = (cls, ico, title, detail, rot, onClick) => {
      const li = document.createElement('li'); li.className = 'step ' + cls;
      li.innerHTML = `<button class="step-btn" type="button"><span class="step-ico">${icon(ico, rot ? `transform:rotate(${rot}deg)` : '')}</span><span class="step-title">${esc(title)}</span><div class="step-detail">${esc(detail)}</div></button>`;
      li.querySelector('button').addEventListener('click', onClick); ol.appendChild(li);
      return li;
    };
    add('start', 'pin', `Sales de ${S.placeById.get(S.origin).short}`, 'Punto de partida', 0, () => startGuide(0));
    S.steps.forEach((s, i) => { const to = s.arrive ? ` · llegas a ${s.arrive.short}` : ''; add('', 'arrow', `${s.turn.text}`, `${Math.round(s.meters)} m · ~${Math.max(1, Math.round(s.meters / (WALK_M_PER_MIN / 60)))} s${to}`, s.turn.rot, () => startGuide(i)); });
    if (d.room) {
      const b = d.room.building, v = verticalStep(d);
      add('end', 'flag', `Llegas ${alLugar(b.name)}`, 'Entrada más cercana (provisional)', 0, () => startGuide(S.steps.length));
      const li = add('floor', v.icon, v.title, v.detail, 0, () => startGuide(S.steps.length));
      if (v.photo) { const img = document.createElement('img'); img.className = 'step-photo'; img.src = v.photo; img.alt = v.photoAlt; img.loading = 'lazy'; li.querySelector('button').appendChild(img); }
    } else add('end', 'flag', `Llegas a ${d.name}`, 'Destino', 0, () => startGuide(S.steps.length));
  }
  $('peekTitle').textContent = r && r.total ? d.short : '¿A dónde vas?';
  $('peekMeta').textContent = r && r.total ? `${Math.round(r.total)} m · ~${minutes(r.total)} min a pie` : 'Elige un destino';
}

/* ---- guía paso a paso ---- */
let walkerTween = null;
function stepPts(i) { const s = S.steps[i]; return routePoints(S.route.path.slice(s.a, s.b + 1)); }
function currentGuideRig() {
  const i = S.guide.i;
  if (i >= S.steps.length) { const n = S.nodes.get(S.placeById.get(S.dest).nodeId); return rigFor([[n.x - 30, n.y - 30], [n.x + 30, n.y + 30]], { margin: 1.2 }); }
  const pts = stepPts(i); const a = pts[0], b = pts[pts.length - 1];
  return rigFor(pts, { margin: 1.7, minR: 55, az: S.view === '3d' ? Math.atan2(-(b[0] - a[0]), -(b[1] - a[1])) : 0 });
}
function startGuide(i = 0) {
  if (!S.steps.length) return;
  S.guide.active = true; $('guideCard').hidden = false; $('sheet').dataset.snap = 'peek'; setSnapVar('peek');
  walker.visible = true; walker.children[0].position.y = 0;
  goGuide(clamp(i, 0, S.steps.length), true);
}
function goGuide(i, instant = false) {
  const n = S.steps.length, arrive = i >= n; S.guide.i = i;
  $('guideStepLabel').textContent = arrive ? 'Llegada' : `Paso ${i + 1} de ${n}`;
  $('guideProgress').style.width = `${(i / n) * 100}%`;
  $('btnGuidePrev').disabled = i === 0; $('btnGuideNext').textContent = arrive ? 'Terminar' : i === n - 1 ? 'Llegar' : 'Siguiente';
  $('guideIcon').className = 'guide-icon' + (arrive ? ' arrive' : '');
  if (arrive) {
    const d = S.placeById.get(S.dest); $('guideIcon').innerHTML = icon('flag');
    if (d.room) {
      const v = verticalStep(d);
      $('guideTitle').textContent = `¡Llegaste ${alLugar(d.room.building.name)}!`;
      $('guideDetail').innerHTML = `${esc(v.title)}. ${esc(v.detail)}${v.photo ? `<img class="guide-photo" src="${esc(v.photo)}" alt="${esc(v.photoAlt)}">` : ''}`;
    }
    else { $('guideTitle').textContent = `¡Llegaste a ${d.short}!`; $('guideDetail').textContent = `Recorriste unos ${Math.round(S.route.total)} m.`; }
  }
  else { const s = S.steps[i]; $('guideIcon').innerHTML = icon('arrow', s.turn.rot ? `transform:rotate(${s.turn.rot}deg)` : ''); $('guideTitle').textContent = s.turn.text; $('guideDetail').textContent = `${Math.round(s.meters)} m${s.arrive ? ` · llegas a ${s.arrive.short}` : ''}`; }
  if (guideGroup) { world.remove(guideGroup); disposeGroup(guideGroup); guideGroup = null; }
  if (!arrive) { const p = stepPts(i); guideGroup = new THREE.Group(); guideGroup.add(ribbon(p, 12.5, 1.9, guideCaseMat), ribbon(p, 8, 2.3, guideMat)); world.add(guideGroup); }
  if (walkerTween) walkerTween.cancel();
  const pts = arrive ? null : stepPts(i); const tgt = arrive ? (() => { const nn = S.nodes.get(S.placeById.get(S.dest).nodeId); return [nn.x, nn.y]; })() : pts[0];
  const from = [walker.position.x, walker.position.z], run = (t) => walker.position.set(from[0] + (tgt[0] - from[0]) * ease(t), 0, from[1] + (tgt[1] - from[1]) * ease(t));
  if (instant) { walker.position.set(tgt[0], 0, tgt[1]); } else walkerTween = tween(900, run, arrive ? celebrate : null);
  applyViewOffset(); flyTo(currentGuideRig(), instant ? 1000 : 1100);
}
function exitGuide(silent) {
  if (!S.guide.active) return;
  S.guide.active = false; $('guideCard').hidden = true; if (walkerTween) walkerTween.cancel();
  if (guideGroup) { world.remove(guideGroup); disposeGroup(guideGroup); guideGroup = null; }
  applyScheme();
  if (!silent) { setSnap('half'); walkerT0 = performance.now(); focusRoute(1000, 'half'); }
}
$('btnStartGuide').addEventListener('click', () => startGuide(0));
$('btnGuideNext').addEventListener('click', () => { if (S.guide.i >= S.steps.length) exitGuide(false); else goGuide(S.guide.i + 1); });
$('btnGuidePrev').addEventListener('click', () => { if (S.guide.i > 0) goGuide(S.guide.i - 1); });
$('btnGuideExit').addEventListener('click', () => exitGuide(false));

function celebrate() {
  if (reduceMotion.matches) return;
  const n = S.nodes.get(S.placeById.get(S.dest).nodeId), cols = [0x005289, 0xffcc00, 0x009dc4], parts = [];
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.6 + Math.random(), 8, 6), new THREE.MeshBasicMaterial({ color: cols[i % 3], transparent: true }));
    m.position.set(n.x, 30, n.y); world.add(m);
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 40; parts.push({ m, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 40 + Math.random() * 50 });
  }
  const t0 = performance.now();
  const tick = (now) => { const t = (now - t0) / 1300; parts.forEach((p) => { p.m.position.x += p.vx * 0.016; p.m.position.z += p.vz * 0.016; p.vy -= 110 * 0.016; p.m.position.y = Math.max(1, p.m.position.y + p.vy * 0.016); p.m.material.opacity = 1 - t; }); if (t < 1) requestAnimationFrame(tick); else parts.forEach((p) => { world.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); }); };
  requestAnimationFrame(tick);
}

/* ---- selección de origen / destino ---- */
function fillSelects() {
  const byName = (a, b) => a.name.localeCompare(b.name, 'es', { numeric: true });
  const groups = [['Lugares', S.places.filter((p) => !p.room).sort(byName)]];
  const roomBuildings = [...new Set(S.places.filter((p) => p.room).map((p) => p.room.building))];
  roomBuildings.forEach((b) => groups.push([`Aulas · ${b.name}`, S.places.filter((p) => p.room && p.room.building === b).sort((x, y) => x.room.floor - y.room.floor || byName(x, y))]));
  for (const sel of [$('selectOrigin'), $('selectDestination')]) {
    sel.innerHTML = '';
    groups.forEach(([label, list]) => {
      const og = document.createElement('optgroup'); og.label = label;
      list.forEach((p) => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.room ? roomLabel(p) : p.name; og.appendChild(o); });
      sel.appendChild(og);
    });
  }
  $('selectOrigin').value = S.origin; $('selectDestination').value = S.dest;
}
function setOrigin(id) { if (!S.placeById.has(id)) return; S.origin = id; $('selectOrigin').value = id; showTab('route'); recalc(); }
function setDest(id) {
  if (!S.placeById.has(id)) return;
  if (![...$('selectDestination').options].some((o) => o.value === id)) fillSelects(); // destinos creados al vuelo (bloque + piso)
  S.dest = id; $('selectDestination').value = id; showTab('route'); if (!isDesktop.matches && $('sheet').dataset.snap === 'peek') setSnap('half'); recalc(); }
$('selectOrigin').addEventListener('change', (e) => { S.origin = e.target.value; recalc(); });
$('selectDestination').addEventListener('change', (e) => { S.dest = e.target.value; recalc(); });
$('chkAccesible').addEventListener('change', (e) => {
  S.accessible = e.target.checked; recalc();
  toast(S.accessible ? 'Ruta accesible: se evitan escaleras y se indica el ascensor.' : 'Se permiten escaleras.');
});
$('btnSwap').addEventListener('click', () => { [S.origin, S.dest] = [S.dest, S.origin]; $('selectOrigin').value = S.origin; $('selectDestination').value = S.dest; recalc(); });

/* ====================================================================
 * Hoja inferior (celular) y pestañas
 * ==================================================================== */
const PEEK_H = 132;
function setSnapVar(snap) { if (isDesktop.matches) return; const t = sheetTops(); $('sheet').style.setProperty('--ty', (t[snap] - t.full) + 'px'); }
function setSnap(snap) { $('sheet').dataset.snap = snap; setSnapVar(snap); applyViewOffset(snap); }
let sd = null;
function sdown(e) { if (isDesktop.matches) return; sd = { y0: e.clientY, ty0: parseFloat(getComputedStyle($('sheet')).getPropertyValue('--ty')) || 0, moved: false, last: e.clientY, lt: performance.now(), v: 0 }; e.currentTarget.setPointerCapture(e.pointerId); }
function smove(e) { if (!sd) return; const dy = e.clientY - sd.y0; if (Math.abs(dy) > 4) { sd.moved = true; $('sheet').classList.add('dragging'); } if (!sd.moved) return; const t = sheetTops(); $('sheet').style.setProperty('--ty', clamp(sd.ty0 + dy, 0, t.peek - t.full) + 'px'); const now = performance.now(); sd.v = (e.clientY - sd.last) / Math.max(1, now - sd.lt); sd.last = e.clientY; sd.lt = now; }
function sup() {
  if (!sd) return; const d = sd; sd = null; $('sheet').classList.remove('dragging');
  const t = sheetTops(), cur = $('sheet').dataset.snap;
  if (!d.moved) setSnap(cur === 'peek' ? 'half' : cur === 'half' ? 'full' : 'half');
  else { const top = $('sheet').getBoundingClientRect().top + d.v * 160; setSnap(['full', 'half', 'peek'].reduce((a, b) => (Math.abs(t[a] - top) < Math.abs(t[b] - top) ? a : b))); }
  setTimeout(() => { if (!S.guide.active) focusRoute(700); }, 460);
}
[$('sheetHandle'), $('peek')].forEach((el) => { el.addEventListener('pointerdown', sdown); el.addEventListener('pointermove', smove); el.addEventListener('pointerup', sup); el.addEventListener('pointercancel', sup); });

const TABS = { route: ['tabRoute', 'panelRoute'], events: ['tabEvents', 'panelEvents'], chat: ['tabChat', 'panelChat'] };
function showTab(which) {
  for (const [key, [tab, panel]] of Object.entries(TABS)) {
    const on = key === which;
    $(tab).classList.toggle('active', on); $(tab).setAttribute('aria-selected', on); $(panel).hidden = !on;
  }
}
$('tabRoute').addEventListener('click', () => { showTab('route'); if (!isDesktop.matches && $('sheet').dataset.snap === 'peek') setSnap('half'); });
$('tabEvents').addEventListener('click', () => { showTab('events'); if (!isDesktop.matches) setSnap('full'); });
$('tabChat').addEventListener('click', () => { showTab('chat'); if (!isDesktop.matches) setSnap('full'); $('chatInput').focus({ preventScroll: true }); });

/* ====================================================================
 * Buscador unificado: aulas, bloques, lugares y eventos
 * ==================================================================== */
const squash = (s) => norm(s).replace(/\b(aula|ambiente|salon|el|la|del|de|bloque|edificio)\b/g, ' ').replace(/[\s-]+/g, '');
const dropZeros = (s) => s.replace(/(\D)0+(\d)/g, '$1$2').replace(/^0+(\d)/, '$1');

function searchItems() {
  const items = S.places.map((p) => {
    const keys = new Set();
    if (p.room) {
      const c = squash(p.room.code); keys.add(c); keys.add(dropZeros(c));
      const digits = p.room.code.replace(/\D/g, ''); keys.add(digits); keys.add(dropZeros(digits));
    } else {
      keys.add(squash(p.name)); (ALIASES[p.id] || []).forEach((a) => keys.add(squash(a)));
      const letter = /^Bloque ([A-L])/.exec(p.name); if (letter) keys.add(letter[1].toLowerCase());
    }
    return {
      kind: p.room ? 'aula' : 'lugar', place: p, keys: [...keys].filter(Boolean),
      title: p.room ? p.room.code : p.name,
      badge: p.room ? ({ laboratorio: 'Lab', auditorio: 'Auditorio', capilla: 'Capilla' }[p.room.tipo] || 'Aula') : 'Lugar',
      sub: p.room ? `${p.room.building.name}${p.room.zonaCorta ? ' · ' + p.room.zonaCorta : ''} · ${floorName(p.room.building, p.room.floor)}` : p.provisional ? 'Punto de referencia (provisional)' : 'Bloque del campus'
    };
  });
  S.events.forEach((ev) => items.push({ kind: 'evento', ev, keys: [squash(ev.titulo)], title: ev.titulo, sub: `${ev.fechaTexto}${ev.place ? ' · ' + ev.place.short : ' · ubicación por confirmar'}` }));
  return items;
}

function rank(q, item) {
  if (!q) return 0;
  const qz = dropZeros(q);
  let best = 0;
  for (const k of item.keys) {
    if (k === q || k === qz) best = Math.max(best, 100);
    else if (k.startsWith(q) || k.startsWith(qz)) best = Math.max(best, 70 - (k.length - q.length));
    else if (q.length >= 3 && k.includes(q)) best = Math.max(best, 40);
  }
  return best ? best + (item.kind === 'aula' && /\d/.test(q) ? 5 : 0) : 0;
}

let finderSel = -1, finderResults = [];
function renderFinder() {
  const raw = $('finderInput').value, q = squash(raw), list = $('finderList');
  if (!raw.trim()) { list.hidden = true; $('finderInput').parentElement.parentElement.setAttribute('aria-expanded', 'false'); return; }
  finderResults = searchItems().map((it) => ({ it, s: rank(q, it) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 8).map((r) => r.it);
  list.innerHTML = '';
  if (!finderResults.length) list.innerHTML = '<li class="fi-empty">Sin resultados. Prueba con «C201», «Teal 3» o «Biblioteca».</li>';
  finderResults.forEach((it, i) => {
    const li = document.createElement('li'); li.setAttribute('role', 'option'); li.setAttribute('aria-selected', i === finderSel);
    const badge = it.kind === 'aula' ? `<span class="fi-badge">${esc(it.badge)}</span>` : it.kind === 'evento' ? '<span class="fi-badge ev">Evento</span>' : '<span class="fi-badge bl">Lugar</span>';
    li.innerHTML = `${badge}<span><strong>${esc(it.title)}</strong><small>${esc(it.sub)}</small></span>`;
    li.addEventListener('mousedown', (e) => { e.preventDefault(); pickResult(it); });
    list.appendChild(li);
  });
  list.hidden = false; $('finderInput').parentElement.parentElement.setAttribute('aria-expanded', 'true');
}
function pickResult(it) {
  $('finderInput').value = ''; $('finderList').hidden = true; finderSel = -1;
  if (it.kind === 'evento') { if (it.ev.place) { setDest(it.ev.place.id); toast(`Ruta hacia «${it.ev.titulo}»`); } else toast('Ese evento todavía no tiene ubicación en el mapa.'); return; }
  setDest(it.place.id);
  if (it.place.room) toast(`${it.place.room.code}: ${it.place.room.building.name}, ${floorName(it.place.room.building, it.place.room.floor)}`);
}
$('finderInput').addEventListener('input', () => { finderSel = -1; renderFinder(); });
$('finderInput').addEventListener('keydown', (e) => {
  if ($('finderList').hidden) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); finderSel = Math.min(finderResults.length - 1, finderSel + 1); renderFinder(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); finderSel = Math.max(0, finderSel - 1); renderFinder(); }
  else if (e.key === 'Enter') { e.preventDefault(); const it = finderResults[Math.max(0, finderSel)]; if (it) pickResult(it); }
  else if (e.key === 'Escape') { $('finderList').hidden = true; }
});
$('finderInput').addEventListener('blur', () => setTimeout(() => { $('finderList').hidden = true; }, 120));

/* ====================================================================
 * Eventos (agenda). Se leen de campus/eventos.json con el formato de docs/agenda-integracion.md.
 * Si el lugar no trae un código claro, se intenta reconocer en el texto; si no, queda «por confirmar».
 * ==================================================================== */
function resolveLugar(lugar) {
  if (!lugar) return null;
  if (lugar.codigo) {
    const c = String(lugar.codigo).trim();
    const byRoom = S.placeById.get('aula:' + c.toUpperCase()) || S.places.find((p) => p.room && squash(p.room.code) === squash(c));
    if (byRoom) return byRoom;
    if (S.placeById.has(c)) return S.placeById.get(c);
  }
  if (lugar.texto) {
    const rooms = findRoomMentions(lugar.texto);
    if (rooms.length) return S.placeById.get(rooms[0].id);
    const blocks = findMentions(lugar.texto).filter((x) => S.placeById.get(x.id)?.building);
    if (blocks.length) {
      const b = S.placeById.get(blocks[0].id).building, floor = floorFromText(lugar.texto);
      return floor === null ? S.placeById.get(blocks[0].id) : floorPlace(b, floor);
    }
    const others = findMentions(lugar.texto);
    if (others.length) return S.placeById.get(others[0].id);
  }
  return null;
}

/** «5to. piso», «piso 3», «tercer piso», «planta baja» → número de nivel (0 = planta baja). */
function floorFromText(text) {
  const t = ` ${norm(text)} `;
  if (/planta baja|\bpb\b/.test(t)) return 0;
  let m = /\b(\d{1,2})\s*(?:er|ro|do|to|vo|no|mo|°|º)?\s*piso\b/.exec(t) || /\bpiso\s*(\d{1,2})\b/.exec(t);
  if (m) return parseInt(m[1], 10);
  const words = { primer: 1, primero: 1, segundo: 2, tercer: 3, tercero: 3, cuarto: 4, quinto: 5, sexto: 6, septimo: 7 };
  m = /\b(primer|primero|segundo|tercer|tercero|cuarto|quinto|sexto|septimo)\s+piso\b/.exec(t);
  return m ? words[m[1]] : null;
}

/* ---- Lectura de calendarios .ics (formato que ya exporta la agenda) ---- */
function parseIcsDate(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z*)$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m;
  const tzid = (params.find((p) => p.startsWith('TZID=')) || '').slice(5);
  // Con TZID manda la zona indicada aunque traiga una «Z» sobrante. La Paz es UTC−4 todo el año.
  if (tzid) return `${y}-${mo}-${d}T${h}:${mi}:${s}${tzid === 'America/La_Paz' ? '-04:00' : ''}`;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : ''}`;
}
function parseIcs(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = []; let cur = null, inAlarm = false;
  const unesc = (v) => v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) out.push(cur); cur = null; continue; }
    if (line === 'BEGIN:VALARM') { inAlarm = true; continue; }
    if (line === 'END:VALARM') { inAlarm = false; continue; }
    if (!cur || inAlarm) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';'); const value = line.slice(i + 1);
    if (name === 'UID') cur.id = value;
    else if (name === 'SUMMARY') cur.titulo = unesc(value);
    else if (name === 'DESCRIPTION') cur.descripcion = unesc(value);
    else if (name === 'LOCATION') cur.lugar = { texto: unesc(value) };
    else if (name === 'CATEGORIES') cur.categoria = unesc(value).split(',')[0];
    else if (name === 'URL') cur.url = value;
    else if (name === 'DTSTART') cur.inicio = parseIcsDate(value, params);
    else if (name === 'DTEND') cur.fin = parseIcsDate(value, params);
  }
  return out;
}

async function loadEvents() {
  let data = null;
  try { const r = await fetch('campus/eventos.json'); if (r.ok) data = await r.json(); } catch (_) { /* sin JSON */ }
  if (!data) {
    try { const r = await fetch('campus/eventos.ics'); if (r.ok) data = { eventos: parseIcs(await r.text()) }; } catch (_) { /* sin .ics */ }
  }
  const fmt = new Intl.DateTimeFormat('es-BO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  S.events = (data && Array.isArray(data.eventos) ? data.eventos : []).map((ev) => {
    const d = ev.inicio ? new Date(ev.inicio) : null;
    return { ...ev, fechaTexto: d && !isNaN(d) ? fmt.format(d) : 'Fecha por confirmar', place: resolveLugar(ev.lugar) };
  });
  renderEvents(!!data);
}
function renderEvents(connected) {
  const box = $('eventsList'); box.innerHTML = '';
  if (!S.events.length) {
    box.innerHTML = connected
      ? '<div class="empty-box"><strong>No hay eventos próximos</strong><br>La agenda está conectada, pero no trae eventos.</div>'
      : '<div class="empty-box"><strong>La agenda aún no está conectada</strong><br>Cuando agenda.lpz.ucb.edu.bo publique su lista de eventos (ver <code>docs/agenda-integracion.md</code>), aparecerán aquí con su ruta.</div>';
    return;
  }
  S.events.forEach((ev, i) => {
    const card = document.createElement('article'); card.className = 'event'; card.style.animationDelay = i * 60 + 'ms';
    card.innerHTML = `<div class="event-meta"><span class="event-tag">${esc(ev.categoria || 'Evento')}</span><span class="event-date">${esc(ev.fechaTexto)}</span></div>
      <h4>${esc(ev.titulo)}</h4>
      ${ev.place ? `<div class="event-place">${icon('pin')}<span>${esc(ev.place.room ? (ev.place.room.code ? `${ev.place.room.code} · ${ev.place.room.building.name}, ${floorName(ev.place.room.building, ev.place.room.floor)}` : roomLabel(ev.place)) : ev.place.name)}</span></div>` : `<p class="event-loc-missing">Ubicación por confirmar${ev.lugar && ev.lugar.texto ? `: «${esc(ev.lugar.texto)}»` : ''}</p>`}
      ${ev.descripcion ? `<p>${esc(ev.descripcion.split('\n')[0]).slice(0, 180)}</p>` : ''}
      <button class="btn btn-primary" type="button" ${ev.place ? '' : 'disabled'}>Cómo llegar</button>`;
    card.querySelector('button').addEventListener('click', () => { if (ev.place) setDest(ev.place.id); });
    box.appendChild(card);
  });
}

/* ====================================================================
 * Asistente de demostración (reglas simples, sin IA)
 * ==================================================================== */
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!.,;:“”"'«»()]/g, ' ').replace(/\s+/g, ' ').trim();

function findMentions(text) {
  const t = ` ${norm(text)} `, found = [];
  for (const [id, aliases] of Object.entries(ALIASES)) {
    for (const al of aliases) { const i = t.indexOf(` ${al} `); if (i >= 0) { found.push({ id, index: i, len: al.length }); break; } }
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Reconoce códigos de aula: «C201», «c-201», «Teal 3», «aula 304» (si el número es único). */
function findRoomMentions(text) {
  const t = ` ${norm(text)} `, out = [];
  const push = (code, index) => { const p = S.placeById.get('aula:' + code); if (p && !out.some((o) => o.id === p.id)) out.push({ id: p.id, index, room: true }); };
  for (const m of t.matchAll(/\b([a-l])\s?-?\s?(\d{3})\b/g)) push(m[1].toUpperCase() + m[2], m.index);
  for (const m of t.matchAll(/\b([a-l])-?(\d{1,2})\b/g)) push(m[1].toUpperCase() + m[2], m.index); // D1…D30
  for (const m of t.matchAll(/\bteal\s?-?\s?0*(\d{1,3})\b/g)) push('TEAL ' + m[1].padStart(3, '0'), m.index);
  for (const m of t.matchAll(/\b(?:aula|salon|ambiente)\s+(\d{3})\b/g)) {
    const hits = S.places.filter((p) => p.room && p.room.code && p.room.code.replace(/\D/g, '') === m[1]);
    if (hits.length === 1) push(hits[0].room.code, m.index);
  }
  // Ambientes con nombre propio (p. ej. «Paraninfo»), definidos con "alias" en el catálogo
  S.places.forEach((p) => {
    if (!p.room || !p.room.aliases) return;
    for (const al of p.room.aliases) { const i = t.indexOf(` ${al} `); if (i >= 0) { push(p.room.code, i); break; } }
  });
  return out.sort((a, b) => a.index - b.index);
}

const log = $('chatLog');
function addMsg(html, who = 'bot') { const d = document.createElement('div'); d.className = `msg ${who}`; if (who === 'user') d.textContent = html; else d.innerHTML = html; log.appendChild(d); log.scrollIntoView({ block: 'end' }); $('sheetBody').scrollTop = $('sheetBody').scrollHeight; return d; }
function botSay(builder, delay = 520) {
  const t = document.createElement('div'); t.className = 'msg bot'; t.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>'; log.appendChild(t); $('sheetBody').scrollTop = $('sheetBody').scrollHeight;
  setTimeout(() => { t.remove(); builder(); $('sheetBody').scrollTop = $('sheetBody').scrollHeight; }, reduceMotion.matches ? 0 : delay);
}
function routeCard(o, d, r) {
  const steps = buildSteps(r.path, d), card = document.createElement('div'); card.className = 'route-card';
  const items = steps.slice(0, 3).map((s) => `<li>${esc(s.turn.text)} · ${Math.round(s.meters)} m</li>`).join('') + (steps.length > 3 ? `<li>… y ${steps.length - 3} más</li>` : '');
  card.innerHTML = `<div class="rc-top"><span class="rc-m">${Math.round(r.total)} m</span><span class="rc-t">~${minutes(r.total)} min a pie</span></div><ol>${items}</ol><button class="btn btn-primary" type="button">Ver en el mapa</button>`;
  card.querySelector('button').addEventListener('click', () => { S.origin = o.id; S.dest = d.id; $('selectOrigin').value = o.id; $('selectDestination').value = d.id; showTab('route'); if (!isDesktop.matches) setSnap('half'); recalc(); });
  log.appendChild(card);
}
function reply(text) {
  const t = norm(text);
  if (/accesib|silla de ruedas|sin escaleras|sin gradas|discapacidad|movilidad reducida/.test(t) && !S.accessible) {
    S.accessible = true; $('chkAccesible').checked = true;
    addMsg('Activé la <strong>ruta accesible</strong>: evito escaleras y, si hay que subir de piso, te indico el ascensor.');
  }
  const rooms = findRoomMentions(text);
  const roomBuildings = new Set(rooms.map((r) => S.placeById.get(r.id).room.building.id));
  const m = [...rooms, ...findMentions(text).filter((x) => !roomBuildings.has(x.id))].sort((a, b) => a.index - b.index);
  if (/\b(hola|buenas|buenos dias|buenas tardes|hey)\b/.test(t) && !m.length) return botSay(() => addMsg('¡Hola! Dime a dónde quieres ir, por ejemplo: <strong>«¿Cómo llego a la Biblioteca?»</strong>.'));
  if (/\b(gracias|genial|perfecto)\b/.test(t) && !m.length) return botSay(() => addMsg('¡Con gusto! Si necesitas otra ruta, aquí estoy.'));
  if (/\b(ayuda|que puedes|como funcionas)\b/.test(t)) return botSay(() => addMsg('Puedo trazar rutas a bloques y aulas («llévame a la C201», «estoy en el Ingreso, voy a la Teal 3»), decirte en qué piso está un aula («¿dónde queda la C304?») y recordarte dónde estás. Soy una <strong>demostración con reglas simples</strong>: más adelante usaré un modelo de lenguaje.'));
  if (/donde estoy|mi ubicacion|donde me encuentro/.test(t)) return botSay(() => addMsg(`Según lo que me dijiste, estás en <strong>${esc(S.placeById.get(S.origin).name)}</strong>. Puedes cambiarlo diciendo «estoy en …».`));
  if (!m.length) return botSay(() => { addMsg('No encontré ese lugar. Conozco: <strong>Bloques A–L, Biblioteca, Cafetería, Atrio, Ingreso y las aulas del Bloque C</strong> (Teal 001–005, C101–C404). Prueba con «¿Dónde queda la C201?».'); });

  const cueOrigin = /(desde|estoy en|estoy|me encuentro en|parto de|partiendo de)\s*(el|la|los|las)?\s*$/;
  const tn = norm(text);
  let origin = null, dest = null;
  m.forEach((x) => { const before = ` ${tn} `.slice(Math.max(0, x.index - 24), x.index + 1); if (cueOrigin.test(before.trimEnd() + ' ') || cueOrigin.test(before)) origin = x.id; else dest = x.id; });
  const info = /(que es|que hay|informacion|info|cuentame|cuantos pisos)/.test(t);
  if (info && m.length === 1) {
    const p = S.placeById.get(m[0].id);
    if (p.room) return botSay(() => addMsg(`<strong>${esc(p.room.code)}</strong> es un aula del <strong>${esc(p.room.building.name)}</strong>, en <strong>${esc(floorName(p.room.building, p.room.floor))}</strong>. Si quieres, dime «llévame a la ${esc(p.room.code)}».`));
    return botSay(() => addMsg(p.building ? `<strong>${esc(p.name)}</strong>: ${p.building.floors} pisos (dato provisional). Su acceso más cercano en el grafo es el Nodo ${S.nodes.get(p.building.access).n}.` : `<strong>${esc(p.name)}</strong> es un punto de referencia provisional del mapa.`));
  }
  if (origin && !dest) { S.origin = origin; $('selectOrigin').value = origin; return botSay(() => { addMsg(`Anotado: estás en <strong>${esc(S.placeById.get(origin).name)}</strong>. ¿A dónde quieres ir?`); recalc({ fly: false }); }); }
  const roomDest = m.filter((x) => x.room && x.id !== origin).pop();
  if (roomDest) dest = roomDest.id;
  if (!dest) dest = m[m.length - 1].id;
  const o = S.placeById.get(origin || S.origin), d = S.placeById.get(dest);
  if (o.id === d.id) return botSay(() => addMsg(`Ya estás en <strong>${esc(d.name)}</strong>. ¿A dónde más quieres ir?`));
  const r = dijkstra(o.nodeId, d.nodeId);
  botSay(() => {
    if (!r) return addMsg('No encontré un camino entre esos lugares en el mapa actual.');
    const where = d.room ? ` El aula está en el <strong>${esc(d.room.building.name)}</strong>, <strong>${esc(floorName(d.room.building, d.room.floor))}</strong>.` : '';
    addMsg(`De <strong>${esc(o.short)}</strong> a <strong>${esc(d.room ? d.room.code : d.short)}</strong> son unos <strong>${Math.round(r.total)} m</strong> (~${minutes(r.total)} min) hasta la entrada.${where}${origin ? '' : `<small>Salgo desde ${esc(o.short)}. Si estás en otro sitio, dime «estoy en …».</small>`}`);
    routeCard(o, d, r);
  });
}
/* ====================================================================
 * Ubicarme con una foto (modelo de Teachable Machine, corre en el teléfono)
 * ==================================================================== */
const modalFoto = $('modalFoto');
modalFoto.addEventListener('click', (e) => { if (e.target === modalFoto || e.target.closest('[data-close]')) modalFoto.hidden = true; });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') modalFoto.hidden = true; });
$('btnFoto').addEventListener('click', () => $('fotoInput').click());
$('fotoInput').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) runPhoto(f); });

async function runPhoto(file) {
  modalFoto.hidden = false;
  const prev = $('fotoPreview'); if (prev.dataset.url) URL.revokeObjectURL(prev.dataset.url);
  prev.dataset.url = URL.createObjectURL(file); prev.src = prev.dataset.url;
  $('fotoEstado').textContent = 'Analizando la foto… (la primera vez carga el modelo)';
  $('fotoResultados').innerHTML = ''; $('fotoAcciones').innerHTML = '';
  try { showPhotoResults(await classify(file)); }
  catch (err) { console.error(err); $('fotoEstado').textContent = `No pude analizar la foto: ${err.message}`; }
}

function photoAction(label, primary, fn) {
  const b = document.createElement('button'); b.type = 'button'; b.className = `btn ${primary ? 'btn-primary' : 'btn-ghost'}`; b.textContent = label;
  b.addEventListener('click', fn); $('fotoAcciones').appendChild(b); return b;
}

function showPhotoResults(res) {
  const { umbral, margen } = thresholds(), [a, b] = res;
  const box = $('fotoResultados');
  res.slice(0, 3).forEach((r, i) => {
    const row = document.createElement('div'); row.className = 'foto-row' + (i === 0 ? ' top' : '');
    row.innerHTML = `<strong>${esc(r.nombre)}</strong><span>${Math.round(r.prob * 100)}%</span>${r.lugar ? '' : '<small>Aún no está en el mapa</small>'}<div class="bar"><span></span></div>`;
    box.appendChild(row);
    requestAnimationFrame(() => { row.querySelector('.bar span').style.width = `${(r.prob * 100).toFixed(1)}%`; });
  });
  const sure = a.prob >= umbral && a.prob - b.prob >= margen;
  const goFrom = (r) => { modalFoto.hidden = true; setOrigin(r.lugar); toast(`Partes desde ${S.placeById.get(r.lugar).short}.`); };
  if (sure && a.lugar) {
    $('fotoEstado').innerHTML = `<span class="foto-verdict">Estás junto a ${esc(a.nombre)}</span>`;
    photoAction('Sí, salir de aquí', true, () => goFrom(a));
    photoAction('No es aquí', false, () => { $('fotoAcciones').innerHTML = ''; $('fotoEstado').textContent = '¿Dónde estás?'; res.filter((r) => r.lugar).slice(0, 3).forEach((r) => photoAction(r.nombre, false, () => goFrom(r))); });
  } else if (sure && !a.lugar) {
    $('fotoEstado').innerHTML = `<span class="foto-verdict">Parece «${esc(a.nombre)}»</span><br>Ese lugar todavía no está en el mapa. Elige tu punto de partida en la lista.`;
    photoAction('Entendido', true, () => { modalFoto.hidden = true; });
  } else {
    $('fotoEstado').innerHTML = '<span class="foto-verdict">No estoy seguro</span><br>¿Estás en alguno de estos lugares? También puedes tomar otra foto, con el edificio de frente y más luz.';
    res.filter((r) => r.lugar).slice(0, 2).forEach((r, i) => photoAction(r.nombre, i === 0, () => goFrom(r)));
    photoAction('Otra foto', false, () => $('fotoInput').click());
  }
}

/* ---- Asistente con IA (Groq, a través de server/servidor.mjs). Si no está disponible, se usan las reglas. ---- */
const chatAI = { on: false, model: null, history: [] };
async function checkAI() {
  try { const r = await fetch('/api/salud', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); chatAI.on = !!j.ia; chatAI.model = j.modelo; } } catch (_) { /* sin servidor */ }
  $('chatStatus').innerHTML = chatAI.on
    ? `<span class="dot on"></span> Asistente con IA · Groq (${esc(chatAI.model)}). Elige lugares solo del mapa.`
    : '<span class="dot"></span> Modo sin IA (reglas simples). Para usar Groq, abre la app con <code>node server/servidor.mjs</code> y pon la clave en <code>server/.env</code>.';
}
async function replyAI(text) {
  const t = document.createElement('div'); t.className = 'msg bot'; t.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>'; log.appendChild(t);
  $('sheetBody').scrollTop = $('sheetBody').scrollHeight;
  try {
    const r = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensaje: text, historial: chatAI.history.slice(-6), contexto: { origen: S.origin, accesible: S.accessible } })
    });
    const out = await r.json();
    if (!r.ok) throw new Error(out.error || `Error ${r.status}`);
    t.remove();
    addMsg(esc(out.respuesta)); // la respuesta de la IA se muestra como texto, nunca como HTML
    if (out.descartada) addMsg('<small>Ese lugar no está en el mapa, así que no tracé ninguna ruta. Prueba con un bloque, un aula o la Biblioteca.</small>');
    chatAI.history.push({ rol: 'usuario', texto: text }, { rol: 'asistente', texto: out.respuesta });
    const a = out.accion;
    if (a && a.tipo === 'accesible') { S.accessible = !!a.valor; $('chkAccesible').checked = S.accessible; recalc({ fly: false }); }
    if (a && a.tipo === 'ruta') {
      const o = S.placeById.get(a.origen || S.origin), d = S.placeById.get(a.destino);
      if (o && d && o.id !== d.id) { const rr = dijkstra(o.nodeId, d.nodeId); if (rr) routeCard(o, d, rr); else addMsg('No encontré un camino entre esos lugares en el mapa actual.'); }
    }
    if (a && a.tipo === 'info') { const p = S.placeById.get(a.lugar); if (p && p.room) addMsg(`<small>${esc(roomLabel(p))} · ${esc(p.room.building.name)}</small>`); }
  } catch (err) {
    t.remove();
    addMsg(`<small>La IA no respondió (${esc(err.message)}). Te respondo con las reglas simples.</small>`);
    reply(text);
  }
  $('sheetBody').scrollTop = $('sheetBody').scrollHeight;
}
const ask = (v) => (chatAI.on ? replyAI(v) : reply(v));
$('chatForm').addEventListener('submit', (e) => { e.preventDefault(); const v = $('chatInput').value.trim(); if (!v) return; addMsg(v, 'user'); $('chatInput').value = ''; ask(v); });
const CHIPS = ['¿Dónde queda la C201?', 'Estoy en el Ingreso, llévame a la Teal 3', '¿Cómo llego a la Biblioteca?', '¿Qué es la C304?'];
CHIPS.forEach((c) => { const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.textContent = c; b.addEventListener('click', () => { addMsg(c, 'user'); ask(c); }); $('chatChips').appendChild(b); });
addMsg('Hola, soy el asistente de <strong>aLocateUCB</strong>. <small>Demostración con reglas simples, sin IA todavía: entiendo frases como «¿cómo llego a la Biblioteca?».</small>');

/* ====================================================================
 * Bucle de dibujo, tamaño y arranque
 * ==================================================================== */
function resize() {
  const W = window.innerWidth, H = window.innerHeight;
  renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); applyViewOffset();
  if (!flight) applyScheme();
}
window.addEventListener('resize', () => { setSnapVar($('sheet').dataset.snap); resize(); });
isDesktop.addEventListener('change', () => { setSnap($('sheet').dataset.snap); resize(); });

function frame(now) {
  requestAnimationFrame(frame);
  if (!flight) controls.update();
  clampTarget();
  // Marcadores: tamaño legible a cualquier distancia
  const k = clamp(camera.position.distanceTo(controls.target) / 420, 0.75, 2.6);
  if (markers.origin) { markers.origin.scale.setScalar(k); const p = (now % 2000) / 2000; markers.origin.userData.ring.scale.setScalar(1 + p * 1.8); markers.origin.userData.ring.material.opacity = 0.55 * (1 - p); }
  if (markers.dest) {
    const u = markers.dest.userData;
    markers.dest.scale.setScalar(k);
    u.body.position.y = Math.abs(Math.sin(now / 420)) * 4;
    u.body.rotation.y = now / 1400;
    u.rings.forEach((r, i) => { const p = ((now / 1800) + i * 0.5) % 1; r.scale.setScalar(1 + p * 2.2); r.material.opacity = 0.6 * (1 - p); });
    u.beam.visible = rise > 0.5; // el haz de luz solo en 3D, para ubicar el destino desde lejos
    u.beam.material.opacity = 0.12 + Math.sin(now / 500) * 0.04;
  }
  if (markers.origin) markers.origin.userData.person.position.y = 1.9 + Math.abs(Math.sin(now / 900)) * 0.6;
  if (walker) walker.scale.setScalar(k);
  // Niebla suave: en 3D lo lejano se funde con el fondo (no se "ve" más allá del campus)
  if (scene.fog) { const dd = camera.position.distanceTo(controls.target); scene.fog.near = dd * 0.95; scene.fog.far = dd * 2.1; }
  updateRouteReveal(now); updateWalker(now); updateLabels();
  renderer.render(scene, camera);
}

async function boot() {
  try { await loadData(); } catch (e) { $('loading').textContent = 'Abre esta página con un servidor local (python -m http.server) para cargar el mapa.'; console.error(e); return; }
  const texture = await new Promise((res) => new THREE.TextureLoader().load('campus/plano.png', (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); res(t); }, undefined, () => res(null)));
  setupLights(); buildBase(texture); buildBuildings(); applyRise(); buildGraphLines();
  scene.fog = new THREE.Fog(0xe3eef4, 800, 2400);
  loadEvents(); checkAI();
  markers.origin = makeOriginMarker(); markers.dest = makePinMarker(); walker = makeWalker(); world.add(markers.origin, markers.dest, walker);
  fillSelects(); resize(); setSnap(isDesktop.matches ? 'half' : 'half');
  // Vista inicial: todo el campus en 2D, y luego la cámara vuela hasta la ruta
  const r = rigFor(allPts(), { margin: 0.8 }); camera.position.set(r.target.x, r.dist, r.target.z + 0.01); controls.target.copy(r.target); camera.lookAt(r.target); applyScheme();
  recalc({ fly: false });
  $('loading').classList.add('done'); setTimeout(() => $('loading').remove(), 700);
  setTimeout(() => focusRoute(1200), 700);
  requestAnimationFrame(frame);
  window.__alocate = { S, setView, camera, controls };
}
boot();
