/* ============================================================================
   pptx-parse.js — zero-dependency browser .pptx parser for LinkPresent.
   Ports pptx_deck.py to plain ES modules (native DecompressionStream + DOMParser)
   so decks can open 100% client-side with no Python server (Office Add-in,
   Teams/Zoom stage, static HTTPS hosting). Camera frames and slide decks
   never leave the device.
   ========================================================================== */

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
};
const EMU_PX = 9525.0;
const PT_PX = 96.0 / 72.0;
const WEB_IMG = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'];
const IMG_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.bmp': 'image/bmp',
};
const PRESET = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF',
  yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500',
};
const WINGDINGS = {
  '§': '■', 'Ø': '➢', 'ü': '✓', q: '❑', n: '■', l: '●',
  v: '❖', 'Ü': '➔', 'à': '➔', o: '□', 'Ÿ': '•', '·': '•',
};
const RUN_KEYS = ['size', 'b', 'i', 'u', 'spacing', 'caps', 'color', 'alpha', 'font'];
const PARA_KEYS = ['align', 'marL', 'indent', 'bullet', 'spaceAfter', 'spaceBefore', 'lineSpacing', 'buColor', 'buSize'];

const roundN = (v, n) => { const f = 10 ** n; return Math.round(v * f) / f; };
const px = (v, def = 0.0) => {
  if (v == null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? roundN(n / EMU_PX, 2) : def;
};
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const posixNorm = (baseDir, rel) => {
  const parts = (baseDir ? baseDir.split('/') : []).concat(rel.split('/'));
  const out = [];
  for (const seg of parts) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
};

/* ---------------- ZIP reader (stored + deflate-raw via Web Streams) ---------------- */
async function unzipPptx(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minOff = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minOff; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a valid .pptx zip archive');
  const total = dv.getUint16(eocd + 10, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder('utf-8');
  const entries = new Map();
  let off = cdOff;
  for (let i = 0; i < total; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = dec.decode(bytes.subarray(off + 46, off + 46 + nameLen));
    entries.set(name, { method, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  const cache = new Map();
  async function read(name) {
    if (cache.has(name)) return cache.get(name);
    const e = entries.get(name);
    if (!e) return null;
    if (dv.getUint32(e.localOff, true) !== 0x04034b50) throw new Error('corrupt zip entry: ' + name);
    const fnLen = dv.getUint16(e.localOff + 26, true);
    const exLen = dv.getUint16(e.localOff + 28, true);
    const start = e.localOff + 30 + fnLen + exLen;
    const slice = bytes.subarray(start, start + e.compSize);
    let data;
    if (e.method === 0) {
      data = slice;
    } else if (e.method === 8) {
      const ds = new DecompressionStream('deflate-raw');
      const ab = await new Response(new Blob([slice]).stream().pipeThrough(ds)).arrayBuffer();
      data = new Uint8Array(ab);
    } else {
      throw new Error(`unsupported zip method ${e.method} for ${name}`);
    }
    cache.set(name, data);
    return data;
  }
  return { has: (name) => entries.has(name), read };
}

/* ---------------- XML helpers (namespace-safe, zero selector quirks) ---------------- */
const elList = (el) => {
  const out = [];
  if (!el) return out;
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c);
  return out;
};
const qMatch = (el, nsKey, local) => el && el.localName === local && (!nsKey || el.namespaceURI === NS[nsKey]);
const child = (el, tag) => {
  if (!el) return null;
  const [nsKey, local] = tag.split(':');
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && qMatch(c, nsKey, local)) return c;
  return null;
};
const children = (el, tag) => {
  if (!el) return [];
  const [nsKey, local] = tag.split(':');
  return elList(el).filter((c) => qMatch(c, nsKey, local));
};
const pathOne = (el, path) => {
  let cur = el;
  for (const seg of path.split('/')) {
    if (!cur) return null;
    cur = child(cur, seg);
  }
  return cur;
};
const iterTag = (el, tag) => {
  if (!el) return [];
  const [nsKey, local] = tag.split(':');
  const out = [];
  const walk = (node) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (qMatch(c, nsKey, local)) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
};
const findFirstTag = (el, tag) => {
  if (!el) return null;
  const [nsKey, local] = tag.split(':');
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 1) continue;
    if (qMatch(c, nsKey, local)) return c;
    const hit = findFirstTag(c, tag);
    if (hit) return hit;
  }
  return null;
};
const firstFound = (el, ...paths) => {
  for (const p of paths) {
    if (p.startsWith('.//')) {
      const tag = p.slice(3);
      if (!tag.includes('/')) {
        const hit = findFirstTag(el, tag);
        if (hit) return hit;
      } else {
        const segs = tag.split('//').filter(Boolean);
        if (segs.length === 1) {
          const hit = findFirstTag(el, segs[0]);
          if (hit) return hit;
        }
      }
    } else {
      const hit = pathOne(el, p);
      if (hit) return hit;
    }
  }
  return null;
};

/* ---------------- Package wrapper ---------------- */
class Package {
  constructor(zip) {
    this.zip = zip;
    this._xml = new Map();
    this._rels = new Map();
    this._dec = new TextDecoder('utf-8');
    this._dom = new DOMParser();
  }
  async xml(part) {
    if (!part) return null;
    if (this._xml.has(part)) return this._xml.get(part);
    if (!this.zip.has(part)) { this._xml.set(part, null); return null; }
    const bytes = await this.zip.read(part);
    const doc = this._dom.parseFromString(this._dec.decode(bytes), 'application/xml');
    const root = doc && doc.documentElement && doc.documentElement.localName !== 'parsererror' ? doc.documentElement : null;
    this._xml.set(part, root);
    return root;
  }
  async rels(part) {
    if (this._rels.has(part)) return this._rels.get(part);
    const idx = part.lastIndexOf('/');
    const d = idx >= 0 ? part.slice(0, idx) : '';
    const b = idx >= 0 ? part.slice(idx + 1) : part;
    const rp = (d ? d + '/' : '') + '_rels/' + b + '.rels';
    const out = new Map();
    const root = await this.xml(rp);
    if (root) {
      for (const r of children(root, 'rel:Relationship')) {
        if (r.getAttribute('TargetMode') === 'External') continue;
        const tgt = r.getAttribute('Target') || '';
        const full = tgt.startsWith('/') ? tgt.replace(/^\/+/, '') : posixNorm(d, tgt);
        const type = (r.getAttribute('Type') || '').split('/').pop();
        out.set(r.getAttribute('Id'), [full, type]);
      }
    }
    this._rels.set(part, out);
    return out;
  }
  async relOfType(part, typ) {
    const r = await this.rels(part);
    for (const [full, t] of r.values()) if (t === typ) return full;
    return null;
  }
}

/* ---------------- Colors (matching Python colorsys HLS) ---------------- */
const hexToRgb = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255.0);
};
const rgbToHex = (rgb) => '#' + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * 255))).toString(16).padStart(2, '0')).join('');
function rgbToHls(r, g, b) {
  const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
  const l = (minc + maxc) / 2.0;
  if (minc === maxc) return [0.0, l, 0.0];
  const s = l <= 0.5 ? (maxc - minc) / (maxc + minc) : (maxc - minc) / (2.0 - maxc - minc);
  const rc = (maxc - r) / (maxc - minc), gc = (maxc - g) / (maxc - minc), bc = (maxc - b) / (maxc - minc);
  let h = r === maxc ? bc - gc : g === maxc ? 2.0 + rc - bc : 4.0 + gc - rc;
  h = (h / 6.0) % 1.0; if (h < 0) h += 1.0;
  return [h, l, s];
}
function hlsToRgb(h, l, s) {
  if (s === 0.0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1.0 + s) : l + s - l * s;
  const m1 = 2.0 * l - m2;
  const v = (hue) => {
    let x = hue % 1.0; if (x < 0) x += 1.0;
    if (x < 1 / 6) return m1 + (m2 - m1) * x * 6.0;
    if (x < 0.5) return m2;
    if (x < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - x) * 6.0;
    return m1;
  };
  return [v(h + 1 / 3), v(h), v(h - 1 / 3)];
}

