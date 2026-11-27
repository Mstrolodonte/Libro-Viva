// =====================================================================
//  pdfcompiti.js — Crea il PDF dei compiti, direttamente sull'iPad.
//
//  Regole (le stesse che Matteo ha dato per i compiti):
//   1. trovo ogni esercizio (pagina stampata, ±5 pagine e oltre);
//   2. ritaglio esercizio + risultato stampato, ad ALTA risoluzione;
//   3. una pagina per esercizio, sotto lo spazio a QUADRETTI (5 mm);
//      se gli esercizi sono corti, fino a 3 nella stessa pagina;
//   4. in fondo, le pagine con le risposte (e, se vuoi, gli svolgimenti).
//
//  Il PDF è scritto "a mano" (niente librerie): immagini JPEG,
//  righe dei quadretti e testo in Helvetica.
// =====================================================================
import { stato } from './stato.js';
import { ldb } from './db.js';
import { LIBRO } from './config.js';
import { cercaEsercizio, chiave } from './esercizi.js';

// Misure in punti PDF (1 pt = 1/72 di pollice). A4 = 595 × 842.
const PAG_L = 595.28, PAG_A = 841.89;
const MARGINE = 34;
const QUADRETTO = 14.173;            // 5 mm
const LARGH_UTILE = PAG_L - 2 * MARGINE;
const TESTA = 22;                    // riga in alto con titolo e numero pagina
const TITOLO = 18;                   // riga "p. 546 · es. 12" sopra il ritaglio
const CORTO = 220;                   // ritaglio più basso di così = esercizio corto
const MIN_QUADRETTI = 120;           // spazio minimo per scrivere sotto un esercizio
const RISOLUZIONE = 3;               // pixel per punto PDF nei ritagli (≈ 216 dpi)

/**
 * voci = [{ p, es }, …]
 * opzioni: { titolo, conSvolgimenti, avanzamento(n, tot, testo) }
 * Restituisce { blob, nonTrovati: [{p, es}], trovati: n }
 */
export async function creaPdfCompiti(voci, { titolo = 'Compiti', conSvolgimenti = false, avanzamento = () => {} } = {}) {
  if (!stato.libro) throw new Error('prima importa il PDF del libro');
  const esercizi = [], nonTrovati = [];

  // 1–2) trovo e ritaglio
  for (let i = 0; i < voci.length; i++) {
    const { p, es } = voci[i];
    avanzamento(i, voci.length, `Ritaglio p. ${p} es. ${es}…`);
    const ris = await cercaEsercizio(p, es);
    if (!ris) { nonTrovati.push({ p, es }); continue; }
    const img = await ritaglioEsercizio(ris.voce);
    const sol = await ldb.get('soluzioni', chiave(ris.voce.p, es));
    esercizi.push({ p, es, trovata: ris.trovata, voce: ris.voce, img, sol });
  }
  if (!esercizi.length) throw new Error('non ho trovato nessun esercizio');
  avanzamento(voci.length, voci.length, 'Impagino il PDF…');

  // 3) pagine con esercizi e quadretti
  const doc = new DocumentoPdf();
  const pagine = impagina(esercizi);
  for (const gruppo of pagine) {
    const pg = doc.nuovaPagina();
    testata(pg, titolo);
    disegnaGruppo(doc, pg, gruppo);
  }

  // 4) risposte (e svolgimenti) in fondo
  const righe = [];
  for (const e of esercizi) {
    righe.push({ tipo: 'titolo', testo: `p. ${e.voce.p} · es. ${e.es}` });
    if (e.sol?.risultato) righe.push({ tipo: 'risultato', testo: latexInTesto(e.sol.risultato) });
    else righe.push({ tipo: 'nota', testo: 'Risultato: quello stampato sul libro, nel ritaglio dell\'esercizio.' });
    if (conSvolgimenti && e.sol?.passi?.length) e.sol.passi.forEach((x, k) => righe.push({ tipo: 'passo', testo: `${k + 1}. ${latexInTesto(x)}` }));
  }
  for (const immagine of await paginaRisposte(conSvolgimenti ? 'Risposte e svolgimenti' : 'Risposte', righe)) {
    const pg = doc.nuovaPagina();
    testata(pg, titolo);
    const h = Math.min(PAG_A - 2 * MARGINE - TESTA, immagine.alt);
    pg.immagine(doc.aggiungiImmagine(immagine), MARGINE, PAG_A - MARGINE - TESTA - h, LARGH_UTILE, h);
  }

  return { blob: doc.salva(), nonTrovati, trovati: esercizi.length };
}

