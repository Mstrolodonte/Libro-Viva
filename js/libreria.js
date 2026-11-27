// =====================================================================
//  libreria.js — La LIBRERIA: scegli il libro, aggiungine di nuovi,
//  vedi le sezioni del libro aperto, cambia le impostazioni del libro.
//
//  Quando aggiungi un libro, l'app prova a capire da sola:
//   - la differenza fra pagine del PDF e pagine stampate (offset);
//   - i capitoli (dall'indice del PDF, oppure leggendo le intestazioni
//     "Unità 3", "Capitolo 3", "Unit 3" … in cima alle pagine).
// =====================================================================
import { $, el, toast, apriScheda, conferma, scegliFile, icona } from './ui.js';
import { db } from './db.js';
import { stato, on, emit, elencoLibri, salvaLibroDef, eliminaLibro, apriLibro, leggiUltimaPagina, salvaPdf } from './stato.js';
import { LIBRO, UNITA, LIBRO_VUOTO, libroToPdf, etichettaPagina, fineUnita } from './config.js';
import { testoPagina } from './pdf.js';
import { progressiPerUnita, barraProgresso } from './viste.js';
import { elencoClassi, classeScelta, apriSceltaClasse, serveSceltaClasse } from './classi.js';

const MATERIE = ['Matematica', 'Italiano', 'Inglese', 'Fisica', 'Storia', 'Geografia', 'Scienze', 'Chimica',
  'Informatica', 'Tecnologia', 'Disegno', 'Diritto', 'Religione', 'Altro'];
const COLORI = ['#1f5fd6', '#d6452f', '#1e9e4a', '#8a3fd1', '#d98a1f', '#0f8f9c', '#c2367a', '#5a6b80'];

// ---------------------------------------------------------------------
//  Copertine (immagine della prima pagina, salvata una volta)
// ---------------------------------------------------------------------
const urlCopertine = new Map();
async function copertina(id) {
  if (urlCopertine.has(id)) return urlCopertine.get(id);
  const blob = await db.get('kv', `${id}:copertina`);
  const url = blob ? URL.createObjectURL(blob) : null;
  if (url) urlCopertine.set(id, url);
  return url;
}

/** Crea la copertina del libro aperto (pagina 1 del PDF) */
export async function creaCopertina() {
  if (!stato.libro) return;
  const page = await stato.libro.getPage(1);
  const vp0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: 360 / vp0.width });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
  if (!blob) return;
  await db.set('kv', `${stato.idLibro}:copertina`, blob);
  urlCopertine.delete(stato.idLibro);
}

// ---------------------------------------------------------------------
//  SCHERMATA LIBRERIA
// ---------------------------------------------------------------------
let sceltaChiesta = false;
export async function disegnaLibreria() {
  const classi = await elencoClassi();
  const classe = await classeScelta();
  // prima volta (o classe cancellata): scegli la tua classe
  if (!sceltaChiesta && await serveSceltaClasse()) {
    sceltaChiesta = true;
    apriSceltaClasse({ obbligatoria: true });
  }
  let libri = (await elencoLibri()).filter(l => !l.nascosto);
  if (classe) libri = libri.filter(l => classe.libri.includes(l.id));
  const box = $('#libreria-contenuto');
  const pezzi = [];
  if (classi.length) {
    pezzi.push(el('button', { class: 'chip-classe', onclick: () => apriSceltaClasse() },
      el('span', {}, '📁'), el('b', {}, classe ? `Classe ${classe.nome}` : 'Tutti i libri'), el('small', {}, 'Cambia')));
  }
  if (classe && !libri.length) pezzi.push(el('p', { class: 'vuoto' }, `La classe ${classe.nome} non ha ancora libri. L'admin li sceglie in Altro → Admin → Classi.`));

  const griglia = el('div', { class: 'griglia-libri' });
  for (const l of libri) {
    const img = await copertina(l.id);
    const haPdf = !!(await db.get('file', `${l.id}:libro`).then(r => r && r.info));
    griglia.append(el('button', { class: 'libro-card', onclick: () => entraNelLibro(l.id) },
      img ? el('div', { class: 'copertina', style: { background: `#fff url("${img}") center/cover` } })
        : el('div', { class: 'copertina finta', style: { '--colore-libro': l.colore } },
          el('span', { class: 'finta-materia' }, l.materia || 'Libro'), el('span', { class: 'finta-titolo' }, l.titolo)),
      el('div', { class: 'libro-info' },
        el('b', {}, l.materia || 'Libro'),
        el('small', {}, l.titolo),
        haPdf ? '' : el('small', { class: 'da-importare' }, '📂 PDF da importare'))));
  }
  griglia.append(el('button', { class: 'libro-card aggiungi', onclick: aggiungiLibro },
    el('div', { class: 'copertina' }, el('span', {}, '＋')),
    el('div', { class: 'libro-info' }, el('b', {}, 'Aggiungi libro'), el('small', {}, 'Italiano, inglese, fisica…'))));
  pezzi.push(griglia);

  const nascosti = (await elencoLibri()).filter(l => l.nascosto);
  if (nascosti.length) {
    pezzi.push(el('p', { class: 'nota' }, 'Libri nascosti: ', ...nascosti.map(l =>
      el('button', { class: 'btn piccolo', onclick: async () => { await salvaLibroDef({ ...l, nascosto: false }); disegnaLibreria(); } }, `Mostra ${l.materia || l.titolo}`))));
  }
  box.replaceChildren(...pezzi);
}

