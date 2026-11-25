// =====================================================================
//  lettore.js — Mostra le pagine del libro.
//  - una pagina alla volta, adattata alla larghezza (o alla pagina intera)
//  - frecce, scorrimento col dito, tastiera, zoom (anche con 2 dita)
//  - salva subito l'ultima pagina aperta
// =====================================================================
import { $, el, toast } from './ui.js';
import { stato, on, emit, salvaUltimaPagina, impostazioni } from './stato.js';
import { disegnaPagina } from './pdf.js';
import { etichettaPagina, interpretaPagina, unitaDiPdf } from './config.js';
import * as penna from './penna.js';

let scroll, wrap, canvasPdf, canvasPenna, riquadro;
let zoom = 1;
let renderInCorso = null;
let numeroRender = 0;
let evidenziaBox = null;   // rettangolo da evidenziare (esercizio trovato)

export function init() {
  scroll = $('#lettore-scroll');
  wrap = $('#pagina-wrap');
  canvasPdf = $('#canvas-pdf');
  canvasPenna = $('#canvas-penna');
  riquadro = $('#riquadro-evidenza');
  penna.init(canvasPenna);

  $('#btn-prec').onclick = () => vaiA(stato.pagina - 1);
  $('#btn-succ').onclick = () => vaiA(stato.pagina + 1);
  $('#btn-zoom-piu').onclick = () => impostaZoom(zoom * 1.25);
  $('#btn-zoom-meno').onclick = () => impostaZoom(zoom / 1.25);
  const campo = $('#campo-pagina');
  campo.addEventListener('change', () => {
    const p = interpretaPagina(campo.value);
    if (p) vaiA(p); else campo.value = etichettaPagina(stato.pagina);
  });
  campo.addEventListener('focus', () => campo.select());

  document.addEventListener('keydown', e => {
    if (document.querySelector('.scheda-sfondo') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (!$('#vista-libro').classList.contains('attiva')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') vaiA(stato.pagina + 1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') vaiA(stato.pagina - 1);
  });

  gestureDita();
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(ridisegna, 150); });
  on('impostazioni', ridisegna);
  // salva anche la posizione di scorrimento nella pagina
  let ts;
  scroll.addEventListener('scroll', () => {
    clearTimeout(ts);
    ts = setTimeout(() => salvaUltimaPagina(stato.pagina, { scrollTop: scroll.scrollTop, zoom }), 300);
  });
}

/** Va alla pagina PDF `n`. opzioni: { evidenzia: [x0,y0,x1,y1], scrollTop, zoom } */
export async function vaiA(n, opzioni = {}) {
  if (!stato.libro) return;
  n = Math.max(1, Math.min(stato.totalePagine, Math.round(n)));
  const cambiata = n !== stato.pagina;
  stato.pagina = n;
  evidenziaBox = opzioni.evidenzia || null;
  if (opzioni.zoom) zoom = opzioni.zoom;
  salvaUltimaPagina(n, { zoom });         // subito: così sopravvive a un crash
  aggiornaBarra();
  await ridisegna();
  if (opzioni.scrollTop != null) scroll.scrollTop = opzioni.scrollTop;
  else if (evidenziaBox) mostraEvidenza();
  else if (cambiata) scroll.scrollTop = 0;
  emit('pagina', n);
}

function aggiornaBarra() {
  $('#campo-pagina').value = etichettaPagina(stato.pagina);
  $('#totale-pagine').textContent = `PDF ${stato.pagina}/${stato.totalePagine}`;
  const u = unitaDiPdf(stato.pagina);
  $('#titolo-unita').textContent = u ? `Unità ${u.n} · ${u.titolo}` : 'Libro';
}

function larghezzaDisponibile(base) {
  const w = scroll.clientWidth - 16;
  if (impostazioni().adatta === 'pagina' && base) {
    const h = scroll.clientHeight - 16;
    return Math.min(w, h * base.width / base.height);
  }
  return w;
}

