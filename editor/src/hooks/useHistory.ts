import { useCallback, useReducer } from 'react';

/**
 * Historial deshacer/rehacer basado en instantáneas inmutables.
 * - `set`: cambio puntual (una entrada de historial).
 * - `begin` + `replace`* + `end`: gesto continuo (p. ej. arrastrar un nodo) = UNA sola entrada.
 */
interface State<T> {
  present: T;
  past: T[];
  future: T[];
  gestureStart: { value: T } | null;
}

type Action<T> =
  | { type: 'set'; next: (prev: T) => T }
  | { type: 'replace'; next: (prev: T) => T }
  | { type: 'begin' }
  | { type: 'end' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: T };

const LIMIT = 200;

function reducer<T>(s: State<T>, a: Action<T>): State<T> {
  switch (a.type) {
    case 'set': {
      const next = a.next(s.present);
      if (next === s.present) return s;
      return { present: next, past: [...s.past, s.present].slice(-LIMIT), future: [], gestureStart: null };
    }
    case 'replace': {
      const next = a.next(s.present);
      return next === s.present ? s : { ...s, present: next };
    }
    case 'begin':
      return s.gestureStart ? s : { ...s, gestureStart: { value: s.present } };
    case 'end': {
      if (!s.gestureStart) return s;
      const start = s.gestureStart.value;
      if (start === s.present) return { ...s, gestureStart: null };
      return { present: s.present, past: [...s.past, start].slice(-LIMIT), future: [], gestureStart: null };
    }
    case 'undo': {
      if (s.past.length === 0) return s;
      return {
        present: s.past[s.past.length - 1],
        past: s.past.slice(0, -1),
        future: [s.present, ...s.future],
        gestureStart: null,
      };
    }
    case 'redo': {
      if (s.future.length === 0) return s;
      return {
        present: s.future[0],
        past: [...s.past, s.present],
        future: s.future.slice(1),
        gestureStart: null,
      };
    }
    case 'reset':
      return { present: a.value, past: [], future: [], gestureStart: null };
  }
}

export function useHistory<T>(initial: T) {
  const [state, dispatch] = useReducer(reducer as (s: State<T>, a: Action<T>) => State<T>, {
    present: initial,
    past: [],
    future: [],
    gestureStart: null,
  });

  return {
    present: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    set: useCallback((next: (prev: T) => T) => dispatch({ type: 'set', next }), []),
    replace: useCallback((next: (prev: T) => T) => dispatch({ type: 'replace', next }), []),
    begin: useCallback(() => dispatch({ type: 'begin' }), []),
    end: useCallback(() => dispatch({ type: 'end' }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    reset: useCallback((value: T) => dispatch({ type: 'reset', value }), []),
  };
}
