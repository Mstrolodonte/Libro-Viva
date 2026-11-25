"""
Aggiunge al PDF del libro di matematica:
 - i SEGNALIBRI (indice cliccabile): Unità → Teoria (paragrafi) / Esercizi (paragrafi) / Autoverifica
 - le ETICHETTE DI PAGINA: ogni pagina mostra il numero stampato sul libro
   (così qualsiasi lettore PDF, e Libro Vivo, usano le pagine del libro).

Uso: python3 crea_segnalibri_mate.py Macematica_Libro.pdf Matematica_Vol2_segnalibri.pdf
"""
import sys, re
import pymupdf

sys.path.insert(0, __file__.rsplit("/", 1)[0])
OFFSET = 18
UNITA = [  # n, titolo, inizio, esercizi, autoverifica (pagine stampate)
    (1, "Radicali e numeri reali", 2, 24, None), (2, "Piano cartesiano e funzioni lineari", 68, 84, 107),
    (3, "Sistemi lineari e matrici", 108, 138, 182), (4, "Geometria analitica delle rette", 183, 200, 228),
    (5, "Equazioni di 2° grado", 240, 262, 316), (6, "Parabola e sistemi di 2° grado", 317, 334, 371),
    (7, "Disequazioni di 2° grado", 372, 384, 417), (8, "Algebra di grado superiore al 2°", 418, 436, 468),
    (9, "Equazioni e disequazioni irrazionali", 480, 500, 523), (10, "Valori assoluti", 524, 540, 558),
    (11, "Probabilità", 566, 588, 617), (12, "Circonferenza e cerchio", 628, 650, 675),
    (13, "Poligoni inscritti e circoscritti", 676, 689, 705), (14, "Area", 712, 728, 751),
    (15, "Pitagora ed Euclide", 752, 768, 798), (16, "Talete e similitudine", 808, 826, 857),
    (17, "Applicazioni della similitudine", 858, 882, 901),
]
FINE_LIBRO = 917
U18_PDF, U18_PAGINE = 937, 42
INDICE_ANALITICO_PDF = 980

def paragrafi(doc, da, a):
    """Titoli dei paragrafi ("1  Numeri irrazionali…") in cima alle pagine stampate da..a"""
    out, visti = [], set()
    for p in range(da, a + 1):
        page = doc[p + OFFSET - 1]
        for b in page.get_text("dict")["blocks"]:
            for l in b.get("lines", []):
                sp = [s for s in l["spans"] if s["text"].strip()]
                if not sp or l["bbox"][1] > 260:
                    continue
                if not all(s["font"].startswith("MuseoSlab") and 16.5 <= s["size"] <= 18.5 for s in sp):
                    continue
                testo = " ".join("".join(s["text"] for s in sp).replace("\xa0", " ").split())
                m = re.match(r"^(\d{1,2})\.?\s+(.+)$", testo)
                if not m:
                    # numero in un blocco a parte: cerco un titolo sulla stessa riga
                    continue
                num, tit = int(m[1]), m[2].strip()
                if num in visti or len(tit) < 4:
                    continue
                # il titolo può continuare sulla riga sotto (stesso font)
                visti.add(num)
                out.append((num, tit, p))
    return out

