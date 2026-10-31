#!/usr/bin/env python3
"""fidelity.py — how close does LinkPresent draw each slide to a reference rendering?

    python3 tools/fidelity.py                     # every deck in decks/
    python3 tools/fidelity.py --deck brisa-hotels-campaign-pitch.pptx
    python3 tools/fidelity.py --threshold 0.9     # fail below 90% match (default 80%)

For every slide it renders a REFERENCE with LibreOffice (pptx → PDF → PNG) and the same slide in
LinkPresent's flat render mode (/linkpresent?render=1), at the same pixel size, and scores the
match. Writes state/fidelity/report.html: reference | LinkPresent | difference, worst slides first.

The score is the share of pixels that agree once both images are shrunk to 320 px wide and
softened, so it measures layout, colour and what is on the slide, not font anti-aliasing.
It is a guide, not a verdict: LibreOffice is not PowerPoint and has quirks of its own. Look at
the report; for a true PowerPoint reference, export the deck to PDF from PowerPoint and pass
--pdf-dir with a folder of <deck>.pdf files.

Needs (test-only): Playwright, LibreOffice (`soffice`) and Poppler (`pdftoppm`).
  macOS:  brew install --cask libreoffice && brew install poppler
  Linux:  apt install libreoffice-impress poppler-utils
"""
import argparse
import html
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "state", "fidelity")
SCORE_W = 320          # compare at this width
TOLERANCE = 40         # per-channel difference still counted as "the same"


def find_soffice():
    for c in (os.environ.get("HOLO_SOFFICE"), shutil.which("soffice"), shutil.which("libreoffice"),
              "/Applications/LibreOffice.app/Contents/MacOS/soffice"):
        if c and os.path.exists(c):
            return c
    return None


def tools_missing():
    miss = []
    if not find_soffice():
        miss.append("LibreOffice (soffice)")
    if not shutil.which("pdftoppm"):
        miss.append("Poppler (pdftoppm)")
    try:
        import PIL  # noqa: F401
    except ImportError:
        miss.append("Pillow (pip install pillow)")
    try:
        import playwright  # noqa: F401
    except ImportError:
        miss.append("Playwright")
    return miss


