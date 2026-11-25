"""
Aggiorna version.json: la lista dei file dell'app da salvare offline.
Da lanciare PRIMA di pubblicare una nuova versione:

    python3 tools/crea_versione.py 1.0.1 "Cosa c'è di nuovo"

Se non cambi il numero di versione, l'iPad non vede l'aggiornamento.
"""
import json, os, sys, datetime

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ESCLUDI_CARTELLE = {"tools", ".git", ".github", "test"}
ESCLUDI_FILE = {"sw.js", "version.json", "README.md", ".gitignore", ".nojekyll", "LICENSE"}

def main():
    vecchia = {}
    p = os.path.join(RADICE, "version.json")
    if os.path.exists(p):
        vecchia = json.load(open(p))
    versione = sys.argv[1] if len(sys.argv) > 1 else vecchia.get("versione", "1.0.0")
    novita = sys.argv[2] if len(sys.argv) > 2 else vecchia.get("novita", "")
    file = []
    for cartella, sotto, nomi in os.walk(RADICE):
        sotto[:] = sorted(d for d in sotto if d not in ESCLUDI_CARTELLE)
        for n in sorted(nomi):
            rel = os.path.relpath(os.path.join(cartella, n), RADICE).replace(os.sep, "/")
            if n in ESCLUDI_FILE and "/" not in rel:
                continue
            if n.startswith("."):
                continue
            file.append(rel)
    dati = {"versione": versione, "data": datetime.date.today().isoformat(), "novita": novita, "file": file}
    json.dump(dati, open(p, "w"), indent=1, ensure_ascii=False)
    print(f"version.json: {versione}, {len(file)} file")

if __name__ == "__main__":
    main()
