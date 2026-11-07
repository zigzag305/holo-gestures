// make_synthetic_recording.js — records recordings/synthetic-smoke.json.gz by driving LinkPresent's
// ?record=1 coach in headless Chromium with SIMULATED hands fed through the camera path.
// It exists so the record → save → replay pipeline is exercised in CI before any real recording
// is committed. It is NOT a substitute for real hands: record those with ?record=1 on a webcam.
//
//   node tools/make_synthetic_recording.js [http://localhost:4890]
//
// Simulated performance: 30 fps with ±5 ms timing jitter and ~0.2% landmark noise, hands leaving
// the frame between gestures.
// Pinches are 👌 (synthHand's pinch keeps the other fingers up); pages turn with a peace sign per hand.
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:4890';

(async () => {
  const browser = await chromium.launch();
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pg.on('pageerror', e => console.error('pageerror', e));
  await pg.addInitScript(() => { window.__recTest = true; });
  await pg.goto(`${BASE}/linkpresent?record=1`);
  await pg.waitForFunction(() => window.__ready && window.__holo.deck);
  const run = await pg.evaluate(async () => {
    const H = window.__holo, R = H.rec, REC = R.REC;
    REC.name = 'synthetic-smoke';
    const W = innerWidth, Hh = innerHeight;
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const noise = () => (rnd() - .5) * .004;
    // a hand at SCREEN fractions (mirror into image space), with tracker noise
    const hand = (sx, sy, pose) => H.synthImage(1 - sx, sy, pose).map(p => ({ x: p.x + noise(), y: p.y + noise(), z: 0 }));
    const tipOffset = (pose) => { const lm = H.synthImage(.5, .5, pose); return { dx: (1 - lm[8].x) - .5, dy: lm[8].y - .5 }; };
    // put the INDEX TIP on a screen point (camera map: fractions of the 1280x720 video with AMP 1.45)
    const VW = 1280, VH = 720, AMP = 1.45;
    // a pointing hand is drawn by the laser's own map (linkpresent.html PTR_GAIN / PTR_Y0); others by AMP
    const PTR_GAIN = 1.45, PTR_Y0 = .38;
    const toImg = (x, y, pose) => { const s = Math.max(W / VW, Hh / VH), sx = VW * s, sy = VH * s, ox = (W - sx) / 2, oy = (Hh - sy) / 2;
      const nx = (W - x - ox) / sx, ny = (y - oy) / sy;
      if (pose === 'point') return { fx: 1 - (.5 + (nx - .5) / PTR_GAIN), fy: PTR_Y0 + (ny - .5) / PTR_GAIN };
      return { fx: 1 - (.5 + (nx - .5) / AMP), fy: .5 + (ny - .5) / AMP }; };
    const handAtTip = (x, y, pose) => { const f = toImg(x, y, pose), o = tipOffset(pose); return hand(f.fx - o.dx, f.fy - o.dy, pose); };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    // fn(k in 0..1) → [hands]; labs = the tracker's Left/Right label per hand (default: one hand is
    // the right hand; two hands are right, left)
    const feedFor = async (ms, fn, labs) => {
      const t0 = performance.now();
      for (;;){
        const k = Math.min(1, (performance.now() - t0) / ms);
        const hs = fn(k) || [];
        H.feed({ landmarks: hs, handednesses: hs.map((h, i) => [{ score: .9, categoryName: labs ? labs[i] : hs.length === 2 ? (i ? 'Left' : 'Right') : 'Right' }]) }, VW, VH);
        if (k >= 1) break;
        await sleep(33 + (rnd() - .5) * 10);
      }
    };
    const none = (ms) => feedFor(ms, () => []);
    const lerp = (a, b, k) => a + (b - a) * k, ease = (k) => k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const centerOf = (pred) => { const s = document.querySelectorAll('.slide'); const vis = [...s].find(e => e.style.display !== 'none');
      const ps = [...vis.querySelectorAll('.piece')].map(w => w._p).filter(p => p && !p.bg && !p.d.locked && pred(p))
        .sort((a, b) => b.d.w * b.d.h - a.d.w * a.d.h);
      const r = ps[0].w.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const scripts = {
      rest: async () => feedFor(9000, k => [hand(.32 + .05 * Math.sin(k * 9), .62 + .03 * Math.cos(k * 7), 'open'),
                                             hand(.7 + .04 * Math.sin(k * 6 + 1), .66 + .03 * Math.sin(k * 5), 'open')]),
      // (no fists: synthHand's fist puts the thumb on the index tip, which a real fist doesn't —
      //  whether real fists trigger grabs is for a real recording to show)
      // a peace sign turns the page: right hand = next, left hand = back (one per showing)
      'peace-next': async () => { for (let r = 0; r < 3; r++){
          await feedFor(1100, () => [hand(.66, .55, 'peace')], ['Right']); await none(800); } },
      'peace-back': async () => { for (let r = 0; r < 3; r++){
          await feedFor(1100, () => [hand(.34, .55, 'peace')], ['Left']); await none(800); } },
      // point & hold on the ✦ (linkpresent.html EDGE_TOP / APART_X): pull apart, then rebuild
      'point-apart': async () => { for (let r = 0; r < 2; r++){   // apart, rebuild
          await feedFor(500, () => [handAtTip(W * .5, Hh * .5, 'point')]);
          await feedFor(900, () => [handAtTip(W * .77, Hh * .045, 'point')]);
          await feedFor(400, () => [handAtTip(W * .6, Hh * .4, 'point')]); } await none(400); },
      grab: async () => { for (let r = 0; r < 3; r++){
          const c = centerOf(p => p.d.kind === 'chart');
          await feedFor(400, () => [handAtTip(c.x, c.y, 'open')]);
          await feedFor(200, () => [handAtTip(c.x, c.y, 'pinch')]);
          await feedFor(800, k => [handAtTip(c.x - 220 * ease(k), c.y - 90 * ease(k), 'pinch')]);
          await feedFor(250, () => [handAtTip(c.x - 220, c.y - 90, 'open')]);
          await none(700); } },
      tap: async () => { for (let r = 0; r < 2; r++){
          const c = centerOf(p => p.d.text && p.d.role !== 'title' && p.d.w * p.d.h < 1280 * 720 * .2);
          await feedFor(400, () => [handAtTip(c.x, c.y, 'open')]);
          await feedFor(160, () => [handAtTip(c.x, c.y, 'pinch')]);
          await feedFor(300, () => [handAtTip(c.x, c.y, 'open')]);
          await none(900);
          await feedFor(400, () => [hand(.85, .8, 'open')]);
          await feedFor(160, () => [hand(.85, .8, 'pinch')]);
          await feedFor(300, () => [hand(.85, .8, 'open')]);
          await none(900); } },
      point: async () => feedFor(4000, k => [hand(.5 + .15 * Math.cos(k * 12), .5 + .1 * Math.sin(k * 12), 'point')]),
    };
    const until = async (ph) => { while (R.phase !== ph) await sleep(50); };
    R.recNext();
    const out = [];
    for (let i = 0; i < 7; i++){
      await until('ready'); const id = ['rest', 'peace-next', 'peace-back', 'point-apart', 'grab', 'tap', 'point'][i];
      R.recStart(); await until('rec');
      await scripts[id]();
      R.recStop(); await until('review');
      out.push({ id, live: REC.pending.verdict });
      R.recKeep();
    }
    await until('done'); await sleep(800);
    return { out, saved: REC.saved };
  });
  // the recorder saves into recordings/inbox/ (gitignored); this one is a committed test, so move it up
  const fs = require('fs'), path = require('path'), rec = path.join(__dirname, '..', 'recordings');
  try { fs.renameSync(path.join(rec, 'inbox', 'synthetic-smoke.json.gz'), path.join(rec, 'synthetic-smoke.json.gz')); run.saved = 'recordings/synthetic-smoke.json.gz'; }
  catch (e){ console.error('could not move the recording out of the inbox:', e.message); }
  console.log(JSON.stringify(run, null, 1));
  await browser.close();
})();
