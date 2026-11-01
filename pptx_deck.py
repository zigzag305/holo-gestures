#!/usr/bin/env python3
"""pptx_deck — unpack a PowerPoint .pptx into LAYERS for LinkPresent.

Stdlib only (zipfile + ElementTree), same rule as server.py: nothing to install.

A .pptx is not a picture of a slide: every title, bullet, card, picture, table and
chart is its own object with an exact position — and a native chart still carries
its numbers. This module keeps every one of those objects separate, so the stage can
pull a slide apart into depth, let you grab a single chart out of it, and rebuild that
chart live from its real data.

    parse_deck(path) -> {
      "name", "w", "h",                       # slide size in CSS px (96 dpi)
      "slides": [{ "n", "title", "notes", "bg": {color|image}, "pieces": [piece…] }]
    }

piece = { id, kind: shape|pic|table|chart|line, name, x, y, w, h, rot, locked,
          geom, fill, line, radius, text, src, table, chart }

What it deliberately skips: PowerPoint animations and transitions (HOLO brings its
own motion), SmartArt internals, EMF/WMF pictures (browsers can't draw them), and
table styles (explicit cell fills are kept).
"""
import colorsys
import os
import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
R_EMBED = "{%s}embed" % NS["r"]
R_ID = "{%s}id" % NS["r"]
EMU_PX = 9525.0                     # 914400 EMU per inch / 96 px per inch
PT_PX = 96.0 / 72.0
WEB_IMG = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp")


def q(tag):
    pre, name = tag.split(":")
    return "{%s}%s" % (NS[pre], name)


def px(v, default=0.0):
    try:
        return round(int(v) / EMU_PX, 2)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------- package helpers
class Package:
    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        self.names = set(self.z.namelist())
        self._xml = {}

    def xml(self, part):
        if part not in self._xml:
            self._xml[part] = ET.fromstring(self.z.read(part)) if part in self.names else None
        return self._xml[part]

    def rels(self, part):
        d, b = posixpath.split(part)
        rp = posixpath.join(d, "_rels", b + ".rels")
        out = {}
        root = self.xml(rp)
        if root is None:
            return out
        for r in root.findall("rel:Relationship", NS):
            tgt = r.get("Target", "")
            if r.get("TargetMode") == "External":
                continue
            full = tgt.lstrip("/") if tgt.startswith("/") else posixpath.normpath(posixpath.join(d, tgt))
            out[r.get("Id")] = (full, r.get("Type", "").rsplit("/", 1)[-1])
        return out

    def rel_of_type(self, part, typ):
        for full, t in self.rels(part).values():
            if t == typ:
                return full
        return None


# ---------------------------------------------------------------- colors
def _hex_to_rgb(h):
    h = h.strip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def _rgb_to_hex(rgb):
    return "#" + "".join("%02x" % max(0, min(255, int(round(c * 255)))) for c in rgb)


PRESET = {"black": "000000", "white": "FFFFFF", "red": "FF0000", "green": "008000", "blue": "0000FF",
          "yellow": "FFFF00", "gray": "808080", "grey": "808080", "orange": "FFA500"}


class Theme:
    def __init__(self, root):
        self.colors = {}
        self.major = "Calibri"
        self.minor = "Calibri"
        if root is None:
            return
        cs = root.find(".//a:clrScheme", NS)
        if cs is not None:
            for ch in cs:
                name = ch.tag.split("}")[1]
                s = ch.find("a:srgbClr", NS)
                y = ch.find("a:sysClr", NS)
                if s is not None:
                    self.colors[name] = s.get("val")
                elif y is not None:
                    self.colors[name] = y.get("lastClr", "000000")
        mj = root.find(".//a:majorFont/a:latin", NS)
        mn = root.find(".//a:minorFont/a:latin", NS)
        if mj is not None and mj.get("typeface"):
            self.major = mj.get("typeface")
        if mn is not None and mn.get("typeface"):
            self.minor = mn.get("typeface")


class Ctx:
    """Everything needed to resolve colors/fonts for one slide."""
    def __init__(self, theme, clrmap):
        self.theme = theme
        self.clrmap = clrmap or {}

    def scheme(self, val):
        m = {"bg1": "lt1", "tx1": "dk1", "bg2": "lt2", "tx2": "dk2"}
        key = self.clrmap.get(val, m.get(val, val))
        return self.theme.colors.get(key, "000000")

    def font(self, face):
        if not face:
            return None
        if face.startswith("+mj"):
            return self.theme.major
        if face.startswith("+mn"):
            return self.theme.minor
        return face


def color_of(el, ctx):
    """el = any element that may CONTAIN a color choice (solidFill, ln, a fill parent…).
    Returns (hex, alpha) or (None, None)."""
    if el is None:
        return None, None
    for tag in ("srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr"):
        c = el.find("a:" + tag, NS)
        if c is not None:
            break
    else:
        return None, None
    if tag == "srgbClr":
        base = c.get("val", "000000")
    elif tag == "schemeClr":
        base = ctx.scheme(c.get("val", "tx1"))
    elif tag == "sysClr":
        base = c.get("lastClr", "000000")
    elif tag == "prstClr":
        base = PRESET.get(c.get("val", "black"), "000000")
    else:
        base = "000000"
    r, g, b = _hex_to_rgb(base)
    alpha = 1.0
    for mod in c:
        n = mod.tag.split("}")[1]
        v = int(mod.get("val", "100000")) / 100000.0
        if n in ("lumMod", "lumOff"):
            h, l, s = colorsys.rgb_to_hls(r, g, b)
            l = l * v if n == "lumMod" else min(1.0, l + v)
            r, g, b = colorsys.hls_to_rgb(h, l, s)
        elif n == "tint":
            r, g, b = (x + (1 - x) * (1 - v) for x in (r, g, b))
        elif n == "shade":
            r, g, b = (x * v for x in (r, g, b))
        elif n == "alpha":
            alpha = v
    return _rgb_to_hex((r, g, b)), round(alpha, 3)


