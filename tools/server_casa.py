"""
server_casa.py — Piccolo server per scaricare libro e soluzioni nell'app.
FACOLTATIVO: il modo più semplice resta "Importa dal disco" nell'app.

Serve un computer o un Raspberry Pi acceso in casa, con Python 3.
1. Collega il disco del modem al computer (o copia i file in una cartella).
2. Lancia:   python3 server_casa.py /percorso/della/cartella 8080
3. Nell'app: Altro → Server di casa → http://IP-DEL-COMPUTER:8080

Il server:
- pubblica elenco.json (nome, dimensione e data di ogni PDF/JSON);
- permette all'app di scaricare i file (intestazioni CORS).

⚠️ Se l'app è aperta da https (GitHub Pages), Safari blocca i server
"http". In quel caso usa "Importa dal disco".
"""
import json, os, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial

CARTELLA = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
PORTA = int(sys.argv[2]) if len(sys.argv) > 2 else 8080

def elenco():
    out = []
    for radice, _, nomi in os.walk(CARTELLA):
        for n in sorted(nomi):
            if not n.lower().endswith((".pdf", ".json")) or "NON_SVOLTI" in n or n == "elenco.json":
                continue
            p = os.path.join(radice, n)
            st = os.stat(p)
            out.append({"nome": n, "percorso": os.path.relpath(p, CARTELLA).replace(os.sep, "/"),
                        "dimensione": st.st_size, "modificato": int(st.st_mtime)})
    return {"file": out}

class Gestore(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/elenco.json":
            dati = json.dumps(elenco()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(dati)))
            self.end_headers()
            self.wfile.write(dati)
            return
        super().do_GET()

if __name__ == "__main__":
    print(f"Cartella: {CARTELLA}\nIndirizzo: http://<IP di questo computer>:{PORTA}\nCtrl+C per fermare.")
    ThreadingHTTPServer(("0.0.0.0", PORTA), partial(Gestore, directory=CARTELLA)).serve_forever()
