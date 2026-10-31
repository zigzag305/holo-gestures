#!/usr/bin/env python3
"""check.py — run every HOLO / LinkPresent check with one command.

    python3 tools/check.py            # everything: parser, server, both probe batteries, screenshots
    python3 tools/check.py --quick    # no browser: parser + server routes only (seconds)
    python3 tools/check.py --all-slides   # also screenshot every slide of every deck

What it does
  1. parses every .pptx in decks/ with pptx_deck.py
  2. starts server.py on a free port and checks its routes (and that files outside
     the allowed folders are refused)
  3. opens holo.html?probe=1 and linkpresent.html?probe=1 in headless Chromium and
     reads their scores, plus any page errors
  4. saves screenshots to state/check/ (normal, pulled apart, meeting view)
  5. scores every slide against a LibreOffice reference (tools/fidelity.py) when LibreOffice
     and Poppler are installed; the side-by-side report lands in state/fidelity/report.html

Prints PASS/FAIL per check and exits 0 only if everything passed.

The app itself needs only Python. This test tool also needs Playwright:
    pip install playwright && python3 -m playwright install chromium
"""
import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
OUT = os.path.join(ROOT, "state", "check")

RESULTS = []


def report(name, ok, info=""):
    RESULTS.append((name, bool(ok), info))
    mark = "\033[32mPASS\033[0m" if ok else "\033[31mFAIL\033[0m"
    if not sys.stdout.isatty():
        mark = "PASS" if ok else "FAIL"
    print(f"  {mark}  {name}" + (f"  · {info}" if info else ""), flush=True)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get(url, timeout=20):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


# ---------------------------------------------------------------- 1. parser
def check_parser():
    print("\nParser (pptx_deck.py)")
    import pptx_deck
    decks_dir = os.path.join(ROOT, "decks")
    names = sorted(n for n in os.listdir(decks_dir) if n.lower().endswith(".pptx") and not n.startswith(("~$", ".")))
    if not names:
        report("decks/ has at least one .pptx", False, "folder is empty")
    for n in names:
        try:
            t = time.time()
            d = pptx_deck.parse_deck(os.path.join(decks_dir, n))
            pieces = sum(len(s["pieces"]) for s in d["slides"])
            charts = [p for s in d["slides"] for p in s["pieces"] if p["kind"] == "chart"]
            empty = [c for c in charts if not any(v is not None for ser in c["chart"]["series"] for v in ser["vals"])]
            report(f"parse {n}", d["slides"] and not empty,
                   f"{len(d['slides'])} slides · {pieces} pieces · {len(charts)} charts · {time.time() - t:.2f}s"
                   + (f" · {len(empty)} charts without data" if empty else ""))
        except Exception as e:  # noqa: BLE001 — any parser crash is a failed check
            report(f"parse {n}", False, f"{type(e).__name__}: {e}")
    return names


