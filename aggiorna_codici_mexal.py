"""Aggiorna l'Excel dei codici Mexal e lo sincronizza con products.json.

Uso (dalla cartella CiliegioShop):
    python aggiorna_codici_mexal.py            rigenera l'Excel (non perde nulla di quello che hai scritto)
    python aggiorna_codici_mexal.py --importa  copia dall'Excel a products.json

L'UNICO foglio da modificare e' "Codici Mexal" (cartella LUCA, file "Codici Mexal Siena Wine.xlsx"):
una riga per codice Mexal, con le colonne dell'esportazione (Codice, Descrizione, UM, EAN, Natura, Gruppo) piu',
per i codici che sono nello shop (colonna "Nello shop" = si), le colonne da compilare:
    Disponibile (si/no) | Prezzo EUR | IVA % | Nome inglese (shop) | Italiano | Deutsch | Francais | Espanol
I fogli "Abbinamento shop" e "Nomi per lingua" sono solo una vista: li riscrive lo script a ogni esecuzione,
leggendo "Codici Mexal". Non vanno modificati.

Legge:   Export prodotti mexal.xlsx (esportato da Mexal) e products.json (campo "mexal" di ogni prodotto: i
         codici Mexal si assegnano a mano nel file products.json).
Importa: Disponibile -> "available", Prezzo -> "price" (l'omaggio resta 0), IVA -> "vat", Nome inglese -> "name",
         traduzioni -> "names". Nome inglese, ordini, mail interne, CSV Mexal e CRM usano l'inglese.
La descrizione del foglio Codici Mexal ha la precedenza sull'esportazione: se la cambi a mano non viene sovrascritta
(lo script segnala le differenze, cosi' sai dove Mexal e' ancora indietro). Descrizioni e codici finiscono in
netlify/functions/mexal-codes.json (usato dal generatore dei CSV).
"""
import json
import os
import sys

import openpyxl
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.join(HERE, "Export prodotti mexal.xlsx")
PRODUCTS = os.path.join(HERE, "products.json")
CODES_JSON = os.path.join(HERE, "netlify", "functions", "mexal-codes.json")
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "Codici Mexal Siena Wine.xlsx")

LINGUE = (("it", "Italiano"), ("de", "Deutsch"), ("fr", "Français"), ("es", "Español"))
H_EXPORT = ["Codice", "Descrizione", "UM", "Cod. alternativo (EAN)", "Natura", "Gruppo merceologico"]
H_SHOP = ["Nello shop", "Disponibile", "Prezzo EUR", "IVA %", "Nome inglese (shop)"] + [h for _, h in LINGUE]
H_MASTER = H_EXPORT + H_SHOP
YELLOW = PatternFill("solid", fgColor="FFF2CC")
GRAY = PatternFill("solid", fgColor="EDEDED")
GOLD = PatternFill("solid", fgColor="D4AF37")


def leggi_export():
    wb = openpyxl.load_workbook(EXPORT, read_only=True)
    ws = wb.worksheets[0]
    ws.reset_dimensions()
    rows = list(ws.iter_rows(values_only=True))
    # la prima colonna dell'export e' vuota: l'intestazione "Codice" e' nella seconda
    start = next(i for i, r in enumerate(rows) if r and "Codice" in [str(x) for x in r if x])
    head = [str(x) if x is not None else "" for x in rows[start]]
    ci = head.index("Codice")
    out = []
    for r in rows[start + 1:]:
        if r[ci] is None:
            continue
        g = lambda name: ("" if r[head.index(name)] is None else str(r[head.index(name)]).strip())
        out.append([str(r[ci]).strip(), g("Descrizione"), g("Um"), g("Cod.alternativo"), g("Natura"),
                    g("Gruppo merceologico")])
    return out


# ---- lettura dell'Excel -------------------------------------------------------------------------------------