def fill_of(sppr, ctx):
    """spPr / tcPr / bgPr → {'color','alpha'} | {'none':True} | None (inherit)."""
    if sppr is None:
        return None
    if sppr.find("a:noFill", NS) is not None:
        return {"none": True}
    sf = sppr.find("a:solidFill", NS)
    if sf is not None:
        c, a = color_of(sf, ctx)
        return {"color": c, "alpha": a} if c else None
    gf = sppr.find("a:gradFill", NS)
    if gf is not None:
        stops = []
        for gs in gf.findall("a:gsLst/a:gs", NS):
            c, a = color_of(gs, ctx)
            if c:
                stops.append({"pos": int(gs.get("pos", "0")) / 1000.0, "color": c, "alpha": a})
        lin = gf.find("a:lin", NS)
        ang = int(lin.get("ang", "0")) / 60000.0 if lin is not None else 90.0
        if stops:
            return {"color": stops[0]["color"], "alpha": stops[0]["alpha"], "grad": stops, "angle": ang}
    return None


def line_of(sppr, ctx):
    if sppr is None:
        return None
    ln = sppr.find("a:ln", NS)
    if ln is None or ln.find("a:noFill", NS) is not None:
        return None
    sf = ln.find("a:solidFill", NS)
    if sf is None:
        return None
    c, a = color_of(sf, ctx)
    if not c:
        return None
    dash = ln.find("a:prstDash", NS)
    out = {"color": c, "alpha": a, "w": round(max(0.75, int(ln.get("w", "9525")) / EMU_PX), 2),
           "dash": dash.get("val") if dash is not None and dash.get("val") != "solid" else None}
    for end in ("headEnd", "tailEnd"):
        e = ln.find("a:" + end, NS)
        if e is not None and e.get("type", "none") != "none":
            out[end] = e.get("type")
    return out


# ---------------------------------------------------------------- text
def _lvl_props(lst, lvl, ctx):
    """Pull paragraph + default-run props for level `lvl` out of a lstStyle-like element."""
    out = {}
    if lst is None:
        return out
    pp = lst.find("a:lvl%dpPr" % lvl, NS)
    if pp is None:
        return out
    _ppr_into(pp, out, ctx)
    d = pp.find("a:defRPr", NS)
    if d is not None:
        _rpr_into(d, out, ctx)
    return out


def _ppr_into(pp, out, ctx):
    if pp is None:
        return
    if pp.get("algn"):
        out["align"] = pp.get("algn")
    if pp.get("marL") is not None:
        out["marL"] = px(pp.get("marL"))
    if pp.get("indent") is not None:
        out["indent"] = px(pp.get("indent"))
    if pp.find("a:buNone", NS) is not None:
        out["bullet"] = None
    bf = pp.find("a:buFont", NS)
    if bf is not None and bf.get("typeface"):
        out["buFont"] = bf.get("typeface")
    bc = pp.find("a:buChar", NS)
    if bc is not None:
        ch = bc.get("char", "•")
        if "wingdings" in (out.get("buFont") or "").lower() or "symbol" == (out.get("buFont") or "").lower():
            ch = WINGDINGS.get(ch, "•")
        out["bullet"] = ch
    ba = pp.find("a:buAutoNum", NS)
    if ba is not None:
        out["bullet"] = "#"
        out["autoNum"] = ba.get("type", "arabicPeriod")
        out["startAt"] = int(ba.get("startAt", "1"))
    bclr = pp.find("a:buClr", NS)
    if bclr is not None:
        c, _ = color_of(bclr, ctx)
        if c:
            out["buColor"] = c
    bsz = pp.find("a:buSzPct", NS)
    if bsz is not None:
        out["buSize"] = int(bsz.get("val", "100000")) / 100000.0
    sa = pp.find("a:spcAft/a:spcPts", NS)
    if sa is not None:
        out["spaceAfter"] = round(int(sa.get("val", "0")) / 100.0 * PT_PX, 1)
    sb = pp.find("a:spcBef/a:spcPts", NS)
    if sb is not None:
        out["spaceBefore"] = round(int(sb.get("val", "0")) / 100.0 * PT_PX, 1)
    ls = pp.find("a:lnSpc/a:spcPct", NS)
    if ls is not None:
        out["lineSpacing"] = int(ls.get("val", "100000")) / 100000.0


def _rpr_into(r, out, ctx):
    if r is None:
        return
    if r.get("sz"):
        out["size"] = round(int(r.get("sz")) / 100.0 * PT_PX, 2)
    if r.get("b") is not None:
        out["b"] = r.get("b") in ("1", "true")
    if r.get("i") is not None:
        out["i"] = r.get("i") in ("1", "true")
    if r.get("u") and r.get("u") != "none":
        out["u"] = True
    if r.get("spc"):
        out["spacing"] = round(int(r.get("spc")) / 100.0 * PT_PX, 2)
    if r.get("cap") == "all":
        out["caps"] = True
    sf = r.find("a:solidFill", NS)
    if sf is not None:
        c, a = color_of(sf, ctx)
        if c:
            out["color"] = c
            out["alpha"] = a
    la = r.find("a:latin", NS)
    if la is not None and la.get("typeface"):
        out["font"] = ctx.font(la.get("typeface"))


RUN_KEYS = ("size", "b", "i", "u", "spacing", "caps", "color", "alpha", "font")
PARA_KEYS = ("align", "marL", "indent", "bullet", "spaceAfter", "spaceBefore", "lineSpacing", "buColor", "buSize")
# bullet glyphs PowerPoint draws from symbol fonts, mapped to Unicode
WINGDINGS = {"§": "■", "Ø": "➢", "ü": "✓", "q": "❑", "n": "■", "l": "●", "v": "❖", "Ü": "➔", "à": "➔", "o": "□", "Ÿ": "•", "·": "•"}


