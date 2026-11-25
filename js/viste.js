// =====================================================================
//  viste.js — Le sezioni dell'app:
//   Esercizi (ricerca), Compiti del giorno, Progressi,
//   pannello Capitoli + Segnalibri, Ricerca nel testo del libro.
// =====================================================================
import { $, el, toast, apriScheda, conferma } from './ui.js';
import { db } from './db.js';
import { stato, on, emit } from './stato.js';
import { UNITA, U18, LIBRO, RISPOSTE_AUTOVERIFICA, libroToPdf, etichettaPagina, fineUnita } from './config.js';
import { apriEsercizio, leggiRichiesta, chiave, tuttiGliEsercizi, caricaIndici } from './esercizi.js';
import { testoPagina } from './pdf.js';

// ---------------------------------------------------------------------
//  ESERCIZI: scrivo pagina + numeri e apro la scheda
// ---------------------------------------------------------------------
export function initEsercizi() {
  const form = $('#form-esercizi');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const p = Number($('#es-pagina').value);
    const testo = $('#es-numeri').value;
    if (!p || !testo.trim()) { toast('Scrivi la pagina del libro e il numero'); return; }
    const voci = leggiRichiesta(`p. ${p} es. ${testo}`);
    if (!voci.length) { toast('Numero non valido'); return; }
    await aggiungiRecenti(voci);
    if (voci.length === 1) apriEsercizio(voci[0].p, voci[0].es);
    else mostraElenco($('#es-risultati'), voci);
    disegnaRecenti();
  });
  on('stato-esercizi', () => { disegnaRecenti(); disegnaFiltri(); });
  disegnaRecenti();
  disegnaFiltri();
}

/** Elenco di esercizi come "tessere" cliccabili */
export async function mostraElenco(contenitore, voci) {
  const tessere = [];
  for (const v of voci) {
    const st = (await db.get('stato', chiave(v.p, v.es))) || {};
    tessere.push(el('button', { class: 'tessera' + (st.fatto ? ' fatta' : ''), onclick: () => apriEsercizio(v.p, v.es) },
      el('span', { class: 'tessera-num' }, `es. ${v.es}`),
      el('span', { class: 'tessera-pag' }, `p. ${v.p}`),
      el('span', { class: 'tessera-icone' }, st.fatto ? '✅' : '', st.difficile ? '⚠️' : '', st.preferito ? '⭐' : '')));
  }
  contenitore.replaceChildren(...tessere);
}

async function aggiungiRecenti(voci) {
  const r = (await db.get('kv', 'recenti')) || [];
  const nuovi = [...voci, ...r.filter(x => !voci.some(v => v.p === x.p && v.es === x.es))].slice(0, 24);
  await db.set('kv', 'recenti', nuovi);
}
async function disegnaRecenti() {
  const r = (await db.get('kv', 'recenti')) || [];
  $('#es-recenti-box').hidden = !r.length;
  mostraElenco($('#es-recenti'), r);
}
async function disegnaFiltri() {
  const tutti = await db.all('stato');
  const voce = k => { const [p, es] = k.split('-').map(Number); return { p, es }; };
  const diff = tutti.filter(([, s]) => s.difficile).map(([k]) => voce(k));
  const pref = tutti.filter(([, s]) => s.preferito).map(([k]) => voce(k));
  $('#es-difficili-box').hidden = !diff.length;
  $('#es-preferiti-box').hidden = !pref.length;
  mostraElenco($('#es-difficili'), diff);
  mostraElenco($('#es-preferiti'), pref);
}

// ---------------------------------------------------------------------
//  COMPITI DEL GIORNO
// ---------------------------------------------------------------------
export function initCompiti() {
  $('#form-compiti').addEventListener('submit', async e => {
    e.preventDefault();
    const testo = $('#compiti-testo').value.trim();
    const voci = leggiRichiesta(testo);
    if (!voci.length) { toast('Scrivi per esempio: p. 546 es. 12, 15, 20'); return; }
    const id = `c${Date.now()}`;
    const per = $('#compiti-data').value || null;
    await db.set('compiti', id, { id, testo, per, creato: Date.now(), voci });
    $('#compiti-testo').value = '';
    disegnaCompiti();
    toast(`Lista creata: ${voci.length} esercizi`);
  });
  on('stato-esercizi', disegnaCompiti);
  disegnaCompiti();
}

