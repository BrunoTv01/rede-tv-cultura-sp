# Converte o espaço do modelo do DWG (JSON do LibreDWG) em primitivas simples para desenhar em SVG.
import json, math, re, colorsys, sys
d = json.load(open('m2.json'))
objs = d['OBJECTS']
H = {o['handle'][-1]: o for o in objs if 'handle' in o}
LAY = {o['handle'][-1]: o for o in objs if o.get('object') == 'LAYER'}
LTS = (d.get('HEADER', {}).get('LTSCALE') or 1.0)
LT = {o['handle'][-1]: [x.get('length') for x in (o.get('dashes') or [])] for o in objs if o.get('object') == 'LTYPE'}
def dashes(o, sc):
    h = (o.get('ltype') or [0, 0, 0, 0])[-1]
    pat = LT.get(h)
    if not pat and (o.get('ltype_flags', 0) == 0):  # ByLayer
        l = layer_of(o); pat = LT.get((l.get('ltype') or [0, 0, 0, 0])[-1]) if l else None
    if not pat: return None
    k = LTS * (o.get('ltype_scale') or 1) * sc
    return [round(max(abs(x) * k, .05), 3) for x in pat if x]

def aci(i):
    base = {1: (255, 0, 0), 2: (255, 255, 0), 3: (0, 255, 0), 4: (0, 255, 255), 5: (0, 0, 255), 6: (255, 0, 255), 7: (0, 0, 0), 8: (128, 128, 128), 9: (192, 192, 192)}
    if i in base: return '#%02x%02x%02x' % base[i]
    if 250 <= i <= 255:
        g = [51, 91, 132, 173, 214, 255][i - 250]; return '#%02x%02x%02x' % (g, g, g)
    if 10 <= i <= 249:
        h = ((i // 10) - 1) * 15 / 360; k = i % 10
        v = [1, 1, .8, .8, .6, .6, .5, .5, .3, .3][k]; s = 1 if k % 2 == 0 else .5
        r, g, b = colorsys.hsv_to_rgb(h, s, v); return '#%02x%02x%02x' % (int(r * 255), int(g * 255), int(b * 255))
    return '#000000'

def colof(c, layer_o, parent=None):
    if not c: c = {}
    idx = c.get('index'); rgb = c.get('rgb') or ''
    if idx is None and 'rgb' in c and len(rgb) >= 6: return '#' + rgb[-6:]
    if idx == 256 or idx is None:
        lc = layer_o.get('color', {}) if layer_o else {}
        li = lc.get('index'); lr = lc.get('rgb') or ''
        if li in (None, 256) and len(lr) == 8 and lr[:2] == 'c2': return '#' + lr[2:]
        if li in (None, 256) and len(lr) == 8 and lr[:2] == 'c3': return aci(int(lr[-2:], 16))
        return aci(abs(li or 7))
    if idx == 0: return parent or '#000000'
    if len(rgb) == 8 and rgb[:2] == 'c2': return '#' + rgb[2:]
    return aci(idx)

def layer_of(o): return LAY.get(o.get('layer', [0, 0, 0, 0])[-1])
def lname(o):
    l = layer_of(o); return l['name'] if l else '?'
def frozen(o):
    l = layer_of(o)
    if not l: return False
    f = l.get('flag0', 0)
    return bool(f & 1) or (l.get('color', {}).get('index', 1) or 1) < 0 or l.get('off') or l.get('frozen')

def lw(o):
    w = o.get('linewt', 29)
    if w is None or w >= 29 or w < 0:
        l = layer_of(o); w = l.get('linewt', 31) if l else 31
    table = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211]
    if 0 <= w < len(table): return table[w] / 100  # mm
    return 0.25

def bulge_pts(p0, p1, b, n=8):
    if not b: return [p1]
    x0, y0 = p0; x1, y1 = p1
    th = 4 * math.atan(b); c = math.dist(p0, p1)
    if c == 0: return [p1]
    r = c / (2 * math.sin(th / 2))
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    h = r * math.cos(th / 2)
    ux, uy = (x1 - x0) / c, (y1 - y0) / c
    cx, cy = mx - uy * h, my + ux * h
    a0 = math.atan2(y0 - cy, x0 - cx)
    out = []
    for i in range(1, n + 1):
        a = a0 + th * i / n; out.append((cx + abs(r) * math.cos(a) * (1 if r > 0 else 1), cy + abs(r) * math.sin(a)))
    out[-1] = (x1, y1)
    return out

def clean_mtext(t):
    # devolve linhas [(texto, cor, negrito, escala)]
    col = None; bold = False; sc = 1.0
    m = re.search(r'\\C(\d+);', t); col = int(m.group(1)) if m else None
    bold = bool(re.search(r'\|b1', t))
    m = re.search(r'\\H([\d.]+)x;', t); sc = float(m.group(1)) if m else 1.0
    t = t.replace('\\P', '\n')
    t = re.sub(r'\\[fF][^;]*;', '', t); t = re.sub(r'\\[CHWQTAc][^;\\]*;', '', t)
    t = re.sub(r'\\S([^;]*);', lambda m: m.group(1).replace('^', '/').replace('#', '/'), t)
    t = re.sub(r'\\[LlOoK]', '', t); t = t.replace('{', '').replace('}', '').replace('\\~', ' ').replace('%%c', 'Ø').replace('%%d', '°')
    t = re.sub(r'\\U\+([0-9A-Fa-f]{4})', lambda m: chr(int(m.group(1), 16)), t)
    lines = [x.rstrip() for x in t.split('\n')]
    while lines and not lines[-1].strip(): lines.pop()
    return lines, col, bold, sc

def mtext_rich(t, base=1.0):
    # linhas com cor/negrito/altura próprias (o DWG mistura formatação dentro do texto)
    out = []; cur = []; state = {'c': None, 'b': False, 'h': 1.0}; stack = []
    i = 0; buf = ''
    def flush():
        nonlocal buf
        if buf: cur.append((buf, state['c'], state['b'], state['h'])); buf = ''
    while i < len(t):
        ch = t[i]
        if ch == '{': flush(); stack.append(dict(state)); i += 1; continue
        if ch == '}': flush(); state = stack.pop() if stack else state; i += 1; continue
        if ch == '\\' and i + 1 < len(t):
            k = t[i + 1]
            if k == 'P': flush(); out.append(cur); cur = []; i += 2; continue
            if k in 'fF':
                j = t.find(';', i); seg = t[i:j]; flush(); state['b'] = '|b1' in seg; i = j + 1; continue
            if k == 'C':
                j = t.find(';', i); flush(); state['c'] = int(t[i + 2:j] or 0); i = j + 1; continue
            if k == 'c':
                j = t.find(';', i); flush(); state['rgb'] = int(t[i + 2:j] or 0); i = j + 1; continue
            if k == 'H':
                j = t.find(';', i); v = t[i + 2:j]; flush()
                try: state['h'] = state['h'] * float(v[:-1]) if v.endswith(('x', 'X')) else float(v) / base
                except: pass
                i = j + 1; continue
            if k in 'WQTAp':
                j = t.find(';', i); i = j + 1; continue
            if k == 'S':
                j = t.find(';', i); buf += t[i + 2:j].replace('^', '/').replace('#', '/'); i = j + 1; continue
            if k in 'LlOoKk': i += 2; continue
            if k == '~': buf += ' '; i += 2; continue
            if k == 'U' and t[i + 2] == '+': buf += chr(int(t[i + 3:i + 7], 16)); i += 7; continue
            buf += t[i + 1]; i += 2; continue
        buf += ch; i += 1
    flush(); out.append(cur)
    while out and not ''.join(s for s, *_ in out[-1]).strip(): out.pop()
    return out

prims = []
def emit(p): prims.append(p)

def tf(M, x, y): return (M[0] * x + M[1] * y + M[2], M[3] * x + M[4] * y + M[5])
def mul(A, B):
    return [A[0] * B[0] + A[1] * B[3], A[0] * B[1] + A[1] * B[4], A[0] * B[2] + A[1] * B[5] + A[2],
            A[3] * B[0] + A[4] * B[3], A[3] * B[1] + A[4] * B[4], A[3] * B[2] + A[4] * B[5] + A[5]]
I = [1, 0, 0, 0, 1, 0]

def draw(o, M, pcol, meta):
    e = o.get('entity')
    if not e or frozen(o) or o.get('invisible'): return
    col = colof(o.get('color'), layer_of(o), pcol)
    L = lname(o)
    base = dict(meta, l=L, h=o['handle'][-1])
    W = lw(o)
    sc = math.hypot(M[0], M[3])
    if e == 'LINE':
        a = tf(M, *o['start'][:2]); b = tf(M, *o['end'][:2]); emit(dict(base, k='p', c=col, w=W, pts=[a, b], d=dashes(o, sc)))
    elif e == 'LWPOLYLINE':
        pts = [tuple(p[:2]) for p in o['points']]; bul = o.get('bulges') or [0] * len(pts)
        closed = bool(o.get('flag', 0) & 512) or bool(o.get('flag', 0) & 1)
        out = [pts[0]]
        n = len(pts)
        for i in range(n - 1 + (1 if closed else 0)):
            out += bulge_pts(pts[i], pts[(i + 1) % n], bul[i] if i < len(bul) else 0)
        cw = o.get('const_width') or 0
        emit(dict(base, k='p', c=col, w=max(W, cw * sc), pts=[tf(M, *p) for p in out], z=closed, d=dashes(o, sc)))
    elif e == 'POLYLINE_2D':
        vs = [H.get(v[-1]) for v in o.get('vertex', [])]
        pts = [tuple(v['point'][:2]) for v in vs if v and v.get('point')]
        if pts: emit(dict(base, k='p', c=col, w=W, pts=[tf(M, *p) for p in pts], z=bool(o.get('flag', 0) & 1)))
    elif e == 'CIRCLE':
        cx, cy = tf(M, *o['center'][:2]); emit(dict(base, k='c', c=col, w=W, x=cx, y=cy, r=o['radius'] * sc))
    elif e == 'ARC':
        cx, cy = o['center'][:2]; r = o['radius']; a0 = o['start_angle']; a1 = o['end_angle']
        if a1 < a0: a1 += 2 * math.pi
        n = max(6, int((a1 - a0) / 0.15))
        pts = [tf(M, cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
        emit(dict(base, k='p', c=col, w=W, pts=pts))
    elif e == 'HATCH':
        if not o.get('is_solid_fill'): return
        rings = []
        for p in o.get('paths', []):
            if p.get('polyline_paths'):
                pp = p['polyline_paths']; pts = [tuple(pp[0]['point'][:2])]
                for i in range(len(pp)):
                    q0 = tuple(pp[i]['point'][:2]); q1 = tuple(pp[(i + 1) % len(pp)]['point'][:2])
                    pts += bulge_pts(q0, q1, pp[i].get('bulge', 0))
                rings.append([tf(M, *q) for q in pts])
            elif p.get('segs'):
                pts = []
                for s in p['segs']:
                    if 'first_endpoint' in s and 'second_endpoint' in s:
                        if not pts: pts.append(tuple(s['first_endpoint'][:2]))
                        pts.append(tuple(s['second_endpoint'][:2]))
                    elif 'center' in s:
                        cx, cy = s['center'][:2]; r = s.get('radius', 0); a0 = s.get('start_angle', 0); a1 = s.get('end_angle', 0)
                        ccw = s.get('is_ccw', 1)
                        if ccw and a1 < a0: a1 += 2 * math.pi
                        if not ccw:
                            a0, a1 = -a0, -a1
                            if a1 > a0: a1 -= 2 * math.pi
                        n = max(6, int(abs(a1 - a0) / 0.15))
                        pts += [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
                    elif 'control_points' in s:
                        pts += [tuple(c['point'][:2] if isinstance(c, dict) else c[:2]) for c in s['control_points']]
                if pts: rings.append([tf(M, *q) for q in pts])
        hc = col
        if o.get('colors') and o.get('is_gradient_fill'): pass
        if rings: emit(dict(base, k='f', c=hc, rings=rings))
    elif e == 'MTEXT':
        x, y = tf(M, *o['ins_pt'][:2]); hgt = o.get('text_height', 2.5) * sc
        xd = o.get('x_axis_dir', [1, 0, 0]); rot = math.degrees(math.atan2(xd[1], xd[0]))
        lines = mtext_rich(o.get('text', ''), o.get('text_height', 2.5) or 2.5)
        L2 = []
        for ln in lines:
            segs = []
            for s, c, b, hh in ln:
                cc = col if c in (None, 256) else (pcol if c == 0 else aci(c))
                segs.append([s, cc, 1 if b else 0, round(hh, 3)])
            L2.append(segs)
        emit(dict(base, k='t', x=x, y=y, s=hgt, a=o.get('attachment', 1), r=rot, ls=o.get('linespace_factor', 1) or 1, lines=L2, rw=o.get('rect_width', 0) * sc))
    elif e == 'TEXT':
        x, y = tf(M, *o['ins_pt'][:2]); hgt = o.get('height', 2.5) * sc
        emit(dict(base, k='t', x=x, y=y - 0 * hgt, s=hgt, a=7, r=math.degrees(o.get('rotation', 0)), ls=1, lines=[[[o.get('text_value', ''), col, 0, 1]]], rw=0))
    elif e == 'INSERT':
        b = H.get(o['block_header'][-1])
        if not b: return
        sx, sy = o['scale'][:2]; rot = o.get('rotation', 0); ix, iy = o['ins_pt'][:2]
        bp = b.get('base_pt', [0, 0, 0])[:2]
        c, s = math.cos(rot), math.sin(rot)
        T = [c * sx, -s * sy, ix, s * sx, c * sy, iy]
        T = mul(T, [1, 0, -bp[0], 0, 1, -bp[1]])
        M2 = mul(M, T)
        for eh in b.get('entities', []) or []:
            ch = H.get(eh[-1])
            if ch: draw(ch, M2, col, dict(meta, ins=o['handle'][-1]))

if __name__ == '__main__':
    MS = [o for o in objs if o.get('entity') and o.get('ownerhandle', [0, 0, 0, 0])[-1] == 0 and o['entity'] not in ('BLOCK', 'ENDBLK', 'VIEWPORT')]
    for o in MS: draw(o, I, '#000000', {})
    json.dump(prims, open('prims.json', 'w'), ensure_ascii=False)
    print(len(prims))