/** Apre un libro e mostra le sue sezioni (o la pagina, con leggi:true) */
export async function entraNelLibro(id, { leggi = false } = {}) {
  try {
    const c = await apriLibro(id);
    try { localStorage.setItem('libroVivo.libroAperto', id); } catch (e) { /* */ }
    // copertina mancante (es. libro importato con la versione 1.0): la creo ora
    if (c && !(await db.get('kv', `${id}:copertina`))) creaCopertina().catch(() => {});
    emit('mostra-vista', leggi && c ? 'libro' : 'home');
    if (leggi && c) {
      const u = await leggiUltimaPagina();
      emit('vai-pagina', { pdf: u?.pdf || libroToPdf(LIBRO.primaPaginaLibro), scrollTop: u?.scrollTop, zoom: u?.zoom });
    }
  } catch (e) {
    console.error(e);
    toast('Non riesco ad aprire il libro: ' + e.message);
  }
}

// ---------------------------------------------------------------------
//  SEZIONI DEL LIBRO (home del libro)
// ---------------------------------------------------------------------
export async function disegnaHomeLibro() {
  const box = $('#home-contenuto');
  const img = await copertina(stato.idLibro);
  const ultima = await leggiUltimaPagina();
  const tessera = (nomeIcona, titolo, sotto, azione, classe = '') =>
    el('button', { class: 'sezione ' + classe, onclick: azione }, icona(nomeIcona, 'sezione-icona'), el('b', {}, titolo), sotto ? el('small', {}, sotto) : '');

  const testa = el('div', { class: 'home-testa' },
    el('div', { class: 'copertina piccola', style: { background: img ? `#fff url("${img}") center/cover` : LIBRO.colore } }),
    el('div', {}, el('p', { class: 'nota' }, LIBRO.materia || 'Libro'), el('h1', {}, LIBRO.titolo), LIBRO.autori ? el('p', { class: 'nota' }, LIBRO.autori) : ''));

  const sezioni = el('div', { class: 'griglia-sezioni' });
  if (!stato.libro) {
    sezioni.append(tessera('cartella', 'Importa il PDF del libro', 'Una volta sola, dal disco del modem', () => emit('importa-libro'), 'evidenzia'));
  } else {
    sezioni.append(tessera('leggi', ultima ? 'Continua a leggere' : 'Inizia a leggere', ultima ? etichettaPagina(ultima.pdf).replace(/^(\d+)$/, 'p. $1') : '',
      () => emit('vai-pagina', { pdf: ultima?.pdf || libroToPdf(LIBRO.primaPaginaLibro), scrollTop: ultima?.scrollTop }), 'evidenzia'));
  }
  sezioni.append(
    tessera('esercizi', 'Esercizi e compiti', 'Tutti insieme, PDF con i quadretti', () => emit('mostra-vista', 'esercizi')),
    tessera('altro', 'Impostazioni libro', 'Capitoli, pagine, file', () => apriImpostazioniLibro()));

  // capitoli
  const capitoli = el('div', { class: 'card lista-unita' });
  if (!UNITA.length) {
    capitoli.append(el('p', { class: 'vuoto' }, 'Nessun capitolo. ', el('button', { class: 'btn piccolo', onclick: () => apriImpostazioniLibro() }, 'Aggiungili')));
  }
  const prog = stato.libro ? await progressiPerUnita().catch(() => new Map()) : new Map();
  for (const u of UNITA) {
    const fine = fineUnita(u);
    const vai = p => () => emit('vai-pagina', { pdf: libroToPdf(p) });
    capitoli.append(el('div', { class: 'riga-capitolo' },
      el('button', { class: 'cap-principale', onclick: vai(u.inizio) },
        el('span', { class: 'u-num' }, u.n), el('span', { class: 'u-nome' }, u.titolo, el('small', {}, `pp. ${u.inizio}–${fine}`), barraProgresso(prog.get(u.n)))),
      el('div', { class: 'cap-link' },
        u.esercizi ? el('button', { onclick: vai(u.esercizi) }, `Esercizi p. ${u.esercizi}`) : '',
        u.autoverifica ? el('button', { onclick: vai(u.autoverifica) }, `Autoverifica p. ${u.autoverifica}`) : '')));
  }
  if (LIBRO.u18) capitoli.append(el('div', { class: 'riga-capitolo' }, el('button', { class: 'cap-principale', onclick: () => emit('vai-pagina', { pdf: LIBRO.u18.primaPdf }) },
    el('span', { class: 'u-num' }, 18), el('span', { class: 'u-nome' }, LIBRO.u18.titolo, el('small', {}, `1/${LIBRO.u18.pagine}–${LIBRO.u18.pagine}/${LIBRO.u18.pagine}`)))));

  box.replaceChildren(testa, sezioni, el('h2', {}, 'Capitoli'), capitoli);
}

