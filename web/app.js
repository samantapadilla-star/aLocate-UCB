/**
 * UCB RUTA - Lógica Principal de la Aplicación
 * ==============================================
 * Incluye:
 * - Implementación del Algoritmo Dijkstra con Accesibilidad
 * - Renderizado Interactivo SVG del Campus con Pan & Zoom
 * - Gestión de Origen, Destino y Simulación de Códigos QR
 * - Filtrado y Búsqueda de Eventos
 * - Carga e Importación Dinámica de Archivos de Grafo
 */

(function () {
  'use strict';

  // Estado global de la aplicación
  const state = {
    nodes: {},
    edges: [],
    buildings: [],
    events: [],
    origin: 'entrada',
    destination: 'coliseo',
    accessibleOnly: false,
    selectedCategory: 'all',
    searchQuery: '',
    // Estado del visor SVG (Pan & Zoom)
    viewBox: { x: 0, y: 0, width: 900, height: 560 },
    baseViewBox: { x: 0, y: 0, width: 900, height: 560 },
    isPanning: false,
    panStart: { x: 0, y: 0 }
  };

  // Referencias al DOM
  const dom = {
    selectOrigin: document.getElementById('selectOrigin'),
    selectDestination: document.getElementById('selectDestination'),
    checkAccessible: document.getElementById('checkAccessible'),
    btnCalculate: document.getElementById('btnCalculate'),
    btnSwap: document.getElementById('btnSwap'),
    qrChipsContainer: document.getElementById('qrChipsContainer'),
    txtMeters: document.getElementById('txtMeters'),
    txtEta: document.getElementById('txtEta'),
    txtNote: document.getElementById('txtNote'),
    stepsList: document.getElementById('stepsList'),
    accessibilityBadge: document.getElementById('accessibilityBadge'),
    nodeCountLabel: document.getElementById('nodeCountLabel'),
    // Mapa SVG
    mapContainer: document.getElementById('mapContainer'),
    campusSvg: document.getElementById('campusSvg'),
    layerBuildings: document.getElementById('layerBuildings'),
    layerWalkways: document.getElementById('layerWalkways'),
    layerRoute: document.getElementById('layerRoute'),
    layerNodes: document.getElementById('layerNodes'),
    mapTooltip: document.getElementById('mapTooltip'),
    btnZoomIn: document.getElementById('btnZoomIn'),
    btnZoomOut: document.getElementById('btnZoomOut'),
    btnResetView: document.getElementById('btnResetView'),
    // Eventos
    inputSearchEvents: document.getElementById('inputSearchEvents'),
    categoryFilterBar: document.getElementById('categoryFilterBar'),
    eventsGrid: document.getElementById('eventsGrid'),
    // Modales
    modalBudget: document.getElementById('modalBudget'),
    modalImport: document.getElementById('modalImport'),
    modalQr: document.getElementById('modalQr'),
    btnOpenBudgetModal: document.getElementById('btnOpenBudgetModal'),
    btnOpenImportModal: document.getElementById('btnOpenImportModal'),
    btnOpenQrModal: document.getElementById('btnOpenQrModal'),
    linkBudgetFooter: document.getElementById('linkBudgetFooter'),
    linkImportFooter: document.getElementById('linkImportFooter'),
    txtGraphJson: document.getElementById('txtGraphJson'),
    btnApplyCustomGraph: document.getElementById('btnApplyCustomGraph'),
    btnResetToDefaultGraph: document.getElementById('btnResetToDefaultGraph')
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Creador auxiliar de elementos SVG
  function createSvgElement(tag, attributes = {}, textContent = null) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, val] of Object.entries(attributes)) {
      el.setAttribute(key, val);
    }
    if (textContent !== null) {
      el.textContent = textContent;
    }
    return el;
  }

  // ========================================================
  // INICIALIZACIÓN DE DATOS
  // ========================================================
  function initGraphData(data) {
    state.nodes = { ...data.nodes };
    state.edges = [...data.edges];
    state.buildings = data.buildings ? [...data.buildings] : [];
    state.events = data.events ? [...data.events] : [];

    if (data.mapBounds) {
      state.baseViewBox = { x: 0, y: 0, width: data.mapBounds.width, height: data.mapBounds.height };
      state.viewBox = { ...state.baseViewBox };
      dom.campusSvg.setAttribute('viewBox', `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.width} ${state.viewBox.height}`);
    }

    updateNodeSelects();
    renderQrChips();
    renderBuildings();
    renderWalkways();
    renderEvents();
    calculateAndDrawRoute();

    if (dom.nodeCountLabel) {
      dom.nodeCountLabel.textContent = `${Object.keys(state.nodes).length} puntos mapeados`;
    }

    // Actualizar JSON en el modal de importación
    dom.txtGraphJson.value = JSON.stringify({
      nodes: state.nodes,
      edges: state.edges,
      buildings: state.buildings,
      events: state.events
    }, null, 2);
  }

  // ========================================================
  // POBLAR SELECTS Y CHIPS QR
  // ========================================================
  function updateNodeSelects() {
    dom.selectOrigin.innerHTML = '';
    dom.selectDestination.innerHTML = '';

    const sortedNodeKeys = Object.keys(state.nodes).sort((a, b) => 
      state.nodes[a].name.localeCompare(state.nodes[b].name)
    );

    sortedNodeKeys.forEach(id => {
      const node = state.nodes[id];
      const floorTag = node.floor ? ` [${node.floor}]` : '';
      
      const optOrigin = document.createElement('option');
      optOrigin.value = id;
      optOrigin.textContent = `${node.name}${floorTag}`;
      dom.selectOrigin.appendChild(optOrigin);

      const optDest = document.createElement('option');
      optDest.value = id;
      optDest.textContent = `${node.name}${floorTag}`;
      dom.selectDestination.appendChild(optDest);
    });

    // Validar selecciones actuales
    if (state.nodes[state.origin]) {
      dom.selectOrigin.value = state.origin;
    } else if (sortedNodeKeys.length > 0) {
      state.origin = sortedNodeKeys[0];
      dom.selectOrigin.value = state.origin;
    }

    if (state.nodes[state.destination]) {
      dom.selectDestination.value = state.destination;
    } else if (sortedNodeKeys.length > 1) {
      state.destination = sortedNodeKeys[1];
      dom.selectDestination.value = state.destination;
    }
  }

  function renderQrChips() {
    dom.qrChipsContainer.innerHTML = '';
    const recommendedKeys = ['entrada', 'patio', 'bloqueD', 'cafeteria', 'ingenieria', 'coliseo'];
    
    // Si los recomendados no existen en el grafo del usuario, tomar los primeros 5
    const keysToShow = recommendedKeys.filter(k => state.nodes[k]);
    const finalKeys = keysToShow.length > 0 ? keysToShow : Object.keys(state.nodes).slice(0, 6);

    finalKeys.forEach(key => {
      const node = state.nodes[key];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-btn';
      btn.innerHTML = `<span>📍</span> ${node.short || node.name}`;
      btn.addEventListener('click', () => {
        state.origin = key;
        dom.selectOrigin.value = key;
        calculateAndDrawRoute();
      });
      dom.qrChipsContainer.appendChild(btn);
    });
  }

  // ========================================================
  // RENDERIZADO DEL MAPA SVG
  // ========================================================
  function renderBuildings() {
    dom.layerBuildings.innerHTML = '';
    state.buildings.forEach(bld => {
      const rect = createSvgElement('rect', {
        x: bld.x,
        y: bld.y,
        width: bld.width,
        height: bld.height,
        rx: bld.rx || 12,
        class: 'map-building'
      });
      dom.layerBuildings.appendChild(rect);

      const label = createSvgElement('text', {
        x: bld.x + bld.width / 2,
        y: bld.y + 24,
        'text-anchor': 'middle',
        class: 'building-label'
      }, bld.label);
      dom.layerBuildings.appendChild(label);
    });
  }

  function renderWalkways() {
    dom.layerWalkways.innerHTML = '';
    const seenEdges = new Set();

    state.edges.forEach(([u, v, weight, type]) => {
      if (!state.nodes[u] || !state.nodes[v]) return;
      const sortedPair = [u, v].sort().join(':::');
      if (seenEdges.has(sortedPair)) return;
      seenEdges.add(sortedPair);

      const p1 = state.nodes[u];
      const p2 = state.nodes[v];

      let cssClass = 'map-walkway';
      if (type === 'escaleras') cssClass += ' stairs';
      if (type === 'ascensor') cssClass += ' elevator';

      const path = createSvgElement('path', {
        d: `M${p1.x},${p1.y} L${p2.x},${p2.y}`,
        class: cssClass
      });
      dom.layerWalkways.appendChild(path);
    });
  }

  function renderNodes(activePath = []) {
    dom.layerNodes.innerHTML = '';

    Object.entries(state.nodes).forEach(([id, node]) => {
      const isStart = (id === state.origin);
      const isEnd = (id === state.destination);
      const inPath = activePath.includes(id);

      let groupClass = 'map-node';
      if (isStart) groupClass += ' start';
      if (isEnd) groupClass += ' end';

      const g = createSvgElement('g', {
        class: groupClass,
        tabindex: '0',
        role: 'button',
        'aria-label': `${node.name}`
      });

      const radius = isStart || isEnd ? 10 : 8;
      const circle = createSvgElement('circle', {
        cx: node.x,
        cy: node.y,
        r: radius
      });
      g.appendChild(circle);

      // Etiqueta del nodo con alineación inteligente para no salirse de los bordes
      const isRightEdge = node.x > (state.baseViewBox.width - 160);
      const isLeftEdge = node.x < 130;
      const align = isRightEdge ? 'end' : (isLeftEdge ? 'start' : 'middle');
      const offsetX = isRightEdge ? -12 : (isLeftEdge ? 12 : 0);
      const textX = node.x + offsetX;
      const textY = node.y < 120 ? node.y - 14 : node.y + 24;

      const text = createSvgElement('text', {
        x: textX,
        y: textY,
        'text-anchor': align
      }, node.short || node.name);
      g.appendChild(text);

      // Eventos de Tooltip y Clic
      g.addEventListener('mouseenter', (e) => {
        showTooltip(node, e);
      });
      g.addEventListener('mousemove', (e) => {
        moveTooltip(e);
      });
      g.addEventListener('mouseleave', () => {
        hideTooltip();
      });

      g.addEventListener('click', () => {
        // Si ya está como destino o es igual a origen, permitir invertir o cambiar destino
        if (state.destination !== id) {
          state.destination = id;
          dom.selectDestination.value = id;
        } else {
          state.origin = id;
          dom.selectOrigin.value = id;
        }
        calculateAndDrawRoute();
      });

      dom.layerNodes.appendChild(g);
    });
  }

  // ========================================================
  // ALGORITMO DIJKSTRA
  // ========================================================
  function dijkstra(sourceId, targetId, accessibleOnly) {
    if (!state.nodes[sourceId] || !state.nodes[targetId]) return null;

    const distances = {};
    const previous = {};
    const unvisited = new Set(Object.keys(state.nodes));

    Object.keys(state.nodes).forEach(nodeId => {
      distances[nodeId] = Infinity;
    });
    distances[sourceId] = 0;

    while (unvisited.size > 0) {
      // Encontrar el nodo no visitado con menor distancia tentativa
      let current = null;
      let lowestDist = Infinity;
      for (const nodeId of unvisited) {
        if (distances[nodeId] < lowestDist) {
          lowestDist = distances[nodeId];
          current = nodeId;
        }
      }

      if (!current || distances[current] === Infinity) break;
      if (current === targetId) break;

      unvisited.delete(current);

      // Explorar aristas conectadas
      for (const [u, v, weight, type = 'camino'] of state.edges) {
        // Si el usuario pidió ruta 100% accesible, omitir escaleras
        if (accessibleOnly && type === 'escaleras') {
          continue;
        }

        let neighbor = null;
        if (u === current) neighbor = v;
        else if (v === current) neighbor = u;

        if (neighbor && unvisited.has(neighbor)) {
          const altDistance = distances[current] + weight;
          if (altDistance < distances[neighbor]) {
            distances[neighbor] = altDistance;
            previous[neighbor] = {
              from: current,
              weight: weight,
              type: type
            };
          }
        }
      }
    }

    if (!Number.isFinite(distances[targetId])) {
      return null; // No hay ruta disponible (o bloqueada por escaleras)
    }

    // Reconstruir la ruta óptima
    const path = [];
    const segments = [];
    let curr = targetId;

    while (curr !== sourceId) {
      path.unshift(curr);
      const step = previous[curr];
      if (!step) return null;
      segments.unshift({
        from: step.from,
        to: curr,
        weight: step.weight,
        type: step.type
      });
      curr = step.from;
    }
    path.unshift(sourceId);

    return {
      path,
      segments,
      totalDistance: distances[targetId]
    };
  }

  // ========================================================
  // CÁLCULO Y PRESENTACIÓN DE LA RUTA
  // ========================================================
  function calculateAndDrawRoute() {
    const isAccessible = dom.checkAccessible.checked;
    const result = dijkstra(state.origin, state.destination, isAccessible);

    dom.layerRoute.innerHTML = '';

    if (!result) {
      dom.txtMeters.textContent = '—';
      dom.txtEta.textContent = 'Sin conexión';
      dom.txtNote.textContent = isAccessible 
        ? 'No hay camino accesible disponible evitando escaleras. Intenta desmarcar la casilla de accesibilidad.' 
        : 'No se encontró un camino entre los puntos seleccionados en el grafo actual.';
      dom.stepsList.innerHTML = '<li class="step-item" style="color: #dc2626;">Ruta no disponible en el mapa actual.</li>';
      dom.accessibilityBadge.textContent = '❌ Sin ruta';
      dom.accessibilityBadge.className = 'accessibility-indicator warning';
      renderNodes([]);
      return;
    }

    // Dibujar línea polilínea de la ruta solo si tiene 2 o más puntos
    if (result.path.length > 1) {
      const pointsString = result.path
        .map(id => `${state.nodes[id].x},${state.nodes[id].y}`)
        .join(' ');

      const polyline = createSvgElement('polyline', {
        points: pointsString,
        class: 'map-route-line'
      });
      dom.layerRoute.appendChild(polyline);
    }

    // Renderizar nodos con origen/destino destacados
    renderNodes(result.path);

    // Actualizar métricas
    dom.txtMeters.textContent = result.totalDistance;
    const walkingMinutes = Math.max(1, Math.ceil(result.totalDistance / 75)); // velocidad promedio peatonal: 75 m/min
    
    if (result.totalDistance === 0) {
      dom.txtEta.textContent = 'Origen y destino idénticos';
      dom.txtNote.textContent = 'Ya te encuentras en la ubicación seleccionada.';
    } else {
      dom.txtEta.textContent = `~${walkingMinutes} min caminando (${result.segments.length} tramos)`;
      dom.txtNote.textContent = `Ruta calculada con Dijkstra sobre ${result.segments.length} conexiones viales del campus.`;
    }

    // Indicador de accesibilidad
    const hasStairs = result.segments.some(s => s.type === 'escaleras');
    if (hasStairs) {
      dom.accessibilityBadge.innerHTML = '⚠️ Incluye escaleras';
      dom.accessibilityBadge.className = 'accessibility-indicator warning';
    } else {
      dom.accessibilityBadge.innerHTML = '♿ 100% Accesible';
      dom.accessibilityBadge.className = 'accessibility-indicator accessible';
    }

    // Generar instrucciones paso a paso
    dom.stepsList.innerHTML = '';
    const originNode = state.nodes[state.origin];
    const firstStep = document.createElement('li');
    firstStep.className = 'step-item start';
    firstStep.innerHTML = `<strong>Inicio:</strong> Estás en <u>${originNode.name}</u>${originNode.floor ? ` (${originNode.floor})` : ''}.`;
    dom.stepsList.appendChild(firstStep);

    result.segments.forEach(seg => {
      const destNode = state.nodes[seg.to];
      const li = document.createElement('li');
      li.className = 'step-item';

      let typeBadge = '<span class="step-tag walk">🚶 Peatonal</span>';
      let actionVerb = 'Camina hacia';

      if (seg.type === 'escaleras') {
        typeBadge = '<span class="step-tag stairs">🪜 Escaleras</span>';
        actionVerb = 'Sube/baja por las gradas hacia';
      } else if (seg.type === 'ascensor') {
        typeBadge = '<span class="step-tag elevator">🛗 Ascensor</span>';
        actionVerb = 'Usa el ascensor hacia';
      } else if (seg.type === 'rampa') {
        typeBadge = '<span class="step-tag walk">♿ Rampa</span>';
        actionVerb = 'Avanza por la rampa hacia';
      }

      li.innerHTML = `${actionVerb} <strong>${destNode.name}</strong> ${typeBadge} <small style="color:var(--text-muted); font-weight:600;">(${seg.weight} m)</small>`;
      dom.stepsList.appendChild(li);
    });

    const lastStep = document.createElement('li');
    lastStep.className = 'step-item end';
    const destNode = state.nodes[state.destination];
    lastStep.innerHTML = `<strong>Llegada:</strong> Has llegado a <u>${destNode.name}</u>.`;
    dom.stepsList.appendChild(lastStep);
  }

  // ========================================================
  // VISOR SVG: PAN Y ZOOM INTERACTIVO
  // ========================================================
  function setViewBox(vb) {
    state.viewBox = vb;
    dom.campusSvg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
  }

  function zoom(factor) {
    const cx = state.viewBox.x + state.viewBox.width / 2;
    const cy = state.viewBox.y + state.viewBox.height / 2;
    const newWidth = state.viewBox.width * factor;
    const newHeight = state.viewBox.height * factor;

    // Límites de zoom
    if (newWidth < 250 || newWidth > 2000) return;

    setViewBox({
      x: cx - newWidth / 2,
      y: cy - newHeight / 2,
      width: newWidth,
      height: newHeight
    });
  }

  function resetView() {
    setViewBox({ ...state.baseViewBox });
  }

  // Eventos de Pan & Zoom
  dom.mapContainer.addEventListener('mousedown', (e) => {
    if (e.target.closest('.map-node')) return; // No panear al hacer clic en un nodo
    state.isPanning = true;
    state.panStart = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mousemove', (e) => {
    if (!state.isPanning) return;
    const dx = (e.clientX - state.panStart.x) * (state.viewBox.width / dom.mapContainer.clientWidth);
    const dy = (e.clientY - state.panStart.y) * (state.viewBox.height / dom.mapContainer.clientHeight);

    setViewBox({
      x: state.viewBox.x - dx,
      y: state.viewBox.y - dy,
      width: state.viewBox.width,
      height: state.viewBox.height
    });

    state.panStart = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mouseup', () => {
    state.isPanning = false;
  });

  dom.mapContainer.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 0.89;
    zoom(factor);
  }, { passive: false });

  dom.btnZoomIn.addEventListener('click', () => zoom(0.8));
  dom.btnZoomOut.addEventListener('click', () => zoom(1.25));
  dom.btnResetView.addEventListener('click', resetView);

  // ========================================================
  // TOOLTIP EN NODOS
  // ========================================================
  function showTooltip(node, event) {
    const rect = dom.mapContainer.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    dom.mapTooltip.innerHTML = `
      <strong>${node.name}</strong><br>
      <span style="font-size:11px; opacity:0.85;">${node.category || 'Punto de interés'} · Piso ${node.floor || 'PB'}</span>
    `;
    dom.mapTooltip.style.left = `${x}px`;
    dom.mapTooltip.style.top = `${y}px`;
    dom.mapTooltip.style.display = 'block';
  }

  function moveTooltip(event) {
    const rect = dom.mapContainer.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    dom.mapTooltip.style.left = `${x}px`;
    dom.mapTooltip.style.top = `${y}px`;
  }

  function hideTooltip() {
    dom.mapTooltip.style.display = 'none';
  }

  // ========================================================
  // SECCIÓN DE EVENTOS
  // ========================================================
  function renderEvents() {
    dom.eventsGrid.innerHTML = '';
    const q = state.searchQuery.toLowerCase().trim();

    const filtered = state.events.filter(ev => {
      const matchCategory = state.selectedCategory === 'all' || ev.tag === state.selectedCategory;
      const text = `${ev.title} ${ev.place} ${ev.desc} ${ev.tag} ${ev.organizer || ''}`.toLowerCase();
      const matchSearch = !q || text.includes(q);
      return matchCategory && matchSearch;
    });

    if (filtered.length === 0) {
      dom.eventsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; background: #fff; border-radius: 14px; border: 1px dashed var(--border-medium);">
          <div style="font-size: 32px; margin-bottom: 8px;">🔍</div>
          <strong style="color: var(--primary-navy); font-size: 15px;">No se encontraron eventos</strong>
          <p style="color: var(--text-muted); font-size: 13px; margin-top: 4px;">Intenta cambiar los términos de búsqueda o seleccionar otra categoría.</p>
        </div>
      `;
      return;
    }

    filtered.forEach(ev => {
      const card = document.createElement('article');
      card.className = 'event-card';

      const tagColor = ev.color || '#1e5cc9';

      card.innerHTML = `
        <div class="event-meta-top">
          <span class="event-tag" style="background: ${tagColor}15; color: ${tagColor}; border: 1px solid ${tagColor}30;">
            ✦ ${ev.tag}
          </span>
          <span class="event-date-badge">
            📅 ${ev.date} · ${ev.time || ''}
          </span>
        </div>
        <h4>${ev.title}</h4>
        <p class="desc">${ev.desc}</p>
        <div class="event-location-box">
          <span>📍</span> <span>${ev.place}</span>
        </div>
        <button type="button" class="btn-route-event" data-node="${ev.nodeId}">
          🧭 Trazar ruta hacia este evento →
        </button>
      `;

      const btn = card.querySelector('.btn-route-event');
      btn.addEventListener('click', () => {
        if (state.nodes[ev.nodeId]) {
          state.destination = ev.nodeId;
          dom.selectDestination.value = ev.nodeId;
          calculateAndDrawRoute();
          // Scroll suave al mapa
          document.querySelector('.app-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          alert(`El lugar "${ev.place}" (${ev.nodeId}) no se encuentra mapeado en el grafo actual.`);
        }
      });

      dom.eventsGrid.appendChild(card);
    });
  }

  // Filtrado de eventos
  dom.inputSearchEvents.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderEvents();
  });

  dom.categoryFilterBar.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.selectedCategory = chip.dataset.category;
    renderEvents();
  });

  // ========================================================
  // CONTROLADORES DE FORMULARIO
  // ========================================================
  dom.selectOrigin.addEventListener('change', (e) => {
    state.origin = e.target.value;
    calculateAndDrawRoute();
  });

  dom.selectDestination.addEventListener('change', (e) => {
    state.destination = e.target.value;
    calculateAndDrawRoute();
  });

  dom.checkAccessible.addEventListener('change', () => {
    calculateAndDrawRoute();
  });

  dom.btnCalculate.addEventListener('click', () => {
    calculateAndDrawRoute();
  });

  dom.btnSwap.addEventListener('click', () => {
    const temp = state.origin;
    state.origin = state.destination;
    state.destination = temp;
    dom.selectOrigin.value = state.origin;
    dom.selectDestination.value = state.destination;
    calculateAndDrawRoute();
  });

  // ========================================================
  // CONTROL DE MODALES
  // ========================================================
  function openModal(modal) {
    if (modal) modal.classList.add('active');
  }

  function closeModal(modal) {
    if (modal) modal.classList.remove('active');
  }

  // Botones de apertura
  dom.btnOpenBudgetModal.addEventListener('click', () => openModal(dom.modalBudget));
  dom.linkBudgetFooter.addEventListener('click', (e) => { e.preventDefault(); openModal(dom.modalBudget); });
  dom.btnOpenImportModal.addEventListener('click', () => openModal(dom.modalImport));
  dom.linkImportFooter.addEventListener('click', (e) => { e.preventDefault(); openModal(dom.modalImport); });
  dom.btnOpenQrModal.addEventListener('click', () => openModal(dom.modalQr));

  // Cierre de modales con botón "X" o clic fuera del diálogo
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('btn-close-modal') || e.target.dataset.close) {
        closeModal(overlay);
      }
    });
  });

  // Cerrar con Escape
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach(closeModal);
    }
  });

  // ========================================================
  // IMPORTACIÓN DE GRAFO PERSONALIZADO (JSON)
  // ========================================================
  dom.btnApplyCustomGraph.addEventListener('click', () => {
    try {
      const raw = dom.txtGraphJson.value.trim();
      const parsed = JSON.parse(raw);

      if (!parsed.nodes || typeof parsed.nodes !== 'object') {
        throw new Error('El objeto JSON debe contener una propiedad "nodes" válida.');
      }
      if (!Array.isArray(parsed.edges)) {
        throw new Error('El objeto JSON debe contener un arreglo "edges" válido.');
      }

      initGraphData(parsed);
      closeModal(dom.modalImport);
      alert('¡Grafo del campus actualizado exitosamente!');
    } catch (err) {
      alert(`Error al procesar el JSON: ${err.message}`);
    }
  });

  dom.btnResetToDefaultGraph.addEventListener('click', () => {
    if (confirm('¿Deseas restaurar el grafo del campus original?')) {
      initGraphData(window.CampusData);
      closeModal(dom.modalImport);
    }
  });

  // API Global accesible para cargar datos directamente desde la consola o scripts externos
  window.loadCampusGraph = function (customData) {
    initGraphData(customData);
  };

  // ========================================================
  // LECTURA DE PARÁMETROS URL (SIMULACIÓN DE QR REAL)
  // ========================================================
  function parseUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    const originParam = params.get('origen');
    const destParam = params.get('destino');

    if (originParam && state.nodes[originParam]) {
      state.origin = originParam;
    }
    if (destParam && state.nodes[destParam]) {
      state.destination = destParam;
    }
  }

  // ========================================================
  // ARRANQUE
  // ========================================================
  parseUrlParameters();
  initGraphData(window.CampusData);

})();