async function disegnaCompiti() {
  const liste = (await db.all('compiti')).map(([, v]) => v).sort((a, b) => b.creato - a.creato);
  const box = $('#compiti-liste');
  if (!liste.length) { box.replaceChildren(el('p', { class: 'vuoto' }, 'Nessuna lista. Scrivi i compiti qui sopra.')); return; }
  const blocchi = [];
  for (const l of liste) {
    let fatti = 0;
    for (const v of l.voci) if ((await db.get('stato', chiave(v.p, v.es)))?.fatto) fatti++;
    const griglia = el('div', { class: 'griglia-tessere' });
    mostraElenco(griglia, l.voci);
    const data = l.per ? new Date(l.per + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }) : null;
    blocchi.push(el('section', { class: 'card' },
      el('div', { class: 'card-testa' },
        el('div', {}, el('h3', {}, l.testo), el('p', { class: 'nota' }, `${data ? 'Per ' + data : 'Senza data'} · ${fatti}/${l.voci.length} fatti`)),
        el('button', { class: 'btn-icona', 'aria-label': 'Elimina lista', onclick: async () => {
          if (await conferma('Eliminare questa lista di compiti? (gli esercizi restano segnati come fatti)', { si: 'Elimina', pericolo: true })) {
            await db.del('compiti', l.id); disegnaCompiti();
          }
        } }, '🗑')),
      el('div', { class: 'barra-progresso' }, el('div', { style: { width: `${100 * fatti / l.voci.length}%` } })),
      griglia));
  }
  box.replaceChildren(...blocchi);
}

// ---------------------------------------------------------------------
//  PROGRESSI per unità
// ---------------------------------------------------------------------
export function initProgressi() {
  on('stato-esercizi', disegnaProgressi);
  on('mostra-vista', v => { if (v === 'progressi') disegnaProgressi(); });
}

async function disegnaProgressi() {
  await caricaIndici();
  const stati = new Map(await db.all('stato'));
  const perUnita = new Map();
  for (const v of tuttiGliEsercizi()) {
    if (!perUnita.has(v.u)) perUnita.set(v.u, { tot: 0, fatti: 0, diff: 0 });
    const x = perUnita.get(v.u);
    x.tot++;
    const s = stati.get(chiave(v.p, v.es));
    if (s?.fatto) x.fatti++;
    if (s?.difficile) x.diff++;
  }
  let totFatti = 0, tot = 0;
  const righe = UNITA.map(u => {
    const x = perUnita.get(u.n) || { tot: 0, fatti: 0, diff: 0 };
    totFatti += x.fatti; tot += x.tot;
    const perc = x.tot ? Math.round(100 * x.fatti / x.tot) : 0;
    return el('button', { class: 'riga-unita', onclick: () => emit('vai-pagina', { pdf: libroToPdf(u.esercizi) }) },
      el('span', { class: 'u-num' }, u.n),
      el('span', { class: 'u-nome' }, u.titolo, el('small', {}, `${x.fatti} fatti su ${x.tot}` + (x.diff ? ` · ${x.diff} difficili` : ''))),
      el('span', { class: 'barra-progresso piccola' }, el('div', { style: { width: `${perc}%` } })),
      el('span', { class: 'u-perc' }, `${perc}%`));
  });
  $('#progressi-totale').textContent = `${totFatti} esercizi fatti su ${tot}`;
  $('#progressi-unita').replaceChildren(...righe);
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
  const lista = UNITA.map(u => {
    const fine = fineUnita(u);
    const qui = att >= libroToPdf(u.inizio) && att <= libroToPdf(fine);
    return el('li', { class: qui ? 'qui' : '' },
      el('button', { class: 'cap-titolo', onclick: () => vai(libroToPdf(u.inizio)) },
        el('b', {}, `Unità ${u.n}`), ` ${u.titolo}`, el('small', {}, `pp. ${u.inizio}–${fine}`)),
      el('div', { class: 'cap-link' },
        el('button', { onclick: () => vai(libroToPdf(u.inizio)) }, 'Teoria'),
        u.esercizi ? el('button', { onclick: () => vai(libroToPdf(u.esercizi)) }, `Esercizi p. ${u.esercizi}`) : '',
        u.autoverifica ? el('button', { onclick: () => vai(libroToPdf(u.autoverifica)) }, `Autoverifica p. ${u.autoverifica}`) : ''));
  });
  lista.push(el('li', {},
    el('button', { class: 'cap-titolo', onclick: () => vai(LIBRO.u18.primaPdf) }, el('b', {}, 'Unità 18'), ` ${U18.titolo}`, el('small', {}, `1/${LIBRO.u18.pagine}–${LIBRO.u18.pagine}/${LIBRO.u18.pagine}`))));
  lista.push(el('li', {},
    el('button', { class: 'cap-titolo', onclick: () => vai(libroToPdf(RISPOSTE_AUTOVERIFICA)) }, el('b', {}, 'Risposte autoverifiche'), el('small', {}, `p. ${RISPOSTE_AUTOVERIFICA}`)),
    el('button', { class: 'cap-titolo', onclick: () => vai(LIBRO.indiceAnalitico.pdf[0]) }, el('b', {}, 'Indice analitico'), el('small', {}, `p. ${LIBRO.indiceAnalitico.libro[0]}`))));
  $('#lista-capitoli').replaceChildren(...lista);

  const sl = (await db.get('kv', 'segnalibri')) || [];
  $('#lista-segnalibri').replaceChildren(...(sl.length ? sl.map(s =>
    el('li', {}, el('button', { class: 'cap-titolo', onclick: () => vai(s.pdf) }, `🔖 p. ${etichettaPagina(s.pdf)}`, el('small', {}, s.nome || '')),
      el('button', { class: 'btn-icona', 'aria-label': 'Togli segnalibro', onclick: async () => { await togliSegnalibro(s.pdf); disegnaCapitoli(); } }, '✕')))
    : [el('li', { class: 'vuoto' }, 'Tocca 🔖 in alto per aggiungere un segnalibro.')]));
}

