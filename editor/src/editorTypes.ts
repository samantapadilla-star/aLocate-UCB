import type { Point } from './core/types';

export type Mode = 'select' | 'node' | 'connect' | 'calibrate' | 'route';

export type Selection = { type: 'node' | 'edge'; id: string } | null;

/** Conexión en curso: nodo de inicio + giros marcados hasta ahora. */
export interface ConnectDraft {
  fromId: string;
  points: Point[];
}

export interface Notice {
  kind: 'info' | 'ok' | 'error';
  text: string;
}
