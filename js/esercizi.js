// =====================================================================
//  esercizi.js — Trovare un esercizio e mostrarlo in una "scheda".
//
//  ALGORITMO DI RICERCA (pagina stampata + numero):
//   1. guardo la pagina scritta (pagina del LIBRO, non del PDF);
//   2. se non c'è, vado avanti e indietro: +1, −1, +2, −2 … fino a ±5;
//   3. se ancora non c'è, allargo di 5 in 5 (±10, ±15 …) fino a ±40.
//  Per ogni pagina uso l'indice già pronto (data/indice_esercizi.json).
//  Se una pagina non è nell'indice, leggo il testo della pagina con pdf.js.
// =====================================================================
import { el, toast, apriScheda } from './ui.js';
import { db, ldb } from './db.js';
import { stato, apriSvolti, emit, on } from './stato.js';
import { ritaglio, tagliaBiancoInFondo, testoPagina } from './pdf.js';
import { LIBRO, RICERCA, libroToPdf, UNITA, unitaDiPdf } from './config.js';

// ---------------------------------------------------------------------
//  Indici
// ---------------------------------------------------------------------
const indice = {
  perPagina: new Map(),    // pagina libro -> [voce, …]
  perChiave: new Map(),    // "546-12" -> voce
  soluzioni: new Map(),    // "546-12" -> { u, da:[pag,y], a:[pag,y] }
  infoSvolti: {},          // u -> { file, altezza }
  pronto: false,
};

export const chiave = (p, es) => `${p}-${es}`;

/** Carica gli indici: prima quelli dell'admin (se ci sono), poi quelli dell'app */
export async function caricaIndici() {
  const perLibro = stato.idLibro;
  const vuoto = { esercizi: [] }, vuotoSol = { unita: {} };
  const custom = await ldb.get('kv', 'indiceEsercizi');
  const es = custom || (LIBRO.indiciApp ? await fetch('data/indice_esercizi.json').then(r => r.json()) : vuoto);
  const customSol = await ldb.get('kv', 'indiceSoluzioni');
  const sol = customSol || (LIBRO.indiciApp ? await fetch('data/indice_soluzioni.json').then(r => r.json()) : vuotoSol);
  if (perLibro !== stato.idLibro) return;   // nel frattempo è cambiato libro
  indice.infoSvolti = {};

  indice.perPagina.clear(); indice.perChiave.clear(); indice.soluzioni.clear();
  for (const v of es.esercizi) {
    if (!indice.perPagina.has(v.p)) indice.perPagina.set(v.p, []);
    indice.perPagina.get(v.p).push(v);
    indice.perChiave.set(chiave(v.p, v.es), v);
  }
  for (const [u, info] of Object.entries(sol.unita)) {
    indice.infoSvolti[u] = { file: info.file, altezza: info.altezza };
    for (const s of info.soluzioni) indice.soluzioni.set(chiave(s.p, s.es), { u: Number(u), ...s });
  }
  indice.pronto = true;
  indice.libro = perLibro;
}

// quando cambio libro, gli indici vanno ricaricati
on('libro-cambiato', () => { indice.pronto = false; indice.perPagina.clear(); indice.perChiave.clear(); indice.soluzioni.clear(); caricaIndici().catch(console.error); });

/** Tutti gli esercizi dell'indice (per i progressi) */
export const tuttiGliEsercizi = () => [...indice.perChiave.values()];
export const haSoluzioneSvolta = (p, es) => indice.soluzioni.has(chiave(p, es));
export const nomeFileSvolti = u => indice.infoSvolti[u]?.file;

// ---------------------------------------------------------------------
//  Ricerca
// ---------------------------------------------------------------------

/** Ordine delle pagine da guardare: p, p+1, p-1, p+2, p-2, … */
export function ordinePagine(p, passo = RICERCA.passo, massimo = RICERCA.massimo) {
  const out = [p];
  for (let d = 1; d <= massimo; d++) out.push(p + d, p - d);
  return out.filter(x => x >= LIBRO.primaPaginaLibro && x <= LIBRO.ultimaPaginaLibro)
    .map(x => ({ p: x, giro: Math.ceil(Math.abs(x - p) / passo) }));
}

/**
 * Cerca l'esercizio `es` partendo dalla pagina stampata `p`.
 * Restituisce { voce, cercata, trovata } oppure null.
 */
