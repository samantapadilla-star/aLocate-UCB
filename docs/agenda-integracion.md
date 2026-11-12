# Integración con la agenda (agenda.lpz.ucb.edu.bo)

Objetivo: que cada evento de la agenda aparezca en aLocateUCB con su ruta, sin adivinar el lugar.

## Recomendación

1. **Campo estructurado de lugar en la agenda (lo principal).** Al crear o editar un evento, el lugar se elige de una lista
   (bloque y aula) en vez de escribirlo libre. Esa lista sale del mismo catálogo que usa el mapa (`web/campus/catalogo.json`).
2. **Una lista pública de eventos en JSON**, de solo lectura, con el formato de abajo. La agenda ya genera `.ics`; esto es lo mismo en JSON.
   - Si el mapa se publica en otro dominio, la agenda debe responder con `Access-Control-Allow-Origin` para ese dominio.
   - No debe incluir datos personales (correos, interesados, cuentas).
3. **IA solo como respaldo** para eventos antiguos con el lugar en texto libre: el modelo debe elegir **solo** entre los códigos del catálogo
   o responder «sin ubicar». Su respuesta se guarda como sugerencia para que una persona la confirme; nunca se publica un lugar inventado.

## Formato esperado (`eventos.json`)

```json
{
  "generado": "2026-11-12T10:00:00-04:00",
  "eventos": [
    {
      "id": "evt-123",
      "titulo": "Nombre del evento",
      "inicio": "2026-11-20T14:00:00-04:00",
      "fin": null,
      "categoria": "Académico",
      "lugar": { "codigo": "C201", "texto": "Aula C201, Bloque C" },
      "url": "https://agenda.lpz.ucb.edu.bo/..."
    }
  ]
}
```

- `lugar.codigo`: código de aula del catálogo (`C201`, `TEAL 003`) o id de bloque (`bloque-c`, `biblioteca-i`). Es lo que usa el mapa.
- `lugar.texto`: texto tal como lo ve la gente. Si no hay código, el mapa intenta reconocer un código de aula o un bloque en este texto;
  si no lo logra, muestra «Ubicación por confirmar» y no ofrece ruta.

## Cómo lo lee la web hoy

`web/mapa3d.js` carga `campus/eventos.json` (función `loadEvents`). Para conectarlo a la agenda real basta con cambiar esa URL
por la del endpoint público, o con un script que la descargue periódicamente y deje el archivo en `web/campus/`.

## Lo que ya funciona con el `.ics` actual

La web también lee `campus/eventos.ics` (el mismo formato que descarga la agenda). Con el evento de prueba
`LOCATION:Bloque “D”\, 5to. piso\, Paraninfo U.C.B.` reconoce **Paraninfo · Bloque D, Piso 5** y traza la ruta.

Dos detalles a corregir en el generador del `.ics` (no rompen la web, pero otros calendarios pueden fallar):
- `DTSTAMP:20261112T200159ZZ` tiene una **Z de más**: debe ser `...T200159Z`.
- `DTSTART;TZID=America/La_Paz:20261125T160000Z` mezcla zona horaria y «Z» (UTC). Con `TZID` debe ir **sin Z**:
  `DTSTART;TZID=America/La_Paz:20261125T160000`. La web asume hora de La Paz (16:00); Google o Outlook podrían mostrar 12:00.
- Para un mapa sin ambigüedad, añadir un campo propio con el código: `X-UCB-LUGAR:bloque-d/Paraninfo` (o el campo `lugar.codigo` del JSON).
