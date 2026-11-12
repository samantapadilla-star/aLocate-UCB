/**
 * aLocateUCB · Lógica de la aplicación (diseño "mapa primero")
 * ============================================================
 * - Cámara del mapa con zoom (rueda / pellizco) y desplazamiento táctil o con ratón
 * - Dijkstra con filtro de accesibilidad
 * - Ruta animada, guía paso a paso con giros (izquierda / derecha / recto)
 * - Hoja inferior arrastrable en celular, columna lateral en escritorio
 * - Eventos, simulación de QR, carga de grafo en JSON, recorrido de ayuda
 *
 * Los datos del mapa (nodos, aristas, eventos) viven en graph-data.js.
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WALK_M_PER_MIN = 75; // velocidad peatonal promedio
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const isDesktop = window.matchMedia('(min-width: 900px)');
  const $ = (id) => document.getElementById(id);

  const state = {
    nodes: {}, edges: [], buildings: [], events: [],
    bounds: { width: 900, height: 560 },
    origin: 'entrada', destination: 'coliseo',
    accessibleOnly: false, category: 'all', query: '',
    route: null,
    guide: { active: false, index: 0 },
    popNode: null
  };

  const dom = {
    container: $('mapContainer'), svg: $('campusSvg'),
    layerBuildings: $('layerBuildings'), layerWalkways: $('layerWalkways'), layerRoute: $('layerRoute'),
    layerNodes: $('layerNodes'), layerWalker: $('layerWalker'), layerFx: $('layerFx'),
    pop: $('nodePop'), popName: $('popName'), popDesc: $('popDesc'), popCat: $('popCat'),
    sheet: $('sheet'), sheetHandle: $('sheetHandle'), peek: $('peek'), peekTitle: $('peekTitle'), peekMeta: $('peekMeta'),
    tabRoute: $('tabRoute'), tabEvents: $('tabEvents'), panelRoute: $('panelRoute'), panelEvents: $('panelEvents'),
    selOrigin: $('selectOrigin'), selDest: $('selectDestination'), btnSwap: $('btnSwap'), checkAcc: $('checkAccessible'),
    resultBox: $('resultBox'), txtMeters: $('txtMeters'), txtEta: $('txtEta'), accBadge: $('accBadge'), txtNote: $('txtNote'),
    steps: $('stepsList'), btnStartGuide: $('btnStartGuide'),
    guideCard: $('guideCard'), guideIcon: $('guideIcon'), guideTitle: $('guideTitle'), guideDetail: $('guideDetail'),
    guideStepLabel: $('guideStepLabel'), guideProgress: $('guideProgress'),
    btnGuidePrev: $('btnGuidePrev'), btnGuideNext: $('btnGuideNext'), btnGuideExit: $('btnGuideExit'),
    search: $('inputSearchEvents'), filterBar: $('categoryFilterBar'), events: $('eventsGrid'),
    toast: $('toast'), qrChips: $('qrChipsContainer'), json: $('txtGraphJson')
  };

  /* ====================================================================
   * Utilidades
   * ==================================================================== */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function svgEl(tag, attrs = {}, text = null) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== null) el.textContent = text;
    return el;
  }

  const ICONS = {
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>',
    arrow: '<path d="M12 19V5m-6 6l6-6 6 6"/>',
    stairs: '<path d="M4 20h4v-4h4v-4h4V8h4"/>',
    elevator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 10l3-3 3 3M9 14l3 3 3-3"/>',
    ramp: '<path d="M3 19h18V9L3 19z"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    swap: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    'chevron-up': '<path d="M6 15l6-6 6 6"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h3v3m3 0v3h-3m-3-3v3"/>',
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    upload: '<path d="M12 16V5m-4 4l4-4 4 4M5 19h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
  };
  const icon = (name, extraStyle = '') =>
    `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extraStyle ? ` style="${extraStyle}"` : ''}>${ICONS[name] || ''}</svg>`;

  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

  let toastTimer = 0;
  function toast(msg, ms = 3200) {
    dom.toast.textContent = msg;
    dom.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('show'), ms);
  }

  function tween(ms, onUpdate, onDone) {
    if (reduceMotion.matches) { onUpdate(1); if (onDone) onDone(); return { cancel() {} }; }
    let raf = 0, cancelled = false;
    const t0 = performance.now();
    const tick = (now) => {
      if (cancelled) return;
      const t = clamp((now - t0) / ms, 0, 1);
      onUpdate(t);
      if (t < 1) raf = requestAnimationFrame(tick); else if (onDone) onDone();
    };
    raf = requestAnimationFrame(tick);
    return { cancel() { cancelled = true; cancelAnimationFrame(raf); } };
  }

  /* ====================================================================
   * Cámara del mapa
   *   cam.s = píxeles de pantalla por unidad del mapa; (cx, cy) = centro en unidades del mapa.
   *   El viewBox se calcula siempre con la proporción real del contenedor, así
   *   las coordenadas del plano nunca se deforman al cambiar el tamaño de la ventana.
   * ==================================================================== */
  const cam = { s: 1, cx: 450, cy: 280 };
  let W = 1, H = 1, flyTween = null;

  function applyCam() {
    const vw = W / cam.s, vh = H / cam.s;
    dom.svg.setAttribute('viewBox', `${cam.cx - vw / 2} ${cam.cy - vh / 2} ${vw} ${vh}`);
    dom.svg.style.setProperty('--k', (1 / cam.s).toFixed(5));
    if (state.popNode) positionPop();
  }

  function onResize() {
    W = dom.container.clientWidth || 1;
    H = dom.container.clientHeight || 1;
    applyCam();
  }
  new ResizeObserver(onResize).observe(dom.container);

  /** Espacio libre del mapa descontando el panel (para encuadrar sin que lo tape). */
  function mapPadding(snap) {
    const guideH = state.guide.active ? dom.guideCard.offsetHeight + 24 : 0;
    if (isDesktop.matches) {
      const r = dom.sheet.getBoundingClientRect();
      return { l: r.right + 24, t: 24, r: 72, b: 24 + guideH };
    }
    const visible = H - sheetTop(snap || dom.sheet.dataset.snap);
    return { l: 20, t: 88, r: 70, b: visible + 20 + guideH };
  }

  function boundsCamera(b, pad, maxScale) {
    const aw = Math.max(60, W - pad.l - pad.r), ah = Math.max(60, H - pad.t - pad.b);
    let s = Math.min(aw / Math.max(b.w, 1), ah / Math.max(b.h, 1));
    s = Math.min(s, maxScale || Infinity);
    const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    const sx = pad.l + aw / 2, sy = pad.t + ah / 2;
    return { s, cx: bcx - sx / s + W / (2 * s), cy: bcy - sy / s + H / (2 * s) };
  }

  const fitScale = () => boundsCamera({ x: 0, y: 0, w: state.bounds.width, h: state.bounds.height }, mapPadding(), Infinity).s;
  const minScale = () => fitScale() * 0.6;
  const maxScale = () => fitScale() * 8;

  function flyTo(target, ms = 800) {
    if (flyTween) flyTween.cancel();
    const from = { ...cam };
    const to = { s: clamp(target.s, minScale(), maxScale()), cx: target.cx, cy: target.cy };
    flyTween = tween(ms, (t) => {
      const e = ease(t);
      // Interpolación geométrica del zoom: se siente uniforme
      cam.s = from.s * Math.pow(to.s / from.s, e);
      cam.cx = from.cx + (to.cx - from.cx) * e;
      cam.cy = from.cy + (to.cy - from.cy) * e;
      applyCam();
    });
  }

  function fitBounds(b, { snap, maxZoom = 3, ms = 800, margin = 30 } = {}) {
    const padded = { x: b.x - margin, y: b.y - margin, w: b.w + margin * 2, h: b.h + margin * 2 };
    flyTo(boundsCamera(padded, mapPadding(snap), fitScale() * maxZoom), ms);
  }

  function fitAll(ms = 700) {
    const full = { x: 0, y: 0, w: state.bounds.width, h: state.bounds.height };
    flyTo(boundsCamera(full, mapPadding(), Infinity), ms);
  }

  function zoomAt(sx, sy, factor, animate) {
    const wx = cam.cx + (sx - W / 2) / cam.s, wy = cam.cy + (sy - H / 2) / cam.s;
    const s = clamp(cam.s * factor, minScale(), maxScale());
    const next = { s, cx: wx - (sx - W / 2) / s, cy: wy - (sy - H / 2) / s };
    if (animate) flyTo(next, 260); else { Object.assign(cam, next); applyCam(); }
  }

  /* ---- gestos: arrastrar, pellizcar, rueda ---- */
  const ptrs = new Map();
  let drag = null, pinch = null, moved = false;

  dom.container.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.node-pop')) return;
    if (flyTween) flyTween.cancel();
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) {
      drag = { x: e.clientX, y: e.clientY, cx: cam.cx, cy: cam.cy };
      moved = false;
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const r = dom.container.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      pinch = {
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: cam.s,
        wx: cam.cx + (mx - W / 2) / cam.s, wy: cam.cy + (my - H / 2) / cam.s
      };
      moved = true;
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()];
      const r = dom.container.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      cam.s = clamp(pinch.s0 * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0), minScale(), maxScale());
      cam.cx = pinch.wx - (mx - W / 2) / cam.s;
      cam.cy = pinch.wy - (my - H / 2) / cam.s;
      applyCam();
    } else if (drag && ptrs.size === 1) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) > 5) moved = true;
      if (moved) {
        cam.cx = drag.cx - dx / cam.s;
        cam.cy = drag.cy - dy / cam.s;
        applyCam();
        if (state.popNode) hidePop();
      }
    }
  });

  const endPointer = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0) drag = null;
    else if (ptrs.size === 1) {
      const p = [...ptrs.values()][0];
      drag = { x: p.x, y: p.y, cx: cam.cx, cy: cam.cy };
    }
  };
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  // Un arrastre no debe contar como clic sobre un lugar
  dom.container.addEventListener('click', (e) => {
    if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; return; }
    if (!e.target.closest('.map-node') && !e.target.closest('.node-pop')) hidePop();
  }, true);

  dom.container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (flyTween) flyTween.cancel();
    const r = dom.container.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), false);
  }, { passive: false });

  $('btnZoomIn').addEventListener('click', () => zoomAt(W / 2, H / 2, 1.5, true));
  $('btnZoomOut').addEventListener('click', () => zoomAt(W / 2, H / 2, 1 / 1.5, true));
  $('btnRecenter').addEventListener('click', () => { hidePop(); focusRoute(); });

  /* ====================================================================
   * Carga y validación de datos
   * ==================================================================== */
  function initGraphData(data) {
    const nodes = {};
    for (const [id, n] of Object.entries(data.nodes || {})) {
      if (n && Number.isFinite(n.x) && Number.isFinite(n.y)) nodes[id] = { name: String(n.name || id), ...n };
    }
    const edges = (data.edges || []).filter((e) =>
      Array.isArray(e) && nodes[e[0]] && nodes[e[1]] && Number.isFinite(e[2]) && e[2] >= 0);

    state.nodes = nodes;
    state.edges = edges;
    state.buildings = Array.isArray(data.buildings) ? data.buildings : [];
    state.events = Array.isArray(data.events) ? data.events : [];
    if (data.mapBounds && data.mapBounds.width > 0 && data.mapBounds.height > 0) state.bounds = { ...data.mapBounds };

    const ids = Object.keys(nodes);
    if (!nodes[state.origin]) state.origin = ids[0] || '';
    if (!nodes[state.destination]) state.destination = ids[1] || ids[0] || '';

    fillSelects();
    renderQrChips();
    renderBuildings();
    renderWalkways();
    renderNodes();
    renderEvents();
    dom.json.value = JSON.stringify({ nodes: state.nodes, edges: state.edges, buildings: state.buildings, events: state.events }, null, 2);
    recalc({ intro: true });
  }

  function fillSelects() {
    const keys = Object.keys(state.nodes).sort((a, b) => state.nodes[a].name.localeCompare(state.nodes[b].name, 'es'));
    for (const sel of [dom.selOrigin, dom.selDest]) {
      sel.innerHTML = '';
      keys.forEach((id) => {
        const n = state.nodes[id];
        const o = document.createElement('option');
        o.value = id;
        o.textContent = n.name + (n.floor && n.floor !== 'PB' ? ` · ${n.floor}` : '');
        sel.appendChild(o);
      });
    }
    dom.selOrigin.value = state.origin;
    dom.selDest.value = state.destination;
  }

  function renderQrChips() {
    dom.qrChips.innerHTML = '';
    const preferred = ['entrada', 'patio', 'bloqueD', 'cafeteria', 'ingenieria', 'coliseo'].filter((k) => state.nodes[k]);
    (preferred.length ? preferred : Object.keys(state.nodes).slice(0, 6)).forEach((id) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip';
      b.textContent = state.nodes[id].short || state.nodes[id].name;
      b.addEventListener('click', () => {
        setOrigin(id);
        closeModal($('modalQr'));
        toast(`Escaneaste el QR de ${state.nodes[id].short || state.nodes[id].name}. Ahora estás ahí.`);
      });
      dom.qrChips.appendChild(b);
    });
  }

  /* ====================================================================
   * Dibujo del mapa
   * ==================================================================== */
  function renderBuildings() {
    dom.layerBuildings.innerHTML = '';
    state.buildings.forEach((b, i) => {
      dom.layerBuildings.appendChild(svgEl('rect', { x: b.x, y: b.y, width: b.width, height: b.height, rx: b.rx || 12, class: 'map-building', style: `animation-delay:${i * 70}ms` }));
      dom.layerBuildings.appendChild(svgEl('text', { x: b.x + b.width / 2, y: b.y + 20, 'text-anchor': 'middle', class: 'building-label' }, b.label));
    });
  }

  function renderWalkways() {
    dom.layerWalkways.innerHTML = '';
    const seen = new Set();
    const base = [], core = [];
    state.edges.forEach(([u, v, , type]) => {
      const key = [u, v].sort().join(':::');
      if (seen.has(key)) return;
      seen.add(key);
      const a = state.nodes[u], b = state.nodes[v];
      const d = `M${a.x},${a.y} L${b.x},${b.y}`;
      base.push(svgEl('path', { d, class: 'map-walkway' }));
      core.push(svgEl('path', { d, class: 'map-walkway-core' + (type === 'escaleras' ? ' stairs' : type === 'ascensor' ? ' elevator' : '') }));
    });
    [...base, ...core].forEach((p) => dom.layerWalkways.appendChild(p));
  }

  const PIN_PATH = 'M0 0C0 0 -11 -13 -11 -21A11 11 0 1 1 11 -21C11 -13 0 0 0 0Z';

  function renderNodes() {
    dom.layerNodes.innerHTML = '';
    const onRoute = new Set(state.route ? state.route.path : []);
    Object.entries(state.nodes).forEach(([id, n], i) => {
      const isStart = id === state.origin, isEnd = id === state.destination;
      const g = svgEl('g', {
        transform: `translate(${n.x} ${n.y})`, tabindex: '0', role: 'button', 'aria-label': n.name,
        class: 'map-node' + (isStart ? ' start' : '') + (isEnd ? ' end' : '') + (onRoute.has(id) && !isStart && !isEnd ? ' on-route' : '')
      });
      const mk = svgEl('g', { class: 'mk' });
      // Los puntos "saltan" solo al entrar; después únicamente se anima el origen (ondas) y el destino (pin que cae)
      const quiet = state.introDone && !isStart && !isEnd;
      const an = svgEl('g', { class: 'an', style: quiet ? 'animation:none' : `animation-delay:${state.introDone ? 0 : 300 + i * 60}ms` });
      an.appendChild(svgEl('circle', { r: 22, class: 'node-hit' }));
      if (isStart) {
        an.appendChild(svgEl('circle', { r: 11, class: 'node-ripple' }));
        an.appendChild(svgEl('circle', { r: 11, class: 'node-ripple', style: 'animation-delay:1.1s' }));
        an.appendChild(svgEl('circle', { r: 11, class: 'node-dot' }));
        an.appendChild(svgEl('circle', { r: 4.5, class: 'node-start-core' }));
      } else if (isEnd) {
        an.appendChild(svgEl('path', { d: PIN_PATH, class: 'node-pin' }));
        an.appendChild(svgEl('circle', { cy: -21, r: 4.5, class: 'node-pin-hole' }));
      } else {
        an.appendChild(svgEl('circle', { r: onRoute.has(id) ? 7 : 8, class: 'node-dot' }));
      }
      an.appendChild(svgEl('text', { y: isEnd ? 20 : 26, class: 'node-label' }, n.short || n.name));
      mk.appendChild(an);
      g.appendChild(mk);
      g.addEventListener('click', () => openPop(id));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPop(id); } });
      dom.layerNodes.appendChild(g);
    });
  }

  /* ---- tarjeta al tocar un lugar ---- */
  function openPop(id) {
    const n = state.nodes[id];
    if (!n) return;
    state.popNode = id;
    dom.popCat.textContent = `${n.category || 'Lugar'}${n.floor ? ' · ' + (n.floor === 'PB' ? 'Planta baja' : 'Piso ' + n.floor.replace(/^P/, '')) : ''}`;
    dom.popName.textContent = n.name;
    dom.popDesc.textContent = n.desc || 'Punto del campus.';
    dom.pop.hidden = false;
    dom.pop.style.animation = 'none'; void dom.pop.offsetWidth; dom.pop.style.animation = '';
    positionPop();
  }
  function hidePop() { state.popNode = null; dom.pop.hidden = true; }
  function positionPop() {
    const n = state.nodes[state.popNode];
    if (!n) return;
    const sx = (n.x - cam.cx) * cam.s + W / 2, sy = (n.y - cam.cy) * cam.s + H / 2;
    const w = dom.pop.offsetWidth, h = dom.pop.offsetHeight;
    let left = clamp(sx - w / 2, 12, W - w - 12);
    let top = sy - h - 38;
    if (top < 78) top = sy + 34; // si no cabe arriba, va debajo
    dom.pop.style.left = left + 'px';
    dom.pop.style.top = clamp(top, 78, H - h - 12) + 'px';
  }
  $('popClose').addEventListener('click', hidePop);
  $('popGo').addEventListener('click', () => { const id = state.popNode; hidePop(); if (id) setDestination(id); });
  $('popFrom').addEventListener('click', () => { const id = state.popNode; hidePop(); if (id) setOrigin(id); });

  /* ====================================================================
   * Dijkstra
   * ==================================================================== */
  function dijkstra(src, dst, accessibleOnly) {
    if (!state.nodes[src] || !state.nodes[dst]) return null;
    const d = {}, prev = {}, open = new Set(Object.keys(state.nodes));
    open.forEach((id) => { d[id] = Infinity; });
    d[src] = 0;
    while (open.size) {
      let cur = null, best = Infinity;
      for (const id of open) if (d[id] < best) { best = d[id]; cur = id; }
      if (cur === null || best === Infinity || cur === dst) break;
      open.delete(cur);
      for (const [u, v, w, type = 'camino'] of state.edges) {
        if (accessibleOnly && type === 'escaleras') continue;
        const nb = u === cur ? v : v === cur ? u : null;
        if (nb && open.has(nb) && d[cur] + w < d[nb]) { d[nb] = d[cur] + w; prev[nb] = { from: cur, weight: w, type }; }
      }
    }
    if (!Number.isFinite(d[dst])) return null;
    const path = [], segments = [];
    for (let c = dst; c !== src;) {
      const p = prev[c];
      if (!p) return null;
      path.unshift(c);
      segments.unshift({ from: p.from, to: c, weight: p.weight, type: p.type });
      c = p.from;
    }
    path.unshift(src);
    return { path, segments, total: d[dst] };
  }

  /* ====================================================================
   * Ruta: cálculo, dibujo y panel
   * ==================================================================== */
  let walkerLoop = null;

  function recalc({ intro = false, fly = true } = {}) {
    exitGuide(true);
    state.accessibleOnly = dom.checkAcc.checked;
    state.route = dijkstra(state.origin, state.destination, state.accessibleOnly);
    renderNodes();
    renderRoute();
    renderSummary();
    renderSteps();
    syncPeek();
    if (fly) {
      if (intro) {
        // Primero se ve todo el campus; después la cámara vuela hasta la ruta
        const full = { x: 0, y: 0, w: state.bounds.width, h: state.bounds.height };
        Object.assign(cam, boundsCamera(full, mapPadding(), Infinity));
        applyCam();
        setTimeout(() => { if (!state.guide.active) focusRoute(); }, 900);
      } else focusRoute();
    }
    if (intro) state.introDone = true;
  }

  function routeBounds() {
    const r = state.route;
    if (!r) return { x: 0, y: 0, w: state.bounds.width, h: state.bounds.height };
    const pts = r.path.map((id) => state.nodes[id]);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  function focusRoute(snap) {
    if (!state.route) { fitAll(); return; }
    fitBounds(routeBounds(), { snap, maxZoom: 2.6, margin: 60 });
  }

  function renderRoute() {
    stopWalker();
    dom.layerRoute.innerHTML = '';
    dom.layerWalker.innerHTML = '';
    const r = state.route;
    if (!r || r.path.length < 2) return;
    const d = 'M' + r.path.map((id) => `${state.nodes[id].x},${state.nodes[id].y}`).join(' L');
    const casing = svgEl('path', { d, class: 'route-casing' });
    const line = svgEl('path', { d, class: 'route-line' });
    const march = svgEl('path', { d, class: 'route-march' });
    dom.layerRoute.append(casing, line, march);
    const len = line.getTotalLength();
    line.style.setProperty('--len', len);
    line.style.strokeDasharray = len;
    line.style.strokeDashoffset = len;
    casing.style.animation = 'fadeIn .4s both';
    startWalker(line, len);
  }

  /** Puntito que recorre la ruta en bucle: da vida al mapa y enseña el sentido del recorrido. */
  function makeWalker() {
    const g = svgEl('g');
    const mk = svgEl('g', { class: 'mk' });
    mk.append(svgEl('circle', { r: 14, class: 'walker-halo' }), svgEl('circle', { r: 7, class: 'walker-dot' }));
    g.appendChild(mk);
    dom.layerWalker.appendChild(g);
    return g;
  }
  function startWalker(path, len) {
    if (reduceMotion.matches || state.guide.active) return;
    const g = makeWalker();
    const secs = clamp(len / 70, 3.5, 9);
    const t0 = performance.now() + 1100; // espera a que la ruta termine de dibujarse
    g.style.opacity = 0;
    const tick = (now) => {
      const t = ((now - t0) / (secs * 1000));
      if (t >= 0) {
        const p = path.getPointAtLength(((t % 1.25) / 1.25) * len);
        g.setAttribute('transform', `translate(${p.x} ${p.y})`);
        g.style.opacity = t % 1.25 < 1.1 ? 1 : 0;
      }
      walkerLoop = requestAnimationFrame(tick);
    };
    walkerLoop = requestAnimationFrame(tick);
  }
  function stopWalker() { if (walkerLoop) cancelAnimationFrame(walkerLoop); walkerLoop = null; }

  function countTo(el, to) {
    const from = parseInt(el.dataset.v || '0', 10) || 0;
    el.dataset.v = to;
    tween(700, (t) => { el.textContent = Math.round(from + (to - from) * ease(t)); });
  }

  const minutes = (m) => Math.max(1, Math.ceil(m / WALK_M_PER_MIN));

  function renderSummary() {
    const r = state.route, box = dom.resultBox;
    box.classList.remove('empty', 'noroute');
    dom.accBadge.className = 'badge';
    dom.accBadge.textContent = '';
    if (!state.origin || !state.destination) { box.classList.add('empty'); dom.txtNote.textContent = 'Elige origen y destino para ver la ruta.'; return; }
    if (!r) {
      box.classList.add('noroute');
      dom.txtMeters.textContent = '—'; dom.txtMeters.dataset.v = 0;
      dom.txtEta.textContent = 'Sin conexión';
      dom.txtNote.textContent = state.accessibleOnly
        ? 'No hay un camino accesible entre estos lugares. Prueba desactivando «Ruta accesible».'
        : 'No encontramos un camino entre estos lugares en el mapa actual.';
      return;
    }
    if (r.total === 0) {
      box.classList.add('empty');
      dom.txtNote.textContent = 'Ya estás en ese lugar. Elige otro destino.';
      return;
    }
    countTo(dom.txtMeters, r.total);
    dom.txtEta.textContent = `~${minutes(r.total)} min a pie · ${r.segments.length} ${r.segments.length === 1 ? 'tramo' : 'tramos'}`;
    const stairs = r.segments.some((s) => s.type === 'escaleras');
    dom.accBadge.className = 'badge ' + (stairs ? 'warn' : 'ok');
    dom.accBadge.textContent = stairs ? 'Incluye escaleras' : 'Accesible';
    dom.txtNote.textContent = 'Toca un paso para verlo en el mapa, o empieza la guía para que te acompañe.';
  }

  /* ---- instrucciones ---- */
  function turnBetween(prevSeg, seg) {
    const a = state.nodes[prevSeg.from], b = state.nodes[prevSeg.to], c = state.nodes[seg.to];
    const v1 = { x: b.x - a.x, y: b.y - a.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const angle = Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y) * 180 / Math.PI; // + = derecha (eje y hacia abajo)
    const abs = Math.abs(angle);
    if (abs < 22) return { text: 'Sigue recto', rot: 0 };
    if (abs > 150) return { text: 'Da la vuelta', rot: 180 };
    const side = angle > 0 ? 'derecha' : 'izquierda';
    return { text: abs < 60 ? `Gira levemente a la ${side}` : `Gira a la ${side}`, rot: clamp(angle, -135, 135) };
  }

  function stepInfo(i) {
    const r = state.route, seg = r.segments[i];
    const to = state.nodes[seg.to], from = state.nodes[seg.from];
    const name = to.short || to.name;
    const secs = Math.round(seg.weight / (WALK_M_PER_MIN / 60));
    const time = secs >= 90 ? `~${Math.round(secs / 60)} min` : `~${secs} s`;
    let title, detail = `${seg.weight} m · ${time}`, ico = 'arrow', rot = 0, cls = '';
    if (seg.type === 'escaleras') { title = `Sube o baja por las escaleras hasta ${name}`; ico = 'stairs'; cls = 'stairs'; detail += ' · Para evitarlas, activa «Ruta accesible».'; }
    else if (seg.type === 'ascensor') { title = `Toma el ascensor hasta ${name}`; ico = 'elevator'; cls = 'elevator'; }
    else if (seg.type === 'rampa') { title = `Sigue por la rampa hasta ${name}`; ico = 'ramp'; cls = 'ramp'; }
    else if (i === 0) { title = `Sal de ${from.short || from.name} hacia ${name}`; }
    else { const t = turnBetween(r.segments[i - 1], seg); title = `${t.text} hacia ${name}`; rot = t.rot; }
    return { title, detail, ico, rot, cls, seg };
  }

  function renderSteps() {
    dom.steps.innerHTML = '';
    const r = state.route;
    if (!r || r.total === 0) return;
    const li = (cls, ico, title, detail, onClick, rot = 0, delay = 0) => {
      const el = document.createElement('li');
      el.className = 'step ' + cls;
      el.style.animationDelay = delay + 'ms';
      el.innerHTML = `<button class="step-btn" type="button"><span class="step-ico">${icon(ico, rot ? `transform:rotate(${rot}deg)` : '')}</span><span class="step-title">${esc(title)}</span><div class="step-detail">${esc(detail)}</div></button>`;
      el.querySelector('button').addEventListener('click', onClick);
      dom.steps.appendChild(el);
    };
    const o = state.nodes[state.origin], d = state.nodes[state.destination];
    li('start', 'pin', `Estás en ${o.name}`, 'Punto de partida', () => startGuide(0), 0, 0);
    r.segments.forEach((_, i) => {
      const s = stepInfo(i);
      li(s.cls, s.ico, s.title, s.detail, () => startGuide(i), s.rot, 60 * (i + 1));
    });
    li('end', 'flag', `Llegas a ${d.name}`, d.desc || '', () => startGuide(r.segments.length), 0, 60 * (r.segments.length + 1));
  }

  /* ====================================================================
   * Guía paso a paso
   * ==================================================================== */
  let walkerTween = null, guideWalker = null;

  function startGuide(index = 0) {
    const r = state.route;
    if (!r || r.total === 0) return;
    state.guide.active = true;
    stopWalker();
    dom.layerWalker.innerHTML = '';
    guideWalker = makeWalker();
    const p0 = state.nodes[r.segments[Math.min(index, r.segments.length - 1)].from];
    guideWalker.setAttribute('transform', `translate(${p0.x} ${p0.y})`);
    dom.guideCard.hidden = false;
    setSnap('peek');
    goGuide(clamp(index, 0, r.segments.length), true);
  }

  function goGuide(i, instant = false) {
    const r = state.route, n = r.segments.length;
    const prev = state.guide.index;
    state.guide.index = i;
    const arrive = i === n;

    // Barra y textos
    dom.guideStepLabel.textContent = arrive ? 'Llegada' : `Paso ${i + 1} de ${n}`;
    dom.guideProgress.style.width = `${(i / n) * 100}%`;
    dom.btnGuidePrev.disabled = i === 0;
    dom.btnGuideNext.textContent = arrive ? 'Terminar' : i === n - 1 ? 'Llegar' : 'Siguiente';
    dom.guideIcon.className = 'guide-icon' + (arrive ? ' arrive' : '');
    if (arrive) {
      const d = state.nodes[state.destination];
      dom.guideIcon.innerHTML = icon('flag');
      dom.guideTitle.textContent = `¡Llegaste a ${d.short || d.name}!`;
      dom.guideDetail.textContent = d.desc || `Recorriste ${r.total} m. ¡Buen camino!`;
    } else {
      const s = stepInfo(i);
      dom.guideIcon.innerHTML = icon(s.ico, s.rot ? `transform:rotate(${s.rot}deg)` : '');
      dom.guideTitle.textContent = s.title;
      dom.guideDetail.textContent = s.detail;
    }

    // Resaltar el tramo actual
    dom.layerRoute.querySelectorAll('.route-seg, .route-seg-casing').forEach((el) => el.remove());
    if (!arrive) {
      const seg = r.segments[i], a = state.nodes[seg.from], b = state.nodes[seg.to];
      const d = `M${a.x},${a.y} L${b.x},${b.y}`;
      dom.layerRoute.append(svgEl('path', { d, class: 'route-seg-casing' }), svgEl('path', { d, class: 'route-seg' }));
    }

    // Mover al caminante y la cámara
    if (walkerTween) walkerTween.cancel();
    const target = arrive ? state.nodes[state.destination] : state.nodes[r.segments[i].from];
    const start = guideWalker.transform.baseVal.numberOfItems ? guideWalker.transform.baseVal.getItem(0).matrix : { e: target.x, f: target.y };
    const from = { x: start.e, y: start.f };
    const move = (t) => guideWalker.setAttribute('transform', `translate(${from.x + (target.x - from.x) * ease(t)} ${from.y + (target.y - from.y) * ease(t)})`);
    walkerTween = instant ? (move(1), null) : tween(Math.min(1300, 400 + Math.abs(i - prev) * 700), move, arrive ? celebrate : null);

    if (arrive) fitBounds({ x: target.x - 60, y: target.y - 60, w: 120, h: 120 }, { snap: 'peek', maxZoom: 2.4, margin: 10 });
    else {
      const seg = r.segments[i], a = state.nodes[seg.from], b = state.nodes[seg.to];
      fitBounds({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }, { snap: 'peek', maxZoom: 2.4, margin: 70 });
    }
  }

  function exitGuide(silent) {
    if (!state.guide.active) return;
    state.guide.active = false;
    if (walkerTween) walkerTween.cancel();
    dom.guideCard.hidden = true;
    dom.layerFx.innerHTML = '';
    dom.layerRoute.querySelectorAll('.route-seg, .route-seg-casing').forEach((el) => el.remove());
    if (!silent) {
      setSnap('half');
      renderRoute();
      focusRoute('half');
    }
  }

  /** Pequeña celebración al llegar: chispas amarillas y azules. */
  function celebrate() {
    if (reduceMotion.matches) return;
    const n = state.nodes[state.destination];
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2, speed = 40 + Math.random() * 40;
      const g = svgEl('g', { transform: `translate(${n.x} ${n.y - 10})` });
      const dot = svgEl('circle', { r: 3 + Math.random() * 2.5, class: 'fx-dot', fill: i % 3 === 0 ? '#005289' : i % 3 === 1 ? '#FFCC00' : '#009DC4' });
      g.appendChild(dot);
      dom.layerFx.appendChild(g);
      tween(900 + Math.random() * 500, (t) => {
        const e = 1 - Math.pow(1 - t, 3);
        g.setAttribute('transform', `translate(${n.x + Math.cos(ang) * speed * e / cam.s} ${n.y - 10 + Math.sin(ang) * speed * e / cam.s + t * t * 30 / cam.s})`);
        dot.style.opacity = 1 - t;
      }, () => g.remove());
    }
  }

  dom.btnStartGuide.addEventListener('click', () => startGuide(0));
  dom.btnGuideNext.addEventListener('click', () => {
    const n = state.route.segments.length;
    if (state.guide.index >= n) exitGuide(false); else goGuide(state.guide.index + 1);
  });
  dom.btnGuidePrev.addEventListener('click', () => { if (state.guide.index > 0) goGuide(state.guide.index - 1); });
  dom.btnGuideExit.addEventListener('click', () => exitGuide(false));

  /* ====================================================================
   * Selección de origen y destino
   * ==================================================================== */
  function setOrigin(id) {
    if (!state.nodes[id]) return;
    state.origin = id; dom.selOrigin.value = id;
    if (state.origin === state.destination) toast('Ese también es tu destino. Elige otro.');
    recalc();
  }
  function setDestination(id) {
    if (!state.nodes[id]) return;
    state.destination = id; dom.selDest.value = id;
    showTab('route');
    if (!isDesktop.matches && dom.sheet.dataset.snap === 'peek') setSnap('half');
    recalc();
  }
  dom.selOrigin.addEventListener('change', (e) => { state.origin = e.target.value; recalc(); });
  dom.selDest.addEventListener('change', (e) => { state.destination = e.target.value; recalc(); });
  dom.checkAcc.addEventListener('change', () => {
    recalc();
    toast(dom.checkAcc.checked ? 'Ruta accesible: se evitan las escaleras.' : 'Se permiten escaleras.');
  });
  dom.btnSwap.addEventListener('click', () => {
    [state.origin, state.destination] = [state.destination, state.origin];
    dom.selOrigin.value = state.origin; dom.selDest.value = state.destination;
    dom.btnSwap.classList.toggle('spin');
    recalc();
  });
  $('btnPhoto').addEventListener('click', () => toast('Pronto podrás subir una foto y te diremos dónde estás. 📷', 3800));

  /* ====================================================================
   * Hoja inferior (celular): arrastrar y soltar en 3 alturas
   * ==================================================================== */
  const PEEK_H = 132;
  const sheetHeight = () => dom.sheet.offsetHeight || window.innerHeight * 0.88;
  const snapTops = () => {
    const h = window.innerHeight;
    return { full: h - sheetHeight(), half: h * 0.5, peek: h - PEEK_H };
  };
  const sheetTop = (snap) => snapTops()[snap] ?? snapTops().half;

  function setSnap(snap) {
    if (isDesktop.matches) { dom.sheet.dataset.snap = snap; return; }
    dom.sheet.dataset.snap = snap;
    const ty = sheetTop(snap) - snapTops().full;
    dom.sheet.style.setProperty('--ty', ty + 'px');
  }

  let sheetDrag = null;
  function sheetPointerDown(e) {
    if (isDesktop.matches) return;
    sheetDrag = { y0: e.clientY, ty0: parseFloat(getComputedStyle(dom.sheet).getPropertyValue('--ty')) || 0, t: performance.now(), moved: false, last: e.clientY, lastT: performance.now(), v: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function sheetPointerMove(e) {
    if (!sheetDrag) return;
    const dy = e.clientY - sheetDrag.y0;
    if (Math.abs(dy) > 4) { sheetDrag.moved = true; dom.sheet.classList.add('dragging'); }
    if (!sheetDrag.moved) return;
    const max = snapTops().peek - snapTops().full;
    dom.sheet.style.setProperty('--ty', clamp(sheetDrag.ty0 + dy, 0, max) + 'px');
    const now = performance.now();
    sheetDrag.v = (e.clientY - sheetDrag.last) / Math.max(1, now - sheetDrag.lastT);
    sheetDrag.last = e.clientY; sheetDrag.lastT = now;
  }
  function sheetPointerUp() {
    if (!sheetDrag) return;
    const d = sheetDrag; sheetDrag = null;
    dom.sheet.classList.remove('dragging');
    const order = ['full', 'half', 'peek'];
    const cur = dom.sheet.dataset.snap;
    if (!d.moved) { setSnap(cur === 'peek' ? 'half' : cur === 'half' ? 'full' : 'half'); afterSnap(); return; }
    const top = dom.sheet.getBoundingClientRect().top + d.v * 160; // inercia
    const tops = snapTops();
    setSnap(order.reduce((a, b) => (Math.abs(tops[a] - top) < Math.abs(tops[b] - top) ? a : b)));
    afterSnap();
  }
  function afterSnap() { setTimeout(() => { if (state.route && !state.guide.active) focusRoute(); }, 460); }
  [dom.sheetHandle, dom.peek].forEach((el) => {
    el.addEventListener('pointerdown', sheetPointerDown);
    el.addEventListener('pointermove', sheetPointerMove);
    el.addEventListener('pointerup', sheetPointerUp);
    el.addEventListener('pointercancel', sheetPointerUp);
  });
  isDesktop.addEventListener('change', () => { setSnap(dom.sheet.dataset.snap); onResize(); });
  window.addEventListener('resize', () => setSnap(dom.sheet.dataset.snap));

  function syncPeek() {
    const d = state.nodes[state.destination];
    if (!state.route || !d) { dom.peekTitle.textContent = '¿A dónde vas?'; dom.peekMeta.textContent = 'Elige un destino'; return; }
    dom.peekTitle.textContent = state.route.total === 0 ? 'Ya estás aquí' : d.short || d.name;
    dom.peekMeta.textContent = state.route.total === 0 ? d.name : `${state.route.total} m · ~${minutes(state.route.total)} min a pie`;
  }

  /* ====================================================================
   * Pestañas y eventos
   * ==================================================================== */
  function showTab(which) {
    const route = which === 'route';
    dom.tabRoute.classList.toggle('active', route); dom.tabEvents.classList.toggle('active', !route);
    dom.tabRoute.setAttribute('aria-selected', route); dom.tabEvents.setAttribute('aria-selected', !route);
    dom.panelRoute.hidden = !route; dom.panelEvents.hidden = route;
  }
  dom.tabRoute.addEventListener('click', () => { showTab('route'); if (!isDesktop.matches && dom.sheet.dataset.snap === 'peek') setSnap('half'); });
  dom.tabEvents.addEventListener('click', () => { showTab('events'); if (!isDesktop.matches) setSnap('full'); });

  function renderEvents() {
    dom.events.innerHTML = '';
    const q = state.query.toLowerCase().trim();
    const list = state.events.filter((ev) => {
      const okCat = state.category === 'all' || ev.tag === state.category;
      const text = `${ev.title} ${ev.place} ${ev.desc} ${ev.tag} ${ev.organizer || ''}`.toLowerCase();
      return okCat && (!q || text.includes(q));
    });
    if (!list.length) { dom.events.innerHTML = '<div class="empty-box"><strong>No hay eventos con ese filtro</strong><br>Prueba otra búsqueda o categoría.</div>'; return; }
    list.forEach((ev, i) => {
      const card = document.createElement('article');
      card.className = 'event';
      card.style.setProperty('--ev', /^#[0-9a-f]{3,8}$/i.test(ev.color || '') ? ev.color : '#005289');
      card.style.animationDelay = i * 70 + 'ms';
      card.innerHTML = `
        <div class="event-meta"><span class="event-tag">${esc(ev.tag)}</span><span class="event-date">${esc(ev.date)}${ev.time ? ' · ' + esc(ev.time) : ''}</span></div>
        <h4>${esc(ev.title)}</h4>
        <p>${esc(ev.desc)}</p>
        <div class="event-place">${icon('pin')}<span>${esc(ev.place)}</span></div>
        <button class="btn btn-primary" type="button">Cómo llegar</button>`;
      card.querySelector('button').addEventListener('click', () => {
        if (!state.nodes[ev.nodeId]) { toast(`«${ev.place}» todavía no está en el mapa.`); return; }
        setDestination(ev.nodeId);
        toast(`Ruta hacia ${ev.place}`);
      });
      dom.events.appendChild(card);
    });
  }
  dom.search.addEventListener('input', (e) => { state.query = e.target.value; renderEvents(); });
  dom.filterBar.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    dom.filterBar.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.category = chip.dataset.category;
    renderEvents();
  });

  /* ====================================================================
   * Modales y menú
   * ==================================================================== */
  function openModal(m) { m.hidden = false; const f = m.querySelector('button, textarea'); if (f) f.focus({ preventScroll: true }); }
  function closeModal(m) { m.hidden = true; }
  document.querySelectorAll('.modal-overlay').forEach((o) => {
    o.addEventListener('click', (e) => { if (e.target === o || e.target.closest('[data-close]')) closeModal(o); });
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal-overlay:not([hidden])').forEach(closeModal);
    if (!$('tour').hidden) endTour();
    hidePop();
  });

  $('btnMenu').addEventListener('click', () => openModal($('modalMenu')));
  const viaMenu = (id, fn) => $(id).addEventListener('click', () => { closeModal($('modalMenu')); fn(); });
  viaMenu('menuTour', () => startTour());
  viaMenu('menuQr', () => openModal($('modalQr')));
  viaMenu('menuBudget', () => openModal($('modalBudget')));
  viaMenu('menuImport', () => openModal($('modalImport')));

  $('btnApplyCustomGraph').addEventListener('click', () => {
    try {
      const parsed = JSON.parse(dom.json.value.trim());
      if (!parsed.nodes || typeof parsed.nodes !== 'object') throw new Error('Falta la propiedad "nodes".');
      if (!Array.isArray(parsed.edges)) throw new Error('Falta la lista "edges".');
      initGraphData(parsed);
      closeModal($('modalImport'));
      toast(`Grafo cargado: ${Object.keys(state.nodes).length} lugares y ${state.edges.length} conexiones.`);
    } catch (err) {
      toast(`No se pudo cargar: ${err.message}`, 5000);
    }
  });
  $('btnResetToDefaultGraph').addEventListener('click', () => {
    if (!window.confirm('¿Restablecer el mapa de demostración?')) return;
    initGraphData(window.CampusData);
    closeModal($('modalImport'));
  });

  /* ====================================================================
   * Recorrido de ayuda (primer uso)
   * ==================================================================== */
  const TOUR = [
    { art: '<svg viewBox="0 0 120 120"><circle cx="30" cy="84" r="9" fill="none" stroke="#005289" stroke-width="5"/><path d="M30 76C40 40 80 70 92 34" fill="none" stroke="#005289" stroke-width="5" stroke-dasharray="2 9" stroke-linecap="round"/><path d="M92 40C92 40 80 28 80 21a12 12 0 1 1 24 0c0 7-12 19-12 19z" fill="#FFCC00" stroke="#003366" stroke-width="4"/></svg>', title: 'Dime dónde estás y a dónde vas', text: 'Elige tu punto de partida y tu destino. También puedes tocar cualquier lugar del mapa para saber más y marcarlo.' },
    { art: '<svg viewBox="0 0 120 120"><rect x="14" y="30" width="92" height="62" rx="12" fill="#E6F0F8"/><path d="M26 76L52 52L72 64L96 40" fill="none" stroke="#005289" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="72" cy="64" r="8" fill="#FFCC00" stroke="#003366" stroke-width="4"/></svg>', title: 'Mira la ruta en el mapa', text: 'La línea azul es el camino más corto. Arrastra para moverte y pellizca (o usa la rueda) para acercar.' },
    { art: '<svg viewBox="0 0 120 120"><rect x="22" y="18" width="76" height="84" rx="16" fill="#005289"/><path d="M60 38v32m-14-14l14-14 14 14" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><rect x="38" y="82" width="44" height="10" rx="5" fill="#FFCC00"/></svg>', title: 'Sigue la guía paso a paso', text: 'Pulsa «Empezar guía» y te diré cuándo girar. Si necesitas evitar escaleras, activa «Ruta accesible».' }
  ];
  let tourIdx = 0;
  function startTour() { tourIdx = 0; $('tour').hidden = false; renderTour(); }
  function endTour() { $('tour').hidden = true; try { localStorage.setItem('alocate_tour_done', '1'); } catch (_) { /* sin almacenamiento */ } }
  function renderTour() {
    const t = TOUR[tourIdx];
    $('tourArt').innerHTML = t.art; $('tourTitle').textContent = t.title; $('tourText').textContent = t.text;
    $('tourDots').innerHTML = TOUR.map((_, i) => `<i class="${i === tourIdx ? 'on' : ''}"></i>`).join('');
    $('tourNext').textContent = tourIdx === TOUR.length - 1 ? '¡Entendido!' : 'Siguiente';
  }
  $('tourNext').addEventListener('click', () => { if (tourIdx >= TOUR.length - 1) endTour(); else { tourIdx++; renderTour(); } });
  $('tourSkip').addEventListener('click', endTour);

  /* ====================================================================
   * Parámetros de URL (QR reales): ?origen=entrada&destino=coliseo
   * ==================================================================== */
  function readUrlParams() {
    const p = new URLSearchParams(window.location.search);
    if (p.get('origen') && state.nodes[p.get('origen')]) state.origin = p.get('origen');
    if (p.get('destino') && state.nodes[p.get('destino')]) state.destination = p.get('destino');
  }

  /* ====================================================================
   * Arranque
   * ==================================================================== */
  window.loadCampusGraph = (data) => initGraphData(data);
  onResize();
  setSnap(isDesktop.matches ? 'half' : 'half');
  state.nodes = window.CampusData.nodes; // para validar los parámetros de URL antes de cargar
  readUrlParams();
  initGraphData(window.CampusData);
  let seen = false;
  try { seen = localStorage.getItem('alocate_tour_done') === '1'; } catch (_) { /* sin almacenamiento */ }
  if (!seen) setTimeout(startTour, 900);
})();