def autonum(scheme, n):
    """PowerPoint auto-numbering (a:buAutoNum type) for item n (1-based)."""
    def alpha(k):
        out = ""
        while k > 0:
            k, r = divmod(k - 1, 26)
            out = chr(97 + r) + out
        return out
    def roman(k):
        vals = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"), (50, "l"), (40, "xl"), (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]
        out = ""
        for v, sym in vals:
            while k >= v:
                out += sym; k -= v
        return out
    body = (alpha(n) if scheme.startswith("alphaLc") else alpha(n).upper() if scheme.startswith("alphaUc")
            else roman(n) if scheme.startswith("romanLc") else roman(n).upper() if scheme.startswith("romanUc") else str(n))
    if scheme.endswith("ParenBoth"):
        return "(%s)" % body
    if scheme.endswith("ParenR"):
        return body + ")"
    if scheme.endswith("Plain"):
        return body
    if scheme.endswith("Minus"):
        return body + " -"
    return body + "."


def text_of(txbody, ctx, inherit_chain, slide_no=None, body_chain=()):
    """inherit_chain: lstStyle-like elements, lowest priority first.
    body_chain: bodyPr elements of the master/layout placeholders this text inherits from
    (anchor, insets, wrap, vertical text, columns, autofit), lowest priority first."""
    if txbody is None:
        return None
    attrs = {}
    autofit = None
    for b in list(body_chain) + [txbody.find("a:bodyPr", NS)]:
        if b is None:
            continue
        attrs.update(b.attrib)
        na = b.find("a:normAutofit", NS)
        if na is not None:
            autofit = na
        elif b.find("a:noAutofit", NS) is not None or b.find("a:spAutoFit", NS) is not None:
            autofit = None
    ins = [int(attrs.get(k, d)) for k, d in (("lIns", 91440), ("tIns", 45720), ("rIns", 91440), ("bIns", 45720))]
    anchor = attrs.get("anchor", "t")
    wrap = attrs.get("wrap", "square") != "none"
    scale = int(autofit.get("fontScale", "100000")) / 100000.0 if autofit is not None else 1.0
    lnred = int(autofit.get("lnSpcReduction", "0")) / 100000.0 if autofit is not None else 0.0
    counters = {}
    own_lst = txbody.find("a:lstStyle", NS)
    chain = list(inherit_chain) + [own_lst]
    paras = []
    has_text = False
    for p in txbody.findall("a:p", NS):
        ppr = p.find("a:pPr", NS)
        lvl = int(ppr.get("lvl", "0")) + 1 if ppr is not None else 1
        base = {"size": 18 * PT_PX}
        for lst in chain:
            base.update(_lvl_props(lst, lvl, ctx))
        _ppr_into(ppr, base, ctx)
        para = {k: base[k] for k in PARA_KEYS if k in base}
        runs = []
        for r in p:
            tag = r.tag.split("}")[1]
            if tag not in ("r", "fld", "br"):
                continue
            rp = dict((k, base[k]) for k in RUN_KEYS if k in base)
            _rpr_into(r.find("a:rPr", NS), rp, ctx)
            if tag == "br":
                t = "\n"
            else:
                t = "".join(r.findtext("a:t", default="", namespaces=NS))
                if tag == "fld" and r.get("type") == "slidenum" and slide_no is not None:
                    t = str(slide_no)
            if t:
                rp["t"] = t
                runs.append(rp)
                if t.strip():
                    has_text = True
        if not runs:
            # empty paragraph keeps its height (endParaRPr size)
            ep = p.find("a:endParaRPr", NS)
            rp = {"size": base.get("size")}
            if ep is not None and ep.get("sz"):
                rp["size"] = round(int(ep.get("sz")) / 100.0 * PT_PX, 2)
            para["empty"] = rp["size"]
        else:
            if para.get("bullet") == "#":
                key = (lvl, base.get("autoNum"))
                counters[key] = counters.get(key, base.get("startAt", 1) - 1) + 1
                para["bullet"] = autonum(base.get("autoNum", "arabicPeriod"), counters[key])
            else:
                for k in [k for k in counters if k[0] >= lvl]:
                    del counters[k]                     # a plain paragraph ends the numbered list
        if scale != 1.0 or lnred:
            for r in runs:
                if r.get("size"):
                    r["size"] = round(r["size"] * scale, 2)
            if para.get("empty"):
                para["empty"] = round(para["empty"] * scale, 2)
            for k in ("spaceAfter", "spaceBefore"):
                if para.get(k):
                    para[k] = round(para[k] * scale, 1)
            para["lineSpacing"] = round((para.get("lineSpacing") or 1.0) - lnred, 3)
        para["runs"] = runs
        paras.append(para)
    if not has_text:
        return None
    out = {"anchor": anchor, "wrap": wrap, "insets": [round(v / EMU_PX, 1) for v in ins], "paras": paras}
    if attrs.get("vert") and attrs["vert"] != "horz":
        out["vert"] = attrs["vert"]
    if int(attrs.get("numCol", "1")) > 1:
        out["cols"] = int(attrs["numCol"])
        out["colGap"] = px(attrs.get("spcCol", "0"))
    return out


# ---------------------------------------------------------------- charts
def _first_found(el, *paths):
    for pth in paths:
        e = el.find(pth, NS)
        if e is not None:
            return e
    return None


def _cache_vals(el):
    if el is None:
        return []
    pts = {}
    for pt in el.iter(q("c:pt")):
        v = pt.findtext("c:v", default="", namespaces=NS)
        pts[int(pt.get("idx", "0"))] = v
    n = max(pts) + 1 if pts else 0
    return [pts.get(i, "") for i in range(n)]


def _first_text(el):
    if el is None:
        return ""
    t = "".join(x.text or "" for x in el.iter(q("a:t")))
    if t:
        return t
    v = el.find(".//c:v", NS)
    return v.text if v is not None and v.text else ""


def _txpr_style(el, ctx, direct=False):
    out = {}
    if el is None:
        return out
    d = el.find("c:txPr/a:p/a:pPr/a:defRPr", NS) if direct else el.find(".//c:txPr//a:defRPr", NS)
    if d is not None:
        _rpr_into(d, out, ctx)
    return out


