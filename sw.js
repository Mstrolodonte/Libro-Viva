// =====================================================================
//  sw.js — "Service worker": fa funzionare l'app SENZA internet.
//
//  REGOLA IMPORTANTE: l'app NON si aggiorna da sola.
//  - Questo file non cambia mai (se cambiasse, Safari lo aggiornerebbe
//    da solo). Per questo la versione è scritta in version.json.
//  - Tutti i file dell'app sono salvati nella cache "libro-vivo-app".
//  - Si aggiornano SOLO quando l'utente preme "Aggiorna ora" (messaggio
//    { tipo: 'aggiorna' }).
//  ⚠️ Modifica questo file solo se è davvero necessario.
// =====================================================================
const CACHE = 'libro-vivo-app';

/** Scarica tutti i file elencati in version.json */
async function scaricaTutto() {
  const r = await fetch('version.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('version.json ' + r.status);
  const versione = await r.clone().json();
  const risposte = [['version.json', r]];
  for (const f of ['./', ...versione.file]) {
    const x = await fetch(f, { cache: 'reload' });
    if (!x.ok) throw new Error(f + ' ' + x.status);
    risposte.push([f, x]);
  }
  return risposte;
}

async function salvaInCache(risposte) {
  const cache = await caches.open(CACHE);
  const tenere = new Set();
  for (const [f, r] of risposte) {
    const url = new URL(f, self.registration.scope).href;
    tenere.add(url);
    await cache.put(url, r);
  }
  // togli i file che non fanno più parte dell'app
  for (const req of await cache.keys()) if (!tenere.has(req.url)) await cache.delete(req);
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // se l'app è già installata non scarico niente
    if (!(await cache.match(new URL('version.json', self.registration.scope).href))) {
      await salvaInCache(await scaricaTutto());
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;   // altri siti: normale
  if (url.searchParams.has('rete')) return;                             // controllo versione: sempre da internet
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const chiave = req.mode === 'navigate' ? new URL('./', self.registration.scope).href : url.origin + url.pathname;
    const trovato = await cache.match(chiave);
    if (trovato) return trovato;
    // non in cache (es. prima installazione): prendo da internet e salvo
    const r = await fetch(req);
    if (r.ok) cache.put(chiave, r.clone());
    return r;
  })());
});

self.addEventListener('message', e => {
  const porta = e.ports[0];
  if (e.data?.tipo === 'aggiorna') {
    scaricaTutto()
      .then(salvaInCache)
      .then(() => porta?.postMessage({ ok: true }))
      .catch(err => porta?.postMessage({ ok: false, errore: String(err.message || err) }));
  }
});
