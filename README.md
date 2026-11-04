# ✋ HOLO — Control Your Notes With Your Hands, In The Air

![HOLO — folder orbs and a real Smithsonian Apollo 11 scan floating over your webcam feed](assets/banner.png)
*Your notes as floating orbs, a real Apollo 11 capsule scan on the shelf — all controlled by your hands in mid-air.*

Turn your webcam into an **Iron Man interface for your markdown notes**. Folders float as orbs
over your own mirrored video. You pinch files out of the air, throw them with real momentum,
crush a note between two hands and an AI voice reads you the gist.

Everything runs **on your machine**. No cloud, no API keys, no accounts, no sign-up.
Camera frames never leave the page.

> The hand tracking is Google MediaPipe (Apache-2.0), **self-hosted inside this repo** —
> so ad-blockers, CDN outages, and offline machines can't break it.

---

## ⚡ Install (one command)

```bash
git clone https://github.com/zubair-trabzada/holo-gestures.git ~/holo && cd ~/holo && python3 server.py
```

Then open **http://localhost:4890** in Chrome, allow the camera, and raise a hand. That's it.

Presenting a PowerPoint? Open **http://localhost:4890/linkpresent** instead — see *LinkPresent* below.

Python 3 is the only requirement (standard library only — nothing to `pip install`).

> Already installed? Update with:
> ```bash
> cd ~/holo && git pull && python3 server.py
> ```

---

## 🖐 The gestures

| Do this | Get this |
|---|---|
| **Pinch** a card | grab it, drag it, throw it with real momentum |
| **Quick pinch** (a tap) | an orb fans out its files · a note opens in the reader |
| **Flick** a note off-screen | it evaporates (reopen its orb to bring it back) |
| **Two pinches**, apart / together | zoom the whole scene · twist to rotate it |
| **Two-hand stretch** on a held card | pull big to read it · crush small for a spoken summary |
| **Peace sign ✌** held | resets everything to its original place — a refresh without the refresh |
| Drag to the **right edge** | docks the card on the shelf |
| Press **F** | EFFECTS: palm-hold repulsor · palm→fist force-pull · point to draw ink · clap · two-palm tidy |
| Press **J** | JARVIS mode — the deck goes gold and a local voice narrates what your hands do |

An on-screen legend shows all of it while you play. A pinch means your thumb and finger
**actually touch** — near-misses are ignored on purpose.

---

## 🦴 3D props — drop in any model

Two real **Smithsonian** scans ship with it, both public domain: the **Apollo 11 Command
Module** (the actual Columbia, scorch marks and all) and a **Triceratops** skeleton.

Grab one and twist your wrist to spin it. **Stretch it bigger with two hands and it comes
apart** — the closer you zoom, the further the pieces separate. Shrink it and it fuses back
together. Even single-mesh scans get sliced into shards at load, so *everything* opens up.

Drop any `.glb` into `props/` and it appears on the deck:

```
props/
  apollo-11-module.glb
  triceratops.glb
  your-model-here.glb     ← any .glb works
```

If a downloaded model refuses to load it's usually Draco-compressed. Decompress it once:

```bash
npx @gltf-transform/cli copy in.glb out.glb
```

---

## 📁 Point it at your own notes

Edit `holo.json`:

```json
{"folder": "/path/to/your/notes"}
```

Subfolders become orbs, files become the cards you pinch out of the air. It ships pointed at
`sample-notes/` so it works the second you run it.

---

## 🛠 Make it yours

Readable HTML pages, a few plain JavaScript modules and a small Python server, MIT licensed —
no build step. The hand engine both pages share lives in `js/hands.js`, and every gesture
threshold is a named constant there (`PINCH_IN`, `PINCH_OUT`, `PINCH_EARN`, `AMP`).

- `?sim=1` — a scripted demo plays with synthetic hands, no camera needed
- `?probe=1` — the built-in test battery runs the real engine on synthetic frames (**26/26**)
- `HOLO_PORT=4891 python3 server.py` — run it on another port
- The mouse works as a fallback everywhere

Change something, then run every check with one command:

```bash
pip install playwright && python3 -m playwright install chromium   # once — only the tests need it
python3 tools/check.py          # parser, server, both test batteries, screenshots in state/check/
python3 tools/check.py --quick  # no browser, a few seconds
```

It prints PASS/FAIL per check and exits non-zero on any failure. GitHub runs the same command
on every pull request. With LibreOffice and Poppler installed (`brew install --cask libreoffice &&
brew install poppler` on a Mac) it also scores how closely LinkPresent draws every slide — see
*Fidelity* below.

---

## 🎤 LinkPresent — present a PowerPoint with your hands (Teams · Zoom · Meet)

Same server, second page: **http://localhost:4890/linkpresent**

