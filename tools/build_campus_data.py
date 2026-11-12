"""
Genera web/campus/campus.json a partir de un proyecto exportado del editor (.ucbnav.json).

Qué hace:
  - Copia el plano incrustado a plano.png (queda en la misma carpeta de salida).
  - Calcula la longitud en metros de cada conexión con la escala del proyecto.
  - Saca HUELLAS APROXIMADAS de los bloques detectando colores del plano
    (azul marino, ladrillo, gris) y simplificando el contorno. Los bloques que no se
    detectan por color se añaden como polígonos aproximados a mano.
  - Asigna a cada bloque el nodo del grafo más cercano como acceso PROVISIONAL.

Las huellas y los pisos son provisionales: en la siguiente etapa se corregirán en el editor.

Uso (PowerShell, desde la raíz del repo):
    python tools/build_campus_data.py "RUTA\\proyecto.ucbnav.json" web/campus
"""
import base64, json, math, re, sys
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

DIRS = [(-1, 0), (-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1)]  # sentido horario desde el oeste


def components(img, pred, min_size):
    w, h = img.size
    px = img.load()
    seen = [[False] * w for _ in range(h)]
    out = []
    for y in range(h):
        for x in range(w):
            if seen[y][x] or not pred(px[x, y]):
                continue
            q = deque([(x, y)])
            seen[y][x] = True
            pts = []
            while q:
                cx, cy = q.popleft()
                pts.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and pred(px[nx, ny]):
                        seen[ny][nx] = True
                        q.append((nx, ny))
            if len(pts) >= min_size:
                out.append(pts)
    return sorted(out, key=len, reverse=True)


def trace_outline(pts, w, h):
    """Contorno exterior (Moore-neighbor tracing) de un conjunto de píxeles conectados."""
    mask = [[False] * w for _ in range(h)]
    for x, y in pts:
        mask[y][x] = True
    fg = lambda x, y: 0 <= x < w and 0 <= y < h and mask[y][x]
    start = min(pts, key=lambda p: (p[1], p[0]))
    b, c_dir = start, 0
    contour = [b]
    for _ in range(len(pts) * 8 + 16):
        found = False
        for k in range(1, 9):
            d = (c_dir + k) % 8
            n = (b[0] + DIRS[d][0], b[1] + DIRS[d][1])
            if fg(*n):
                bg = (b[0] + DIRS[(d - 1) % 8][0], b[1] + DIRS[(d - 1) % 8][1])
                c_dir = DIRS.index((bg[0] - n[0], bg[1] - n[1])) if (bg[0] - n[0], bg[1] - n[1]) in DIRS else 0
                b = n
                found = True
                break
        if not found or (b == start and len(contour) > 2):
            break
        contour.append(b)
    return contour


def rdp(points, eps):
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i0, i1 = stack.pop()
        (x0, y0), (x1, y1) = points[i0], points[i1]
        dx, dy = x1 - x0, y1 - y0
        norm = math.hypot(dx, dy) or 1e-9
        best, bi = -1, -1
        for i in range(i0 + 1, i1):
            d = abs(dy * points[i][0] - dx * points[i][1] + x1 * y0 - y1 * x0) / norm
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack += [(i0, bi), (bi, i1)]
    return [p for p, k in zip(points, keep) if k]


def point_in_poly(p, poly):
    x, y, inside = p[0], p[1], False
    for i in range(len(poly)):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % len(poly)]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0 + 1e-12) + x0:
            inside = not inside
    return inside


def dist_to_poly(p, poly):
    if point_in_poly(p, poly):
        return 0.0
    best = 1e9
    for i in range(len(poly)):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % len(poly)]
        dx, dy = x1 - x0, y1 - y0
        t = max(0, min(1, ((p[0] - x0) * dx + (p[1] - y0) * dy) / (dx * dx + dy * dy + 1e-12)))
        best = min(best, math.hypot(p[0] - (x0 + dx * t), p[1] - (y0 + dy * t)))
    return best


def near(c, t, tol):
    return abs(c[0] - t[0]) <= tol and abs(c[1] - t[1]) <= tol and abs(c[2] - t[2]) <= tol


# ---------------------------------------------------------------------------
# Vectorización del plano: contorno del campus, áreas verdes y plazas
# ---------------------------------------------------------------------------
from PIL import ImageDraw, ImageFilter


def mask_from(img, pred):
    w, h = img.size
    px = img.load()
    m = Image.new("L", (w, h), 0)
    mp = m.load()
    for y in range(h):
        for x in range(w):
            if pred(px[x, y]):
                mp[x, y] = 255
    return m


def close(mask, size):
    """Cierre morfológico: une manchas cercanas (árboles sueltos, bancos) en una sola zona."""
    return mask.filter(ImageFilter.MaxFilter(size)).filter(ImageFilter.MinFilter(size))


def open_(mask, size):
    return mask.filter(ImageFilter.MinFilter(size)).filter(ImageFilter.MaxFilter(size))