class Theme {
  constructor(root) {
    this.colors = {};
    this.major = 'Calibri';
    this.minor = 'Calibri';
    if (!root) return;
    const cs = findFirstTag(root, 'a:clrScheme');
    if (cs) {
      for (const ch of elList(cs)) {
        const s = child(ch, 'a:srgbClr'), y = child(ch, 'a:sysClr');
        if (s) this.colors[ch.localName] = s.getAttribute('val');
        else if (y) this.colors[ch.localName] = y.getAttribute('lastClr') || '000000';
      }
    }
    const mj = pathOne(findFirstTag(root, 'a:majorFont'), 'a:latin');
    const mn = pathOne(findFirstTag(root, 'a:minorFont'), 'a:latin');
    if (mj && mj.getAttribute('typeface')) this.major = mj.getAttribute('typeface');
    if (mn && mn.getAttribute('typeface')) this.minor = mn.getAttribute('typeface');
  }
}

class Ctx {
  constructor(theme, clrmap) {
    this.theme = theme;
    this.clrmap = clrmap || {};
  }
  scheme(val) {
    const m = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
    const key = this.clrmap[val] || m[val] || val;
    return this.theme.colors[key] || '000000';
  }
  font(face) {
    if (!face) return null;
    if (face.startsWith('+mj')) return this.theme.major;
    if (face.startsWith('+mn')) return this.theme.minor;
    return face;
  }
}

function colorOf(el, ctx) {
  if (!el) return [null, null];
  let tag = null, c = null;
  for (const t of ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr']) {
    const hit = child(el, 'a:' + t);
    if (hit) { tag = t; c = hit; break; }
  }
  if (!c) return [null, null];
  let base = '000000';
  if (tag === 'srgbClr') base = c.getAttribute('val') || '000000';
  else if (tag === 'schemeClr') base = ctx.scheme(c.getAttribute('val') || 'tx1');
  else if (tag === 'sysClr') base = c.getAttribute('lastClr') || '000000';
  else if (tag === 'prstClr') base = PRESET[c.getAttribute('val') || 'black'] || '000000';
  let [r, g, b] = hexToRgb(base);
  let alpha = 1.0;
  for (const mod of elList(c)) {
    const n = mod.localName;
    const v = parseInt(mod.getAttribute('val') || '100000', 10) / 100000.0;
    if (n === 'lumMod' || n === 'lumOff') {
      let [h, l, s] = rgbToHls(r, g, b);
      l = n === 'lumMod' ? l * v : Math.min(1.0, l + v);
      [r, g, b] = hlsToRgb(h, l, s);
    } else if (n === 'tint') {
      [r, g, b] = [r, g, b].map((x) => x + (1 - x) * (1 - v));
    } else if (n === 'shade') {
      [r, g, b] = [r, g, b].map((x) => x * v);
    } else if (n === 'alpha') {
      alpha = v;
    }
  }
  return [rgbToHex([r, g, b]), roundN(alpha, 3)];
}

function fillOf(sppr, ctx) {
  if (!sppr) return null;
  if (child(sppr, 'a:noFill')) return { none: true };
  const sf = child(sppr, 'a:solidFill');
  if (sf) {
    const [c, a] = colorOf(sf, ctx);
    return c ? { color: c, alpha: a } : null;
  }
  const gf = child(sppr, 'a:gradFill');
  if (gf) {
    const stops = [];
    for (const gs of children(child(gf, 'a:gsLst'), 'a:gs')) {
      const [c, a] = colorOf(gs, ctx);
      if (c) stops.push({ pos: parseInt(gs.getAttribute('pos') || '0', 10) / 1000.0, color: c, alpha: a });
    }
    const lin = child(gf, 'a:lin');
    const ang = lin ? parseInt(lin.getAttribute('ang') || '0', 10) / 60000.0 : 90.0;
    if (stops.length) return { color: stops[0].color, alpha: stops[0].alpha, grad: stops, angle: ang };
  }
  return null;
}

function lineOf(sppr, ctx) {
  if (!sppr) return null;
  const ln = child(sppr, 'a:ln');
  if (!ln || child(ln, 'a:noFill')) return null;
  const sf = child(ln, 'a:solidFill');
  if (!sf) return null;
  const [c, a] = colorOf(sf, ctx);
  if (!c) return null;
  const dash = child(ln, 'a:prstDash');
  const out = {
    color: c, alpha: a,
    w: roundN(Math.max(0.75, parseInt(ln.getAttribute('w') || '9525', 10) / EMU_PX), 2),
    dash: dash && dash.getAttribute('val') !== 'solid' ? dash.getAttribute('val') : null,
  };
  for (const end of ['headEnd', 'tailEnd']) {
    const e = child(ln, 'a:' + end);
    if (e && (e.getAttribute('type') || 'none') !== 'none') out[end] = e.getAttribute('type');
  }
  return out;
}

