/* ============================================================================
   recorder.js — REAL HANDS AS TESTS.
   A recording is what the hand tracker saw (21 landmark points per hand, per camera
   frame — never any camera image) while a person performed one gesture on cue,
   plus what the engine did live. Replaying it through the same camera path turns
   every field misfire into a permanent regression test.

   Format (stored gzipped as recordings/<name>.json.gz by server.py):
   { version, app, created, ua, deck, takes: [{ id, title, slide, expect,
       screen: {w, h}, video: {w, h}, frames: [{ t, h: [[score, x0, y0, … x20, y20], …], c: 'LR' }],
       live: {counts}, verdict: {pass, detail}, revised?: {expect, why, date} }] }

   REVISED TAKES: when a gesture is redesigned, a take performed the old way can't meet its old goal.
   The frames are never edited; the take gets `revised` (a new goal + why + date) and replays are
   judged on that. Usually it becomes a guard: the old movement must now fire nothing.
   ========================================================================== */

export const FORMAT_VERSION = 1;

/* The guided script. `expect` keys are event counts (see countEvents):
   a number means "at least", except EXACT keys which must match exactly;
   `none` lists counts that must stay 0 — the false-positive guard. */
export const EXACT = new Set(['nav_next', 'nav_prev']);
export const TAKES = [
  { id: 'rest', icon: '🙌', title: 'Just present', secs: 12, slide: 5,
    say: 'Keep both hands in view and talk as you would in a meeting. Move naturally. No gestures.',
    expect: { none: ['nav', 'reset', 'explode', 'grab', 'focus'] } },
  { id: 'swipe-next', icon: '✋ ←', title: 'Next slide', secs: 15, slide: 3,
    say: 'RIGHT hand open: sweep it from right to left, 3 times. Pause a second between swipes.',
    expect: { nav_next: 3, none: ['nav_prev', 'explode', 'reset'] } },
  { id: 'swipe-back', icon: '→ ✋', title: 'Previous slide', secs: 15, slide: 9,
    say: 'LEFT hand open: sweep it from left to right, 3 times. Pause a second between swipes.',
    expect: { nav_prev: 3, none: ['nav_next', 'explode', 'reset'] } },
  { id: 'pull-apart', icon: '👌 👌', title: 'Pull the slide apart', secs: 18, slide: 5,
    say: 'Both hands 👌 (thumb and index touching, other fingers up), pull them apart, then bring them back together. Twice.',
    expect: { explode: 2, rebuild: 2, none: ['nav', 'reset'] } },
  { id: 'grab', icon: '👌', title: 'Grab a piece', secs: 15, slide: 5,
    say: '👌 on the chart (thumb and index touching, other three fingers UP), drag it somewhere, open to let go. 3 times.',
    expect: { grab_moved: 3, none: ['nav', 'reset', 'explode'] } },
  { id: 'tap', icon: '👌', title: 'Tap to bring forward', secs: 15, slide: 2,
    say: 'Quick 👌 on a card, then open: it jumps to the front. Quick 👌 again: it goes back. Twice.',
    expect: { focus: 2, unfocus: 2, none: ['nav', 'reset'] } },
  { id: 'point', icon: '☝️', title: 'Laser pointer', secs: 10, slide: 5,
    say: 'Point with your index finger and circle things on the slide.',
    expect: { laser: 1, none: ['nav', 'reset', 'explode', 'grab'] } },
  { id: 'peace', icon: '✌️', title: 'Reset', secs: 12, slide: 5,
    say: 'Hold a peace sign ✌ for about a second. Drop your hand. Twice.',
    expect: { reset: 2, none: ['nav'] } },
];

const R4 = (v) => Math.round(v * 1e4) / 1e4;
/** One HandLandmarker result → a compact frame (x, y only: the engine never uses z). */
export function encodeFrame(res, t){
  const hd = res.handednesses || res.handedness || [];
  const f = { t: Math.round(t), h: (res.landmarks || []).map((lm, i) => {
    const row = [R4((hd[i] && hd[i][0] && hd[i][0].score) ?? 1)];
    for (const p of lm) row.push(R4(p.x), R4(p.y));
    return row;
  }) };
  // the tracker's Left/Right label per hand: kept for tuning the ghost-hand filter
  const c = (res.landmarks || []).map((_, i) => ((hd[i] && hd[i][0] && hd[i][0].categoryName) || '?')[0]).join('');
  if (c.replace(/\?/g, '')) f.c = c;
  return f;
}
/** A stored frame → the shape HandLandmarker returns, ready for the normal camera path. */
export function decodeFrame(f){
  const landmarks = [], handednesses = [];
  for (const row of f.h){
    const lm = [];
    for (let k = 1; k < row.length; k += 2) lm.push({ x: row[k], y: row[k + 1], z: 0 });
    const k = handednesses.length, lab = f.c && f.c[k];
    landmarks.push(lm); handednesses.push([{ score: row[0], categoryName: lab === 'L' ? 'Left' : lab === 'R' ? 'Right' : undefined }]);
  }
  return { landmarks, handednesses };
}

/** Events the page emitted during a take → the counts expectations talk about. */
export function countEvents(events){
  const c = { nav_next: 0, nav_prev: 0, nav: 0, reset: 0, explode: 0, rebuild: 0, grab: 0, grab_moved: 0, focus: 0, unfocus: 0, laser: 0 };
  for (const e of events){
    if (e.type === 'nav'){ c.nav++; if (e.d > 0) c.nav_next++; else c.nav_prev++; }
    else if (e.type === 'release'){ if (e.moved >= 60) c.grab_moved++; }
    else if (e.type in c) c[e.type]++;
  }
  return c;
}
/** Did the counts meet the take's expectation? → { pass, detail } */
export function evaluate(expect, counts){
  const bad = [];
  for (const [k, n] of Object.entries(expect)){
    if (k === 'none' || k === 'exact') continue;
    const got = counts[k] || 0;
    const exact = expect.exact ? expect.exact.includes(k) : EXACT.has(k);   // a revised goal may relax "exactly"
    if (exact ? got !== n : got < n) bad.push(`${k} ${got}/${n}`);
  }
  for (const k of expect.none || []) if (counts[k]) bad.push(`unwanted ${k} ×${counts[k]}`);
  const shown = Object.keys(expect).filter(k => k !== 'none' && k !== 'exact').map(k => `${k} ${counts[k] || 0}`);
  return { pass: !bad.length, detail: bad.length ? bad.join(' · ') : (shown.join(' · ') || 'nothing fired') };
}
