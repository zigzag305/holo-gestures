/* lp-render.js — one DOM element per pptx object, positioned in slide pixels.
   Input is a piece from pptx_deck.py (shape | line | pic | table | chart). */
import { el, rgba, fontStack, fillCss } from './lp-dom.js';
import { renderChart } from './lp-charts.js';

export const GEOM_CLIP = {
  diamond: 'polygon(50% 0,100% 50%,50% 100%,0 50%)', triangle: 'polygon(50% 0,100% 100%,0 100%)',
  rtTriangle: 'polygon(0 0,100% 100%,0 100%)', hexagon: 'polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)',
  pentagon: 'polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%)', parallelogram: 'polygon(25% 0,100% 0,75% 100%,0 100%)',
  homePlate: 'polygon(0 0,85% 0,100% 50%,85% 100%,0 100%)', chevron: 'polygon(0 0,80% 0,100% 50%,80% 100%,0 100%,20% 50%)',
  rightArrow: 'polygon(0 30%,65% 30%,65% 0,100% 50%,65% 100%,65% 70%,0 70%)',
  leftArrow: 'polygon(100% 30%,35% 30%,35% 0,0 50%,35% 100%,35% 70%,100% 70%)',
  octagon: 'polygon(29% 0,71% 0,100% 29%,100% 71%,71% 100%,29% 100%,0 71%,0 29%)',
  star5: 'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)',
  star4: 'polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%)',
  star6: 'polygon(50% 0,63% 25%,93% 25%,77% 50%,93% 75%,63% 75%,50% 100%,37% 75%,7% 75%,23% 50%,7% 25%,37% 25%)',
  trapezoid: 'polygon(25% 0,75% 0,100% 100%,0 100%)',
  plus: 'polygon(33% 0,67% 0,67% 33%,100% 33%,100% 67%,67% 67%,67% 100%,33% 100%,33% 67%,0 67%,0 33%,33% 33%)',
  upArrow: 'polygon(50% 0,100% 35%,70% 35%,70% 100%,30% 100%,30% 35%,0 35%)',
  downArrow: 'polygon(30% 0,70% 0,70% 65%,100% 65%,50% 100%,0 65%,30% 65%)',
  flowChartDecision: 'polygon(50% 0,100% 50%,50% 100%,0 50%)',
};
GEOM_CLIP.cross = GEOM_CLIP.plus;
const ROUNDISH = { flowChartTerminator: 'pill', flowChartConnector: 'ellipse', flowChartAlternateProcess: 'round' };
export function runStyle(r){
  let s = `font-size:${r.size || 24}px;font-family:${fontStack(r.font)};color:${rgba(r.color || '#000000', r.alpha)};`;
  if (r.b) s += 'font-weight:700;'; if (r.i) s += 'font-style:italic;'; if (r.u) s += 'text-decoration:underline;';
  if (r.spacing) s += `letter-spacing:${r.spacing}px;`; if (r.caps) s += 'text-transform:uppercase;';
  return s;
}
export const ALIGN = { l:'left', ctr:'center', r:'right', just:'justify', dist:'justify' };
export function renderText(tx, host){
  const box = el('div', 'tx', host);
  const [l, t, r, b] = tx.insets || [9.6, 4.8, 9.6, 4.8];
  box.style.padding = `${t}px ${r}px ${b}px ${l}px`;
  box.style.justifyContent = tx.anchor === 'ctr' ? 'center' : tx.anchor === 'b' ? 'flex-end' : 'flex-start';
  if (tx.wrap === false) box.style.whiteSpace = 'nowrap';
  if (tx.vert){                                    // vertical text: vert270 reads bottom to top
    box.style.writingMode = 'vertical-rl';
    if (tx.vert === 'vert270') box.style.transform = 'rotate(180deg)';
  }
  if (tx.cols > 1){ box.style.display = 'block'; box.style.columnCount = tx.cols; box.style.columnGap = (tx.colGap || 0) + 'px'; box.style.columnFill = 'auto'; }   // PowerPoint fills column 1 first
  for (const p of tx.paras || []){
    const d = el('div', 'p', box);
    const first = (p.runs && p.runs[0]) || {};
    const size = p.empty || first.size || 24;
    d.style.textAlign = ALIGN[p.align] || 'left';
    d.style.lineHeight = (1.2 * (p.lineSpacing || 1)).toFixed(3);
    d.style.fontSize = size + 'px';
    if (p.spaceAfter) d.style.marginBottom = p.spaceAfter + 'px';
    if (p.spaceBefore) d.style.marginTop = p.spaceBefore + 'px';
    const marL = p.marL || 0, ind = p.indent || 0;
    if (marL) d.style.paddingLeft = marL + 'px';
    if (p.empty){ d.style.height = (size * 1.2) + 'px'; continue; }
    if (p.bullet){
      const bu = el('span', 'bu', d); bu.textContent = p.bullet;
      bu.style.cssText = runStyle(first) + `width:${Math.max(-ind, size * .9)}px;margin-left:${ind < 0 ? ind : -size * .9}px;`
        + (p.buColor ? `color:${rgba(p.buColor)};` : '') + (p.buSize ? `font-size:${(first.size || size) * p.buSize}px;` : '');
    }
    for (const r of p.runs){ const s = el('span', null, d); s.textContent = r.t; s.style.cssText = runStyle(r); }
  }
  return box;
}
export function renderTable(t, host){
  const tb = el('table', null, host);
  const cg = el('colgroup', null, tb);
  let tw = 0; for (const w of t.cols){ const c = el('col', null, cg); c.style.width = w + 'px'; tw += w; }
  tb.style.width = tw + 'px';
  for (const row of t.rows){
    const tr = el('tr', null, tb); tr.style.height = row.h + 'px';
    for (const c of row.cells){
      if (c.merged) continue;
      const td = el('td', null, tr);
      if (c.span > 1) td.colSpan = c.span; if (c.rowSpan > 1) td.rowSpan = c.rowSpan;
      const m = c.mar || [9.6, 4.8, 9.6, 4.8];
      td.style.cssText = `background:${c.fill ? rgba(c.fill) : 'transparent'};border:1px solid ${c.border ? rgba(c.border) : 'rgba(150,165,175,.5)'};`
        + `padding:${m[1]}px ${m[2]}px ${m[3]}px ${m[0]}px;vertical-align:${c.anchor === 'ctr' ? 'middle' : c.anchor === 'b' ? 'bottom' : 'top'};`;
      if (c.text && c.text.paras && c.text.paras.length) renderText(Object.assign({}, c.text, { insets: [0, 0, 0, 0] }), td);
    }
  }
  return tb;
}

