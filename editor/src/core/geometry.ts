import type { Point } from './types';

export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export function polylineLength(pts: Point[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

/** Punto situado a la distancia `d` (en px) recorrida sobre la polilínea. */
export function pointAlong(pts: Point[], d: number): Point {
  if (pts.length === 0) return { x: 0, y: 0 };
  let remaining = d;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = dist(a, b);
    if (seg > 0 && remaining <= seg) {
      const t = remaining / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= seg;
  }
  return pts[pts.length - 1];
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + dx * t, y: a.y + dy * t });
}

/**
 * Índice del tramo de la polilínea más cercano a `p`.
 * Si la polilínea es [A, w0, w1, B], el tramo i va de poly[i] a poly[i+1];
 * insertar un giro en ese tramo equivale a `waypoints.splice(i, 0, p)`.
 */
export function nearestSegmentIndex(poly: Point[], p: Point): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const d = distanceToSegment(p, poly[i], poly[i + 1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
