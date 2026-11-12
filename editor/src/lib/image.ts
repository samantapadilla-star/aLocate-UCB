import type { PlanRef } from '../core/types';

/** Imagen del plano en memoria. `url` es temporal (blob:) y NUNCA se guarda en el proyecto. */
export interface PlanAsset {
  blob: Blob;
  url: string;
}

export interface ImageInfo {
  width: number;
  height: number;
  sha256: string;
}

export const makeAsset = (blob: Blob): PlanAsset => ({ blob, url: URL.createObjectURL(blob) });

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeSize(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen. Usa un PNG o JPG válido.'));
    };
    img.src = url;
  });
}

export async function inspectImage(blob: Blob): Promise<ImageInfo> {
  const [size, sha256] = await Promise.all([decodeSize(blob), blob.arrayBuffer().then(sha256Hex)]);
  return { ...size, sha256 };
}

export type PlanMatch = 'exact' | 'same-size' | 'different';

export function comparePlan(info: ImageInfo, ref: PlanRef): PlanMatch {
  if (info.sha256 === ref.sha256 && info.width === ref.width && info.height === ref.height) return 'exact';
  if (info.width === ref.width && info.height === ref.height) return 'same-size';
  return 'different';
}

export function isSupportedImage(file: File): boolean {
  return /^image\/(png|jpeg)$/.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);
}

export async function readPlanFile(file: File): Promise<{ ref: PlanRef; asset: PlanAsset }> {
  if (!isSupportedImage(file)) throw new Error('El plano debe ser un archivo PNG o JPG.');
  const info = await inspectImage(file);
  const mimeType = file.type || (/\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg');
  return {
    ref: { fileName: file.name, mimeType, width: info.width, height: info.height, sha256: info.sha256 },
    asset: makeAsset(file),
  };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo codificar la imagen.'));
    reader.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

/** Dibuja el plano ficticio de la demostración (1000×600) y lo devuelve como PNG. */
export function drawDemoPlan(width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f6f3ea';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#ddd7c6';
  ctx.lineWidth = 1;
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#a39e8d';
  for (let x = 0; x <= width; x += 100) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
    ctx.fillText(String(x), x + 3, 12);
  }
  for (let y = 0; y <= height; y += 100) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
    ctx.fillText(String(y), 3, y + 12);
  }
  // Barra de referencia: 500 px = 50 m (la calibración de la demostración)
  ctx.strokeStyle = '#333';
  ctx.fillStyle = '#333';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(100, 500);
  ctx.lineTo(600, 500);
  ctx.moveTo(100, 490);
  ctx.lineTo(100, 510);
  ctx.moveTo(600, 490);
  ctx.lineTo(600, 510);
  ctx.stroke();
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('Barra de referencia de la demostración: 500 px = 50 m', 110, 530);
  ctx.font = 'bold 18px sans-serif';
  ctx.fillStyle = '#b3261e';
  ctx.fillText('PLANO DE DEMOSTRACIÓN — no representa ninguna ubicación real de la UCB', 20, height - 20);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la demostración.'))), 'image/png'),
  );
}
