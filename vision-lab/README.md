# vision-lab

Prototipo de reconocimiento de lugares. Objetivo: dada una foto, devolver los 3 lugares más parecidos con su puntuación.

Plan:
1. Fotos de referencia por lugar en `photos/<codigo-del-lugar>/` (no se suben al repositorio).
2. Fotos de prueba aparte en `photos-test/` (nunca se usan como referencia).
3. Huella de cada foto con un modelo abierto (DINOv2: https://github.com/facebookresearch/dinov2).
4. Búsqueda del lugar más parecido y medición de aciertos (primero y entre los 3 primeros).

Antes de convertir las fotos HEIC, usar `tools/convert_photos.py`.
