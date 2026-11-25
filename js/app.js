// =====================================================================
//  app.js — Punto di partenza: collega tutte le parti dell'app.
//
//  Flusso: LIBRERIA (scegli il libro) → SEZIONI del libro → Leggi,
//  Esercizi, Compiti, Progressi, Altro.
// =====================================================================
import { $, $$, el, toast } from './ui.js';
import { chiediSpazioPersistente, migraDati } from './db.js';
import { stato, on, emit, leggiUltimaPagina, impostazioni, ultimaLettura } from './stato.js';
import { pdfToLibro, libroToPdf, LIBRO } from './config.js';
import * as lettore from './lettore.js';
import * as penna from './penna.js';
import { caricaIndici, apriEsercizio, eserciziDellaPagina } from './esercizi.js';
import { initEsercizi, initCompiti, initProgressi, initCapitoli, initRicercaTesto } from './viste.js';
import { initAltro, applicaTema, importaDalDisco, guidaDisco, apriImpostazioniApp } from './altro.js';
import { disegnaLibreria, disegnaHomeLibro, entraNelLibro, creaCopertina } from './libreria.js';
import { db } from './db.js';

const CHIAVE_VISTA = 'libroVivo.vista';
const VISTE_LIBRO = ['home', 'libro', 'esercizi', 'compiti', 'progressi', 'altro'];

/** Mostra una sezione: libreria | home | libro | esercizi | compiti | progressi | altro */
function mostraVista(nome) {
  $$('.vista').forEach(v => v.classList.toggle('attiva', v.id === `vista-${nome}`));
  $$('#barra-schede button').forEach(b => b.classList.toggle('attivo', b.dataset.vista === nome));
  document.body.dataset.vista = nome;
  try { localStorage.setItem(CHIAVE_VISTA, nome); } catch (e) { /* */ }
  if (nome === 'libreria') disegnaLibreria();
  if (nome === 'home') disegnaHomeLibro();
  if (nome === 'libro') { benvenuto(!stato.libro); lettore.ridisegna(); }
  emit('vista-mostrata', nome);
}

/** Schermata "manca il PDF" quando il libro non è ancora sull'iPad */
function benvenuto(mostra) {
  $('#benvenuto').hidden = !mostra;
  $('#lettore-scroll').hidden = mostra;
}

async function importa() {
  await importaDalDisco();
  if (stato.libro) {
    db.get('kv', `${stato.idLibro}:copertina`).then(c => { if (!c) creaCopertina().catch(() => {}); });
  }
  const vista = document.body.dataset.vista;
  if (vista === 'home') disegnaHomeLibro();
  if (vista === 'libro') benvenuto(!stato.libro);
}

async function avvia() {
  applicaTema();

  // service worker: rende l'app disponibile offline (solo su https o localhost)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker', e));
  }
  chiediSpazioPersistente();
  await migraDati().catch(e => console.error('Migrazione', e));   // dati della versione 1.0

  lettore.init();
  initEsercizi();
  initCompiti();
  initProgressi();
  initCapitoli();
  initRicercaTesto();
  initAltro();
  collegaTocchiSullaPagina();

  $$('#barra-schede button').forEach(b => { b.onclick = () => mostraVista(b.dataset.vista); });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-vai]');
    if (b) mostraVista(b.dataset.vai);
  });
  $('#btn-penna').onclick = () => penna.attiva(!penna.eAttiva());
  $('#btn-importa-benvenuto').onclick = importa;
  $('#btn-guida-benvenuto').onclick = guidaDisco;
  $('#btn-impostazioni-app').onclick = apriImpostazioniApp;

  on('mostra-vista', mostraVista);
  on('importa-libro', importa);
  on('vai-pagina', async ({ pdf, evidenzia, scrollTop, zoom }) => {
    mostraVista('libro');
    if (stato.libro) await lettore.vaiA(pdf, { evidenzia, scrollTop, zoom });
  });
  on('libro-caricato', () => benvenuto(false));

  // All'avvio: la libreria (oppure l'ultimo libro, se scelto in Altro)
  const ultima = ultimaLettura();
  let aperto = null;
  try { aperto = localStorage.getItem('libroVivo.libroAperto'); } catch (e) { /* */ }
  if (impostazioni().avvio === 'ultima' && (ultima?.libro || aperto)) {
    await entraNelLibro(ultima?.libro || aperto, { leggi: true });
  } else {
    mostraVista('libreria');
  }
  document.body.classList.add('pronta');
}

/**
 * Tocco (col dito o il mouse) su un esercizio della pagina:
 * compare un bottoncino "📝 es. 12" che apre la scheda.
 */
function collegaTocchiSullaPagina() {
  const wrap = $('#pagina-wrap');
  const chip = el('button', { class: 'chip-esercizio', hidden: true });
  wrap.append(chip);
  let timer;
  wrap.addEventListener('click', e => {
    if (penna.eAttiva() || e.target === chip) return;
    const p = pdfToLibro(stato.pagina);
    if (!p) return;
    const r = wrap.getBoundingClientRect();
    const s = Number(wrap.dataset.scala);
    const x = (e.clientX - r.left) / s, y = (e.clientY - r.top) / s;
    const voce = eserciziDellaPagina(p).find(v => x >= v.b[0] && x <= v.b[2] && y >= v.b[1] && y <= v.b[3]);
    if (!voce) { chip.hidden = true; return; }
    chip.textContent = `📝 Apri es. ${voce.es}`;
    chip.style.left = `${Math.min(e.clientX - r.left, r.width - 140)}px`;
    chip.style.top = `${e.clientY - r.top - 44}px`;
    chip.hidden = false;
    chip.onclick = () => { chip.hidden = true; apriEsercizio(voce.p, voce.es); };
    clearTimeout(timer);
    timer = setTimeout(() => { chip.hidden = true; }, 4000);
  });
}

avvia();
