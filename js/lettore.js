// =====================================================================
//  lettore.js — Mostra le pagine del libro.
//  - una pagina, oppure due affiancate (come il libro aperto)
//  - la pagina si adatta allo schermo (tutta intera, o alla larghezza)
//  - zoom con due dita: ingrandisce proprio dove hai le dita
//  - doppio tocco col dito: ingrandisce lì / torna alla pagina intera
//  - frecce, scorrimento col dito, tastiera
//  - salva subito l'ultima pagina aperta
// =====================================================================
import { $ } from './ui.js';
import { stato, on, emit, salvaUltimaPagina, impostazioni, salvaImpostazione } from './stato.js';
import { disegnaPagina } from './pdf.js';
import { etichettaPagina, interpretaPagina, unitaDiPdf, pdfToLibro } from './config.js';
import * as penna from './penna.js';

const ZOOM_MIN = 1, ZOOM_MAX = 5;
const MARGINE = 10;      // spazio intorno alla pagina (px)
const DORSO = 4;         // spazio fra le due pagine affiancate (px)

let scroll, pagine, riquadro;
let lati = [];           // [{ wrap, canvas, foglio, pdf, task }]  0 = sinistra, 1 = destra
let zoom = 1;            // 1 = pagina adattata allo schermo
let numeroRender = 0;
let evidenziaBox = null; // rettangolo da evidenziare (esercizio trovato)

export function init() {
  scroll = $('#lettore-scroll');
  pagine = $('#pagine');
  riquadro = $('#riquadro-evidenza');
  penna.init();
  lati = ['#pagina-wrap', '#pagina-wrap-2'].map(sel => {
    const wrap = $(sel);
    return { wrap, canvas: wrap.querySelector('.canvas-pdf'), foglio: penna.collega(wrap.querySelector('.canvas-penna')), pdf: null, task: null };
  });

  $('#btn-prec').onclick = () => sfoglia(-1);
  $('#btn-succ').onclick = () => sfoglia(1);
  $('#btn-zoom-piu').onclick = () => zoomAlCentro(zoom * 1.25);
  $('#btn-zoom-meno').onclick = () => zoomAlCentro(zoom / 1.25);
  $('#btn-zoom-adatta').onclick = () => zoomAlCentro(1);
  $('#btn-due-pagine').onclick = () => {
    salvaImpostazione('duePagine', dueAttive() ? 'no' : 'si');
  };
  const campo = $('#campo-pagina');
  campo.addEventListener('change', () => {
    const p = interpretaPagina(campo.value);
    if (p) vaiA(p); else aggiornaBarra();
  });
  campo.addEventListener('focus', () => { campo.value = etichettaPagina(stato.pagina); campo.select(); });
  campo.addEventListener('blur', () => aggiornaBarra());

  document.addEventListener('keydown', e => {
    if (document.querySelector('.scheda-sfondo') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (!$('#vista-libro').classList.contains('attiva')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') sfoglia(1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') sfoglia(-1);
  });

  gestureDita();
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(ridisegna, 150); });
  on('impostazioni', () => { aggiornaBarra(); ridisegna(); });
  // salva anche la posizione di scorrimento nella pagina
  let ts;
  scroll.addEventListener('scroll', () => {
    clearTimeout(ts);
    ts = setTimeout(() => salvaUltimaPagina(stato.pagina, { scrollTop: scroll.scrollTop, zoom }), 300);
  });
}

// ---------------------------------------------------------------------
//  Una o due pagine
// ---------------------------------------------------------------------

/** Due pagine affiancate? (impostazione, oppure "automatico" = iPad in orizzontale) */
export function dueAttive() {
  const d = impostazioni().duePagine;
  if (d === 'si') return true;
  if (d === 'no') return false;
  return window.innerWidth > window.innerHeight && window.innerWidth >= 700;
}

/**
 * Le due pagine affiancate che contengono la pagina n: [sinistra, destra].
 * Come nel libro vero: la pagina stampata PARI sta a sinistra.
 * La prima pagina (copertina) resta da sola.
 */
function coppia(n) {
  const tot = stato.totalePagine;
  const p = pdfToLibro(n);
  const pari = p != null ? p % 2 === 0 : n % 2 === 0;
  const sx = pari ? n : n - 1;
  if (sx < 1) return [n, null];
  return [sx, sx + 1 <= tot ? sx + 1 : null];
}

