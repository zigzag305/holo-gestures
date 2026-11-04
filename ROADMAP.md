# Roadmap

Open work, in order. Update this file as things land; `CLAUDE.md` holds only what stays true.

## Next
1. **Real hands as tests.** Two real sessions in `recordings/`, both replay 8/8 and 4/4.
   - `hands-20261101-1135` (~18 fps) → 👌 to grab; per-hand swipes; label by majority; screen-width pull-apart.
   - `hands-20261103-2325` (8–11 fps, evening light): the tracker lost the hand for the fast part of every
     swipe, and the right hand never made 👌 for the two-hand pull. He asked for one-hand presenting and
     a self-view tile. → **point & hold on edge targets** (next / back / pull apart), swipes off by default
     (W), self-view tile layout, recordings now stamp build + fps + tracking ms + settings per take.
   *Needs: a session with the new takes* (point-next, point-back, point-apart, grab, tap) **in good light**,
   then compare its `perf.fps` with these two.
   Open: is 8–11 fps the camera (light) or the tracker (Intel GPU)? `perf.trackMs` will tell. The laser
   fires while talking (pointing at rest). HOLO (`holo.html`) still uses the old pinch.
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
