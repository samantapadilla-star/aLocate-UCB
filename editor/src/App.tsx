import { useEffect, useMemo, useRef, useState } from 'react';
import MapCanvas from './components/MapCanvas';
import { shortestPath } from './core/dijkstra';
import { buildDemoProject, DEMO_HEIGHT, DEMO_WIDTH } from './core/demo';
import { dist, nearestSegmentIndex, round2 } from './core/geometry';
import {
  addEdge, addNode, buildNodeMap, deleteEdge, deleteNode, edgeLengthPx, edgePolyline, formatLength,
  metersPerPixel, moveNode, newId, renameNode, setCalibration, setWaypoints,
} from './core/graph';
import {
  createProject, parseProject, primaryFloor, ProjectFormatError, renameProject, serializeProject, updateFloor,
} from './core/project';
import type { Floor, PlanRef, Point, Project } from './core/types';
import type { ConnectDraft, Mode, Notice, Selection } from './editorTypes';
import { useHistory } from './hooks/useHistory';
import {
  blobToDataUrl, comparePlan, dataUrlToBlob, drawDemoPlan, inspectImage, isSupportedImage, makeAsset, readPlanFile,
  type PlanAsset,
} from './lib/image';

const MODES: { id: Mode; label: string; key: string; hint: string }[] = [
  { id: 'select', label: 'Seleccionar / mover', key: '1',
    hint: 'Clic en un nodo o conexión para seleccionarlo. Arrastra un nodo para moverlo. Arrastra el fondo para desplazar el mapa. Con una conexión seleccionada: arrastra sus puntos de giro, doble clic en la línea para añadir un giro y doble clic en un punto para quitarlo.' },
  { id: 'node', label: 'Crear nodos', key: '2',
    hint: 'Clic en el plano para crear un nodo. Arrastrar el mapa solo lo desplaza; no crea nodos.' },
  { id: 'connect', label: 'Conectar', key: '3',
    hint: '1) Clic en el nodo de inicio. 2) Clics en espacio libre para marcar los giros del pasillo (la línea seguirá ese recorrido). 3) Clic en el nodo final. Esc cancela.' },
  { id: 'calibrate', label: 'Calibrar', key: '4',
    hint: 'Haz clic en dos puntos del plano cuya distancia real conozcas (por ejemplo, los extremos de un pasillo medido) e indica esa distancia en metros.' },
  { id: 'route', label: 'Probar ruta', key: '5',
    hint: 'Clic en un nodo para fijar el origen y en otro para el destino (o elígelos en las listas). Un tercer clic empieza de nuevo.' },
];

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'proyecto';

