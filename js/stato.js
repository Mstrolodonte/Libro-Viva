// =====================================================================
//  stato.js — Lo "stato" condiviso dell'app e un piccolo sistema di eventi.
//  Ogni modulo può ascoltare un evento con on('nome', fn)
//  e avvisare gli altri con emit('nome', dati).
// =====================================================================
import { db } from './db.js';
import { apriPdf, chiudiPdf } from './pdf.js';

export const stato = {
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
const CHIAVE_ULTIMA = 'libroVivo.ultimaPagina';

export function salvaUltimaPagina(pdf, extra = {}) {
  const dati = { pdf, quando: Date.now(), ...extra };
  try { localStorage.setItem(CHIAVE_ULTIMA, JSON.stringify(dati)); } catch (e) { /* */ }
  db.set('kv', 'ultimaPagina', dati).catch(() => {});
}

export async function leggiUltimaPagina() {
  let a = null, b = null;
  try { a = JSON.parse(localStorage.getItem(CHIAVE_ULTIMA) || 'null'); } catch (e) { /* */ }
  try { b = await db.get('kv', 'ultimaPagina'); } catch (e) { /* */ }
  if (a && b) return a.quando >= b.quando ? a : b;
  return a || b;
}

// ---------------------------------------------------------------------
//  Libro e PDF svolti salvati sul dispositivo
// ---------------------------------------------------------------------

/** Apre il libro salvato. Restituisce true se c'è. */
export async function caricaLibro() {
  const rec = await db.get('file', 'libro');
  if (!rec) { stato.libro = null; stato.infoLibro = null; return false; }
  stato.infoLibro = rec.info;
  stato.libro = await apriPdf('libro', rec.blob);
  stato.totalePagine = stato.libro.numPages;
  emit('libro-caricato');
  return true;
}

/** Salva un PDF sul dispositivo. chiave = "libro" oppure "svolti-10" */
export async function salvaPdf(chiave, blob, info) {
  await chiudiPdf(chiave);
  await db.set('file', chiave, { blob, info: { ...info, dimensione: blob.size, importato: Date.now() } });
  if (chiave === 'libro') await caricaLibro();
  emit('file-cambiati', chiave);
}

export async function eliminaPdf(chiave) {
  await chiudiPdf(chiave);
  await db.del('file', chiave);
  if (chiave === 'libro') { stato.libro = null; stato.infoLibro = null; }
  emit('file-cambiati', chiave);
}

/** Apre il PDF svolti di un'unità, se importato */
export async function apriSvolti(u) {
  const rec = await db.get('file', `svolti-${u}`);
  if (!rec) return null;
  return apriPdf(`svolti-${u}`, rec.blob);
}

/** Elenco info dei file salvati: { chiave: info } */
export async function elencoFile() {
  const out = {};
  for (const k of await db.keys('file')) {
    const r = await db.get('file', k);
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
  adatta: 'larghezza',     // larghezza | pagina
  indirizzoServer: '',     // per scaricare il libro da un server di casa
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