// ---------------------------------------------------------------------
//  Ritaglio: consegna (se c'è) + esercizio, uno sopra l'altro
// ---------------------------------------------------------------------
async function ritaglioEsercizio(voce) {
  const pezzi = [];
  if (voce.c && voce.c[3] <= voce.b[1] + 2) pezzi.push(voce.c);
  pezzi.push(voce.b);
  const largPt = Math.max(...pezzi.map(b => b[2] - b[0]));
  const altPt = pezzi.reduce((a, b) => a + (b[3] - b[1]), 0);
  const tela = document.createElement('canvas');
  tela.width = Math.ceil(largPt * RISOLUZIONE);
  tela.height = Math.ceil(altPt * RISOLUZIONE);
  const ctx = tela.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, tela.width, tela.height);
  const page = await stato.libro.getPage(voce.pdf);
  const vp = page.getViewport({ scale: RISOLUZIONE });
  let y = 0;
  for (const [x0, y0, x1, y1] of pezzi) {
    // disegno la pagina spostata, poi copio solo il rettangolo che serve
    const t = document.createElement('canvas');
    t.width = Math.ceil((x1 - x0) * RISOLUZIONE);
    t.height = Math.ceil((y1 - y0) * RISOLUZIONE);
    const tc = t.getContext('2d');
    tc.fillStyle = '#fff';
    tc.fillRect(0, 0, t.width, t.height);
    await page.render({ canvasContext: tc, viewport: vp, transform: [1, 0, 0, 1, -x0 * RISOLUZIONE, -y0 * RISOLUZIONE] }).promise;
    ctx.drawImage(t, 0, y);
    y += t.height;
  }
  return { tela, largPt, altPt };
}

// ---------------------------------------------------------------------
//  Impaginazione: lunghi da soli, corti fino a 3 per pagina
// ---------------------------------------------------------------------
const scalaDi = e => Math.min(1.35, LARGH_UTILE / e.img.largPt);    // ingrandisco un po' i ritagli stretti
const altezzaDi = e => e.img.altPt * scalaDi(e);

function impagina(esercizi) {
  const pagine = [];
  const spazio = PAG_A - 2 * MARGINE - TESTA;
  let i = 0;
  while (i < esercizi.length) {
    const e = esercizi[i];
    if (altezzaDi(e) > CORTO) { pagine.push([e]); i++; continue; }
    // quanti corti ci stanno (max 3), ognuno con il suo spazio a quadretti
    let n = 1;
    while (n < 3 && i + n < esercizi.length && altezzaDi(esercizi[i + n]) <= CORTO) {
      const prova = esercizi.slice(i, i + n + 1);
      const slot = spazio / prova.length;
      if (prova.some(x => TITOLO + altezzaDi(x) + MIN_QUADRETTI > slot)) break;
      n++;
    }
    pagine.push(esercizi.slice(i, i + n));
    i += n;
  }
  return pagine;
}

function testata(pg, titolo) {
  pg.testo(MARGINE, PAG_A - MARGINE - 12, 9, `${titolo}`, [0.42, 0.45, 0.52]);
  pg.testo(PAG_L - MARGINE - 80, PAG_A - MARGINE - 12, 9, `${LIBRO.materia || ''}`.slice(0, 22), [0.42, 0.45, 0.52]);
  pg.linea(MARGINE, PAG_A - MARGINE - 17, PAG_L - MARGINE, PAG_A - MARGINE - 17, [0.8, 0.82, 0.86], 0.6);
}