def mask_components(mask, min_size):
    w, h = mask.size
    mp = mask.load()
    seen = bytearray(w * h)
    out = []
    for y in range(h):
        for x in range(w):
            if seen[y * w + x] or mp[x, y] < 128:
                continue
            q = deque([(x, y)])
            seen[y * w + x] = 1
            pts = []
            while q:
                cx, cy = q.popleft()
                pts.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and mp[nx, ny] >= 128:
                        seen[ny * w + nx] = 1
                        q.append((nx, ny))
            if len(pts) >= min_size:
                out.append(pts)
    return sorted(out, key=len, reverse=True)


def polygon_with_holes(pts, w, h, eps, min_hole):
    """Contorno exterior + huecos (por ejemplo, caminos que cruzan un jardín)."""
    outer = rdp(trace_outline(pts, w, h), eps)
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    x0, y0, x1, y1 = min(xs) - 1, min(ys) - 1, max(xs) + 1, max(ys) + 1
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    fg = bytearray(bw * bh)
    for x, y in pts:
        fg[(y - y0) * bw + (x - x0)] = 1
    outside = bytearray(bw * bh)
    q = deque()
    for x in range(bw):
        for y in (0, bh - 1):
            if not fg[y * bw + x] and not outside[y * bw + x]:
                outside[y * bw + x] = 1; q.append((x, y))
    for y in range(bh):
        for x in (0, bw - 1):
            if not fg[y * bw + x] and not outside[y * bw + x]:
                outside[y * bw + x] = 1; q.append((x, y))
    while q:
        cx, cy = q.popleft()
        for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
            if 0 <= nx < bw and 0 <= ny < bh and not fg[ny * bw + nx] and not outside[ny * bw + nx]:
                outside[ny * bw + nx] = 1; q.append((nx, ny))
    holes, seen = [], bytearray(bw * bh)
    for y in range(bh):
        for x in range(bw):
            i = y * bw + x
            if fg[i] or outside[i] or seen[i]:
                continue
            comp, q = [], deque([(x, y)]); seen[i] = 1
            while q:
                cx, cy = q.popleft(); comp.append((cx + x0, cy + y0))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    j = ny * bw + nx
                    if 0 <= nx < bw and 0 <= ny < bh and not fg[j] and not outside[j] and not seen[j]:
                        seen[j] = 1; q.append((nx, ny))
            if len(comp) >= min_hole:
                hole = rdp(trace_outline(comp, w, h), eps)
                if len(hole) >= 3:
                    holes.append(hole)
    return outer, holes


def vectorize(img, building_polys):
    w, h = img.size
    zones = []
    r2 = lambda poly: [[round(x, 1), round(y, 1)] for x, y in poly]

    # 1) Contorno del campus: todo lo que no es blanco del papel
    not_white = mask_from(img, lambda c: not (min(c) >= 236 and max(c) - min(c) < 12))
    campus_m = close(not_white, 7)
    comps = mask_components(campus_m, 2000)
    if comps:
        outer, _ = polygon_with_holes(comps[0], w, h, 2.0, 10 ** 9)
        zones.append({"kind": "campus", "outline": r2(outer), "holes": []})

    # Máscara de edificios (para no confundir el bloque C gris con una plaza)
    bmask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(bmask)
    for poly in building_polys:
        d.polygon([tuple(p) for p in poly], fill=255)
    bpx = bmask.load()

    # 2) Áreas verdes (césped y árboles unidos)
    green = mask_from(img, lambda c: c[1] > c[0] + 35 and c[1] > c[2] + 35)
    green = open_(close(green, 5), 3)
    gp = green.load()
    for y in range(h):
        for x in range(w):
            if bpx[x, y]:
                gp[x, y] = 0
    for pts in mask_components(green, 90):
        outer, holes = polygon_with_holes(pts, w, h, 1.6, 30)
        if len(outer) >= 3:
            zones.append({"kind": "green", "outline": r2(outer), "holes": [r2(hh) for hh in holes]})

    # 3) Plazas y zonas pavimentadas (grises), sin los edificios
    def is_gray(c):
        m = sum(c) / 3
        return max(c) - min(c) < 16 and 95 <= m <= 226
    plaza = mask_from(img, is_gray)
    pp = plaza.load()
    for y in range(h):
        for x in range(w):
            if bpx[x, y]:
                pp[x, y] = 0
    plaza = open_(close(plaza, 5), 3)
    for pts in mask_components(plaza, 160):
        outer, holes = polygon_with_holes(pts, w, h, 1.8, 40)
        # Lo que toca el borde de la imagen es calle o vereda exterior, no parte del campus
        if any(x <= 3 or x >= w - 4 or y >= h - 4 for x, y in outer):
            continue
        if len(outer) >= 3:
            zones.append({"kind": "plaza", "outline": r2(outer), "holes": [r2(hh) for hh in holes]})
    return zones


