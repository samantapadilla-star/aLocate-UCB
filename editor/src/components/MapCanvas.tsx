import { useEffect, useMemo, useRef, useState } from 'react';
import { buildNodeMap, edgePolyline, formatLength } from '../core/graph';
import { dist, pointAlong, polylineLength, round2 } from '../core/geometry';
import type { Floor, Point } from '../core/types';
import type { ConnectDraft, Mode, Selection } from '../editorTypes';

/**
 * Lienzo: plano de fondo + capa SVG con el grafo, todo dentro de UN grupo con
 * transform = translate(tx,ty) scale(s). Los datos viven en píxeles de la imagen
 * original; zoom y desplazamiento solo cambian ese transform, por eso la alineación
 * se mantiene al cambiar el zoom o el tamaño de la ventana.
 *
 * Este componente solo traduce gestos a eventos ("clic en fondo", "clic en nodo"...).
 * Qué significan en cada modo lo decide App.
 */

export interface MapCanvasProps {
  floor: Floor;
  planUrl: string | null;
  mpp: number | null;
  mode: Mode;
  editable: boolean;
  selection: Selection;
  showLengths: boolean;
  connectDraft: ConnectDraft | null;
  calibPoints: Point[];
  routeOrigin: string | null;
  routeDest: string | null;
  routeEdgeIds: Set<string>;
  routeNodeIds: Set<string>;
  onBackgroundClick: (p: Point) => void;
  onNodeClick: (id: string, p: Point) => void;
  onEdgeClick: (id: string, p: Point) => void;
  onEdgeDoubleClick: (id: string, p: Point) => void;
  onWaypointDoubleClick: (edgeId: string, index: number) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  onNodeMove: (id: string, p: Point) => void;
  onWaypointMove: (edgeId: string, index: number, p: Point) => void;
}

interface View {
  s: number;
  tx: number;
  ty: number;
}

type Hit =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }
  | { type: 'wp'; edgeId: string; index: number }
  | { type: 'bg' };

type Gesture =
  | { kind: 'pan'; button: number; sx: number; sy: number; tx0: number; ty0: number; moved: boolean; hit: Hit }
  | { kind: 'node'; id: string; sx: number; sy: number; moved: boolean; started: boolean; off: Point }
  | { kind: 'wp'; edgeId: string; index: number; sx: number; sy: number; moved: boolean; started: boolean; off: Point };