export async function cercaEsercizio(p, es) {
  if (!indice.pronto || indice.libro !== stato.idLibro) await caricaIndici();
  for (const { p: pag } of ordinePagine(p)) {
    const voci = indice.perPagina.get(pag);
    if (voci) {
      const v = voci.find(x => x.es === es);
      if (v) return { voce: v, cercata: p, trovata: pag };
    } else if (stato.libro) {
      // pagina non indicizzata: leggo il testo
      const v = await cercaNelTesto(pag, es);
      if (v) return { voce: v, cercata: p, trovata: pag };
    }
  }
  return null;
}

/** Ricerca "di riserva" nel testo della pagina */
async function cercaNelTesto(pag, es) {
  const pdf = libroToPdf(pag);
  if (pdf > stato.totalePagine) return null;
  const pezzi = await testoPagina(stato.libro, pdf);
  const n = String(es);
  // il numero deve essere da solo e il primo pezzo della sua riga
  const cand = pezzi.filter(t => t.str.trim() === n &&
    !pezzi.some(o => o !== t && Math.abs(o.y - t.y) < 2 && o.x < t.x && t.x - o.x < 40 && o.str.trim()));
  if (!cand.length) return null;
  const t = cand[0];
  const page = await stato.libro.getPage(pdf);
  const [, , W, H] = page.view;
  const sinistra = t.x < W / 2 - 10;
  // fine: il numero dell'esercizio successivo nella stessa colonna (se c'è)
  const dopo = pezzi.filter(o => o.str.trim() === String(es + 1) && o.y > t.y + 4 && Math.abs(o.x - t.x) < 30).sort((a, b) => a.y - b.y)[0];
  const fine = dopo ? dopo.y - 4 : Math.min(H - 36, t.y + 160);
  return {
    p: pag, es, pdf, u: unitaDiPdf(pdf)?.n,
    b: [sinistra ? 30 : t.x - 8, Math.max(10, t.y - 5), W - 22, fine],
    stimato: true,
  };
}

// ---------------------------------------------------------------------
//  Stato di un esercizio: fatto ✅ / difficile ⚠️ / preferito ⭐
// ---------------------------------------------------------------------
export async function leggiStato(p, es) {
  return (await ldb.get('stato', chiave(p, es))) || {};
}
export async function cambiaStato(p, es, campo, valore) {
  const s = await leggiStato(p, es);
  s[campo] = valore;
  s.agg = Date.now();
  await ldb.set('stato', chiave(p, es), s);
  emit('stato-esercizi', { p, es });
  return s;
}

// ---------------------------------------------------------------------
//  Scheda esercizio
// ---------------------------------------------------------------------

/** Apre la scheda di un esercizio: cerca, ritaglia, mostra */
export async function apriEsercizio(p, es) {
  if (!stato.libro) { toast('Prima importa il libro (Altro → Libro)'); return; }
  const ris = await cercaEsercizio(p, es);
  if (!ris) {
    const s = apriScheda(`p. ${p} · es. ${es}`);
    s.corpo.append(el('p', { class: 'avviso' },
      `Non ho trovato l'esercizio ${es} vicino a pagina ${p} (ho cercato fino a ±${RICERCA.massimo} pagine). Controlla il numero.`));
    return;
  }
  return mostraScheda(ris);
}

async function mostraScheda(ris) {
  const s = apriScheda(`p. ${ris.voce.p} · es. ${ris.voce.es}`, { larga: true });
  s.corpo.append(await contenutoEsercizio(ris, { alVaiPagina: () => s.chiudi() }));
}

/**
 * Contenuto di un esercizio: ritaglio + Fatto/Difficile/Preferito +
 * Vai alla pagina + Mostra soluzione. Serve sia per la scheda sia per
 * l'elenco "tutti gli esercizi insieme".
 * ris = { voce, cercata, trovata } (da cercaEsercizio)
 */