function disegnaGruppo(doc, pg, gruppo) {
  const alto = PAG_A - MARGINE - TESTA;
  const slot = (alto - MARGINE) / gruppo.length;
  gruppo.forEach((e, k) => {
    const top = alto - k * slot;
    const fondo = top - slot;
    // titolo
    const nota = e.trovata !== e.p ? `  (non era a p. ${e.p}: trovato a p. ${e.trovata})` : '';
    pg.testo(MARGINE, top - 13, 11.5, `p. ${e.voce.p} · es. ${e.es}`, [0.12, 0.37, 0.84], true);
    if (nota) pg.testo(MARGINE + 92, top - 13, 8.5, nota, [0.5, 0.5, 0.5]);
    // ritaglio (rimpicciolito se non ci sta)
    let s = scalaDi(e);
    const maxAlt = slot - TITOLO - (gruppo.length > 1 ? MIN_QUADRETTI : 60);
    if (e.img.altPt * s > maxAlt) s = maxAlt / e.img.altPt;
    const w = e.img.largPt * s, h = e.img.altPt * s;
    const yImg = top - TITOLO - h;
    pg.immagine(doc.aggiungiImmagine(e.img.tela), MARGINE, yImg, w, h);
    // quadretti sotto, fino alla fine dello spazio
    quadretti(pg, MARGINE, fondo + (k < gruppo.length - 1 ? 8 : 0), PAG_L - MARGINE, yImg - 8);
    if (k < gruppo.length - 1) pg.linea(MARGINE, fondo + 3, PAG_L - MARGINE, fondo + 3, [0.55, 0.6, 0.7], 0.8);
  });
}

/** Foglio a quadretti da 5 mm nel rettangolo (x0, y0) – (x1, y1) */
function quadretti(pg, x0, y0, x1, y1) {
  if (y1 - y0 < QUADRETTO) return;
  const nx = Math.floor((x1 - x0) / QUADRETTO), ny = Math.floor((y1 - y0) / QUADRETTO);
  const xf = x0 + nx * QUADRETTO, yt = y0 + ny * QUADRETTO;
  const col = [0.70, 0.80, 0.93];
  for (let i = 0; i <= nx; i++) pg.linea(x0 + i * QUADRETTO, y0, x0 + i * QUADRETTO, yt, col, 0.35);
  for (let j = 0; j <= ny; j++) pg.linea(x0, y0 + j * QUADRETTO, xf, y0 + j * QUADRETTO, col, 0.35);
}

// ---------------------------------------------------------------------
//  Pagine delle risposte: disegnate su una tela (così i simboli
//  matematici √ ≤ ∞ … escono giusti), poi messe nel PDF come immagine
// ---------------------------------------------------------------------
async function paginaRisposte(intestazione, righe) {
  const S = 3;                                          // risoluzione
  const W = Math.round(LARGH_UTILE * S), H = Math.round((PAG_A - 2 * MARGINE - TESTA) * S);
  const font = (px, peso = 400) => `${peso} ${px * S}px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif`;
  const fogli = [];
  let tela, ctx, y;
  const nuovo = () => {
    tela = document.createElement('canvas');
    tela.width = W; tela.height = H;
    ctx = tela.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#1b2230';
    ctx.font = font(18, 700);
    ctx.fillText(fogli.length ? `${intestazione} (continua)` : intestazione, 0, 0);
    y = 34 * S;
    fogli.push(tela);
  };
  nuovo();
  const stili = {
    titolo: { px: 11.5, peso: 700, colore: '#1f5fd6', prima: 8, rientro: 0 },
    risultato: { px: 11.5, peso: 400, colore: '#1b2230', prima: 2, rientro: 14 },
    nota: { px: 10, peso: 400, colore: '#6b7385', prima: 2, rientro: 14 },
    passo: { px: 10.5, peso: 400, colore: '#333a48', prima: 2, rientro: 14 },
  };
  for (const r of righe) {
    const st = stili[r.tipo];
    ctx.font = font(st.px, st.peso);
    const testo = r.tipo === 'risultato' ? `Risultato: ${r.testo}` : r.testo;
    const linee = aCapo(ctx, testo, W - st.rientro * S);
    const alt = (st.prima + linee.length * st.px * 1.4) * S;
    if (y + alt > H) { nuovo(); ctx.font = font(st.px, st.peso); }
    y += st.prima * S;
    ctx.fillStyle = st.colore;
    for (const l of linee) { ctx.fillText(l, st.rientro * S, y); y += st.px * 1.4 * S; }
  }
  // ogni foglio diventa un'immagine; taglio il bianco in fondo all'ultimo
  return fogli.map((t, i) => {
    if (i === fogli.length - 1) {
      const c = document.createElement('canvas');
      c.width = W; c.height = Math.min(H, Math.ceil(y + 10 * S));
      c.getContext('2d').drawImage(t, 0, 0);
      return Object.assign(c, { alt: c.height / S });
    }
    return Object.assign(t, { alt: H / S });
  });
}