def _righe(nome_foglio):
    if not os.path.exists(OUT):
        return None, []
    wb = openpyxl.load_workbook(OUT, read_only=True)
    if nome_foglio not in wb.sheetnames:
        return None, []
    ws = wb[nome_foglio]
    ws.reset_dimensions()
    rows = list(ws.iter_rows(values_only=True))
    return (list(rows[0]) if rows else None), rows[1:]


def _s(v):
    return "" if v is None else " ".join(str(v).split())


def _si_no(v, etichetta):
    t = _s(v).lower()
    if t == "":
        return None
    if t in ("si", "sì", "yes", "true", "1", "vero"):
        return True
    if t in ("no", "false", "0", "falso"):
        return False
    print(f"ATTENZIONE: Disponibile non valido per {etichetta}: {v!r} (ignorato, usa si o no)")
    return None


def _num(v, etichetta, campo):
    t = _s(v).replace(",", ".").replace("%", "").replace("EUR", "").replace("€", "")
    if t == "":
        return None
    try:
        return float(t)
    except ValueError:
        print(f"ATTENZIONE: {campo} non valido per {etichetta}: {v!r} (ignorato)")
        return None


def leggi_master():
    """Foglio 'Codici Mexal' dell'Excel esistente: {codice: {campi}}. I campi shop sono None se la cella e' vuota
    o se il foglio e' ancora nel vecchio formato (senza colonne shop)."""
    head, rows = _righe("Codici Mexal")
    out = {}
    if not head or "Codice" not in head:
        return out
    col = {h: head.index(h) for h in H_MASTER if h in head}
    for r in rows:
        if r[0] is None:
            continue
        g = lambda h: r[col[h]] if h in col and len(r) > col[h] else None
        code = _s(g("Codice"))
        etichetta = f"codice {code}"
        out[code] = {
            "desc": _s(g("Descrizione")), "um": _s(g("UM")), "ean": _s(g("Cod. alternativo (EAN)")),
            "natura": _s(g("Natura")), "gruppo": _s(g("Gruppo merceologico")),
            "disp": _si_no(g("Disponibile"), etichetta),
            "prezzo": _num(g("Prezzo EUR"), etichetta, "Prezzo"), "iva": _num(g("IVA %"), etichetta, "IVA"),
            "name": _s(g("Nome inglese (shop)")) or None,
            "names": {c: (_s(g(h)) or None) for c, h in LINGUE},
            "ha_colonne_shop": "Disponibile" in col,
        }
    return out


def leggi_vecchi_fogli(prods):
    """Migrazione dal vecchio formato: valori scritti a mano nei fogli 'Abbinamento shop' e 'Nomi per lingua',
    riportati per CODICE (si usa il prodotto non 'omaggio' di ogni codice)."""
    out = {}
    id2code = {str(p["id"]): p.get("mexal") for p in prods}
    head, rows = _righe("Abbinamento shop")
    if head and "ID shop" in head:
        def c(h):
            return head.index(h) if h in head else None
        ip = c("Prezzo EUR (da compilare)") if c("Prezzo EUR (da compilare)") is not None else c("Prezzo EUR")
        for r in rows:
            pid = _s(r[0])
            if not pid or pid.endswith("_gift") or not id2code.get(pid):
                continue
            d = out.setdefault(id2code[pid], {"names": {}})
            et = f"id {pid}"
            if c("Disponibile") is not None:
                d["disp"] = _si_no(r[c("Disponibile")], et)
            if ip is not None:
                d["prezzo"] = _num(r[ip], et, "Prezzo")
            if c("IVA % (da compilare)") is not None:
                d["iva"] = _num(r[c("IVA % (da compilare)")], et, "IVA")
            if c("Nome nello shop") is not None:
                d["name"] = _s(r[c("Nome nello shop")]) or None
    head, rows = _righe("Nomi per lingua")
    if head and "ID shop" in head:
        for r in rows:
            pid = _s(r[0])
            if not pid or pid.endswith("_gift") or not id2code.get(pid):
                continue
            d = out.setdefault(id2code[pid], {"names": {}})
            if "Nome inglese (shop)" in head and _s(r[head.index("Nome inglese (shop)")]):
                d["name"] = _s(r[head.index("Nome inglese (shop)")])
            for code, h in LINGUE:
                if h in head and _s(r[head.index(h)]):
                    d["names"][code] = _s(r[head.index(h)])
    return out


