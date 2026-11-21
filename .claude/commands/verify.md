Run every automated and visual check for HOLO and LinkPresent:

1. Run `python3 tools/check.py` (parses all `.pptx` decks, tests `server.py` routes and security guards, runs both headless browser probe batteries, captures slide screenshots in `state/check/`, replays all recorded hand sessions in `recordings/`, and runs `tools/fidelity.py` when LibreOffice and Poppler are available).
2. Inspect the generated screenshots in `state/check/` (normal, `-apart`, and `-meeting-view`) to confirm slides look right visually — a passing probe alone does not prove visual layout.
3. If parser or renderer code changed, open `state/fidelity/report.html` and inspect the lowest-scoring slides and their red diff images (`state/fidelity/lp/<deck>/d-*.png`).
4. Report PASS/FAIL counts and any visual anomalies found.
