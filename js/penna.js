// =====================================================================
//  penna.js — Scrivere sul libro con l'Apple Pencil.
//
//  Ogni tratto è salvato come lista di punti in coordinate 0..1
//  (relative alla pagina), così resta al posto giusto con ogni zoom.
//  Tratto = { t: 'penna'|'evid', c: colore, w: spessore, p: [[x, y, pressione], …] }
//  I tratti di ogni pagina sono salvati in IndexedDB (store "tratti").
// =====================================================================
import { $, $$ } from './ui.js';
import { db, ldb } from './db.js';
import { impostazioni, salvaImpostazione, on } from './stato.js';

// Un "foglio" = la tela trasparente sopra una pagina (con 2 pagine affiancate ce ne sono 2)
const fogli = [];
let ultimo = null;        // foglio usato per ultimo (annulla/rifai lavorano su questo)
let corrente = null;      // tratto che sto disegnando
let attivo = false;       // barra penna aperta?
const strumento = { tipo: 'penna', colore: '#1a1a1a', coloreEvid: '#ffe14d', spessore: 2 };

const COLORI = ['#1a1a1a', '#1f5fd6', '#d62f2f', '#1e9e4a'];
const COLORI_EVID = ['#ffe14d', '#7ff0a0', '#ff9bd2', '#8fd3ff'];

/** Prepara la barra della penna (una volta sola) */
export function init() {
  costruisciBarra();
  on('impostazioni', aggiornaModo);
  // altro libro: dimentico le pagine (stesso numero, libro diverso)
  on('libro-cambiato', () => fogli.forEach(f => { f.pagina = null; f.tratti = []; f.annullati = []; }));
}

/** Collega una tela trasparente: da qui si può scrivere. Restituisce il numero del foglio. */
export function collega(canvas) {
  const f = { canvas, ctx: canvas.getContext('2d'), pagina: null, W: 0, H: 0, tratti: [], annullati: [], timer: null };
  fogli.push(f);
  canvas.addEventListener('pointerdown', e => giu(f, e));
  canvas.addEventListener('pointermove', e => muovi(f, e));
  canvas.addEventListener('pointerup', () => su(f));
  canvas.addEventListener('pointercancel', () => su(f));
  // Su iPad: se tocca la Pencil, blocca lo scorrimento della pagina.
  // Il dito invece continua a scorrere.
  const bloccaStilo = e => {
    if (!attivo) return;
    const t = e.touches[0];
    if (e.touches.length === 1 && t && (t.touchType === 'stylus' || !impostazioni().soloPencil)) e.preventDefault();
  };
  canvas.addEventListener('touchstart', bloccaStilo, { passive: false });
  canvas.addEventListener('touchmove', bloccaStilo, { passive: false });
  aggiornaModo();
  return fogli.length - 1;
}

/** Mostra/nasconde la barra della penna */
export function attiva(si) {
  attivo = si;
  $('#barra-penna').hidden = !si;
  $('#btn-penna').classList.toggle('attivo', si);
  aggiornaModo();
}
export const eAttiva = () => attivo;
export const staDisegnando = () => !!corrente;

function aggiornaModo() {
  for (const f of fogli) {
    f.canvas.classList.toggle('disegno', attivo);
    // con "solo Pencil" il dito scorre; altrimenti anche il dito disegna
    f.canvas.style.touchAction = attivo && !impostazioni().soloPencil ? 'none' : 'pan-x pan-y pinch-zoom';
  }
  const b = $('#btn-solo-pencil');
  if (b) b.classList.toggle('attivo', impostazioni().soloPencil);
}

