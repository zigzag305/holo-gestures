# holo-gestures

Webcam hand-gesture interfaces that run in the browser, served by a small local Python server.
Two pages share one hand engine:

- **HOLO** (`/`, `holo.html`): markdown notes as orbs and cards, plus 3D props, handled in mid-air.
- **LinkPresent** (`/linkpresent`, `linkpresent.html`): a PowerPoint `.pptx` unpacked into its real
  objects and floated as 3D layers over the mirrored camera, for presenting in Teams/Zoom/Meet
  (screen share, or OBS Virtual Camera).

Plans and open work live in `ROADMAP.md`, not here.

## Map
| Path | What it is |
|---|---|
| `server.py` | stdlib HTTP server, port 4890 (`HOLO_PORT` overrides). Pages, static `/vendor/ /props/ /js/`, notes API, deck API (`/api/decks`, `/api/deck`, `/api/deck/media`, `/api/deck/upload`) |
| `pptx_deck.py` | stdlib .pptx parser → slides of *pieces* (`shape`, `line`, `pic`, `table`, `chart`) in CSS px at 96 dpi. Resolves master → layout → slide inheritance, groups, theme colours, chart data, speaker notes. `python3 pptx_deck.py decks/x.pptx [--json]` |
| `js/hands.js` | **shared hand engine**: pinch thresholds, `handMetrics`, One Euro smoothing, slot assignment, ghost-hand dedupe, MediaPipe loader, `synthHand` |
| `js/lp-render.js` · `js/lp-charts.js` · `js/lp-dom.js` | LinkPresent renderer: one DOM element per piece; charts rebuilt from the file's numbers |
| `holo.html` | HOLO page: cards, physics, 3D props, reader, Jarvis voice, its sim + probe |
| `linkpresent.html` | LinkPresent page: deck/slide state, explode layout (`frame()`), pointer API (`begin/move/end`), gesture rules (`ingestHands`, `twoUpdate`), sim (`demoSteps`) and probe |
| `tools/check.py` | every check in one command |
| `decks/` | .pptx files to present; `velora-q3-2026-qbr.pptx` is the sample (fictional company) |
| `vendor/` | self-hosted MediaPipe + three.js |
| `state/` | runtime output (gitignored): diag, hand state, `check/` screenshots |

## Rules
- **No build step, no npm in the app.** Python is stdlib only. Browser code is plain ES modules
  loaded straight from `js/`. Playwright is a *test-only* dependency.
- **Camera frames never leave the page.** Nothing is sent off the machine.
- **Never swap `vendor/` for CDN imports** (CDN is only the fallback inside `loadHandLandmarker`).
  Keep the `HOLO SHIM` line at the top of `vendor/wasm/*.js`.
- **Hand logic shared by both pages goes in `js/hands.js`**, never copied into a page.
  Page-specific gesture rules stay in that page.
- **Thresholds are named constants.** Change one only on purpose and say why in a comment.
  Field lessons are recorded as dated comments next to the code they explain; keep them.
- **Only the camera feed is mirrored.** Slide text and cards are DOM and never mirrored,
  or hands stop lining up with what they touch.
- **Server paths:** static files only from `vendor/ props/ js/` (folder name matched exactly);
  uploads only as plain `.pptx` names inside `decks/`. Keep both guards.
- **LinkPresent fidelity:** a slide at rest should look like PowerPoint's own rendering;
  charts are rebuilt from data, never screenshots.

## Verify before saying you're done
```bash
python3 tools/check.py            # parser, routes, both probes, screenshots → state/check/
python3 tools/check.py --quick    # no browser
python3 tools/check.py --all-slides
```
Every check must pass. Then **open the screenshots and look at them**: a passing probe doesn't
prove a slide looks right. For parser changes, also try a deck built on python-pptx's default
template (placeholder inheritance, table styles).

## Conventions
- **New gesture:** constant (if any) → rule in the page's `ingestHands` → a probe check that fails
  without it → help text in the page's legend → README table.
- **New probe check:** drive the real engine with `synthHand` frames, never by calling the
  handler directly. Make sure the check would fail on a wrong value, not only on a missing feature.
- URL switches: `?sim=1` scripted demo · `?probe=1` test battery · `?clean=1` meeting view ·
  `?deck=name.pptx&slide=N`.
- Commits: small, one concern each, message says what changed and how it was verified.
