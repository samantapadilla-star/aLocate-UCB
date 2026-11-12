import { describe, expect, it } from 'vitest';
import { shortestPath } from './dijkstra';
import { buildDemoProject, DEMO_HEIGHT, DEMO_WIDTH } from './demo';
import {
  addEdge,
  buildNodeMap,
  deleteNode,
  edgeLengthPx,
  formatLength,
  metersPerPixel,
  moveNode,
  setCalibration,
} from './graph';
import { parseProject, primaryFloor, ProjectFormatError, serializeProject } from './project';
import type { PlanRef } from './types';

const plan: PlanRef = {
  fileName: 'demo.png',
  mimeType: 'image/png',
  width: DEMO_WIDTH,
  height: DEMO_HEIGHT,
  sha256: 'a'.repeat(64),
};
const demo = () => primaryFloor(buildDemoProject(plan));

describe('escala', () => {
  it('500 px = 50 m  →  0.1 m/px', () => {
    expect(metersPerPixel(demo().calibration)).toBeCloseTo(0.1, 10);
  });
  it('sin calibración no hay metros: se muestran píxeles', () => {
    expect(metersPerPixel(null)).toBeNull();
    expect(formatLength(300, null)).toBe('300 px');
    expect(formatLength(300, 0.1)).toBe('30.00 m');
  });
  it('corregir la escala recalcula las longitudes sin tocar el grafo', () => {
    const f = demo();
    const nodes = buildNodeMap(f);
    const ab = f.edges.find((e) => e.id === 'demo-ab')!;
    const px = edgeLengthPx(ab, nodes);
    expect(px * metersPerPixel(f.calibration)!).toBeCloseTo(30, 6);
    const f2 = setCalibration(f, { ...f.calibration!, realDistanceM: 100 }); // doble de escala
    expect(px * metersPerPixel(f2.calibration)!).toBeCloseTo(60, 6);
  });
});

describe('longitud de conexiones', () => {
  it('una conexión con giro mide más que la recta (sigue el pasillo)', () => {
    const f = demo();
    const nodes = buildNodeMap(f);
    const ad = f.edges.find((e) => e.id === 'demo-ad')!;
    expect(edgeLengthPx(ad, nodes)).toBeCloseTo(2 * Math.hypot(50, 100), 6); // 223.607 px
    expect(edgeLengthPx(ad, nodes)).toBeGreaterThan(200); // la recta mediría 200 px
  });
  it('al mover un nodo se actualizan las longitudes de sus conexiones', () => {
    const f = moveNode(demo(), 'demo-b', { x: 400, y: 0 }); // B sube 100 px
    const nodes = buildNodeMap(f);
    const bc = f.edges.find((e) => e.id === 'demo-bc')!;
    expect(edgeLengthPx(bc, nodes)).toBeCloseTo(300, 6);
  });
});

describe('Dijkstra sobre el grafo de demostración', () => {
  it('A→E elige A-B-C-E = 80 m (no A-D-C-E = 82.36 m)', () => {
    const f = demo();
    const r = shortestPath(f, 'demo-a', 'demo-e');
    expect(r.found).toBe(true);
    if (!r.found) return;
    expect(r.nodeIds).toEqual(['demo-a', 'demo-b', 'demo-c', 'demo-e']);
    expect(r.steps.map((s) => s.lengthPx)).toEqual([300, 200, 300]);
    expect(r.totalPx * metersPerPixel(f.calibration)!).toBeCloseTo(80, 6);
  });
  it('la ruta inversa tiene la misma distancia', () => {
    const r = shortestPath(demo(), 'demo-e', 'demo-a');
    expect(r.found && r.totalPx).toBeCloseTo(800, 6);
  });
  it('D→B pasa por C (50 m) y no por A (52.36 m)', () => {
    const r = shortestPath(demo(), 'demo-d', 'demo-b');
    expect(r.found && r.nodeIds).toEqual(['demo-d', 'demo-c', 'demo-b']);
  });
  it('A→G no tiene ruta: están en componentes distintas', () => {
    expect(shortestPath(demo(), 'demo-a', 'demo-g')).toEqual({ found: false, reason: 'no-path' });
  });
  it('nodo inexistente', () => {
    expect(shortestPath(demo(), 'demo-a', 'nope')).toEqual({ found: false, reason: 'unknown-node' });
  });
  it('si cambia la geometría, cambia la ruta (el giro de A–D importa)', () => {
    // Quitamos B–C: A→E solo puede ir por D y cuesta 22.36 + 30 + 30 m.
    const f = demo();
    const g = { ...f, edges: f.edges.filter((e) => e.id !== 'demo-bc') };
    const r = shortestPath(g, 'demo-a', 'demo-e');
    expect(r.found && r.totalPx * 0.1).toBeCloseTo(82.3607, 3);
  });
});

