/**
 * aLocateUCB · Servidor mínimo (Node 18+, sin dependencias)
 * ---------------------------------------------------------
 * - Sirve la web (carpeta ../web) en http://localhost:8787
 * - POST /api/chat → consulta a Groq con la lista REAL de lugares y devuelve { respuesta, accion }.
 *   La clave GROQ_API_KEY vive solo aquí (archivo .env); nunca llega al navegador.
 * - GET /api/salud → { ia: true|false, modelo }
 *
 * La IA solo elige lugares de la lista (ids). El servidor valida cada id antes de responder,
 * y la ruta la sigue calculando la web con el grafo: la IA no inventa caminos ni distancias.
 *
 * Uso:  cd server ;  copy .env.example .env  (y pon tu clave) ;  node servidor.mjs
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '..', 'web');

/* ---------- .env (lector simple, sin dependencias) ---------- */
for (const file of [join(HERE, '.env'), resolve(HERE, '..', '.env')]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const KEY = process.env.GROQ_API_KEY || '';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const API_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const HAS_AI = KEY.length > 10 && !/tu_clave/i.test(KEY);

/* ---------- Lugares válidos (los mismos ids que usa la web) ---------- */
function loadPlaces() {
  const campus = JSON.parse(readFileSync(join(WEB, 'campus', 'campus.json'), 'utf8'));
  const cat = existsSync(join(WEB, 'campus', 'catalogo.json')) ? JSON.parse(readFileSync(join(WEB, 'campus', 'catalogo.json'), 'utf8')) : { ambientes: [], bloques: {} };
  const places = campus.buildings.map((b) => ({ id: b.id, nombre: b.name, tipo: 'bloque' }));
  places.push({ id: 'ingreso', nombre: 'Ingreso principal', tipo: 'referencia' }, { id: 'atrio', nombre: 'Atrio', tipo: 'referencia' }, { id: 'agora', nombre: 'Ágora', tipo: 'referencia' });
  const names = Object.fromEntries(campus.buildings.map((b) => [b.id, b.name]));
  for (const a of cat.ambientes || []) {
    const pisos = cat.bloques?.[a.bloque]?.nombresPisos;
    const piso = pisos?.[a.piso] ?? (a.piso ? `Piso ${a.piso}` : 'Planta baja');
    places.push({ id: `aula:${a.codigo}`, nombre: a.codigo, tipo: a.tipo || 'aula', bloque: names[a.bloque] || a.bloque, piso, zona: a.zona || undefined });
  }
  return places;
}
let PLACES = loadPlaces();
const placeIds = () => new Set(PLACES.map((p) => p.id));

/* ---------- Límite de uso simple por IP ---------- */
const hits = new Map();
function allowed(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now); hits.set(ip, list);
  return list.length <= 20;
}

/* ---------- Conversación con Groq ---------- */
function systemPrompt(ctx) {
  const lista = PLACES.map((p) => `${p.id} | ${p.nombre} | ${p.tipo}${p.bloque ? ` | ${p.bloque}` : ''}${p.piso ? ` | ${p.piso}` : ''}${p.zona ? ` | zona ${p.zona}` : ''}`).join('\n');
  return `Eres el asistente de aLocateUCB, una app para orientarse en el campus de la Universidad Católica Boliviana (La Paz).
Responde SIEMPRE en español, breve (máximo 2 frases), amable y claro.
Solo conoces estos lugares (id | nombre | tipo | bloque | piso):
${lista}

Reglas:
- Usa EXCLUSIVAMENTE ids de la lista. Si el lugar no está, dilo y sugiere uno parecido de la lista. Nunca inventes lugares, pisos, distancias ni horarios.
- No calcules distancias ni rutas: la app las calcula. Tú solo eliges origen y destino.
- Si la persona menciona silla de ruedas, discapacidad, muletas o pide evitar escaleras, activa la ruta accesible.
- Origen actual de la persona: ${ctx.origen || 'desconocido'}. Ruta accesible: ${ctx.accesible ? 'sí' : 'no'}.
Devuelve SOLO un objeto JSON con esta forma:
{"respuesta": "texto para la persona", "accion": null}
o con "accion" igual a uno de:
{"tipo": "ruta", "origen": "<id o null si no lo dijo>", "destino": "<id>"}
{"tipo": "info", "lugar": "<id>"}
{"tipo": "accesible", "valor": true}`;
}

function validate(out) {
  const ids = placeIds();
  const res = { respuesta: typeof out?.respuesta === 'string' ? out.respuesta.slice(0, 600) : 'No pude entender la respuesta.', accion: null };
  const a = out?.accion;
  if (a && a.tipo === 'ruta' && ids.has(a.destino)) res.accion = { tipo: 'ruta', destino: a.destino, origen: ids.has(a.origen) ? a.origen : null };
  else if (a && a.tipo === 'info' && ids.has(a.lugar)) res.accion = { tipo: 'info', lugar: a.lugar };
  else if (a && a.tipo === 'accesible') res.accion = { tipo: 'accesible', valor: a.valor !== false };
  else if (a) res.descartada = true; // la IA propuso algo fuera de la lista: no se usa
  return res;
}

async function askGroq(body) {
  const mensaje = String(body.mensaje || '').slice(0, 500);
  const historial = Array.isArray(body.historial) ? body.historial.slice(-6) : [];
  const messages = [{ role: 'system', content: systemPrompt(body.contexto || {}) }];
  for (const h of historial) if (h && typeof h.texto === 'string') messages.push({ role: h.rol === 'usuario' ? 'user' : 'assistant', content: h.texto.slice(0, 500) });
  messages.push({ role: 'user', content: mensaje });
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.2, max_tokens: 400, response_format: { type: 'json_object' } }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!r.ok) throw new Error(`Groq respondió ${r.status}`);
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content || '{}';
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = { respuesta: text, accion: null }; }
  return validate(parsed);
}

/* ---------- Servidor HTTP ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ics': 'text/calendar; charset=utf-8', '.bin': 'application/octet-stream', '.ico': 'image/x-icon' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/salud') return send(res, 200, { ia: HAS_AI, modelo: HAS_AI ? MODEL : null });
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      if (!HAS_AI) return send(res, 503, { error: 'Falta GROQ_API_KEY en server/.env' });
      if (!allowed(req.socket.remoteAddress || '?')) return send(res, 429, { error: 'Demasiadas preguntas seguidas. Espera un minuto.' });
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 20_000) return send(res, 413, { error: 'Mensaje demasiado largo' }); }
      const body = JSON.parse(raw || '{}');
      if (!String(body.mensaje || '').trim()) return send(res, 400, { error: 'Mensaje vacío' });
      return send(res, 200, await askGroq(body));
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'No existe' });
    // Archivos estáticos de la web (sin salir de la carpeta web/)
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (!path || path.endsWith('/') || path.endsWith('\\')) path = join(path, 'index.html');
    const full = resolve(WEB, path);
    if (full !== WEB && !full.startsWith(WEB + sep)) { res.writeHead(403); return res.end(); }
    const st = await stat(full).catch(() => null);
    if (!st || !st.isFile()) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(full));
  } catch (err) {
    console.error('[error]', err.message); // nunca se imprime la clave
    send(res, 502, { error: 'No se pudo completar la consulta' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`aLocateUCB en http://localhost:${PORT}/mapa3d.html`);
  console.log(HAS_AI ? `Asistente con IA: Groq (${MODEL})` : 'Asistente SIN IA: falta GROQ_API_KEY en server/.env (se usan reglas simples)');
});
