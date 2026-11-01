# Roadmap

Open work, in order. Update this file as things land; `CLAUDE.md` holds only what stays true.

## Next
1. **Real hands as tests.** First live session (2026-11-01): the gestures weren't clear and grabs
   glitched. Shipped: on-screen gesture cards, a live label + pinch meter at each fingertip, and a
   grab that survives one misread frame (`PINCH_LET_GO`) or a brief tracking loss (`HOLD_GRACE_MS`).
   Both rules came from the description, not a recording: confirm them with the first real one.
   HOLO (`holo.html`) still drops a grab on one bad frame; adopt the same rule there once confirmed.
   Also built: `?record=1` coach, `recordings/`, replay in `check.py`. Open: the first
   real session. *Needs: a 10-minute webcam session at /linkpresent?record=1, then the file.*
   Questions it answers: do relaxed hands or fists fire grabs ("rest" take)? Do two hands raised close
   together get merged by the ghost filter ("pull-apart")? Is the swipe threshold right for real arms?
2. **PowerPoint as the reference.** Done: five varied sample decks and `tools/fidelity.py` (scores
   against LibreOffice). Still open: decks made *in PowerPoint by people* and their PowerPoint-exported
   PDFs as the reference (`--pdf-dir`). *Needs: open the sample decks in PowerPoint, re-save, export PDF.*
3. **Commands and two focused agents.** `.claude/commands/` for verify / add-gesture / test-deck;
   a visual-review agent and a PowerPoint-fidelity agent. Only after 1 and 2 exist.

## Later
- Desktop app with a built-in virtual camera (no OBS).
- Accounts and shared decks (database: Supabase) — only if people ask for it.

## Known gaps
- Not yet tested on a real webcam: the swipe and two-hand explode thresholds may need tuning.
- Fidelity: axis steps sometimes differ from PowerPoint's automatic scale; table borders when a table
  has no style; Georgia-only text measures differently on machines without Georgia.
- Not carried over from PowerPoint: animations and transitions, SmartArt internals, video,
  EMF/WMF pictures; table styles are approximated.
