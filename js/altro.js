// =====================================================================
//  altro.js — Sezione "Altro": libro, soluzioni, server di casa,
//  aspetto, backup, aggiornamento dell'app, admin.
// =====================================================================
import { $, el, toast, apriScheda, conferma, scegliFile, mb } from './ui.js';
import { db, ldb, spazioUsato, chiediSpazioPersistente } from './db.js';
import { stato, on, elencoFile, eliminaPdf, impostazioni, salvaImpostazione } from './stato.js';
import { UNITA, LIBRO } from './config.js';
import { apriImpostazioniLibro } from './libreria.js';
import { importaFile, mostraRiepilogo, controllaAggiornamenti, scaricaDalServer } from './importa.js';
import { esportaBackup } from './backup.js';
import { apriAdmin } from './admin.js';

export function initAltro() {
  on('vista-mostrata', v => { if (v === 'altro') disegna(); });
  on('file-cambiati', () => { if ($('#vista-altro').classList.contains('attiva')) disegna(); });
}

/** Bottone "Importa dal disco" riusabile (anche nella schermata di benvenuto) */
export async function importaDalDisco(opzioni) {
  const files = await scegliFile({ accept: '.pdf,.json,.zip,application/pdf,application/json,application/zip', multiplo: true });
  if (!files.length) return;
  toast(`Copio ${files.length} file sul dispositivo…`, 10000);
  const r = await importaFile(files, opzioni);
  toast('Fatto');
  mostraRiepilogo(r);
}

export function guidaDisco() {
  const s = apriScheda('Collegare il disco del modem', { larga: true });
  s.corpo.innerHTML = `
    <p>Il disco collegato al modem è una <b>cartella condivisa</b> (SMB). L'app File dell'iPad sa aprirla.</p>
    <ol class="guida">
      <li>Apri l'app <b>File</b> sull'iPad.</li>
      <li>Tocca <b>⋯</b> (in alto) → <b>Connetti al server</b>.</li>
      <li>Scrivi <code>smb://</code> e l'indirizzo del modem, per esempio <code>smb://192.168.1.1</code>.
        <br><small>L'indirizzo è scritto sotto il modem o nella sua pagina di gestione.</small></li>
      <li>Entra come <b>Ospite</b> oppure con utente e password del disco (quelli impostati nel modem).</li>
      <li>Torna in Libro Vivo → <b>Altro</b> → <b>📂 Importa dal disco</b>.</li>
      <li>Nella finestra scegli il disco del modem e seleziona:
        <ul><li><code>Macematica_Libro.pdf</code> (il libro)</li>
        <li>i file <code>Uxx_….json</code> (soluzioni a passi)</li>
        <li>i file <code>Uxx_…_SVOLTI.pdf</code> (svolgimenti con le figure)</li></ul>
        Puoi selezionarne tanti insieme con <b>Seleziona</b>.</li>
    </ol>
    <p>L'app copia i file sull'iPad <b>una volta sola</b>. Dopo funziona anche senza Wi‑Fi.</p>
    <p class="nota">Il libro è grande (~130 MB): la prima copia può richiedere qualche minuto.</p>`;
}

