// make_synthetic_recording.js — records recordings/synthetic-smoke.json.gz by driving LinkPresent's
// ?record=1 coach in headless Chromium with SIMULATED hands fed through the camera path.
// It exists so the record → save → replay pipeline is exercised in CI before any real recording
// is committed. It is NOT a substitute for real hands: record those with ?record=1 on a webcam.
//
//   node tools/make_synthetic_recording.js [http://localhost:4890]
//
// Simulated performance: 30 fps with ±5 ms timing jitter and ~0.2% landmark noise, hands leaving
// the frame between gestures, and a slow hand return after one swipe (must NOT count as a swipe).
// Pinches are 👌 (synthHand's pinch keeps the other fingers up); back swipes use the left hand.
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
    const toImg = (x, y) => { const s = Math.max(W / VW, Hh / VH), sx = VW * s, sy = VH * s, ox = (W - sx) / 2, oy = (Hh - sy) / 2;
      const nx = (W - x - ox) / sx, ny = (y - oy) / sy; return { fx: 1 - (.5 + (nx - .5) / AMP), fy: .5 + (ny - .5) / AMP }; };
    const handAtTip = (x, y, pose) => { const f = toImg(x, y), o = tipOffset(pose); return hand(f.fx - o.dx, f.fy - o.dy, pose); };
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
      'swipe-next': async () => { for (let r = 0; r < 3; r++){
          await feedFor(400, () => [hand(.78, .58, 'open')]);
          await feedFor(320, k => [hand(lerp(.78, .22, ease(k)), .58 + .02 * k, 'open')]);
          if (r === 1) await feedFor(1600, k => [hand(lerp(.22, .78, k), .6, 'open')]);   // slow return: not a swipe
          else await none(700);
          await sleep(500); } },
      // back is the LEFT hand sweeping right (SWIPES ARE PER HAND in js/hands.js)
      'swipe-back': async () => { for (let r = 0; r < 3; r++){
          await feedFor(400, () => [hand(.22, .58, 'open')], ['Left']);
          await feedFor(320, k => [hand(lerp(.22, .78, ease(k)), .58, 'open')], ['Left']);
          await none(900); } },
      'pull-apart': async () => { for (let r = 0; r < 2; r++){
          // hands start ~2 hand-widths apart: closer than ~1.35 the ghost filter (js/hands.js) merges a NEW pair
          await feedFor(300, () => [hand(.39, .58, 'open'), hand(.61, .58, 'open')]);
          await feedFor(250, () => [hand(.39, .58, 'pinch'), hand(.61, .58, 'pinch')]);
          await feedFor(1100, k => [hand(lerp(.39, .14, ease(k)), .58, 'pinch'), hand(lerp(.61, .86, ease(k)), .58, 'pinch')]);
          await feedFor(400, () => [hand(.14, .58, 'pinch'), hand(.86, .58, 'pinch')]);
          await feedFor(1100, k => [hand(lerp(.14, .4, ease(k)), .58, 'pinch'), hand(lerp(.86, .6, ease(k)), .58, 'pinch')]);
          await feedFor(250, () => [hand(.4, .58, 'open'), hand(.6, .58, 'open')]);
          await none(600); } },
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
      peace: async () => { for (let r = 0; r < 2; r++){
          await feedFor(1100, () => [hand(.66, .55, 'peace')]);
          await none(1700); } },
    };
    const until = async (ph) => { while (R.phase !== ph) await sleep(50); };
    R.recNext();
    const out = [];
    for (let i = 0; i < 8; i++){
      await until('ready'); const id = ['rest', 'swipe-next', 'swipe-back', 'pull-apart', 'grab', 'tap', 'point', 'peace'][i];
      R.recStart(); await until('rec');
      await scripts[id]();
      R.recStop(); await until('review');
      out.push({ id, live: REC.pending.verdict });
      R.recKeep();
    }
    await until('done'); await sleep(800);
    return { out, saved: REC.saved };
  });
  console.log(JSON.stringify(run, null, 1));
  await browser.close();
})();
