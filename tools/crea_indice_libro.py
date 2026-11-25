"""
Crea l'indice degli esercizi del libro (data/indice_esercizi.json).

Come funziona:
- Nel libro i numeri degli esercizi sono scritti con un font speciale
  (HelveticaNeueLTStd-HvCn, circa 9.5 pt). Cerchiamo quei numeri.
- Per ogni numero calcoliamo il rettangolo dell'esercizio: dal numero
  fino al numero successivo nella stessa colonna (o fino a fine pagina).
- Salviamo: pagina stampata, numero, pagina del PDF, rettangolo.

Uso:  python3 crea_indice_libro.py Macematica_Libro.pdf ../data/indice_esercizi.json
Serve: pip install pymupdf
"""
import sys, json, re
import pymupdf

OFFSET = 18                 # pagina PDF = pagina libro + 18
FONT = "HelveticaNeueLTStd-HvCn"
# prima pagina esercizi di ogni unità (pagina stampata); l'unità finisce
# prima dell'inizio della successiva (vedi js/config.js)
UNITA_INIZIO = [2, 68, 108, 183, 240, 317, 372, 418, 480, 524, 566, 628, 676, 712, 752, 808, 858, 918]

def unita_di(pagina):
    u = 0
    for i, s in enumerate(UNITA_INIZIO):
        if pagina >= s:
            u = i + 1
    return u

def numeri_pagina(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            for sp in l["spans"]:
                t = sp["text"].strip()
                if sp["font"].startswith(FONT) and re.fullmatch(r"\d{1,4}", t) and 8.5 < sp["size"] < 10.5:
                    x0, y0, x1, y1 = sp["bbox"]
                    out.append({"n": int(t), "x": x0, "y": y0, "x1": x1, "y1": y1})
    # togli doppioni
    seen, res = set(), []
    for o in sorted(out, key=lambda o: (round(o["y"]), o["x"])):
        k = (o["n"], round(o["x"]), round(o["y"]))
        if k not in seen:
            seen.add(k); res.append(o)
    return res

def consegne_pagina(page):
    """Righe in grassetto (MinionPro-Semibold) a inizio colonna: sono le consegne,
    es. 'Traccia i grafici delle seguenti funzioni.'"""
    res = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            sp = l["spans"]
            if sp and sp[0]["font"].startswith("MinionPro-Semibold") and sp[0]["text"].strip():
                res.append(l["bbox"])
    return res

def righe_pagina(page):
    """Rettangoli di tutte le righe di testo della pagina"""
    return [l["bbox"] for b in page.get_text("dict")["blocks"] for l in b.get("lines", [])]

def rettangoli(nums, W, H, consegne=(), righe=()):
    mid = W / 2
    top_margin, bottom = 40, H - 36          # sotto c'è il numero di pagina
    left_x, right_end = 30, W - 22
    for o in nums:
        o["col"] = "L" if o["x"] < mid - 10 else "R"
    def prossimo_sx(o):
        ys = [p["y"] for p in nums if p["col"] == "L" and p["y"] > o["y"] + 3]
        return min(ys) if ys else bottom
    def larga(o):
        """Esercizio a tutta pagina: una riga che parte a sinistra e supera la metà"""
        if o["col"] != "L":
            return False
        fine = min(prossimo_sx(o), o["y"] + 70)
        return any(r[0] < mid - 10 and r[2] > mid + 20 and o["y"] - 2 <= r[1] < fine for r in righe)
    for o in nums:
        o["larga"] = larga(o)
    res = []
    for o in nums:
        sotto = [p for p in nums if p["y"] > o["y"] + 3]
        if o["larga"]:
            cand = [p["y"] for p in sotto]                       # finisce al primo numero sotto
            x0, x1 = left_x, right_end
        elif o["col"] == "L":
            cand = [p["y"] for p in sotto if p["col"] == "L"]    # colonna sinistra
            x0, x1 = left_x, mid + 2
        else:
            cand = [p["y"] for p in sotto if p["col"] == "R" or p["larga"]]   # colonna destra
            x0, x1 = o["x"] - 8, right_end
        y_end = min(cand) - 3 if cand else bottom
        y0 = max(top_margin, o["y"] - 3)
        r = {"es": o["n"], "bbox": [round(x0, 1), round(y0, 1), round(x1, 1), round(y_end, 1)]}
        # consegna: la riga in grassetto più vicina sopra l'esercizio, nella stessa colonna
        sopra = [c for c in consegne if c[3] <= o["y"] + 2 and (c[0] < mid - 10) == (o["col"] == "L")
                 and all(abs(c[1] - p["y"]) > 6 for p in nums if p["col"] == o["col"])
                 # escludi la prima riga di un esercizio (es. "Tracciamo..." sotto "ESERCIZIO SVOLTO")
                 and not any(0 < c[1] - p["y"] < 20 for p in nums if p["col"] == o["col"])]
        if sopra:
            c = max(sopra, key=lambda c: c[1])
            # nessun altro testo "importante" in mezzo: va bene se è entro 400 pt
            if o["y"] - c[1] < 400:
                r["c"] = [round(c[0] - 2, 1), round(c[1] - 2, 1), round(min(c[2] + 4, right_end), 1), round(c[3] + 2, 1)]
        res.append(r)
    return res

def main(src, dst):
    doc = pymupdf.open(src)
    pymupdf.TOOLS.mupdf_display_errors(False)
    out = []
    for pagina in range(2, 918):
        pi = pagina + OFFSET - 1          # indice 0-based
        if pi >= doc.page_count:
            break
        page = doc[pi]
        nums = numeri_pagina(page)
        for r in rettangoli(nums, page.rect.width, page.rect.height, consegne_pagina(page), righe_pagina(page)):
            e = {"p": pagina, "es": r["es"], "u": unita_di(pagina), "pdf": pi + 1, "b": r["bbox"]}
            if "c" in r:
                e["c"] = r["c"]
            out.append(e)
    json.dump({"versione": 1, "libro": "Tutti i colori della Matematica Blu 2", "offset": OFFSET,
               "esercizi": out}, open(dst, "w"), separators=(",", ":"))
    print(len(out), "esercizi trovati")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
