// =====================================================================
//  importa.js — Portare libro e soluzioni sull'iPad.
//
//  Modo 1 (consigliato): "Importa dal disco"
//    L'app File dell'iPad si collega al disco del modem (smb://…).
//    Scegli i file e l'app li copia sul dispositivo UNA volta sola.
//    L'app riconosce i file dal nome/contenuto:
//      - PDF grande / con "Libro" nel nome      -> libro
//      - Uxx_…_SVOLTI.pdf                       -> svolgimenti PDF dell'unità xx
//      - Uxx_….json (lista con pagina, es, …)   -> soluzioni a passi
//      - backup_libro_vivo_….json               -> backup
//      - indice_esercizi.json / indice_soluzioni.json -> indici (admin)
//
//  Modo 2: "Scarica dal server"
//    Serve un piccolo server web a casa (tools/server_casa.py) che
//    pubblica il file elenco.json. L'app scarica solo quando lo chiedi.
// =====================================================================
import { el, toast, mb, apriScheda } from './ui.js';
import { db } from './db.js';
import { salvaPdf, elencoFile, impostazioni, emit } from './stato.js';
import { unitaDaNomeFile, LIBRO } from './config.js';
import { caricaIndici } from './esercizi.js';
import { ripristinaBackup } from './backup.js';

/** Importa una lista di File scelti dall'utente. Restituisce un riepilogo. */
export async function importaFile(files, { admin = false } = {}) {
  const fatti = [], saltati = [];
  for (const f of files) {
    try {
      const nome = f.name;
      if (/\.pdf$/i.test(nome)) {
        if (/NON_SVOLTI/i.test(nome)) { saltati.push(`${nome} (gli esercizi non svolti non servono all'app)`); continue; }
        if (/SVOLTI/i.test(nome)) {
          const u = unitaDaNomeFile(nome);
          if (!u) { saltati.push(`${nome} (non capisco l'unità)`); continue; }
          await salvaPdf(`svolti-${u}`, f, { nome, origine: 'disco', modificato: f.lastModified });
          fatti.push(`Svolti unità ${u} (PDF)`);
          continue;
        }
        if (f.size > 50 * 1024 * 1024 || /libro/i.test(nome) || nome === LIBRO.nomeFile) {
          await salvaPdf('libro', f, { nome, origine: 'disco', modificato: f.lastModified });
          fatti.push(`Libro (${mb(f.size)})`);
          continue;
        }
        saltati.push(`${nome} (PDF non riconosciuto)`);
      } else if (/\.json$/i.test(nome)) {
        const dati = JSON.parse(await f.text());
        fatti.push(await importaJson(dati, nome, { admin }));
      } else {
        saltati.push(`${nome} (tipo di file non usato)`);
      }
    } catch (e) {
      console.error(e);
      saltati.push(`${f.name} (errore: ${e.message})`);
    }
  }
  return { fatti, saltati };
}

/** Capisce che tipo di JSON è e lo salva */
export async function importaJson(dati, nome = '', { admin = false } = {}) {
  if (Array.isArray(dati) && dati.length && 'pagina' in dati[0] && 'es' in dati[0]) {
    const n = await salvaSoluzioniJson(dati);
    const u = unitaDaNomeFile(nome);
    if (u) await db.set('kv', `soluzioniJson-${u}`, { nome, numero: n, importato: Date.now() });
    return `Soluzioni a passi${u ? ` unità ${u}` : ''}: ${n}`;
  }
  if (dati && dati.tipo === 'backup-libro-vivo') {
    await ripristinaBackup(dati);
    return 'Backup ripristinato';
  }
  if (dati && Array.isArray(dati.esercizi) && 'offset' in dati) {
    if (!admin) throw new Error('gli indici si caricano dalla sezione Admin');
    await db.set('kv', 'indiceEsercizi', dati);
    await caricaIndici();
    return `Indice esercizi (${dati.esercizi.length})`;
  }
  if (dati && dati.unita && !Array.isArray(dati.unita)) {
    if (!admin) throw new Error('gli indici si caricano dalla sezione Admin');
    await db.set('kv', 'indiceSoluzioni', dati);
    await caricaIndici();
    return 'Indice soluzioni';
  }
  throw new Error('JSON non riconosciuto');
}

/** Salva le soluzioni JSON (formato del progetto) una per esercizio */
export async function salvaSoluzioniJson(lista) {
  const coppie = [];
  for (const s of lista) {
    if (s == null || s.pagina == null || s.es == null) continue;
    const { immagine, ...resto } = s;    // l'immagine non serve: ritagliamo dal libro
    coppie.push([`${s.pagina}-${s.es}`, resto]);
  }
  await db.setMany('soluzioni', coppie);
  emit('soluzioni-cambiate');
  return coppie.length;
}

