// =====================================================================
//  viste.js — Le sezioni dell'app:
//   Esercizi e compiti (una sezione sola), Progressi,
//   pannello Capitoli + Segnalibri, Ricerca nel testo del libro.
// =====================================================================
import { $, el, toast, apriScheda, conferma, scaricaFile, eIOS } from './ui.js';
import { creaPdfCompiti } from './pdfcompiti.js';
import { db, ldb } from './db.js';
import { stato, on, emit } from './stato.js';
import { UNITA, LIBRO, libroToPdf, etichettaPagina, fineUnita } from './config.js';
import { apriEsercizio, leggiRichiesta, chiave, tuttiGliEsercizi, caricaIndici, unitaDiPagina, cercaEsercizio, contenutoEsercizio } from './esercizi.js';
import { testoPagina } from './pdf.js';

// ---------------------------------------------------------------------
//  ESERCIZI E COMPITI (una sola sezione)
//  Scrivo "p. 546 es. 12, 15 p. 547 es. 3" e vedo TUTTI gli esercizi
//  uno sotto l'altro. Posso farne un PDF con i quadretti.
// ---------------------------------------------------------------------
export function initEsercizi() {
  const leggi = () => {
    const testo = $('#es-testo').value.trim();
    const voci = leggiRichiesta(testo);
    if (!voci.length) toast('Scrivi per esempio: p. 546 es. 12, 15, 20');
    return { testo, voci };
  };
  $('#form-esercizi').addEventListener('submit', async e => {
    e.preventDefault();
    const { testo, voci } = leggi();
    if (!voci.length) return;
    $('#es-testo').blur();
    mostraTutti(voci, testo);
  });
  // Invio = mostra (Maiusc+Invio va a capo)
  $('#es-testo').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#form-esercizi').requestSubmit(); }
  });
  $('#btn-es-pdf').onclick = () => {
    const { testo, voci } = leggi();
    if (voci.length) apriPdfCompiti(voci, testo);
  };
  on('stato-esercizi', () => disegnaFiltri());
  on('libro-cambiato', () => { $('#es-risultati').replaceChildren(); disegnaFiltri(); });
  disegnaFiltri();
}
export function initCompiti() { /* ora è dentro initEsercizi */ }

/**
 * Mostra tutti gli esercizi richiesti, uno sotto l'altro, ognuno con
 * il suo ritaglio, Fatto/Difficile/Preferito e "Mostra soluzione".
 */
let numeroElenco = 0;
async function mostraTutti(voci, testo) {
  const mio = ++numeroElenco;
  const box = $('#es-risultati');
  if (!stato.libro) { box.replaceChildren(el('p', { class: 'avviso' }, 'Prima importa il PDF del libro.')); return; }
  const contatore = el('span', { class: 'nota' }, `${voci.length} esercizi`);
  const testa = el('div', { class: 'elenco-testa' },
    el('div', {}, el('h2', {}, testo || 'Esercizi'), contatore),
    el('div', { class: 'riga-bottoni sinistra' },
      el('button', { class: 'btn piccolo', onclick: () => apriPdfCompiti(voci, testo) }, '📄 PDF'),
      el('button', { class: 'btn piccolo', onclick: () => box.replaceChildren() }, '✕ Chiudi')));
  const lista = el('div', { class: 'elenco-esercizi' });
  box.replaceChildren(testa, lista);
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const larg = Math.min(860, box.clientWidth - 34);
  const nonTrovati = [];
  // le schede compaiono subito; i ritagli si caricano uno alla volta (iPad: poca memoria)
  for (const v of voci) {
    if (mio !== numeroElenco) return;
    const card = el('section', { class: 'card esercizio-card' },
      el('h3', {}, `p. ${v.p} · es. ${v.es}`), el('div', { class: 'carica' }, 'Cerco…'));
    lista.append(card);
    const ris = await cercaEsercizio(v.p, v.es);
    if (mio !== numeroElenco) return;
    if (!ris) {
      nonTrovati.push(v);
      card.lastChild.replaceWith(el('p', { class: 'avviso' }, `Non l'ho trovato vicino a pagina ${v.p}. Controlla il numero.`));
      continue;
    }
    card.firstChild.textContent = `p. ${ris.voce.p} · es. ${v.es}`;
    const contenuto = await contenutoEsercizio(ris, { larghezza: larg });
    card.lastChild.replaceWith(contenuto);
    await contenuto.pronto;
  }
  contatore.textContent = `${voci.length - nonTrovati.length} esercizi` + (nonTrovati.length ? ` · ${nonTrovati.length} non trovati` : '');
}

