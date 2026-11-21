Add or tune a hand gesture following the project's gesture workflow:

1. **Named threshold constant**: If the gesture introduces or tunes a threshold, define it as a named constant (in `js/hands.js` if shared, or in the page) with a dated comment explaining why and which recording motivated it.
2. **Rule in `ingestHands`**: Implement the gesture rule inside the page's `ingestHands` function (`linkpresent.html` or `holo.html`), keeping shared pose metrics in `js/hands.js`. Emit an event via `emit()` in `linkpresent.html` if recordings/replays should track it.
3. **Probe check**: Add a probe check in the page's `probe` battery driving the real engine with `synthHand` frames (never calling the handler directly). Verify that the check fails without the rule or with a wrong threshold.
4. **Replay recordings**: Run `python3 tools/check.py` to confirm all real hand recordings in `recordings/` still replay clean. If a gesture was redesigned and an older take was performed the old way, add a `revised` goal (`{expect, why, date}`) rather than editing the recorded frames.
5. **On-screen guide & README**: Update the page's `#legend` / fingertip `poseLabel` and the gesture table in `README.md`.