function aCapo(ctx, testo, larghezza) {
  const parole = testo.split(/\s+/);
  const linee = [];
  let riga = '';
  for (const p of parole) {
    const prova = riga ? `${riga} ${p}` : p;
    if (ctx.measureText(prova).width > larghezza && riga) { linee.push(riga); riga = p; } else riga = prova;
  }
  if (riga) linee.push(riga);
  return linee.length ? linee : [''];
}

// ---------------------------------------------------------------------
//  Formule LaTeX ($…$) -> testo con simboli (per le risposte)
// ---------------------------------------------------------------------
const SIMBOLI = {
  cdot: '·', times: '×', div: ':', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', pm: '±', mp: '∓',
  infty: '∞', cup: '∪', cap: '∩', in: '∈', notin: '∉', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃',
  nexists: '∄', Rightarrow: '⇒', rightarrow: '→', to: '→', Leftrightarrow: '⇔', iff: '⇔', implies: '⇒', vee: '∨',
  wedge: '∧', lor: '∨', land: '∧', pi: 'π', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', theta: 'θ',
  lambda: 'λ', mu: 'μ', sigma: 'σ', varphi: 'φ', phi: 'φ', omega: 'ω', Omega: 'Ω', rho: 'ρ', tau: 'τ', psi: 'ψ',
  epsilon: 'ε', varepsilon: 'ε', eta: 'η', ell: 'ℓ', angle: '∠', widehat: '', hat: '', equiv: '≡', propto: '∝',
  leftrightarrow: '↔', frown: '⌒', sin: 'sin', cos: 'cos', tan: 'tan', det: 'det', max: 'max', min: 'min', log: 'log',
  arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan', supseteq: '⊇', supset: '⊃', geqslant: '≥', leqslant: '≤',
  triangle: '△', cong: '≅', sim: '∼', parallel: '∥', perp: '⊥', approx: '≈', simeq: '≃', circ: '°', degree: '°',
  dots: '…', ldots: '…', cdots: '⋯', lvert: '|', rvert: '|', vert: '|', mid: '|', setminus: '∖', subset: '⊂',
  subseteq: '⊆', neg: '¬', quad: ' ', qquad: ' ', '%': '%', '{': '{', '}': '}', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ',
};
const APICI = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', n: 'ⁿ', '(': '⁽', ')': '⁾', x: 'ˣ' };
const PEDICI = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', a: 'ₐ', e: 'ₑ', x: 'ₓ', n: 'ₙ' };
const MATBB = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ' };

const tonda = s => (/^[\w.,√π]+$/u.test(s) ? s : `(${s})`);

// argomento di un comando: {…} oppure una sola lettera/cifra (es. \frac ba)
const ARG = String.raw`(?:\{([^{}]*)\}|\s*([A-Za-z0-9]))`;
const RE_FRAC = new RegExp(String.raw`\\[dt]?frac` + ARG + ARG, 'g');
const RE_RADQ = new RegExp(String.raw`\\sqrt` + ARG, 'g');
const RE_RADN = new RegExp(String.raw`\\sqrt\[([^\]]*)\]` + ARG, 'g');

// i nomi più lunghi prima: così "\\cdotBH" diventa "·BH" e non "cdotBH"
const RE_SIMBOLI = new RegExp(String.raw`\\(` + Object.keys(SIMBOLI).filter(k => /^[a-zA-Z]+$/.test(k))
  .sort((a, b) => b.length - a.length).join('|') + String.raw`|[a-zA-Z]+|[{}%,;:! ])`, 'g');