/** Elenco di esercizi come "tessere" cliccabili (recenti, difficili, preferiti) */
export async function mostraElenco(contenitore, voci) {
  const tessere = [];
  for (const v of voci) {
    const st = (await ldb.get('stato', chiave(v.p, v.es))) || {};
    tessere.push(el('button', { class: 'tessera' + (st.fatto ? ' fatta' : ''), onclick: () => apriEsercizio(v.p, v.es) },
      el('span', { class: 'tessera-num' }, `es. ${v.es}`),
      el('span', { class: 'tessera-pag' }, `p. ${v.p}`),
      el('span', { class: 'tessera-icone' }, st.fatto ? '✅' : '', st.difficile ? '⚠️' : '', st.preferito ? '⭐' : '')));
  }
  contenitore.replaceChildren(...tessere);
}

async function disegnaFiltri() {
  const tutti = await ldb.all('stato');
  const voce = k => { const [p, es] = k.split('-').map(Number); return { p, es }; };
  const diff = tutti.filter(([, s]) => s.difficile).map(([k]) => voce(k));
  const pref = tutti.filter(([, s]) => s.preferito).map(([k]) => voce(k));
  $('#es-difficili-box').hidden = !diff.length;
  $('#es-preferiti-box').hidden = !pref.length;
  mostraElenco($('#es-difficili'), diff);
  mostraElenco($('#es-preferiti'), pref);
}

/**
 * Scheda "PDF dei compiti": ritaglia gli esercizi, quadretti, risposte in fondo.
 * Poi si può condividere (Salva su File, AirDrop, stampa…) o scaricare.
 */
export function apriPdfCompiti(voci, testo, per = null) {
  const s = apriScheda('📄 PDF dei compiti');
  const svolti = el('input', { type: 'checkbox' });
  const stato_ = el('p', { class: 'nota' });
  const barra = el('div', { class: 'barra-progresso' }, el('div', { style: { width: '0%' } }));
  const azioni = el('div', { class: 'riga-bottoni' });
  const vai = el('button', { class: 'btn primario grande' }, '📄 Crea il PDF');
  s.corpo.append(
    el('p', {}, el('b', {}, testo)),
    el('p', { class: 'nota' }, `${voci.length} esercizi. Ognuno ritagliato ad alta risoluzione con il suo risultato, sotto il foglio a quadretti. Se sono corti, fino a 3 per pagina. In fondo le risposte.`),
    el('label', { class: 'interruttore' }, svolti, el('span', {}, 'Aggiungi in fondo anche gli svolgimenti (passi)')),
    el('div', { class: 'riga-bottoni' }, vai), barra, stato_, azioni);
  vai.onclick = async () => {
    vai.disabled = true;
    try {
      const data = per || new Date().toISOString().slice(0, 10);
      const titolo = `Compiti${per ? ' per il ' + new Date(per + 'T12:00').toLocaleDateString('it-IT') : ''} · ${testo}`.slice(0, 95);
      const { blob, nonTrovati, trovati } = await creaPdfCompiti(voci, {
        titolo, conSvolgimenti: svolti.checked,
        avanzamento: (n, tot, t) => { barra.firstChild.style.width = `${100 * n / tot}%`; stato_.textContent = t; },
      });
      const pagine = [...new Set(voci.map(v => v.p))].join('-');
      const nome = `Compiti_p${pagine}_${data}.pdf`.replace(/[^\w.-]/g, '_');
      const file = new File([blob], nome, { type: 'application/pdf' });
      stato_.textContent = `✅ Pronto: ${trovati} esercizi, ${(blob.size / 1024 / 1024).toFixed(1)} MB.` +
        (nonTrovati.length ? ` ⚠️ Non trovati: ${nonTrovati.map(v => `p. ${v.p} es. ${v.es}`).join(', ')}.` : '');
      const url = URL.createObjectURL(blob);
      azioni.replaceChildren(
        navigator.canShare?.({ files: [file] })
          ? el('button', { class: 'btn primario', onclick: () => navigator.share({ files: [file], title: nome }).catch(() => {}) }, eIOS ? '📤 Salva su File / Stampa' : '📤 Condividi')
          : '',
        el('button', { class: 'btn', onclick: () => window.open(url, '_blank') }, '👀 Apri'),
        el('button', { class: 'btn', onclick: () => scaricaFile(nome, blob) }, '⬇️ Scarica'));
    } catch (e) {
      console.error(e);
      stato_.textContent = '❌ ' + e.message;
    } finally { vai.disabled = false; vai.textContent = '🔁 Crea di nuovo'; }
  };
}

// ---------------------------------------------------------------------
//  PROGRESSI per unità
// ---------------------------------------------------------------------
export function initProgressi() { /* i progressi ora sono nel pannello dei capitoli */ }

/**
 * Esercizi fatti per unità: Map n -> { tot, fatti, diff }
 * (tot = esercizi dell'indice; per i libri senza indice resta 0)
 */
