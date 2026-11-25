// =====================================================================
//  app.js — Punto di partenza: collega tutte le parti dell'app.
// =====================================================================
import { $, $$, el, toast } from './ui.js';
import { db, chiediSpazioPersistente } from './db.js';
import { stato, on, emit, caricaLibro, leggiUltimaPagina } from './stato.js';
import { impostaUnita, libroToPdf, pdfToLibro } from './config.js';
import * as lettore from './lettore.js';
import * as penna from './penna.js';
import { caricaIndici, apriEsercizio, eserciziDellaPagina } from './esercizi.js';
import { initEsercizi, initCompiti, initProgressi, initCapitoli, initRicercaTesto } from './viste.js';
import { initAltro, applicaTema, importaDalDisco, guidaDisco } from './altro.js';

const CHIAVE_VISTA = 'libroVivo.vista';

/** Mostra una sezione: libro | esercizi | compiti | progressi | altro */
function mostraVista(nome) {
  $$('.vista').forEach(v => v.classList.toggle('attiva', v.id === `vista-${nome}`));
  $$('#barra-schede button').forEach(b => b.classList.toggle('attivo', b.dataset.vista === nome));
  document.body.dataset.vista = nome;
  try { localStorage.setItem(CHIAVE_VISTA, nome); } catch (e) { /* */ }
  emit('mostra-vista', nome);
  if (nome === 'libro') lettore.ridisegna();
}

/** Schermata di benvenuto quando il libro non è ancora sull'iPad */
function benvenuto(mostra) {
  $('#benvenuto').hidden = !mostra;
  $('#lettore-scroll').hidden = mostra;
}

async function avvia() {
  applicaTema();

  // service worker: rende l'app disponibile offline (solo su https o localhost)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker', e));
  }
  chiediSpazioPersistente();

  // capitoli rilevati dall'admin (se ci sono)
  const cap = await db.get('kv', 'capitoli').catch(() => null);
  if (cap) impostaUnita(cap);

  lettore.init();
  initEsercizi();
  initCompiti();
  initProgressi();
  initCapitoli();
  initRicercaTesto();
  initAltro();
  collegaTocchiSullaPagina();

  $$('#barra-schede button').forEach(b => { b.onclick = () => mostraVista(b.dataset.vista); });
  $('#btn-penna').onclick = () => penna.attiva(!penna.eAttiva());
  $('#btn-importa-benvenuto').onclick = () => importaDalDisco();
  $('#btn-guida-benvenuto').onclick = guidaDisco;

  on('vai-pagina', ({ pdf, evidenzia }) => { mostraVista('libro'); lettore.vaiA(pdf, { evidenzia }); });
  on('libro-caricato', async () => {
    benvenuto(false);
    const ultima = await leggiUltimaPagina();
    await lettore.vaiA(ultima?.pdf || libroToPdf(2), { scrollTop: ultima?.scrollTop, zoom: ultima?.zoom });
  });

  caricaIndici().catch(e => console.error('Indici', e));

  // ultima sezione aperta
  let vista = 'libro';
  try { vista = localStorage.getItem(CHIAVE_VISTA) || 'libro'; } catch (e) { /* */ }
  mostraVista(vista);

  let c = false;
  try { c = await caricaLibro(); } catch (e) { console.error(e); toast('Non riesco ad aprire il libro salvato: reimportalo.'); }
  if (!c) benvenuto(true);

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
