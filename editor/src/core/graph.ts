import { dist, polylineLength } from './geometry';
import type { Calibration, Floor, GraphEdge, GraphNode, Point } from './types';

/** Identificador corto y único. Siempre se genera FUERA de los reductores (deben ser puros). */
export function newId(prefix: string): string {
  const raw =
    globalThis.crypto?.randomUUID?.() ??
    `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return `${prefix}_${raw.replace(/-/g, '').slice(0, 10)}`;
}

/* ------------------------------ Lectura ------------------------------ */

export type NodeMap = Map<string, GraphNode>;

export const buildNodeMap = (floor: Floor): NodeMap => new Map(floor.nodes.map((n) => [n.id, n]));

/** Recorrido completo de una conexión: nodo a → giros → nodo b. */
export function edgePolyline(edge: GraphEdge, nodes: NodeMap): Point[] {
  const a = nodes.get(edge.a);
  const b = nodes.get(edge.b);
  if (!a || !b) return [];
  return [{ x: a.x, y: a.y }, ...edge.waypoints, { x: b.x, y: b.y }];
}

export const edgeLengthPx = (edge: GraphEdge, nodes: NodeMap): number =>
  polylineLength(edgePolyline(edge, nodes));

/* ------------------------------- Escala ------------------------------ */

/** Metros por píxel, o null si no hay escala válida (nunca se inventa una). */
export function metersPerPixel(c: Calibration | null): number | null {
  if (!c) return null;
  const px = dist(c.a, c.b);
  if (!(px > 0) || !(c.realDistanceM > 0)) return null;
  return c.realDistanceM / px;
}

/** "12.34 m" si hay escala; "123 px" si no la hay. */
export function formatLength(px: number, mpp: number | null): string {
  return mpp === null ? `${px.toFixed(0)} px` : `${(px * mpp).toFixed(2)} m`;
}

/* ----------------------------- Operaciones ---------------------------- */
/* Todas son puras: devuelven un Floor nuevo y no modifican el original. */

export function nextNodeName(floor: Floor): string {
  let max = 0;
  for (const n of floor.nodes) {
    const m = /^Nodo (\d+)$/.exec(n.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Nodo ${max + 1}`;
}

export function addNode(floor: Floor, id: string, p: Point): Floor {
  const node: GraphNode = { id, name: nextNodeName(floor), x: p.x, y: p.y };
  return { ...floor, nodes: [...floor.nodes, node] };
}

export function moveNode(floor: Floor, id: string, p: Point): Floor {
  return { ...floor, nodes: floor.nodes.map((n) => (n.id === id ? { ...n, x: p.x, y: p.y } : n)) };
}

export function renameNode(floor: Floor, id: string, name: string): Floor {
  const clean = name.trim();
  if (!clean) return floor;
  return { ...floor, nodes: floor.nodes.map((n) => (n.id === id ? { ...n, name: clean } : n)) };
}

/** Eliminar un nodo elimina también todas las conexiones que llegan a él. */
export function deleteNode(floor: Floor, id: string): Floor {
  return {
    ...floor,
    nodes: floor.nodes.filter((n) => n.id !== id),
    edges: floor.edges.filter((e) => e.a !== id && e.b !== id),
  };
}

export type AddEdgeResult = { ok: true; floor: Floor } | { ok: false; error: string };

export function addEdge(
  floor: Floor,
  id: string,
  a: string,
  b: string,
  waypoints: Point[],
): AddEdgeResult {
  if (a === b) return { ok: false, error: 'Una conexión necesita dos nodos distintos.' };
  const ids = new Set(floor.nodes.map((n) => n.id));
  if (!ids.has(a) || !ids.has(b)) return { ok: false, error: 'Alguno de los nodos ya no existe.' };
  if (floor.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) {
    return {
      ok: false,
      error: 'Ya existe una conexión entre esos nodos. Selecciónala para editar sus giros.',
    };
  }
  const edge: GraphEdge = { id, a, b, waypoints: waypoints.map((p) => ({ x: p.x, y: p.y })) };
  return { ok: true, floor: { ...floor, edges: [...floor.edges, edge] } };
}

export function deleteEdge(floor: Floor, id: string): Floor {
  return { ...floor, edges: floor.edges.filter((e) => e.id !== id) };
}

export function setWaypoints(floor: Floor, edgeId: string, waypoints: Point[]): Floor {
  return { ...floor, edges: floor.edges.map((e) => (e.id === edgeId ? { ...e, waypoints } : e)) };
}

export function setCalibration(floor: Floor, calibration: Calibration | null): Floor {
  return { ...floor, calibration };
}