function download(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const hist = useHistory<Project | null>(null);
  const project = hist.present;
  const floor: Floor | null = project ? primaryFloor(project) : null;

  const [asset, setAsset] = useState<PlanAsset | null>(null);
  const [saved, setSaved] = useState<Project | null>(null);
  const [mode, setModeState] = useState<Mode>('select');
  const [selection, setSelection] = useState<Selection>(null);
  const [draft, setDraft] = useState<ConnectDraft | null>(null);
  const [chain, setChain] = useState(false);
  const [calibPoints, setCalibPoints] = useState<Point[]>([]);
  const [calibInput, setCalibInput] = useState('');
  const [origin, setOrigin] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [showLengths, setShowLengths] = useState(true);
  const [embed, setEmbed] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const attachInput = useRef<HTMLInputElement>(null);

  /* ------------------------------ derivados ------------------------------ */
  const nodes = useMemo(() => (floor ? buildNodeMap(floor) : new Map()), [floor]);
  const mpp = floor ? metersPerPixel(floor.calibration) : null;
  const canEdit = !!asset;
  const dirty = project !== saved;
  const originId = origin && nodes.has(origin) ? origin : null;
  const destId = dest && nodes.has(dest) ? dest : null;
  const selNode = selection?.type === 'node' ? nodes.get(selection.id) ?? null : null;
  const selEdge = selection?.type === 'edge' && floor ? floor.edges.find((e) => e.id === selection.id) ?? null : null;

  const route = useMemo(
    () => (floor && originId && destId ? shortestPath(floor, originId, destId) : null),
    [floor, originId, destId],
  );
  const routeEdgeIds = useMemo(() => new Set(route?.found ? route.steps.map((s) => s.edgeId) : []), [route]);
  const routeNodeIds = useMemo(() => new Set(route?.found ? route.nodeIds : []), [route]);

  const say = (kind: Notice['kind'], text: string) => setNotice({ kind, text });
  useEffect(() => {
    if (!notice || notice.kind === 'error') return;
    const t = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(t);
  }, [notice]);

  // Libera la URL temporal (blob:) del plano anterior.
  useEffect(() => () => { if (asset) URL.revokeObjectURL(asset.url); }, [asset]);

  // Avisa antes de cerrar la pestaña con cambios sin exportar.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  /* ------------------------------ edición ------------------------------- */
  const mutate = (fn: (f: Floor) => Floor) =>
    hist.set((p) => (p ? updateFloor(p, primaryFloor(p).id, fn) : p));
  const mutateSilently = (fn: (f: Floor) => Floor) =>
    hist.replace((p) => (p ? updateFloor(p, primaryFloor(p).id, fn) : p));

  const resetEphemeral = () => {
    setSelection(null); setDraft(null); setCalibPoints([]); setOrigin(null); setDest(null); setModeState('select');
  };

  const changeMode = (m: Mode) => {
    setModeState(m);
    setDraft(null);
    setCalibPoints([]);
    if (m === 'calibrate') setCalibInput(floor?.calibration ? String(floor.calibration.realDistanceM) : '');
  };

  const doUndo = () => { hist.undo(); setDraft(null); setCalibPoints([]); };
  const doRedo = () => { hist.redo(); setDraft(null); setCalibPoints([]); };

  const deleteSelection = () => {
    if (!selection) return;
    if (selection.type === 'node') mutate((f) => deleteNode(f, selection.id));
    else mutate((f) => deleteEdge(f, selection.id));
    setSelection(null);
  };

  const finishEdge = (toId: string) => {
    if (!floor || !draft) return;
    const id = newId('e');
    const res = addEdge(floor, id, draft.fromId, toId, draft.points);
    if (!res.ok) { say('error', res.error); return; }
    mutate((f) => { const r = addEdge(f, id, draft.fromId, toId, draft.points); return r.ok ? r.floor : f; });
    if (chain) { setDraft({ fromId: toId, points: [] }); setSelection(null); }
    else { setDraft(null); setSelection({ type: 'edge', id }); }
  };

  const addCalibPoint = (p: Point) => setCalibPoints((pts) => (pts.length >= 2 ? [p] : [...pts, p]));

  const onBackgroundClick = (p: Point) => {
    if (!floor || !canEdit) return;
    const q = { x: round2(p.x), y: round2(p.y) };
    if (mode === 'node') {
      const id = newId('n');
      mutate((f) => addNode(f, id, q));
      setSelection({ type: 'node', id });
    } else if (mode === 'connect') {
      if (draft) setDraft({ ...draft, points: [...draft.points, q] });
    } else if (mode === 'calibrate') addCalibPoint(q);
    else if (mode === 'select') setSelection(null);
  };

  const onNodeClick = (id: string, p: Point) => {
    if (!canEdit) return;
    if (mode === 'select' || mode === 'node') setSelection({ type: 'node', id });
    else if (mode === 'connect') {
      if (!draft) setDraft({ fromId: id, points: [] });
      else if (id === draft.fromId) {
        if (draft.points.length === 0) setDraft(null);
        else say('error', 'El recorrido no puede terminar en el mismo nodo de inicio.');
      } else finishEdge(id);
    } else if (mode === 'calibrate') addCalibPoint({ x: round2(p.x), y: round2(p.y) });
    else if (mode === 'route') {
      if (!originId || (originId && destId)) { setOrigin(id); setDest(null); }
      else if (id !== originId) setDest(id);
    }
  };

  const onEdgeClick = (id: string, p: Point) => {
    if (!canEdit) return;
    if (mode === 'select') setSelection({ type: 'edge', id });
    else onBackgroundClick(p); // en los demás modos, una línea no debe tapar el plano
  };

  const onEdgeDoubleClick = (id: string, p: Point) => {
    if (!floor) return;
    const edge = floor.edges.find((e) => e.id === id);
    if (!edge) return;
    const idx = nearestSegmentIndex(edgePolyline(edge, nodes), p);
    const q = { x: round2(p.x), y: round2(p.y) };
    mutate((f) => {
      const e = f.edges.find((x) => x.id === id);
      if (!e) return f;
      const w = [...e.waypoints];
      w.splice(idx, 0, q);
      return setWaypoints(f, id, w);
    });
    setSelection({ type: 'edge', id });
  };

  const onWaypointDoubleClick = (edgeId: string, index: number) =>
    mutate((f) => {
      const e = f.edges.find((x) => x.id === edgeId);
      return e ? setWaypoints(f, edgeId, e.waypoints.filter((_, i) => i !== index)) : f;
    });

  const onWaypointMove = (edgeId: string, index: number, p: Point) =>
    mutateSilently((f) => {
      const e = f.edges.find((x) => x.id === edgeId);
      return e ? setWaypoints(f, edgeId, e.waypoints.map((w, i) => (i === index ? p : w))) : f;
    });

  const applyCalibration = () => {
    if (!floor) return;
    const meters = Number(calibInput.trim().replace(',', '.'));
    if (!Number.isFinite(meters) || meters <= 0) { say('error', 'Indica una distancia real mayor que 0 (en metros).'); return; }
    const pts = calibPoints.length === 2 ? calibPoints : floor.calibration ? [floor.calibration.a, floor.calibration.b] : null;
    if (!pts) { say('error', 'Marca primero dos puntos en el plano.'); return; }
    if (dist(pts[0], pts[1]) < 2) { say('error', 'Los dos puntos están demasiado cerca. Elige puntos más separados.'); return; }
    mutate((f) => setCalibration(f, { a: pts[0], b: pts[1], realDistanceM: meters }));
    setCalibPoints([]);
    say('ok', `Escala aplicada: ${meters} m = ${dist(pts[0], pts[1]).toFixed(0)} px (1 px = ${(meters / dist(pts[0], pts[1])).toFixed(4)} m).`);
  };

  /* ------------------------ cargar / exportar / importar ------------------------ */
  const confirmDiscard = () =>
    !project || !dirty || window.confirm('Hay cambios sin exportar. ¿Descartarlos y continuar?');

  const startProject = (p: Project, a: PlanAsset | null) => {
    setAsset(a);
    hist.reset(p);
    setSaved(p);
    resetEphemeral();
  };

  const loadPlan = async (file: File) => {
    try {
      if (!confirmDiscard()) return;
      const { ref, asset: a } = await readPlanFile(file);
      startProject(createProject(ref, file.name.replace(/\.[^.]+$/, '')), a);
      say('ok', `Plano cargado: ${ref.width}×${ref.height} px. Siguiente paso: calibrar la escala.`);
    } catch (e) {
      say('error', (e as Error).message);
    }
  };

  const loadDemo = async () => {
    try {
      if (!confirmDiscard()) return;
      const blob = await drawDemoPlan(DEMO_WIDTH, DEMO_HEIGHT);
      const info = await inspectImage(blob);
      const ref: PlanRef = { fileName: 'demo-plano.png', mimeType: 'image/png', ...info };
      startProject(buildDemoProject(ref), makeAsset(blob));
      say('info', 'Demostración cargada: plano y medidas ficticios, no son de la UCB.');
    } catch (e) {
      say('error', (e as Error).message);
    }
  };

  const importProject = async (file: File) => {
    try {
      const { project: p, embedded } = parseProject(await file.text());
      if (!confirmDiscard()) return;
      const f = primaryFloor(p);
      let a: PlanAsset | null = null;
      const dataUrl = embedded[f.id];
      if (dataUrl) {
        const blob = await dataUrlToBlob(dataUrl);
        const match = comparePlan(await inspectImage(blob), f.plan);
        if (match !== 'exact') throw new ProjectFormatError('La imagen incrustada no coincide con su huella SHA-256: el archivo está dañado o fue editado.');
        a = makeAsset(blob);
      }
      startProject(p, a);
      say(a ? 'ok' : 'info', a
        ? `Proyecto «${p.name}» importado con su plano (verificado por SHA-256).`
        : `Proyecto «${p.name}» importado SIN imagen. Asocia el plano «${f.plan.fileName}» para poder editar.`);
    } catch (e) {
      say('error', e instanceof ProjectFormatError ? `No se pudo importar: ${e.message}` : `Error al importar: ${(e as Error).message}`);
    }
  };

  const attachPlan = async (file: File) => {
    if (!floor) return;
    try {
      if (!isSupportedImage(file)) throw new Error('El plano debe ser un archivo PNG o JPG.');
      const info = await inspectImage(file);
      const match = comparePlan(info, floor.plan);
      if (match === 'different') {
        throw new Error(`Este no es el plano del proyecto. Se esperaba ${floor.plan.width}×${floor.plan.height} px y se recibió ${info.width}×${info.height} px.`);
      }
      if (match === 'same-size' && !window.confirm(
        'La imagen tiene el mismo tamaño pero NO es byte a byte la misma (otra huella SHA-256). Si fue recortada, reescalada o retocada, los nodos podrían no alinear. ¿Usarla de todos modos?')) return;
      setAsset(makeAsset(file));
      say('ok', match === 'exact' ? 'Plano asociado y verificado (misma huella SHA-256).' : 'Plano asociado (tamaño coincidente, huella distinta).');
    } catch (e) {
      say('error', (e as Error).message);
    }
  };

  const exportProject = async () => {
    if (!project || !floor) return;
    try {
      const embeddedPlans = embed && asset ? { [floor.id]: await blobToDataUrl(asset.blob) } : undefined;
      download(serializeProject(project, embeddedPlans), `${slug(project.name)}.ucbnav.json`);
      setSaved(project);
      say('ok', embeddedPlans
        ? 'Proyecto exportado con el plano incrustado. Está en tu carpeta de Descargas.'
        : `Proyecto exportado SIN imagen: para reabrirlo tendrás que seleccionar «${floor.plan.fileName}». Está en tu carpeta de Descargas.`);
    } catch (e) {
      say('error', (e as Error).message);
    }
  };

  /* ------------------------------- teclado ------------------------------- */
  const kb = useRef({ doUndo, doRedo, deleteSelection, changeMode, setDraft, setCalibPoints, setSelection, draft, calibPoints });
  kb.current = { doUndo, doRedo, deleteSelection, changeMode, setDraft, setCalibPoints, setSelection, draft, calibPoints };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const c = kb.current;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) c.doRedo(); else c.doUndo(); }
      else if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); c.doRedo(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') c.deleteSelection();
      else if (e.key === 'Escape') {
        if (c.draft || c.calibPoints.length) { c.setDraft(null); c.setCalibPoints([]); } else c.setSelection(null);
      } else if (!ctrl && !e.altKey) {
        const m = MODES.find((x) => x.key === e.key);
        if (m) c.changeMode(m.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* -------------------------------- vista -------------------------------- */
  const nm = (id: string) => nodes.get(id)?.name ?? '?';
  const sortedNodes = floor ? [...floor.nodes].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })) : [];
  const modeInfo = MODES.find((m) => m.id === mode)!;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Editor de grafos de navegación</h1>
        <div className="spacer" />
        <button onClick={() => fileInput.current?.click()}>Cargar plano…</button>
        <button onClick={loadDemo}>Demostración</button>
        <button onClick={() => projectInput.current?.click()}>Importar proyecto…</button>
        <button className="primary" disabled={!project} onClick={exportProject}>Exportar proyecto</button>
        <span className="sep" />
        <button disabled={!hist.canUndo} onClick={doUndo} title="Ctrl+Z">Deshacer</button>
        <button disabled={!hist.canRedo} onClick={doRedo} title="Ctrl+Y">Rehacer</button>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void loadPlan(f); }} />
        <input ref={projectInput} type="file" accept=".json,application/json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importProject(f); }} />
        <input ref={attachInput} type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void attachPlan(f); }} />
      </header>

      {!project || !floor ? (
        <main className="welcome">
          <h2>Empieza cargando un plano</h2>
          <p>Elige una imagen PNG o JPG del plano, importa un proyecto guardado, o prueba la demostración (plano y medidas ficticios).</p>
          <div className="row">
            <button className="primary" onClick={() => fileInput.current?.click()}>Cargar plano…</button>
            <button onClick={() => projectInput.current?.click()}>Importar proyecto…</button>
            <button onClick={loadDemo}>Cargar demostración</button>
          </div>
          {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
        </main>
      ) : (
        <>
          <nav className="modes" aria-label="Modos de edición">
            {MODES.map((m) => (
              <button key={m.id} className={mode === m.id ? 'active' : ''} aria-pressed={mode === m.id}
                disabled={!canEdit} onClick={() => changeMode(m.id)} title={`Atajo: ${m.key}`}>
                <kbd>{m.key}</kbd> {m.label}
              </button>
            ))}
            <div className="spacer" />
            <label className="check"><input type="checkbox" checked={showLengths} onChange={(e) => setShowLengths(e.target.checked)} /> Mostrar longitudes</label>
          </nav>

          <div className="main">
            <MapCanvas
              key={floor.id + floor.plan.sha256}
              floor={floor} planUrl={asset?.url ?? null} mpp={mpp} mode={mode} editable={canEdit}
              selection={selection} showLengths={showLengths} connectDraft={draft} calibPoints={calibPoints}
              routeOrigin={originId} routeDest={destId} routeEdgeIds={routeEdgeIds} routeNodeIds={routeNodeIds}
              onBackgroundClick={onBackgroundClick} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick}
              onEdgeDoubleClick={onEdgeDoubleClick} onWaypointDoubleClick={onWaypointDoubleClick}
              onGestureStart={hist.begin} onGestureEnd={hist.end}
              onNodeMove={(id, p) => mutateSilently((f) => moveNode(f, id, p))}
              onWaypointMove={onWaypointMove}
            />

            <aside className="panel">
              {!canEdit && (
                <section className="card warn">
                  <h3>Falta asociar el plano</h3>
                  <p>Este proyecto se importó sin imagen. Selecciona <b>{floor.plan.fileName}</b> ({floor.plan.width}×{floor.plan.height} px) para editar; se comprobará su huella SHA-256.</p>
                  <p className="mono small">sha256: {floor.plan.sha256.slice(0, 16)}…</p>
                  <button className="primary" onClick={() => attachInput.current?.click()}>Asociar plano…</button>
                </section>
              )}

              <section className="card">
                <h3>{modeInfo.label}</h3>
                <p className="hint">{modeInfo.hint}</p>
                {mode === 'connect' && (
                  <label className="check"><input type="checkbox" checked={chain} onChange={(e) => setChain(e.target.checked)} /> Encadenar: seguir desde el último nodo</label>
                )}
                {mode === 'connect' && draft && (
                  <p className="status">Conectando desde <b>{nm(draft.fromId)}</b> · {draft.points.length} giro(s). Clic en el nodo final o Esc.</p>
                )}
              </section>

              {mode === 'calibrate' && (
                <section className="card">
                  <h3>Escala</h3>
                  <p className="status">
                    {calibPoints.length === 0 && 'Marca el punto A en el plano.'}
                    {calibPoints.length === 1 && 'Marca el punto B.'}
                    {calibPoints.length === 2 && `Distancia medida: ${dist(calibPoints[0], calibPoints[1]).toFixed(1)} px.`}
                  </p>
                  <label className="field">Distancia real entre A y B (metros)
                    <input inputMode="decimal" value={calibInput} placeholder="p. ej. 12.5"
                      onChange={(e) => setCalibInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') applyCalibration(); }} />
                  </label>
                  <div className="row">
                    <button className="primary" onClick={applyCalibration}
                      disabled={calibPoints.length !== 2 && !floor.calibration}>
                      {calibPoints.length === 2 ? 'Aplicar escala' : 'Actualizar distancia'}
                    </button>
                    {floor.calibration && <button onClick={() => mutate((f) => setCalibration(f, null))}>Quitar escala</button>}
                  </div>
                  <p className="small muted">Puedes recalibrar cuando quieras: todas las longitudes se recalculan solas.</p>
                </section>
              )}

              {mode === 'route' && (
                <section className="card">
                  <h3>Ruta más corta</h3>
                  <label className="field">Origen
                    <select value={originId ?? ''} onChange={(e) => setOrigin(e.target.value || null)}>
                      <option value="">— elegir —</option>
                      {sortedNodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                    </select>
                  </label>
                  <label className="field">Destino
                    <select value={destId ?? ''} onChange={(e) => setDest(e.target.value || null)}>
                      <option value="">— elegir —</option>
                      {sortedNodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                    </select>
                  </label>
                  <div className="row">
                    <button onClick={() => { setOrigin(destId); setDest(originId); }} disabled={!originId && !destId}>Intercambiar</button>
                    <button onClick={() => { setOrigin(null); setDest(null); }} disabled={!originId && !destId}>Limpiar</button>
                  </div>
                  {route && !route.found && route.reason === 'no-path' && (
                    <div className="notice error" role="status">
                      No hay ruta entre <b>{nm(originId!)}</b> y <b>{nm(destId!)}</b>: no existe una cadena de conexiones que los una.
                      (Dos líneas que solo se cruzan no cuentan: deben compartir un nodo.)
                    </div>
                  )}
                  {route?.found && (
                    <div className="result">
                      <p className="total">Distancia total: <b>{formatLength(route.totalPx, mpp)}</b>
                        {mpp !== null && <span className="muted"> ({route.totalPx.toFixed(1)} px)</span>}</p>
                      {mpp === null && <p className="small warn-text">Sin calibrar: se muestran píxeles, no metros.</p>}
                      {route.steps.length === 0 ? <p className="muted">Origen y destino son el mismo nodo.</p> : (
                        <ol className="steps">
                          {route.steps.map((s, i) => (
                            <li key={s.edgeId + i}><span>{nm(s.from)} → {nm(s.to)}</span><b>{formatLength(s.lengthPx, mpp)}</b></li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                </section>
              )}

              <section className="card">
                <h3>Selección</h3>
                {!selNode && !selEdge && <p className="muted">Nada seleccionado.</p>}
                {selNode && floor && (
                  <>
                    <NameField key={selNode.id} value={selNode.name} onCommit={(v) => mutate((f) => renameNode(f, selNode.id, v))} />
                    <p className="small mono">x {selNode.x.toFixed(1)}, y {selNode.y.toFixed(1)} px</p>
                    <ul className="plain">
                      {floor.edges.filter((e) => e.a === selNode.id || e.b === selNode.id).map((e) => (
                        <li key={e.id}>
                          <button className="link" onClick={() => setSelection({ type: 'edge', id: e.id })}>
                            → {nm(e.a === selNode.id ? e.b : e.a)}
                          </button>
                          <b>{formatLength(edgeLengthPx(e, nodes), mpp)}</b>
                        </li>
                      ))}
                    </ul>
                    <button className="danger" onClick={deleteSelection}>Eliminar nodo (y sus conexiones)</button>
                  </>
                )}
                {selEdge && (
                  <>
                    <p><b>{nm(selEdge.a)}</b> ↔ <b>{nm(selEdge.b)}</b></p>
                    <p>Longitud del recorrido: <b>{formatLength(edgeLengthPx(selEdge, nodes), mpp)}</b></p>
                    <p className="small muted">{selEdge.waypoints.length} giro(s). En «Seleccionar / mover»: arrastra los puntos, doble clic en la línea para añadir uno, doble clic en un punto para quitarlo.</p>
                    <button className="danger" onClick={deleteSelection}>Eliminar conexión</button>
                  </>
                )}
              </section>

              <section className="card">
                <h3>Proyecto</h3>
                <NameField key={project.name} label="Nombre" value={project.name} onCommit={(v) => hist.set((p) => (p ? renameProject(p, v) : p))} />
                <p className="small">
                  Plano: {floor.plan.fileName} · {floor.plan.width}×{floor.plan.height} px<br />
                  Escala: {mpp === null ? <b className="warn-text">sin calibrar (se muestran píxeles)</b>
                    : <b>1 px = {mpp.toFixed(4)} m</b>}<br />
                  {floor.nodes.length} nodos · {floor.edges.length} conexiones{dirty ? ' · cambios sin exportar' : ''}
                </p>
                <label className="check"><input type="checkbox" checked={embed} onChange={(e) => setEmbed(e.target.checked)} /> Incrustar el plano en el archivo exportado</label>
              </section>
            </aside>
          </div>
          {notice && (
            <div className={`toast notice ${notice.kind}`} role="status">
              <span>{notice.text}</span>
              <button className="link" onClick={() => setNotice(null)} aria-label="Cerrar">✕</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Campo de texto que confirma el cambio al salir o con Enter (así no se crea una entrada de historial por letra). */
function NameField({ value, onCommit, label = 'Nombre del nodo' }: { value: string; onCommit: (v: string) => void; label?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { if (v.trim() && v.trim() !== value) onCommit(v); else setV(value); };
  return (
    <label className="field">{label}
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value); (e.target as HTMLInputElement).blur(); } }} />
    </label>
  );
}