async function toggleSegnalibro() {
  const sl = (await db.get('kv', 'segnalibri')) || [];
  if (sl.some(s => s.pdf === stato.pagina)) { await togliSegnalibro(stato.pagina); toast('Segnalibro tolto'); }
  else {
    sl.push({ pdf: stato.pagina, nome: $('#titolo-unita').textContent, data: Date.now() });
    sl.sort((a, b) => a.pdf - b.pdf);
    await db.set('kv', 'segnalibri', sl);
    toast(`Segnalibro a p. ${etichettaPagina(stato.pagina)}`);
  }
  aggiornaIconaSegnalibro();
}
async function togliSegnalibro(pdf) {
  const sl = (await db.get('kv', 'segnalibri')) || [];
  await db.set('kv', 'segnalibri', sl.filter(s => s.pdf !== pdf));
  aggiornaIconaSegnalibro();
}
async function aggiornaIconaSegnalibro() {
  const sl = (await db.get('kv', 'segnalibri')) || [];
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

  const pronte = new Set((await db.keys('testo')).map(Number));
  const totale = stato.totalePagine;
  if (pronte.size < totale) {
    stato_.textContent = `Preparo la ricerca: ${pronte.size}/${totale} pagine (solo la prima volta)…`;
    indicizzando = true;
    (async () => {
      for (let n = 1; n <= totale && indicizzando; n++) {
        if (pronte.has(n)) continue;
        try {
          const pezzi = await testoPagina(stato.libro, n);
          await db.set('testo', n, pezzi.map(x => x.str).join(' ').replace(/\s+/g, ' '));
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
    const tutte = await db.all('testo');
    const trovate = [];
    for (const [n, t] of tutte) {
      const i = t.toLowerCase().indexOf(q);
      if (i >= 0) trovate.push({ n, frase: '…' + t.slice(Math.max(0, i - 50), i + q.length + 60) + '…' });
      if (trovate.length >= 80) break;
    }
    trovate.sort((a, b) => a.n - b.n);
    risultati.replaceChildren(...(trovate.length ? trovate.map(r => el('li', {},
      el('button', { onclick: () => { s.chiudi(); emit('vai-pagina', { pdf: r.n }); } },
        el('b', {}, `p. ${etichettaPagina(r.n)}`), el('span', {}, r.frase))))
      : [el('li', { class: 'vuoto' }, 'Nessun risultato (per ora).')]));
  }
}