// ---------------------------------------------------------------------
//  AGGIUNGI UN LIBRO
// ---------------------------------------------------------------------
async function aggiungiLibro() {
  const s = apriScheda('➕ Aggiungi un libro');
  const materia = el('select', { class: 'campo' }, ...MATERIE.map(m => el('option', { value: m }, m)));
  materia.value = 'Italiano';
  const titolo = el('input', { class: 'campo', placeholder: 'es. Il nuovo Grammatica attiva' });
  const avanti = el('button', { class: 'btn primario grande' }, '📂 Scegli il PDF e aggiungi');
  s.corpo.append(
    el('label', { class: 'etichetta' }, 'Materia', materia),
    el('label', { class: 'etichetta' }, 'Titolo del libro', titolo),
    el('p', { class: 'nota' }, 'Poi scegli il PDF dal disco del modem (app File). L\'app lo copia sull\'iPad e prova a capire da sola capitoli e numeri di pagina.'),
    el('div', { class: 'riga-bottoni' }, avanti));

  avanti.onclick = async () => {
    const [file] = await scegliFile({ accept: '.pdf,application/pdf' });
    if (!file) return;
    const libri = await elencoLibri();
    const base = (materia.value || 'libro').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '').slice(0, 10) || 'libro';
    const id = `${base}${Date.now().toString(36).slice(-4)}`;
    const def = {
      ...LIBRO_VUOTO, id,
      materia: materia.value === 'Altro' ? '' : materia.value,
      titolo: titolo.value.trim() || file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '),
      colore: COLORI[libri.length % COLORI.length],
      nomeFile: file.name,
    };
    await salvaLibroDef(def);
    s.chiudi();
    await importaEAnalizza(id, file);
  };
}