const SVG = 'http://www.w3.org/2000/svg';
let markerN = 0;
/* A line or connector inside its box, from top-left to bottom-right (flips are applied by the
   caller's transform, exactly as PowerPoint stores them). Elbow and curved connectors keep
   their shape; head/tail ends become arrowheads. */
function lineSvg(p){
  const svg = document.createElementNS(SVG, 'svg');
  const w = p.w < 1 ? 0 : p.w, h = p.h < 1 ? 0 : p.h;
  svg.setAttribute('width', Math.max(p.w, 1)); svg.setAttribute('height', Math.max(p.h, 1)); svg.style.overflow = 'visible';
  const col = rgba(p.line.color, p.line.alpha);
  const path = document.createElementNS(SVG, 'path');
  const g = p.geom || '';
  let d = `M0 0 L${w} ${h}`;
  if (/^bentConnector2/.test(g)) d = `M0 0 H${w} V${h}`;
  else if (/^bentConnector[345]/.test(g)) d = `M0 0 H${w / 2} V${h} H${w}`;
  else if (/^curvedConnector/.test(g)) d = `M0 0 C${w / 2} 0 ${w / 2} ${h} ${w} ${h}`;
  path.setAttribute('d', d); path.setAttribute('fill', 'none');
  path.setAttribute('stroke', col); path.setAttribute('stroke-width', p.line.w);
  if (p.line.dash) path.setAttribute('stroke-dasharray', `${p.line.w * 4} ${p.line.w * 3}`);
  const defs = document.createElementNS(SVG, 'defs');
  for (const [end, attr] of [['headEnd', 'marker-start'], ['tailEnd', 'marker-end']]){
    if (!p.line[end]) continue;
    const id = 'lpm' + (++markerN), m = document.createElementNS(SVG, 'marker');
    m.setAttribute('id', id); m.setAttribute('viewBox', '0 0 10 10'); m.setAttribute('refX', '8'); m.setAttribute('refY', '5');
    m.setAttribute('markerWidth', '3.6'); m.setAttribute('markerHeight', '3.6'); m.setAttribute('orient', 'auto-start-reverse');
    const tri = document.createElementNS(SVG, 'path');
    tri.setAttribute('d', p.line[end] === 'oval' ? 'M5 1.5 A3.5 3.5 0 1 1 4.99 1.5 Z' : p.line[end] === 'diamond' ? 'M5 0 L10 5 L5 10 L0 5 Z' : 'M0 0 L10 5 L0 10 Z');
    tri.setAttribute('fill', col); m.appendChild(tri); defs.appendChild(m);
    path.setAttribute(attr, `url(#${id})`);
  }
  svg.appendChild(defs); svg.appendChild(path);
  return svg;
}