export function latexInTesto(t) {
  let s = String(t).replace(/\*\*/g, '').replace(/\$\$?/g, '');
  s = s.replace(/\{,\}/g, ',');                                     // 5{,}97 -> 5,97
  s = s.replace(/\\ /g, ' ').replace(/\\[,;:!]/g, ' ');            // spazi di LaTeX
  // sistemi: { riga1 ; riga2 }
  s = s.replace(/\\begin\{[a-z]*cases\}([\s\S]*?)\\end\{[a-z]*cases\}/g,
    (_, righe) => `⟨{ ${righe.split(/\\\\/).map(r => r.replace(/&/g, ' ').trim()).filter(Boolean).join(' ; ')} }⟩`);
  // tabelle (array, tabular, matrix…): colonne separate da |, righe da ;
  s = s.replace(/\\begin\{[a-z]*\*?\}(?:\{[^{}]*\})?([\s\S]*?)\\end\{[a-z]*\*?\}/g,
    (_, righe) => righe.replace(/\\hline/g, '').split(/\\\\/).map(r => r.split('&').map(c => c.trim()).join(' | ').trim()).filter(Boolean).join(' ; '));
  s = s.replace(/\\hline/g, '').replace(/\\\\/g, ' ; ').replace(/&/g, ' ');
  s = s.replace(/\\(left|right|bigg|Bigg|big|Big|displaystyle|limits|nolimits)\b\.?/g, '');
  s = s.replace(/\\overset\{\\frown\}\{([^{}]*)\}/g, '⌒$1');        // arco AB
  s = s.replace(/\\not\s*\\?/g, '¬');
  // comandi "di stile" con una sola lettera senza graffe: \mathbb R, \vec v
  s = s.replace(/\\(mathbb|mathcal|mathrm|mathbf|vec|hat|bar|overline)\s+([A-Za-z0-9])/g, '\\$1{$2}');
  s = s.replace(/\\mathbb\{(\w)\}/g, (_, l) => MATBB[l] || l);
  let prima;
  do {
    prima = s;
    s = s.replace(/\\(?:text|textbf|textit|mathrm|mathbf|mathit|mathcal|boldsymbol|operatorname|mbox)\{([^{}]*)\}/g, '$1');
    s = s.replace(/\\overline\{([^{}]*)\}/g, (_, x) => [...x].map(c => (/\w/.test(c) ? c + '̅' : c)).join(''));
    s = s.replace(/\\(?:widehat|hat)\{([^{}]*)\}/g, (_, x) => (x.length === 1 ? x + '̂' : `∠${x}`));
    s = s.replace(/\\(?:vec|overrightarrow)\{([^{}]*)\}/g, (_, x) => `${x}⃗`);
    s = s.replace(/\\bar\{([^{}]*)\}/g, (_, x) => `${x}̄`);
    s = s.replace(/\\overset\{([^{}]*)\}\{([^{}]*)\}/g, '$2');
    s = s.replace(/\\binom\{([^{}]*)\}\{([^{}]*)\}/g, 'C($1, $2)');
    s = s.replace(RE_FRAC, (_, a1, a2, b1, b2) => `${tonda((a1 ?? a2).trim())}/${tonda((b1 ?? b2).trim())}`);
    s = s.replace(RE_RADN, (_, n, a, b) => { const x = (a ?? b).trim(); return `${[...n].map(c => APICI[c] || c).join('')}√${x ? tonda(x) : ''}`; });
    s = s.replace(/\\sqrt\{\s*\}/g, '√');
    s = s.replace(RE_RADQ, (_, a, b) => `√${tonda((a ?? b).trim())}`);
    s = s.replace(/\^\{([^{}]*)\}/g, (_, x) => ([...x].every(c => APICI[c]) ? [...x].map(c => APICI[c]).join('') : `^(${x})`));
    s = s.replace(/_\{([^{}]*)\}/g, (_, x) => ([...x].every(c => PEDICI[c]) ? [...x].map(c => PEDICI[c]).join('') : (x.length > 1 ? `(${x})` : x)));
  } while (s !== prima);
  s = s.replace(/\^\\circ/g, '°').replace(/\^(\w)/g, (_, c) => APICI[c] || `^${c}`).replace(/_(\w)/g, (_, c) => PEDICI[c] || c);
  s = s.replace(RE_SIMBOLI, (m, nome) => (nome in SIMBOLI ? SIMBOLI[nome] : nome));
  // le graffe rimaste sono solo raggruppamenti di LaTeX: via (tranne quelle dei sistemi)
  s = s.replace(/⟨\{|\}⟩/g, m => (m === '⟨{' ? '\u0001' : '\u0002')).replace(/[{}]/g, '').replace(/\u0001/g, '{').replace(/\u0002/g, '}');
  s = s.replace(/\\/g, '').replace(/\s+/g, ' ').trim();
  return s;
}

// ---------------------------------------------------------------------
//  Piccolo scrittore di PDF (versione 1.4)
// ---------------------------------------------------------------------
class DocumentoPdf {
  constructor() { this.pagine = []; this.immagini = []; }