def principale(prods):
    """{codice Mexal: prodotto dello shop 'principale'} (non omaggio)."""
    out = {}
    for p in prods:
        if p.get("mexal") and not str(p["id"]).endswith("_gift") and p["mexal"] not in out:
            out[p["mexal"]] = p
    return out


def valori_shop(code, p, master, vecchi):
    """Valori finali dei campi shop per un codice: cella dell'Excel > vecchi fogli > products.json."""
    m = master.get(code, {})
    v = vecchi.get(code, {"names": {}})

    def pick(campo, default):
        for fonte in (m.get(campo), v.get(campo)):
            if fonte is not None:
                return fonte
        return default

    names = {}
    for c, _ in LINGUE:
        names[c] = m.get("names", {}).get(c) or v["names"].get(c) or (p.get("names") or {}).get(c) or ""
    return {"disp": pick("disp", p.get("available", True)), "prezzo": pick("prezzo", float(p["price"])),
            "iva": pick("iva", p.get("vat")), "name": pick("name", p["name"]), "names": names}


# ---- scrittura -----------------------------------------------------------------------------------------------

def scrivi_codes_json(descrizioni):
    with open(CODES_JSON, "w", encoding="utf-8", newline="\n") as f:
        json.dump(descrizioni, f, ensure_ascii=False, indent=1, sort_keys=True)


def salva_products(prods):
    raw = open(PRODUCTS, encoding="utf-8", newline="").read()
    out = json.dumps(prods, ensure_ascii=False, indent=2)
    if raw.endswith("\n"):
        out += "\n"
    with open(PRODUCTS, "w", encoding="utf-8", newline="") as f:
        f.write(out)


def num_fmt(x):
    if x is None or x == "":
        return ""
    return int(x) if float(x).is_integer() else x


def importa():
    master = leggi_master()
    prods = json.load(open(PRODUCTS, encoding="utf-8"))
    if not master or not any(m["ha_colonne_shop"] for m in master.values()):
        sys.exit("Il foglio 'Codici Mexal' di " + OUT + " non ha ancora le colonne shop: lancia prima "
                 "'python aggiorna_codici_mexal.py' (senza opzioni) per rigenerarlo.")
    c_disp, c_prezzo, c_nome, c_iva, c_nomi = [], [], [], [], []
    for p in prods:
        pid = str(p["id"])
        gift = pid.endswith("_gift")
        m = master.get(p.get("mexal"))
        if not m or not m["ha_colonne_shop"]:
            continue
        if m["iva"] is not None:
            if not (0 <= m["iva"] <= 30):
                sys.exit(f"Aliquota fuori range per il codice {p['mexal']}: {m['iva']}")
            nuovo = num_fmt(m["iva"])
            if p.get("vat") != nuovo:
                c_iva.append(f"{pid} {p['name']}: IVA {p.get('vat', '(nessuna)')} -> {nuovo}")
            p["vat"] = nuovo
        if m["disp"] is not None and p.get("available", True) != m["disp"]:
            c_disp.append(f"{pid} {p['name']}: {'disponibile' if m['disp'] else 'NON disponibile'}")
            p["available"] = m["disp"]
        if m["prezzo"] is not None and not gift and abs(float(p["price"]) - m["prezzo"]) > 1e-9:
            if m["prezzo"] <= 0:
                sys.exit(f"Prezzo non valido per {pid} ({p['name']}): {m['prezzo']}")
            vecchio = float(p["price"])
            nota = "  <-- VARIAZIONE OLTRE IL 50%, controllare" if vecchio > 0 and abs(m["prezzo"] - vecchio) / vecchio > 0.5 else ""
            c_prezzo.append(f"{pid} {p['name']}: {vecchio:.2f} -> {m['prezzo']:.2f} EUR{nota}")
            p["price"] = float(m["prezzo"])
        if m["name"] and p["name"] != m["name"]:
            c_nome.append(f"{pid} nome inglese: {p['name']} -> {m['name']}")
            p["name"] = m["name"]
        old_names = p.get("names") or {}
        new_names = {c: (m["names"].get(c) or p["name"]) for c, _ in LINGUE}
        for c, _ in LINGUE:
            if old_names.get(c) != new_names[c]:
                c_nomi.append(f"{pid} [{c}] {old_names.get(c, '(nessuno)')} -> {new_names[c]}")
        p["names"] = new_names
    salva_products(prods)
    for titolo, lista in (("IVA", c_iva), ("Disponibilita'", c_disp), ("Prezzi", c_prezzo),
                          ("Nomi inglesi", c_nome), ("Nomi tradotti", c_nomi)):
        print(f"{titolo}: {len(lista)} cambiamenti")
        for x in lista:
            print(" -", x)
    senza = [f"{p['id']} {p['name']}" for p in prods if "vat" not in p]
    if senza:
        print("Ancora senza aliquota:")
        for x in senza:
            print(" -", x)
    print("\nproducts.json aggiornato (in locale). Per pubblicare nello shop serve commit + push.")


