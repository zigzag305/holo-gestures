#!/usr/bin/env python3
"""HOLO — hand-gesture control deck (Jarvis V7 prototype). Stdlib only, port 4890.

Serves the deck page + the note cards it manipulates. Hand tracking is Google
MediaPipe (Apache-2.0) loaded from CDN in the page; every gesture on top is ours,
written clean — no third-party gesture code. Camera frames never leave the page.

Endpoints:
  GET  /               → holo.html
  GET  /api/notes      → [{name, title, body}] from the folder in holo.json
                         (falls back to ./sample-notes so it runs instantly)
  GET  /linkpresent    → linkpresent.html — LINKPRESENT: a .pptx pulled apart into layers
  GET  /api/decks       → [{name, size, mtime}] of the .pptx files in decks/
  GET  /api/deck?name=  → that deck unpacked into layered pieces (pptx_deck.py)
  GET  /api/deck/media  → one picture out of a deck (?name=&p=ppt/media/…)
  POST /api/deck/upload → save a .pptx into decks/ (?name=file.pptx, raw body)
  POST /api/state      → future Jarvis hook: writes state/holo-state.json so the
                         big brain can react to what the hands did ("Card pinned,
                         sir"). Nothing reads it yet by design — prototype stays
                         standalone until proven.
"""
import json, os, re, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

import pptx_deck

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("HOLO_PORT", "4890"))

# the page, cached at boot: long-lived processes on macOS can silently lose file
# access (TCC) hours in — serving the boot-time copy beats a 500 "missing" page
try:
    PAGE_CACHE = [open(os.path.join(ROOT, "holo.html"), "rb").read()]
except OSError:
    PAGE_CACHE = [None]

def notes_dir():
    try:
        cfg = json.load(open(os.path.join(ROOT, "holo.json")))
        d = os.path.expanduser(cfg.get("folder", ""))
        if d and os.path.isdir(d):
            return d
    except Exception:
        pass
    return os.path.join(ROOT, "sample-notes")

def _note(path, n):
    try:
        text = open(path, encoding="utf-8", errors="ignore").read()
    except OSError:
        return None
    lines = [l for l in text.splitlines() if l.strip()]
    title = (lines[0].lstrip("# ").strip() if lines else n)[:48] or n
    rest = [l for l in lines[1:] if not l.startswith("#")]
    return {"name": n, "title": title, "body": "\n".join(rest)[:420],
            "full": "\n".join(lines[1:])[:4000]}

def load_notes(limit=18):
    out = []
    d = notes_dir()
    try:
        for n in sorted(x for x in os.listdir(d) if x.endswith((".md", ".txt")))[:limit]:
            note = _note(os.path.join(d, n), n)
            if note: out.append(note)
    except OSError:
        pass
    return out

def load_tree(limit_files=14):
    """One level deep: subfolders become ORBS; loose root files gather under 'NOTES'."""
    d = notes_dir()
    tree = []
    try:
        entries = sorted(os.listdir(d))
        loose = []
        for e in entries:
            p = os.path.join(d, e)
            if os.path.isdir(p) and not e.startswith("."):
                files = []
                for n in sorted(x for x in os.listdir(p) if x.endswith((".md", ".txt")))[:limit_files]:
                    note = _note(os.path.join(p, n), n)
                    if note: files.append(note)
                if files:
                    tree.append({"kind": "folder", "name": e.upper()[:22], "files": files})
            elif e.endswith((".md", ".txt")):
                note = _note(p, e)
                if note: loose.append(note)
        if loose:
            tree.append({"kind": "folder", "name": "NOTES", "files": loose[:limit_files]})
    except OSError:
        pass
    return tree

# ---------- LINKPRESENT: decks/ holds the .pptx files the stage can present ----------
def decks_dir():
    try:
        cfg = json.load(open(os.path.join(ROOT, "holo.json")))
        d = os.path.expanduser(cfg.get("decks", ""))
        if d and os.path.isdir(d):
            return d
    except Exception:
        pass
    d = os.path.join(ROOT, "decks")
    os.makedirs(d, exist_ok=True)
    return d

def list_decks():
    d = decks_dir()
    out = []
    for n in os.listdir(d):
        if n.lower().endswith(".pptx") and not n.startswith(("~$", ".")):
            st = os.stat(os.path.join(d, n))
            out.append({"name": n, "size": st.st_size, "mtime": st.st_mtime})
    return sorted(out, key=lambda x: -x["mtime"])

def deck_path(name):
    """Only plain file names inside decks/ — never a path from the request."""
    if not name or os.path.basename(name) != name or not name.lower().endswith(".pptx"):
        return None
    p = os.path.join(decks_dir(), name)
    return p if os.path.isfile(p) else None

DECK_CACHE = {}
def load_deck(name):
    p = deck_path(name)
    if not p:
        return None
    key = (p, os.path.getmtime(p))
    if key not in DECK_CACHE:
        url = lambda part: "/api/deck/media?name=%s&p=%s" % (quote(name), quote(part))
        DECK_CACHE.clear()
        DECK_CACHE[key] = pptx_deck.parse_deck(p, url)
    return DECK_CACHE[key]

MAX_UPLOAD = 200 * 1024 * 1024

