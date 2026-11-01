# Roadmap

Open work, in order. Update this file as things land; `CLAUDE.md` holds only what stays true.

## Next
1. **Record real hands, replay them as tests.** A `?record=1` mode that saves real hand landmarks
   to a file, and probe checks that replay those recordings. Every gesture that misfires on a real
   webcam becomes a permanent test. *Needs: a webcam session.*
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