def reference_pngs(deck_path, w, h, pdf_dir=None):
    """PNG per visible slide at w×h, cached in state/fidelity/ref/<stem>/ until the deck changes."""
    stem = os.path.splitext(os.path.basename(deck_path))[0]
    ref = os.path.join(OUT, "ref", stem)
    stamp = os.path.join(ref, ".stamp")
    key = f"{os.path.getmtime(deck_path)}:{w}x{h}:{pdf_dir or ''}"
    if os.path.exists(stamp) and open(stamp).read() == key:
        return sorted(os.path.join(ref, f) for f in os.listdir(ref) if f.endswith(".png"))
    shutil.rmtree(ref, ignore_errors=True)
    os.makedirs(ref)
    with tempfile.TemporaryDirectory(prefix="holo-fid-") as tmp:
        pdf = os.path.join(pdf_dir, stem + ".pdf") if pdf_dir else None
        if not pdf or not os.path.exists(pdf):
            profile = os.path.join(tmp, "profile")
            env = dict(os.environ, SAL_USE_VCLPLUGIN="svp")
            subprocess.run([find_soffice(), f"-env:UserInstallation=file://{profile}", "--headless",
                            "--convert-to", "pdf", "--outdir", tmp, deck_path],
                           env=env, check=True, timeout=240, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            pdf = os.path.join(tmp, stem + ".pdf")
        subprocess.run(["pdftoppm", "-png", "-scale-to-x", str(w), "-scale-to-y", str(h), pdf, os.path.join(ref, "s")],
                       check=True, timeout=240)
    files = sorted(os.path.join(ref, f) for f in os.listdir(ref) if f.endswith(".png"))
    # pdftoppm pads numbers by page count (s-1 / s-01); normalise to s-001
    out = []
    for f in files:
        n = int(os.path.basename(f)[2:-4])
        dst = os.path.join(ref, f"s-{n:03d}.png")
        os.replace(f, dst)
        out.append(dst)
    open(stamp, "w").write(key)
    return sorted(out)


def score(a_path, b_path, diff_path):
    from PIL import Image, ImageChops, ImageFilter
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB").resize(a.size)
    h = round(a.height * SCORE_W / a.width)
    sa = a.resize((SCORE_W, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
    sb = b.resize((SCORE_W, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
    d = ImageChops.difference(sa, sb)
    r, g, bl = d.split()
    worst = ImageChops.lighter(ImageChops.lighter(r, g), bl)
    hist = worst.histogram()
    same = sum(hist[:TOLERANCE + 1]) / float(SCORE_W * h)
    # difference picture: the reference faded, mismatches painted red
    big = ImageChops.lighter(ImageChops.lighter(*ImageChops.difference(a, b).split()[:2]), ImageChops.difference(a, b).split()[2])
    mask = big.point(lambda v: 255 if v > TOLERANCE else 0).filter(ImageFilter.MaxFilter(3))
    faded = Image.blend(a, Image.new("RGB", a.size, "white"), .7)
    faded.paste(Image.new("RGB", a.size, (220, 30, 40)), mask=mask)
    faded.save(diff_path)
    return same


def run(deck_names=None, threshold=0.80, pdf_dir=None, base=None, log=print):
    """Score every slide. Returns [(deck, slide_no, score)] and writes the HTML report."""
    import pptx_deck
    from playwright.sync_api import sync_playwright
    decks_dir = os.path.join(ROOT, "decks")
    names = deck_names or sorted(n for n in os.listdir(decks_dir) if n.lower().endswith(".pptx") and not n.startswith(("~$", ".")))
    os.makedirs(OUT, exist_ok=True)
    own_server = None
    if not base:
        from check import free_port, start_server
        own_server, base = start_server(free_port())
    rows = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for name in names:
                path = os.path.join(decks_dir, name)
                d = pptx_deck.parse_deck(path)
                w, h = round(d["w"]), round(d["h"])
                t0 = time.time()
                refs = reference_pngs(path, w, h, pdf_dir)
                stem = os.path.splitext(name)[0]
                lp_dir = os.path.join(OUT, "lp", stem)
                os.makedirs(lp_dir, exist_ok=True)
                pg = browser.new_page(viewport={"width": w, "height": h})
                pg.goto(f"{base}/linkpresent?render=1&deck={urllib.parse.quote(name)}")
                pg.wait_for_function("() => window.__ready && window.__holo.deck", timeout=30000)
                n = len(d["slides"])
                if len(refs) != n:
                    log(f"  ! {name}: reference has {len(refs)} slides, LinkPresent {n}")
                scores = []
                for i in range(min(n, len(refs))):
                    pg.evaluate("i => window.__holo.showSlide(i, 1, true)", i)
                    pg.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
                    pg.wait_for_timeout(120)            # images decode
                    shot = os.path.join(lp_dir, f"s-{i + 1:03d}.png")
                    pg.screenshot(path=shot)
                    diff = os.path.join(lp_dir, f"d-{i + 1:03d}.png")
                    sc = score(refs[i], shot, diff)
                    rows.append((name, i + 1, sc, refs[i], shot, diff, d["slides"][i]["title"]))
                    scores.append(sc)
                pg.close()
                worst = min(scores) if scores else 0
                log(f"  {name}: mean {sum(scores) / max(1, len(scores)):.0%} · worst {worst:.0%} (slide {scores.index(worst) + 1 if scores else '-'}) · {time.time() - t0:.0f}s")
            browser.close()
    finally:
        if own_server:
            own_server.terminate()
    write_report(rows, threshold)
    return rows


def write_report(rows, threshold):
    rel = lambda p: os.path.relpath(p, OUT)
    body = []
    by_deck = {}
    for r in rows:
        by_deck.setdefault(r[0], []).append(r)
    body.append("<table class='sum'><tr><th>Deck</th><th>Slides</th><th>Mean</th><th>Worst</th><th>Below threshold</th></tr>")
    for deck, rs in by_deck.items():
        sc = [r[2] for r in rs]
        low = [str(r[1]) for r in rs if r[2] < threshold]
        body.append(f"<tr><td>{html.escape(deck)}</td><td>{len(rs)}</td><td>{sum(sc) / len(sc):.0%}</td><td>{min(sc):.0%}</td><td>{', '.join(low) or '—'}</td></tr>")
    body.append("</table>")
    for r in sorted(rows, key=lambda r: r[2]):
        deck, n, sc, ref, lp, diff, title = r
        cls = "bad" if sc < threshold else "ok"
        body.append(f"<section><h2><span class='{cls}'>{sc:.0%}</span> {html.escape(deck)} · slide {n} · {html.escape(title or '')}</h2>"
                    f"<div class='row'><figure><img src='{rel(ref)}'><figcaption>Reference (LibreOffice)</figcaption></figure>"
                    f"<figure><img src='{rel(lp)}'><figcaption>LinkPresent</figcaption></figure>"
                    f"<figure><img src='{rel(diff)}'><figcaption>Differences in red</figcaption></figure></div></section>")
    page = f"""<!doctype html><meta charset="utf-8"><title>LinkPresent fidelity</title>
<style>body{{font:14px/1.5 system-ui,sans-serif;margin:24px;background:#f4f6f7;color:#1b252c}}h1{{margin:0 0 4px}}
.sum{{border-collapse:collapse;margin:16px 0 28px;background:#fff}}.sum td,.sum th{{padding:6px 12px;border:1px solid #d5dde1;text-align:left}}
section{{background:#fff;border:1px solid #d5dde1;border-radius:8px;padding:12px 14px;margin:14px 0}}h2{{font-size:15px;margin:0 0 10px}}
.row{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}}figure{{margin:0}}img{{width:100%;border:1px solid #d5dde1}}
figcaption{{font-size:12px;color:#5f6b72}}.bad,.ok{{display:inline-block;min-width:46px;padding:2px 8px;border-radius:99px;color:#fff;text-align:center}}
.bad{{background:#b23a3a}}.ok{{background:#3f8f5b}}</style>
<h1>LinkPresent fidelity</h1><p>Share of pixels that match a LibreOffice reference after shrinking to {SCORE_W}px and softening.
Threshold {threshold:.0%}. Worst slides first. Generated {time.strftime('%Y-%m-%d %H:%M')}.</p>{''.join(body)}"""
    open(os.path.join(OUT, "report.html"), "w").write(page)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--deck", action="append", help="only this deck (repeatable)")
    ap.add_argument("--threshold", type=float, default=0.80, help="minimum match per slide (default 0.80)")
    ap.add_argument("--pdf-dir", help="folder of <deck>.pdf exported from PowerPoint, used instead of LibreOffice")
    a = ap.parse_args()
    miss = tools_missing()
    if miss:
        print("Missing: " + ", ".join(miss) + "\nSee the top of tools/fidelity.py for install commands.")
        sys.exit(2)
    rows = run(a.deck, a.threshold, a.pdf_dir)
    low = [r for r in rows if r[2] < a.threshold]
    print(f"\n{len(rows) - len(low)}/{len(rows)} slides at or above {a.threshold:.0%} · report: {os.path.relpath(os.path.join(OUT, 'report.html'), ROOT)}")
    for r in sorted(low, key=lambda r: r[2]):
        print(f"  {r[2]:.0%}  {r[0]} · slide {r[1]} · {r[6]}")
    sys.exit(1 if low else 0)


if __name__ == "__main__":
    main()
