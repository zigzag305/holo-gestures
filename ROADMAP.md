# Roadmap

Open work, in order. Update this file as things land; `CLAUDE.md` holds only what stays true.

## Next
1. **Real hands as tests.** Four real sessions in `recordings/`, all replay clean.
   - `hands-20261101-1135` (~18 fps) → 👌 to grab; per-hand swipes; label by majority; screen-width pull-apart.
   - `hands-20261103-2325` (8–11 fps; ran the PR #4 engine — the update never reached his machine) →
     one hand, self-view tile, swipes off, point & hold targets, js/ no-cache, build + perf in recordings.
   - `hands-20261107-1043` (build 1376eec; tracking 70–90 ms a frame with a hand on the GPU → 11–14 fps):
     the dot never rested on an edge target (it rests on content) and the pointing fingertip sits high
     in the frame; every pinch was curled; ✌ was perfect. → **✌ turns pages per hand**, the laser's own
     map (height re-centred), reset to R / ✦ rebuild, fix: an instant jump back to a slide still
     flying out hid it.
   - `hands-20261121-2358` (build 3b00746; 640×360 camera default → ~18 fps, 40–47 ms per frame):
     dropping ✌ into a quick fist (3–5 frames, 270–405 ms) was shorter than `PEACE_GAP_MS` →
     **`PEACE_DROP_FRAMES = 3`** re-arms ✌ after 3 non-peace frames in a row.
   Done: LinkPresent now requests a `640×360` camera frame by default (4× fewer pixels uploaded to WebGL than 720p; `?cam=720` restores 720p) and `loadHandLandmarker` accepts `?delegate=cpu` to benchmark CPU vs. GPU with `perf.trackMs`. HOLO (`holo.html`) now shares `PINCH_FINGERS_UP`, `PINCH_LET_GO`, and `HOLD_GRACE_MS` on the camera path.
2. **PowerPoint as the reference.** Done: five sample decks exported from PowerPoint into `decks/pdf/`;
   `tools/fidelity.py` scores against those and falls back to LibreOffice for decks without one
   (still `velora-q3-2026-qbr`). All 53/53 slides ≥ 92% (mean 97–99% per deck):
   - **Pie plot area** (norte slide 5): fixed (`R` fills 83% of the plot box with wrapped outside labels; 82% → 96%).
   - **Stacked-bar axis max** (ribera slide 4): fixed (outside-label headroom only applies to non-stacked outside labels; 90% → 98%).
   - **Automatic axis steps & paragraph `spcPct`**: `niceScale` now follows PowerPoint's `1, 2, 5 × 10^k` steps across ~8.5 intervals; `pptx_deck.py` resolves `a:spcBef/a:spcPct` and `a:spcAft/a:spcPct` and gives unstyled tables default `tx1` borders.
3. **Commands and two focused agents.** Done: `.claude/commands/` (`verify.md`, `add-gesture.md`, `test-deck.md`) and `.claude/agents/` (`visual-review.md`, `powerpoint-fidelity.md`).

## Product Roadmap (Approved)
1. **Phase 1 — One-hand validation & meeting load hardening:**
   - Real-webcam 7-take session (`hands-20261121-2358`) captured at ~18 fps (640×360 default) and tuned (`PEACE_DROP_FRAMES = 3`).
   - Adaptive tracking stride when `TRACK.ms > TRACK_SLOW_MS` (keeps 3D slides smooth at 60 fps during Teams/Zoom calls) + non-blocking Ready Check on camera start.
2. **Phase 2 — Pure-browser `.pptx` parser & zero-backend hosting (`js/pptx-parse.js`):**
   - Done (parser): `js/pptx-parse.js` ports `pptx_deck.py` to native `DecompressionStream` + `DOMParser` with exact parity across all 6 sample decks (53 slides). Next: static HTTPS deployment.
3. **Phase 3 — Microsoft PowerPoint Office Add-in (`office/`):**
   - Done (scaffold & launcher): `office/manifest.xml`, `office/taskpane.html`, icons, and `BroadcastChannel` / `postMessage` handshake + live slide sync. Needs: HTTPS sideload test inside PowerPoint Desktop/Web.
4. **Phase 4 — Zoom App & Microsoft Teams Meeting App (`meeting/`):**
   - Done (sidebar & Share-to-Stage): `meeting/sidebar.html`, `meeting/teams-manifest.json`, `meeting/zoom-app.json`, speaker notes, slide list, Stage/Camera mode toggles, and 2-way stage sync without OBS. Needs: HTTPS sideload test inside Teams/Zoom.
5. **Phase 5 — Built-in virtual camera desktop wrapper (`desktop/`):**
   - Done (wrapper, offline server & vcam bridge): `desktop/main.js`, `desktop/server.js` (zero-Python loopback server), `desktop/vcam.js` (`VirtualCameraBridge`), `desktop/preload.js`, `desktop/package.json` (`.dmg` / `.msi` config), and MDM deployment guide. Needs: code-signing & native CoreMediaIO / DirectShow virtual camera driver packaging on macOS/Windows.

## Known gaps
- Not yet tested on a real webcam with the new 7-take script (`peace-next`, `peace-back`, `point-apart`, `grab`, `tap`, `point`, `rest`).
- Fidelity: Georgia-only text measures differently on machines without Georgia.
- Not carried over from PowerPoint: animations and transitions, SmartArt internals, video,
  EMF/WMF pictures; table styles are approximated.
