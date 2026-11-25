// =====================================================================
//  admin.js — Area admin (protetta da password).
//  - carica le soluzioni corrette per ogni unità (JSON o PDF svolti)
//  - aggiunge o corregge una soluzione a mano
//  - carica indici nuovi (se cambia il libro)
//  - rileva automaticamente i capitoli dal PDF del libro
//
//  NOTA: la password protegge da modifiche per sbaglio (es. un amico che
//  usa l'iPad). Non è una cassaforte: i dati sono comunque sull'iPad.
// =====================================================================
import { el, toast, apriScheda, chiediTesto, conferma, scegliFile, scaricaFile } from './ui.js';
import { db, ldb } from './db.js';
import { stato, elencoLibri, salvaLibroDef } from './stato.js';
import { UNITA, impostaUnita, LIBRO, pdfToLibro } from './config.js';
import { importaFile, mostraRiepilogo, salvaSoluzioniJson } from './importa.js';
import { caricaIndici, testoConFormule } from './esercizi.js';
import { testoPagina } from './pdf.js';

async function hash(testo) {
  const dati = new TextEncoder().encode('libro-vivo:' + testo);
  if (crypto.subtle) {
    const h = await crypto.subtle.digest('SHA-256', dati);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // riserva (pagina non https): semplice ma sufficiente qui
  let h = 5381; for (const b of dati) h = ((h << 5) + h + b) | 0;
  return 'x' + (h >>> 0).toString(16);
}

let sbloccato = false;

export async function apriAdmin() {
  if (!sbloccato) {
    const salvata = await db.get('kv', 'adminHash');
    if (!salvata) {
      const p1 = await chiediTesto('Scegli la password admin', { etichetta: 'Nuova password (almeno 4 caratteri)', tipo: 'password' });
      if (!p1 || p1.length < 4) { if (p1 != null) toast('Password troppo corta'); return; }
      const p2 = await chiediTesto('Ripeti la password', { etichetta: 'Ripeti', tipo: 'password' });
      if (p1 !== p2) { toast('Le password non coincidono'); return; }
      await db.set('kv', 'adminHash', await hash(p1));
      toast('Password salvata');
    } else {
      const p = await chiediTesto('Area admin', { etichetta: 'Password', tipo: 'password', bottone: 'Entra' });
      if (p == null) return;
      if (await hash(p) !== salvata) { toast('Password sbagliata'); return; }
    }
    sbloccato = true;
  }
  mostra();
}

async function mostra() {
  const s = apriScheda('🔑 Area admin', { larga: true });
  const c = s.corpo;

  // --- Soluzioni per unità ---
  const kv = new Map(await ldb.all('kv'));
  const righe = UNITA.map(u => {
    const j = kv.get(`soluzioniJson-${u.n}`);
    return el('tr', {},
      el('td', {}, `U${u.n}`),
      el('td', {}, u.titolo),
      el('td', {}, j ? `${j.numero} soluzioni` : '—'),
      el('td', {}, el('button', { class: 'btn piccolo', onclick: async () => {
        const f = await scegliFile({ accept: '.json,.pdf,application/json,application/pdf', multiplo: true });
        if (!f.length) return;
        const r = await importaFile(f, { admin: true });
        mostraRiepilogo(r); s.chiudi(); mostra();
      } }, 'Carica')));
  });
  c.append(el('section', { class: 'card' },
    el('h3', {}, 'Soluzioni corrette per unità'),
    el('p', { class: 'nota' }, 'Carica i file Uxx_….json (soluzioni a passi) e/o Uxx_…_SVOLTI.pdf. Se una soluzione esiste già, viene sostituita.'),
    el('div', { class: 'tabella-scroll' }, el('table', { class: 'tabella' }, el('tbody', {}, ...righe)))));

  // --- Soluzione singola ---
  const f = {
    pagina: el('input', { class: 'campo', type: 'number', inputmode: 'numeric', placeholder: '546' }),
    es: el('input', { class: 'campo', type: 'number', inputmode: 'numeric', placeholder: '12' }),
    risultato: el('input', { class: 'campo', placeholder: 'x = 3 ∨ x = −1  (formule tra $…$)' }),
    passi: el('textarea', { class: 'campo', rows: 6, placeholder: 'Un passo per riga. Formule tra $…$, grassetto tra **…**' }),
  };
  const anteprima = el('div', { class: 'anteprima' });
  const aggiornaAnteprima = () => {
    anteprima.innerHTML = '<ol class="passi">' + f.passi.value.split('\n').filter(Boolean).map(r => `<li>${testoConFormule(r)}</li>`).join('') +
      '</ol>' + (f.risultato.value ? `<p class="risultato"><b>Risultato:</b> ${testoConFormule(f.risultato.value)}</p>` : '');
  };
  f.passi.oninput = aggiornaAnteprima; f.risultato.oninput = aggiornaAnteprima;
  const carica = async () => {
    const sol = await ldb.get('soluzioni', `${f.pagina.value}-${f.es.value}`);
    if (sol) { f.risultato.value = sol.risultato || ''; f.passi.value = (sol.passi || []).join('\n'); aggiornaAnteprima(); toast('Soluzione caricata: puoi correggerla'); }
    else toast('Nessuna soluzione a passi: scrivila tu');
  };
  c.append(el('section', { class: 'card' },
    el('h3', {}, 'Aggiungi o correggi una soluzione'),
    el('div', { class: 'riga-campi' }, el('label', { class: 'etichetta' }, 'Pagina libro', f.pagina), el('label', { class: 'etichetta' }, 'Esercizio', f.es),
      el('button', { class: 'btn', onclick: carica }, 'Apri esistente')),
    el('label', { class: 'etichetta' }, 'Risultato', f.risultato),
    el('label', { class: 'etichetta' }, 'Passi', f.passi),
    anteprima,
    el('div', { class: 'riga-bottoni sinistra' }, el('button', { class: 'btn primario', onclick: async () => {
      const pagina = Number(f.pagina.value), es = Number(f.es.value);
      if (!pagina || !es) { toast('Scrivi pagina ed esercizio'); return; }
      const vecchia = (await ldb.get('soluzioni', `${pagina}-${es}`)) || {};
      await salvaSoluzioniJson([{ ...vecchia, pagina, es, risultato: f.risultato.value, passi: f.passi.value.split('\n').map(x => x.trim()).filter(Boolean), corretta: Date.now() }]);
      toast(`Salvata p. ${pagina} es. ${es}`);
    } }, '💾 Salva soluzione'))));

  // --- Esporta ---
  c.append(el('section', { class: 'card' },
    el('h3', {}, 'Condividi le soluzioni'),
    el('p', { class: 'nota' }, 'Crea un file .json con tutte le soluzioni a passi (anche quelle corrette a mano), da dare a un amico.'),
    el('button', { class: 'btn', onclick: async () => {
      const tutte = (await ldb.all('soluzioni')).map(([, v]) => v);
      scaricaFile('soluzioni_libro_vivo.json', new Blob([JSON.stringify(tutte)], { type: 'application/json' }));
    } }, '⬆️ Esporta tutte le soluzioni')));

  // --- Capitoli ---
  const esitoCap = el('div', { class: 'nota' });
  c.append(el('section', { class: 'card' },
    el('h3', {}, 'Capitoli (unità)'),
    el('p', { class: 'nota' }, `Le unità sono divise con la mappa delle pagine (pagina PDF = pagina libro + ${LIBRO.offset}). Puoi ricontrollarla leggendo le intestazioni "UNITÀ n" del PDF.`),
    el('button', { class: 'btn', onclick: () => rilevaCapitoli(esitoCap) }, '🔍 Rileva capitoli automaticamente'),
    esitoCap));

  // --- Indici ---
  c.append(el('section', { class: 'card' },
    el('h3', {}, 'Indici (per esperti)'),
    el('p', { class: 'nota' }, 'Servono se cambia il libro. Si creano con gli script nella cartella tools/ del progetto.'),
    el('div', { class: 'riga-bottoni sinistra' },
      el('button', { class: 'btn', onclick: async () => {
        const files = await scegliFile({ accept: '.json,application/json', multiplo: true });
        if (files.length) mostraRiepilogo(await importaFile(files, { admin: true }));
      } }, 'Carica indice'),
      el('button', { class: 'btn', onclick: async () => {
        if (!await conferma('Tornare agli indici originali dell\'app?')) return;
        await ldb.del('kv', 'indiceEsercizi'); await ldb.del('kv', 'indiceSoluzioni'); await caricaIndici(); toast('Indici originali');
      } }, 'Indici originali'))));

  // --- Password ---
  c.append(el('section', { class: 'card' },
    el('h3', {}, 'Password'),
    el('div', { class: 'riga-bottoni sinistra' },
      el('button', { class: 'btn', onclick: async () => {
        const p1 = await chiediTesto('Nuova password', { tipo: 'password' });
        if (!p1 || p1.length < 4) return;
        await db.set('kv', 'adminHash', await hash(p1)); toast('Password cambiata');
      } }, 'Cambia password'),
      el('button', { class: 'btn', onclick: () => { sbloccato = false; s.chiudi(); toast('Uscito dall\'area admin'); } }, 'Esci'))));
}

/**
 * Legge l'intestazione in alto di ogni pagina ("UNITÀ 10") e trova
 * dove inizia ogni unità e dove c'è la "Prova di autoverifica".
 */
async function rilevaCapitoli(esito) {
  if (!stato.libro) { esito.textContent = 'Prima importa il libro.'; return; }
  const trovate = {};       // n -> { prima, ultima, autoverifica }
  const tot = Math.min(stato.totalePagine, LIBRO.ultimaPaginaLibro + LIBRO.offset);
  for (let pdf = LIBRO.primaPaginaLibro + LIBRO.offset; pdf <= tot; pdf++) {
    if (pdf % 20 === 0) esito.textContent = `Leggo le pagine… ${pdf}/${tot}`;
    let pezzi;
    try { pezzi = await testoPagina(stato.libro, pdf); } catch (e) { continue; }
    const alto = pezzi.filter(t => t.y < 45).map(t => t.str).join(' ');
    const m = alto.match(/UNIT[ÀA]\s*(\d{1,2})/i);
    if (!m) continue;
    const n = Number(m[1]);
    const p = pdfToLibro(pdf);
    const x = (trovate[n] ||= { prima: p, ultima: p, autoverifica: null });
    x.ultima = p;
    if (!x.autoverifica && /Prova di autoverifica/i.test(pezzi.map(t => t.str).join(' '))) x.autoverifica = p;
  }
  // l'unità n inizia dopo l'ultima pagina con intestazione n-1
  const lista = [];
  for (const u of UNITA) {
    const t = trovate[u.n];
    if (!t) continue;
    const prec = trovate[u.n - 1];
    const inizio = prec ? prec.ultima + 1 : t.prima;
    lista.push({ n: u.n, inizio, autoverifica: t.autoverifica ?? u.autoverifica, vecchio: u.inizio });
  }
  const diverse = lista.filter(x => x.inizio !== x.vecchio);
  esito.replaceChildren(
    el('p', {}, `Trovate ${lista.length} unità. ` + (diverse.length ? `${diverse.length} diverse dalla mappa attuale:` : 'Tutto uguale alla mappa attuale ✅')),
    diverse.length ? el('ul', {}, ...diverse.map(x => el('li', {}, `U${x.n}: mappa p. ${x.vecchio} → rilevata p. ${x.inizio}`))) : '',
    diverse.length ? el('button', { class: 'btn primario', onclick: async () => {
      const nuove = lista.map(({ n, inizio, autoverifica }) => ({ n, inizio, autoverifica }));
      impostaUnita(nuove);
      const def = (await elencoLibri()).find(l => l.id === stato.idLibro);
      await salvaLibroDef({ ...def, unita: UNITA.map(u => ({ ...u })) });
      toast('Capitoli aggiornati');
    } }, 'Usa i capitoli rilevati') : '');
}