/** Chiamata dal lettore quando cambia pagina o dimensione. i = numero del foglio */
export async function mostraPagina(i, numero, larghezza, altezza) {
  const f = fogli[i];
  const dpr = window.devicePixelRatio || 1;
  f.W = larghezza; f.H = altezza;
  f.canvas.width = Math.round(f.W * dpr);
  f.canvas.height = Math.round(f.H * dpr);
  f.canvas.style.width = `${f.W}px`;
  f.canvas.style.height = `${f.H}px`;
  f.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (numero !== f.pagina) {
    f.pagina = numero;
    f.annullati = [];
    f.tratti = [];
    const salvati = (await ldb.get('tratti', numero)) || [];
    if (numero !== f.pagina) return;
    f.tratti = salvati;
  }
  ridisegnaTutto(f);
}

function puoDisegnare(e) {
  if (!attivo || strumento.tipo === 'mano') return false;
  if (e.pointerType === 'pen' || e.pointerType === 'mouse') return true;
  return !impostazioni().soloPencil;   // dito
}

function punto(f, e) {
  const r = f.canvas.getBoundingClientRect();
  const pr = e.pressure && e.pointerType === 'pen' ? e.pressure : 0.5;
  return [+((e.clientX - r.left) / r.width).toFixed(5), +((e.clientY - r.top) / r.height).toFixed(5), +pr.toFixed(2)];
}

function giu(f, e) {
  if (!puoDisegnare(e)) return;
  e.preventDefault();
  try { f.canvas.setPointerCapture(e.pointerId); } catch (err) { /* */ }
  ultimo = f;
  if (strumento.tipo === 'gomma') { corrente = { gomma: true }; cancellaVicino(f, punto(f, e)); return; }
  corrente = {
    t: strumento.tipo,
    c: strumento.tipo === 'evid' ? strumento.coloreEvid : strumento.colore,
    w: strumento.tipo === 'evid' ? strumento.spessore * 6 : strumento.spessore,
    p: [punto(f, e)],
  };
}

function muovi(f, e) {
  if (!corrente || ultimo !== f) return;
  e.preventDefault();
  const eventi = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of (eventi.length ? eventi : [e])) {
    if (corrente.gomma) cancellaVicino(f, punto(f, ev));
    else corrente.p.push(punto(f, ev));
  }
  if (!corrente.gomma) { ridisegnaTutto(f); disegnaTratto(f, corrente); }
}

function su(f) {
  if (!corrente || ultimo !== f) return;
  if (!corrente.gomma && corrente.p.length > 0) {
    f.tratti.push(corrente);
    f.annullati = [];
  }
  corrente = null;
  ridisegnaTutto(f);
  salva(f);
}

function cancellaVicino(f, [x, y]) {
  const raggio = 12 / f.W;
  const prima = f.tratti.length;
  f.tratti = f.tratti.filter(t => !t.p.some(([px, py]) => Math.hypot(px - x, (py - y) * f.H / f.W) < raggio));
  if (f.tratti.length !== prima) ridisegnaTutto(f);
}

function disegnaTratto(f, t) {
  const { ctx, W, H } = f;
  const pts = t.p;
  if (!pts.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = t.c;
  ctx.fillStyle = t.c;
  if (t.t === 'evid') { ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'multiply'; ctx.lineCap = 'butt'; }
  const scala = W / 600;   // lo spessore segue lo zoom
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0] * W, pts[0][1] * H, Math.max(0.6, t.w * scala / 2), 0, Math.PI * 2);
    ctx.fill();
  } else if (t.t === 'evid') {
    ctx.lineWidth = t.w * scala;
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
    for (const p of pts) ctx.lineTo(p[0] * W, p[1] * H);
    ctx.stroke();
  } else {
    // penna: spessore che segue la pressione, curve morbide
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      ctx.lineWidth = Math.max(0.6, t.w * scala * (0.5 + b[2]));
      ctx.beginPath();
      const ma = i > 1 ? [(pts[i - 2][0] + a[0]) / 2, (pts[i - 2][1] + a[1]) / 2] : a;
      const mb = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      ctx.moveTo(ma[0] * W, ma[1] * H);
      ctx.quadraticCurveTo(a[0] * W, a[1] * H, mb[0] * W, mb[1] * H);
      ctx.stroke();
      if (i === pts.length - 1) { ctx.beginPath(); ctx.moveTo(mb[0] * W, mb[1] * H); ctx.lineTo(b[0] * W, b[1] * H); ctx.stroke(); }
    }
  }
  ctx.restore();
}