describe('cruces visuales', () => {
  it('dos conexiones que se cruzan sin compartir nodo NO quedan conectadas', () => {
    const f = demo();
    // X–Y y Z–W se cruzan en (500,200)... pero no comparten nodo.
    const g = {
      ...f,
      nodes: [
        ...f.nodes,
        { id: 'x', name: 'X', x: 450, y: 150 },
        { id: 'y', name: 'Y', x: 550, y: 250 },
        { id: 'z', name: 'Z', x: 550, y: 150 },
        { id: 'w', name: 'W', x: 450, y: 250 },
      ],
      edges: [
        { id: 'e1', a: 'x', b: 'y', waypoints: [] },
        { id: 'e2', a: 'z', b: 'w', waypoints: [] },
      ],
    };
    expect(shortestPath(g, 'x', 'z')).toEqual({ found: false, reason: 'no-path' });
    expect(shortestPath(g, 'x', 'w')).toEqual({ found: false, reason: 'no-path' });
  });
});

describe('edición', () => {
  it('no permite duplicar conexiones ni uniones de un nodo consigo mismo', () => {
    const f = demo();
    expect(addEdge(f, 'n1', 'demo-a', 'demo-b', []).ok).toBe(false);
    expect(addEdge(f, 'n1', 'demo-b', 'demo-a', []).ok).toBe(false);
    expect(addEdge(f, 'n1', 'demo-a', 'demo-a', []).ok).toBe(false);
    expect(addEdge(f, 'n1', 'demo-a', 'demo-c', []).ok).toBe(true);
  });
  it('borrar un nodo borra sus conexiones', () => {
    const f = deleteNode(demo(), 'demo-c');
    expect(f.edges.some((e) => e.a === 'demo-c' || e.b === 'demo-c')).toBe(false);
    expect(f.edges).toHaveLength(3);
  });
});

describe('guardado e importación', () => {
  it('ida y vuelta sin pérdida (sin imagen incrustada)', () => {
    const p = buildDemoProject(plan);
    const { project, embedded } = parseProject(serializeProject(p));
    expect(embedded).toEqual({});
    expect(project.buildings).toEqual(p.buildings);
    expect(project.version).toBe(1);
    expect(primaryFloor(project).plan).toEqual(plan);
  });
  it('conserva la imagen incrustada aparte del modelo', () => {
    const p = buildDemoProject(plan);
    const { project, embedded } = parseProject(serializeProject(p, { 'demo-piso': 'data:image/png;base64,AAAA' }));
    expect(embedded['demo-piso']).toBe('data:image/png;base64,AAAA');
    expect(primaryFloor(project).plan).toEqual(plan); // el modelo no arrastra la imagen
  });
  it('rechaza archivos ajenos, corruptos o de versión futura', () => {
    expect(() => parseProject('no es json')).toThrow(ProjectFormatError);
    expect(() => parseProject('{"format":"otra-cosa"}')).toThrow(/identificador de formato/);
    const future = JSON.parse(serializeProject(buildDemoProject(plan)));
    future.version = 99;
    expect(() => parseProject(JSON.stringify(future))).toThrow(/más nuevo/);
    const broken = JSON.parse(serializeProject(buildDemoProject(plan)));
    broken.buildings[0].floors[0].edges[0].b = 'fantasma';
    expect(() => parseProject(JSON.stringify(broken))).toThrow(/no existe/);
  });
});