/** Copia il PDF, poi cerca offset e capitoli, e mostra il risultato */
async function importaEAnalizza(id, file) {
  const s = apriScheda('Preparo il libro…');
  const msg = el('p', {}, 'Copio il PDF sull\'iPad…');
  s.corpo.append(msg);
  try {
    await apriLibro(id);
    await salvaPdf('libro', file, { nome: file.name, origine: 'disco', modificato: file.lastModified });
    if (!stato.libro) throw new Error('il PDF non si apre');
    msg.textContent = 'Creo la copertina…';
    await creaCopertina().catch(() => {});
    msg.textContent = 'Cerco i numeri di pagina…';
    const offset = await rilevaOffset(stato.libro);
    msg.textContent = 'Cerco i capitoli…';
    let capitoli = await capitoliDaIndicePdf(stato.libro, offset);
    let annulla = false;
    if (!capitoli.length) {
      const stop = el('button', { class: 'btn piccolo', onclick: () => { annulla = true; } }, 'Salta');
      s.corpo.append(stop);
      capitoli = await capitoliDalleIntestazioni(stato.libro, offset, (n, tot) => { msg.textContent = `Leggo le pagine per trovare i capitoli… ${n}/${tot}`; }, () => annulla);
      stop.remove();
    }
    const def = (await elencoLibri()).find(l => l.id === id);
    await salvaLibroDef({ ...def, offset, unita: capitoli, ultimaPaginaLibro: stato.totalePagine - offset, primaPaginaLibro: Math.max(1, 1 - offset) });
    s.chiudi();
    const r = apriScheda('✅ Libro aggiunto');
    r.corpo.append(
      el('p', {}, `Pagine: ${stato.totalePagine}. `, offset ? `La pagina stampata è la pagina del PDF ${offset > 0 ? '−' : '+'} ${Math.abs(offset)}.` : 'Le pagine stampate coincidono con quelle del PDF.'),
      el('p', {}, capitoli.length ? `Ho trovato ${capitoli.length} capitoli:` : 'Non ho trovato i capitoli: puoi aggiungerli tu.'),
      capitoli.length ? el('ul', { class: 'elenco-corto' }, ...capitoli.slice(0, 30).map(c => el('li', {}, `${c.titolo} — p. ${c.inizio}`))) : '',
      el('p', { class: 'nota' }, 'Se qualcosa non torna, correggilo in Impostazioni libro.'),
      el('div', { class: 'riga-bottoni' },
        el('button', { class: 'btn', onclick: () => { r.chiudi(); apriImpostazioniLibro(); } }, '✏️ Correggi'),
        el('button', { class: 'btn primario', onclick: () => r.chiudi() }, 'Va bene')));
    emit('mostra-vista', 'home');
  } catch (e) {
    console.error(e);
    msg.textContent = '❌ ' + e.message;
  }
}

/**
 * Differenza fra pagina PDF e pagina stampata.
 * 1) etichette di pagina del PDF, se ci sono;
 * 2) altrimenti cerco il numero di pagina in alto o in basso su varie pagine.
 */
export async function rilevaOffset(doc) {
  const voti = new Map();
  const vota = d => voti.set(d, (voti.get(d) || 0) + 1);
  try {
    const etichette = await doc.getPageLabels();
    if (etichette) etichette.forEach((e, i) => { if (/^\d+$/.test(e)) vota(i + 1 - Number(e)); });
  } catch (e) { /* */ }
  if (!voti.size) {
    const n = doc.numPages;
    const passo = Math.max(1, Math.floor(Math.min(n, 120) / 24));
    for (let pdf = Math.min(6, n); pdf <= Math.min(n, 120); pdf += passo) {
      let pezzi;
      try { pezzi = await testoPagina(doc, pdf); } catch (e) { continue; }
      const H = Math.max(...pezzi.map(t => t.y + t.h), 700);
      for (const t of pezzi) {
        const v = t.str.trim();
        if (/^\d{1,4}$/.test(v) && (t.y < 60 || t.y > H - 70)) {
          const d = pdf - Number(v);
          if (d > -5 && d < 60) vota(d);
        }
      }
    }
  }
  let migliore = 0, max = 0;
  for (const [d, c] of voti) if (c > max) { max = c; migliore = d; }
  return max >= 3 ? migliore : 0;
}

/** Capitoli dal "segnalibro"/indice interno del PDF (se c'è) */
export async function capitoliDaIndicePdf(doc, offset) {
  let outline;
  try { outline = await doc.getOutline(); } catch (e) { return []; }
  if (!outline || !outline.length) return [];
  let etichette = null;
  try { etichette = await doc.getPageLabels(); } catch (e) { /* */ }
  let voci = outline;
  if (voci.length === 1 && voci[0].items?.length) voci = voci[0].items;   // un solo titolo "contenitore"

  // Pagina stampata di una voce del sommario (null se non ha pagina)
  const paginaDi = async v => {
    try {
      let dest = v.dest;
      if (typeof dest === 'string') dest = await doc.getDestination(dest);
      if (!dest) return null;
      const idx = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]);
      const et = etichette?.[idx];
      return et && /^\d+$/.test(et) ? Number(et) : idx + 1 - offset;   // l'etichetta del PDF vince
    } catch (e) { return null; }
  };

  const out = [];
  for (const v of voci) {
    const inizio = await paginaDi(v);
    if (inizio == null) continue;
    const c = { titolo: v.title.trim(), inizio, esercizi: null, autoverifica: null };
    // Sotto-voci "Esercizi" e "Prova di autoverifica" (come nel libro di matematica)
    for (const f of v.items || []) {
      const t = f.title.trim().toLowerCase();
      if (c.esercizi == null && /^esercizi\b|^exercises\b/.test(t)) c.esercizi = await paginaDi(f);
      else if (c.autoverifica == null && /autoverifica|verifica finale|self.?test/.test(t)) c.autoverifica = await paginaDi(f);
    }
    out.push(c);
  }
  out.sort((a, b) => a.inizio - b.inizio);
  return out.filter((c, i) => i === 0 || c.inizio !== out[i - 1].inizio).map((c, i) => ({ n: i + 1, ...c }));
}

