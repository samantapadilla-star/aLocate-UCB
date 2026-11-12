import { buildNodeMap, edgeLengthPx } from './graph';
import type { Floor } from './types';

export interface RouteStep {
  edgeId: string;
  from: string;
  to: string;
  lengthPx: number;
}

export type RouteResult =
  | { found: true; nodeIds: string[]; steps: RouteStep[]; totalPx: number }
  | { found: false; reason: 'unknown-node' | 'no-path' };

/** Cola de prioridad mínima (montículo binario). */
class MinHeap {
  private items: { key: number; id: string }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(key: number, id: string): void {
    const a = this.items;
    a.push({ key, id });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].key <= a[i].key) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }

  pop(): { key: number; id: string } | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].key < a[m].key) m = l;
        if (r < a.length && a[r].key < a[m].key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Dijkstra sobre el grafo de un piso. El peso de cada conexión es la longitud de
 * su recorrido (con giros) en píxeles; la escala solo se aplica al mostrar el resultado.
 * Las conexiones son bidireccionales.
 */
export interface RouteOptions {
  /** Ruta accesible: no usa tramos de tipo «escaleras». */
  avoidStairs?: boolean;
}

export function shortestPath(floor: Floor, originId: string, destId: string, opts: RouteOptions = {}): RouteResult {
  const nodes = buildNodeMap(floor);
  if (!nodes.has(originId) || !nodes.has(destId)) return { found: false, reason: 'unknown-node' };
  if (originId === destId) return { found: true, nodeIds: [originId], steps: [], totalPx: 0 };

  const adjacency = new Map<string, { edgeId: string; to: string; w: number }[]>();
  for (const e of floor.edges) {
    if (!nodes.has(e.a) || !nodes.has(e.b)) continue;
    if (opts.avoidStairs && e.kind === 'escaleras') continue;
    const w = edgeLengthPx(e, nodes);
    (adjacency.get(e.a) ?? adjacency.set(e.a, []).get(e.a)!).push({ edgeId: e.id, to: e.b, w });
    (adjacency.get(e.b) ?? adjacency.set(e.b, []).get(e.b)!).push({ edgeId: e.id, to: e.a, w });
  }

  const best = new Map<string, number>([[originId, 0]]);
  const prev = new Map<string, { node: string; edgeId: string; w: number }>();
  const done = new Set<string>();
  const heap = new MinHeap();
  heap.push(0, originId);

  while (heap.size > 0) {
    const { key, id } = heap.pop()!;
    if (done.has(id)) continue;
    done.add(id);
    if (id === destId) break;
    for (const { edgeId, to, w } of adjacency.get(id) ?? []) {
      const candidate = key + w;
      if (candidate < (best.get(to) ?? Infinity)) {
        best.set(to, candidate);
        prev.set(to, { node: id, edgeId, w });
        heap.push(candidate, to);
      }
    }
  }

  if (!done.has(destId)) return { found: false, reason: 'no-path' };

  const steps: RouteStep[] = [];
  const nodeIds: string[] = [destId];
  for (let cur = destId; cur !== originId; ) {
    const p = prev.get(cur)!;
    steps.push({ edgeId: p.edgeId, from: p.node, to: cur, lengthPx: p.w });
    nodeIds.push(p.node);
    cur = p.node;
  }
  steps.reverse();
  nodeIds.reverse();
  return { found: true, nodeIds, steps, totalPx: best.get(destId)! };
}
