// =====================================================================
//  config.js — Tutte le informazioni sul libro in un solo posto.
//  Se cambi libro, di solito basta modificare SOLO questo file
//  (e rigenerare gli indici con gli script nella cartella tools/).
// =====================================================================

export const LIBRO = {
  titolo: 'Tutti i colori della Matematica — Blu 2',
  autori: 'Sasso, Zanone',
  nomeFile: 'Macematica_Libro.pdf',   // nome del file sul disco di casa
  offset: 18,                          // pagina PDF = pagina libro + 18
  primaPaginaLibro: 2,
  ultimaPaginaLibro: 917,
  // Unità 18 "Geometria nello spazio": numerata 1/42 … 42/42, pagina PDF = 936 + n
  u18: { primaPdf: 937, pagine: 42 },
  // Indice analitico: pagine libro 918–919 = PDF 980–981
  indiceAnalitico: { libro: [918, 919], pdf: [980, 981] },
};

// inizio = prima pagina stampata dell'unità
// esercizi / autoverifica = pagina stampata dove iniziano (null se non nota)
export const UNITA = [
  { n: 1,  titolo: 'Radicali e numeri reali',               inizio: 2,   esercizi: 24,  autoverifica: null },
  { n: 2,  titolo: 'Piano cartesiano e funzioni lineari',   inizio: 68,  esercizi: 84,  autoverifica: 107 },
  { n: 3,  titolo: 'Sistemi lineari e matrici',             inizio: 108, esercizi: 138, autoverifica: 182 },
  { n: 4,  titolo: 'Geometria analitica delle rette',       inizio: 183, esercizi: 200, autoverifica: 228 },
  { n: 5,  titolo: 'Equazioni di 2° grado',                 inizio: 240, esercizi: 262, autoverifica: 316 },
  { n: 6,  titolo: 'Parabola e sistemi di 2° grado',        inizio: 317, esercizi: 334, autoverifica: 371 },
  { n: 7,  titolo: 'Disequazioni di 2° grado',              inizio: 372, esercizi: 384, autoverifica: 417 },
  { n: 8,  titolo: 'Algebra di grado superiore al 2°',      inizio: 418, esercizi: 436, autoverifica: 468 },
  { n: 9,  titolo: 'Equazioni e disequazioni irrazionali',  inizio: 480, esercizi: 500, autoverifica: 523 },
  { n: 10, titolo: 'Valori assoluti',                       inizio: 524, esercizi: 540, autoverifica: 558 },
  { n: 11, titolo: 'Probabilità',                           inizio: 566, esercizi: 588, autoverifica: 617 },
  { n: 12, titolo: 'Circonferenza e cerchio',               inizio: 628, esercizi: 650, autoverifica: 675 },
  { n: 13, titolo: 'Poligoni inscritti e circoscritti',     inizio: 676, esercizi: 689, autoverifica: 705 },
  { n: 14, titolo: 'Area',                                  inizio: 712, esercizi: 728, autoverifica: 751 },
  { n: 15, titolo: 'Pitagora ed Euclide',                   inizio: 752, esercizi: 768, autoverifica: 798 },
  { n: 16, titolo: 'Talete e similitudine',                 inizio: 808, esercizi: 826, autoverifica: 857 },
  { n: 17, titolo: 'Applicazioni della similitudine',       inizio: 858, esercizi: 882, autoverifica: 901 },
];
// L'unità 18 non ha pagine "normali": la gestiamo a parte.
export const U18 = { n: 18, titolo: 'Geometria nello spazio' };

// Pagina in cui si trovano le risposte delle autoverifiche
export const RISPOSTE_AUTOVERIFICA = 910;

// Ricerca esercizi: prima ±5 pagine, poi si allarga di 5 in 5 fino a questo limite
export const RICERCA = { passo: 5, massimo: 40 };

// Password admin iniziale: la prima volta che entri nella sezione admin
// ti viene chiesto di sceglierla. Qui non c'è nessuna password scritta.

// ---------------------------------------------------------------------
//  Conversioni pagina libro <-> pagina PDF
// ---------------------------------------------------------------------

/** Pagina stampata (numero) -> pagina del PDF (1-based) */
export function libroToPdf(p) {
  return p + LIBRO.offset;
}

/** Pagina PDF -> etichetta da mostrare (es. "546", "U18 5/42", "PDF 3") */
export function etichettaPagina(pdf) {
  const { offset, primaPaginaLibro, ultimaPaginaLibro, u18, indiceAnalitico } = LIBRO;
  if (pdf >= primaPaginaLibro + offset && pdf <= ultimaPaginaLibro + offset) return String(pdf - offset);
  if (pdf >= u18.primaPdf && pdf < u18.primaPdf + u18.pagine) return `U18 ${pdf - u18.primaPdf + 1}/${u18.pagine}`;
  const i = indiceAnalitico.pdf.indexOf(pdf);
  if (i >= 0) return String(indiceAnalitico.libro[i]);
  return `PDF ${pdf}`;
}

/** Pagina PDF -> pagina stampata (numero) oppure null */
export function pdfToLibro(pdf) {
  const { offset, primaPaginaLibro, ultimaPaginaLibro } = LIBRO;
  if (pdf >= primaPaginaLibro + offset && pdf <= ultimaPaginaLibro + offset) return pdf - offset;
  return null;
}

/**
 * Testo scritto dall'utente -> pagina PDF.
 * Accetta: "546", "p. 546", "U18 5", "18/5", "pdf 30".
 */
export function interpretaPagina(testo) {
  const t = String(testo).trim().toLowerCase();
  let m;
  if ((m = t.match(/^pdf\s*(\d+)$/))) return Number(m[1]);
  if ((m = t.match(/^u?18\s*[\s/.-]\s*(\d+)/))) return LIBRO.u18.primaPdf + Number(m[1]) - 1;
  if ((m = t.match(/(\d+)/))) {
    const p = Number(m[1]);
    const ia = LIBRO.indiceAnalitico.libro.indexOf(p);
    if (ia >= 0) return LIBRO.indiceAnalitico.pdf[ia];
    return libroToPdf(p);
  }
  return null;
}

/** Unità a cui appartiene una pagina PDF (oggetto UNITA, U18 o null) */
export function unitaDiPdf(pdf) {
  if (pdf >= LIBRO.u18.primaPdf && pdf < LIBRO.u18.primaPdf + LIBRO.u18.pagine) return U18;
  const p = pdfToLibro(pdf);
  if (p == null) return null;
  let u = null;
  for (const x of UNITA) if (p >= x.inizio) u = x;
  return u;
}

/** Ultima pagina stampata di un'unità */
export function fineUnita(u) {
  const i = UNITA.findIndex(x => x.n === u.n);
  return i + 1 < UNITA.length ? UNITA[i + 1].inizio - 1 : LIBRO.ultimaPaginaLibro;
}

/** Riconosce un file svolti dal nome: "U10_Valori_assoluti_SVOLTI.pdf" -> 10 */
export function unitaDaNomeFile(nome) {
  const m = nome.match(/U(\d{1,2})[_\s-]/i);
  return m ? Number(m[1]) : null;
}

/**
 * Sostituisce le pagine delle unità (usata dall'admin dopo
 * "Rileva capitoli automaticamente"). Modifica l'array UNITA sul posto.
 */
export function impostaUnita(lista) {
  for (const nuova of lista) {
    const u = UNITA.find(x => x.n === nuova.n);
    if (u) Object.assign(u, nuova);
  }
}
