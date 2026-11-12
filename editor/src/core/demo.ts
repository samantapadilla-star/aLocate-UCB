import { FORMAT_ID, FORMAT_VERSION, type PlanRef, type Project } from './types';

/**
 * PROYECTO DE DEMOSTRACIÓN. No representa ninguna ubicación ni medida real de la UCB.
 * Es un grafo pequeño pensado para comprobar a mano:
 *
 *   Escala: (100,500)→(600,500) = 500 px = 50 m  →  0.1 m/px
 *
 *   Demo A (100,100) ── 300 px ── Demo B (400,100)
 *      │ (con giro en 50,200)           │ 200 px
 *   Demo D (100,300) ── 300 px ── Demo C (400,300) ── 300 px ── Demo E (700,300)
 *
 *   Demo F (700,500) ── 200 px ── Demo G (900,500)     (isla: sin conexión con el resto)
 *
 *   A–B = 30.00 m   B–C = 20.00 m   C–E = 30.00 m   D–C = 30.00 m   F–G = 20.00 m
 *   A–D = 2·√(50²+100²) = 223.607 px = 22.36 m (el giro hace que sea más larga que la recta, 20 m)
 *
 *   Ruta A→E: A-B-C-E = 80.00 m   (la alternativa A-D-C-E = 82.36 m es más larga)
 *   Ruta A→G: no existe (G está en otra componente)
 */
export const DEMO_WIDTH = 1000;
export const DEMO_HEIGHT = 600;

export function buildDemoProject(plan: PlanRef): Project {
  const now = new Date().toISOString();
  return {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    name: 'DEMOSTRACIÓN (no es un mapa real)',
    createdAt: now,
    updatedAt: now,
    buildings: [
      {
        id: 'demo-edificio',
        name: 'Edificio de demostración',
        floors: [
          {
            id: 'demo-piso',
            name: 'Piso de demostración',
            level: 1,
            plan,
            calibration: { a: { x: 100, y: 500 }, b: { x: 600, y: 500 }, realDistanceM: 50 },
            nodes: [
              { id: 'demo-a', name: 'Demo A', x: 100, y: 100 },
              { id: 'demo-b', name: 'Demo B', x: 400, y: 100 },
              { id: 'demo-c', name: 'Demo C', x: 400, y: 300 },
              { id: 'demo-d', name: 'Demo D', x: 100, y: 300 },
              { id: 'demo-e', name: 'Demo E', x: 700, y: 300 },
              { id: 'demo-f', name: 'Demo F', x: 700, y: 500 },
              { id: 'demo-g', name: 'Demo G', x: 900, y: 500 },
            ],
            edges: [
              { id: 'demo-ab', a: 'demo-a', b: 'demo-b', waypoints: [] },
              { id: 'demo-bc', a: 'demo-b', b: 'demo-c', waypoints: [] },
              { id: 'demo-ad', a: 'demo-a', b: 'demo-d', waypoints: [{ x: 50, y: 200 }] },
              { id: 'demo-dc', a: 'demo-d', b: 'demo-c', waypoints: [] },
              { id: 'demo-ce', a: 'demo-c', b: 'demo-e', waypoints: [] },
              { id: 'demo-fg', a: 'demo-f', b: 'demo-g', waypoints: [] },
            ],
          },
        ],
      },
    ],
    links: [],
  };
}