export async function contenutoEsercizio({ voce, cercata, trovata }, { alVaiPagina = () => {}, larghezza } = {}) {
  const { p, es } = voce;
  const c = el('div', { class: 'contenuto-esercizio' });

  if (trovata !== cercata) {
    c.append(el('p', { class: 'nota' }, `ℹ️ A pagina ${cercata} non c'era: l'ho trovato a pagina ${trovata}.`));
  }
  if (voce.stimato) c.append(el('p', { class: 'nota' }, 'Ritaglio approssimato (pagina non indicizzata).'));

  // ritaglio dell'esercizio (+ consegna sopra, se c'è) ad alta risoluzione
  const box = el('div', { class: 'ritaglio' }, el('div', { class: 'carica' }, 'Carico…'));
  c.append(box);
  // nell'elenco: non più di 1,7 volte la grandezza del libro (testo leggibile ma non enorme)
  const larg = larghezza ? Math.min(larghezza, (voce.b[2] - voce.b[0]) * 1.7) : Math.min(900, window.innerWidth - 60);
  const pronto = (async () => {
    const pezzi = [];
    if (voce.c && voce.c[3] <= voce.b[1] + 2) {
      const lc = larg * (voce.c[2] - voce.c[0]) / (voce.b[2] - voce.b[0]);
      const cc = await ritaglio(stato.libro, voce.pdf, voce.c, lc);
      cc.style.width = larghezza ? `${lc}px` : `${Math.min(100, 100 * (voce.c[2] - voce.c[0]) / (voce.b[2] - voce.b[0]))}%`;
      cc.style.maxWidth = '100%';
      cc.classList.add('consegna');
      pezzi.push(cc);
    }
    const cb = await ritaglio(stato.libro, voce.pdf, voce.b, larg);
    if (larghezza) { cb.style.width = `${larg}px`; cb.style.maxWidth = '100%'; }
    pezzi.push(cb);
    box.replaceChildren(...pezzi);
  })().catch(e => { box.textContent = 'Errore nel ritaglio: ' + e.message; });

  // bottoni stato
  const st = await leggiStato(p, es);
  const bottoneStato = (campo, testo) => {
    const b = el('button', { class: 'btn chip' + (st[campo] ? ' attivo' : '') }, testo);
    b.onclick = async () => {
      st[campo] = !st[campo];
      await cambiaStato(p, es, campo, st[campo]);
      b.classList.toggle('attivo', st[campo]);
    };
    return b;
  };
  const zonaSol = el('div', { class: 'zona-soluzione' });
  const btnSol = el('button', { class: 'btn primario' }, '💡 Mostra soluzione esercizio');
  btnSol.onclick = () => { btnSol.hidden = true; mostraSoluzione(voce, zonaSol); };

  c.append(
    el('div', { class: 'riga-bottoni sinistra' },
      bottoneStato('fatto', '✅ Fatto'),
      bottoneStato('difficile', '⚠️ Difficile'),
      bottoneStato('preferito', '⭐ Preferito'),
      el('button', { class: 'btn chip', onclick: () => { alVaiPagina(); emit('vai-pagina', { pdf: voce.pdf, evidenzia: voce.b }); } }, '📖 Vai alla pagina'),
      btnSol),
    zonaSol);
  c.pronto = pronto;
  return c;
}

// ---------------------------------------------------------------------
//  Soluzione
//  1) se l'admin ha caricato una soluzione JSON -> passi uno alla volta
//  2) altrimenti ritaglio dal PDF "SVOLTI" dell'unità, pagine "avvicinate"
// ---------------------------------------------------------------------
async function mostraSoluzione(voce, zona) {
  zona.replaceChildren(el('div', { class: 'carica' }, 'Cerco la soluzione…'));
  const { p, es } = voce;
  const info = indice.soluzioni.get(chiave(p, es));
  const json = await ldb.get('soluzioni', chiave(p, es));

  if (json) {
    soluzioneAPassi(json, zona);
    // c'è anche lo svolgimento in PDF? (utile per le figure)
    if (info) {
      const zonaPdf = el('div');
      const b = el('button', { class: 'btn' }, json.figura ? '📐 Mostra lo svolgimento con la figura (PDF)' : '📄 Mostra lo svolgimento in PDF');
      b.onclick = () => { b.remove(); soluzioneDaPdf(info, zonaPdf); };
      zona.append(el('div', { class: 'riga-bottoni sinistra' }, b), zonaPdf);
    }
    return;
  }
  if (!info) {
    zona.replaceChildren(el('p', { class: 'avviso' },
      'Questo esercizio non è negli svolti. Di solito è un esercizio svolto o guidato direttamente nel libro, oppure è dell\'autoverifica (risposte a p. 910–917).'));
    return;
  }
  zona.replaceChildren();
  return soluzioneDaPdf(info, zona);
}

/** Ritaglia la soluzione dal PDF "SVOLTI" e mette le pagine una sotto l'altra */
async function soluzioneDaPdf(info, zona) {
  zona.replaceChildren(el('div', { class: 'carica' }, 'Ritaglio la soluzione…'));
  const doc = await apriSvolti(info.u);
  if (!doc) {
    zona.replaceChildren(el('p', { class: 'avviso' },
      `Per vedere la soluzione importa il file delle soluzioni dell'unità ${info.u}`,
      nomeFileSvolti(info.u) ? ` (${nomeFileSvolti(info.u).replace('.pdf', '.json')} oppure ${nomeFileSvolti(info.u)})` : '',
      ' da Altro → Importa dal disco.'));
    return;
  }
  const larg = Math.min(900, window.innerWidth - 60);
  const pezzi = [];
  for (let pg = info.da[0]; pg <= info.a[0]; pg++) {
    const page = await doc.getPage(pg);
    const [, , W, H] = page.view;
    const y0 = pg === info.da[0] ? info.da[1] : 28;
    const y1 = pg === info.a[0] ? info.a[1] : H - 28;
    if (y1 - y0 < 6) continue;
    pezzi.push(tagliaBiancoInFondo(await ritaglio(doc, pg, [18, y0, W - 18, y1], larg)));
  }
  zona.replaceChildren(el('h3', {}, 'Svolgimento (PDF)'), el('div', { class: 'ritaglio soluzione' }, ...pezzi));
}