Build your deck in PowerPoint like always. LinkPresent unpacks the `.pptx` into its real objects —
every title, card, picture, table and chart becomes its own layer floating over your camera.
Pull a slide apart in mid-air, grab one chart out of it, tap a number to blow it up.
Charts aren't screenshots: they're **rebuilt live from the numbers stored inside the file**,
so bars grow in and doughnut slices pop out when the slide comes apart.

**Load a deck:** drop a `.pptx` anywhere on the page · or **LOAD .PPTX** · or put it in `decks/`
(six sample decks ship there — see *Sample decks* below). Point it at another folder with
`{"decks": "/path/to/decks"}` in `holo.json`.

Everything works with **one hand**: you talk, you point.

| Do this | Get this |
|---|---|
| **Point** (index finger out) | red laser dot for the audience |
| Point at the **›** on the right edge and **hold** (~½ s, the ring fills) | next slide |
| Point at the **‹** on the left edge and hold | previous slide |
| Point at the **✦** at the top right and hold | the slide comes apart into floating layers · again = rebuild |
| **👌** on a piece: thumb and index touching, **other three fingers up** | grab it out of the slide and move it; open to drop it |
| **Quick 👌** on a piece, then open | focus: it flies to the front, everything else dims · again = back |
| 👌 on empty space and drag | turn the slide in 3D |
| **Peace ✌** held | reset the slide |
| *Optional, two hands:* hold a piece + **👌** with the other hand, stretch | resize just that piece |
| *Optional, two hands:* **👌👌** pull apart / together | explode / rebuild · **twist** = turn |
| *Off by default (**W**):* right hand sweeps left / left hand sweeps right | next / previous |

Why point-and-hold instead of swiping: in a normal room in the evening a laptop webcam runs at 8–11
frames a second, and the hand tracker loses a fast-moving hand completely; it only sees the slow trip
back, which looks like a swipe the other way. A held finger survives that. Why 👌 and not any pinch: a
hand resting while you talk is curled, and a curled hand touches thumb to index all the time.

**Layout:** you sit in a **self-view tile at the bottom right**, like any meeting app, with the slide
large. Your hands still steer across the whole screen. **L** switches to the hologram layouts (slide
floating over the full camera, or beside you).

**On screen:** the page opens with a card for each gesture (**?** hides it and brings it back).
While you present, the ring at your fingertip fills as thumb and index close (full, with the other fingers up = 👌), and
a label under it says what LinkPresent sees: *laser*, *hold · next slide*, *👌 to grab*, *holding chart*, *lift the other 3 fingers*… —
so you learn the poses fast, and a misread shows the moment it happens. Meeting view hides the labels.
A grab holds through brief tracking glitches: one misread frame, or the hand lost for a split second.

Keys work too (presenter clickers send these): **← →** / PageUp / PageDown · **E** explode ·
**R** reset · **O** meeting view (hides all controls) · **N** speaker notes · **C** camera
brightness · **G** slide glass · **L** layout (self-view tile, or the hologram layouts) · **W** swipes on/off · **F** fullscreen · **?** help.
Mouse: drag pieces, drag empty space to turn, wheel to pull apart, double-click to reset.

### Use it in a meeting (any app, via OBS Virtual Camera)

1. Install **OBS Studio** (free).
2. Open `http://localhost:4890/linkpresent` in Chrome, press **O** (meeting view) and **F** (fullscreen),
   or keep it as its own window.
3. In OBS: **Sources → + → Window Capture** (macOS: *macOS Screen Capture → Window*) → pick that
   Chrome window. Then **Start Virtual Camera**.
4. In Teams / Zoom / Meet → camera settings → choose **OBS Virtual Camera**.

Good to know:
- LinkPresent uses your **real** webcam; the meeting app uses **OBS Virtual Camera**. If the meeting app
  grabs the real webcam too, Windows may report it busy.
- **Don't flip the video in OBS.** Your camera is mirrored on purpose so your hand lines up with
  what you touch; the slide text is drawn separately and is never mirrored. (Your *own* self-view in
  Teams may look flipped — the audience sees it the right way.)
- Keep the LinkPresent window visible: Chrome slows down hand tracking in hidden windows.

**What carries over from PowerPoint:** text and fonts (layout and master inheritance, bullets and
numbering styles, shrink-to-fit, columns, vertical text), shapes (rotation, flips, groups,
gradients, connectors with arrowheads), pictures and picture backgrounds, tables with merged cells,
native charts with their real data (column, bar, stacked, 100%, line, area, scatter, pie, doughnut,
and column + line combos on two axes), theme colours, hidden slides, speaker notes.
**What doesn't:** PowerPoint's own animations and transitions (LinkPresent brings its own motion),
SmartArt internals, embedded video, EMF/WMF pictures; table styles are approximated.

