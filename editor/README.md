# Editor de grafos de navegación (v0.1)

Herramienta local para dibujar y probar grafos de navegación sobre un plano (PNG/JPG).
React + TypeScript + Vite. Sin backend: todo corre en el navegador.

## Instalar y ejecutar (Windows PowerShell)

```powershell
node --version        # necesitas Node 18 o superior (probado con 22)
npm install           # una sola vez
npm run dev           # abre http://localhost:5173
```

Otros comandos:

```powershell
npm test              # pruebas de la lógica (Dijkstra, escala, guardado)
npm run build         # comprueba tipos y genera /dist
```

## Cómo se usa

1. **Cargar plano…** (o **Demostración** para un plano ficticio con medidas verificables).
2. Modo **Calibrar** (tecla 4): clic en dos puntos de distancia real conocida, escribe los metros, *Aplicar escala*.
3. Modo **Crear nodos** (2): clic en el plano. Arrastrar el mapa solo lo desplaza.
4. Modo **Conectar** (3): clic en nodo inicial → clics en espacio libre para marcar giros → clic en nodo final.
5. Modo **Seleccionar / mover** (1): mover y renombrar nodos, eliminar (Supr), editar giros de una conexión.
6. Modo **Probar ruta** (5): origen y destino → ruta más corta, distancia total y tramos.
7. **Exportar proyecto** → `nombre.ucbnav.json` en Descargas. **Importar proyecto…** para continuar otro día.

Atajos: 1–5 modos · Ctrl+Z deshacer · Ctrl+Y / Ctrl+Shift+Z rehacer · Supr elimina · Esc cancela.

## Formato del proyecto (versión 1)

`format: "ucb-nav-project"`, `version: 1`, `buildings[] → floors[]`. Cada piso guarda:
`plan` (nombre, tipo, ancho, alto, **SHA-256**; opcionalmente `dataUrl` con la imagen incrustada),
`calibration` (dos puntos + metros reales), `nodes[]` y `edges[]` (cada una con sus `waypoints`).
Todas las coordenadas son píxeles de la imagen original. Los metros no se guardan: se derivan de la escala.
`links[]` está reservado para escaleras/ascensores entre pisos (con su propia medida).

Si exportas sin incrustar la imagen, al importar el editor pide el plano y verifica tamaño y SHA-256.

## Verificación con la demostración (a mano)

Escala 500 px = 50 m (0.1 m/px). A–B 30 m, B–C 20 m, C–E 30 m, D–C 30 m, A–D 22.36 m (con giro), F–G 20 m.
Ruta Demo A → Demo E = **80.00 m** (A-B-C-E). Demo A → Demo G = **sin ruta**.

## Estructura

```
src/core/      lógica pura y probada (tipos, geometría, grafo, Dijkstra, guardado, demo)
src/components/MapCanvas.tsx   lienzo SVG: zoom, desplazamiento, gestos
src/App.tsx    modos, paneles, importar/exportar
src/hooks/useHistory.ts        deshacer/rehacer
```