importa_iva = importa   # vecchio nome del comando


def main():
    if "--importa" in sys.argv or "--importa-iva" in sys.argv:
        importa()
        return
    if not os.path.exists(EXPORT):
        sys.exit("Manca il file: " + EXPORT)
    export = leggi_export()
    by_code = {r[0]: r for r in export}
    prods = json.load(open(PRODUCTS, encoding="utf-8"))

    problemi = []
    for p in prods:
        c = p.get("mexal")
        if not c:
            problemi.append(f"id {p['id']} ({p['name']}): nessun codice Mexal")
        elif c not in by_code:
            problemi.append(f"id {p['id']} ({p['name']}): il codice {c} non esiste nell'esportazione Mexal")
    usati = {p.get("mexal") for p in prods}
    princ = principale(prods)

    master = leggi_master()
    vecchi = leggi_vecchi_fogli(prods) if not any(m["ha_colonne_shop"] for m in master.values()) else {}

    # descrizioni: quella scritta nell'Excel ha la precedenza sull'esportazione
    desc, desc_diverse = {}, []
    for r in export:
        mine = master.get(r[0], {}).get("desc") or ""
        desc[r[0]] = mine or r[1]
        if mine and mine != r[1]:
            desc_diverse.append(r[0])

    wb = openpyxl.Workbook()

    def intestazione(ws, head, widths):
        ws.append(head)
        for c in ws[1]:
            c.font = Font(bold=True)
            c.fill = GOLD
            c.alignment = Alignment(wrap_text=True, vertical="center")
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.freeze_panes = "A2"

    # --- foglio 1: Codici Mexal (UNICO foglio da modificare) ---
    ws = wb.active
    ws.title = "Codici Mexal"
    intestazione(ws, H_MASTER, [12, 70, 6, 22, 9, 12, 10, 12, 12, 8, 52, 52, 52, 52, 52])
    finali = {}
    for r in export:
        code = r[0]
        row = [code, desc[code], r[2], r[3], r[4], r[5], "si" if code in usati else ""]
        if code in princ:
            v = valori_shop(code, princ[code], master, vecchi)
            finali[code] = v
            row += ["si" if v["disp"] else "no", v["prezzo"], num_fmt(v["iva"]), v["name"]] + [v["names"][c] for c, _ in LINGUE]
        else:
            row += [""] * 8
        ws.append(row)
    for row in ws.iter_rows(min_row=2):
        for c in list(row[:8]) + [row[10]] + list(row[11:]):
            c.number_format = "@"
        row[8].number_format = "0.00"
        row[9].number_format = "General"
        if row[6].value == "si":
            for c in row[7:]:
                c.fill = YELLOW
    ws.auto_filter.ref = ws.dimensions
    ws["H1"].comment = Comment("Colonne da H a O: si compilano solo per i codici 'Nello shop = si'. Dopo la modifica "
                               "si lancia: python aggiorna_codici_mexal.py --importa", "Claude")

    # --- foglio 2: Abbinamento shop (vista, riscritta dallo script) ---
    ws2 = wb.create_sheet("Abbinamento shop")
    intestazione(ws2, ["ID shop", "Categoria", "Codice Mexal", "Nome inglese (shop)", "Disponibile", "Prezzo EUR", "IVA %",
                       "Descrizione Mexal"], [9, 13, 13, 58, 12, 12, 8, 70])
    # --- foglio 3: Nomi per lingua (vista) ---
    ws3 = wb.create_sheet("Nomi per lingua")
    intestazione(ws3, ["ID shop", "Codice Mexal", "Nome inglese (shop)"] + [h for _, h in LINGUE], [9, 13, 58, 58, 58, 58, 58])
    diverse = []
    for p in prods:
        pid = str(p["id"])
        code = p.get("mexal", "")
        gift = pid.endswith("_gift")
        v = finali.get(code) or {"disp": p.get("available", True), "prezzo": float(p["price"]), "iva": p.get("vat"),
                                 "name": p["name"], "names": p.get("names") or {}}
        prezzo = 0 if gift else v["prezzo"]
        ws2.append([pid, p["category"], code, v["name"], "si" if v["disp"] else "no", prezzo, num_fmt(v["iva"]),
                    desc.get(code, "NON TROVATO")])
        ws3.append([pid, code, v["name"]] + [(v["names"].get(c) or v["name"]) for c, _ in LINGUE])
        if (v["disp"] != p.get("available", True) or abs(prezzo - float(p["price"])) > 1e-9 or v["name"] != p["name"]
                or (v["iva"] is not None and num_fmt(v["iva"]) != p.get("vat"))
                or any((v["names"].get(c) or v["name"]) != (p.get("names") or {}).get(c, p["name"]) for c, _ in LINGUE)):
            diverse.append(pid)
    for w in (ws2, ws3):
        for row in w.iter_rows(min_row=2):
            for c in row:
                c.fill = GRAY
        w["A1"].comment = Comment("Foglio generato dallo script a partire da 'Codici Mexal': non modificarlo "
                                  "(le modifiche si perdono). Modifica 'Codici Mexal'.", "Claude")
    for row in ws2.iter_rows(min_row=2):
        row[5].number_format = "0.00"
    wb.save(OUT)

    scrivi_codes_json({code: desc[code] for code in desc})
    print("Scritto:", CODES_JSON)
    print(f"Codici Mexal letti: {len(export)} | prodotti shop: {len(prods)} | non nello shop: {len(export) - len(usati & set(by_code))}")
    print("Scritto:", OUT)
    if vecchi:
        print("Prima esecuzione col nuovo formato: i valori dei vecchi fogli sono stati riportati in 'Codici Mexal'.")
    if desc_diverse:
        print(f"NOTA: {len(desc_diverse)} descrizioni nell'Excel sono diverse dall'esportazione Mexal "
              f"(Mexal e' ancora indietro?): {', '.join(desc_diverse)}")
    if problemi:
        print("\nATTENZIONE:")
        for x in problemi:
            print(" -", x)
        sys.exit(1)
    print("Tutti i prodotti dello shop hanno un codice Mexal valido.")
    if diverse:
        print(f"\nNOTA: nell'Excel {len(diverse)} prodotti sono diversi da products.json (id: {', '.join(diverse)}).")
        print("Per applicarli: python aggiorna_codici_mexal.py --importa")


if __name__ == "__main__":
    main()
