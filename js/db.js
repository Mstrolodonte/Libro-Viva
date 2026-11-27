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

// ---------------------------------------------------------------------
//  ldb = come db, ma per il LIBRO APERTO ORA.
//  Ogni chiave viene salvata con davanti l'id del libro: "mat:546-12".
//  Così ogni libro ha i suoi disegni, esercizi fatti, compiti, ecc.
// ---------------------------------------------------------------------
let idLibro = 'mat';
export function impostaLibroDb(id) { idLibro = id; }
export const libroDb = () => idLibro;

const pk = k => `${idLibro}:${k}`;
const intervallo = () => IDBKeyRange.bound(`${idLibro}:`, `${idLibro}:￿`);

function conIntervallo(store, metodo) {
  return apri().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(store).objectStore(store)[metodo](intervallo());
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
const togli = k => k.slice(idLibro.length + 1);

export const ldb = {
  get: (store, key) => db.get(store, pk(key)),
  set: (store, key, val) => db.set(store, pk(key), val),
  del: (store, key) => db.del(store, pk(key)),
  keys: async (store) => (await conIntervallo(store, 'getAllKeys')).map(togli),
  all: async (store) => {
    const [chiavi, valori] = await Promise.all([conIntervallo(store, 'getAllKeys'), conIntervallo(store, 'getAll')]);
    return chiavi.map((k, i) => [togli(k), valori[i]]);
  },
  setMany: (store, coppie) => db.setMany(store, coppie.map(([k, v]) => [pk(k), v])),
  /** Cancella progressi (esercizi fatti) e appunti (disegni, compiti, segnalibri) dei libri indicati */
  cancellaProgressi: async (ids) => {
    const vecchio = idLibro;
    try {
      for (const id of ids) {
        idLibro = id;
        for (const s of ['tratti', 'stato', 'compiti']) for (const k of await conIntervallo(s, 'getAllKeys')) await db.del(s, k);
        for (const k of ['segnalibri', 'recenti', 'ultimaPagina']) await db.del('kv', pk(k));
      }
    } finally { idLibro = vecchio; }
  },
  /** Cancella tutti i dati di un libro (quando lo togli dalla libreria) */
  svuotaLibro: async (id) => {
    const vecchio = idLibro;
    idLibro = id;
    try {
      for (const s of STORES) for (const k of await conIntervallo(s, 'getAllKeys')) await db.del(s, k);
    } finally { idLibro = vecchio; }
  },
};

/**
 * Migrazione dalla versione 1.0 (un solo libro): sposta i vecchi dati
 * sotto il libro di matematica ("mat:"). Si fa una volta sola.
 */
const CHIAVI_GLOBALI = new Set(['adminHash', 'libri', 'versioneDati', 'ultimoLibro', 'classi']);
export async function migraDati() {
  if ((await db.get('kv', 'versioneDati')) >= 2) return;
  for (const s of STORES) {
    const coppie = await db.all(s);
    for (const [k, v] of coppie) {
      if (typeof k === 'string' && (k.includes(':') || (s === 'kv' && CHIAVI_GLOBALI.has(k)))) continue;
      await db.set(s, `mat:${k}`, v);
      await db.del(s, k);
    }
  }
  await db.set('kv', 'versioneDati', 2);
}