export function renderPiece(p, slideEl){
  const w = el('div', 'piece' + (p.locked ? ' locked' : ''), slideEl);
  w.style.cssText = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;`;
  const inner = el('div', 'inner', w);
  const flips = (p.flipH ? ' scaleX(-1)' : '') + (p.flipV ? ' scaleY(-1)' : '');
  if (p.rot || flips) inner.style.transform = (p.rot ? `rotate(${p.rot}deg)` : '') + flips;
  let chart = null;
  if ((p.kind === 'shape' && p.text && (!p.fill || p.fill.none)) || p.kind === 'chart') w.classList.add('bare');
  if (p.kind === 'shape'){
    if (p.fill && !p.fill.none) inner.style.background = fillCss(p.fill);   // bare text keeps the CSS glass slot free
    const round = ROUNDISH[p.geom];
    if (p.geom === 'roundRect' || round === 'round') inner.style.borderRadius = (p.radius || Math.min(p.w, p.h) * .1667) + 'px';
    else if (p.geom === 'ellipse' || round === 'ellipse') inner.style.borderRadius = '50%';
    else if (round === 'pill') inner.style.borderRadius = (p.h / 2) + 'px';
    else if (GEOM_CLIP[p.geom]) inner.style.clipPath = GEOM_CLIP[p.geom];
    if (p.line && !GEOM_CLIP[p.geom]) inner.style.border = `${p.line.w}px ${p.line.dash ? 'dashed' : 'solid'} ${rgba(p.line.color, p.line.alpha)}`;
    if (p.text){
      // PowerPoint keeps text inside the shape's TEXT RECTANGLE: clear of a rounded corner's
      // curve, inside an ellipse's inscribed box
      let tx2 = p.text;
      const g = p.geom === 'ellipse' || round === 'ellipse' ? [p.w * .1464, p.h * .1464]
              : p.geom === 'roundRect' || round === 'round' ? [(p.radius || Math.min(p.w, p.h) * .1667) * .2929, (p.radius || Math.min(p.w, p.h) * .1667) * .2929] : null;
      if (g){ const [l, t, r, b] = p.text.insets || [9.6, 4.8, 9.6, 4.8]; tx2 = Object.assign({}, p.text, { insets: [l + g[0], t + g[1], r + g[0], b + g[1]] }); }
      const tx = renderText(tx2, inner);
      if (p.flipH || p.flipV) tx.style.transform = (tx.style.transform || '') + flips;   // text never reads mirrored
    }
  } else if (p.kind === 'line'){
    inner.appendChild(lineSvg(p));
  } else if (p.kind === 'pic'){
    const img = el('img', null, inner); img.src = p.src; img.alt = p.name || ''; img.draggable = false;
    if (p.geom === 'ellipse') img.style.borderRadius = '50%';
  } else if (p.kind === 'table'){
    renderTable(p.table, inner);
  } else if (p.kind === 'chart'){
    chart = renderChart(p.chart, p.w, p.h, inner);
  }
  return { w, inner, chart };
}
