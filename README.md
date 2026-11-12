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