class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        if ctype.startswith("text/html"):
            self.send_header("Cache-Control", "no-store")   # a stale cached page hid real fixes once
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    MIME = {".mjs": "text/javascript", ".js": "text/javascript",
            ".wasm": "application/wasm", ".task": "application/octet-stream",
            ".glb": "model/gltf-binary", ".png": "image/png", ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
            ".webp": "image/webp", ".bmp": "image/bmp"}

    def do_GET(self):
        p = self.path.split("?")[0]
        if p in ("/", "/holo.html"):
            try:
                body = open(os.path.join(ROOT, "holo.html"), "rb").read()
                PAGE_CACHE[0] = body
            except OSError:
                body = PAGE_CACHE[0]          # disk access lost (TCC) — serve the boot copy
            if body is None:
                return self._send(500, {"error": "holo.html missing"})
            return self._send(200, body, "text/html; charset=utf-8")
        if p in ("/linkpresent", "/linkpresent.html"):
            try:
                body = open(os.path.join(ROOT, "linkpresent.html"), "rb").read()
            except OSError:
                return self._send(500, {"error": "linkpresent.html missing"})
            return self._send(200, body, "text/html; charset=utf-8")
        if p == "/api/decks":
            return self._send(200, list_decks())
        if p == "/api/deck":
            qs = parse_qs(urlparse(self.path).query)
            name = (qs.get("name") or [""])[0]
            if not name:
                ds = list_decks()
                name = ds[0]["name"] if ds else ""
            try:
                deck = load_deck(name)
            except Exception as e:
                return self._send(422, {"error": "could not read %s: %s" % (name, e)})
            if deck is None:
                return self._send(404, {"error": "no deck — drop a .pptx into decks/ or onto the page"})
            return self._send(200, deck)
        if p == "/api/deck/media":
            qs = parse_qs(urlparse(self.path).query)
            dp = deck_path((qs.get("name") or [""])[0])
            part = (qs.get("p") or [""])[0]
            data = pptx_deck.read_media(dp, part) if dp else None
            if data is None:
                return self._send(404, {"error": "not found"})
            return self._send(200, data, self.MIME.get(os.path.splitext(part)[1].lower(), "application/octet-stream"))
        if p == "/api/props":
            # PROPS: any .glb dropped into props/ becomes a grabbable 3D object
            try:
                names = sorted(x for x in os.listdir(os.path.join(ROOT, "props"))
                               if x.endswith(".glb"))[:6]
            except OSError:
                names = []
            return self._send(200, names)
        if p.startswith(("/vendor/", "/props/")):
            # self-hosted tracking libs: no CDN in the path, so ad-block extensions
            # and offline machines can't kill the hand tracking
            safe = os.path.normpath(p.lstrip("/"))
            if safe.startswith(("vendor", "props")) and ".." not in safe:
                full = os.path.join(ROOT, safe)
                if os.path.isfile(full):
                    ext = os.path.splitext(full)[1]
                    try:
                        return self._send(200, open(full, "rb").read(),
                                          self.MIME.get(ext, "application/octet-stream"))
                    except OSError:
                        pass
            return self._send(404, {"error": "not found"})
        if p == "/api/notes":
            return self._send(200, load_notes())
        if p == "/api/tree":
            return self._send(200, load_tree())
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        p = self.path.split("?")[0]
        if p == "/api/diag":              # the page phones home its own crash report
            try:
                n = int(self.headers.get("Content-Length") or 0)
                data = json.loads(self.rfile.read(n) or b"{}")
            except Exception:
                data = {}
            data["ts"] = time.time()
            try:
                os.makedirs(os.path.join(ROOT, "state"), exist_ok=True)
                with open(os.path.join(ROOT, "state", "holo-diag.json"), "w") as f:
                    json.dump(data, f, indent=2)
            except OSError:
                pass
            return self._send(200, {"ok": True})
        if p == "/api/deck/upload":
            qs = parse_qs(urlparse(self.path).query)
            raw = os.path.basename((qs.get("name") or ["deck.pptx"])[0])
            name = re.sub(r"[^\w .()-]", "_", raw).strip() or "deck.pptx"
            if not name.lower().endswith(".pptx"):
                return self._send(400, {"error": "only .pptx files (save as PowerPoint .pptx first)"})
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > MAX_UPLOAD:
                return self._send(413, {"error": "file too large or empty"})
            data = self.rfile.read(n)
            if data[:2] != b"PK":
                return self._send(400, {"error": "that is not a .pptx file"})
            path = os.path.join(decks_dir(), name)
            with open(path, "wb") as f:
                f.write(data)
            try:
                deck = load_deck(name)
            except Exception as e:
                return self._send(422, {"error": "saved, but could not read it: %s" % e})
            return self._send(200, {"name": name, "slides": len(deck["slides"])})
        if p != "/api/state":
            return self._send(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            data = {}
        data["ts"] = time.time()
        try:
            os.makedirs(os.path.join(ROOT, "state"), exist_ok=True)
            tmp = os.path.join(ROOT, "state", ".holo-state.tmp")
            with open(tmp, "w") as f:
                json.dump(data, f)
            os.replace(tmp, os.path.join(ROOT, "state", "holo-state.json"))
        except OSError:
            pass
        return self._send(200, {"ok": True})

if __name__ == "__main__":
    print(f"HOLO deck on http://localhost:{PORT}  ·  notes: {notes_dir()}")
    print(f"LinkPresent on http://localhost:{PORT}/linkpresent  ·  decks: {decks_dir()}")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