/** Capitoli leggendo le intestazioni in cima alle pagine ("Unità 3", "Capitolo 3", "Unit 3"…) */
export async function capitoliDalleIntestazioni(doc, offset, avanzamento = () => {}, annullato = () => false) {
  const re = /\b(UNIT[ÀA]|Unit[àa]|CAPITOLO|Capitolo|UNIT|Unit|CHAPTER|Chapter|LEZIONE|Lezione|MODULO|Modulo|SEZIONE|Sezione)\s+(\d{1,2})\b/;
  const trovati = new Map();
  const n = doc.numPages;
  for (let pdf = 1; pdf <= n && !annullato(); pdf++) {
    if (pdf % 10 === 0) avanzamento(pdf, n);
    let pezzi;
    try { pezzi = await testoPagina(doc, pdf); } catch (e) { continue; }
    const alto = pezzi.filter(t => t.y < 90).map(t => t.str).join(' ');
    const m = alto.match(re);
    if (m && !trovati.has(Number(m[2]))) trovati.set(Number(m[2]), { pdf, parola: m[1] });
  }
  return [...trovati.entries()].sort((a, b) => a[1].pdf - b[1].pdf)
    .map(([num, { pdf, parola }], i) => ({ n: i + 1, titolo: `${parola[0].toUpperCase()}${parola.slice(1).toLowerCase()} ${num}`, inizio: pdf - offset, esercizi: null, autoverifica: null }));
}