def parse_chart(pkg, part, ctx):
    """A native chart → {type, series[], axes, legend, title, labels, textStyle}.
    Several plots in one chart (a combo: columns + a line on a second axis) come back as one
    series list where each series carries its own `kind` and `secondary` flag; `type` is the
    first plot's kind."""
    root = pkg.xml(part)
    if root is None:
        return None
    chart = root.find("c:chart", NS)
    pa = chart.find("c:plotArea", NS) if chart is not None else None
    if pa is None:
        return None
    kinds = {"barChart": "bar", "bar3DChart": "bar", "lineChart": "line", "line3DChart": "line",
             "pieChart": "pie", "pie3DChart": "pie", "ofPieChart": "pie", "doughnutChart": "doughnut",
             "areaChart": "area", "area3DChart": "area", "scatterChart": "scatter", "radarChart": "line",
             "bubbleChart": "scatter", "stockChart": "line"}
    plots = [(ch, kinds[ch.tag.split("}")[1]]) for ch in pa if ch.tag.split("}")[1] in kinds]
    if not plots:
        return None
    out = {"type": plots[0][1]}
    base = _txpr_style(root, ctx, direct=True)          # chart-wide default text (chartSpace/c:txPr)
    if base:
        out["textStyle"] = base

    # axes by id: the first plot's value axis is primary, any other is secondary
    axes = {}
    for ax in pa:
        tag = ax.tag.split("}")[1]
        if tag in ("valAx", "catAx", "dateAx", "serAx"):
            axes[ax.find("c:axId", NS).get("val")] = (tag, ax)
    def axis_info(ax):
        de = ax.find("c:delete", NS)
        info = {"hidden": de is not None and de.get("val") == "1"}
        for k in ("min", "max"):
            e = ax.find("c:scaling/c:" + k, NS)
            if e is not None:
                info[k] = float(e.get("val"))
        o = ax.find("c:scaling/c:orientation", NS)
        if o is not None and o.get("val") == "maxMin":
            info["reverse"] = True
        mu = ax.find("c:majorUnit", NS)
        if mu is not None:
            info["step"] = float(mu.get("val"))
        info["style"] = _txpr_style(ax, ctx)
        info["grid"] = ax.find("c:majorGridlines", NS) is not None
        ap = ax.find("c:axPos", NS)
        info["pos"] = ap.get("val") if ap is not None else None
        nf = ax.find("c:numFmt", NS)
        if nf is not None and nf.get("formatCode") not in (None, "General"):
            info["fmt"] = nf.get("formatCode")
        tl = ax.find("c:tickLblPos", NS)
        if tl is not None and tl.get("val") == "none":
            info["noLabels"] = True
        t = ax.find("c:title", NS)
        if t is not None:
            info["title"] = _first_text(t.find("c:tx", NS)) or None
        return info
    primary_val = None

    def dl_flags(dl, into):
        if dl is None:
            return
        for k, key in (("c:showVal", "showVal"), ("c:showPercent", "showPercent"), ("c:showCatName", "showCat")):
            e = dl.find(k, NS)
            if e is not None:
                into[key] = e.get("val") == "1"
        nf = dl.find("c:numFmt", NS)
        if nf is not None:
            into["fmt"] = nf.get("formatCode")
        pos = dl.find("c:dLblPos", NS)
        if pos is not None:
            into["pos"] = pos.get("val")
        st = _txpr_style(dl, ctx)
        if st:
            into["labelStyle"] = st
        # per-point <c:dLbl> overrides win (PowerPoint shows what the points say)
        pts = dl.findall("c:dLbl", NS)
        if pts:
            for k, key in (("c:showVal", "showVal"), ("c:showPercent", "showPercent"), ("c:showCatName", "showCat")):
                vals = [d.find(k, NS) for d in pts]
                if all(v is not None for v in vals):
                    into[key] = vals[0].get("val") == "1"
            nf = pts[0].find("c:numFmt", NS)
            if nf is not None and nf.get("formatCode") not in (None, "General"):
                into["fmt"] = nf.get("formatCode")

    series, labels = [], {}
    for pi, (plot, kind) in enumerate(plots):
        ids = [e.get("val") for e in plot.findall("c:axId", NS)]
        vals_ax = [axes[i] for i in ids if i in axes and axes[i][0] == "valAx"]
        secondary = False
        if vals_ax:
            vid = id(vals_ax[0][1])
            if primary_val is None:
                primary_val = vals_ax[-1][1] if kind == "scatter" else vals_ax[0][1]
            secondary = vals_ax[0][1] is not primary_val and kind != "scatter"
        pl = {}
        dl_flags(plot.find("c:dLbls", NS), pl)
        if pi == 0:
            labels = pl
            if kind == "bar":
                bd = plot.find("c:barDir", NS)
                out["barDir"] = bd.get("val") if bd is not None else "col"
                gp = plot.find("c:grouping", NS)
                out["grouping"] = gp.get("val") if gp is not None else "clustered"
                gw = plot.find("c:gapWidth", NS)
                out["gap"] = int(gw.get("val", "150")) / 100.0 if gw is not None else 1.5
            if kind == "doughnut":
                hs = plot.find("c:holeSize", NS)
                out["hole"] = int(hs.get("val", "50")) / 100.0 if hs is not None else .5
            if kind in ("line", "area") and plot.find("c:grouping", NS) is not None:
                out["grouping"] = plot.find("c:grouping", NS).get("val")
        vc = plot.find("c:varyColors", NS)
        vary = (vc.get("val", "1") != "0") if vc is not None else kind in ("pie", "doughnut")
        pmark = plot.find("c:marker", NS)
        plot_markers = pmark is None or pmark.get("val", "1") != "0"
        style = plot.find("c:scatterStyle", NS)
        for s in plot.findall("c:ser", NS):
            idx = int(s.find("c:idx", NS).get("val", str(len(series)))) if s.find("c:idx", NS) is not None else len(series)
            name = _first_text(s.find("c:tx", NS)) or ("Series %d" % (len(series) + 1))
            cat_el = s.find("c:cat", NS)
            x_el = s.find("c:xVal", NS)
            val_el = _first_found(s, "c:val", "c:yVal")
            cats = _cache_vals(cat_el if cat_el is not None else x_el)
            vals = [_num(v) for v in _cache_vals(val_el)]
            fmt_code = None
            if val_el is not None:
                fc = val_el.find(".//c:formatCode", NS)
                fmt_code = fc.text if fc is not None else None
            sppr = s.find("c:spPr", NS)
            f = fill_of(sppr, ctx)
            col = f.get("color") if f and not f.get("none") else None
            ln = sppr.find("a:ln", NS) if sppr is not None else None
            line_hidden = ln is not None and ln.find("a:noFill", NS) is not None
            width = None
            if kind in ("line", "scatter") and sppr is not None:
                lo = line_of(sppr, ctx)
                if lo:
                    col = lo["color"]
                lnw = sppr.find("a:ln", NS)
                if lnw is not None and lnw.get("w"):
                    width = round(int(lnw.get("w")) / EMU_PX, 2)
            if not col:                           # PowerPoint's default: the theme's accents in turn
                col = "#" + ctx.scheme("accent%d" % (idx % 6 + 1)).lstrip("#")
            pcols = {}
            for dpt in s.findall("c:dPt", NS):
                j = int(dpt.find("c:idx", NS).get("val", "0"))
                ff = fill_of(dpt.find("c:spPr", NS), ctx)
                if ff and ff.get("color"):
                    pcols[j] = ff["color"]
            if vary and kind in ("pie", "doughnut"):          # each slice its own accent
                for j in range(len(vals)):
                    pcols.setdefault(j, "#" + ctx.scheme("accent%d" % (j % 6 + 1)).lstrip("#"))
            sl = dict(pl)
            dl_flags(s.find("c:dLbls", NS), sl)
            mk = s.find("c:marker/c:symbol", NS)
            marker = plot_markers if mk is None else mk.get("val") != "none"
            if kind == "scatter" and style is not None and style.get("val") in ("line", "smooth"):
                marker = mk is not None and mk.get("val") != "none"
            ser = {"name": name, "cats": cats, "vals": vals, "color": col, "kind": kind, "secondary": secondary,
                   "pointColors": [pcols.get(j) for j in range(len(vals))] if pcols else None,
                   "fmt": sl.get("fmt") or (fmt_code if fmt_code and fmt_code != "General" else None),
                   "labels": sl, "marker": marker, "width": width,
                   "line": not line_hidden and not (kind == "scatter" and style is not None and style.get("val") == "marker")}
            if kind == "scatter":
                ser["xs"] = [_num(v) for v in _cache_vals(x_el)] if x_el is not None else list(range(1, len(vals) + 1))
            sm = s.find("c:smooth", NS)
            if sm is not None and sm.get("val") == "1":
                ser["smooth"] = True
            series.append(ser)
    if not series:
        return None
    out["series"] = series
    out["labels"] = labels

    # title: explicit, or PowerPoint's automatic one (the series name) on a single-series chart
    t = chart.find("c:title", NS)
    atd = chart.find("c:autoTitleDeleted", NS)
    deleted = atd is not None and atd.get("val") == "1"
    if t is not None and not deleted:
        out["title"] = _first_text(t.find("c:tx", NS)) or (series[0]["name"] if len(series) == 1 else None)
        st = {}
        rp = _first_found(t, ".//a:rPr", ".//a:defRPr")
        _rpr_into(rp, st, ctx)
        out["titleStyle"] = st
    elif t is None and not deleted and len(series) == 1:
        out["title"] = series[0]["name"]
        out["titleStyle"] = {"auto": True}

    # axes: primary value axis, a secondary one if a series uses it, the category axis
    for aid, (tag, ax) in axes.items():
        if tag == "valAx":
            if ax is primary_val:
                out["valAxis"] = axis_info(ax)
            elif any(s["secondary"] for s in series):
                out["valAxis2"] = axis_info(ax)
            elif out["type"] == "scatter" and "catAxis" not in out:
                out["catAxis"] = axis_info(ax)          # scatter: the X axis is a value axis
        elif tag in ("catAx", "dateAx") and "catAxis" not in out:
            out["catAxis"] = axis_info(ax)
    if "valAxis" not in out and primary_val is not None:
        out["valAxis"] = axis_info(primary_val)
    lg = chart.find("c:legend", NS)
    if lg is not None:
        lp = lg.find("c:legendPos", NS)
        out["legend"] = {"pos": lp.get("val") if lp is not None else "r", "style": _txpr_style(lg, ctx)}
    return out


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- tables
def parse_table(tbl, ctx, inherit):
    cols = [px(g.get("w")) for g in tbl.findall("a:tblGrid/a:gridCol", NS)]
    rows = []
    tp = tbl.find("a:tblPr", NS)
    styled = tp is not None and tp.find("a:tableStyleId", NS) is not None
    first_row = tp is not None and tp.get("firstRow") == "1"
    band = tp is not None and tp.get("bandRow") == "1"
    acc = ctx.scheme("accent1")
    light = _rgb_to_hex(tuple(x + (1 - x) * .8 for x in _hex_to_rgb(acc)))
    lighter = _rgb_to_hex(tuple(x + (1 - x) * .9 for x in _hex_to_rgb(acc)))
    for ri, tr in enumerate(tbl.findall("a:tr", NS)):
        cells = []
        for tc in tr.findall("a:tc", NS):
            if tc.get("hMerge") == "1" or tc.get("vMerge") == "1":
                cells.append({"merged": True})
                continue
            tcpr = tc.find("a:tcPr", NS)
            cell = {"span": int(tc.get("gridSpan", "1")), "rowSpan": int(tc.get("rowSpan", "1"))}
            f = fill_of(tcpr, ctx)
            if f and not f.get("none"):
                cell["fill"] = f["color"]
            if tcpr is not None:
                cell["anchor"] = tcpr.get("anchor", "t")
                cell["mar"] = [px(tcpr.get(k, d)) for k, d in (("marL", 91440), ("marT", 45720), ("marR", 91440), ("marB", 45720))]
                lb = tcpr.find("a:lnB", NS)
                if lb is not None and lb.find("a:solidFill", NS) is not None:
                    cell["border"] = color_of(lb.find("a:solidFill", NS), ctx)[0]
            txb = tc.find("a:txBody", NS)
            head = styled and first_row and ri == 0
            if styled and "fill" not in cell and not (f and f.get("none")):
                # table STYLES aren't resolved; approximate PowerPoint's default so a
                # plain inserted table doesn't come out as bare grid lines
                cell["fill"] = "#" + acc.lstrip("#") if head else (light if band and ri % 2 else lighter)
                cell.setdefault("border", "#ffffff")
            tx = text_of(txb, ctx, inherit + ([_color_lst("#ffffff")] if head else [])) if txb is not None else None
            if tx is None and txb is not None:
                tx = {"paras": []}
            cell["text"] = tx
            cells.append(cell)
        rows.append({"h": px(tr.get("h")), "cells": cells})
    return {"cols": cols, "rows": rows}


