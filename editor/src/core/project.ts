import { newId } from './graph';
import {
  FORMAT_ID,
  FORMAT_VERSION,
  type Building,
  type Calibration,
  type Floor,
  type GraphEdge,
  type GraphNode,
  type PlanRef,
  type Point,
  type Project,
} from './types';

/* ------------------------------ Creación ------------------------------ */

export function createProject(plan: PlanRef, name: string): Project {
  const now = new Date().toISOString();
  return {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    name,
    createdAt: now,
    updatedAt: now,
    buildings: [
      {
        id: newId('b'),
        name: 'Edificio 1',
        floors: [
          {
            id: newId('f'),
            name: 'Piso 1',
            level: 1,
            plan,
            calibration: null,
            nodes: [],
            edges: [],
          },
        ],
      },
    ],
    links: [],
  };
}

/** En esta primera versión el editor trabaja con el primer piso del primer edificio. */
export const primaryFloor = (p: Project): Floor => p.buildings[0].floors[0];

export function updateFloor(p: Project, floorId: string, fn: (f: Floor) => Floor): Project {
  let changed = false;
  const buildings = p.buildings.map((b) => ({
    ...b,
    floors: b.floors.map((f) => {
      if (f.id !== floorId) return f;
      const next = fn(f);
      if (next !== f) changed = true;
      return next;
    }),
  }));
  return changed ? { ...p, buildings } : p;
}

export function renameProject(p: Project, name: string): Project {
  const clean = name.trim();
  return clean && clean !== p.name ? { ...p, name: clean } : p;
}

/* ------------------------------ Guardado ------------------------------ */

/**
 * Serializa a JSON. Si se pasa `embeddedPlans` (floorId → data URL), la imagen del
 * plano viaja dentro del archivo; si no, el archivo conserva nombre, tamaño y SHA-256
 * para volver a asociar el plano de forma verificable al importar.
 */
export function serializeProject(p: Project, embeddedPlans?: Record<string, string>): string {
  const out = {
    ...p,
    updatedAt: new Date().toISOString(),
    buildings: p.buildings.map((b) => ({
      ...b,
      floors: b.floors.map((f) => ({
        ...f,
        plan: embeddedPlans?.[f.id] ? { ...f.plan, dataUrl: embeddedPlans[f.id] } : f.plan,
      })),
    })),
  };
  return JSON.stringify(out, null, 2);
}

/* ------------------------------ Lectura ------------------------------- */

export class ProjectFormatError extends Error {}

const fail = (msg: string): never => {
  throw new ProjectFormatError(msg);
};
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function readPoint(v: unknown, where: string): Point {
  if (!isObj(v) || !isNum(v.x) || !isNum(v.y)) return fail(`Punto inválido en ${where}.`);
  return { x: v.x, y: v.y };
}

