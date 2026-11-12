# UCB Ruta · Plataforma de Navegación y Eventos del Campus UCB

Solución desarrollada para el **Reto FDI: "¿Dónde es el evento?"** en la **Hackathon TECH MECH 2026** (Facultad de Ingeniería Mecatrónica - Universidad Católica Boliviana "San Pablo").

---

## 🚀 Cómo Ejecutar la Aplicación

No requiere instalación de servidores, bases de datos complejas ni dependencias externas:
1. Haz doble clic en el archivo [index.html](file:///c:/Desktop/pWm/index.html) para abrirlo directamente en cualquier navegador web moderno (Chrome, Edge, Firefox, Safari).
2. O levanta un servidor estático local si lo deseas (`npx serve`, Live Server de VS Code, Python `python -m http.server 8080`, etc.).

---

## 📁 Estructura del Proyecto

- [index.html](file:///c:/Desktop/pWm/index.html): Estructura semántica HTML5, accesible y responsiva.
- [style.css](file:///c:/Desktop/pWm/style.css): Hoja de estilos con los colores institucionales de la UCB, animaciones SVG y diseño para móviles y computadoras.
- [graph-data.js](file:///c:/Desktop/pWm/graph-data.js): **Archivo central de datos del grafo**. Aquí residen los nodos, aristas, bloques del campus y eventos.
- [app.js](file:///c:/Desktop/pWm/app.js): Lógica del algoritmo de ruta más corta (**Dijkstra**), visor interactivo de mapa con Pan & Zoom, buscador de eventos y gestión de códigos QR.

---

## 🗺️ Cómo agregar tu archivo de mapeo con grafos

Tienes **3 formas sencillas** de integrar tus datos de grafo una vez que los tengas listos:

### Opción 1: Proporcionármelo directamente en el chat
Puedes compartir el contenido de tu archivo (JSON, lista de nodos/aristas, o script) y yo lo integraré de inmediato en [graph-data.js](file:///c:/Desktop/pWm/graph-data.js).

### Opción 2: Botón "Cargar Grafo" en la barra superior
1. Abre la página en el navegador.
2. Haz clic en el botón dorado **"🔄 Cargar Grafo"** en el encabezado.
3. Pega tu estructura JSON y haz clic en **"Aplicar al Mapa"**. El mapa, los selectores y el algoritmo se actualizarán en tiempo real.

### Opción 3: Editar directamente `graph-data.js`
El archivo está diseñado con la siguiente estructura limpia:

```javascript
nodes: {
  idNodo: {
    name: 'Nombre Completo del Lugar',
    short: 'Etiqueta en Mapa',
    x: 100, // Coordenada X en el plano SVG
    y: 200, // Coordenada Y en el plano SVG
    floor: 'PB', // PB, P1, P2, etc.
    category: 'Académico',
    desc: 'Descripción del punto'
  }
},
edges: [
  // [origenId, destinoId, distanciaEnMetros, tipo]
  // tipos: 'camino' (peatonal llano), 'escaleras', 'ascensor', 'rampa'
  ['idNodo1', 'idNodo2', 50, 'camino'],
  ['bloqueD', 'paraninfo', 65, 'escaleras'],
  ['bloqueD', 'paraninfo', 95, 'ascensor']
]
```

---

## ✨ Características y Cumplimiento del Reto

1. **Mapa Interactivo Vectorial (SVG)**:
   - Vista esquemática del campus con soporte para **Pan (arrastrar)** y **Zoom (rueda o botones +/-)**.
   - Nodos interactivos: haz clic en cualquier nodo para fijarlo como destino u origen.
   - Visualización de la ruta óptima calculada con línea punteada animada.
2. **Algoritmo Dijkstra de Ruta Más Corta**:
   - Calcula la menor distancia en metros y estima el tiempo de caminata.
   - **Filtro de Accesibilidad**: opción para personas con movilidad reducida (evita gradas/escaleras y prioriza ascensores o rampas).
   - Generación automática de instrucciones paso a paso detalladas.
3. **Simulador de Señalética QR**:
   - Botones rápidos de simulación de QR colocados en puntos clave del campus.
   - Compatible con parámetros de URL (ej. `?origen=entrada&destino=coliseo`) para pruebas directas con smartphones.
4. **Directorio y Búsqueda de Eventos**:
   - Buscador en tiempo real y filtros por categoría (Hackathons, Académico, Comunidad, Ferias).
   - Botón directo **"🧭 Trazar ruta hacia este evento"** que calcula el trayecto y desplaza la vista hacia el mapa.
5. **Propuesta de Mantenimiento y Presupuesto (< Bs 500 / mes)**:
   - Modal detallado con el desglose exigido en las bases del reto (Bs 330/mes total con Vercel/Cloudflare Pages gratuito, dominio UCB y placas QR resistentes al clima).

