// =====================================================================
//  zip.js — Apre un file .zip direttamente nell'app (senza librerie).
//
//  Usa DecompressionStream('deflate-raw') del browser (Safari 16.4+,
//  Chrome 80+). Restituisce i file contenuti come oggetti File, così
//  importa.js li tratta come se li avessi scelti uno per uno.
// =====================================================================

/** blob = file .zip  ->  [File, File, …] (cartelle e file nascosti esclusi) */
export async function apriZip(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // 1) "fine della directory centrale": in fondo al file
  let fine = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { fine = i; break; }
  }
  if (fine < 0) throw new Error('questo file non è uno zip valido');
  const quanti = dv.getUint16(fine + 10, true);
  let pos = dv.getUint32(fine + 16, true);

  // 2) elenco dei file (directory centrale)
  const utf8 = new TextDecoder();
  const out = [];
  for (let k = 0; k < quanti; k++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error('zip rovinato');
    const metodo = dv.getUint16(pos + 10, true);
    const compressa = dv.getUint32(pos + 20, true);
    const lungNome = dv.getUint16(pos + 28, true);
    const lungExtra = dv.getUint16(pos + 30, true);
    const lungComm = dv.getUint16(pos + 32, true);
    const locale = dv.getUint32(pos + 42, true);
    const percorso = utf8.decode(buf.subarray(pos + 46, pos + 46 + lungNome));
    pos += 46 + lungNome + lungExtra + lungComm;

    const nome = percorso.split('/').pop();
    if (!nome || percorso.startsWith('__MACOSX') || nome.startsWith('.')) continue;   // cartelle, file di sistema

    // 3) dati del file (dopo l'intestazione locale)
    const inizio = locale + 30 + dv.getUint16(locale + 26, true) + dv.getUint16(locale + 28, true);
    const dati = buf.subarray(inizio, inizio + compressa);
    let contenuto;
    if (metodo === 0) contenuto = dati;                       // non compresso
    else if (metodo === 8) contenuto = await decomprimi(dati); // deflate
    else throw new Error(`${nome}: compressione non supportata`);
    out.push(new File([contenuto], nome, { lastModified: blob.lastModified || Date.now() }));
  }
  return out;
}

async function decomprimi(dati) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('questo iPad è troppo vecchio per aprire gli zip: aggiorna iPadOS (16.4 o più) oppure importa i JSON uno per uno');
  }
  const flusso = new Blob([dati]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flusso).arrayBuffer());
}
