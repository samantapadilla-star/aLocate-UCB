/**
 * Modelo de datos del proyecto (formato versión 1).
 *
 * Reglas de diseño:
 * - TODAS las coordenadas están en píxeles de la imagen ORIGINAL (no de la pantalla).
 *   El zoom y el tamaño de ventana solo afectan a la vista, nunca a los datos.
 * - Las longitudes en metros NO se guardan: se derivan de (píxeles × escala).
 *   Así, corregir la escala recalcula todo sin tocar el grafo.
 * - La estructura Proyecto → Edificios → Pisos permite ampliar más adelante.
 *   Cada piso tiene su propio plano, escala y grafo. Los pisos NUNCA comparten
 *   coordenadas: las conexiones entre pisos (escaleras, ascensores) viven en
 *   `links` con su propia medida en metros.
 */

export const FORMAT_ID = 'ucb-nav-project';
/** v2: las conexiones pueden indicar su tipo (camino, rampa, escaleras, ascensor). Los archivos v1 siguen abriéndose. */
export const FORMAT_VERSION = 2;

/** Tipo de tramo. «Ruta accesible» evita las escaleras. */
export type EdgeKind = 'camino' | 'rampa' | 'escaleras' | 'ascensor';
export const EDGE_KINDS: EdgeKind[] = ['camino', 'rampa', 'escaleras', 'ascensor'];

export interface Point {
  x: number;
  y: number;
}

/** Referencia verificable al plano: tamaño + huella SHA-256 de los bytes del archivo. */
export interface PlanRef {
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  sha256: string;
}

/** Dos puntos del plano y la distancia real conocida entre ellos. */
export interface Calibration {
  a: Point;
  b: Point;
  realDistanceM: number;
}

export interface GraphNode {
  id: string;
  name: string;
  x: number;
  y: number;
}

/**
 * Una conexión sigue el recorrido transitable: nodo `a` → waypoints (en orden) → nodo `b`.
 * Dos conexiones solo están unidas si comparten un nodo, aunque se crucen visualmente.
 */
export interface GraphEdge {
  id: string;
  a: string;
  b: string;
  waypoints: Point[];
  /** Si falta, es «camino». */
  kind?: EdgeKind;
}

export interface Floor {
  id: string;
  name: string;
  level: number;
  plan: PlanRef;
  calibration: Calibration | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Building {
  id: string;
  name: string;
  floors: Floor[];
}

/** Reservado para una etapa futura: conexión entre pisos con medida propia. */
export interface InterFloorLink {
  id: string;
  kind: 'stairs' | 'elevator' | 'ramp';
  from: { floorId: string; nodeId: string };
  to: { floorId: string; nodeId: string };
  lengthM: number;
}

export interface Project {
  format: typeof FORMAT_ID;
  version: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  buildings: Building[];
  links: InterFloorLink[];
}