  nuovaPagina() {
    const comandi = [];
    const n = v => (Math.round(v * 100) / 100).toString();
    const pg = {
      comandi,
      risorse: new Set(),
      linea: (x0, y0, x1, y1, [r, g, b], spessore) => comandi.push(`${n(r)} ${n(g)} ${n(b)} RG ${n(spessore)} w ${n(x0)} ${n(y0)} m ${n(x1)} ${n(y1)} l S`),
      testo: (x, y, dim, testo, [r, g, b] = [0, 0, 0], grassetto = false) =>
        comandi.push(`BT ${n(r)} ${n(g)} ${n(b)} rg /${grassetto ? 'F2' : 'F1'} ${n(dim)} Tf ${n(x)} ${n(y)} Td (${testoPdf(testo)}) Tj ET`),
      immagine: (nome, x, y, w, h) => { pg.risorse.add(nome); comandi.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(y)} cm /${nome} Do Q`); },
    };
    this.pagine.push(pg);
    return pg;
  }

  /** tela (canvas) -> immagine JPEG nel PDF. Restituisce il nome (Im1, Im2…) */
  aggiungiImmagine(tela) {
    const dataUrl = tela.toDataURL('image/jpeg', 0.88);
    const bin = atob(dataUrl.split(',')[1]);
    const byte = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) byte[i] = bin.charCodeAt(i);
    const nome = `Im${this.immagini.length + 1}`;
    this.immagini.push({ nome, byte, w: tela.width, h: tela.height });
    return nome;
  }

  salva() {
    const parti = [];
    let lunghezza = 0;
    const offset = [];
    const scrivi = x => { const b = typeof x === 'string' ? latin1(x) : x; parti.push(b); lunghezza += b.length; };
    const oggetto = (num, corpo) => { offset[num] = lunghezza; scrivi(`${num} 0 obj\n`); corpo(); scrivi('\nendobj\n'); };

    // numerazione: 1 catalogo, 2 pagine, 3–4 font, poi immagini, poi pagine+contenuti
    const numImg = new Map(this.immagini.map((im, i) => [im.nome, 5 + i]));
    const primaPagina = 5 + this.immagini.length;
    const numPag = i => primaPagina + i * 2;

    scrivi('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    oggetto(1, () => scrivi('<< /Type /Catalog /Pages 2 0 R >>'));
    oggetto(2, () => scrivi(`<< /Type /Pages /Count ${this.pagine.length} /Kids [${this.pagine.map((_, i) => `${numPag(i)} 0 R`).join(' ')}] >>`));
    oggetto(3, () => scrivi('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
    oggetto(4, () => scrivi('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
    for (const im of this.immagini) {
      oggetto(numImg.get(im.nome), () => {
        scrivi(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.byte.length} >>\nstream\n`);
        scrivi(im.byte);
        scrivi('\nendstream');
      });
    }
    this.pagine.forEach((pg, i) => {
      const xobj = [...pg.risorse].map(nm => `/${nm} ${numImg.get(nm)} 0 R`).join(' ');
      oggetto(numPag(i), () => scrivi(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAG_L} ${PAG_A}] /Contents ${numPag(i) + 1} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xobj} >> >> >>`));
      const flusso = latin1(pg.comandi.join('\n'));
      oggetto(numPag(i) + 1, () => { scrivi(`<< /Length ${flusso.length} >>\nstream\n`); scrivi(flusso); scrivi('\nendstream'); });
    });
    const totale = primaPagina + this.pagine.length * 2;
    const xref = lunghezza;
    let tab = `xref\n0 ${totale}\n0000000000 65535 f \n`;
    for (let k = 1; k < totale; k++) tab += `${String(offset[k]).padStart(10, '0')} 00000 n \n`;
    scrivi(tab);
    scrivi(`trailer\n<< /Size ${totale} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parti, { type: 'application/pdf' });
  }
}

// Testo per Helvetica (WinAnsi): lettere accentate ok, i simboli strani diventano "?"
const WINANSI = { '–': 0x96, '—': 0x97, '’': 0x92, '‘': 0x91, '“': 0x93, '”': 0x94, '…': 0x85, '€': 0x80, '•': 0x95 };
function latin1(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    b[i] = c < 256 ? c : (WINANSI[s[i]] || 0x3f);
  }
  return b;
}
function testoPdf(s) {
  return String(s).replace(/[\\()]/g, m => `\\${m}`).replace(/[\r\n]+/g, ' ');
}
