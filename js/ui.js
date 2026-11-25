// =====================================================================
//  ui.js — Piccoli aiuti per costruire l'interfaccia.
// =====================================================================

/** Crea un elemento: el('button', {class:'btn', onclick: fn}, 'Testo') */
export function el(tag, attr = {}, ...figli) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attr || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) e.style.setProperty(sk, sv); else e.style[sk] = sv; }
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const f of figli.flat()) {
    if (f == null || f === false) continue;
    e.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return e;
}

/** Icona a linee dal set in index.html (es. icona('leggi')) */
export function icona(nome, classe = '') {
  const s = document.createElement('span');
  s.className = 'icona ' + classe;
  s.innerHTML = `<svg class="ic"><use href="#i-${nome}"/></svg>`;
  return s;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Messaggio breve in basso */
let toastTimer;
export function toast(testo, ms = 2600) {
  const t = $('#toast');
  t.textContent = testo;
  t.classList.add('visibile');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visibile'), ms);
}

/**
 * Apre una "scheda" (finestra sopra l'app).
 * Restituisce { corpo, chiudi }.
 */
export function apriScheda(titolo, { larga = false, onChiudi } = {}) {
  const sfondo = el('div', { class: 'scheda-sfondo' });
  const corpo = el('div', { class: 'scheda-corpo' });
  const btnChiudi = el('button', { class: 'btn-icona', 'aria-label': 'Chiudi' }, '✕');
  const scheda = el('div', { class: 'scheda' + (larga ? ' larga' : ''), role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'scheda-testa' }, el('h2', {}, titolo), btnChiudi),
    corpo);
  sfondo.append(scheda);
  document.body.append(sfondo);
  requestAnimationFrame(() => sfondo.classList.add('aperta'));
  const chiudi = () => {
    sfondo.classList.remove('aperta');
    setTimeout(() => sfondo.remove(), 200);
    document.removeEventListener('keydown', esc);
    if (onChiudi) onChiudi();
  };
  const esc = e => { if (e.key === 'Escape') chiudi(); };
  document.addEventListener('keydown', esc);
  btnChiudi.onclick = chiudi;
  sfondo.addEventListener('click', e => { if (e.target === sfondo) chiudi(); });
  return { corpo, chiudi, scheda };
}

/** Domanda Sì/No dentro l'app (niente finestre del browser) */
export function conferma(testo, { si = 'Sì', no = 'Annulla', pericolo = false } = {}) {
  return new Promise(resolve => {
    const s = apriScheda('Conferma', { onChiudi: () => resolve(false) });
    s.corpo.append(
      el('p', {}, testo),
      el('div', { class: 'riga-bottoni' },
        el('button', { class: 'btn', onclick: () => { s.chiudi(); } }, no),
        el('button', { class: 'btn ' + (pericolo ? 'pericolo' : 'primario'), onclick: () => { resolve(true); s.chiudi(); } }, si)));
  });
}

/** Chiede un testo (es. password) dentro l'app */
export function chiediTesto(titolo, { etichetta = '', tipo = 'text', bottone = 'OK' } = {}) {
  return new Promise(resolve => {
    let fatto = false;
    const s = apriScheda(titolo, { onChiudi: () => { if (!fatto) resolve(null); } });
    const input = el('input', { type: tipo, class: 'campo', autocomplete: 'off' });
    const ok = () => { fatto = true; resolve(input.value); s.chiudi(); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    s.corpo.append(
      el('label', { class: 'etichetta' }, etichetta, input),
      el('div', { class: 'riga-bottoni' }, el('button', { class: 'btn primario', onclick: ok }, bottone)));
    setTimeout(() => input.focus(), 50);
  });
}

/** Formatta byte in MB */
export const mb = n => `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

/** Scarica un file generato dall'app (backup, ecc.) */
export function scaricaFile(nome, blob) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** iPad / iPhone (anche iPad che si presenta come Mac) */
export const eIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Apre il selettore file (sull'iPad apre l'app File).
 * Su iPad usiamo un unico <input> sempre presente nella pagina, non nascosto
 * con display:none e SENZA filtro "accept": con alcuni filtri il selettore
 * di iOS non si apre o fa chiudere l'app. I file sbagliati li scartiamo noi.
 */
let inputFile = null;
export function scegliFile({ accept = '', multiplo = false } = {}) {
  return new Promise(resolve => {
    if (!inputFile) {
      inputFile = document.createElement('input');
      inputFile.type = 'file';
      inputFile.setAttribute('aria-hidden', 'true');
      Object.assign(inputFile.style, { position: 'fixed', left: '-1000px', top: '0', width: '1px', height: '1px', opacity: '0' });
      document.body.append(inputFile);
    }
    const input = inputFile;
    input.value = '';
    if (eIOS || !accept) input.removeAttribute('accept'); else input.accept = accept;
    input.multiple = !!multiplo;
    let fatto = false;
    const fine = files => { if (!fatto) { fatto = true; resolve(files); } };
    input.onchange = () => fine([...input.files]);
    input.oncancel = () => fine([]);
    input.click();
  });
}
