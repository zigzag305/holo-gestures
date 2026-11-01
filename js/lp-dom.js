/* lp-dom.js — tiny DOM + colour helpers shared by the LinkPresent renderer and charts. */

export const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };

export const SERIF = /cambria|georgia|times|garamond|bookman|century|palatino|baskerville|didot|serif|caladea|gelasio|tinos/i;
/* metric-compatible stand-ins: same character widths, so lines wrap where PowerPoint wraps them
   on machines without the Office fonts (Linux, CI) */
const METRIC = { calibri: 'Carlito', cambria: 'Caladea', georgia: 'Gelasio', arial: '"Liberation Sans", Arimo',
  'times new roman': '"Liberation Serif", Tinos', 'courier new': '"Liberation Mono", Cousine', helvetica: '"Liberation Sans", Arimo' };
export function fontStack(f){
  const base = SERIF.test(f || '') ? 'Cambria, Caladea, Georgia, "Times New Roman", serif'
                                   : 'Calibri, Carlito, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  if (!f) return base;
  const alt = METRIC[f.toLowerCase()];
  return `"${f}", ${alt ? alt + ', ' : ''}${base}`;
}
export function rgba(hex, a = 1){
  if (!hex) return 'transparent';
  const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a == null ? 1 : a})`;
}
export function fillCss(f){
  if (!f || f.none) return 'transparent';
  if (f.grad && f.grad.length > 1)
    return `linear-gradient(${((f.angle || 0) + 90).toFixed(0)}deg, ${f.grad.map(g => `${rgba(g.color, g.alpha)} ${g.pos}%`).join(', ')})`;
  return rgba(f.color, f.alpha);
}
