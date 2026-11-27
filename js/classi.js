// =====================================================================
//  classi.js — "Cartelle" dei libri per classe (es. 1IC, 1IA…).
//
//  L'admin crea le classi e sceglie quali libri ha ogni classe.
//  Chi usa l'app sceglie la sua classe la prima volta: la libreria
//  mostra solo i libri di quella classe. Si può cambiare quando vuoi.
//
//  Dati: kv globale "classi" = [{ id, nome, libri: [idLibro, …] }]
//        localStorage "libroVivo.classe" = id della classe scelta
// =====================================================================
import { el, toast, apriScheda, chiediTesto, conferma } from './ui.js';
import { db } from './db.js';
import { elencoLibri, emit } from './stato.js';

const CHIAVE_SCELTA = 'libroVivo.classe';

export async function elencoClassi() {
  return (await db.get('kv', 'classi')) || [];
}
async function salvaClassi(lista) {
  await db.set('kv', 'classi', lista);
  emit('classi-cambiate');
}

/** Classe scelta su questo iPad (oggetto) oppure null */
export async function classeScelta() {
  let id = null;
  try { id = localStorage.getItem(CHIAVE_SCELTA); } catch (e) { /* */ }
  if (!id) return null;
  return (await elencoClassi()).find(c => c.id === id) || null;
}
/** id = classe; null = "mostra tutti i libri" (scelta fatta, non richiederla) */
export function scegliClasse(id) {
  try { localStorage.setItem(CHIAVE_SCELTA, id || '*'); } catch (e) { /* */ }
  emit('classi-cambiate');
}
/** true se ci sono classi ma su questo iPad non è ancora stata scelta (o è stata cancellata) */
export async function serveSceltaClasse() {
  const classi = await elencoClassi();
  if (!classi.length) return false;
  let id = null;
  try { id = localStorage.getItem(CHIAVE_SCELTA); } catch (e) { return false; }
  if (id === '*') return false;
  return !id || !classi.some(c => c.id === id);
}

/** Scheda per scegliere la classe (prima volta, o "Cambia classe") */
export async function apriSceltaClasse({ obbligatoria = false } = {}) {
  const classi = await elencoClassi();
  const attuale = await classeScelta();
  const s = apriScheda(obbligatoria ? '👋 Benvenuto! Qual è la tua classe?' : '📁 Cambia classe', obbligatoria ? { onChiudi: () => { if (!sceltaFatta) scegliClasse(null); } } : {});
  let sceltaFatta = false;
  s.corpo.append(el('p', { class: 'nota' }, 'Vedrai solo i libri della tua classe. Puoi cambiarla quando vuoi dalla libreria o da Altro.'));
  s.corpo.append(el('div', { class: 'griglia-classi' }, ...classi.map(c =>
    el('button', { class: 'classe-card' + (attuale?.id === c.id ? ' attiva' : ''), onclick: () => { sceltaFatta = true; scegliClasse(c.id); s.chiudi(); toast(`Classe ${c.nome}`); } },
      el('b', {}, c.nome), el('small', {}, `${c.libri.length} ${c.libri.length === 1 ? 'libro' : 'libri'}`)))));
  s.corpo.append(el('div', { class: 'riga-bottoni' },
    el('button', { class: 'btn', onclick: () => { sceltaFatta = true; scegliClasse(null); s.chiudi(); } }, 'Mostra tutti i libri')));
}

// ---------------------------------------------------------------------
//  Parte ADMIN: crea, rinomina, cancella classi e scegli i loro libri
// ---------------------------------------------------------------------
export async function cardClassiAdmin() {
  const box = el('section', { class: 'card' });
  const disegna = async () => {
    const classi = await elencoClassi();
    const libri = await elencoLibri();
    const righe = classi.map(c => {
      const caselle = libri.map(l => {
        const cb = el('input', { type: 'checkbox', checked: c.libri.includes(l.id) });
        cb.onchange = async () => {
          const lista = await elencoClassi();
          const x = lista.find(y => y.id === c.id);
          x.libri = cb.checked ? [...new Set([...x.libri, l.id])] : x.libri.filter(id => id !== l.id);
          await salvaClassi(lista);
        };
        return el('label', { class: 'interruttore piccolo' }, cb, el('span', {}, `${l.materia || 'Libro'} · ${l.titolo}`));
      });
      return el('div', { class: 'classe-admin' },
        el('div', { class: 'card-testa' },
          el('h3', {}, `📁 ${c.nome}`),
          el('div', { class: 'riga-bottoni sinistra', style: { margin: 0 } },
            el('button', { class: 'btn piccolo', onclick: async () => {
              const nome = await chiediTesto('Nuovo nome della classe', { etichetta: 'Nome (es. 1IC)' });
              if (!nome?.trim()) return;
              const lista = await elencoClassi();
              lista.find(y => y.id === c.id).nome = nome.trim();
              await salvaClassi(lista); disegna();
            } }, 'Rinomina'),
            el('button', { class: 'btn piccolo', onclick: async () => {
              if (!await conferma(`Cancellare la classe ${c.nome}? I libri restano sull'iPad.`, { si: 'Cancella', pericolo: true })) return;
              await salvaClassi((await elencoClassi()).filter(y => y.id !== c.id)); disegna();
            } }, '🗑'))),
        libri.length ? el('div', { class: 'caselle-libri' }, ...caselle) : el('p', { class: 'vuoto' }, 'Nessun libro nella libreria.'));
    });
    box.replaceChildren(
      el('h3', {}, '📁 Classi (cartelle dei libri)'),
      el('p', { class: 'nota' }, 'Crea una cartella per ogni classe e spunta i suoi libri. Chi apre l\'app per la prima volta sceglie la sua classe e vede solo quei libri.'),
      ...(righe.length ? righe : [el('p', { class: 'vuoto' }, 'Nessuna classe. Senza classi la libreria mostra tutti i libri.')]),
      el('div', { class: 'riga-bottoni sinistra' }, el('button', { class: 'btn primario', onclick: async () => {
        const nome = await chiediTesto('Nuova classe', { etichetta: 'Nome (es. 1IC)', bottone: 'Crea' });
        if (!nome?.trim()) return;
        const lista = await elencoClassi();
        lista.push({ id: `cl${Date.now()}`, nome: nome.trim(), libri: [] });
        await salvaClassi(lista); disegna();
      } }, '➕ Nuova classe')));
  };
  await disegna();
  return box;
}