/** Pagine mostrate ora */
function pagineVisibili() {
  return dueAttive() ? coppia(stato.pagina) : [stato.pagina, null];
}

/** Avanti (+1) o indietro (−1): con due pagine si gira di due */
export function sfoglia(verso) {
  if (!stato.libro) return;
  const [sx, dx] = pagineVisibili();
  if (verso > 0) vaiA((dx || sx) + 1);
  else vaiA(sx - 1);
}

// ---------------------------------------------------------------------
//  Cambio pagina e disegno
// ---------------------------------------------------------------------

/** Va alla pagina PDF `n`. opzioni: { evidenzia: [x0,y0,x1,y1], scrollTop, zoom } */
export async function vaiA(n, opzioni = {}) {
  if (!stato.libro) return;
  n = Math.max(1, Math.min(stato.totalePagine, Math.round(n)));
  const prima = pagineVisibili();
  stato.pagina = n;
  const cambiata = pagineVisibili()[0] !== prima[0];
  evidenziaBox = opzioni.evidenzia || null;
  if (opzioni.zoom) zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, opzioni.zoom));
  salvaUltimaPagina(n, { zoom });         // subito: così sopravvive a un crash
  aggiornaBarra();
  await ridisegna();
  if (opzioni.scrollTop != null) scroll.scrollTop = opzioni.scrollTop;
  else if (evidenziaBox) mostraEvidenza();
  else if (cambiata) { scroll.scrollTop = 0; scroll.scrollLeft = 0; }
  emit('pagina', n);
}

function aggiornaBarra() {
  if (!stato.libro) return;
  const [sx, dx] = pagineVisibili();
  const campo = $('#campo-pagina');
  if (document.activeElement !== campo) {
    campo.value = dx ? `${etichettaPagina(sx)}–${etichettaPagina(dx)}` : etichettaPagina(sx);
  }
  $('#totale-pagine').textContent = `PDF ${sx}${dx ? '–' + dx : ''} di ${stato.totalePagine}`;
  const u = unitaDiPdf(stato.pagina);
  $('#titolo-unita').textContent = u ? `Unità ${u.n} · ${u.titolo}` : 'Libro';
  $('#btn-zoom-adatta').textContent = `${Math.round(zoom * 100)}%`;
  $('#btn-due-pagine').classList.toggle('attivo', dueAttive());
  $('#btn-due-pagine').innerHTML = `<svg class="ic"><use href="#i-${dueAttive() ? 'due-pagine' : 'una-pagina'}"/></svg>`;
}

/** Ridisegna le pagine visibili (dopo zoom, rotazione, cambio pagina) */
export async function ridisegna() {
  if (!stato.libro) return false;
  const mio = ++numeroRender;
  const numeri = pagineVisibili();
  const usati = numeri.filter(Boolean);
  const pagPdf = await Promise.all(usati.map(n => stato.libro.getPage(n)));
  if (mio !== numeroRender) return false;
  const basi = pagPdf.map(p => p.getViewport({ scale: 1 }));

  // Stessa altezza per le due pagine; insieme devono stare nello schermo
  const W = scroll.clientWidth - 2 * MARGINE;
  const H = scroll.clientHeight - 2 * MARGINE;
  const dorso = usati.length > 1 ? DORSO : 0;
  const somma = basi.reduce((a, b) => a + b.width / b.height, 0);
  let altezza = (W - dorso) / somma;                                  // adatta alla larghezza
  if (impostazioni().vistaPagina !== 'larghezza') altezza = Math.min(altezza, H);  // tutta la pagina
  altezza *= zoom;

  // disegno su tele nuove, poi le scambio: niente pagina bianca mentre carica
  const lavori = usati.map((n, i) => {
    const lato = lati[i];
    const nuovo = document.createElement('canvas');
    nuovo.className = 'canvas-pdf';
    const larghezza = altezza * basi[i].width / basi[i].height;
    return disegnaPagina(stato.libro, n, nuovo, larghezza, lato.task).then(r => { lato.task = r.task; return r.task.promise.then(() => ({ r, nuovo, n })); });
  });
  let fatti;
  try {
    fatti = await Promise.all(lavori);
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') console.error(e);
    return false;
  }
  if (mio !== numeroRender) return false;

  fatti.forEach(({ r, nuovo, n }, i) => {
    const lato = lati[i];
    lato.canvas.replaceWith(nuovo);
    lato.canvas = nuovo;
    lato.pdf = n;
    lato.wrap.hidden = false;
    lato.wrap.style.width = `${r.larghezza}px`;
    lato.wrap.style.height = `${r.altezza}px`;
    lato.wrap.dataset.scala = r.larghezza / r.base.width;   // pixel CSS per punto PDF
    lato.wrap.dataset.pdf = n;
    penna.mostraPagina(lato.foglio, n, r.larghezza, r.altezza);
  });
  // lato destro non usato
  if (fatti.length < 2) {
    lati[1].wrap.hidden = true;
    lati[1].pdf = null;
    penna.libera(lati[1].foglio);
  }
  pagine.classList.toggle('affiancate', fatti.length > 1);
  aggiornaBarra();
  posizionaEvidenza();
  return true;
}

