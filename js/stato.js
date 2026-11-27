// =====================================================================
//  stato.js — Lo "stato" condiviso dell'app e un piccolo sistema di eventi.
//  Ogni modulo può ascoltare un evento con on('nome', fn)
//  e avvisare gli altri con emit('nome', dati).
// =====================================================================
import { db, ldb, libroDb, impostaLibroDb } from './db.js';
import { MATEMATICA, impostaLibroCorrente, LIBRO } from './config.js';
import { apriPdf, chiudiPdf } from './pdf.js';

export const stato = {
  idLibro: 'mat',       // libro aperto ora
  libro: null,          // PDFDocumentProxy del libro (null se non importato)
  infoLibro: null,      // { nome, dimensione, data, origine }
  pagina: 1,            // pagina PDF aperta ora
  totalePagine: 0,
};

const ascoltatori = {};
export function on(evento, fn) { (ascoltatori[evento] ||= []).push(fn); }
export function emit(evento, dati) { for (const fn of ascoltatori[evento] || []) { try { fn(dati); } catch (e) { console.error(e); } } }

// ---------------------------------------------------------------------
//  Ultima pagina aperta
//  Salvata SUBITO a ogni cambio pagina in localStorage (sincrono, quindi
//  sopravvive anche a un crash) e anche in IndexedDB come copia.
// ---------------------------------------------------------------------
const chiaveUltima = id => `libroVivo.ultimaPagina.${id}`;
const CHIAVE_ULTIMO_LIBRO = 'libroVivo.ultimoLibro';

export function salvaUltimaPagina(pdf, extra = {}) {
  const dati = { pdf, quando: Date.now(), libro: stato.idLibro, ...extra };
  try {
    localStorage.setItem(chiaveUltima(stato.idLibro), JSON.stringify(dati));
    localStorage.setItem(CHIAVE_ULTIMO_LIBRO, JSON.stringify(dati));
  } catch (e) { /* */ }
  ldb.set('kv', 'ultimaPagina', dati).catch(() => {});
}

/** Ultima pagina letta in QUALSIASI libro (per "Riprendi") */
export function ultimaLettura() {
  try {
    const u = JSON.parse(localStorage.getItem(CHIAVE_ULTIMO_LIBRO) || 'null');
    if (u) return u;
    // versione 1.0: c'era solo il libro di matematica
    const vecchia = JSON.parse(localStorage.getItem('libroVivo.ultimaPagina') || 'null');
    return vecchia ? { ...vecchia, libro: 'mat' } : null;
  } catch (e) { return null; }
}

export async function leggiUltimaPagina(id = stato.idLibro) {
  let a = null, b = null;
  try { a = JSON.parse(localStorage.getItem(chiaveUltima(id)) || 'null'); } catch (e) { /* */ }
  // vecchia versione 1.0 (un solo libro)
  if (!a && id === 'mat') try { a = JSON.parse(localStorage.getItem('libroVivo.ultimaPagina') || 'null'); } catch (e) { /* */ }
  try { b = await db.get('kv', `${id}:ultimaPagina`); } catch (e) { /* */ }
  if (a && b) return a.quando >= b.quando ? a : b;
  return a || b;
}

// ---------------------------------------------------------------------
//  Libro e PDF svolti salvati sul dispositivo
// ---------------------------------------------------------------------

/** Apre il libro salvato. Restituisce true se c'è. */
export async function caricaLibro() {
  const rec = await ldb.get('file', 'libro');
  if (!rec) { stato.libro = null; stato.infoLibro = null; stato.totalePagine = 0; return false; }
  stato.infoLibro = rec.info;
  stato.libro = await apriPdf(`${stato.idLibro}:libro`, rec.blob);
  stato.totalePagine = stato.libro.numPages;
  // libro aggiunto dall'utente: l'ultima pagina stampata dipende dal PDF
  if (!LIBRO.indiciApp && (!LIBRO.ultimaPaginaLibro || LIBRO.ultimaPaginaLibro >= 9999)) LIBRO.ultimaPaginaLibro = stato.totalePagine - LIBRO.offset;
  emit('libro-caricato');
  return true;
}

/** Salva un PDF sul dispositivo. chiave = "libro" oppure "svolti-10" */
export async function salvaPdf(chiave, blob, info) {
  await chiudiPdf(`${stato.idLibro}:${chiave}`);
  await ldb.set('file', chiave, { blob, info: { ...info, dimensione: blob.size, importato: Date.now() } });
  if (chiave === 'libro') await caricaLibro();
  emit('file-cambiati', chiave);
}

export async function eliminaPdf(chiave) {
  await chiudiPdf(`${stato.idLibro}:${chiave}`);
  await ldb.del('file', chiave);
  if (chiave === 'libro') { stato.libro = null; stato.infoLibro = null; }
  emit('file-cambiati', chiave);
}

