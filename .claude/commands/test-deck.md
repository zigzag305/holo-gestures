Test a `.pptx` deck through the parser, LinkPresent renderer, and fidelity scorer:

1. Parse the deck standalone: `python3 pptx_deck.py decks/<name>.pptx` and verify slide count, titles, piece counts, and that every chart has series data.
2. If a PowerPoint PDF export exists, place it at `decks/pdf/<name>.pdf` so `tools/fidelity.py` compares against PowerPoint's own rendering rather than LibreOffice.
3. Run `python3 tools/fidelity.py --deck <name>.pptx` and inspect the per-slide scores and diff images (`state/fidelity/lp/<stem>/d-*.png`).
4. Run `python3 tools/check.py` to capture normal, exploded (`-apart`), and `-meeting-view` screenshots in `state/check/` and inspect them visually.