function readFloor(v: unknown, embedded: Record<string, string>): Floor {
  if (!isObj(v)) return fail('Piso inválido.');
  if (!isStr(v.id) || !isStr(v.name) || !isNum(v.level)) return fail('Piso sin id, nombre o nivel.');
  const where = `piso "${v.name}"`;

  const pl = v.plan;
  if (
    !isObj(pl) ||
    !isStr(pl.fileName) ||
    !isStr(pl.mimeType) ||
    !isStr(pl.sha256) ||
    !isNum(pl.width) ||
    !isNum(pl.height) ||
    pl.width <= 0 ||
    pl.height <= 0
  ) {
    return fail(`Falta la referencia al plano (nombre, tamaño, SHA-256) en ${where}.`);
  }
  const plan: PlanRef = {
    fileName: pl.fileName,
    mimeType: pl.mimeType,
    width: pl.width,
    height: pl.height,
    sha256: pl.sha256,
  };
  if (isStr(pl.dataUrl)) embedded[v.id] = pl.dataUrl;

  let calibration: Calibration | null = null;
  if (v.calibration !== null && v.calibration !== undefined) {
    const c = v.calibration;
    if (!isObj(c) || !isNum(c.realDistanceM) || c.realDistanceM <= 0) {
      return fail(`Calibración inválida en ${where}.`);
    }
    const a = readPoint(c.a, `calibración de ${where}`);
    const b = readPoint(c.b, `calibración de ${where}`);
    if (a.x === b.x && a.y === b.y) return fail(`La calibración de ${where} tiene dos puntos iguales.`);
    calibration = { a, b, realDistanceM: c.realDistanceM };
  }

  if (!Array.isArray(v.nodes) || !Array.isArray(v.edges)) {
    return fail(`Faltan nodos o conexiones en ${where}.`);
  }
  const ids = new Set<string>();
  const nodes: GraphNode[] = v.nodes.map((n) => {
    if (!isObj(n) || !isStr(n.id) || !isStr(n.name) || !isNum(n.x) || !isNum(n.y)) {
      return fail(`Nodo inválido en ${where}.`);
    }
    if (ids.has(n.id)) return fail(`Id de nodo repetido: ${n.id}.`);
    ids.add(n.id);
    return { id: n.id, name: n.name, x: n.x, y: n.y };
  });

  const edgeIds = new Set<string>();
  const edges: GraphEdge[] = v.edges.map((e) => {
    if (!isObj(e) || !isStr(e.id) || !isStr(e.a) || !isStr(e.b) || !Array.isArray(e.waypoints)) {
      return fail(`Conexión inválida en ${where}.`);
    }
    if (edgeIds.has(e.id)) return fail(`Id de conexión repetido: ${e.id}.`);
    edgeIds.add(e.id);
    if (!ids.has(e.a) || !ids.has(e.b)) {
      return fail(`La conexión ${e.id} apunta a un nodo que no existe.`);
    }
    if (e.a === e.b) return fail(`La conexión ${e.id} une un nodo consigo mismo.`);
    return { id: e.id, a: e.a, b: e.b, waypoints: e.waypoints.map((w) => readPoint(w, `conexión ${e.id}`)) };
  });

  return { id: v.id, name: v.name, level: v.level, plan, calibration, nodes, edges };
}

export interface ParsedProject {
  project: Project;
  /** floorId → data URL de la imagen, si el archivo la incluía. */
  embedded: Record<string, string>;
}

export function parseProject(text: string): ParsedProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('El archivo no es un JSON válido.');
  }
  if (!isObj(raw) || raw.format !== FORMAT_ID) {
    return fail('Este archivo no es un proyecto de este editor (falta el identificador de formato).');
  }
  if (!isNum(raw.version) || !Number.isInteger(raw.version) || raw.version < 1) {
    return fail('El archivo no indica una versión de formato válida.');
  }
  if (raw.version > FORMAT_VERSION) {
    return fail(
      `El archivo usa el formato versión ${raw.version}, más nuevo que el que entiende esta aplicación (${FORMAT_VERSION}).`,
    );
  }
  if (!isStr(raw.name) || !Array.isArray(raw.buildings) || raw.buildings.length === 0) {
    return fail('El proyecto no contiene edificios.');
  }

  const embedded: Record<string, string> = {};
  const buildings: Building[] = raw.buildings.map((b) => {
    if (!isObj(b) || !isStr(b.id) || !isStr(b.name) || !Array.isArray(b.floors) || b.floors.length === 0) {
      return fail('Edificio inválido o sin pisos.');
    }
    return { id: b.id, name: b.name, floors: b.floors.map((f) => readFloor(f, embedded)) };
  });

  return {
    project: {
      format: FORMAT_ID,
      version: FORMAT_VERSION,
      name: raw.name,
      createdAt: isStr(raw.createdAt) ? raw.createdAt : new Date().toISOString(),
      updatedAt: isStr(raw.updatedAt) ? raw.updatedAt : new Date().toISOString(),
      buildings,
      links: Array.isArray(raw.links) ? (raw.links as Project['links']) : [],
    },
    embedded,
  };
}