# ---------------------------------------------------------------- shape tree
def _xfrm(el):
    """Return (x, y, w, h, rot, flipH, flipV) in EMU or None."""
    if el is None:
        return None
    off = el.find("a:off", NS)
    ext = el.find("a:ext", NS)
    if off is None or ext is None:
        return None
    return (int(off.get("x", 0)), int(off.get("y", 0)), int(ext.get("cx", 0)), int(ext.get("cy", 0)),
            int(el.get("rot", "0")) / 60000.0, el.get("flipH") == "1", el.get("flipV") == "1")


def _ph_key(sp):
    ph = sp.find(".//p:nvPr/p:ph", NS)
    if ph is None:
        return None
    return {"type": ph.get("type", "body"), "idx": ph.get("idx")}


def _find_ph(tree_root, key):
    """Find the matching placeholder sp in a layout/master spTree (idx first, then type)."""
    if tree_root is None or key is None:
        return None
    cands = [sp for sp in tree_root.iter(q("p:sp")) if _ph_key(sp)]
    if key.get("idx") is not None:
        for sp in cands:
            if _ph_key(sp).get("idx") == key["idx"]:
                return sp
    t = key["type"]
    alias = {"ctrTitle": "title", "subTitle": "body", "obj": "body"}
    for sp in cands:
        kt = _ph_key(sp)["type"]
        if kt == t or alias.get(kt) == alias.get(t, t) or kt == alias.get(t):
            return sp
    return None