async function disegna(box = $('#altro-contenuto'), { soloApp = false } = {}) {
  const imp = impostazioni();
  const files = await elencoFile();
  const kv = new Map(await ldb.all('kv'));
  const versione = await versioneInstallata();
  const spazio = await spazioUsato();
  const persistente = navigator.storage?.persisted ? await navigator.storage.persisted() : false;

  // --- Libro ---
  const libro = files.libro;
  const cardLibro = el('section', { class: 'card' },
    el('h3', {}, `📘 ${LIBRO.materia || 'Libro'}: ${LIBRO.titolo}`),
    libro ? el('p', {}, `✅ ${libro.nome} · ${mb(libro.dimensione)} · copiato il ${new Date(libro.importato).toLocaleDateString('it-IT')}`)
      : el('p', { class: 'avviso' }, 'Il libro non è ancora sul dispositivo.'),
    el('div', { class: 'riga-bottoni sinistra' },
      el('button', { class: 'btn primario', onclick: () => importaDalDisco() }, '📂 Importa dal disco'),
      el('button', { class: 'btn', onclick: () => apriImpostazioniLibro() }, '⚙️ Impostazioni libro'),
      el('button', { class: 'btn', onclick: guidaDisco }, '❓ Come collego il disco del modem')));

  // --- Soluzioni per unità ---
  const righe = UNITA.map(u => {
    const j = kv.get(`soluzioniJson-${u.n}`);
    const p = files[`svolti-${u.n}`];
    return el('tr', {},
      el('td', {}, `U${u.n}`), el('td', {}, u.titolo),
      el('td', {}, j ? `✅ ${j.numero}` : '—'),
      el('td', {}, p ? `✅ ${mb(p.dimensione)}` : '—'),
      el('td', {}, p ? el('button', { class: 'btn-icona', 'aria-label': 'Togli PDF', onclick: async () => {
        if (await conferma(`Togliere dal dispositivo il PDF svolti dell'unità ${u.n}?`, { si: 'Togli', pericolo: true })) eliminaPdf(`svolti-${u.n}`);
      } }, '🗑') : ''));
  });
  const cardSol = el('section', { class: 'card' },
    el('h3', {}, '💡 Soluzioni'),
    el('p', { class: 'nota' }, 'Soluzioni a passi = file .json (leggeri). PDF svolti = file _SVOLTI.pdf (servono per le figure). Si importano con "Importa dal disco".'),
    el('div', { class: 'tabella-scroll' }, el('table', { class: 'tabella' },
      el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', {}, 'Unità'), el('th', {}, 'A passi'), el('th', {}, 'PDF'), el('th', {}, ''))),
      el('tbody', {}, ...righe))));

  // --- Server di casa ---
  const campoServer = el('input', { class: 'campo', value: imp.indirizzoServer, placeholder: 'es. http://192.168.1.50:8080', inputmode: 'url', autocapitalize: 'off' });
  campoServer.onchange = () => salvaImpostazione('indirizzoServer', campoServer.value.trim());
  const esitoServer = el('div', { class: 'nota' });
  const cardServer = el('section', { class: 'card' },
    el('h3', {}, '🏠 Server di casa (facoltativo)'),
    el('p', { class: 'nota' }, 'Solo se hai acceso un piccolo server (tools/server_casa.py su un PC o Raspberry). L\'app NON controlla da sola: controlla solo quando premi il bottone.'),
    el('label', { class: 'etichetta' }, 'Indirizzo', campoServer),
    el('div', { class: 'riga-bottoni sinistra' },
      el('button', { class: 'btn', onclick: async () => {
        salvaImpostazione('indirizzoServer', campoServer.value.trim());
        esitoServer.textContent = 'Controllo…';
        try {
          const lista = await controllaAggiornamenti();
          if (!lista.length) { esitoServer.textContent = '✅ Hai già tutto aggiornato.'; return; }
          const peso = lista.reduce((a, f) => a + (f.dimensione || 0), 0);
          esitoServer.replaceChildren(
            el('p', {}, `Da scaricare: ${lista.length} file (${mb(peso)})`),
            el('ul', {}, ...lista.map(f => el('li', {}, f.nome))),
            el('button', { class: 'btn primario', onclick: async e => {
              e.target.disabled = true;
              const avanz = el('p');
              esitoServer.append(avanz);
              try { await scaricaDalServer(lista, t => { avanz.textContent = t; }); } catch (err) { avanz.textContent = '❌ ' + err.message; }
            } }, '⬇️ Scarica ora'));
        } catch (e) { esitoServer.textContent = '❌ ' + e.message; }
      } }, '🔄 Controlla aggiornamenti libro e soluzioni')),
    esitoServer);

  // --- Aspetto ---
  const scelta = (chiave, opzioni) => {
    const s = el('select', { class: 'campo' }, ...opzioni.map(([v, t]) => el('option', { value: v, selected: imp[chiave] === v }, t)));
    s.onchange = () => { salvaImpostazione(chiave, s.value); applicaTema(); };
    return s;
  };
  const interruttore = (chiave, testo) => {
    const c = el('input', { type: 'checkbox', checked: !!imp[chiave] });
    c.onchange = () => { salvaImpostazione(chiave, c.checked); applicaTema(); };
    return el('label', { class: 'interruttore' }, c, el('span', {}, testo));
  };
  const cardAspetto = el('section', { class: 'card' },
    el('h3', {}, '🎨 Aspetto e penna'),
    el('label', { class: 'etichetta' }, 'Tema', scelta('tema', [['auto', 'Automatico (come l\'iPad)'], ['chiaro', 'Chiaro'], ['scuro', 'Scuro']])),
    el('label', { class: 'etichetta' }, 'All\'apertura dell\'app', scelta('avvio', [['libreria', 'Mostra la libreria'], ['ultima', 'Riapri l\'ultima pagina letta']])),
    el('label', { class: 'etichetta' }, 'Pagina', scelta('vistaPagina', [['pagina', 'Tutta la pagina nello schermo'], ['larghezza', 'Adatta alla larghezza']])),
    el('label', { class: 'etichetta' }, 'Pagine affiancate', scelta('duePagine', [['auto', 'Automatico: due con l\'iPad in orizzontale'], ['si', 'Sempre due pagine'], ['no', 'Sempre una pagina']])),
    interruttore('pagineScure', 'Pagine scure nel tema scuro (inverte i colori del libro)'),
    interruttore('soloPencil', 'Solo l\'Apple Pencil scrive (il dito sfoglia)'));

  // --- Backup ---
  const cardBackup = el('section', { class: 'card' },
    el('h3', {}, '💾 Backup'),
    el('p', { class: 'nota' }, 'Salva in un file disegni, esercizi fatti, compiti e segnalibri. Mettilo sul disco del modem ogni tanto!'),
    el('div', { class: 'riga-bottoni sinistra' },
      el('button', { class: 'btn', onclick: () => esportaBackup() }, '⬆️ Esporta backup'),
      el('button', { class: 'btn', onclick: () => importaDalDisco() }, '⬇️ Ripristina backup')));

  // --- App ---
  const esitoApp = el('p', { class: 'nota' });
  const cardApp = el('section', { class: 'card' },
    el('h3', {}, '📱 App'),
    el('p', {}, `Versione installata: ${versione || '—'}`),
    el('p', { class: 'nota' }, 'L\'app non si aggiorna mai da sola, né quando la apri o la chiudi. Si aggiorna solo con questo bottone.'),
    el('div', { class: 'riga-bottoni sinistra' },
      el('button', { class: 'btn', onclick: () => controllaAggiornamentoApp(esitoApp) }, '🔄 Controlla aggiornamento app')),
    esitoApp,
    spazio ? el('p', { class: 'nota' }, `Spazio usato: ${mb(spazio.usage || 0)}` + (spazio.quota ? ` su ${mb(spazio.quota)} disponibili` : '')) : '',
    el('p', { class: 'nota' }, persistente ? '🔒 Dati protetti: l\'iPad non li cancella da solo.' : '⚠️ Aggiungi l\'app alla schermata Home per proteggere i dati.'),
    persistente ? '' : el('button', { class: 'btn', onclick: async () => { const ok = await chiediSpazioPersistente(); toast(ok ? 'Dati protetti' : 'Prima aggiungi l\'app alla Home'); disegna(); } }, 'Proteggi i dati'));

  const cardAdmin = el('section', { class: 'card' },
    el('h3', {}, '🔑 Admin'),
    el('p', { class: 'nota' }, 'Carica le soluzioni corrette per ogni unità, gli indici e i capitoli. Serve la password.'),
    el('button', { class: 'btn', onclick: apriAdmin }, 'Entra nell\'area admin'));

  if (soloApp) box.replaceChildren(cardAspetto, cardBackup, cardApp, cardAdmin);
  else box.replaceChildren(cardLibro, ...(UNITA.length && (LIBRO.indiciApp || Object.keys(files).length > 1) ? [cardSol] : []), cardAspetto, cardBackup, cardServer, cardApp, cardAdmin);
}

