/**
 * UCB RUTA - Datos del Grafo y Configuración del Campus
 * =======================================================
 * Este archivo define los nodos (lugares), las aristas (conexiones/caminos)
 * y los eventos del campus.
 * 
 * NOTA PARA EL USUARIO:
 * Cuando tengas tu archivo de mapeo con grafos, puedes reemplazar
 * directamente estos objetos o usar la función integrada de importación JSON.
 */

const defaultCampusGraph = {
  // Configuración general del plano SVG (dimensiones del lienzo)
  mapBounds: {
    width: 900,
    height: 560
  },

  // Zonas / Edificios de fondo para el mapa ilustrativo
  buildings: [
    { id: 'bld-bloqueA', label: 'BLOQUE A', x: 100, y: 80, width: 140, height: 110, rx: 12 },
    { id: 'bld-central', label: 'ÁREA CENTRAL / JARDINES', x: 260, y: 70, width: 220, height: 110, rx: 12 },
    { id: 'bld-bloqueD', label: 'BLOQUE D (AULAS Y PARANINFO)', x: 570, y: 70, width: 250, height: 140, rx: 12 },
    { id: 'bld-cafeteria', label: 'CAFETERÍA Y SERVICIOS', x: 120, y: 340, width: 170, height: 120, rx: 12 },
    { id: 'bld-ingenieria', label: 'FACULTAD DE INGENIERÍA', x: 370, y: 260, width: 190, height: 130, rx: 12 },
    { id: 'bld-coliseo', label: 'COLISEO UCB', x: 620, y: 350, width: 220, height: 140, rx: 12 }
  ],

  // Nodos del mapa (Puntos de Interés)
  // Cada nodo tiene: id, name (nombre completo), short (etiqueta corta en mapa), x, y, floor, category
  nodes: {
    entrada: {
      name: 'Entrada Principal (Av. 14 de Septiembre)',
      short: 'Entrada Principal',
      x: 80,
      y: 240,
      floor: 'PB',
      category: 'Acceso',
      desc: 'Acceso peatonal principal al campus, torniquetes y portería.'
    },
    bloqueA: {
      name: 'Bloque A - Aulas y Decanatos',
      short: 'Bloque A',
      x: 170,
      y: 135,
      floor: 'PB',
      category: 'Académico',
      desc: 'Aulas teóricas, oficinas administrativas de decanato.'
    },
    patio: {
      name: 'Plaza Central / El Hongo',
      short: 'Plaza Central',
      x: 340,
      y: 240,
      floor: 'PB',
      category: 'Punto de Encuentro',
      desc: 'Espacio abierto central de encuentro estudiantil y descanso.'
    },
    biblioteca: {
      name: 'Biblioteca Central UCB',
      short: 'Biblioteca',
      x: 370,
      y: 125,
      floor: 'P1',
      category: 'Académico',
      desc: 'Salas de estudio individual y grupal, fondos bibliográficos.'
    },
    cafeteria: {
      name: 'Cafetería Universitaria',
      short: 'Cafetería',
      x: 205,
      y: 400,
      floor: 'PB',
      category: 'Servicios',
      desc: 'Área de comedores, microondas y snacks.'
    },
    ingenieria: {
      name: 'Facultad de Ingeniería (Laboratorios)',
      short: 'Ingeniería',
      x: 465,
      y: 325,
      floor: 'PB',
      category: 'Académico',
      desc: 'Laboratorios de Mecatrónica, Sistemas, Telecomunicaciones e Industrial.'
    },
    bloqueD: {
      name: 'Bloque D (Planta Baja / Hall)',
      short: 'Bloque D (PB)',
      x: 645,
      y: 190,
      floor: 'PB',
      category: 'Académico',
      desc: 'Hall de distribución, ascensores y escaleras hacia pisos superiores.'
    },
    paraninfo: {
      name: 'Paraninfo UCB (Bloque D - Piso 5)',
      short: 'Paraninfo (Piso 5)',
      x: 755,
      y: 120,
      floor: 'P5',
      category: 'Eventos',
      desc: 'Auditorio magistral de ceremonias, conferencias y eventos solemnes.'
    },
    coliseo: {
      name: 'Coliseo Polideportivo UCB',
      short: 'Coliseo UCB',
      x: 730,
      y: 420,
      floor: 'PB',
      category: 'Deportes / Eventos',
      desc: 'Cancha polifuncional, graderías y sede de hackathons y ferias masivas.'
    },
    canchas: {
      name: 'Canchas Polifuncionales Exteriores',
      short: 'Canchas Exteriores',
      x: 450,
      y: 480,
      floor: 'PB',
      category: 'Deportes',
      desc: 'Espacio deportivo al aire libre.'
    }
  },

  // Aristas / Conexiones entre nodos
  // Formato: [origenId, destinoId, distanciaMetros, tipoCamino]
  // Tipos: 'camino' (peatonal llano), 'escaleras' (desnivel/gradas), 'ascensor' (accesible vertical), 'rampa'
  edges: [
    ['entrada', 'bloqueA', 75, 'camino'],
    ['entrada', 'patio', 95, 'camino'],
    ['entrada', 'cafeteria', 110, 'camino'],
    ['bloqueA', 'biblioteca', 115, 'camino'],
    ['bloqueA', 'patio', 85, 'camino'],
    ['patio', 'biblioteca', 70, 'camino'],
    ['patio', 'cafeteria', 60, 'camino'],
    ['patio', 'ingenieria', 120, 'camino'],
    ['patio', 'bloqueD', 115, 'camino'],
    ['biblioteca', 'bloqueD', 130, 'camino'],
    ['cafeteria', 'ingenieria', 85, 'camino'],
    ['cafeteria', 'canchas', 105, 'camino'],
    ['ingenieria', 'canchas', 75, 'camino'],
    ['ingenieria', 'coliseo', 95, 'camino'],
    ['ingenieria', 'bloqueD', 110, 'camino'],
    ['bloqueD', 'coliseo', 240, 'camino'],
    ['canchas', 'coliseo', 90, 'camino'],
    // Conexión vertical entre Bloque D Planta Baja y Paraninfo Piso 5:
    ['bloqueD', 'paraninfo', 65, 'escaleras'],
    ['bloqueD', 'paraninfo', 95, 'ascensor']
  ],

  // Eventos iniciales
  events: [
    {
      id: 'ev-1',
      title: 'TECH MECH 2026 · Hackathon de Mecatrónica',
      date: '14 Nov 2026',
      time: '08:30 - 20:00',
      place: 'Coliseo Polideportivo UCB',
      nodeId: 'coliseo',
      tag: 'Innovación',
      color: '#003366',          /* Azul marino UCB — PANTONE 541 */
      desc: 'Competencia multidisciplinaria de prototipado rápido, hardware y software para resolver retos del campus UCB.',
      organizer: 'MECACENTRO UCB & Sociedad Científica'
    },
    {
      id: 'ev-2',
      title: 'Meca Gala & Noche de Premiación',
      date: '17 Nov 2026',
      time: '18:30',
      place: 'Paraninfo UCB, Bloque D (Piso 5)',
      nodeId: 'paraninfo',
      tag: 'Comunidad',
      color: '#009DC4',          /* Cyan UCB — PANTONE 312 */
      desc: 'Gala anual de premiación y reconocimiento a estudiantes destacados, proyectos de investigación y proyectos de grado.',
      organizer: 'Carrera de Ingeniería Mecatrónica'
    },
    {
      id: 'ev-3',
      title: 'Feria de Proyectos de Ingeniería (FDI)',
      date: '20 Nov 2026',
      time: '14:00 - 18:30',
      place: 'Facultad de Ingeniería (Plaza y Laboratorios)',
      nodeId: 'ingenieria',
      tag: 'Exposición',
      color: '#4C4C4C',          /* Gris UCB — Cool Gray 11 */
      desc: 'Exposición interactiva de proyectos finales, robótica, IoT y automatización con jurados de la industria.',
      organizer: 'Facultad de Ingeniería'
    },
    {
      id: 'ev-4',
      title: 'Taller de Inducción para Estudiantes Nuevos',
      date: '22 Nov 2026',
      time: '10:00',
      place: 'Biblioteca Central UCB',
      nodeId: 'biblioteca',
      tag: 'Académico',
      color: '#F5C800',          /* Amarillo/Dorado UCB — PANTONE 116 */
      desc: 'Capacitación en uso de bases de datos digitales, recursos IEEE, Scopus y préstamos de material bibliográfico.',
      organizer: 'Dirección de Biblioteca y Tecnologías'
    }
  ]
};

// Exponer en el objeto global
window.CampusData = defaultCampusGraph;