/* ---------------- Text ---------------- */
function pprInto(pp, out, ctx) {
  if (!pp) return;
  if (pp.getAttribute('algn')) out.align = pp.getAttribute('algn');
  if (pp.getAttribute('marL') != null) out.marL = px(pp.getAttribute('marL'));
  if (pp.getAttribute('indent') != null) out.indent = px(pp.getAttribute('indent'));
  if (child(pp, 'a:buNone')) out.bullet = null;
  const bf = child(pp, 'a:buFont');
  if (bf && bf.getAttribute('typeface')) out.buFont = bf.getAttribute('typeface');
  const bc = child(pp, 'a:buChar');
  if (bc) {
    let ch = bc.getAttribute('char') || '•';
    const bfont = (out.buFont || '').toLowerCase();
    if (bfont.includes('wingdings') || bfont === 'symbol') ch = WINGDINGS[ch] || '•';
    out.bullet = ch;
  }
  const ba = child(pp, 'a:buAutoNum');
  if (ba) {
    out.bullet = '#';
    out.autoNum = ba.getAttribute('type') || 'arabicPeriod';
    out.startAt = parseInt(ba.getAttribute('startAt') || '1', 10);
  }
  const bclr = child(pp, 'a:buClr');
  if (bclr) { const [c] = colorOf(bclr, ctx); if (c) out.buColor = c; }
  const bsz = child(pp, 'a:buSzPct');
  if (bsz) out.buSize = parseInt(bsz.getAttribute('val') || '100000', 10) / 100000.0;
  const sa = pathOne(pp, 'a:spcAft/a:spcPts'), sap = pathOne(pp, 'a:spcAft/a:spcPct');
  if (sa) {
    out.spaceAfter = roundN(parseInt(sa.getAttribute('val') || '0', 10) / 100.0 * PT_PX, 1);
    delete out.spaceAfterPct;
  } else if (sap) {
    out.spaceAfterPct = parseInt(sap.getAttribute('val') || '0', 10) / 100000.0;
    delete out.spaceAfter;
  }
  const sb = pathOne(pp, 'a:spcBef/a:spcPts'), sbp = pathOne(pp, 'a:spcBef/a:spcPct');
  if (sb) {
    out.spaceBefore = roundN(parseInt(sb.getAttribute('val') || '0', 10) / 100.0 * PT_PX, 1);
    delete out.spaceBeforePct;
  } else if (sbp) {
    out.spaceBeforePct = parseInt(sbp.getAttribute('val') || '0', 10) / 100000.0;
    delete out.spaceBefore;
  }
  const ls = pathOne(pp, 'a:lnSpc/a:spcPct');
  if (ls) out.lineSpacing = parseInt(ls.getAttribute('val') || '100000', 10) / 100000.0;
}

function rprInto(r, out, ctx) {
  if (!r) return;
  if (r.getAttribute('sz')) out.size = roundN(parseInt(r.getAttribute('sz'), 10) / 100.0 * PT_PX, 2);
  if (r.getAttribute('b') != null) out.b = r.getAttribute('b') === '1' || r.getAttribute('b') === 'true';
  if (r.getAttribute('i') != null) out.i = r.getAttribute('i') === '1' || r.getAttribute('i') === 'true';
  if (r.getAttribute('u') && r.getAttribute('u') !== 'none') out.u = true;
  if (r.getAttribute('spc')) out.spacing = roundN(parseInt(r.getAttribute('spc'), 10) / 100.0 * PT_PX, 2);
  if (r.getAttribute('cap') === 'all') out.caps = true;
  const sf = child(r, 'a:solidFill');
  if (sf) {
    const [c, a] = colorOf(sf, ctx);
    if (c) { out.color = c; out.alpha = a; }
  }
  const la = child(r, 'a:latin');
  if (la && la.getAttribute('typeface')) out.font = ctx.font(la.getAttribute('typeface'));
}

function lvlProps(lst, lvl, ctx) {
  const out = {};
  if (!lst) return out;
  if (lst._pseudoColor) { out.color = lst._pseudoColor; out.alpha = 1.0; return out; }
  if (lst._pseudoPara) {
    if (lvl === 1) Object.assign(out, lst._pseudoPara);
    return out;
  }
  const pp = child(lst, `a:lvl${lvl}pPr`);
  if (!pp) return out;
  pprInto(pp, out, ctx);
  const d = child(pp, 'a:defRPr');
  if (d) rprInto(d, out, ctx);
  return out;
}

