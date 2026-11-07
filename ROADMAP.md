# Roadmap

Open work, in order. Update this file as things land; `CLAUDE.md` holds only what stays true.

## Next
1. **Real hands as tests.** Three real sessions in `recordings/`, all replay clean.
   - `hands-20261101-1135` (~18 fps) → 👌 to grab; per-hand swipes; label by majority; screen-width pull-apart.
   - `hands-20261103-2325` (8–11 fps; ran the PR #4 engine — the update never reached his machine) →
     one hand, self-view tile, swipes off, point & hold targets, js/ no-cache, build + perf in recordings.
   - `hands-20261107-1043` (build 1376eec; tracking 70–90 ms a frame with a hand on the GPU → 11–14 fps):
     the dot never rested on an edge target (it rests on content) and the pointing fingertip sits high
     in the frame; every pinch was curled; ✌ was perfect. → **✌ turns pages per hand**, the laser's own
     map (height re-centred), reset to R / ✦ rebuild, fix: an instant jump back to a slide still
     flying out hid it.
   *Needs:* a session with the new takes (✌ next / ✌ back / ✦ / laser).
   Open: tracking cost — 70–90 ms per frame on his Intel Mac GPU caps fps; try the CPU delegate and a
   smaller camera frame, measured with `perf.trackMs`. Whether he wants grab at all. HOLO still uses
   the old pinch.
2. **PowerPoint as the reference.** Done: five sample decks exported from PowerPoint into `decks/pdf/`;
   `tools/fidelity.py` scores against those and falls back to LibreOffice for decks without one
   (still `velora-q3-2026-qbr`). First PowerPoint comparison (2026-11-01): 35/35 slides ≥ 80%.
   Gaps it showed, to fix next:
   - **Pie plot area** (norte slide 5): PowerPoint draws the pie about twice as big, filling the
     chart frame; ours leaves wide margins for labels.
   - **Stacked-bar axis max** (ribera slide 4): columns summing to 100 reach the top in PowerPoint;
     ours picks a higher automatic max, so the bars stop short.
3. **Commands and two focused agents.** `.claude/commands/` for verify / add-gesture / test-deck;
   a visual-review agent and a PowerPoint-fidelity agent. Only after 1 and 2 exist.

## Later
- Desktop app with a built-in virtual camera (no OBS).
- Accounts and shared decks (database: Supabase) — only if people ask for it.

## Known gaps
- Not yet tested on a real webcam: the swipe and two-hand explode thresholds may need tuning.
- Fidelity: automatic axis max/steps differ from PowerPoint (see Next 2); pie plot area too small; table borders when a table
  has no style; Georgia-only text measures differently on machines without Georgia.
- Not carried over from PowerPoint: animations and transitions, SmartArt internals, video,
  EMF/WMF pictures; table styles are approximated.