/**
 * Trasforma il testo di un passo in HTML:
 *  $…$  -> formula (KaTeX)      **…** -> grassetto
 */
export function testoConFormule(testo) {
  const sicuro = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pezzi = String(testo ?? '').split(/(\$\$[^$]+\$\$|\$[^$]+\$)/g);
  return pezzi.map(x => {
    const blocco = x.startsWith('$$') && x.endsWith('$$') && x.length > 4;
    if (blocco || (x.startsWith('$') && x.endsWith('$') && x.length > 2)) {
      const tex = blocco ? x.slice(2, -2) : x.slice(1, -1);
      try { return window.katex.renderToString(tex, { throwOnError: false, displayMode: blocco }); }
      catch (e) { return sicuro(x); }
    }
    return sicuro(x).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }).join('');
}

/** Soluzione JSON: { pagina, es, testo, risultato, passi: [] } mostrata un passo alla volta */
function soluzioneAPassi(sol, zona) {
  const passi = sol.passi || [];
  const lista = el('ol', { class: 'passi' });
  let mostrati = 0;
  const risultato = el('p', { class: 'risultato', hidden: true, html: '<b>Risultato:</b> ' + testoConFormule(sol.risultato || '') });
  const btnPasso = el('button', { class: 'btn primario' }, '➡️ Passo successivo');
  const btnTutto = el('button', { class: 'btn' }, 'Mostra tutto');
  const contatore = el('span', { class: 'nota' });
  const avanti = (tutti) => {
    const fino = tutti ? passi.length : mostrati + 1;
    while (mostrati < fino && mostrati < passi.length) {
      const li = el('li', { html: testoConFormule(passi[mostrati++]) });
      lista.append(li);
      li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    contatore.textContent = `${mostrati}/${passi.length}`;
    if (mostrati >= passi.length) { risultato.hidden = false; btnPasso.hidden = true; btnTutto.hidden = true; contatore.hidden = true; }
  };
  btnPasso.onclick = () => avanti(false);
  btnTutto.onclick = () => avanti(true);
  zona.replaceChildren(
    el('h3', {}, 'Soluzione'),
    lista, risultato,
    el('div', { class: 'riga-bottoni sinistra' }, btnPasso, btnTutto, contatore));
  avanti(false);   // il primo passo si vede subito
}

// ---------------------------------------------------------------------
//  Lettura di una richiesta tipo "p. 546 es. 12, 15, 20-22; p. 547 es. 3"
// ---------------------------------------------------------------------
export function leggiRichiesta(testo) {
  // Accetta: "p. 546 es. 12, 15, 20-22; p. 547 es. 3", "pag 546 n 12 e 15",
  // "546 12 15", "546/12", una pagina per riga…
  // Regola: in ogni gruppo il PRIMO numero è la pagina, gli altri sono esercizi.
  const out = [];
  const t = String(testo).toLowerCase().replace(/[–—]/g, '-');
  const gruppi = t.split(/[;\n]+|(?=\bp(?:ag(?:ina)?|g)?\.?\s*\d)/);
  for (const g of gruppi) {
    const numeri = [...g.matchAll(/(\d+)(?:\s*-\s*(\d+))?/g)];
    if (numeri.length < 2) continue;
    const p = Number(numeri[0][1]);
    for (const m of numeri.slice(1)) {
      const da = Number(m[1]), a = m[2] ? Number(m[2]) : da;
      for (let i = da; i <= a && i - da < 60; i++) {
        if (!out.some(v => v.p === p && v.es === i)) out.push({ p, es: i });
      }
    }
  }
  return out;
}

/** Unità (oggetto) di una pagina stampata */
export function unitaDiPagina(p) {
  let u = null;
  for (const x of UNITA) if (p >= x.inizio) u = x;
  return u;
}

/** Esercizi indicizzati di una pagina stampata */
export const eserciziDellaPagina = p => indice.perPagina.get(p) || [];