# ---------------------------------------------------------------- 2. server
def start_server(port):
    env = dict(os.environ, HOLO_PORT=str(port))
    proc = subprocess.Popen([sys.executable, "server.py"], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        if proc.poll() is not None:
            raise RuntimeError("server.py exited: " + proc.stderr.read().decode(errors="replace")[-800:])
        try:
            if get(base + "/api/decks", timeout=2)[0] == 200:
                return proc, base
        except OSError:
            pass
        time.sleep(.1)
    proc.kill()
    raise RuntimeError("server.py did not answer within 10 s")


def check_routes(base, deck_names):
    print("\nServer routes (server.py)")
    for path, want, ctype in (("/", 200, "text/html"), ("/linkpresent", 200, "text/html"),
                              ("/js/hands.js", 200, "javascript"), ("/api/tree", 200, "json"),
                              ("/api/decks", 200, "json")):
        code, body = get(base + path)
        report(f"GET {path}", code == want, f"{code} · {len(body)} bytes")
    if deck_names:
        code, body = get(base + "/api/deck?name=" + urllib.request.quote(deck_names[0]))
        ok = code == 200 and json.loads(body).get("slides")
        report("GET /api/deck (first deck)", ok, f"{code}")
    for path in ("/js/../server.py", "/vendor/../holo.json", "/js/%2e%2e/server.py",
                 "/api/deck/media?name=../server.py&p=ppt/x.png", "/api/deck?name=../server.py"):
        code, _ = get(base + path)
        report(f"refuses {path}", code in (400, 404), str(code))
    req = urllib.request.Request(base + "/api/deck/upload?name=x.pptx", data=b"not a pptx", method="POST")
    try:
        code = urllib.request.urlopen(req, timeout=10).status
    except urllib.error.HTTPError as e:
        code = e.code
    report("upload rejects a non-.pptx file", code == 400, str(code))


# ---------------------------------------------------------------- 3 + 4. browser
def check_browser(base, deck_names, all_slides):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        report("browser checks", False, "Playwright missing: pip install playwright && python3 -m playwright install chromium")
        return
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith(".png"):
            os.remove(os.path.join(OUT, f))
    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        def page():
            pg = browser.new_page(viewport={"width": 1440, "height": 900})
            pg.errors = []
            pg.on("pageerror", lambda e: pg.errors.append(str(e)))
            return pg

        print("\nHOLO notes deck (holo.html?probe=1)")
        pg = page()
        pg.goto(base + "/?probe=1")
        try:
            pg.wait_for_function("() => /^PROBE/.test(document.title)", timeout=90000)
            title = pg.title()
            score = title.split(" · ")[0].replace("PROBE ", "")
            passed, total = (int(x) for x in score.split("/"))
            fails = [t[5:] for t in title.split() if t.startswith("FAIL:")]
            report("holo probe battery", passed == total, score + (" · failed: " + ", ".join(fails) if fails else ""))
        except Exception as e:  # noqa: BLE001
            report("holo probe battery", False, f"no result: {e}")
        loop_err = pg.evaluate("() => window.__loopErr || null")
        report("holo: no page errors", not pg.errors and not loop_err, "; ".join(pg.errors[:2]) or (loop_err or ""))
        pg.screenshot(path=os.path.join(OUT, "holo-after-probe.png"))   # board state at the end of the battery
        pg.close()

        print("\nLinkPresent (linkpresent.html?probe=1)")
        pg = page()
        # the battery's expectations (slide count, charts) are written for the sample deck
        pg.goto(base + "/linkpresent?probe=1&deck=velora-q3-2026-qbr.pptx")
        try:
            pg.wait_for_function("() => window.__probe", timeout=90000)
            r = pg.evaluate("() => window.__probe")
            for x in r["results"]:
                if not x["pass"]:
                    report(f"  probe: {x['name']}", False, x.get("info", ""))
            report("linkpresent probe battery", r["pass"] == r["total"], f"{r['pass']}/{r['total']}")
        except Exception as e:  # noqa: BLE001
            report("linkpresent probe battery", False, f"no result: {e}")
        loop_err = pg.evaluate("() => window.__loopErr || null")
        report("linkpresent: no page errors", not pg.errors and not loop_err, "; ".join(pg.errors[:2]) or (loop_err or ""))
        pg.close()

        print("\nScreenshots → state/check/")
        shots = 0
        for name in deck_names:
            stem = os.path.splitext(name)[0]
            pg = page()
            pg.goto(base + "/linkpresent?deck=" + urllib.request.quote(name))
            pg.wait_for_function("() => window.__holo && window.__holo.deck", timeout=30000)
            pg.evaluate("() => document.body.classList.add('nolegend')")
            n = pg.evaluate("() => window.__holo.deck.slides.length")
            picks = list(range(n)) if all_slides else sorted({0, min(1, n - 1), n // 2, n - 1})
            for i in picks:
                pg.evaluate("i => window.__holo.showSlide(i, 1, true)", i)
                pg.wait_for_timeout(1700)            # layers fly in, charts animate
                pg.screenshot(path=os.path.join(OUT, f"{stem}-{i + 1:02d}.png")); shots += 1
            mid = n // 2
            pg.evaluate("i => window.__holo.showSlide(i, 1, true)", mid)
            pg.wait_for_timeout(1700)
            pg.keyboard.press("e"); pg.wait_for_timeout(1500)
            pg.screenshot(path=os.path.join(OUT, f"{stem}-{mid + 1:02d}-apart.png")); shots += 1
            pg.keyboard.press("e"); pg.keyboard.press("o"); pg.wait_for_timeout(2600)
            pg.screenshot(path=os.path.join(OUT, f"{stem}-meeting-view.png")); shots += 1
            report(f"screenshots {name}", not pg.errors, f"{len(picks) + 2} images" + (" · " + pg.errors[0] if pg.errors else ""))
            pg.close()
        browser.close()
        print(f"  {shots + 1} images saved in {os.path.relpath(OUT, ROOT)}/ — look at them, a passing probe does not prove a slide looks right")


# ---------------------------------------------------------------- 5. fidelity
def check_fidelity(base, threshold):
    print("\nFidelity vs a LibreOffice reference (tools/fidelity.py)")
    import fidelity
    miss = fidelity.tools_missing()
    if miss:
        print("  SKIP  needs " + ", ".join(miss) + " — install them to score slides (see tools/fidelity.py)")
        return
    rows = fidelity.run(base=base, threshold=threshold, log=lambda m: None)
    by_deck = {}
    for r in rows:
        by_deck.setdefault(r[0], []).append(r)
    for deck, rs in by_deck.items():
        low = [r for r in rs if r[2] < threshold]
        worst = min(rs, key=lambda r: r[2])
        report(f"fidelity {deck}", not low,
               f"mean {sum(r[2] for r in rs) / len(rs):.0%} · worst {worst[2]:.0%} (slide {worst[1]})"
               + (f" · below {threshold:.0%}: slides " + ", ".join(str(r[1]) for r in low) if low else ""))
    print("  report: state/fidelity/report.html — worst slides first")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--quick", action="store_true", help="skip the browser (parser + server routes only)")
    ap.add_argument("--all-slides", action="store_true", help="screenshot every slide, not a sample")
    ap.add_argument("--no-fidelity", action="store_true", help="skip the slide-by-slide comparison with LibreOffice")
    ap.add_argument("--fidelity-threshold", type=float, default=0.80, help="minimum match per slide (default 0.80)")
    a = ap.parse_args()
    t0 = time.time()
    decks = check_parser()
    proc = None
    try:
        port = free_port()
        proc, base = start_server(port)
        print(f"\n(server.py on port {port})")
        check_routes(base, decks)
        if not a.quick:
            check_browser(base, decks, a.all_slides)
            if not a.no_fidelity:
                check_fidelity(base, a.fidelity_threshold)
    except Exception as e:  # noqa: BLE001
        report("run", False, str(e))
    finally:
        if proc:
            proc.terminate()
            try:
                proc.wait(5)
            except subprocess.TimeoutExpired:
                proc.kill()
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed in {time.time() - t0:.0f}s")
    if failed:
        print("FAILED: " + ", ".join(r[0].strip() for r in failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