function ridisegnaTutto(f) {
  f.ctx.clearRect(0, 0, f.W, f.H);
  for (const t of f.tratti) disegnaTratto(f, t);
}

function salva(f) {
  const p = f.pagina, copia = f.tratti.slice();
  clearTimeout(f.timer);
  // salvataggio quasi immediato (250 ms) per non perdere niente
  f.timer = setTimeout(() => {
    (copia.length ? ldb.set('tratti', p, copia) : ldb.del('tratti', p)).catch(e => console.error('Salvataggio disegno', e));
  }, 250);
}

// annulla / rifai / svuota lavorano sul foglio usato per ultimo
const foglioDiLavoro = () => (ultimo && fogli.includes(ultimo) && ultimo.pagina != null ? ultimo : fogli[0]);
function annulla() { const f = foglioDiLavoro(); if (f.tratti.length) { f.annullati.push(f.tratti.pop()); ridisegnaTutto(f); salva(f); } }
function rifai() { const f = foglioDiLavoro(); if (f.annullati.length) { f.tratti.push(f.annullati.pop()); ridisegnaTutto(f); salva(f); } }
function svuotaPagina() {
  const f = foglioDiLavoro();
  if (!f.tratti.length) return;
  f.annullati = f.tratti.slice().reverse();   // si può ancora "rifare"
  f.tratti = [];
  ridisegnaTutto(f); salva(f);
}

/** Collega i bottoni della barra penna (la barra è in index.html) */
function costruisciBarra() {
  const barra = $('#barra-penna');
  const sceltaStrumento = tipo => {
    strumento.tipo = tipo;
    $$('[data-strumento]', barra).forEach(b => b.classList.toggle('attivo', b.dataset.strumento === tipo));
    $$('.colori-penna', barra).forEach(g => { g.hidden = g.dataset.per !== (tipo === 'evid' ? 'evid' : 'penna'); });
  };
  barra.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.strumento) sceltaStrumento(b.dataset.strumento);
    if (b.dataset.colore) {
      const evid = strumento.tipo === 'evid';
      if (evid) strumento.coloreEvid = b.dataset.colore; else strumento.colore = b.dataset.colore;
      $$(`.colori-penna[data-per="${evid ? 'evid' : 'penna'}"] button`, barra).forEach(x => x.classList.toggle('attivo', x === b));
    }
    if (b.dataset.spessore) {
      strumento.spessore = Number(b.dataset.spessore);
      $$('[data-spessore]', barra).forEach(x => x.classList.toggle('attivo', x === b));
    }
    if (b.id === 'btn-annulla') annulla();
    if (b.id === 'btn-rifai') rifai();
    if (b.id === 'btn-svuota-pagina') svuotaPagina();
    if (b.id === 'btn-solo-pencil') salvaImpostazione('soloPencil', !impostazioni().soloPencil);
  });
  const gruppo = (per, colori) => {
    const g = document.createElement('div');
    g.className = 'colori-penna';
    g.dataset.per = per;
    colori.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'colore' + (i === 0 ? ' attivo' : '');
      b.dataset.colore = c;
      b.style.background = c;
      b.setAttribute('aria-label', `Colore ${i + 1}`);
      g.append(b);
    });
    return g;
  };
  $('#posto-colori').append(gruppo('penna', COLORI), gruppo('evid', COLORI_EVID));
  sceltaStrumento('penna');
}

/** Il foglio i non mostra più nessuna pagina (es. torno a una pagina sola) */
export function libera(i) {
  const f = fogli[i];
  if (!f) return;
  f.pagina = null; f.tratti = []; f.annullati = [];
  f.ctx.clearRect(0, 0, f.canvas.width, f.canvas.height);
}
