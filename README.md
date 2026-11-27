# 📘 Libro Vivo

Web app per iPad (PWA): una **libreria** con i libri di scuola.
Il libro di matematica *Tutti i colori della Matematica — Blu 2* è già preparato
(indice di tutti gli esercizi e soluzioni a passi); gli altri libri si aggiungono dall'app.
Funziona **offline**: il libro e le soluzioni restano sull'iPad.

## Cosa fa

| Funzione | Dove |
|---|---|
| Libreria: scegli il libro | 📚 all'avvio |
| **Classi** (cartelle di libri, es. 1IC): la prima volta scegli la tua classe e vedi solo i suoi libri | 📚 → 📁 Cambia |
| Aggiungi libro: capitoli e numeri di pagina trovati da soli | 📚 → ➕ |
| Sezioni del libro: leggi, capitoli, esercizi e compiti | 🏠 Sezioni |
| Legge il libro, pagine **stampate** (non del PDF) | 📖 Libro |
| Capitoli automatici (mappa pagine, PDF = libro + 18) | ☰ in alto |
| Pagina adattata allo schermo, **due pagine affiancate** (automatico in orizzontale) | in alto |
| Zoom con due dita **dove hai le dita**, doppio tocco, Ctrl+rotella sul computer | sulla pagina |
| Penna Apple Pencil, evidenziatore, gomma, annulla: barra galleggiante tipo Notability | ✏️ in alto |
| Riapre l'ultima pagina, anche dopo un crash | automatico |
| Cerca un esercizio (pagina + numero, ±5 pagine e oltre) | 📝 Esercizi |
| Scheda esercizio + **Mostra soluzione esercizio** (a passi) | tocca un esercizio |
| Esercizi e compiti insieme: scrivi "p. 546 es. 12, 15 p. 547 es. 3" (anche senza ";") e li vedi tutti uno sotto l'altro | 📝 Esercizi |
| **PDF dei compiti**: ritagli ad alta risoluzione, quadretti, fino a 3 per pagina, risposte (e svolgimenti) in fondo | 📝 Esercizi → 📄 |
| Fatto ✅ / Difficile ⚠️ / Preferito ⭐; progressi per unità nel pannello Capitoli | ☰ in alto |
| Segnalibri, ricerca nel testo, tema scuro, zoom | in alto |
| Importa uno **zip** con tutte le soluzioni JSON (es. Soluzioni_Matematica_Vol2.zip) | Importa |
| Backup di disegni e progressi; cancella progressi e appunti (con doppia conferma) | ⚙️ Altro |
| Area admin con password: classi, soluzioni per unità | ⚙️ Altro → Admin |

L'app **non si aggiorna da sola**: solo con *Altro → Controlla aggiornamento app*.

## Installare sull'iPad

1. Apri in Safari l'indirizzo di GitHub Pages (es. `https://mstrolodonte.github.io/Libro-Viva/`).
2. Tocca **Condividi → Aggiungi alla schermata Home**.
3. Apri l'app dalla Home → **📂 Importa dal disco** e scegli:
   - `Macematica_Libro.pdf` (il libro)
   - `Uxx_….json` (soluzioni a passi)
   - `Uxx_…_SVOLTI.pdf` (svolgimenti con figure, facoltativi)

Il disco del modem si apre dall'app **File**: ⋯ → *Connetti al server* → `smb://IP-del-modem`.

> ⚠️ Il libro e le soluzioni **non** vanno messi in questo repository (sono protetti da copyright
> e pesanti). Restano sul disco di casa e sull'iPad.

## Come è fatto il codice (per chi aiuta)

Niente framework e niente "build": HTML, CSS e JavaScript (moduli ES). Commenti in italiano.

```
index.html          struttura della pagina
css/app.css         grafica (colori in variabili, tema chiaro/scuro)
sw.js               offline + aggiornamento SOLO a richiesta (non modificarlo se non serve)
version.json        versione e lista dei file da salvare offline
js/
  app.js            avvio, collega tutto
  config.js         ⭐ libro di matematica + funzioni pagine (LIBRO/UNITA = libro aperto ora)
  libreria.js       libreria, aggiungi libro, sezioni, impostazioni libro
  stato.js          stato condiviso, eventi, ultima pagina, impostazioni
  db.js             salvataggio su IndexedDB (ldb = dati del libro aperto, chiavi "idLibro:…")
  pdf.js            apre e disegna i PDF (pdf.js), ritagli ad alta risoluzione
  lettore.js        visualizzatore pagine, zoom, scorrimento
  penna.js          Apple Pencil
  esercizi.js       ricerca esercizi + scheda + soluzione
  viste.js          Esercizi e compiti, Capitoli con progressi, Segnalibri, Ricerca testo
  classi.js         classi (cartelle di libri): admin + scelta della classe
  importa.js        importazione dal disco (anche .zip) / download dal server di casa
  pdfcompiti.js     crea il PDF dei compiti (scrittore PDF senza librerie)
  zip.js            apre i file .zip nel browser (DecompressionStream)
  altro.js          impostazioni, aggiornamento app
  admin.js          area admin
  backup.js         esporta / ripristina
data/
  indice_esercizi.json   dove sta ogni esercizio (pagina, numero, rettangolo)
  indice_soluzioni.json  dove sta ogni soluzione nei PDF svolti
vendor/             pdf.js 4.10.38 e KaTeX 0.16.11 (copiati qui per funzionare offline)
tools/              script Python per creare gli indici, version.json e il server di casa
```

### Pubblicare una nuova versione

1. Modifica i file.
2. `python3 tools/crea_versione.py 1.0.1 "cosa è cambiato"`
3. Commit e push su `main`. GitHub Pages pubblica da solo.
4. Sull'iPad: Altro → Controlla aggiornamento app → Aggiorna ora.

### Provare sul computer

```
python3 -m http.server 8000
```
e apri `http://localhost:8000` (Chrome o Safari).

### Formato soluzioni JSON

Un oggetto per esercizio; `pagina` è la pagina **stampata**:

```json
{ "pagina": 546, "es": 12, "testo": "…", "risultato": "…", "passi": ["…", "…"] }
```
Formule tra `$…$` (KaTeX), grassetto tra `**…**`. `"figura": true` = lo svolgimento ha un disegno (l'app propone il PDF).

### Rigenerare gli indici (se cambia il libro)

```
pip install pymupdf
python3 tools/crea_indice_libro.py Macematica_Libro.pdf data/indice_esercizi.json
python3 tools/crea_indice_soluzioni.py /cartella/con/U01..U17 data/indice_soluzioni.json
```

### Server di casa (facoltativo)

`python3 tools/server_casa.py /cartella/dei/pdf 8080` su un PC o Raspberry.
Attenzione: se l'app è su https, Safari blocca i server http. Il modo consigliato resta "Importa dal disco".
