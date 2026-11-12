/**
 * Reconocimiento de lugares con el modelo de Teachable Machine (vision/modelo).
 * TensorFlow.js se carga solo cuando alguien usa «Ubicarme con una foto» (pesa ~1.4 MB).
 * El preprocesamiento replica el de @teachablemachine/image:
 *   recorte cuadrado centrado → 224×224 → valores en [-1, 1] (÷127 − 1).
 */
let tfReady = null, model = null, meta = null, labelsMap = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

export async function loadModel() {
  if (model) return { model, meta, labelsMap };
  if (!tfReady) tfReady = window.tf ? Promise.resolve() : loadScript('vendor/tfjs/tf.min.js');
  await tfReady;
  const [m, md, lm] = await Promise.all([
    window.tf.loadLayersModel('vision/modelo/model.json'),
    fetch('vision/modelo/metadata.json').then((r) => r.json()),
    fetch('vision/etiquetas.json').then((r) => r.json())
  ]);
  model = m; meta = md; labelsMap = lm;
  return { model, meta, labelsMap };
}

async function decode(file) {
  try { return await createImageBitmap(file); } catch (_) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Formato de imagen no compatible. Usa una foto JPG o PNG.')); };
      img.src = url;
    });
  }
}

function cropTo(image, size) {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const w = image.width, h = image.height, min = Math.min(w, h), scale = size / min;
  const sw = Math.ceil(w * scale), sh = Math.ceil(h * scale);
  c.getContext('2d').drawImage(image, -Math.floor((sw - size) / 2), -Math.floor((sh - size) / 2), sw, sh);
  return c;
}

/** Devuelve las clases ordenadas por probabilidad: [{ clase, prob, lugar, nombre }]. */
export async function classify(file) {
  const { model, meta, labelsMap } = await loadModel();
  const tf = window.tf;
  const img = await decode(file);
  const canvas = cropTo(img, meta.imageSize || 224);
  const probs = tf.tidy(() => {
    const x = tf.browser.fromPixels(canvas).toFloat().div(tf.scalar(127)).sub(tf.scalar(1)).expandDims(0);
    return model.predict(x).dataSync();
  });
  return meta.labels.map((clase, i) => {
    const info = labelsMap.clases[clase] || { lugar: null, nombre: clase };
    return { clase, prob: probs[i], lugar: info.lugar, nombre: info.nombre };
  }).sort((a, b) => b.prob - a.prob);
}

export const thresholds = () => ({ umbral: labelsMap?.umbral ?? 0.75, margen: labelsMap?.margen ?? 0.25 });
