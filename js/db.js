// =====================================================================
//  db.js — Salvataggio sul dispositivo (IndexedDB).
//  Tutto resta sull'iPad: libro, PDF svolti, disegni, progressi…
//
//  Archivi ("store"):
//   file      -> PDF importati (Blob) + info. Chiavi: "libro", "svolti-10", …
//   tratti    -> disegni della penna, una voce per pagina PDF
//   stato     -> stato esercizi: fatto / difficile / preferito. Chiave "546-12"
//   soluzioni -> soluzioni in formato JSON caricate dall'admin. Chiave "546-12"
//   compiti   -> liste di compiti
//   kv        -> impostazioni varie (chiave/valore)
//   testo     -> testo delle pagine per la ricerca
// =====================================================================

const NOME_DB = 'libro-vivo';
const VERSIONE_DB = 1;
const STORES = ['file', 'tratti', 'stato', 'soluzioni', 'compiti', 'kv', 'testo'];

let dbPromise = null;

function apri() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(NOME_DB, VERSIONE_DB);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return apri().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let risultato;
    Promise.resolve(fn(s)).then(r => { risultato = r; });
    t.oncomplete = () => resolve(risultato instanceof IDBRequest ? risultato.result : risultato);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  set: (store, key, val) => tx(store, 'readwrite', s => { s.put(val, key); }),
  del: (store, key) => tx(store, 'readwrite', s => { s.delete(key); }),
  clear: (store) => tx(store, 'readwrite', s => { s.clear(); }),
  keys: (store) => tx(store, 'readonly', s => s.getAllKeys()),
  /** Tutte le voci come array di [chiave, valore] */
  all: (store) => apri().then(d => new Promise((resolve, reject) => {
    const out = [];
    const req = d.transaction(store).objectStore(store).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) { out.push([c.key, c.value]); c.continue(); } else resolve(out);
    };
    req.onerror = () => reject(req.error);
  })),
  /** Scrive tante voci insieme */
  setMany: (store, coppie) => tx(store, 'readwrite', s => { for (const [k, v] of coppie) s.put(v, k); }),
};

/** Chiede al browser di non cancellare mai i nostri dati (iPad: app sulla Home) */
export async function chiediSpazioPersistente() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) { /* non importa */ }
  return false;
}

export async function spazioUsato() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch (e) { /* */ }
  return null;
}
