/* ============================================================================
   hands.js — the shared HAND ENGINE core for every HOLO page (holo.html,
   linkpresent.html). Pure functions plus the MediaPipe loader: no DOM, no page
   state. Each page keeps its own hand-state objects and passes them in.

   Field lessons live here as comments, next to the code they explain. Change a
   threshold only on purpose, and run `python3 tools/check.py` afterwards: both
   pages' probe batteries exercise this file.
   ========================================================================== */

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* field-tuned on the galaxy build 2026-08-26: a pinch means FINGERS TOUCHING and
   must hold PINCH_EARN consecutive frames — near-pinches register nothing.
   Relaxed 2026-08-30: .22 needed fingers literally touching; the original 'too
   sensitive' complaint was GHOST hands (now deduped), not this number. */
export const PINCH_IN = .30, PINCH_OUT = .42, PINCH_EARN = 2;

/* green-dot forensics: a PERSISTENT false detection (a face, a lamp) survives the
   render gate — hands smaller than 2.5% of frame are background noise. */
export const SPAN_MIN = .025;

/* reach amplification (camera only): a comfortable central hand zone reaches the
   whole screen. */
export const AMP = 1.45;

/** Pose metrics from 21 MediaPipe landmarks (normalized image coords). */
export function handMetrics(lm){
  const span = Math.max(1e-4, dist(lm[0], lm[9]));
  const curl = (i) => dist(lm[i], lm[0]) / span;
  const tips = [curl(8), curl(12), curl(16), curl(20)];   // [index, middle, ring, pinky] extension ratios
  return {
    span,
    tips,
    pinch: dist(lm[4], lm[8]) / span,
    open: tips.every(t => t > 1.45),
    openish: tips.every(t => t > 1.32),   // relaxed real-hand open (parity with the galaxy build)
    fist: tips.every(t => t < 1.05),
    point: tips[0] > 1.45 && tips[1] < 1.15 && tips[2] < 1.15 && tips[3] < 1.15,
    peace: tips[0] > 1.45 && tips[1] > 1.45 && tips[2] < 1.15 && tips[3] < 1.15,
    palm: { x: (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 },
    tip: lm[8],                           // the INDEX FINGERTIP is the cursor
    thumb: lm[4],
  };
}

/* One Euro filter (Casiez et al.) — speed-adaptive cutoff: heavy smoothing when the
   hand is still (no jitter), light smoothing when it moves fast (no lag). This is
   what separates a floaty cursor from one that feels wired to the finger.
   `st` is the caller's per-hand state; the filter keeps its memory in st.oe. */
export function oneEuro(st, raw, now){
  const f = st.oe || (st.oe = { t: now, x: raw.x, y: raw.y, dx: 0, dy: 0 });
  let dt = (now - f.t) / 1000; if (!(dt > 1/240)) dt = 1/60; if (dt > .2) dt = .2;  // sub-frame deltas = one camera frame
  f.t = now;
  const al = (cut) => { const r = 2 * Math.PI * cut * dt; return r / (r + 1); };
  const ad = al(2.5);   // derivative cutoff: velocity estimate must build FAST or slow motions lag
  f.dx += ((raw.x - f.x) / dt - f.dx) * ad;
  f.dy += ((raw.y - f.y) / dt - f.dy) * ad;
  const a = al(1.3 + .009 * Math.hypot(f.dx, f.dy));
  f.x += (raw.x - f.x) * a; f.y += (raw.y - f.y) * a;
  return { x: f.x, y: f.y };
}

/* HAND IDENTITY — MediaPipe returns hands in ARBITRARY order that swaps between
   frames; positional assignment shreds a hand's state (seen-counter, pinch, filter)
   on every swap, so the real hand never earns the screen. Each detection claims the
   slot whose last palm is NEAREST — state survives, and a far-away stray can't steal
   a live hand's slot. `hands` = the page's two slot states ({present, seen, m}),
   `px` = the page's landmark→screen mapper. Camera path only: probe/sim stay
   positional by design. */
export function assignHands(lms, hands, px){
  const out = [null, null];
  const cand = lms.slice(0, 2);
  const claimed = [false, false];
  const palmPx = lm => px({ x: (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 });
  const order = [0, 1].filter(i => hands[i].present && hands[i].m)
    .sort((a, b) => hands[b].seen - hands[a].seen);
  for (const i of order){
    const last = px(hands[i].m.palm);
    let bi = -1, bd = 1e9;
    cand.forEach((lm, k) => { if (!lm || claimed[k]) return;
      const p = palmPx(lm), d = Math.hypot(p.x - last.x, p.y - last.y);
      if (d < bd){ bd = d; bi = k; } });
    if (bi >= 0 && bd < 260){ out[i] = cand[bi]; claimed[bi] = true; }
  }
  cand.forEach((lm, k) => { if (!lm || claimed[k]) return;
    const slot = out[0] == null && !hands[0].present ? 0
               : out[1] == null && !hands[1].present ? 1
               : out[0] == null ? 0 : out[1] == null ? 1 : -1;
    if (slot >= 0){ out[slot] = lm; claimed[k] = true; }
  });
  return out;
}

/** Turn one HandLandmarker result into the landmark sets worth tracking.
 *  Returns { lms, n, scores, ghost }: n/scores are the pre-filter truth (DEBUG). */
export function readDetections(res, hands){
  const hd = res.handednesses || res.handedness || [];
  const all = res.landmarks || [];
  const scores = hd.map(h => (h && h[0] && h[0].score) ?? 1);
  // NOTE the semantics: handednesses[].score is the LEFT-vs-RIGHT classifier
  // confidence, NOT detection quality. A palm-forward spread hand (how every
  // gesture starts) is chirality-AMBIGUOUS and scores ~.5-.7 — the old .8 gate
  // was throwing away his REAL hand while confident phantoms survived. Detection
  // quality is enforced at the tracker (minHandDetection/Presence/Tracking .6);
  // this stays only as a .5 sanity floor.
  let pair = all.map((lm, i) => ({ lm, s: scores[i] ?? 1 })).filter(p => p.s > .5);
  // GHOST-HAND DEDUPE: MediaPipe often reports ONE physical hand as TWO overlapping
  // detections, and the ghost paints a second cursor shadowing the finger (his
  // "green things following my fingers"). Two palms closer than ~1.35 hand-spans
  // are the same hand — keep the higher-confidence read.
  let ghost = false;
  // NEVER dedupe two ESTABLISHED hands — a clap is two real palms rushing inside
  // ghost distance, and merging them killed the clap (2026-08-28). Ghosts are a
  // NEW detection born beside one live hand, not a long-tracked pair.
  const twoLive = hands[0].present && hands[0].seen > 4 && hands[1].present && hands[1].seen > 4;
  if (pair.length === 2){
    const P2 = p => ({ x: (p.lm[0].x + p.lm[9].x) / 2, y: (p.lm[0].y + p.lm[9].y) / 2 });
    const S2 = p => Math.hypot(p.lm[0].x - p.lm[9].x, p.lm[0].y - p.lm[9].y);
    const dd = Math.hypot(P2(pair[0]).x - P2(pair[1]).x, P2(pair[0]).y - P2(pair[1]).y);
    // GHOST vs CLAP (2026-08-30 regression fix): when the two detections are NOT
    // two long-established hands, a neighbour within 1.35 spans is a GHOST DUPLICATE
    // — merge it. Dropping this to .7 (to save the clap) let ghosts survive as a
    // second hand, and a ghost of a PINCHING hand fires two-hand zoom/rotate.
    // Established pairs (a clap) still never merge until they truly overlap.
    if (dd < Math.max(S2(pair[0]), S2(pair[1])) * (twoLive ? .5 : 1.35)){
      pair = [pair[0].s >= pair[1].s ? pair[0] : pair[1]];
      ghost = true;
    }
    // shirt/face phantom: a second detection that is BOTH much smaller and lower
    // confidence than the live hand is background noise, not a second hand
    else {
      const [big, small] = S2(pair[0]) >= S2(pair[1]) ? [pair[0], pair[1]] : [pair[1], pair[0]];
      if (S2(small) < S2(big) * .55 && small.s < .9){ pair = [big]; ghost = true; }
    }
  }
  return { lms: pair.map(p => p.lm), n: all.length, scores, ghost };
}

/* MediaPipe HandLandmarker. SELF-HOSTED first (no CDN in the path — ad-block
   extensions and offline can't kill it, the 2026-08-21 field failure); public CDN
   only as the fallback. onStage(name) reports progress. Throws an Error carrying
   .stage and .localImportError on failure. */
export async function loadHandLandmarker(onStage = () => {}){
  let stage = 'import', localErr = null;
  try {
    let mp = null, wasmDir = '/vendor/wasm', model = '/vendor/hand_landmarker.task';
    try { mp = await import('/vendor/vision_bundle.mjs'); }
    catch (le){
      localErr = (le && (le.message || String(le)) || '?').slice(0, 300);
      console.error('[holo] local bundle import failed:', le);
      mp = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1');
      wasmDir = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
      model = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
    }
    stage = 'wasm'; onStage(stage);
    const files = await mp.FilesetResolver.forVisionTasks(wasmDir);
    stage = 'model'; onStage(stage);
    // confidence floors raised off the loose .5 defaults: a face or a shirt fold
    // that scores .5-.6 as a "hand" is exactly the parked-green-dot phantom
    const opts = (d) => ({ baseOptions: { modelAssetPath: model, delegate: d },
                           runningMode: 'VIDEO', numHands: 2,
                           minHandDetectionConfidence: .6,
                           minHandPresenceConfidence: .6,
                           minTrackingConfidence: .6 });
    try { return { landmarker: await mp.HandLandmarker.createFromOptions(files, opts('GPU')), delegate: 'GPU', localImportError: localErr }; }
    catch (ge){ console.error('[holo] GPU delegate failed, trying CPU:', ge);
      return { landmarker: await mp.HandLandmarker.createFromOptions(files, opts('CPU')), delegate: 'CPU', localImportError: localErr }; }
  } catch (e){
    const err = e instanceof Error ? e : new Error(String(e));
    err.stage = stage; err.localImportError = localErr;
    throw err;
  }
}

/* SYNTHETIC HANDS for ?sim and ?probe: 21 landmarks in normalized IMAGE space
   (un-mirrored, like the camera delivers them). Poses: open · pinch · fist · point
   · peace. The same engine runs on these as on a real camera. */
export function synthHand(x, y, pose, scale){
  const lm = []; const s = scale || .09;
  const spread = pose === 'open' ? 1.0 : pose === 'fist' ? .38 : .78;
  lm[0] = { x, y: y + s * .9 };
  lm[9] = { x, y: y - s * .1 };
  lm[1] = { x: x - s * .35, y: y + s * .55 }; lm[2] = { x: x - s * .5, y: y + s * .3 }; lm[3] = { x: x - s * .55, y: y + s * .1 };
  lm[5] = { x: x - s * .3, y: y - s * .15 }; lm[13] = { x: x + s * .15, y: y - s * .15 }; lm[17] = { x: x + s * .32, y: y - s * .1 };
  const tipY = y - s * (pose === 'fist' ? .35 : 1.05) * spread;
  lm[8] = { x: pose === 'pinch' ? x - s * .18 : pose === 'point' ? x - s * .28 : x - s * .28 * spread,
            y: pose === 'pinch' ? y - s * .5 : pose === 'point' ? y - s * 1.05 : tipY };
  lm[4] = { x: pose === 'pinch' ? x - s * .16 : x - s * .62 * spread, y: pose === 'pinch' ? y - s * .48 : y + s * .05 };
  const curlY = y - s * .133;                      // fist-height fingertips for the POINT pose
  lm[12] = { x: x - s * .05, y: pose === 'point' ? curlY : tipY };
  lm[16] = { x: x + s * .16, y: ((pose === 'point' || pose === 'peace') ? curlY : tipY) + s * .06 };
  lm[20] = { x: x + s * .3, y: ((pose === 'point' || pose === 'peace') ? curlY : tipY) + s * .14 };
  for (const [a, b, i] of [[5, 8, 6], [5, 8, 7], [9, 12, 10], [9, 12, 11], [13, 16, 14], [13, 16, 15], [17, 20, 18], [17, 20, 19]]){
    const p = lm[a], q = lm[b], k = (i % 2 ? .66 : .33);
    lm[i] = { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
  }
  return lm;
}