class SlideParser:
    def __init__(self, pkg, part, ctx, layout_root, master_root, master_styles, media_cb, slide_no):
        self.pkg, self.part, self.ctx = pkg, part, ctx
        self.layout_root, self.master_root = layout_root, master_root
        self.styles = master_styles
        self.rels = pkg.rels(part)
        self.media_cb = media_cb
        self.slide_no = slide_no
        self.pieces = []

    def walk(self, tree, tf=None, locked=False, prefix=""):
        for el in tree:
            tag = el.tag.split("}")[1]
            try:
                if tag == "sp":
                    self.shape(el, tf, locked, prefix)
                elif tag == "cxnSp":
                    self.shape(el, tf, locked, prefix, connector=True)
                elif tag == "pic":
                    self.picture(el, tf, locked, prefix)
                elif tag == "graphicFrame":
                    self.frame(el, tf, locked, prefix)
                elif tag == "grpSp":
                    self.group(el, tf, locked, prefix)
                elif tag == "AlternateContent":
                    fb = el.find("{http://schemas.openxmlformats.org/markup-compatibility/2006}Fallback")
                    if fb is not None:
                        self.walk(fb, tf, locked, prefix)
            except Exception as e:  # one odd shape must never kill the whole deck
                self.pieces.append({"kind": "error", "name": "%s (%s)" % (tag, type(e).__name__)})

    def _box(self, xf, tf):
        x, y, w, h, rot, fh, fv = xf
        if tf:
            x, y, w, h = tf(x, y, w, h)
        return {"x": px(x), "y": px(y), "w": max(px(w), 0.5), "h": max(px(h), 0.5),
                "rot": round(rot, 2), "flipH": fh, "flipV": fv}

    def _name(self, el):
        c = el.find(".//p:cNvPr", NS)
        return (c.get("descr") or c.get("name") or "") if c is not None else ""

    def group(self, el, tf, locked, prefix):
        g = el.find("p:grpSpPr/a:xfrm", NS)
        if g is None:
            return self.walk(el, tf, locked, prefix)
        off, ext = g.find("a:off", NS), g.find("a:ext", NS)
        choff, chext = g.find("a:chOff", NS), g.find("a:chExt", NS)
        ox, oy = int(off.get("x")), int(off.get("y"))
        ex, ey = int(ext.get("cx")) or 1, int(ext.get("cy")) or 1
        cx0, cy0 = (int(choff.get("x")), int(choff.get("y"))) if choff is not None else (ox, oy)
        cw, ch = (int(chext.get("cx")) or 1, int(chext.get("cy")) or 1) if chext is not None else (ex, ey)
        sx, sy = ex / cw, ey / ch

        def inner(x, y, w, h, _tf=tf):
            nx, ny, nw, nh = ox + (x - cx0) * sx, oy + (y - cy0) * sy, w * sx, h * sy
            return _tf(nx, ny, nw, nh) if _tf else (nx, ny, nw, nh)
        self.walk(el, inner, locked, prefix + self._name(el) + " / ")

    def shape(self, el, tf, locked, prefix, connector=False):
        key = _ph_key(el)
        sppr = el.find("p:spPr", NS)
        xf = _xfrm(sppr.find("a:xfrm", NS)) if sppr is not None else None
        lay_ph = _find_ph(self.layout_root, key) if key else None
        mas_ph = _find_ph(self.master_root, key) if key else None
        if xf is None:
            for src in (lay_ph, mas_ph):
                if src is not None:
                    xf = _xfrm(src.find("p:spPr/a:xfrm", NS))
                    if xf:
                        break
        if xf is None:
            return
        piece = {"kind": "shape", "name": prefix + self._name(el), "locked": locked}
        piece.update(self._box(xf, tf))
        geom = sppr.find("a:prstGeom", NS) if sppr is not None else None
        prst = geom.get("prst") if geom is not None else ("rect" if sppr is None or sppr.find("a:custGeom", NS) is None else "custom")
        piece["geom"] = prst
        if prst == "roundRect":
            gd = geom.find("a:avLst/a:gd", NS)
            adj = 16667
            if gd is not None:
                m = re.search(r"val\s+(\d+)", gd.get("fmla", ""))
                adj = int(m.group(1)) if m else adj
            piece["radius"] = round(min(piece["w"], piece["h"]) * adj / 100000.0, 2)
        # fill & line: own → style ref → placeholder inheritance
        f = fill_of(sppr, self.ctx)
        ln = line_of(sppr, self.ctx)
        style = el.find("p:style", NS)
        if f is None and style is not None:
            fr = style.find("a:fillRef", NS)
            if fr is not None and fr.get("idx") != "0":
                c, a = color_of(fr, self.ctx)
                f = {"color": c, "alpha": a} if c else None
        if ln is None and style is not None and (sppr is None or sppr.find("a:ln/a:noFill", NS) is None):
            lr = style.find("a:lnRef", NS)
            if lr is not None and lr.get("idx") != "0" and connector:
                c, a = color_of(lr, self.ctx)
                ln = {"color": c, "alpha": a, "w": 1.5, "dash": None} if c else None
        if f and not f.get("none"):
            piece["fill"] = f
        if ln:
            piece["line"] = ln
        if connector or prst in ("line", "straightConnector1", "bentConnector3"):
            piece["kind"] = "line"
            if not ln:
                return
        # text with inheritance: master txStyles → master ph → layout ph → own
        chain, body_chain = [], []
        if key:
            t = key["type"]
            chain.append(self.styles.get("title" if t in ("title", "ctrTitle") else
                                         "body" if t in ("body", "subTitle", "obj") else "other"))
            for src in (mas_ph, lay_ph):
                if src is not None:
                    body_chain.append(src.find("p:txBody/a:bodyPr", NS))
                    chain.append(src.find("p:txBody/a:lstStyle", NS))
                    # layout placeholders often set props on their sample paragraph only
                    chain.append(_para_as_lst(src.find("p:txBody/a:p", NS)))
        else:
            chain.append(self.styles.get("other"))
        if style is not None:
            fref = style.find("a:fontRef", NS)
            fc, _ = color_of(fref, self.ctx) if fref is not None else (None, None)
            if fc:
                chain.insert(1, _color_lst(fc))
        tx = text_of(el.find("p:txBody", NS), self.ctx, chain, self.slide_no, body_chain)
        if tx:
            piece["text"] = tx
            if key and key["type"] in ("title", "ctrTitle"):
                piece["role"] = "title"
        if not tx and not piece.get("fill") and not piece.get("line"):
            return
        if key and key["type"] in ("sldNum", "ftr", "dt"):
            piece["locked"] = True
        self.pieces.append(piece)

    def picture(self, el, tf, locked, prefix):
        sppr = el.find("p:spPr", NS)
        xf = _xfrm(sppr.find("a:xfrm", NS)) if sppr is not None else None
        if xf is None:
            return
        blip = el.find(".//a:blip", NS)
        rid = blip.get(R_EMBED) if blip is not None else None
        target = self.rels.get(rid, (None,))[0] if rid else None
        piece = {"kind": "pic", "name": prefix + self._name(el), "locked": locked}
        piece.update(self._box(xf, tf))
        if target and target.lower().endswith(WEB_IMG):
            piece["src"] = self.media_cb(target)
        else:
            piece["kind"] = "shape"
            piece["geom"] = "rect"
            piece["fill"] = {"color": "#334450", "alpha": .35}
            piece["text"] = {"anchor": "ctr", "insets": [6, 6, 6, 6], "wrap": True,
                             "paras": [{"align": "ctr", "runs": [{"t": "[picture: %s]" % os.path.basename(target or "?"),
                                                                    "size": 12, "color": "#cfd8dc"}]}]}
        geom = sppr.find("a:prstGeom", NS)
        if geom is not None and geom.get("prst") in ("ellipse", "roundRect"):
            piece["geom"] = geom.get("prst")
        self.pieces.append(piece)

    def frame(self, el, tf, locked, prefix):
        xf = _xfrm(el.find("p:xfrm", NS))
        if xf is None:
            return
        gd = el.find("a:graphic/a:graphicData", NS)
        if gd is None:
            return
        uri = gd.get("uri", "")
        piece = {"name": prefix + self._name(el), "locked": locked}
        piece.update(self._box(xf, tf))
        if uri.endswith("/table"):
            tbl = gd.find("a:tbl", NS)
            piece["kind"] = "table"
            piece["table"] = parse_table(tbl, self.ctx, [self.styles.get("other")])
        elif uri.endswith("/chart"):
            c = gd.find("c:chart", NS)
            target = self.rels.get(c.get(R_ID), (None,))[0] if c is not None else None
            ch = parse_chart(self.pkg, target, self.ctx) if target else None
            if not ch:
                return
            piece["kind"] = "chart"
            piece["chart"] = ch
        else:
            # SmartArt / OLE: show as a labelled panel rather than silently dropping it
            piece["kind"] = "shape"
            piece["geom"] = "rect"
            piece["fill"] = {"color": "#334450", "alpha": .3}
            piece["text"] = {"anchor": "ctr", "insets": [6, 6, 6, 6], "wrap": True,
                             "paras": [{"align": "ctr", "runs": [{"t": "[%s]" % (uri.rsplit("/", 1)[-1] or "object"),
                                                                    "size": 13, "color": "#cfd8dc"}]}]}
        self.pieces.append(piece)