def main():
    src, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    project = json.loads(src.read_text(encoding="utf-8"))
    floor = project["buildings"][0]["floors"][0]
    plan = floor["plan"]
    m = re.match(r"data:image/\w+;base64,(.*)", plan.get("dataUrl", ""), re.S)
    if not m:
        sys.exit("El proyecto no trae el plano incrustado (exporta con «Incrustar el plano»).")
    (out_dir / "plano.png").write_bytes(base64.b64decode(m.group(1)))
    img = Image.open(out_dir / "plano.png").convert("RGB")
    w, h = img.size

    cal = floor["calibration"]
    mpp = cal["realDistanceM"] / math.hypot(cal["a"]["x"] - cal["b"]["x"], cal["a"]["y"] - cal["b"]["y"])
    nodes = floor["nodes"]
    by_id = {n["id"]: n for n in nodes}

    edges = []
    for e in floor["edges"]:
        a, b = by_id[e["a"]], by_id[e["b"]]
        pts = [(a["x"], a["y"])] + [(p["x"], p["y"]) for p in e["waypoints"]] + [(b["x"], b["y"])]
        px_len = sum(math.hypot(pts[i][0] - pts[i + 1][0], pts[i][1] - pts[i + 1][1]) for i in range(len(pts) - 1))
        edges.append({**e, "meters": round(px_len * mpp, 2)})

    # --- huellas detectadas por color ---
    buildings = []

    def add(id_, name, poly, color, source, kind="building"):
        poly = [[round(x, 1), round(y, 1)] for x, y in poly]
        pt = (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))
        access = min(nodes, key=lambda n: dist_to_poly((n["x"], n["y"]), poly))
        buildings.append({"id": id_, "name": name, "kind": kind, "footprint": poly, "floors": 3, "floorsProvisional": True,
                          "color": color, "access": access["id"], "source": source})

    navy = components(img, lambda c: near(c, (44, 46, 120), 40), 250)
    # Ordenados por tamaño: A, G(1+2), F, I, L, B (se verifica por posición)
    def centroid(pts):
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))

    def label_for(pts):
        cx, cy = centroid(pts)
        if cx < 220 and cy < 150: return ("bloque-a", "Bloque A (Coliseo)")
        if 200 < cx < 330 and cy < 90: return ("bloque-b", "Bloque B")
        if cx > 400 and cy < 200: return ("bloque-f", "Bloque F")
        if cx > 480 and 200 < cy < 340: return ("biblioteca-i", "Biblioteca (Bloque I)")
        if cx > 480 and cy > 380: return ("bloque-l", "Bloque L")
        if 100 < cx < 400 and 150 < cy < 380: return ("bloques-g", "Bloques G1 y G2")
        return None

    for pts in navy:
        lab = label_for(pts)
        if not lab:
            continue
        poly = rdp(trace_outline(pts, w, h), 2.4)
        add(lab[0], lab[1], poly, "#003366", "auto")

    brick = components(img, lambda c: c[0] > 150 and c[1] < 110 and c[2] < 90, 2000)
    if brick:
        add("bloque-d", "Bloque D", rdp(trace_outline(brick[0], w, h), 2.4), "#B5502F", "auto")
    gray = components(img, lambda c: near(c, (192, 192, 192), 10), 6000)
    if gray:
        add("bloque-c", "Bloque C", rdp(trace_outline(gray[0], w, h), 2.4), "#8A9AAB", "auto")

    # --- aproximados a mano (no se distinguen por color); corregir en el editor ---
    add("cafeteria-h", "Cafetería (Bloque H)", [(333, 262), (372, 217), (398, 232), (398, 252), (356, 272)], "#7C8FA3", "aproximado")
    add("bloque-j", "Bloque J", [(97, 340), (152, 340), (152, 386), (97, 386)], "#D9A441", "aproximado")

    zones = vectorize(img, [b["footprint"] for b in buildings])

    data = {
        "zones": zones,
        "meta": {
            "source": src.name,
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "note": "Huellas detectadas por color o aproximadas; pisos provisionales. Corregir en el editor.",
        },
        "plan": {"image": "plano.png", "width": w, "height": h, "metersPerPixel": round(mpp, 6)},
        "nodes": [{"id": n["id"], "name": n["name"], "x": n["x"], "y": n["y"]} for n in nodes],
        "edges": edges,
        "buildings": buildings,
    }
    (out_dir / "campus.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK: {len(nodes)} nodos, {len(edges)} conexiones, {len(buildings)} bloques -> {out_dir}")
    from collections import Counter as _C
    print("  zonas:", dict(_C(z["kind"] for z in zones)), "| vértices:", sum(len(z["outline"]) + sum(len(hh) for hh in z["holes"]) for z in zones))
    for b in buildings:
        idx = next(i for i, n in enumerate(nodes, 1) if n["id"] == b["access"])
        print(f"  {b['id']:14} {len(b['footprint']):3} vértices  [{b['source']}]  acceso provisional: Nodo {idx}")


if __name__ == "__main__":
    main()
