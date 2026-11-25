// =====================================================================
//  pdf.js — Apre e disegna i PDF salvati sul dispositivo.
//  Usa la libreria pdf.js (cartella vendor/pdfjs).
//
//  Trucco per la memoria: il libro pesa ~130 MB. Invece di caricarlo
//  tutto in memoria, pdf.js legge solo i pezzi che servono dal file
//  salvato (Blob) con "BlobTransport".
// =====================================================================
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

/** Legge dal Blob solo i byte che pdf.js chiede */
class BlobTransport extends pdfjsLib.PDFDataRangeTransport {
  constructor(blob) {
    super(blob.size, null);
    this.blob = blob;
  }
  requestDataRange(inizio, fine) {
    this.blob.slice(inizio, fine).arrayBuffer()
      .then(buf => this.onDataRange(inizio, new Uint8Array(buf)))
      .catch(err => console.error('Lettura PDF', err));
  }
}

const aperti = new Map(); // chiave -> Promise<PDFDocumentProxy>

/** Apre un PDF (Blob) e lo tiene aperto. chiave = "libro", "svolti-10", … */
export function apriPdf(chiave, blob) {
  if (!aperti.has(chiave)) {
    const task = pdfjsLib.getDocument({
      range: new BlobTransport(blob),
      rangeChunkSize: 256 * 1024,
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
    });
    const p = task.promise.catch(err => { aperti.delete(chiave); throw err; });
    aperti.set(chiave, p);
  }
  return aperti.get(chiave);
}

export async function chiudiPdf(chiave) {
  const p = aperti.get(chiave);
  aperti.delete(chiave);
  if (p) { try { (await p).destroy(); } catch (e) { /* */ } }
}

/** Limite di pixel per una tela su iPad (oltre, Safari la lascia bianca) */
const MAX_PIXEL = 16 * 1024 * 1024;

/**
 * Disegna una pagina intera in un canvas largo `larghezzaCss` pixel CSS.
 * Restituisce { larghezza, altezza } in pixel CSS.
 */
export async function disegnaPagina(doc, numero, canvas, larghezzaCss, renderPrecedente) {
  const page = await doc.getPage(numero);
  const base = page.getViewport({ scale: 1 });
  const scalaCss = larghezzaCss / base.width;
  let dpr = window.devicePixelRatio || 1;
  // non superare il limite di pixel
  while ((base.width * scalaCss * dpr) * (base.height * scalaCss * dpr) > MAX_PIXEL && dpr > 0.5) dpr -= 0.25;
  const vp = page.getViewport({ scale: scalaCss * dpr });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = `${Math.floor(base.width * scalaCss)}px`;
  canvas.style.height = `${Math.floor(base.height * scalaCss)}px`;
  if (renderPrecedente) { try { renderPrecedente.cancel(); } catch (e) { /* */ } }
  const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
  return { task, larghezza: base.width * scalaCss, altezza: base.height * scalaCss, base };
}

/**
 * Ritaglia un rettangolo di una pagina e lo disegna ad alta risoluzione.
 * box = [x0, y0, x1, y1] in punti PDF, origine in alto a sinistra.
 * Restituisce un nuovo <canvas>.
 */
export async function ritaglio(doc, numero, box, larghezzaCss) {
  const page = await doc.getPage(numero);
  const [x0, y0, x1, y1] = box;
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const scalaCss = larghezzaCss / w;
  let dpr = Math.min(3, (window.devicePixelRatio || 1) * 1.5); // più nitido del normale
  while ((w * scalaCss * dpr) * (h * scalaCss * dpr) > MAX_PIXEL && dpr > 0.5) dpr -= 0.25;
  const s = scalaCss * dpr;
  const vp = page.getViewport({ scale: s });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * s);
  canvas.height = Math.ceil(h * s);
  canvas.style.width = '100%';
  canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -x0 * s, -y0 * s] }).promise;
  return canvas;
}

/** Toglie le righe bianche in fondo a un canvas (le soluzioni hanno spazio vuoto) */
export function tagliaBiancoInFondo(canvas, margine = 12) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const dati = ctx.getImageData(0, 0, width, height).data;
  let ultima = 0;
  for (let y = height - 1; y >= 0; y--) {
    const riga = y * width * 4;
    let piena = false;
    for (let x = 0; x < width; x += 3) {
      const i = riga + x * 4;
      if (dati[i] < 235 || dati[i + 1] < 235 || dati[i + 2] < 235) { piena = true; break; }
    }
    if (piena) { ultima = y; break; }
  }
  const nuovaAltezza = Math.min(height, ultima + margine);
  if (nuovaAltezza >= height - 2 || nuovaAltezza < 8) return canvas;
  const c = document.createElement('canvas');
  c.width = width; c.height = nuovaAltezza;
  c.getContext('2d').drawImage(canvas, 0, 0);
  c.style.width = '100%';
  c.style.aspectRatio = `${width} / ${nuovaAltezza}`;
  return c;
}

/** Testo di una pagina come lista di pezzi {str, x, y, h} (y dall'alto) */
export async function testoPagina(doc, numero) {
  const page = await doc.getPage(numero);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  return tc.items.filter(it => it.str !== undefined).map(it => {
    const [, , , d, e, f] = it.transform;
    const [x, y] = vp.convertToViewportPoint(e, f);
    return { str: it.str, x, y: y - Math.abs(d), h: Math.abs(d), w: it.width };
  });
}

export { pdfjsLib };