/** Il riquadro arancione va sulla pagina dell'esercizio */
function posizionaEvidenza() {
  const lato = lati.find(l => l.pdf === stato.pagina);
  if (!evidenziaBox || !lato) { riquadro.hidden = true; return; }
  if (riquadro.parentElement !== lato.wrap) lato.wrap.append(riquadro);
  const s = Number(lato.wrap.dataset.scala);
  const [x0, y0, x1, y1] = evidenziaBox;
  Object.assign(riquadro.style, { left: `${x0 * s}px`, top: `${y0 * s}px`, width: `${(x1 - x0) * s}px`, height: `${(y1 - y0) * s}px` });
  riquadro.hidden = false;
  riquadro.classList.remove('lampeggia'); void riquadro.offsetWidth; riquadro.classList.add('lampeggia');
}

function mostraEvidenza() {
  const lato = lati.find(l => l.pdf === stato.pagina);
  if (!lato) return;
  const s = Number(lato.wrap.dataset.scala);
  const r = lato.wrap.getBoundingClientRect(), rs = scroll.getBoundingClientRect();
  scroll.scrollTop += r.top - rs.top + evidenziaBox[1] * s - 80;
  scroll.scrollLeft += r.left - rs.left + evidenziaBox[0] * s - 40;
}

// ---------------------------------------------------------------------
//  Zoom
// ---------------------------------------------------------------------

/**
 * Cambia lo zoom tenendo fermo un punto.
 * fx, fy = punto delle pagine (frazione 0..1 della larghezza/altezza)
 * cx, cy = dove deve restare quel punto sullo schermo (coordinate del dito)
 */
async function zoomVerso(nuovo, fx, fy, cx, cy) {
  nuovo = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nuovo));
  if (Math.abs(nuovo - zoom) < 0.01) { pagine.style.transform = ''; return; }
  zoom = nuovo;
  const ok = await ridisegna();
  pagine.style.transform = '';
  if (!ok) return;
  const r = pagine.getBoundingClientRect();
  scroll.scrollLeft += r.left + fx * r.width - cx;
  scroll.scrollTop += r.top + fy * r.height - cy;
  salvaUltimaPagina(stato.pagina, { scrollTop: scroll.scrollTop, zoom });
}

/** Frazione del punto (cx, cy) dentro le pagine */
function frazione(cx, cy) {
  const r = pagine.getBoundingClientRect();
  return [(cx - r.left) / r.width, (cy - r.top) / r.height];
}

/** Zoom dei bottoni + / − : intorno al centro dello schermo */
export function zoomAlCentro(z) {
  const rs = scroll.getBoundingClientRect();
  const cx = rs.left + rs.width / 2, cy = rs.top + rs.height / 2;
  const [fx, fy] = frazione(cx, cy);
  return zoomVerso(z, fx, fy, cx, cy);
}
export const impostaZoom = zoomAlCentro;

