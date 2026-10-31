/* lp-charts.js — LIVE CHARTS for LinkPresent: native PowerPoint charts redrawn from
   the numbers stored inside the .pptx (bar/column clustered+stacked, line, area, pie,
   doughnut). Returns handles the stage animates: { root, bars:[{el,k}], slices:[{g,mid,R}] }. */
import { el, rgba, fontStack } from './lp-dom.js';

/* ---------- number formats (Excel codes as stored in the chart) ---------- */
export function fmtNum(v, code){
  if (v == null || isNaN(v)) return '';
  if (!code || /^general$/i.test(code)){
    const r = Math.round(v * 100) / 100;
    return r.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  code = code.split(';')[0].replace(/\[[^\]]*\]/g, '');
  if (/%/.test(code.replace(/"[^"]*"/g, ''))) v *= 100;
  let out = '', i = 0, num = false;
  while (i < code.length){
    const ch = code[i];
    if (ch === '"'){ const j = code.indexOf('"', i + 1); out += code.slice(i + 1, j < 0 ? code.length : j); i = j < 0 ? code.length : j + 1; continue; }
    if (ch === '\\'){ out += code[i + 1] || ''; i += 2; continue; }
    if (ch === '_' || ch === '*'){ i += 2; continue; }
    if ('#0,.?'.includes(ch)){
      let j = i; while (j < code.length && '#0,.?'.includes(code[j])) j++;
      const pat = code.slice(i, j);
      if (!num){ const dec = pat.includes('.') ? (pat.split('.')[1].match(/[0#?]/g) || []).length : 0;
        out += v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: pat.includes(',') });
        num = true; }
      i = j; continue;
    }
    out += ch; i++;
  }
  return out;
}
export const PALETTE = ['#3d7c8c', '#c2703d', '#e0a458', '#9db4bc', '#6b7a86', '#3f8f5b', '#8e5ea2', '#d1495b'];
export function niceMax(v){ if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }

/* ---------- LIVE CHARTS: rebuilt from the numbers inside the .pptx ---------- */
export function renderChart(c, W0, H0, host){
  const root = el('div', 'chart', host);
  const series = c.series, S0 = series[0];
  const lab = Object.assign({}, c.labels || {}, S0.labels || {});
  const ls = lab.labelStyle || {};
  const lblSize = ls.size || 15, lblColor = rgba(ls.color || '#2b3a44');
  const catAx = c.catAxis || {}, valAx = c.valAxis || {};
  const axS = catAx.style || {}, axSize = axS.size || 15, axColor = rgba(axS.color || '#6b7a86');
  const fontCss = `font-family:${fontStack(ls.font || axS.font)};`;
  let top = 8, bottom = H0 - 6;
  const parts = { bars: [], slices: [], root };
  if (c.title){
    const ts = c.titleStyle || {}, sz = ts.size || 18;
    const t = el('div', 'ctitle', root); t.textContent = c.title;
    t.style.cssText += `font-size:${sz}px;color:${rgba(ts.color || '#1e2a32')};font-weight:${ts.b ? 700 : 400};font-family:${fontStack(ts.font)};`;
    top += sz * 1.7;
  }
  const isPie = c.type === 'pie' || c.type === 'doughnut';
  if (c.legend && (series.length > 1 || isPie)){
    const lg = el('div', 'legend', root), lsz = (c.legend.style && c.legend.style.size) || 14;
    lg.style.cssText += `font-size:${lsz}px;color:${rgba((c.legend.style && c.legend.style.color) || '#2b3a44')};${fontCss}`;
    const items = isPie ? S0.cats.map((k, i) => [k, (S0.pointColors && S0.pointColors[i]) || PALETTE[i % PALETTE.length]])
                        : series.map((s, i) => [s.name, s.color || PALETTE[i % PALETTE.length]]);
    for (const [name, col] of items){ const it = el('span', null, lg); const sw = el('i', null, it); sw.style.background = col; it.append(name); }
    if (c.legend.pos === 'b'){ lg.style.bottom = '2px'; bottom -= lsz * 1.9; }
    else { lg.style.top = top + 'px'; top += lsz * 1.9; }
  }
  const pw = W0, ph = bottom - top;
  if (isPie){
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('width', W0); svg.setAttribute('height', H0); root.appendChild(svg);
    const g = document.createElementNS(svgNS, 'g'); g.setAttribute('class', 'pie'); svg.appendChild(g);
    const cx = W0 / 2, cy = top + ph / 2, R = Math.min(pw, ph) / 2 * .92, r0 = c.type === 'doughnut' ? R * (c.hole || .5) : 0;
    g.style.transformOrigin = `${cx}px ${cy}px`;
    const vals = S0.vals.map(v => Math.max(0, v || 0)), tot = vals.reduce((a, b) => a + b, 0) || 1;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + v / tot * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0;
      const P = (rr, a) => `${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`;
      const d = r0 > 0
        ? `M${P(R, a0)} A${R} ${R} 0 ${big} 1 ${P(R, a1)} L${P(r0, a1)} A${r0} ${r0} 0 ${big} 0 ${P(r0, a0)} Z`
        : `M${cx} ${cy} L${P(R, a0)} A${R} ${R} 0 ${big} 1 ${P(R, a1)} Z`;
      const sg = document.createElementNS(svgNS, 'g'); g.appendChild(sg);
      const path = document.createElementNS(svgNS, 'path'); path.setAttribute('d', d);
      path.setAttribute('fill', (S0.pointColors && S0.pointColors[i]) || PALETTE[i % PALETTE.length]);
      path.setAttribute('stroke', 'rgba(255,255,255,.9)'); path.setAttribute('stroke-width', '1.5'); sg.appendChild(path);
      const mid = (a0 + a1) / 2;
      if (lab.showVal || lab.showPercent || lab.showCat){
        const txt = [lab.showCat ? S0.cats[i] : null,
                     lab.showPercent ? fmtNum(v / tot, /%/.test(S0.fmt || '') ? S0.fmt : '0%') : null,
                     lab.showVal ? fmtNum(v, S0.fmt) : null].filter(Boolean).join(' · ');
        const rr = r0 > 0 ? (R + r0) / 2 : R * .64;
        const t = document.createElementNS(svgNS, 'text');
        t.setAttribute('x', cx + Math.cos(mid) * rr); t.setAttribute('y', cy + Math.sin(mid) * rr);
        t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central');
        t.setAttribute('style', `font-size:${lblSize}px;fill:${ls.color ? rgba(ls.color) : '#fff'};font-weight:${ls.b ? 700 : 600};${fontCss}`);
        t.textContent = txt; if (v / tot > .035) sg.appendChild(t);
      }
      parts.slices.push({ g: sg, mid, R });
      a0 = a1;
    });
    return parts;
  }
  // ---- cartesian: bar (col / bar), line, area
  const cats = S0.cats.length ? S0.cats : S0.vals.map((_, i) => String(i + 1));
  const nC = cats.length, nS = series.length;
  const stacked = /stacked/i.test(c.grouping || ''), pct = /percent/i.test(c.grouping || '');
  const all = [];
  if (stacked) for (let i = 0; i < nC; i++) all.push(series.reduce((a, s) => a + (s.vals[i] || 0), 0));
  else series.forEach(s => s.vals.forEach(v => v != null && all.push(v)));
  let vmin = valAx.min != null ? valAx.min : Math.min(0, ...all);
  let vmax = valAx.max != null ? valAx.max : (pct ? 1 : niceMax(Math.max(...all, 0) * (lab.showVal ? 1.14 : 1.04)));
  if (valAx.max == null && !pct && lab.showVal) vmax = Math.max(...all) * 1.16;
  if (vmax <= vmin) vmax = vmin + 1;
  const horiz = c.type === 'bar' && c.barDir === 'bar';
  const showTicks = !valAx.hidden, showCats = !catAx.hidden;
  const padL = horiz ? (showCats ? Math.min(W0 * .3, 12 + Math.max(...cats.map(s => String(s).length)) * axSize * .52) : 8)
                     : (showTicks ? 46 : 10);
  const padB = horiz ? (showTicks ? axSize * 2 : 8) : (showCats ? axSize * 2.1 : 8);
  const x0 = padL, y0 = top + 4, pw2 = W0 - padL - 12, ph2 = ph - padB - 4;
  const axisLine = el('div', null, root);
  axisLine.style.cssText = horiz ? `position:absolute;left:${x0}px;top:${y0}px;width:1.5px;height:${ph2}px;background:rgba(160,175,185,.8)`
                                 : `position:absolute;left:${x0}px;top:${y0 + ph2}px;width:${pw2}px;height:1.5px;background:rgba(160,175,185,.8)`;
  const valPos = (v) => (v - vmin) / (vmax - vmin);
  if (showTicks){
    for (let k = 0; k <= 4; k++){
      const v = vmin + (vmax - vmin) * k / 4, t = el('div', 'tick', root);
      t.textContent = fmtNum(v, valAx.fmt || S0.fmt); t.style.cssText += `font-size:${axSize}px;color:${axColor};${fontCss}`;
      if (horiz){ t.style.left = (x0 + pw2 * k / 4 - 30) + 'px'; t.style.width = '60px'; t.style.top = (y0 + ph2 + 4) + 'px'; }
      else { t.style.right = (W0 - x0 + 6) + 'px'; t.style.top = (y0 + ph2 - ph2 * k / 4 - axSize * .65) + 'px'; t.style.textAlign = 'right'; }
    }
  }
  const band = (horiz ? ph2 : pw2) / nC;
  if (showCats) cats.forEach((name, i) => {
    const t = el('div', 'cat', root); t.textContent = name; t.style.cssText += `font-size:${axSize}px;color:${axColor};${fontCss}`;
    if (horiz){ t.style.left = '0px'; t.style.width = (x0 - 8) + 'px'; t.style.textAlign = 'right';
      t.style.top = (y0 + ph2 - band * (i + .5) - axSize * .65) + 'px'; }
    else { t.style.left = (x0 + band * i) + 'px'; t.style.width = band + 'px'; t.style.top = (y0 + ph2 + axSize * .45) + 'px'; }
  });
  if (c.type === 'bar'){
    const gW = band / (1 + (c.gap != null ? c.gap : 1.5));
    const bW = stacked ? gW : gW / nS;
    const acc = new Array(nC).fill(0);
    series.forEach((s, j) => {
      const col = s.color || PALETTE[j % PALETTE.length];
      const sl = Object.assign({}, lab, s.labels || {});
      s.vals.forEach((v, i) => {
        if (v == null) return;
        const val = pct ? v / (all[i] || 1) : v;
        const base = stacked ? acc[i] : Math.max(vmin, 0), end = base + val; if (stacked) acc[i] = end;
        const a = valPos(Math.min(base, end)), b = valPos(Math.max(base, end));
        const bar = el('div', 'bar' + (horiz ? ' h' : ''), root), fill = el('div', 'fill', bar);
        fill.style.background = (s.pointColors && s.pointColors[i]) || col;
        const off = band * i + (band - gW) / 2 + (stacked ? 0 : j * bW);
        if (horiz) bar.style.cssText += `left:${x0 + pw2 * a}px;width:${Math.max(1, pw2 * (b - a))}px;top:${y0 + ph2 - off - bW}px;height:${bW}px;`;
        else bar.style.cssText += `left:${x0 + off}px;width:${bW}px;top:${y0 + ph2 - ph2 * b}px;height:${Math.max(1, ph2 * (b - a))}px;`;
        const delay = (i * nS + j) * 55;
        fill.style.transitionDelay = delay + 'ms';
        if (sl.showVal){
          const lb = el('span', 'lbl', bar); lb.textContent = fmtNum(v, sl.fmt || s.fmt);
          lb.style.cssText += `font-size:${lblSize}px;color:${lblColor};${fontCss}transition-delay:${delay + 450}ms;`;
          if (stacked){ lb.style.left = '0'; lb.style.right = '0'; lb.style.top = '50%'; lb.style.textAlign = 'center'; lb.style.transform = 'translateY(-50%)'; lb.style.color = '#fff'; }
          else if (horiz){ lb.style.left = 'calc(100% + 6px)'; lb.style.top = '50%'; lb.style.transform = 'translateY(-50%)'; }
          else { lb.style.left = '50%'; lb.style.bottom = 'calc(100% + 4px)'; lb.style.transform = 'translateX(-50%)'; }
        }
        parts.bars.push({ el: bar, k: i * nS + j });
      });
    });
    return parts;
  }
  // line / area
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('width', W0); svg.setAttribute('height', H0); root.appendChild(svg);
  series.forEach((s, j) => {
    const col = s.color || PALETTE[j % PALETTE.length];
    const sl = Object.assign({}, lab, s.labels || {});
    const pts = s.vals.map((v, i) => v == null ? null : [x0 + band * (i + .5), y0 + ph2 - ph2 * valPos(v)]);
    const live = pts.filter(Boolean);
    if (!live.length) return;
    const dstr = 'M' + live.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
    if (c.type === 'area'){
      const ar = document.createElementNS(svgNS, 'path');
      ar.setAttribute('d', dstr + ` L${live[live.length - 1][0]} ${y0 + ph2} L${live[0][0]} ${y0 + ph2} Z`);
      ar.setAttribute('fill', col); ar.setAttribute('class', 'area'); svg.appendChild(ar);
    }
    const path = document.createElementNS(svgNS, 'path'); path.setAttribute('d', dstr); path.setAttribute('pathLength', '1');
    path.setAttribute('class', 'ln'); path.setAttribute('fill', 'none'); path.setAttribute('stroke', col);
    path.setAttribute('stroke-width', '4'); path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
    pts.forEach((p, i) => {
      if (!p) return;
      const dot = document.createElementNS(svgNS, 'circle'); dot.setAttribute('cx', p[0]); dot.setAttribute('cy', p[1]); dot.setAttribute('r', 6);
      dot.setAttribute('fill', col); dot.setAttribute('class', 'dot'); dot.style.transitionDelay = (300 + i * 110) + 'ms'; svg.appendChild(dot);
      if (sl.showVal){
        const lb = el('span', 'lbl', root); lb.textContent = fmtNum(s.vals[i], sl.fmt || s.fmt);
        lb.style.cssText += `font-size:${lblSize}px;color:${lblColor};${fontCss}left:${p[0] - 60}px;width:120px;text-align:center;`
          + `top:${p[1] + (sl.pos === 'b' ? 10 : -lblSize * 1.8)}px;transition-delay:${400 + i * 110}ms;`;
      }
      parts.bars.push({ el: null, k: i });
    });
  });
  return parts;
}