export async function progressiPerUnita() {
  await caricaIndici();
  const stati = new Map(await ldb.all('stato'));
  const perUnita = new Map();
  const conta = n => { if (!perUnita.has(n)) perUnita.set(n, { tot: 0, fatti: 0, diff: 0 }); return perUnita.get(n); };
  for (const v of tuttiGliEsercizi()) conta(v.u).tot++;
  for (const [k, st] of stati) {
    const p = Number(k.split('-')[0]);
    const x = conta(unitaDiPagina(p)?.n ?? 0);
    if (st.fatto) x.fatti++;
    if (st.difficile) x.diff++;
  }
  return perUnita;
}

/** Barretta "12/80 fatti" per una unità */
export function barraProgresso(x) {
  if (!x || (!x.tot && !x.fatti)) return '';
  const perc = x.tot ? Math.round(100 * x.fatti / x.tot) : 0;
  return el('span', { class: 'progresso-cap' },
    el('span', { class: 'barra-progresso piccola' }, el('div', { style: { width: `${perc}%` } })),
    el('small', {}, (x.tot ? `${x.fatti}/${x.tot} fatti` : `${x.fatti} fatti`) + (x.diff ? ` · ${x.diff} ⚠️` : '')));
}

// ---------------------------------------------------------------------
//  PANNELLO CAPITOLI + SEGNALIBRI
// ---------------------------------------------------------------------
export function initCapitoli() {
  const pannello = $('#pannello-capitoli');
  $('#btn-capitoli').onclick = () => { disegnaCapitoli(); pannello.classList.add('aperto'); };
  $('#chiudi-capitoli').onclick = () => pannello.classList.remove('aperto');
  pannello.addEventListener('click', e => { if (e.target === pannello) pannello.classList.remove('aperto'); });
  $('#btn-segnalibro').onclick = toggleSegnalibro;
  on('pagina', aggiornaIconaSegnalibro);
}

function vai(pdf) {
  $('#pannello-capitoli').classList.remove('aperto');
  emit('vai-pagina', { pdf });
}

async function disegnaCapitoli() {
  const att = stato.pagina;
  const prog = await progressiPerUnita();
  let fatti = 0, tot = 0;
  for (const x of prog.values()) { fatti += x.fatti; tot += x.tot; }
  $('#progressi-totale').replaceChildren(tot || fatti
    ? el('div', { class: 'progresso-totale' },
      el('b', {}, `${fatti} ${fatti === 1 ? 'esercizio fatto' : 'esercizi fatti'}` + (tot ? ` su ${tot}` : '')),
      tot ? el('div', { class: 'barra-progresso' }, el('div', { style: { width: `${100 * fatti / tot}%` } })) : '')
    : '');
  const lista = UNITA.map(u => {
    const fine = fineUnita(u);
    const qui = att >= libroToPdf(u.inizio) && att <= libroToPdf(fine);
    return el('li', { class: qui ? 'qui' : '' },
      el('button', { class: 'cap-titolo', onclick: () => vai(libroToPdf(u.inizio)) },
        el('b', {}, `Unità ${u.n}`), ` ${u.titolo}`, el('small', {}, `pp. ${u.inizio}–${fine}`), barraProgresso(prog.get(u.n))),
      el('div', { class: 'cap-link' },
        el('button', { onclick: () => vai(libroToPdf(u.inizio)) }, 'Teoria'),
        u.esercizi ? el('button', { onclick: () => vai(libroToPdf(u.esercizi)) }, `Esercizi p. ${u.esercizi}`) : '',
        u.autoverifica ? el('button', { onclick: () => vai(libroToPdf(u.autoverifica)) }, `Autoverifica p. ${u.autoverifica}`) : ''));
  });
  if (LIBRO.u18) lista.push(el('li', {},
    el('button', { class: 'cap-titolo', onclick: () => vai(LIBRO.u18.primaPdf) }, el('b', {}, 'Unità 18'), ` ${LIBRO.u18.titolo}`, el('small', {}, `1/${LIBRO.u18.pagine}–${LIBRO.u18.pagine}/${LIBRO.u18.pagine}`))));
  const extra = [];
  if (LIBRO.risposteAutoverifica) extra.push(el('button', { class: 'cap-titolo', onclick: () => vai(libroToPdf(LIBRO.risposteAutoverifica)) }, el('b', {}, 'Risposte autoverifiche'), el('small', {}, `p. ${LIBRO.risposteAutoverifica}`)));
  if (LIBRO.indiceAnalitico) extra.push(el('button', { class: 'cap-titolo', onclick: () => vai(LIBRO.indiceAnalitico.pdf[0]) }, el('b', {}, 'Indice analitico'), el('small', {}, `p. ${LIBRO.indiceAnalitico.libro[0]}`)));
  if (extra.length) lista.push(el('li', {}, ...extra));
  if (!UNITA.length) lista.push(el('li', { class: 'vuoto' }, 'Questo libro non ha ancora i capitoli. Aggiungili da Altro → Questo libro.'));
  $('#lista-capitoli').replaceChildren(...lista);

  const sl = (await ldb.get('kv', 'segnalibri')) || [];
  $('#lista-segnalibri').replaceChildren(...(sl.length ? sl.map(s =>
    el('li', {}, el('button', { class: 'cap-titolo', onclick: () => vai(s.pdf) }, `🔖 p. ${etichettaPagina(s.pdf)}`, el('small', {}, s.nome || '')),
      el('button', { class: 'btn-icona', 'aria-label': 'Togli segnalibro', onclick: async () => { await togliSegnalibro(s.pdf); disegnaCapitoli(); } }, '✕')))
    : [el('li', { class: 'vuoto' }, 'Tocca 🔖 in alto per aggiungere un segnalibro.')]));
}