/** Impostazioni generali dell'app (dalla libreria) */
export function apriImpostazioniApp() {
  const s = apriScheda('⚙️ Impostazioni app', { larga: true });
  disegna(s.corpo, { soloApp: true });
}

// ---------------------------------------------------------------------
//  Tema
// ---------------------------------------------------------------------
export function applicaTema() {
  const imp = impostazioni();
  const root = document.documentElement;
  if (imp.tema === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', imp.tema === 'scuro' ? 'dark' : 'light');
  root.classList.toggle('pagine-scure', !!imp.pagineScure);
}

// ---------------------------------------------------------------------
//  Aggiornamento dell'app (solo a richiesta)
// ---------------------------------------------------------------------
async function versioneInstallata() {
  try { return (await (await fetch('version.json')).json()).versione; } catch (e) { return null; }
}

async function controllaAggiornamentoApp(esito) {
  esito.textContent = 'Controllo…';
  try {
    const nuova = await (await fetch('version.json?rete=1', { cache: 'no-store' })).json();
    const attuale = await versioneInstallata();
    if (nuova.versione === attuale) { esito.textContent = `✅ Hai già l'ultima versione (${attuale}).`; return; }
    esito.replaceChildren(
      el('span', {}, `C'è la versione ${nuova.versione}` + (nuova.novita ? `: ${nuova.novita}` : '') + ' '),
      el('button', { class: 'btn primario', onclick: async () => {
        esito.textContent = 'Scarico l\'aggiornamento…';
        const ok = await chiediAlServiceWorker({ tipo: 'aggiorna' });
        if (ok?.ok) { esito.textContent = 'Aggiornata! Riavvio…'; setTimeout(() => location.reload(), 600); }
        else esito.textContent = '❌ Aggiornamento non riuscito: ' + (ok?.errore || 'riprova col Wi‑Fi');
      } }, 'Aggiorna ora'));
  } catch (e) {
    esito.textContent = '❌ Non riesco a controllare: serve internet.';
  }
}

function chiediAlServiceWorker(msg) {
  return new Promise(resolve => {
    const sw = navigator.serviceWorker?.controller;
    if (!sw) { resolve({ ok: false, errore: 'app non installata (apri da https)' }); return; }
    const canale = new MessageChannel();
    canale.port1.onmessage = e => resolve(e.data);
    sw.postMessage(msg, [canale.port2]);
    setTimeout(() => resolve({ ok: false, errore: 'tempo scaduto' }), 120000);
  });
}