def _color_lst(hexcol):
    """A pseudo lstStyle that only sets the run colour on every level."""
    fake = ET.Element(q("a:lstStyle"))
    for lv in range(1, 10):
        d = ET.SubElement(ET.SubElement(fake, q("a:lvl%dpPr" % lv)), q("a:defRPr"))
        ET.SubElement(ET.SubElement(d, q("a:solidFill")), q("a:srgbClr")).set("val", hexcol.lstrip("#"))
    return fake


def _para_as_lst(p):
    """Wrap a sample paragraph's pPr/endParaRPr as a pseudo lvl1pPr so it can join the chain."""
    if p is None:
        return None
    pp = p.find("a:pPr", NS)
    ep = p.find("a:endParaRPr", NS)
    fake = ET.Element(q("a:lstStyle"))
    lvl = ET.SubElement(fake, q("a:lvl1pPr"))
    if pp is not None:
        for k, v in pp.attrib.items():
            lvl.set(k, v)
    if ep is not None and ep.get("sz"):
        d = ET.SubElement(lvl, q("a:defRPr"))
        d.set("sz", ep.get("sz"))
    return fake


def _bg(pkg, parts, ctx, media_cb):
    """parts: [(root, part)] slide → layout → master; first one with a background wins."""
    for root, part in parts:
        if root is None:
            continue
        bg = root.find("p:cSld/p:bg", NS)
        if bg is None:
            continue
        bp = bg.find("p:bgPr", NS)
        if bp is not None:
            bl = bp.find("a:blipFill/a:blip", NS)
            if bl is not None:
                tgt = pkg.rels(part).get(bl.get(R_EMBED), (None,))[0]
                if tgt and tgt.lower().endswith(WEB_IMG):
                    return {"image": media_cb(tgt), "color": "#000000"}
            f = fill_of(bp, ctx)
            if f and not f.get("none"):
                return {"color": f["color"], "grad": f.get("grad"), "angle": f.get("angle")}
        br = bg.find("p:bgRef", NS)
        if br is not None:
            c, _ = color_of(br, ctx)
            if c:
                return {"color": c}
    return {"color": "#ffffff"}


