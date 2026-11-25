// =====================================================================
//  backup.js — Salva in un file tutto il TUO lavoro:
//  disegni, esercizi fatti/difficili, compiti, segnalibri, impostazioni.
//  (Il libro e i PDF non sono nel backup: si reimportano dal disco.)
// =====================================================================
import { db } from './db.js';
import { scaricaFile } from './ui.js';
import { emit } from './stato.js';

const STORE_NEL_BACKUP = ['tratti', 'stato', 'compiti', 'kv'];

export async function creaBackup({ conSoluzioni = false } = {}) {
  const dati = { tipo: 'backup-libro-vivo', versione: 1, creato: new Date().toISOString(), store: {} };
  const stores = conSoluzioni ? [...STORE_NEL_BACKUP, 'soluzioni'] : STORE_NEL_BACKUP;
  for (const s of stores) dati.store[s] = await db.all(s);
  // gli indici dell'admin sono grandi: li tengo solo se richiesti
  if (!conSoluzioni) dati.store.kv = dati.store.kv.filter(([k]) => !/(^|:)indice/.test(k));
  try { dati.localStorage = { ...localStorage }; } catch (e) { /* */ }
  return dati;
}

export async function esportaBackup(opzioni) {
  const dati = await creaBackup(opzioni);
  const oggi = new Date().toISOString().slice(0, 10);
  scaricaFile(`backup_libro_vivo_${oggi}.json`, new Blob([JSON.stringify(dati)], { type: 'application/json' }));
}

export async function ripristinaBackup(dati) {
  if (dati?.tipo !== 'backup-libro-vivo') throw new Error('Non è un backup di Libro Vivo');
  for (const [store, coppie] of Object.entries(dati.store || {})) {
    if (![...STORE_NEL_BACKUP, 'soluzioni'].includes(store)) continue;
    await db.setMany(store, coppie);
  }
  if (dati.localStorage) {
    for (const [k, v] of Object.entries(dati.localStorage)) {
      if (k.startsWith('libroVivo.')) try { localStorage.setItem(k, v); } catch (e) { /* */ }
    }
  }
  emit('stato-esercizi', {});
}
