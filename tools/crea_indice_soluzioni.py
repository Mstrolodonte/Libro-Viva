"""
Crea l'indice delle soluzioni (data/indice_soluzioni.json) dai PDF "SVOLTI".

Ogni esercizio svolto inizia con un titolo tipo "p. 540 · es. 12".
Per ogni titolo salviamo: file, pagina del PDF e posizione verticale di
inizio; la fine è il titolo successivo (anche su una pagina dopo).

Uso: python3 crea_indice_soluzioni.py /cartella/con/U01..U17 ../data/indice_soluzioni.json
"""
import sys, os, re, json, glob
import pymupdf

TITOLO = re.compile(r"^p\.\s*(\d+)\s*·\s*es\.\s*(\d+)\s*$")

def main(root, dst):
    pymupdf.TOOLS.mupdf_display_errors(False)
    unita = {}
    for path in sorted(p for p in glob.glob(os.path.join(root, "U*", "U*_SVOLTI*.pdf")) if "NON_SVOLTI" not in p):
        nome = os.path.basename(path)
        u = int(nome[1:3])
        doc = pymupdf.open(path)
        titoli = []
        for pi in range(doc.page_count):
            page = doc[pi]
            for b in page.get_text("dict")["blocks"]:
                for l in b.get("lines", []):
                    t = "".join(s["text"] for s in l["spans"]).strip()
                    m = TITOLO.match(t)
                    if m:
                        titoli.append((int(m[1]), int(m[2]), pi + 1, round(l["bbox"][1] - 4, 1)))
        titoli.sort(key=lambda t: (t[2], t[3]))
        H = round(doc[0].rect.height, 1)
        sol = []
        for i, (p, es, pg, y) in enumerate(titoli):
            if i + 1 < len(titoli):
                pg2, y2 = titoli[i + 1][2], titoli[i + 1][3]
                if y2 <= 40:              # il successivo è in cima alla pagina: finisco alla pagina prima
                    pg2, y2 = pg2 - 1, H
            else:
                pg2, y2 = doc.page_count, H
            sol.append({"p": p, "es": es, "da": [pg, y], "a": [pg2, y2]})
        unita[str(u)] = {"file": nome, "pagine": doc.page_count, "altezza": H, "soluzioni": sol}
        print(nome, len(sol), "soluzioni")
    json.dump({"versione": 1, "unita": unita}, open(dst, "w"), separators=(",", ":"))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