def _plain_text(tx):
    if not tx:
        return ""
    return "\n".join("".join(r.get("t", "") for r in p.get("runs", [])) for p in tx.get("paras", [])).strip()


# ---------------------------------------------------------------- deck
def parse_deck(path, media_url=lambda part: part):
    pkg = Package(path)
    pres_part = "ppt/presentation.xml"
    pres = pkg.xml(pres_part)
    if pres is None:
        raise ValueError("not a PowerPoint file (no ppt/presentation.xml)")
    sz = pres.find("p:sldSz", NS)
    W = px(sz.get("cx")) if sz is not None else 1280.0
    H = px(sz.get("cy")) if sz is not None else 720.0
    prels = pkg.rels(pres_part)
    slides = []
    order = [s.get(R_ID) for s in pres.findall("p:sldIdLst/p:sldId", NS)]
    n = 0
    for rid in order:
        part = prels.get(rid, (None,))[0]
        root = pkg.xml(part) if part else None
        if root is None or root.get("show") == "0":
            continue
        n += 1
        layout_part = pkg.rel_of_type(part, "slideLayout")
        layout = pkg.xml(layout_part) if layout_part else None
        master_part = pkg.rel_of_type(layout_part, "slideMaster") if layout_part else None
        master = pkg.xml(master_part) if master_part else None
        theme_part = pkg.rel_of_type(master_part, "theme") if master_part else None
        theme = Theme(pkg.xml(theme_part) if theme_part else None)
        clrmap = {}
        cm = master.find("p:clrMap", NS) if master is not None else None
        if cm is not None:
            clrmap = dict(cm.attrib)
        ctx = Ctx(theme, clrmap)
        styles = {}
        if master is not None:
            for k, tag in (("title", "p:txStyles/p:titleStyle"), ("body", "p:txStyles/p:bodyStyle"),
                           ("other", "p:txStyles/p:otherStyle")):
                styles[k] = master.find(tag, NS)
        pieces = []
        # master + layout decoration (non-placeholder shapes) sit BEHIND the slide's own
        show_master = root.get("showMasterSp") != "0"
        for deco_root, deco_part, flag in ((master, master_part, show_master and (layout is None or layout.get("showMasterSp") != "0")),
                                           (layout, layout_part, show_master)):
            if deco_root is None or not flag:
                continue
            tree = deco_root.find("p:cSld/p:spTree", NS)
            sp = SlideParser(pkg, deco_part, ctx, None, None, styles, media_url, n)
            sp.walk([e for e in tree if not (e.tag == q("p:sp") and _ph_key(e))], locked=True)
            pieces += sp.pieces
        sp = SlideParser(pkg, part, ctx, layout.find("p:cSld/p:spTree", NS) if layout is not None else None,
                         master.find("p:cSld/p:spTree", NS) if master is not None else None,
                         styles, media_url, n)
        sp.walk(root.find("p:cSld/p:spTree", NS))
        pieces += sp.pieces
        pieces = [p for p in pieces if p.get("kind") != "error"]
        for i, p in enumerate(pieces):
            p["id"] = "s%d-%d" % (n, i)
            # a piece that covers ~the whole slide is backdrop, not something to grab
            if p.get("w", 0) * p.get("h", 0) > W * H * .85:
                p["locked"] = True
        title = next((_plain_text(p.get("text")) for p in pieces if p.get("role") == "title"), "")
        notes = ""
        np_ = pkg.rel_of_type(part, "notesSlide")
        nr = pkg.xml(np_) if np_ else None
        if nr is not None:
            for s in nr.iter(q("p:sp")):
                k = _ph_key(s)
                if k and k["type"] == "body":
                    notes = _plain_text(text_of(s.find("p:txBody", NS), ctx, []))
        slides.append({"n": n, "title": title.replace("\n", " "), "notes": notes,
                       "bg": _bg(pkg, [(root, part), (layout, layout_part), (master, master_part)], ctx, media_url),
                       "pieces": pieces})
    return {"name": os.path.basename(path), "w": W, "h": H, "slides": slides}


def read_media(path, part):
    """Bytes of one media part inside the .pptx (only ppt/… parts, only images)."""
    if not part.startswith("ppt/") or ".." in part or not part.lower().endswith(WEB_IMG):
        return None
    with zipfile.ZipFile(path) as z:
        if part not in z.namelist():
            return None
        return z.read(part)


if __name__ == "__main__":
    import json
    import sys
    d = parse_deck(sys.argv[1])
    if "--json" in sys.argv:
        print(json.dumps(d, indent=1))
    else:
        print(d["name"], d["w"], "x", d["h"], "px,", len(d["slides"]), "slides")
        for s in d["slides"]:
            kinds = {}
            for p in s["pieces"]:
                kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
            print("%3d  %-48s %s" % (s["n"], s["title"][:48], kinds))