const DRAG_THRESHOLD = 4; // px de pantalla: por debajo es un clic, no un arrastre
const DOUBLE_CLICK_MS = 400;
const MIN_SCALE = 0.02;
const MAX_SCALE = 40;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function MapCanvas(props: MapCanvasProps) {
  const { floor, planUrl, mpp, mode, editable, selection, showLengths, connectDraft, calibPoints } = props;
  const pw = floor.plan.width;
  const ph = floor.plan.height;

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const coordRef = useRef<HTMLSpanElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastClick = useRef<{ t: number; key: string; x: number; y: number } | null>(null);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;
  const [cursor, setCursor] = useState<Point | null>(null);

  const nodes = useMemo(() => buildNodeMap(floor), [floor]);

  /* ---- tamaño del contenedor ---- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = () => {
    if (size.w <= 0 || size.h <= 0) return;
    const s = clamp(Math.min((size.w - 40) / pw, (size.h - 40) / ph), MIN_SCALE, MAX_SCALE);
    setView({ s, tx: (size.w - pw * s) / 2, ty: (size.h - ph * s) / 2 });
  };

  // Ajuste inicial (el componente se remonta con otra `key` al cambiar de plano).
  useEffect(() => {
    if (!view && size.w > 0) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, view]);

  /* ---- zoom con rueda, centrado en el cursor ---- */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      if (!v) return;
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      const s = clamp(v.s * factor, MIN_SCALE, MAX_SCALE);
      const k = s / v.s;
      setView({ s, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const v = viewRef.current;
    if (!v) return;
    const mx = size.w / 2;
    const my = size.h / 2;
    const s = clamp(v.s * factor, MIN_SCALE, MAX_SCALE);
    const k = s / v.s;
    setView({ s, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k });
  };

  /* ---- conversión pantalla → coordenadas de la imagen ---- */
  const toImage = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current!;
    return { x: (e.clientX - r.left - v.tx) / v.s, y: (e.clientY - r.top - v.ty) / v.s };
  };
  const clampToPlan = (p: Point): Point => ({
    x: round2(clamp(p.x, 0, pw)),
    y: round2(clamp(p.y, 0, ph)),
  });

  const hitOf = (target: Element): Hit => {
    const wp = target.closest('[data-wp-edge]');
    if (wp) return { type: 'wp', edgeId: wp.getAttribute('data-wp-edge')!, index: Number(wp.getAttribute('data-wp-index')) };
    const n = target.closest('[data-node-id]');
    if (n) return { type: 'node', id: n.getAttribute('data-node-id')! };
    const ed = target.closest('[data-edge-id]');
    if (ed) return { type: 'edge', id: ed.getAttribute('data-edge-id')! };
    return { type: 'bg' };
  };

  /* ---- gestos ---- */
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!viewRef.current) return;
    const hit = hitOf(e.target as Element);
    const primary = e.button === 0;
    const p = toImage(e);
    if (primary && editable && mode === 'select' && hit.type === 'node') {
      const n = nodes.get(hit.id)!;
      gesture.current = {
        kind: 'node', id: hit.id, sx: e.clientX, sy: e.clientY, moved: false, started: false,
        off: { x: n.x - p.x, y: n.y - p.y },
      };
    } else if (primary && editable && mode === 'select' && hit.type === 'wp') {
      const w = floor.edges.find((x) => x.id === hit.edgeId)?.waypoints[hit.index];
      gesture.current = w
        ? {
            kind: 'wp', edgeId: hit.edgeId, index: hit.index, sx: e.clientX, sy: e.clientY, moved: false,
            started: false, off: { x: w.x - p.x, y: w.y - p.y },
          }
        : null;
    } else {
      const v = viewRef.current;
      gesture.current = {
        kind: 'pan', button: e.button, sx: e.clientX, sy: e.clientY, tx0: v.tx, ty0: v.ty, moved: false, hit,
      };
    }
    if (gesture.current) svgRef.current!.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!viewRef.current) return;
    const p = toImage(e);
    if (coordRef.current) {
      coordRef.current.textContent = `x ${p.x.toFixed(0)}, y ${p.y.toFixed(0)} px`;
    }
    if (connectDraft) setCursor(p);

    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) g.moved = true;
    if (!g.moved) return;

    if (g.kind === 'pan') {
      setView({ ...viewRef.current, tx: g.tx0 + dx, ty: g.ty0 + dy });
    } else if (g.kind === 'node') {
      if (!g.started) {
        g.started = true;
        props.onGestureStart();
      }
      props.onNodeMove(g.id, clampToPlan({ x: p.x + g.off.x, y: p.y + g.off.y }));
    } else {
      if (!g.started) {
        g.started = true;
        props.onGestureStart();
      }
      props.onWaypointMove(g.edgeId, g.index, clampToPlan({ x: p.x + g.off.x, y: p.y + g.off.y }));
    }
  };

  /** Detecta doble clic manualmente (con captura de puntero el evento nativo no llega al elemento). */
  const isDouble = (key: string, e: { clientX: number; clientY: number }): boolean => {
    const now = performance.now();
    const prev = lastClick.current;
    const double =
      !!prev && prev.key === key && now - prev.t < DOUBLE_CLICK_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 8;
    lastClick.current = double ? null : { t: now, key, x: e.clientX, y: e.clientY };
    return double;
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
    if (!g || !viewRef.current) return;
    const p = toImage(e);

    if (g.kind === 'node' || g.kind === 'wp') {
      if (g.moved) {
        if (g.started) props.onGestureEnd();
      } else if (g.kind === 'node') {
        props.onNodeClick(g.id, p);
      } else if (isDouble(`wp:${g.edgeId}:${g.index}`, e)) {
        props.onWaypointDoubleClick(g.edgeId, g.index);
      }
      return;
    }

    // Pan: si el puntero apenas se movió, es un clic.
    if (g.moved || g.button !== 0 || !editable) return;
    const hit = g.hit;
    if (hit.type === 'node') props.onNodeClick(hit.id, p);
    else if (hit.type === 'wp') {
      if (isDouble(`wp:${hit.edgeId}:${hit.index}`, e)) props.onWaypointDoubleClick(hit.edgeId, hit.index);
    } else if (hit.type === 'edge') {
      if (mode === 'select' && isDouble(`edge:${hit.id}`, e)) props.onEdgeDoubleClick(hit.id, p);
      else props.onEdgeClick(hit.id, p);
    } else {
      props.onBackgroundClick(p);
    }
  };

  const onPointerCancel = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g && g.kind !== 'pan' && g.started) props.onGestureEnd();
  };

  /* ---- dibujo ---- */
  const k = view ? 1 / view.s : 1; // compensa el zoom para que marcadores y textos mantengan su tamaño en pantalla
  const selEdge = selection?.type === 'edge' ? floor.edges.find((e) => e.id === selection.id) : undefined;
  const cursorClass = `mode-${mode}${connectDraft ? ' drafting' : ''}`;

  return (
    <div className={`canvas-wrap ${cursorClass}`} ref={wrapRef}>
      <svg
        ref={svgRef}
        className="canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => {
          if (coordRef.current) coordRef.current.textContent = '';
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {view && (
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.s})`}>
            {/* Plano */}
            {planUrl ? (
              <image href={planUrl} x={0} y={0} width={pw} height={ph} preserveAspectRatio="none" />
            ) : (
              <g>
                <rect x={0} y={0} width={pw} height={ph} className="plan-missing" />
                <text x={pw / 2} y={ph / 2} textAnchor="middle" fontSize={16 * k} className="plan-missing-text">
                  Plano no asociado — solo lectura
                </text>
              </g>
            )}
            <rect x={0} y={0} width={pw} height={ph} className="plan-border" vectorEffect="non-scaling-stroke" />

            {/* Calibración (visible mientras se calibra) */}
            {mode === 'calibrate' && floor.calibration && (
              <CalibLine a={floor.calibration.a} b={floor.calibration.b} k={k} className="calib-old"
                label={`${floor.calibration.realDistanceM} m`} />
            )}

            {/* Conexiones */}
            {floor.edges.map((edge) => {
              const poly = edgePolyline(edge, nodes);
              if (poly.length < 2) return null;
              const pts = poly.map((p) => `${p.x},${p.y}`).join(' ');
              const sel = selection?.type === 'edge' && selection.id === edge.id;
              const inRoute = props.routeEdgeIds.has(edge.id);
              return (
                <g key={edge.id}>
                  <polyline points={pts} fill="none" vectorEffect="non-scaling-stroke"
                    className={`edge kind-${edge.kind ?? 'camino'}${sel ? ' selected' : ''}${inRoute ? ' route' : ''}`} />
                  <polyline points={pts} fill="none" vectorEffect="non-scaling-stroke" data-edge-id={edge.id} className="edge-hit" />
                  {edge.waypoints.map((w, i) => (
                    <circle key={i} cx={w.x} cy={w.y} r={3 * k} className="turn-dot" />
                  ))}
                </g>
              );
            })}

            {/* Longitudes */}
            {showLengths &&
              floor.edges.map((edge) => {
                const poly = edgePolyline(edge, nodes);
                if (poly.length < 2) return null;
                const len = polylineLength(poly);
                const m = pointAlong(poly, len / 2);
                return (
                  <text key={edge.id} x={m.x} y={m.y - 6 * k} fontSize={11 * k} textAnchor="middle" className="edge-label">
                    {formatLength(len, mpp)}
                  </text>
                );
              })}

            {/* Tiradores de giros de la conexión seleccionada */}
            {mode === 'select' && editable && selEdge?.waypoints.map((w, i) => (
              <circle key={i} cx={w.x} cy={w.y} r={6 * k} data-wp-edge={selEdge.id} data-wp-index={i} className="wp-handle" />
            ))}

            {/* Conexión en curso */}
            {connectDraft && nodes.get(connectDraft.fromId) && (() => {
              const from = nodes.get(connectDraft.fromId)!;
              const pts = [{ x: from.x, y: from.y }, ...connectDraft.points, ...(cursor ? [cursor] : [])];
              return (
                <g className="draft" pointerEvents="none">
                  <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" vectorEffect="non-scaling-stroke" />
                  {connectDraft.points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4 * k} />)}
                </g>
              );
            })()}

            {/* Calibración en curso */}
            {mode === 'calibrate' && calibPoints.length > 0 && (
              calibPoints.length === 2 ? (
                <CalibLine a={calibPoints[0]} b={calibPoints[1]} k={k} className="calib-new"
                  label={`${dist(calibPoints[0], calibPoints[1]).toFixed(0)} px`} />
              ) : (
                <circle cx={calibPoints[0].x} cy={calibPoints[0].y} r={6 * k} className="calib-new-dot" />
              )
            )}

            {/* Nodos */}
            {floor.nodes.map((n) => {
              const cls = [
                'node',
                selection?.type === 'node' && selection.id === n.id ? 'selected' : '',
                props.routeNodeIds.has(n.id) ? 'onroute' : '',
                props.routeOrigin === n.id ? 'origin' : '',
                props.routeDest === n.id ? 'dest' : '',
                connectDraft?.fromId === n.id ? 'draft-start' : '',
              ].join(' ');
              return (
                <g key={n.id} data-node-id={n.id}>
                  <circle cx={n.x} cy={n.y} r={8 * k} className={cls} vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
            {floor.nodes.map((n) => (
              <text key={n.id} x={n.x} y={n.y + 22 * k} fontSize={12 * k} textAnchor="middle" className="node-label">
                {n.name}
              </text>
            ))}
          </g>
        )}
      </svg>

      <div className="canvas-tools">
        <button onClick={() => zoomBy(1.3)} title="Acercar" aria-label="Acercar">+</button>
        <button onClick={() => zoomBy(1 / 1.3)} title="Alejar" aria-label="Alejar">−</button>
        <button onClick={fit} title="Ajustar el plano a la ventana">Ajustar</button>
      </div>
      <div className="canvas-status">
        <span ref={coordRef} />
        {view && <span className="zoom">zoom {(view.s * 100).toFixed(0)}%</span>}
      </div>
      {mpp === null && (
        <div className="canvas-banner warn">
          Sin calibrar: las longitudes se muestran en píxeles. Usa el modo «Calibrar» para obtener metros.
        </div>
      )}
    </div>
  );
}

function CalibLine({ a, b, k, className, label }: { a: Point; b: Point; k: number; className: string; label: string }) {
  return (
    <g className={className} pointerEvents="none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke" />
      <circle cx={a.x} cy={a.y} r={5 * k} />
      <circle cx={b.x} cy={b.y} r={5 * k} />
      <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8 * k} fontSize={12 * k} textAnchor="middle">{label}</text>
    </g>
  );
}