def paragrafi_con_numero_separato(doc, da, a):
    """Variante: il numero (es. '1' in un riquadro) è uno span separato dal titolo"""
    out, visti = [], set()
    for p in range(da, a + 1):
        page = doc[p + OFFSET - 1]
        righe = []
        for b in page.get_text("dict")["blocks"]:
            for l in b.get("lines", []):
                sp = [s for s in l["spans"] if s["text"].strip()]
                if sp and l["bbox"][1] < 260 and all(s["font"].startswith("MuseoSlab") and 16.5 <= s["size"] <= 18.5 for s in sp):
                    righe.append((l["bbox"], " ".join("".join(s["text"] for s in sp).replace("\xa0", " ").split())))
        numeri = [(bb, t) for bb, t in righe if re.fullmatch(r"\d{1,2}\.?", t)]
        titoli = [(bb, t) for bb, t in righe if not re.fullmatch(r"\d{1,2}\.?", t) and len(t) > 3]
        for bb, t in numeri:
            n = int(t.rstrip("."))
            if n in visti:
                continue
            vicini = sorted([x for x in titoli if abs(x[0][1] - bb[1]) < 8 and x[0][0] > bb[0]], key=lambda x: x[0][0])
            if not vicini:
                continue
            tit = vicini[0][1]
            # continuazione sulla riga sotto, allineata al titolo
            sotto = [x for x in titoli if 0 < x[0][1] - vicini[0][0][1] < 26 and abs(x[0][0] - vicini[0][0][0]) < 6]
            if sotto:
                tit += " " + sotto[0][1]
            visti.add(n)
            out.append((n, tit, p))
    return out

def trova_paragrafi(doc, da, a):
    tutti = {n: (n, t, p) for n, t, p in paragrafi_con_numero_separato(doc, da, a)}
    for n, t, p in paragrafi(doc, da, a):
        tutti.setdefault(n, (n, t, p))
    return [tutti[k] for k in sorted(tutti, key=lambda k: tutti[k][2])]

def main(src, dst):
    pymupdf.TOOLS.mupdf_display_errors(False)
    doc = pymupdf.open(src)
    pdf = lambda p: p + OFFSET          # pagina stampata -> pagina PDF (1-based)
    toc = []
    for i, (n, tit, inizio, es, av) in enumerate(UNITA):
        fine = UNITA[i + 1][2] - 1 if i + 1 < len(UNITA) else FINE_LIBRO
        toc.append([1, f"Unità {n} – {tit}", pdf(inizio)])
        toc.append([2, "Teoria", pdf(inizio)])
        for num, t, p in trova_paragrafi(doc, inizio, es - 1):
            toc.append([3, f"{num}. {t}", pdf(p)])
        toc.append([2, "Esercizi", pdf(es)])
        for num, t, p in trova_paragrafi(doc, es, (av or fine + 1) - 1):
            toc.append([3, f"{num}. {t}", pdf(p)])
        if av:
            toc.append([2, "Prova di autoverifica", pdf(av)])
        print(f"U{n}: ok")
    toc.append([1, "Risposte delle autoverifiche", pdf(910)])
    toc.append([1, "Unità 18 – Geometria nello spazio", U18_PDF])
    toc.append([1, "Indice analitico", INDICE_ANALITICO_PDF])
    doc.set_toc(toc)

    # etichette di pagina = numeri stampati sul libro
    n = doc.page_count
    etichette = [
        {"startpage": 0, "prefix": "", "style": "r", "firstpagenum": 1},                 # copertina e pagine iniziali: i, ii, …
        {"startpage": pdf(2) - 1, "prefix": "", "style": "D", "firstpagenum": 2},       # pagine del libro
        {"startpage": U18_PDF - 2, "prefix": "U18-", "style": "", "firstpagenum": 1},  # copertina U18
        {"startpage": U18_PDF - 1, "prefix": "U18-", "style": "D", "firstpagenum": 1},
        {"startpage": INDICE_ANALITICO_PDF - 2, "prefix": "Indice-", "style": "", "firstpagenum": 1},
        {"startpage": INDICE_ANALITICO_PDF - 1, "prefix": "", "style": "D", "firstpagenum": 918},
    ]
    if INDICE_ANALITICO_PDF + 1 < n:
        etichette.append({"startpage": INDICE_ANALITICO_PDF + 1, "prefix": "Fine-", "style": "D", "firstpagenum": 1})
    doc.set_page_labels(etichette)
    doc.save(dst, garbage=1, deflate=False)
    print("Salvato", dst, "con", len(toc), "segnalibri")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
