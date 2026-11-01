# Roadmap

Open work, in order. Update this file as things land; `CLAUDE.md` holds only what stays true.

## Next
1. **Real hands as tests.** Built: `?record=1` coach, `recordings/`, replay in `check.py`. Open: the first
   real session. *Needs: a 10-minute webcam session at /linkpresent?record=1, then the file.*
   Questions it answers: do relaxed hands or fists fire grabs ("rest" take)? Do two hands raised close
   together get merged by the ghost filter ("pull-apart")? Is the swipe threshold right for real arms?
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
