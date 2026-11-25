// =====================================================================
//  viste.js — Le sezioni dell'app:
//   Esercizi (ricerca), Compiti del giorno, Progressi,
//   pannello Capitoli + Segnalibri, Ricerca nel testo del libro.
// =====================================================================
import { $, el, toast, apriScheda, conferma, scaricaFile, eIOS } from './ui.js';
import { creaPdfCompiti } from './pdfcompiti.js';
import { db, ldb } from './db.js';
import { stato, on, emit } from './stato.js';
import { UNITA, LIBRO, libroToPdf, etichettaPagina, fineUnita } from './config.js';
import { apriEsercizio, leggiRichiesta, chiave, tuttiGliEsercizi, caricaIndici, unitaDiPagina } from './esercizi.js';
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
  on('libro-cambiato', () => { $('#es-risultati').replaceChildren(); disegnaRecenti(); disegnaFiltri(); });
  disegnaRecenti();
  disegnaFiltri();
}

/** Elenco di esercizi come "tessere" cliccabili */
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

async function aggiungiRecenti(voci) {
  const r = (await ldb.get('kv', 'recenti')) || [];
  const nuovi = [...voci, ...r.filter(x => !voci.some(v => v.p === x.p && v.es === x.es))].slice(0, 24);
  await ldb.set('kv', 'recenti', nuovi);
}
async function disegnaRecenti() {
  const r = (await ldb.get('kv', 'recenti')) || [];
  $('#es-recenti-box').hidden = !r.length;
  mostraElenco($('#es-recenti'), r);
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
    await ldb.set('compiti', id, { id, testo, per, creato: Date.now(), voci });
    $('#compiti-testo').value = '';
    disegnaCompiti();
    toast(`Lista creata: ${voci.length} esercizi`);
  });
  $('#btn-compiti-pdf').onclick = () => {
    const testo = $('#compiti-testo').value.trim();
    const voci = leggiRichiesta(testo);
    if (!voci.length) { toast('Scrivi per esempio: p. 546 es. 12, 15, 20'); return; }
    apriPdfCompiti(voci, testo, $('#compiti-data').value || null);
  };
  on('stato-esercizi', disegnaCompiti);
  on('libro-cambiato', disegnaCompiti);
  disegnaCompiti();
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

async function disegnaCompiti() {
  const liste = (await ldb.all('compiti')).map(([, v]) => v).sort((a, b) => b.creato - a.creato);
  const box = $('#compiti-liste');
  if (!liste.length) { box.replaceChildren(el('p', { class: 'vuoto' }, 'Nessuna lista. Scrivi i compiti qui sopra.')); return; }
  const blocchi = [];
  for (const l of liste) {
    let fatti = 0;
    for (const v of l.voci) if ((await ldb.get('stato', chiave(v.p, v.es)))?.fatto) fatti++;
    const griglia = el('div', { class: 'griglia-tessere' });
    mostraElenco(griglia, l.voci);
    const data = l.per ? new Date(l.per + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }) : null;
    blocchi.push(el('section', { class: 'card' },
      el('div', { class: 'card-testa' },
        el('div', {}, el('h3', {}, l.testo), el('p', { class: 'nota' }, `${data ? 'Per ' + data : 'Senza data'} · ${fatti}/${l.voci.length} fatti`)),
        el('div', { class: 'riga-bottoni sinistra', style: { margin: 0, flexWrap: 'nowrap' } },
        el('button', { class: 'btn piccolo', onclick: () => apriPdfCompiti(l.voci, l.testo, l.per) }, '📄 PDF'),
        el('button', { class: 'btn-icona', 'aria-label': 'Elimina lista', onclick: async () => {
          if (await conferma('Eliminare questa lista di compiti? (gli esercizi restano segnati come fatti)', { si: 'Elimina', pericolo: true })) {
            await ldb.del('compiti', l.id); disegnaCompiti();
          }
        } }, '🗑'))),
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
  on('vista-mostrata', v => { if (v === 'progressi') disegnaProgressi(); });
}

async function disegnaProgressi() {
  await caricaIndici();
  const stati = new Map(await ldb.all('stato'));
  const perUnita = new Map();
  const conta = n => { if (!perUnita.has(n)) perUnita.set(n, { tot: 0, fatti: 0, diff: 0 }); return perUnita.get(n); };
  const indicizzati = tuttiGliEsercizi();
  for (const v of indicizzati) conta(v.u).tot++;
  for (const [k, s] of stati) {
    const p = Number(k.split('-')[0]);
    const x = conta(unitaDiPagina(p)?.n ?? 0);
    if (s.fatto) x.fatti++;
    if (s.difficile) x.diff++;
  }
  let totFatti = 0, tot = 0;
  const unita = UNITA.length ? UNITA : [{ n: 0, titolo: 'Tutto il libro', esercizi: LIBRO.primaPaginaLibro }];
  const righe = unita.map(u => {
    const x = perUnita.get(u.n) || { tot: 0, fatti: 0, diff: 0 };
    totFatti += x.fatti; tot += x.tot;
    const perc = x.tot ? Math.round(100 * x.fatti / x.tot) : 0;
    return el('button', { class: 'riga-unita', onclick: () => emit('vai-pagina', { pdf: libroToPdf(u.esercizi || u.inizio) }) },
      el('span', { class: 'u-num' }, u.n || '📘'),
      el('span', { class: 'u-nome' }, u.titolo, el('small', {}, (x.tot ? `${x.fatti} fatti su ${x.tot}` : `${x.fatti} fatti`) + (x.diff ? ` · ${x.diff} difficili` : ''))),
      el('span', { class: 'barra-progresso piccola' }, el('div', { style: { width: `${perc}%` } })),
      el('span', { class: 'u-perc' }, x.tot ? `${perc}%` : ''));
  });
  $('#progressi-totale').textContent = tot ? `${totFatti} esercizi fatti su ${tot}` : `${totFatti} esercizi fatti`;
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
