# Roadmap

Open work, in order. Update this file as things land; `CLAUDE.md` holds only what stays true.

## Next
1. **Record real hands, replay them as tests.** A `?record=1` mode that saves real hand landmarks
   to a file, and probe checks that replay those recordings. Every gesture that misfires on a real
   webcam becomes a permanent test. *Needs: a webcam session.*
2. **Real decks and a fidelity score.** A `decks/tests/` folder of real PowerPoint decks, and a check
   that compares PowerPoint's own rendering of each slide with LinkPresent's. *Needs: 3–5 real decks.*
3. **Commands and two focused agents.** `.claude/commands/` for verify / add-gesture / test-deck;
   a visual-review agent and a PowerPoint-fidelity agent. Only after 1 and 2 exist.

## Later
- Desktop app with a built-in virtual camera (no OBS).
- Accounts and shared decks (database: Supabase) — only if people ask for it.

## Known gaps
- Not yet tested on a real webcam: the swipe and two-hand explode thresholds may need tuning.
- Not carried over from PowerPoint: animations and transitions, SmartArt internals, video,
  EMF/WMF pictures; table styles are approximated.