Test it without a camera: `/linkpresent?sim=1` plays a scripted demo with synthetic hands ·
`/linkpresent?probe=1&deck=velora-q3-2026-qbr.pptx` runs the gesture test battery (**31/31**) ·
`/linkpresent?clean=1` opens in meeting view · `/linkpresent?render=1` shows the bare slide, flat ·
`/linkpresent?record=1` records your hands · `/linkpresent?replay=<name>` replays a recording.
Parser on its own: `python3 pptx_deck.py decks/your.pptx`.

### Record your hands (so the gestures get tuned to real people)

Open **http://localhost:4890/linkpresent?record=1** with your webcam on. A coach walks you through
eight short takes: just presenting (nothing should fire), pointing at the next / back / pull-apart
targets, grabbing a chart, tapping to bring a card forward, the laser pointer and the peace-sign reset.
Do each one naturally; the coach shows live what the engine saw. **Space** starts and ends a take,
**R** redoes it, **S** skips it.

Only the 21 hand points per camera frame are saved — never an image — to
`recordings/hands-<date>.json.gz` on your computer. Send that file to Claude or commit it: every take
becomes a test that `tools/check.py` replays through the real camera path, so a gesture that misfired
for you stays fixed. A take the engine missed is the most useful one to keep.

When a gesture is redesigned, a take done the old way keeps its frames but gets a `revised` goal with
the reason (usually: the old movement must now fire nothing). `recordings/hands-20261101-1135` is the
first real session; its revisions explain what changed and why.

`recordings/synthetic-smoke.json.gz` is a simulated session (made by
`tools/make_synthetic_recording.js`) that keeps the record → replay pipeline tested until real
recordings arrive.

### Sample decks

All companies and figures are fictional. Each deck is built a different way on purpose, because
PowerPoint files differ depending on what made them:

| Deck | Built with | What it stresses |
|---|---|---|
| `velora-q3-2026-qbr` | pptxgenjs | 18-slide business review: KPIs, P&L table, roadmap, charts |
| `brisa-hotels-campaign-pitch` | pptxgenjs | photos: picture backgrounds, cropped and full-bleed images, transparency, a logo on the layout |
| `norte-logistics-sales-kickoff` | python-pptx, default template (4:3) | layout inheritance, bullet levels, numbering, five chart types, merged table cells |
| `quanta-health-product-roadmap` | python-pptx | groups inside groups, rotation and flips, chevrons, stars, elbow connectors, gradients |
| `ribera-foods-board-report` | pptxgenjs, re-saved by LibreOffice | dense tables, column + line combo on two axes, 100% stacked, scatter |
| `taller-venta-consultiva` | python-pptx (16:10, Spanish) | mixed formatting, lettered numbering, shrink-to-fit, two columns, vertical text, hidden slide |

### Fidelity

`python3 tools/fidelity.py` compares every slide with a reference and LinkPresent's flat render
mode, scores how many pixels agree, and writes `state/fidelity/report.html` (reference |
LinkPresent | differences, worst slides first). The reference is PowerPoint's own PDF export in
`decks/pdf/<deck>.pdf` when there is one, otherwise a LibreOffice rendering (LibreOffice is not
PowerPoint, so for those decks treat the score as a guide). To add a PowerPoint reference: open the
deck in PowerPoint, File → Export → PDF, save it as `decks/pdf/<deck>.pdf`.

---

## 🚀 Want to go further?

This deck is the **hands**. It came out of building **JARVIS** — an AI second brain with a 3D
galaxy of every note you own that you steer with these same gestures, a voice you talk to that
answers from your notes, phone calls it makes on your behalf, email and calendar, a
computer-takeover mode, and eyes that can see you.

**Join the free AI Workshop community** for the walkthroughs, the prompt packs, and every build
like this one:

### 👉 [skool.com/aiworkshop-lite](https://www.skool.com/aiworkshop-lite)

Watch it get built: [youtube.com/@mygptworkshop](https://www.youtube.com/@mygptworkshop)

---

## 📄 License

Original code: **MIT** (see `LICENSE`).

`vendor/` contains Google MediaPipe Tasks Vision (Apache-2.0) and three.js incl. GLTFLoader
(MIT), self-hosted so nothing breaks offline. Note: both `vendor/wasm/vision_wasm_*.js` files
carry a one-line shim at the top (marked `HOLO SHIM`) that fixes a crash in MediaPipe's
released wasm glue — if you re-download MediaPipe yourself, re-apply it.

The models in `props/` are Smithsonian Institution 3D digitizations (Apollo 11 Command Module,
Triceratops horridus), released **CC0** at [3d.si.edu](https://3d.si.edu).