/** Ridisegna la pagina corrente (dopo zoom, rotazione, cambio pagina) */
export async function ridisegna() {
  if (!stato.libro) return;
  const mio = ++numeroRender;
  const page = await stato.libro.getPage(stato.pagina);
  if (mio !== numeroRender) return;
  const base = page.getViewport({ scale: 1 });
  const larghezza = larghezzaDisponibile(base) * zoom;
  // disegno su un canvas nuovo, poi lo scambio: niente pagina bianca mentre carica
  const nuovo = document.createElement('canvas');
  nuovo.id = 'canvas-pdf';
  nuovo.className = canvasPdf.className;
  let r;
  try {
    r = await disegnaPagina(stato.libro, stato.pagina, nuovo, larghezza, renderInCorso);
    renderInCorso = r.task;
    await r.task.promise;
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') console.error(e);
    return;
  }
  if (mio !== numeroRender) return;
  canvasPdf.replaceWith(nuovo);
  canvasPdf = nuovo;
  wrap.style.width = `${r.larghezza}px`;
  wrap.style.height = `${r.altezza}px`;
  wrap.dataset.scala = r.larghezza / r.base.width;   // pixel CSS per punto PDF
  penna.mostraPagina(stato.pagina, r.larghezza, r.altezza);
  posizionaEvidenza();
}

function posizionaEvidenza() {
  if (!evidenziaBox) { riquadro.hidden = true; return; }
  const s = Number(wrap.dataset.scala);
  const [x0, y0, x1, y1] = evidenziaBox;
  Object.assign(riquadro.style, { left: `${x0 * s}px`, top: `${y0 * s}px`, width: `${(x1 - x0) * s}px`, height: `${(y1 - y0) * s}px` });
  riquadro.hidden = false;
  riquadro.classList.remove('lampeggia'); void riquadro.offsetWidth; riquadro.classList.add('lampeggia');
}

function mostraEvidenza() {
  const s = Number(wrap.dataset.scala);
  scroll.scrollTop = Math.max(0, evidenziaBox[1] * s - 80);
}

export function impostaZoom(z) {
  zoom = Math.max(1, Math.min(4, z));
  ridisegna();
}

/** Scorrimento col dito per cambiare pagina + zoom con due dita */
function gestureDita() {
  let inizio = null, pinch = null;
  scroll.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), zoom };
      inizio = null;
    } else if (e.touches.length === 1 && e.touches[0].touchType !== 'stylus') {
      inizio = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), sl: scroll.scrollLeft };
    }
  }, { passive: true });
  scroll.addEventListener('touchmove', e => {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const f = Math.max(1 / pinch.zoom, Math.min(4 / pinch.zoom, d / pinch.d));
      wrap.style.transformOrigin = 'top center';
      wrap.style.transform = `scale(${f})`;
      pinch.f = f;
    }
  }, { passive: false });
  scroll.addEventListener('touchend', e => {
    if (pinch && e.touches.length < 2) {
      wrap.style.transform = '';
      if (pinch.f) impostaZoom(pinch.zoom * pinch.f);
      pinch = null;
      return;
    }
    if (!inizio || penna.staDisegnando()) { inizio = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - inizio.x, dy = t.clientY - inizio.y, dt = Date.now() - inizio.t;
    // solo se la pagina non è zoomata in orizzontale (o siamo al bordo)
    const alBordo = scroll.scrollWidth <= scroll.clientWidth + 2 ||
      (dx < 0 && scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 2) || (dx > 0 && scroll.scrollLeft <= 2);
    if (alBordo && dt < 600 && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) {
      vaiA(stato.pagina + (dx < 0 ? 1 : -1));
    }
    inizio = null;
  });
  // Safari: blocca lo zoom di tutta la pagina web, lo gestiamo noi
  document.addEventListener('gesturestart', e => e.preventDefault());
}

export function zoomAttuale() { return zoom; }
