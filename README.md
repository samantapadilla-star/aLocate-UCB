# aLocateUCB

Navegación del campus de la Universidad Católica Boliviana con reconocimiento de lugares a partir de fotos.

## Estructura del repositorio

| Carpeta | Contenido | Estado |
|---|---|---|
| `editor/` | Editor de grafos sobre planos (React + TypeScript + Vite). Exporta `.ucbnav.json`. | v0.1 funcional |
| `web/` | Aplicación web para el usuario final (HTML, CSS y JS). | Base inicial |
| `vision-lab/` | Prototipo de reconocimiento de lugares con fotos. | Por empezar |
| `tools/` | Scripts de apoyo (conversión de fotos HEIC → JPG). | Listo |
| `branding/` | Logo e ícono. | Listo |
| `docs/` | Documentación y decisiones del equipo. | — |

## Reglas

- Nunca se sube directo a `main`: rama propia + Pull Request.
- Ramas: `area/descripcion-corta`. Commits: `tipo(area): descripción` (feat, fix, docs, test, refactor, chore).
- **No se suben** planos, fotos de lugares, proyectos exportados (`*.ucbnav.json`), claves ni archivos `.env`.
- Cada lugar tiene un código único (por ejemplo `bloque-a-aula-101`), igual en el grafo, las fotos y la API.

## Probar el editor

```powershell
cd editor
npm install
npm run dev
```

Detalles en `editor/README.md`.

## Flujo para actualizar el mapa (nodos, caminos accesibles)

1. En el editor (`editor/`, `npm run dev`): **Importar proyecto…** → el `.ucbnav.json` actual.
2. Agrega los nodos que faltan (modo «Crear nodos») y conéctalos (modo «Conectar»).
3. Selecciona cada conexión y elige su **Tipo de tramo**: Camino, **Rampa / camino accesible**, **Escaleras** o Ascensor.
   «Ruta accesible» nunca usa tramos de escaleras. Prueba en «Probar ruta» con la casilla «Ruta accesible».
4. **Exportar proyecto** (formato versión 2; los archivos versión 1 siguen abriéndose).
5. Regenera los datos de la web:

```powershell
python tools/build_campus_data.py "RUTA\mapa.ucbnav.json" web/campus
```

Aulas, pisos y ascensores (con foto) se editan a mano en `web/campus/catalogo.json`; no hace falta regenerar nada.
El modelo de reconocimiento por fotos está en `web/vision/` (clases → lugares en `web/vision/etiquetas.json`).

## Asistente con IA (Groq)

La clave **nunca** va en la web: la usa un servidor pequeño (`server/servidor.mjs`, Node 18+, sin dependencias) que también sirve la página.

```powershell
cd server
copy .env.example .env
notepad .env
```

Pon tu clave en `GROQ_API_KEY=...` (el archivo `.env` no se sube a GitHub). Luego, desde `server/`:

```powershell
node servidor.mjs
```

Abre http://localhost:8787/mapa3d.html. La pestaña «Asistente» mostrará «Asistente con IA · Groq». Sin clave o sin servidor, usa las reglas simples.
La IA solo puede elegir lugares de la lista del mapa; el servidor descarta cualquier lugar inventado y la ruta la calcula la web.
