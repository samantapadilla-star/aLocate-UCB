"""
Convierte las fotos HEIC/HEIF (y JPG/PNG) de una carpeta a JPG listos para el reconocimiento.

- NO toca los originales: escribe en otra carpeta, con la misma estructura de subcarpetas.
- Aplica la rotación del teléfono (EXIF) y reduce el lado largo a --max px (por defecto 1024).
- Renombra: <carpeta>-001.jpg, <carpeta>-002.jpg ...  (carpetas y nombres sin tildes ni espacios).
- Elimina los metadatos al guardar (incluida la ubicación GPS) por privacidad.
  El manifiesto solo anota SI la foto original tenía GPS (columna has_gps), no las coordenadas.
- Escribe manifest.csv (una fila por foto) y imprime cuántas fotos hay por carpeta.

Uso (PowerShell):
    pip install pillow pillow-heif
    python tools/convert_photos.py "RUTA\\fotos" "RUTA\\fotos-jpg"
"""
import argparse
import csv
import re
import sys
import unicodedata
from pathlib import Path

from PIL import Image, ImageOps

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:
    sys.exit("Falta pillow-heif. Ejecuta:  pip install pillow pillow-heif")

EXTS = {".heic", ".heif", ".jpg", ".jpeg", ".png"}


def slug(text: str) -> str:
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text or "sin-nombre"


def has_gps(img: Image.Image) -> bool:
    try:
        exif = img.getexif()
        return bool(exif.get_ifd(0x8825))  # GPS IFD
    except Exception:
        return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("origen", type=Path)
    ap.add_argument("destino", type=Path)
    ap.add_argument("--max", type=int, default=1024, help="lado largo máximo en px")
    ap.add_argument("--calidad", type=int, default=88)
    args = ap.parse_args()

    if not args.origen.is_dir():
        sys.exit(f"No existe la carpeta de origen: {args.origen}")
    if args.destino.resolve() == args.origen.resolve():
        sys.exit("El destino debe ser una carpeta distinta de la de origen.")

    files = sorted(p for p in args.origen.rglob("*") if p.is_file() and p.suffix.lower() in EXTS)
    if not files:
        sys.exit("No se encontraron fotos (.heic, .heif, .jpg, .png) en el origen.")

    counters: dict[str, int] = {}
    rows, errors = [], []
    args.destino.mkdir(parents=True, exist_ok=True)

    for src in files:
        rel_dir = src.parent.relative_to(args.origen)
        parts = [slug(p) for p in rel_dir.parts] or ["sin-carpeta"]
        out_dir = args.destino.joinpath(*parts)
        key = "/".join(parts)
        counters[key] = counters.get(key, 0) + 1
        out_name = f"{parts[-1]}-{counters[key]:03d}.jpg"
        try:
            with Image.open(src) as img:
                gps = has_gps(img)
                img = ImageOps.exif_transpose(img).convert("RGB")
                img.thumbnail((args.max, args.max), Image.LANCZOS)
                out_dir.mkdir(parents=True, exist_ok=True)
                img.save(out_dir / out_name, "JPEG", quality=args.calidad, optimize=True)
                rows.append([key, out_name, str(src.relative_to(args.origen)), img.width, img.height, gps])
        except Exception as e:  # foto dañada o formato no soportado
            counters[key] -= 1
            errors.append((str(src), str(e)))

    with open(args.destino / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["carpeta", "archivo", "original", "ancho", "alto", "has_gps"])
        w.writerows(rows)

    print(f"\nConvertidas: {len(rows)} fotos -> {args.destino}")
    print("\nFotos por carpeta:")
    for k, n in sorted(counters.items()):
        aviso = "   <-- pocas (se recomiendan al menos 5)" if n < 5 else ""
        print(f"  {k}: {n}{aviso}")
    if errors:
        print(f"\nNo se pudieron convertir {len(errors)} archivos:")
        for path, err in errors:
            print(f"  {path}: {err}")


if __name__ == "__main__":
    main()