/** Dita: sfogliare, zoom con due dita (dove sono le dita), doppio tocco */
function gestureDita() {
  let inizio = null, pinch = null, ultimoTocco = null;
  const centro = (a, b) => [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2];

  scroll.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      const [mx, my] = centro(a, b);
      const r = pagine.getBoundingClientRect();
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), r, f: 1, fx: (mx - r.left) / r.width, fy: (my - r.top) / r.height, mx, my };
      pagine.style.transformOrigin = '0 0';
      inizio = null;
    } else if (e.touches.length === 1 && e.touches[0].touchType !== 'stylus') {
      inizio = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }
  }, { passive: true });

  scroll.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = e.touches;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const f = Math.max(ZOOM_MIN / zoom, Math.min(ZOOM_MAX / zoom, d / pinch.d));
    const [mx, my] = centro(a, b);
    // il punto sotto le dita resta sotto le dita (e segue le dita se le sposti)
    const tx = mx - pinch.r.left - f * pinch.fx * pinch.r.width;
    const ty = my - pinch.r.top - f * pinch.fy * pinch.r.height;
    pagine.style.transform = `translate(${tx}px, ${ty}px) scale(${f})`;
    Object.assign(pinch, { f, mx, my });
  }, { passive: false });

  scroll.addEventListener('touchend', e => {
    if (pinch) {
      if (e.touches.length < 2) {
        const p = pinch;
        pinch = null;
        zoomVerso(zoom * p.f, p.fx, p.fy, p.mx, p.my);
      }
      inizio = null;
      return;
    }
    if (!inizio || penna.staDisegnando()) { inizio = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - inizio.x, dy = t.clientY - inizio.y, dt = Date.now() - inizio.t;

    // doppio tocco: ingrandisce lì, oppure torna alla pagina intera
    const tocco = Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 300;
    const penna_dito = penna.eAttiva() && !impostazioni().soloPencil;
    if (tocco && !penna_dito) {
      const ora = Date.now();
      if (ultimoTocco && ora - ultimoTocco.t < 320 && Math.hypot(t.clientX - ultimoTocco.x, t.clientY - ultimoTocco.y) < 40) {
        ultimoTocco = null;
        const [fx, fy] = frazione(t.clientX, t.clientY);
        zoomVerso(zoom > 1.05 ? 1 : 2.2, fx, fy, t.clientX, t.clientY);
        inizio = null;
        return;
      }
      ultimoTocco = { t: ora, x: t.clientX, y: t.clientY };
    }

    // scorrimento veloce a destra/sinistra: cambia pagina
    // (solo se la pagina non è zoomata in orizzontale, oppure siamo al bordo)
    const alBordo = scroll.scrollWidth <= scroll.clientWidth + 2 ||
      (dx < 0 && scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 2) || (dx > 0 && scroll.scrollLeft <= 2);
    if (alBordo && dt < 600 && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) sfoglia(dx < 0 ? 1 : -1);
    inizio = null;
  });

  // Computer: Ctrl + rotella (o pizzico sul trackpad) = zoom dove c'è il mouse
  let accumulo = null;
  scroll.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (!accumulo) {
      const r = pagine.getBoundingClientRect();
      accumulo = { f: 1, r, fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, cx: e.clientX, cy: e.clientY };
      pagine.style.transformOrigin = '0 0';
    }
    const a = accumulo;
    a.f = Math.max(ZOOM_MIN / zoom, Math.min(ZOOM_MAX / zoom, a.f * Math.exp(-e.deltaY / 200)));
    pagine.style.transform = `translate(${a.cx - a.r.left - a.f * a.fx * a.r.width}px, ${a.cy - a.r.top - a.f * a.fy * a.r.height}px) scale(${a.f})`;
    clearTimeout(a.timer);
    a.timer = setTimeout(() => { accumulo = null; zoomVerso(zoom * a.f, a.fx, a.fy, a.cx, a.cy); }, 180);
  }, { passive: false });

  // Safari: blocca lo zoom di tutta la pagina web, lo gestiamo noi
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('gesturechange', e => e.preventDefault());
}

export function zoomAttuale() { return zoom; }

/** Pagina PDF e scala (pixel per punto) sotto un punto dello schermo, per i tocchi sugli esercizi */
export function paginaSotto(cx, cy) {
  for (const l of lati) {
    if (l.wrap.hidden || l.pdf == null) continue;
    const r = l.wrap.getBoundingClientRect();
    if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
      const s = Number(l.wrap.dataset.scala);
      return { pdf: l.pdf, x: (cx - r.left) / s, y: (cy - r.top) / s, wrap: l.wrap };
    }
  }
  return null;
}
