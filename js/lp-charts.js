/* lp-charts.js — LIVE CHARTS for LinkPresent: native PowerPoint charts redrawn from the numbers
   stored inside the .pptx. Column/bar (clustered, stacked, 100%), line, area, scatter, pie,
   doughnut, and combos (columns + a line on a second axis). Follows PowerPoint's defaults where
   the file is silent: theme accent colours, the chart-wide text size, "nice" axis steps, gridlines,
   the automatic title of a single-series chart.
   Returns handles the stage animates: { root, bars:[{el,k}], slices:[{g,mid,R}] }. */
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

/* "nice" axis like PowerPoint's automatic scale: about 6 steps of 1, 2, 2.5 or 5 × 10^k */
export function niceScale(lo, hi, ax = {}){
  if (ax.min != null) lo = ax.min; else if (lo > 0) lo = 0;
  if (ax.max != null) hi = ax.max;
  if (!(hi > lo)) hi = lo + 1;
  let step = ax.step;
  if (!step){
    const raw = (hi - lo) / 6, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }
  if (ax.min == null && lo < 0) lo = Math.floor(lo / step) * step;
  if (ax.max == null) hi = Math.ceil((hi + (hi - lo) * .05) / step - 1e-9) * step;   // ~5% headroom, then round up
  return { lo, hi, step };
}
const ticksOf = (sc) => { const t = []; for (let v = sc.lo; v <= sc.hi + sc.step * 1e-6; v += sc.step) t.push(+v.toFixed(10)); return t; };
const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs, parent) => { const e = document.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const textW = (s, size) => String(s).length * size * .55;

export function renderChart(c, W0, H0, host){
  const root = el('div', 'chart', host);
  const parts = { bars: [], slices: [], root };
  const series = c.series, S0 = series[0];
  const base = c.textStyle || {};
  const baseSize = base.size || 13.33;                       // PowerPoint's chart default: 10 pt
  const baseColor = base.color || '#595959';
  const lab0 = Object.assign({}, c.labels || {}, S0.labels || {});
  const ls = lab0.labelStyle || {};
  const lblSize = ls.size || baseSize, lblColor = rgba(ls.color || base.color || '#404040');
  const catAx = c.catAxis || {}, valAx = c.valAxis || {}, valAx2 = c.valAxis2 || null;
  const axStyle = (ax) => ({ size: (ax.style && ax.style.size) || baseSize, color: rgba((ax.style && ax.style.color) || baseColor) });
  const fontCss = `font-family:${fontStack(ls.font || (catAx.style && catAx.style.font) || base.font)};`;
  const colorOf = (s, j) => s.color || PALETTE[j % PALETTE.length];
  let top = 6, bottom = H0 - 4, left = 4, right = W0 - 4;

  // ---- title
  if (c.title){
    const ts = c.titleStyle || {}, sz = ts.size || baseSize * 1.3;
    const t = el('div', 'ctitle', root); t.textContent = c.title;
    t.style.cssText += `font-size:${sz}px;color:${rgba(ts.color || base.color || '#404040')};font-weight:${ts.b || ts.auto ? 700 : 400};font-family:${fontStack(ts.font || base.font)};`;
    top += sz * 1.7;
  }
  // ---- legend (any side)
  const isPie = c.type === 'pie' || c.type === 'doughnut';
  if (c.legend && (series.length > 1 || isPie)){
    const st = c.legend.style || {}, lsz = st.size || baseSize;
    const lg = el('div', 'legend', root);
    lg.style.cssText += `font-size:${lsz}px;color:${rgba(st.color || baseColor)};${fontCss}`;
    let items = isPie ? S0.cats.map((k, i) => [k, (S0.pointColors && S0.pointColors[i]) || PALETTE[i % PALETTE.length]])
                      : series.map((s, j) => [s.name, colorOf(s, j), s.kind]);
    const vertical = (c.legend.pos || 'r') === 'r' || c.legend.pos === 'l';
    if (vertical && /stacked/i.test(c.grouping || '') && c.barDir !== 'bar') items = items.slice().reverse();
    for (const [name, col, kind] of items){
      const it = el('span', null, lg), sw = el('i', null, it);
      sw.style.background = col; if (kind === 'line' || kind === 'scatter'){ sw.style.height = '3px'; sw.style.verticalAlign = '3px'; }
      it.append(name);
    }
    const pos = c.legend.pos || 'r';
    if (pos === 'r' || pos === 'l'){
      const lw = Math.min(W0 * .35, Math.max(...items.map(i => textW(i[0], lsz))) + 26);
      lg.style.cssText += `flex-direction:column;gap:6px;justify-content:center;top:${top}px;bottom:0;width:${lw}px;left:auto;right:auto;`;
      if (pos === 'r'){ lg.style.right = '4px'; right -= lw + 8; } else { lg.style.left = '4px'; left += lw + 8; }
    } else if (pos === 'b'){ lg.style.bottom = '2px'; bottom -= lsz * 1.9; }
    else { lg.style.top = top + 'px'; top += lsz * 1.9; }
  }
  const pw = right - left, ph = bottom - top;

  // ================= pie / doughnut =================
  if (isPie){
    const svg = svgEl('svg', { width: W0, height: H0 }); root.appendChild(svg);
    const g = svgEl('g', { class: 'pie' }, svg);
    const lab = lab0, outside = (lab.pos === 'outEnd' || lab.pos === 'bestFit' && lab.showCat) && c.type === 'pie';
    const cx = left + pw / 2, cy = top + ph / 2;
    let R = Math.min(pw, ph) / 2 * .92;
    if (outside) R = Math.min(pw / 2 - textW('Warehousing 15%', lblSize) * .55, ph / 2 - lblSize * 1.6, R);
    const r0 = c.type === 'doughnut' ? R * (c.hole || .5) : 0;
    g.style.transformOrigin = `${cx}px ${cy}px`;
    const vals = S0.vals.map(v => Math.max(0, v || 0)), tot = vals.reduce((a, b) => a + b, 0) || 1;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + v / tot * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0;
      const P = (rr, a) => `${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`;
      const d = r0 > 0
        ? `M${P(R, a0)} A${R} ${R} 0 ${big} 1 ${P(R, a1)} L${P(r0, a1)} A${r0} ${r0} 0 ${big} 0 ${P(r0, a0)} Z`
        : `M${cx} ${cy} L${P(R, a0)} A${R} ${R} 0 ${big} 1 ${P(R, a1)} Z`;
      const sg = svgEl('g', {}, g);
      svgEl('path', { d, fill: (S0.pointColors && S0.pointColors[i]) || PALETTE[i % PALETTE.length], stroke: 'rgba(255,255,255,.9)', 'stroke-width': 1.5 }, sg);
      const mid = (a0 + a1) / 2;
      if (lab.showVal || lab.showPercent || lab.showCat){
        const parts2 = [lab.showCat ? S0.cats[i] : null,
                        lab.showPercent ? fmtNum(v / tot, /%/.test(lab.fmt || S0.fmt || '') ? (lab.fmt || S0.fmt) : '0%') : null,
                        lab.showVal ? fmtNum(v, S0.fmt) : null].filter(Boolean);
        const rr = outside ? R + lblSize * .7 : r0 > 0 ? (R + r0) / 2 : R * .64;
        const x = cx + Math.cos(mid) * rr, y = cy + Math.sin(mid) * rr;
        const t = svgEl('text', { x, y, 'text-anchor': outside ? (Math.cos(mid) >= 0 ? 'start' : 'end') : 'middle', 'dominant-baseline': 'central',
          style: `font-size:${lblSize}px;fill:${ls.color ? rgba(ls.color) : outside ? rgba(baseColor) : '#fff'};font-weight:${ls.b ? 700 : outside ? 400 : 600};${fontCss}` });
        if (outside && parts2.length > 1){            // category on one line, value under it
          parts2.forEach((s, k) => svgEl('tspan', { x, dy: k ? lblSize * 1.15 : -lblSize * .55 * (parts2.length - 1) }, t).textContent = s);
        } else t.textContent = parts2.join(' · ');
        if (v / tot > .035) sg.appendChild(t);
      }
      parts.slices.push({ g: sg, mid, R });
      a0 = a1;
    });
    return parts;
  }

  // ================= cartesian =================
  const scatter = c.type === 'scatter';
  const horiz = c.type === 'bar' && c.barDir === 'bar';
  const barS = series.filter(s => s.kind === 'bar');
  const grouping = c.grouping || '';
  const stacked = /stacked/i.test(grouping), pct = /percent/i.test(grouping);
  const cats = scatter ? [] : (S0.cats.length ? S0.cats : S0.vals.map((_, i) => String(i + 1)));
  const nC = cats.length;
  const prim = series.filter(s => !s.secondary), sec = series.filter(s => s.secondary);
  // value extents (stack-aware for bars)
  const extent = (list) => {
    const out = [];
    const bars = list.filter(s => s.kind === 'bar');
    if (bars.length && stacked && !pct) for (let i = 0; i < nC; i++){
      let pos = 0, neg = 0; for (const s of bars){ const v = s.vals[i] || 0; if (v >= 0) pos += v; else neg += v; } out.push(pos, neg); }
    for (const s of list) if (!(s.kind === 'bar' && stacked)) s.vals.forEach(v => v != null && out.push(v));
    return out.length ? [Math.min(...out), Math.max(...out)] : [0, 1];
  };
  const [p0, p1] = pct ? [0, 1] : extent(prim);
  let sc = niceScale(p0, p1, pct ? { min: 0, max: 1, step: .25, ...valAx } : valAx);
  const anyVal = series.some(s => (Object.assign({}, lab0, s.labels || {})).showVal);
  if (valAx.hidden && anyVal && valAx.max == null) sc.hi = Math.max(sc.hi, p1 * 1.12);   // room for the labels
  const sc2 = sec.length ? (() => { const [a, b] = extent(sec); return niceScale(a, b, valAx2 || {}); })() : null;
  let xs = null;
  if (scatter){
    const all = series.flatMap(s => (s.xs || []).filter(v => v != null));
    xs = niceScale(Math.min(...all), Math.max(...all), catAx);
  }
  const vS = axStyle(valAx), cS = axStyle(catAx), v2S = valAx2 ? axStyle(valAx2) : vS;
  const valFmt = valAx.fmt || (pct ? '0%' : null) || (prim[0] && prim[0].fmt) || null;
  const tickLabels = valAx.hidden || valAx.noLabels ? [] : ticksOf(sc).map(v => fmtNum(v, valFmt));
  const tick2Labels = sc2 && !(valAx2.hidden || valAx2.noLabels) ? ticksOf(sc2).map(v => fmtNum(v, valAx2.fmt || sec[0].fmt)) : [];
  const catLabels = catAx.hidden || catAx.noLabels ? [] : scatter ? ticksOf(xs).map(v => fmtNum(v, catAx.fmt)) : cats.map(String);
  // plot rectangle
  const vTitle = valAx.title && !valAx.hidden, v2Title = valAx2 && valAx2.title && !valAx2.hidden, cTitle = catAx.title && !catAx.hidden;
  let x0 = left, x1 = right, y0 = top + 4, y1 = bottom;
  if (horiz){
    x0 += catLabels.length ? Math.min(pw * .32, Math.max(...catLabels.map(s => textW(s, cS.size))) + 10) : 6;
    y1 -= tickLabels.length ? vS.size * 1.7 : 4;
    x1 -= 10;
  } else {
    if (vTitle) x0 += vS.size * 1.6;
    x0 += tickLabels.length ? Math.max(...tickLabels.map(s => textW(s, vS.size))) + 8 : 6;
    if (v2Title) x1 -= v2S.size * 1.6;
    x1 -= tick2Labels.length ? Math.max(...tick2Labels.map(s => textW(s, v2S.size))) + 8 : 10;
    y1 -= catLabels.length ? cS.size * 1.8 : 4;
    if (cTitle) y1 -= cS.size * 1.7;
  }
  const PW = x1 - x0, PH = y1 - y0;
  const svg = svgEl('svg', { width: W0, height: H0 }); root.appendChild(svg);
  const gridCol = 'rgba(160,166,172,.45)';
  const vpos = (v, s = sc) => (v - s.lo) / (s.hi - s.lo);
  // gridlines + value tick labels
  ticksOf(sc).forEach((v, k) => {
    const f = vpos(v);
    if (valAx.grid){
      if (horiz) svgEl('line', { x1: x0 + PW * f, x2: x0 + PW * f, y1: y0, y2: y1, stroke: gridCol, 'stroke-width': 1 }, svg);
      else svgEl('line', { x1: x0, x2: x1, y1: y1 - PH * f, y2: y1 - PH * f, stroke: gridCol, 'stroke-width': 1 }, svg);
    }
    if (!tickLabels.length) return;
    const t = el('div', 'tick', root); t.textContent = tickLabels[k];
    t.style.cssText += `font-size:${vS.size}px;color:${vS.color};${fontCss}`;
    if (horiz){ t.style.left = (x0 + PW * f - 40) + 'px'; t.style.width = '80px'; t.style.top = (y1 + 4) + 'px'; }
    else { t.style.right = (W0 - x0 + 5) + 'px'; t.style.top = (y1 - PH * f - vS.size * .62) + 'px'; t.style.textAlign = 'right'; }
  });
  if (sc2 && tick2Labels.length) ticksOf(sc2).forEach((v, k) => {
    const t = el('div', 'tick', root); t.textContent = tick2Labels[k];
    t.style.cssText += `font-size:${v2S.size}px;color:${v2S.color};${fontCss}left:${x1 + 5}px;top:${y1 - PH * vpos(v, sc2) - v2S.size * .62}px;text-align:left;`;
  });
  // axis titles
  const axTitle = (text, st, css) => { const t = el('div', 'tick', root); t.textContent = text; t.style.cssText += `font-size:${st.size}px;color:${st.color};${fontCss}${css}`; };
  if (vTitle) axTitle(valAx.title, vS, `left:${left}px;top:${y0 + PH / 2}px;transform:translate(-50%,-50%) rotate(-90deg) translateY(${vS.size * .5}px);transform-origin:center;white-space:nowrap;margin-left:${vS.size * .5}px;`);
  if (v2Title) axTitle(valAx2.title, v2S, `left:${right - v2S.size * .6}px;top:${y0 + PH / 2}px;transform:translate(-50%,-50%) rotate(90deg);white-space:nowrap;`);
  if (cTitle) axTitle(catAx.title, cS, `left:${x0}px;width:${PW}px;text-align:center;top:${bottom - cS.size * 1.5}px;`);
  // category axis line
  if (!catAx.hidden){
    if (horiz) svgEl('line', { x1: x0, x2: x0, y1: y0, y2: y1, stroke: 'rgba(160,170,180,.9)', 'stroke-width': 1.2 }, svg);
    else svgEl('line', { x1: x0, x2: x1, y1: y1 - (sc.lo < 0 ? PH * vpos(0) : 0), y2: y1 - (sc.lo < 0 ? PH * vpos(0) : 0), stroke: 'rgba(160,170,180,.9)', 'stroke-width': 1.2 }, svg);
  }
  // categories (or the scatter X scale)
  const band = scatter ? 0 : (horiz ? PH : PW) / Math.max(1, nC);
  const catIndex = (i) => catAx.reverse ? nC - 1 - i : i;          // maxMin orientation flips the order
  const catCenter = (i) => horiz ? y1 - band * (catIndex(i) + .5) : x0 + band * (catIndex(i) + .5);
  if (scatter){
    ticksOf(xs).forEach((v, k) => {
      const f = vpos(v, xs);
      if (catAx.grid) svgEl('line', { x1: x0 + PW * f, x2: x0 + PW * f, y1: y0, y2: y1, stroke: gridCol, 'stroke-width': 1 }, svg);
      if (!catLabels.length) return;
      const t = el('div', 'cat', root); t.textContent = catLabels[k];
      t.style.cssText += `font-size:${cS.size}px;color:${cS.color};${fontCss}left:${x0 + PW * f - 40}px;width:80px;top:${y1 + cS.size * .35}px;`;
    });
  } else if (catLabels.length) cats.forEach((name, i) => {
    const t = el('div', 'cat', root); t.textContent = name; t.style.cssText += `font-size:${cS.size}px;color:${cS.color};${fontCss}`;
    if (horiz){ t.style.left = left + 'px'; t.style.width = (x0 - left - 8) + 'px'; t.style.textAlign = 'right'; t.style.top = (catCenter(i) - cS.size * .62) + 'px'; }
    else { t.style.left = (x0 + band * catIndex(i)) + 'px'; t.style.width = band + 'px'; t.style.top = (y1 + cS.size * .35) + 'px'; }
  });

  // ---- bars
  if (barS.length){
    const gW = band / (1 + (c.gap != null ? c.gap : 1.5));
    const bW = stacked ? gW : gW / barS.length;
    const totals = cats.map((_, i) => barS.reduce((a, s) => a + Math.abs(s.vals[i] || 0), 0) || 1);
    const accP = new Array(nC).fill(0), accN = new Array(nC).fill(0);
    barS.forEach((s, j) => {
      const scale = s.secondary && sc2 ? sc2 : sc;
      const col = colorOf(s, series.indexOf(s));
      const sl = Object.assign({}, lab0, s.labels || {});
      s.vals.forEach((v, i) => {
        if (v == null) return;
        const val = pct ? v / totals[i] : v;
        let b0 = Math.max(scale.lo, 0), b1;
        if (stacked){ if (val >= 0){ b0 = accP[i]; accP[i] += val; b1 = accP[i]; } else { b0 = accN[i]; accN[i] += val; b1 = accN[i]; } }
        else b1 = val;
        const a = vpos(Math.min(b0, b1), scale), b = vpos(Math.max(b0, b1), scale);
        const bar = el('div', 'bar' + (horiz ? ' h' : ''), root), fill = el('div', 'fill', bar);
        fill.style.background = (s.pointColors && s.pointColors[i]) || col;
        const inBand = (band - gW) / 2 + (stacked ? 0 : j * bW);
        if (horiz){                                         // first series nearest the axis bottom
          const yTop = catCenter(i) + band / 2 - inBand - bW;
          bar.style.cssText += `left:${x0 + PW * a}px;width:${Math.max(1, PW * (b - a))}px;top:${yTop}px;height:${bW}px;`;
        } else bar.style.cssText += `left:${x0 + band * catIndex(i) + inBand}px;width:${bW}px;top:${y1 - PH * b}px;height:${Math.max(1, PH * (b - a))}px;`;
        const delay = (i * barS.length + j) * 55;
        fill.style.transitionDelay = delay + 'ms';
        if (sl.showVal){
          const lb = el('span', 'lbl', bar); lb.textContent = fmtNum(pct && /%/.test(sl.fmt || '') ? val : v, sl.fmt || s.fmt);
          lb.style.cssText += `font-size:${(sl.labelStyle && sl.labelStyle.size) || lblSize}px;color:${sl.labelStyle && sl.labelStyle.color ? rgba(sl.labelStyle.color) : lblColor};${fontCss}transition-delay:${delay + 450}ms;`;
          const inside = stacked || sl.pos === 'ctr' || sl.pos === 'inEnd' || sl.pos === 'inBase';
          if (inside){ lb.style.left = '0'; lb.style.right = '0'; lb.style.top = '50%'; lb.style.textAlign = 'center'; lb.style.transform = 'translateY(-50%)'; }
          else if (horiz){ lb.style.left = 'calc(100% + 5px)'; lb.style.top = '50%'; lb.style.transform = 'translateY(-50%)'; }
          else { lb.style.left = '50%'; lb.style.bottom = 'calc(100% + 3px)'; lb.style.transform = 'translateX(-50%)'; }
        }
        parts.bars.push({ el: bar, k: i * barS.length + j });
      });
    });
  }
  // ---- lines, areas, scatter (in their own layer, above any bars)
  const svgL = barS.length ? svgEl('svg', { width: W0, height: H0 }) : svg;
  if (svgL !== svg) root.appendChild(svgL);
  series.filter(s => s.kind !== 'bar').forEach((s) => {
    const j = series.indexOf(s), col = colorOf(s, j);
    const scale = s.secondary && sc2 ? sc2 : sc;
    const sl = Object.assign({}, lab0, s.labels || {});
    const pts = s.vals.map((v, i) => {
      if (v == null) return null;
      const x = scatter ? x0 + PW * vpos(s.xs[i], xs) : catCenter(i);
      return [x, y1 - PH * vpos(v, scale)];
    });
    const live = pts.filter(Boolean);
    if (!live.length) return;
    const dstr = 'M' + live.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
    if (s.kind === 'area'){
      const zero = y1 - PH * vpos(Math.max(scale.lo, 0), scale);
      svgEl('path', { d: dstr + ` L${live[live.length - 1][0]} ${zero} L${live[0][0]} ${zero} Z`, fill: col, class: 'area solid' }, svgL);
    } else if (s.line !== false){
      svgEl('path', { d: dstr, pathLength: 1, class: 'ln', fill: 'none', stroke: col, 'stroke-width': s.width || 3,
                      'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svgL);
    }
    pts.forEach((p, i) => {
      if (!p) return;
      if (s.kind !== 'area' && s.marker !== false){
        const dot = svgEl('circle', { cx: p[0], cy: p[1], r: scatter ? 5.5 : Math.max(4, (s.width || 3) * 1.3), fill: col, class: 'dot' }, svgL);
        dot.style.transitionDelay = (300 + i * 90) + 'ms';
      }
      if (sl.showVal){
        const lb = el('span', 'lbl', root); lb.textContent = fmtNum(s.vals[i], sl.fmt || s.fmt);
        lb.style.cssText += `font-size:${(sl.labelStyle && sl.labelStyle.size) || lblSize}px;color:${lblColor};${fontCss}left:${p[0] - 60}px;width:120px;text-align:center;`
          + `top:${p[1] + (sl.pos === 'b' ? 10 : -lblSize * 1.8)}px;transition-delay:${400 + i * 90}ms;`;
      }
      parts.bars.push({ el: null, k: i });
    });
  });
  return parts;
}