/** Apre il PDF svolti di un'unità, se importato */
export async function apriSvolti(u) {
  const rec = await ldb.get('file', `svolti-${u}`);
  if (!rec) return null;
  return apriPdf(`${stato.idLibro}:svolti-${u}`, rec.blob);
}

/** Elenco info dei file salvati: { chiave: info } */
export async function elencoFile() {
  const out = {};
  for (const k of await ldb.keys('file')) {
    const r = await ldb.get('file', k);
    out[k] = r.info;
  }
  return out;
}

// ---------------------------------------------------------------------
//  Impostazioni (piccole, in localStorage per averle subito all'avvio)
// ---------------------------------------------------------------------
const CHIAVE_IMP = 'libroVivo.impostazioni';
const PREDEFINITE = {
  tema: 'auto',            // auto | chiaro | scuro
  pagineScure: false,      // inverte i colori delle pagine nel tema scuro
  soloPencil: true,        // solo l'Apple Pencil scrive, il dito sfoglia
  vistaPagina: 'pagina',   // pagina (tutta la pagina nello schermo) | larghezza
  duePagine: 'auto',       // auto (2 pagine con l'iPad in orizzontale) | si | no
  indirizzoServer: '',     // per scaricare il libro da un server di casa
  avvio: 'libreria',       // libreria | ultima  (cosa aprire all'avvio)
};
export function impostazioni() {
  try { return { ...PREDEFINITE, ...JSON.parse(localStorage.getItem(CHIAVE_IMP) || '{}') }; } catch (e) { return { ...PREDEFINITE }; }
}
export function salvaImpostazione(k, v) {
  const imp = impostazioni();
  imp[k] = v;
  try { localStorage.setItem(CHIAVE_IMP, JSON.stringify(imp)); } catch (e) { /* */ }
  emit('impostazioni', imp);
}

// ---------------------------------------------------------------------
//  LIBRERIA: elenco dei libri sul dispositivo
//  kv "libri" = [ definizione, … ]  (il libro di matematica c'è sempre)
// ---------------------------------------------------------------------

export async function elencoLibri() {
  const salvati = (await db.get('kv', 'libri')) || [];
  const mat = salvati.find(l => l.id === 'mat');
  // il libro di matematica prende sempre i dati aggiornati dell'app,
  // tranne i capitoli/offset se l'admin li ha cambiati
  const matematica = { ...MATEMATICA, ...(mat || {}), indiciApp: true, u18: MATEMATICA.u18, indiceAnalitico: MATEMATICA.indiceAnalitico };
  if (mat?.nascosto) matematica.nascosto = true;
  return [matematica, ...salvati.filter(l => l.id !== 'mat')];
}

export async function salvaLibroDef(def) {
  const salvati = (await db.get('kv', 'libri')) || [];
  const i = salvati.findIndex(l => l.id === def.id);
  if (i >= 0) salvati[i] = def; else salvati.push(def);
  await db.set('kv', 'libri', salvati);
  if (def.id === stato.idLibro) impostaLibroCorrente(def.id === 'mat' ? { ...MATEMATICA, ...def, u18: MATEMATICA.u18, indiceAnalitico: MATEMATICA.indiceAnalitico } : def);
  emit('libri-cambiati');
}

export async function eliminaLibro(id) {
  // il libro di matematica è dentro l'app: cancello i suoi file e dati e lo nascondo
  let salvati = (await db.get('kv', 'libri')) || [];
  if (id === 'mat') {
    const mat = salvati.find(l => l.id === 'mat') || { id: 'mat' };
    salvati = [{ ...mat, nascosto: true }, ...salvati.filter(l => l.id !== 'mat')];
  } else salvati = salvati.filter(l => l.id !== id);
  await db.set('kv', 'libri', salvati);
  await db.del('kv', `${id}:copertina`);
  // lo tolgo anche dalle classi
  const classi = (await db.get('kv', 'classi')) || [];
  if (classi.some(c => c.libri.includes(id))) await db.set('kv', 'classi', classi.map(c => ({ ...c, libri: c.libri.filter(x => x !== id) })));
  if (stato.idLibro === id) { stato.libro = null; }
  for (const k of ['libro']) await chiudiPdf(`${id}:${k}`);
  await ldb.svuotaLibro(id);
  try { localStorage.removeItem(chiaveUltima(id)); } catch (e) { /* */ }
  emit('libri-cambiati');
}

/** Apre un libro della libreria: cambia "libro corrente" e carica il PDF */
export async function apriLibro(id) {
  const def = (await elencoLibri()).find(l => l.id === id);
  if (!def) throw new Error('Libro non trovato');
  stato.idLibro = id;
  impostaLibroDb(id);
  impostaLibroCorrente(def);
  stato.libro = null; stato.infoLibro = null; stato.totalePagine = 0; stato.pagina = 1;
  emit('libro-cambiato', def);
  const c = await caricaLibro();
  return c;
}

/** Il libro corrente come definizione */
export const libroCorrente = () => ({ ...LIBRO });
export { libroDb };