/** Scheda che mostra cosa è stato importato */
export function mostraRiepilogo({ fatti, saltati }) {
  if (!fatti.length && !saltati.length) return;
  const s = apriScheda('Importazione');
  if (fatti.length) s.corpo.append(el('h3', {}, '✅ Importati'), el('ul', {}, ...fatti.map(x => el('li', {}, x))));
  if (saltati.length) s.corpo.append(el('h3', {}, '⚠️ Non importati'), el('ul', {}, ...saltati.map(x => el('li', {}, x))));
  s.corpo.append(el('p', { class: 'nota' }, 'I file ora sono salvati su questo dispositivo. Non serve importarli di nuovo.'));
}

// ---------------------------------------------------------------------
//  Download dal server di casa
// ---------------------------------------------------------------------

function base() {
  let u = impostazioni().indirizzoServer.trim();
  if (!u) throw new Error('Scrivi prima l\'indirizzo del server in Altro → Server di casa');
  if (!/^https?:\/\//.test(u)) u = 'http://' + u;
  return u.replace(/\/+$/, '') + '/';
}

/** Legge l'elenco dei file dal server (elenco.json) */
export async function leggiElencoServer() {
  const url = base() + 'elenco.json';
  let r;
  try {
    r = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    const https = location.protocol === 'https:' && url.startsWith('http:');
    throw new Error(https
      ? 'Il server non risponde. Attenzione: l\'app è su https e il server su http, Safari blocca il collegamento. Usa "Importa dal disco" oppure un server https.'
      : 'Il server non risponde. Controlla che sia acceso e di essere sul Wi‑Fi di casa.');
  }
  if (!r.ok) throw new Error(`Il server ha risposto ${r.status}`);
  return r.json();
}

/** Confronta i file del server con quelli già salvati */
export async function controllaAggiornamenti() {
  const elenco = await leggiElencoServer();
  const salvati = await elencoFile();
  const json = new Map(await db.all('kv'));
  const daScaricare = [];
  for (const f of elenco.file) {
    const ch = chiaveDaNome(f.nome);
    if (!ch) continue;
    const info = ch.startsWith('json-') ? json.get(`soluzioniJson-${ch.slice(5)}`) : salvati[ch];
    const nuovo = !info || info.modificatoServer !== f.modificato || (info.dimensione && info.dimensione !== f.dimensione && !ch.startsWith('json-'));
    if (nuovo) daScaricare.push({ ...f, chiave: ch });
  }
  return daScaricare;
}

function chiaveDaNome(nome) {
  if (/NON_SVOLTI/i.test(nome)) return null;
  if (/SVOLTI.*\.pdf$/i.test(nome)) { const u = unitaDaNomeFile(nome); return u ? `svolti-${u}` : null; }
  if (/^U\d+.*\.json$/i.test(nome)) { const u = unitaDaNomeFile(nome); return u ? `json-${u}` : null; }
  if (/\.pdf$/i.test(nome) && (nome === LIBRO.nomeFile || /libro/i.test(nome))) return 'libro';
  return null;
}

/** Scarica i file indicati, mostrando l'avanzamento in `aggiorna(testo)` */
export async function scaricaDalServer(lista, aggiorna = () => {}) {
  const b = base();
  for (const [i, f] of lista.entries()) {
    const etichetta = `(${i + 1}/${lista.length}) ${f.nome}`;
    const r = await fetch(b + f.percorso.split('/').map(encodeURIComponent).join('/'), { cache: 'no-store' });
    if (!r.ok) throw new Error(`${f.nome}: errore ${r.status}`);
    const tot = Number(r.headers.get('content-length')) || f.dimensione || 0;
    const reader = r.body.getReader();
    const pezzi = [];
    let letti = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pezzi.push(value); letti += value.length;
      if (tot) aggiorna(`${etichetta}: ${Math.round(100 * letti / tot)}%`);
    }
    if (f.chiave.startsWith('json-')) {
      const testo = await new Blob(pezzi).text();
      await importaJson(JSON.parse(testo), f.nome);
      const u = f.chiave.slice(5);
      const info = (await db.get('kv', `soluzioniJson-${u}`)) || {};
      await db.set('kv', `soluzioniJson-${u}`, { ...info, modificatoServer: f.modificato });
    } else {
      const blob = new Blob(pezzi, { type: 'application/pdf' });
      await salvaPdf(f.chiave, blob, { nome: f.nome, origine: 'server', modificatoServer: f.modificato });
    }
  }
  aggiorna('Fatto!');
  toast('Download completato');
}