// ---------------------------------------------------------------------
//  IMPOSTAZIONI DEL LIBRO (titolo, pagine, capitoli, togli)
// ---------------------------------------------------------------------
export async function apriImpostazioniLibro() {
  const def = (await elencoLibri()).find(l => l.id === stato.idLibro);
  const s = apriScheda('⚙️ Impostazioni libro', { larga: true });
  const materia = el('input', { class: 'campo', value: def.materia || '', list: 'lista-materie' });
  const titolo = el('input', { class: 'campo', value: def.titolo || '' });
  const offset = el('input', { class: 'campo', type: 'number', inputmode: 'numeric', value: def.offset || 0 });
  const esempio = el('p', { class: 'nota' });
  const aggEsempio = () => {
    const o = Number(offset.value) || 0;
    esempio.textContent = `Esempio: la pagina stampata 10 è la pagina ${10 + o} del PDF.`;
  };
  offset.oninput = aggEsempio; aggEsempio();
  const testoCap = (def.unita || []).map(u => [u.titolo, u.inizio, u.esercizi || '', u.autoverifica || ''].join(' | ').replace(/( \| )+$/, '')).join('\n');
  const capitoli = el('textarea', { class: 'campo', rows: 10, placeholder: 'Un capitolo per riga:\nTitolo | pagina inizio | pagina esercizi | pagina autoverifica\nes.  Il racconto | 12 | 40' }, testoCap);
  const esito = el('p', { class: 'nota' });

  const leggiCapitoli = () => capitoli.value.split('\n').map(r => r.trim()).filter(Boolean).map((r, i) => {
    const [t, a, b, c] = r.split('|').map(x => x.trim());
    return { n: i + 1, titolo: t || `Capitolo ${i + 1}`, inizio: Number(a) || 1, esercizi: Number(b) || null, autoverifica: Number(c) || null };
  }).sort((x, y) => x.inizio - y.inizio).map((u, i) => ({ ...u, n: i + 1 }));

  s.corpo.append(
    el('datalist', { id: 'lista-materie' }, ...MATERIE.map(m => el('option', { value: m }))),
    el('div', { class: 'riga-campi' }, el('label', { class: 'etichetta' }, 'Materia', materia), el('label', { class: 'etichetta' }, 'Titolo', titolo)),
    el('label', { class: 'etichetta' }, 'Pagine da aggiungere per passare da pagina stampata a pagina PDF', offset),
    esempio,
    el('label', { class: 'etichetta' }, 'Capitoli', capitoli),
    el('div', { class: 'riga-bottoni sinistra' },
      el('button', { class: 'btn', onclick: async () => {
        if (!stato.libro) { toast('Prima importa il PDF'); return; }
        esito.textContent = 'Cerco…';
        const o = Number(offset.value) || 0;
        let caps = await capitoliDaIndicePdf(stato.libro, o);
        if (!caps.length) caps = await capitoliDalleIntestazioni(stato.libro, o, (n, t) => { esito.textContent = `Leggo le pagine… ${n}/${t}`; });
        if (!caps.length) { esito.textContent = 'Non ho trovato capitoli: scrivili tu.'; return; }
        capitoli.value = caps.map(u => `${u.titolo} | ${u.inizio}`).join('\n');
        esito.textContent = `Trovati ${caps.length} capitoli. Controlla e salva.`;
      } }, '🔍 Trova capitoli automaticamente'),
      el('button', { class: 'btn', onclick: async () => {
        if (!stato.libro) { toast('Prima importa il PDF'); return; }
        esito.textContent = 'Cerco…';
        offset.value = await rilevaOffset(stato.libro); aggEsempio();
        esito.textContent = 'Fatto: controlla l\'esempio.';
      } }, '🔍 Trova numeri di pagina')),
    esito,
    el('div', { class: 'riga-bottoni' },
      el('button', { class: 'btn primario grande', onclick: async () => {
        const nuovo = { ...def, materia: materia.value.trim(), titolo: titolo.value.trim() || def.titolo, offset: Number(offset.value) || 0, unita: leggiCapitoli() };
        if (def.id !== 'mat' && stato.totalePagine) nuovo.ultimaPaginaLibro = stato.totalePagine - nuovo.offset;
        await salvaLibroDef(nuovo);
        s.chiudi();
        toast('Salvato');
        emit('libro-modificato');
      } }, '💾 Salva')),
    el('h3', {}, 'File del libro'),
    el('div', { class: 'riga-bottoni sinistra' },
      el('button', { class: 'btn', onclick: () => { s.chiudi(); emit('importa-libro'); } }, '📂 Importa / sostituisci PDF e soluzioni'),
      el('button', { class: 'btn', onclick: async () => { await creaCopertina(); toast('Copertina aggiornata'); } }, '🖼 Rifai copertina')),
    el('h3', {}, 'Togli dalla libreria'),
    el('div', { class: 'riga-bottoni sinistra' },
      el('button', { class: 'btn', onclick: async () => { await salvaLibroDef({ ...def, nascosto: true }); s.chiudi(); emit('mostra-vista', 'libreria'); } }, '🙈 Nascondi (tiene i dati)'),
      el('button', { class: 'btn pericolo', onclick: async () => {
        if (!await chiediCancellaLibro(def)) return;
        s.chiudi();
      } }, '🗑 Cancella il libro')));
}

on('libri-cambiati', () => { if ($('#vista-libreria')?.classList.contains('attiva')) disegnaLibreria(); });
on('classi-cambiate', () => { if ($('#vista-libreria')?.classList.contains('attiva')) disegnaLibreria(); });
on('libro-modificato', () => { if ($('#vista-home')?.classList.contains('attiva')) disegnaHomeLibro(); });

/** Cancella un libro da questo iPad (con conferma). true se cancellato */
export async function chiediCancellaLibro(def) {
  const nome = `${def.materia ? def.materia + ' · ' : ''}${def.titolo}`;
  if (!await conferma(`⚠️ Cancellare "${nome}" da questo iPad? Si cancellano il PDF, le soluzioni, i disegni, gli appunti e i progressi di questo libro. Non si può tornare indietro.`, { si: 'Cancella il libro', pericolo: true })) return false;
  await eliminaLibro(def.id);
  toast('Libro cancellato');
  if (document.body.dataset.vista !== 'libreria') emit('mostra-vista', 'libreria');
  return true;
}
