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
};
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
      bu.style.cssText = runStyle(first) + `width:${Math.max(-ind, size * .9)}px;margin-left:${ind < 0 ? ind : -size * .9}px;`;
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
    if (p.geom === 'roundRect') inner.style.borderRadius = (p.radius || 8) + 'px';
    else if (p.geom === 'ellipse') inner.style.borderRadius = '50%';
    else if (GEOM_CLIP[p.geom]) inner.style.clipPath = GEOM_CLIP[p.geom];
    if (p.line && !GEOM_CLIP[p.geom]) inner.style.border = `${p.line.w}px ${p.line.dash ? 'dashed' : 'solid'} ${rgba(p.line.color, p.line.alpha)}`;
    if (p.text){
      const tx = renderText(p.text, inner);
      if (p.flipH || p.flipV) tx.style.transform = flips;           // text never reads mirrored
      if (p.rot) inner.style.transform = `rotate(${p.rot}deg)`;
    }
  } else if (p.kind === 'line'){
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', Math.max(p.w, 1)); svg.setAttribute('height', Math.max(p.h, 1)); svg.style.overflow = 'visible';
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', 0); ln.setAttribute('y1', 0); ln.setAttribute('x2', p.w < 1 ? 0 : p.w); ln.setAttribute('y2', p.h < 1 ? 0 : p.h);
    ln.setAttribute('stroke', rgba(p.line.color, p.line.alpha)); ln.setAttribute('stroke-width', p.line.w);
    if (p.line.dash) ln.setAttribute('stroke-dasharray', `${p.line.w * 4} ${p.line.w * 3}`);
    svg.appendChild(ln); inner.appendChild(svg);
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