async function toggleSegnalibro() {
  const sl = (await ldb.get('kv', 'segnalibri')) || [];
  if (sl.some(s => s.pdf === stato.pagina)) { await togliSegnalibro(stato.pagina); toast('Segnalibro tolto'); }
  else {
    sl.push({ pdf: stato.pagina, nome: $('#titolo-unita').textContent, data: Date.now() });
    sl.sort((a, b) => a.pdf - b.pdf);
    await ldb.set('kv', 'segnalibri', sl);
    toast(`Segnalibro a p. ${etichettaPagina(stato.pagina)}`);
  }
  aggiornaIconaSegnalibro();
}
async function togliSegnalibro(pdf) {
  const sl = (await ldb.get('kv', 'segnalibri')) || [];
  await ldb.set('kv', 'segnalibri', sl.filter(s => s.pdf !== pdf));
  aggiornaIconaSegnalibro();
}
async function aggiornaIconaSegnalibro() {
  const sl = (await ldb.get('kv', 'segnalibri')) || [];
  $('#btn-segnalibro').classList.toggle('attivo', sl.some(s => s.pdf === stato.pagina));
}

// ---------------------------------------------------------------------
//  RICERCA NEL TESTO DEL LIBRO
//  La prima volta legge tutte le pagine (qualche minuto) e salva il testo.
// ---------------------------------------------------------------------
export function initRicercaTesto() {
  $('#btn-cerca-testo').onclick = apriRicerca;
}

let indicizzando = false;
async function apriRicerca() {
  if (!stato.libro) { toast('Prima importa il libro'); return; }
  const s = apriScheda('Cerca nel libro', { larga: true, onChiudi: () => { indicizzando = false; } });
  const input = el('input', { class: 'campo', type: 'search', placeholder: 'es. teorema di Pitagora' });
  const stato_ = el('p', { class: 'nota' });
  const risultati = el('ul', { class: 'risultati-testo' });
  s.corpo.append(input, stato_, risultati);
  setTimeout(() => input.focus(), 50);

  const pronte = new Set((await ldb.keys('testo')).map(Number));
  const totale = stato.totalePagine;
  if (pronte.size < totale) {
    stato_.textContent = `Preparo la ricerca: ${pronte.size}/${totale} pagine (solo la prima volta)…`;
    indicizzando = true;
    (async () => {
      for (let n = 1; n <= totale && indicizzando; n++) {
        if (pronte.has(n)) continue;
        try {
          const pezzi = await testoPagina(stato.libro, n);
          await ldb.set('testo', n, pezzi.map(x => x.str).join(' ').replace(/\s+/g, ' '));
        } catch (e) { /* pagina senza testo */ }
        pronte.add(n);
        if (n % 10 === 0) stato_.textContent = `Preparo la ricerca: ${pronte.size}/${totale} pagine (solo la prima volta)…`;
      }
      if (indicizzando) stato_.textContent = 'Ricerca pronta.';
    })();
  }

  let timer;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(cerca, 300); });
  async function cerca() {
    const q = input.value.trim().toLowerCase();
    if (q.length < 3) { risultati.replaceChildren(); return; }
    const tutte = await ldb.all('testo');
    const trovate = [];
    for (const [n, t] of tutte) {
      const i = t.toLowerCase().indexOf(q);
      if (i >= 0) trovate.push({ n: Number(n), frase: '…' + t.slice(Math.max(0, i - 50), i + q.length + 60) + '…' });
      if (trovate.length >= 80) break;
    }
    trovate.sort((a, b) => a.n - b.n);
    risultati.replaceChildren(...(trovate.length ? trovate.map(r => el('li', {},
      el('button', { onclick: () => { s.chiudi(); emit('vai-pagina', { pdf: r.n }); } },
        el('b', {}, `p. ${etichettaPagina(r.n)}`), el('span', {}, r.frase))))
      : [el('li', { class: 'vuoto' }, 'Nessun risultato (per ora).')]));
  }
}