function autonum(scheme, n) {
  const alpha = (k) => {
    let out = '';
    while (k > 0) { const r = (k - 1) % 26; k = Math.floor((k - 1) / 26); out = String.fromCharCode(97 + r) + out; }
    return out;
  };
  const roman = (k) => {
    const vals = [[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']];
    let out = '';
    for (const [v, sym] of vals) while (k >= v) { out += sym; k -= v; }
    return out;
  };
  const body = scheme.startsWith('alphaLc') ? alpha(n)
    : scheme.startsWith('alphaUc') ? alpha(n).toUpperCase()
    : scheme.startsWith('romanLc') ? roman(n)
    : scheme.startsWith('romanUc') ? roman(n).toUpperCase()
    : String(n);
  if (scheme.endsWith('ParenBoth')) return `(${body})`;
  if (scheme.endsWith('ParenR')) return `${body})`;
  if (scheme.endsWith('Plain')) return body;
  if (scheme.endsWith('Minus')) return `${body} -`;
  return `${body}.`;
}

function textOf(txbody, ctx, inheritChain, slideNo = null, bodyChain = []) {
  if (!txbody) return null;
  const attrs = {};
  let autofit = null;
  for (const b of [...bodyChain, child(txbody, 'a:bodyPr')]) {
    if (!b) continue;
    for (const a of b.attributes) attrs[a.name] = a.value;
    const na = child(b, 'a:normAutofit');
    if (na) autofit = na;
    else if (child(b, 'a:noAutofit') || child(b, 'a:spAutoFit')) autofit = null;
  }
  const ins = [['lIns', 91440], ['tIns', 45720], ['rIns', 91440], ['bIns', 45720]].map(([k, d]) => parseInt(attrs[k] ?? d, 10));
  const anchor = attrs.anchor || 't';
  const wrap = attrs.wrap !== 'none';
  const scale = autofit ? parseInt(autofit.getAttribute('fontScale') || '100000', 10) / 100000.0 : 1.0;
  const lnred = autofit ? parseInt(autofit.getAttribute('lnSpcReduction') || '0', 10) / 100000.0 : 0.0;
  const counters = new Map();
  const chain = [...inheritChain, child(txbody, 'a:lstStyle')];
  const paras = [];
  let hasText = false;
  const pList = children(txbody, 'a:p');
  pList.forEach((p, pi) => {
    const ppr = child(p, 'a:pPr');
    const lvl = ppr ? parseInt(ppr.getAttribute('lvl') || '0', 10) + 1 : 1;
    const base = { size: 18 * PT_PX };
    for (const lst of chain) Object.assign(base, lvlProps(lst, lvl, ctx));
    pprInto(ppr, base, ctx);
    if ('spaceAfterPct' in base) base.spaceAfter = roundN(base.size * base.spaceAfterPct, 1);
    if ('spaceBeforePct' in base) base.spaceBefore = roundN(base.size * base.spaceBeforePct, 1);
    if (pi === 0) delete base.spaceBefore;
    const para = {};
    for (const k of PARA_KEYS) if (k in base) para[k] = base[k];
    const runs = [];
    for (const r of elList(p)) {
      const tag = r.localName;
      if (tag !== 'r' && tag !== 'fld' && tag !== 'br') continue;
      const rp = {};
      for (const k of RUN_KEYS) if (k in base) rp[k] = base[k];
      rprInto(child(r, 'a:rPr'), rp, ctx);
      let t = '';
      if (tag === 'br') t = '\n';
      else {
        for (const te of children(r, 'a:t')) t += te.textContent || '';
        if (tag === 'fld' && r.getAttribute('type') === 'slidenum' && slideNo != null) t = String(slideNo);
      }
      if (t) {
        rp.t = t;
        runs.push(rp);
        if (t.trim()) hasText = true;
      }
    }
    if (!runs.length) {
      const ep = child(p, 'a:endParaRPr');
      const sz = ep && ep.getAttribute('sz') ? roundN(parseInt(ep.getAttribute('sz'), 10) / 100.0 * PT_PX, 2) : base.size;
      para.empty = sz;
    } else if (para.bullet === '#') {
      const key = `${lvl}:${base.autoNum || ''}`;
      const next = (counters.has(key) ? counters.get(key) : (base.startAt ?? 1) - 1) + 1;
      counters.set(key, next);
      para.bullet = autonum(base.autoNum || 'arabicPeriod', next);
    } else {
      for (const k of [...counters.keys()]) if (parseInt(k.split(':')[0], 10) >= lvl) counters.delete(k);
    }
    if (scale !== 1.0 || lnred) {
      for (const r of runs) if (r.size) r.size = roundN(r.size * scale, 2);
      if (para.empty) para.empty = roundN(para.empty * scale, 2);
      for (const k of ['spaceAfter', 'spaceBefore']) if (para[k]) para[k] = roundN(para[k] * scale, 1);
      para.lineSpacing = roundN((para.lineSpacing || 1.0) - lnred, 3);
    }
    para.runs = runs;
    paras.push(para);
  });
  if (!hasText) return null;
  const out = { anchor, wrap, insets: ins.map((v) => roundN(v / EMU_PX, 1)), paras };
  if (attrs.vert && attrs.vert !== 'horz') out.vert = attrs.vert;
  if (parseInt(attrs.numCol || '1', 10) > 1) {
    out.cols = parseInt(attrs.numCol, 10);
    out.colGap = px(attrs.spcCol || '0');
  }
  return out;
}

/* ---------------- Charts ---------------- */
function cacheVals(el) {
  if (!el) return [];
  const pts = new Map();
  let maxIdx = -1;
  for (const pt of iterTag(el, 'c:pt')) {
    const idx = parseInt(pt.getAttribute('idx') || '0', 10);
    const v = child(pt, 'c:v');
    pts.set(idx, v ? (v.textContent || '') : '');
    if (idx > maxIdx) maxIdx = idx;
  }
  const out = [];
  for (let i = 0; i <= maxIdx; i++) out.push(pts.get(i) ?? '');
  return out;
}

function firstText(el) {
  if (!el) return '';
  let t = '';
  for (const a of iterTag(el, 'a:t')) t += a.textContent || '';
  if (t) return t;
  const v = findFirstTag(el, 'c:v');
  return v && v.textContent ? v.textContent : '';
}

function txprStyle(el, ctx, direct = false) {
  const out = {};
  if (!el) return out;
  let d = null;
  if (direct) d = pathOne(el, 'c:txPr/a:p/a:pPr/a:defRPr');
  else {
    const tx = findFirstTag(el, 'c:txPr');
    if (tx) d = findFirstTag(tx, 'a:defRPr');
  }
  if (d) rprInto(d, out, ctx);
  return out;
}

async function parseChart(pkg, part, ctx) {
  const root = await pkg.xml(part);
  if (!root) return null;
  const chart = child(root, 'c:chart');
  const pa = chart ? child(chart, 'c:plotArea') : null;
  if (!pa) return null;
  const kinds = {
    barChart: 'bar', bar3DChart: 'bar', lineChart: 'line', line3DChart: 'line',
    pieChart: 'pie', pie3DChart: 'pie', ofPieChart: 'pie', doughnutChart: 'doughnut',
    areaChart: 'area', area3DChart: 'area', scatterChart: 'scatter', radarChart: 'line',
    bubbleChart: 'scatter', stockChart: 'line',
  };
  const plots = elList(pa).filter((ch) => ch.localName in kinds).map((ch) => [ch, kinds[ch.localName]]);
  if (!plots.length) return null;
  const out = { type: plots[0][1] };
  const base = txprStyle(root, ctx, true);
  if (Object.keys(base).length) out.textStyle = base;

  const axes = new Map();
  for (const ax of elList(pa)) {
    if (['valAx', 'catAx', 'dateAx', 'serAx'].includes(ax.localName)) {
      const idEl = child(ax, 'c:axId');
      if (idEl) axes.set(idEl.getAttribute('val'), [ax.localName, ax]);
    }
  }
  const axisInfo = (ax) => {
    const de = child(ax, 'c:delete');
    const info = { hidden: !!(de && de.getAttribute('val') === '1') };
    for (const k of ['min', 'max']) {
      const e = pathOne(ax, 'c:scaling/c:' + k);
      if (e) info[k] = parseFloat(e.getAttribute('val'));
    }
    const o = pathOne(ax, 'c:scaling/c:orientation');
    if (o && o.getAttribute('val') === 'maxMin') info.reverse = true;
    const mu = child(ax, 'c:majorUnit');
    if (mu) info.step = parseFloat(mu.getAttribute('val'));
    info.style = txprStyle(ax, ctx);
    info.grid = !!child(ax, 'c:majorGridlines');
    const ap = child(ax, 'c:axPos');
    info.pos = ap ? ap.getAttribute('val') : null;
    const nf = child(ax, 'c:numFmt');
    if (nf && nf.getAttribute('formatCode') && nf.getAttribute('formatCode') !== 'General') info.fmt = nf.getAttribute('formatCode');
    const tl = child(ax, 'c:tickLblPos');
    if (tl && tl.getAttribute('val') === 'none') info.noLabels = true;
    const t = child(ax, 'c:title');
    if (t) info.title = firstText(child(t, 'c:tx')) || null;
    return info;
  };
  const dlFlags = (dl, into) => {
    if (!dl) return;
    for (const [k, key] of [['c:showVal', 'showVal'], ['c:showPercent', 'showPercent'], ['c:showCatName', 'showCat']]) {
      const e = child(dl, k);
      if (e) into[key] = e.getAttribute('val') === '1';
    }
    const nf = child(dl, 'c:numFmt');
    if (nf && nf.getAttribute('formatCode') != null) into.fmt = nf.getAttribute('formatCode');
    const pos = child(dl, 'c:dLblPos');
    if (pos) into.pos = pos.getAttribute('val');
    const st = txprStyle(dl, ctx);
    if (Object.keys(st).length) into.labelStyle = st;
    const pts = children(dl, 'c:dLbl');
    if (pts.length) {
      for (const [k, key] of [['c:showVal', 'showVal'], ['c:showPercent', 'showPercent'], ['c:showCatName', 'showCat']]) {
        const vals = pts.map((d) => child(d, k));
        if (vals.every(Boolean)) into[key] = vals[0].getAttribute('val') === '1';
      }
      const pnf = child(pts[0], 'c:numFmt');
      if (pnf && pnf.getAttribute('formatCode') && pnf.getAttribute('formatCode') !== 'General') into.fmt = pnf.getAttribute('formatCode');
    }
  };

  let primaryVal = null;
  const series = [];
  let labels = {};
  plots.forEach(([plot, kind], pi) => {
    const ids = children(plot, 'c:axId').map((e) => e.getAttribute('val'));
    const valsAx = ids.filter((id) => axes.has(id) && axes.get(id)[0] === 'valAx').map((id) => axes.get(id));
    let secondary = false;
    if (valsAx.length) {
      if (!primaryVal) primaryVal = kind === 'scatter' ? valsAx[valsAx.length - 1][1] : valsAx[0][1];
      secondary = valsAx[0][1] !== primaryVal && kind !== 'scatter';
    }
    const pl = {};
    dlFlags(child(plot, 'c:dLbls'), pl);
    if (pi === 0) {
      labels = pl;
      if (kind === 'bar') {
        const bd = child(plot, 'c:barDir'), gp = child(plot, 'c:grouping'), gw = child(plot, 'c:gapWidth');
        out.barDir = bd ? bd.getAttribute('val') : 'col';
        out.grouping = gp ? gp.getAttribute('val') : 'clustered';
        out.gap = gw ? parseInt(gw.getAttribute('val') || '150', 10) / 100.0 : 1.5;
      }
      if (kind === 'doughnut') {
        const hs = child(plot, 'c:holeSize');
        out.hole = hs ? parseInt(hs.getAttribute('val') || '50', 10) / 100.0 : 0.5;
      }
      if ((kind === 'line' || kind === 'area') && child(plot, 'c:grouping')) {
        out.grouping = child(plot, 'c:grouping').getAttribute('val');
      }
    }
    const vc = child(plot, 'c:varyColors');
    const vary = vc ? (vc.getAttribute('val') ?? '1') !== '0' : (kind === 'pie' || kind === 'doughnut');
    const pmark = child(plot, 'c:marker');
    const plotMarkers = !pmark || (pmark.getAttribute('val') ?? '1') !== '0';
    const style = child(plot, 'c:scatterStyle');
    for (const s of children(plot, 'c:ser')) {
      const idxEl = child(s, 'c:idx');
      const idx = idxEl ? parseInt(idxEl.getAttribute('val') || String(series.length), 10) : series.length;
      const name = firstText(child(s, 'c:tx')) || `Series ${series.length + 1}`;
      const catEl = child(s, 'c:cat'), xEl = child(s, 'c:xVal');
      const valEl = firstFound(s, 'c:val', 'c:yVal');
      const cats = cacheVals(catEl || xEl);
      const vals = cacheVals(valEl).map(num);
      let fmtCode = null;
      if (valEl) {
        const fc = findFirstTag(valEl, 'c:formatCode');
        fmtCode = fc ? fc.textContent : null;
      }
      const sppr = child(s, 'c:spPr');
      const f = fillOf(sppr, ctx);
      let col = f && !f.none ? f.color : null;
      const ln = sppr ? child(sppr, 'a:ln') : null;
      const lineHidden = !!(ln && child(ln, 'a:noFill'));
      let width = null;
      if ((kind === 'line' || kind === 'scatter') && sppr) {
        const lo = lineOf(sppr, ctx);
        if (lo) col = lo.color;
        if (ln && ln.getAttribute('w')) width = roundN(parseInt(ln.getAttribute('w'), 10) / EMU_PX, 2);
      }
      if (!col) col = '#' + ctx.scheme(`accent${(idx % 6) + 1}`).replace(/^#/, '');
      const pcols = new Map();
      for (const dpt of children(s, 'c:dPt')) {
        const di = child(dpt, 'c:idx');
        const j = di ? parseInt(di.getAttribute('val') || '0', 10) : 0;
        const ff = fillOf(child(dpt, 'c:spPr'), ctx);
        if (ff && ff.color) pcols.set(j, ff.color);
      }
      if (vary && (kind === 'pie' || kind === 'doughnut')) {
        for (let j = 0; j < vals.length; j++) {
          if (!pcols.has(j)) pcols.set(j, '#' + ctx.scheme(`accent${(j % 6) + 1}`).replace(/^#/, ''));
        }
      }
      const sl = { ...pl };
      dlFlags(child(s, 'c:dLbls'), sl);
      const mk = pathOne(s, 'c:marker/c:symbol');
      let marker = mk ? mk.getAttribute('val') !== 'none' : plotMarkers;
      if (kind === 'scatter' && style && ['line', 'smooth'].includes(style.getAttribute('val'))) {
        marker = !!(mk && mk.getAttribute('val') !== 'none');
      }
      const ser = {
        name, cats, vals, color: col, kind, secondary,
        pointColors: pcols.size ? vals.map((_, j) => pcols.get(j) ?? null) : null,
        fmt: sl.fmt || (fmtCode && fmtCode !== 'General' ? fmtCode : null),
        labels: sl, marker, width,
        line: !lineHidden && !(kind === 'scatter' && style && style.getAttribute('val') === 'marker'),
      };
      if (kind === 'scatter') ser.xs = xEl ? cacheVals(xEl).map(num) : vals.map((_, k) => k + 1);
      const sm = child(s, 'c:smooth');
      if (sm && sm.getAttribute('val') === '1') ser.smooth = true;
      series.push(ser);
    }
  });
  if (!series.length) return null;
  out.series = series;
  out.labels = labels;

  const t = child(chart, 'c:title');
  const atd = child(chart, 'c:autoTitleDeleted');
  const deleted = !!(atd && atd.getAttribute('val') === '1');
  if (t && !deleted) {
    out.title = firstText(child(t, 'c:tx')) || (series.length === 1 ? series[0].name : null);
    const st = {};
    const rp = firstFound(t, './/a:rPr', './/a:defRPr');
    rprInto(rp, st, ctx);
    out.titleStyle = st;
  } else if (!t && !deleted && series.length === 1) {
    out.title = series[0].name;
    out.titleStyle = { auto: true };
  }

  for (const [, [tag, ax]] of axes.entries()) {
    if (tag === 'valAx') {
      if (ax === primaryVal) out.valAxis = axisInfo(ax);
      else if (series.some((s) => s.secondary)) out.valAxis2 = axisInfo(ax);
      else if (out.type === 'scatter' && !out.catAxis) out.catAxis = axisInfo(ax);
    } else if ((tag === 'catAx' || tag === 'dateAx') && !out.catAxis) {
      out.catAxis = axisInfo(ax);
    }
  }
  if (!out.valAxis && primaryVal) out.valAxis = axisInfo(primaryVal);
  const lg = child(chart, 'c:legend');
  if (lg) {
    const lp = child(lg, 'c:legendPos');
    out.legend = { pos: lp ? lp.getAttribute('val') : 'r', style: txprStyle(lg, ctx) };
  }
  return out;
}

/* ---------------- Tables ---------------- */
function parseTable(tbl, ctx, inherit) {
  const grid = child(tbl, 'a:tblGrid');
  const cols = children(grid, 'a:gridCol').map((g) => px(g.getAttribute('w')));
  const rows = [];
  const tp = child(tbl, 'a:tblPr');
  const styled = !!(tp && child(tp, 'a:tableStyleId'));
  const firstRow = !!(tp && tp.getAttribute('firstRow') === '1');
  const band = !!(tp && tp.getAttribute('bandRow') === '1');
  const acc = ctx.scheme('accent1');
  const light = rgbToHex(hexToRgb(acc).map((x) => x + (1 - x) * 0.8));
  const lighter = rgbToHex(hexToRgb(acc).map((x) => x + (1 - x) * 0.9));
  children(tbl, 'a:tr').forEach((tr, ri) => {
    const cells = [];
    for (const tc of children(tr, 'a:tc')) {
      if (tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1') {
        cells.push({ merged: true });
        continue;
      }
      const tcpr = child(tc, 'a:tcPr');
      const cell = {
        span: parseInt(tc.getAttribute('gridSpan') || '1', 10),
        rowSpan: parseInt(tc.getAttribute('rowSpan') || '1', 10),
      };
      const f = fillOf(tcpr, ctx);
      if (f && !f.none) cell.fill = f.color;
      if (tcpr) {
        cell.anchor = tcpr.getAttribute('anchor') || 't';
        cell.mar = [['marL', 91440], ['marT', 45720], ['marR', 91440], ['marB', 45720]].map(([k, d]) => px(tcpr.getAttribute(k) ?? d));
        const lb = child(tcpr, 'a:lnB');
        if (lb && child(lb, 'a:solidFill')) cell.border = colorOf(child(lb, 'a:solidFill'), ctx)[0];
      }
      const txb = child(tc, 'a:txBody');
      const head = styled && firstRow && ri === 0;
      if (styled && !('fill' in cell) && !(f && f.none)) {
        cell.fill = '#' + acc.replace(/^#/, '') ? (head ? '#' + acc.replace(/^#/, '') : (band && ri % 2 ? light : lighter)) : '#ffffff';
        if (!cell.border) cell.border = '#ffffff';
      } else if (!styled) {
        if (!cell.border) cell.border = '#' + ctx.scheme('tx1').replace(/^#/, '');
      }
      let tx = txb ? textOf(txb, ctx, [...inherit, ...(head ? [{ _pseudoColor: '#ffffff' }] : [])]) : null;
      if (!tx && txb) tx = { paras: [] };
      cell.text = tx;
      cells.push(cell);
    }
    rows.push({ h: px(tr.getAttribute('h')), cells });
  });
  return { cols, rows };
}

/* ---------------- Shape Tree ---------------- */
function xfrmOf(el) {
  if (!el) return null;
  const off = child(el, 'a:off'), ext = child(el, 'a:ext');
  if (!off || !ext) return null;
  return [
    parseInt(off.getAttribute('x') || '0', 10),
    parseInt(off.getAttribute('y') || '0', 10),
    parseInt(ext.getAttribute('cx') || '0', 10),
    parseInt(ext.getAttribute('cy') || '0', 10),
    parseInt(el.getAttribute('rot') || '0', 10) / 60000.0,
    el.getAttribute('flipH') === '1',
    el.getAttribute('flipV') === '1',
  ];
}
function phKey(sp) {
  const ph = findFirstTag(sp, 'p:ph');
  return ph ? { type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx') } : null;
}
function findPh(treeRoot, key) {
  if (!treeRoot || !key) return null;
  const cands = iterTag(treeRoot, 'p:sp').filter((sp) => phKey(sp));
  if (key.idx != null) {
    for (const sp of cands) if (phKey(sp).idx === key.idx) return sp;
  }
  const t = key.type;
  const alias = { ctrTitle: 'title', subTitle: 'body', obj: 'body' };
  for (const sp of cands) {
    const kt = phKey(sp).type;
    if (kt === t || alias[kt] === (alias[t] || t) || kt === alias[t]) return sp;
  }
  return null;
}
function paraAsLst(p) {
  if (!p) return null;
  const pp = child(p, 'a:pPr'), ep = child(p, 'a:endParaRPr');
  const out = {};
  if (pp) {
    if (pp.getAttribute('algn')) out.align = pp.getAttribute('algn');
    if (pp.getAttribute('marL') != null) out.marL = px(pp.getAttribute('marL'));
    if (pp.getAttribute('indent') != null) out.indent = px(pp.getAttribute('indent'));
  }
  if (ep && ep.getAttribute('sz')) out.size = roundN(parseInt(ep.getAttribute('sz'), 10) / 100.0 * PT_PX, 2);
  return { _pseudoPara: out };
}

class SlideParser {
  constructor(pkg, part, rels, ctx, layoutRoot, masterRoot, masterStyles, mediaCb, slideNo) {
    this.pkg = pkg; this.part = part; this.rels = rels; this.ctx = ctx;
    this.layoutRoot = layoutRoot; this.masterRoot = masterRoot;
    this.styles = masterStyles; this.mediaCb = mediaCb; this.slideNo = slideNo;
    this.pieces = [];
  }
  async walk(tree, tf = null, locked = false, prefix = '') {
    const list = Array.isArray(tree) ? tree : elList(tree);
    for (const el of list) {
      const tag = el.localName;
      try {
        if (tag === 'sp') await this.shape(el, tf, locked, prefix, false);
        else if (tag === 'cxnSp') await this.shape(el, tf, locked, prefix, true);
        else if (tag === 'pic') await this.picture(el, tf, locked, prefix);
        else if (tag === 'graphicFrame') await this.frame(el, tf, locked, prefix);
        else if (tag === 'grpSp') await this.group(el, tf, locked, prefix);
        else if (tag === 'AlternateContent') {
          const fb = child(el, 'mc:Fallback');
          if (fb) await this.walk(fb, tf, locked, prefix);
        }
      } catch (e) {
        this.pieces.push({ kind: 'error', name: `${tag} (${e && e.name || 'Error'})` });
      }
    }
  }
  box(xf, tf) {
    let [x, y, w, h, rot, fh, fv] = xf;
    if (tf) [x, y, w, h] = tf(x, y, w, h);
    return {
      x: px(x), y: px(y), w: Math.max(px(w), 0.5), h: Math.max(px(h), 0.5),
      rot: roundN(rot, 2), flipH: fh, flipV: fv,
    };
  }
  nameOf(el) {
    const c = findFirstTag(el, 'p:cNvPr');
    return c ? (c.getAttribute('descr') || c.getAttribute('name') || '') : '';
  }
  async group(el, tf, locked, prefix) {
    const g = pathOne(el, 'p:grpSpPr/a:xfrm');
    if (!g) return this.walk(el, tf, locked, prefix);
    const off = child(g, 'a:off'), ext = child(g, 'a:ext');
    const choff = child(g, 'a:chOff'), chext = child(g, 'a:chExt');
    const ox = parseInt(off.getAttribute('x'), 10), oy = parseInt(off.getAttribute('y'), 10);
    const ex = parseInt(ext.getAttribute('cx'), 10) || 1, ey = parseInt(ext.getAttribute('cy'), 10) || 1;
    const cx0 = choff ? parseInt(choff.getAttribute('x'), 10) : ox;
    const cy0 = choff ? parseInt(choff.getAttribute('y'), 10) : oy;
    const cw = chext ? (parseInt(chext.getAttribute('cx'), 10) || 1) : ex;
    const ch = chext ? (parseInt(chext.getAttribute('cy'), 10) || 1) : ey;
    const sx = ex / cw, sy = ey / ch;
    const inner = (x, y, w, h) => {
      const nx = ox + (x - cx0) * sx, ny = oy + (y - cy0) * sy, nw = w * sx, nh = h * sy;
      return tf ? tf(nx, ny, nw, nh) : [nx, ny, nw, nh];
    };
    await this.walk(el, inner, locked, prefix + this.nameOf(el) + ' / ');
  }
  async shape(el, tf, locked, prefix, connector = false) {
    const key = phKey(el);
    const sppr = child(el, 'p:spPr');
    let xf = sppr ? xfrmOf(child(sppr, 'a:xfrm')) : null;
    const layPh = key ? findPh(this.layoutRoot, key) : null;
    const masPh = key ? findPh(this.masterRoot, key) : null;
    if (!xf) {
      for (const src of [layPh, masPh]) {
        if (src) {
          xf = xfrmOf(pathOne(src, 'p:spPr/a:xfrm'));
          if (xf) break;
        }
      }
    }
    if (!xf) return;
    const piece = { kind: 'shape', name: prefix + this.nameOf(el), locked };
    Object.assign(piece, this.box(xf, tf));
    const geom = sppr ? child(sppr, 'a:prstGeom') : null;
    const prst = geom ? geom.getAttribute('prst') : (!sppr || !child(sppr, 'a:custGeom') ? 'rect' : 'custom');
    piece.geom = prst;
    if (prst === 'roundRect') {
      const gd = pathOne(geom, 'a:avLst/a:gd');
      let adj = 16667;
      if (gd) {
        const m = /val\s+(\d+)/.exec(gd.getAttribute('fmla') || '');
        if (m) adj = parseInt(m[1], 10);
      }
      piece.radius = roundN(Math.min(piece.w, piece.h) * adj / 100000.0, 2);
    }
    let f = fillOf(sppr, this.ctx);
    let ln = lineOf(sppr, this.ctx);
    const style = child(el, 'p:style');
    if (f == null && style) {
      const fr = child(style, 'a:fillRef');
      if (fr && fr.getAttribute('idx') !== '0') {
        const [c, a] = colorOf(fr, this.ctx);
        f = c ? { color: c, alpha: a } : null;
      }
    }
    if (ln == null && style && (!sppr || !pathOne(sppr, 'a:ln/a:noFill'))) {
      const lr = child(style, 'a:lnRef');
      if (lr && lr.getAttribute('idx') !== '0' && connector) {
        const [c, a] = colorOf(lr, this.ctx);
        ln = c ? { color: c, alpha: a, w: 1.5, dash: null } : null;
      }
    }
    if (f && !f.none) piece.fill = f;
    if (ln) piece.line = ln;
    if (connector || ['line', 'straightConnector1', 'bentConnector3'].includes(prst)) {
      piece.kind = 'line';
      if (!ln) return;
    }
    const chain = [], bodyChain = [];
    if (key) {
      const t = key.type;
      chain.push(this.styles[['title', 'ctrTitle'].includes(t) ? 'title' : ['body', 'subTitle', 'obj'].includes(t) ? 'body' : 'other']);
      for (const src of [masPh, layPh]) {
        if (src) {
          bodyChain.push(pathOne(src, 'p:txBody/a:bodyPr'));
          chain.push(pathOne(src, 'p:txBody/a:lstStyle'));
          chain.push(paraAsLst(pathOne(src, 'p:txBody/a:p')));
        }
      }
    } else {
      chain.push(this.styles.other);
    }
    if (style) {
      const fref = child(style, 'a:fontRef');
      const [fc] = fref ? colorOf(fref, this.ctx) : [null];
      if (fc) chain.splice(1, 0, { _pseudoColor: fc });
    }
    const tx = textOf(child(el, 'p:txBody'), this.ctx, chain, this.slideNo, bodyChain);
    if (tx) {
      piece.text = tx;
      if (key && (key.type === 'title' || key.type === 'ctrTitle')) piece.role = 'title';
    }
    if (!tx && !piece.fill && !piece.line) return;
    if (key && ['sldNum', 'ftr', 'dt'].includes(key.type)) piece.locked = true;
    this.pieces.push(piece);
  }
  async picture(el, tf, locked, prefix) {
    const sppr = child(el, 'p:spPr');
    const xf = sppr ? xfrmOf(child(sppr, 'a:xfrm')) : null;
    if (!xf) return;
    const blip = findFirstTag(el, 'a:blip');
    const rid = blip ? blip.getAttributeNS(NS.r, 'embed') : null;
    const target = rid && this.rels.has(rid) ? this.rels.get(rid)[0] : null;
    const piece = { kind: 'pic', name: prefix + this.nameOf(el), locked };
    Object.assign(piece, this.box(xf, tf));
    if (target && WEB_IMG.some((ext) => target.toLowerCase().endsWith(ext))) {
      piece.src = await this.mediaCb(target);
    } else {
      const base = (target || '?').split('/').pop();
      piece.kind = 'shape'; piece.geom = 'rect';
      piece.fill = { color: '#334450', alpha: 0.35 };
      piece.text = {
        anchor: 'ctr', insets: [6, 6, 6, 6], wrap: true,
        paras: [{ align: 'ctr', runs: [{ t: `[picture: ${base}]`, size: 12, color: '#cfd8dc' }] }],
      };
    }
    const geom = sppr ? child(sppr, 'a:prstGeom') : null;
    if (geom && ['ellipse', 'roundRect'].includes(geom.getAttribute('prst'))) piece.geom = geom.getAttribute('prst');
    this.pieces.push(piece);
  }
  async frame(el, tf, locked, prefix) {
    const xf = xfrmOf(child(el, 'p:xfrm'));
    if (!xf) return;
    const gd = pathOne(el, 'a:graphic/a:graphicData');
    if (!gd) return;
    const uri = gd.getAttribute('uri') || '';
    const piece = { name: prefix + this.nameOf(el), locked };
    Object.assign(piece, this.box(xf, tf));
    if (uri.endsWith('/table')) {
      const tbl = child(gd, 'a:tbl');
      piece.kind = 'table';
      piece.table = parseTable(tbl, this.ctx, [this.styles.other]);
    } else if (uri.endsWith('/chart')) {
      const c = child(gd, 'c:chart');
      const rid = c ? c.getAttributeNS(NS.r, 'id') : null;
      const target = rid && this.rels.has(rid) ? this.rels.get(rid)[0] : null;
      const ch = target ? await parseChart(this.pkg, target, this.ctx) : null;
      if (!ch) return;
      piece.kind = 'chart';
      piece.chart = ch;
    } else {
      piece.kind = 'shape'; piece.geom = 'rect';
      piece.fill = { color: '#334450', alpha: 0.3 };
      piece.text = {
        anchor: 'ctr', insets: [6, 6, 6, 6], wrap: true,
        paras: [{ align: 'ctr', runs: [{ t: `[${uri.split('/').pop() || 'object'}]`, size: 13, color: '#cfd8dc' }] }],
      };
    }
    this.pieces.push(piece);
  }
}

async function resolveBg(pkg, parts, ctx, mediaCb) {
  for (const [root, part] of parts) {
    if (!root) continue;
    const bg = pathOne(root, 'p:cSld/p:bg');
    if (!bg) continue;
    const bp = child(bg, 'p:bgPr');
    if (bp) {
      const bl = pathOne(bp, 'a:blipFill/a:blip');
      if (bl) {
        const rels = await pkg.rels(part);
        const rid = bl.getAttributeNS(NS.r, 'embed');
        const tgt = rid && rels.has(rid) ? rels.get(rid)[0] : null;
        if (tgt && WEB_IMG.some((ext) => tgt.toLowerCase().endsWith(ext))) {
          return { image: await mediaCb(tgt), color: '#000000' };
        }
      }
      const f = fillOf(bp, ctx);
      if (f && !f.none) return { color: f.color, grad: f.grad, angle: f.angle };
    }
    const br = child(bg, 'p:bgRef');
    if (br) {
      const [c] = colorOf(br, ctx);
      if (c) return { color: c };
    }
  }
  return { color: '#ffffff' };
}

function plainText(tx) {
  if (!tx) return '';
  return (tx.paras || []).map((p) => (p.runs || []).map((r) => r.t || '').join('')).join('\n').trim();
}

/**
 * Unpack a .pptx ArrayBuffer / Uint8Array completely inside the browser.
 * Returns { name, w, h, slides, revokeMedia() } matching pptx_deck.py's schema.
 */
export async function parsePptxBuffer(buffer, fileName = 'deck.pptx') {
  const zip = await unzipPptx(buffer);
  const pkg = new Package(zip);
  const presPart = 'ppt/presentation.xml';
  const pres = await pkg.xml(presPart);
  if (!pres) throw new Error('not a PowerPoint file (no ppt/presentation.xml)');
  const sz = child(pres, 'p:sldSz');
  const W = sz ? px(sz.getAttribute('cx')) : 1280.0;
  const H = sz ? px(sz.getAttribute('cy')) : 720.0;
  const prels = await pkg.rels(presPart);
  const mediaUrls = new Map();
  const mediaCb = async (part) => {
    if (mediaUrls.has(part)) return mediaUrls.get(part);
    const bytes = await zip.read(part);
    if (!bytes) return '';
    const dot = part.lastIndexOf('.');
    const ext = dot >= 0 ? part.slice(dot).toLowerCase() : '';
    const url = URL.createObjectURL(new Blob([bytes], { type: IMG_MIME[ext] || 'application/octet-stream' }));
    mediaUrls.set(part, url);
    return url;
  };
  const order = children(child(pres, 'p:sldIdLst'), 'p:sldId').map((s) => s.getAttributeNS(NS.r, 'id'));
  const slides = [];
  let n = 0;
  for (const rid of order) {
    const part = prels.has(rid) ? prels.get(rid)[0] : null;
    const root = part ? await pkg.xml(part) : null;
    if (!root || root.getAttribute('show') === '0') continue;
    n += 1;
    const layoutPart = await pkg.relOfType(part, 'slideLayout');
    const layout = layoutPart ? await pkg.xml(layoutPart) : null;
    const masterPart = layoutPart ? await pkg.relOfType(layoutPart, 'slideMaster') : null;
    const master = masterPart ? await pkg.xml(masterPart) : null;
    const themePart = masterPart ? await pkg.relOfType(masterPart, 'theme') : null;
    const theme = new Theme(themePart ? await pkg.xml(themePart) : null);
    const clrmap = {};
    const cm = master ? child(master, 'p:clrMap') : null;
    if (cm) for (const a of cm.attributes) clrmap[a.name] = a.value;
    const ctx = new Ctx(theme, clrmap);
    const styles = {};
    if (master) {
      for (const [k, tag] of [['title', 'p:txStyles/p:titleStyle'], ['body', 'p:txStyles/p:bodyStyle'], ['other', 'p:txStyles/p:otherStyle']]) {
        styles[k] = pathOne(master, tag);
      }
    }
    let pieces = [];
    const showMaster = root.getAttribute('showMasterSp') !== '0';
    for (const [decoRoot, decoPart, flag] of [
      [master, masterPart, showMaster && (!layout || layout.getAttribute('showMasterSp') !== '0')],
      [layout, layoutPart, showMaster],
    ]) {
      if (!decoRoot || !flag) continue;
      const tree = pathOne(decoRoot, 'p:cSld/p:spTree');
      const sp = new SlideParser(pkg, decoPart, await pkg.rels(decoPart), ctx, null, null, styles, mediaCb, n);
      await sp.walk(elList(tree).filter((e) => !(qMatch(e, 'p', 'sp') && phKey(e))), null, true);
      pieces = pieces.concat(sp.pieces);
    }
    const sp = new SlideParser(
      pkg, part, await pkg.rels(part), ctx,
      layout ? pathOne(layout, 'p:cSld/p:spTree') : null,
      master ? pathOne(master, 'p:cSld/p:spTree') : null,
      styles, mediaCb, n
    );
    await sp.walk(pathOne(root, 'p:cSld/p:spTree'));
    pieces = pieces.concat(sp.pieces).filter((p) => p.kind !== 'error');
    pieces.forEach((p, i) => {
      p.id = `s${n}-${i}`;
      if ((p.w || 0) * (p.h || 0) > W * H * 0.85) p.locked = true;
    });
    const titleObj = pieces.find((p) => p.role === 'title');
    const title = titleObj ? plainText(titleObj.text) : '';
    let notes = '';
    const np = await pkg.relOfType(part, 'notesSlide');
    const nr = np ? await pkg.xml(np) : null;
    if (nr) {
      for (const s of iterTag(nr, 'p:sp')) {
        const k = phKey(s);
        if (k && k.type === 'body') notes = plainText(textOf(child(s, 'p:txBody'), ctx, []));
      }
    }
    slides.push({
      n, title: title.replace(/\n/g, ' '), notes,
      bg: await resolveBg(pkg, [[root, part], [layout, layoutPart], [master, masterPart]], ctx, mediaCb),
      pieces,
    });
  }
  return {
    name: fileName.split('/').pop(),
    w: W,
    h: H,
    slides,
    revokeMedia: () => { for (const u of mediaUrls.values()) URL.revokeObjectURL(u); mediaUrls.clear(); },
  };
}
