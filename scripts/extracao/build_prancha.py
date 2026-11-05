# Monta data/prancha.json: o desenho fixo da prancha (moldura, título, quadros, legenda, Grande SP, carimbo)
# e, para cada estação, o símbolo e o rótulo originais do DWG. Uso: python3 build_prancha.py <repo>
import json, math, sys
sys.argv += []
exec(open('prancha_prims.py').read().split("if __name__ == '__main__':")[0])
REPO = sys.argv[1]
OFF = {o['name'] for o in objs if o.get('object') == 'LAYER' and (o.get('flag0', 0) & 2)}
MS = [o for o in objs if o.get('entity') and o.get('ownerhandle', [0, 0, 0, 0])[-1] == 0 and o['entity'] not in ('BLOCK', 'ENDBLK', 'VIEWPORT')]
for o in MS:
    if lname(o) in OFF: continue
    draw(o, I, '#000000', {})
X0, X1, Y0, Y1 = 4347.272006368339, 5188.272006368339, 242.15549884844887, 836.155498848449
est = json.load(open(REPO + '/data/estacoes.json'))
NONSYM = {'Contorno do mapa', 'Contornos municípios', 'Contorno Grande S.Paulo', 'Legenda', '0', 'Telefonica (infra-estrutura)', 'Geradora Rio Claro', 'MAPA CONTORNO', 'Contorno Gde. São Paulo'}
def legend(x, y): return x < 4600 and y < 490
def inset(x, y): return x > 4915 and y > 645
def pts(p):
    if p['k'] == 'p': return p['pts']
    if p['k'] == 'f': return [q for r in p['rings'] for q in r]
    return [(p['x'], p['y'])]
R = lambda v: round(v, 2)
def flat(ps): return [R(c) for q in ps for c in q]
def compact(p):
    k = p['k']
    if k == 'p': return ['p', p['c'], round(p['w'], 2), 1 if p.get('z') else 0, flat(p['pts'])] + ([p['d']] if p.get('d') else [])
    if k == 'c': return ['c', p['c'], round(p['w'], 2), R(p['x']), R(p['y']), R(p['r'])]
    if k == 'f': return ['f', p['c'], [flat(r) for r in p['rings']]]
    if k == 't': return ['t', R(p['x']), R(p['y']), R(p['s']), p['a'], round(p['r'], 2), p['ls'], p['lines'], R(p.get('rw') or 0)]
static, st, alab, atual, dropped = [], {}, [], None, 0
byLab = {(round(v['lx'], 2), round(v['ly'], 2)): k for k, v in est.items() if v.get('lx') is not None}
for p in prims:
    if p['k'] == 'f' and (p['l'] == 'MAPA CONTORNO' or p.get('h') == 360446): dropped += 1; continue
    if p['l'] == 'Geradora Rio Claro': p['c'] = '#000000'
    ps = pts(p)
    if not all(X0 - 1 <= x <= X1 + 1 and Y0 - 1 <= y <= Y1 + 1 for x, y in ps): dropped += 1; continue
    if p['k'] == 't':
        t = ' '.join(''.join(s[0] for s in ln) for ln in p['lines'])
        if 'Atualiza' in t: atual = compact(p); continue
        if t.strip().startswith('ÁREA') and not legend(p['x'], p['y']) and not inset(p['x'], p['y']):
            alab.append({'x': R(p['x']), 'y': R(p['y']), 's': p['s'], 'a': p['a'], 'c': p['lines'][0][0][1], 'n': int(''.join(ch for ch in t.split('/')[0] if ch.isdigit())[:1] or 0)}); continue
        k = byLab.get((round(p['x'], 2), round(p['y'], 2)))
        if k: st.setdefault(k, {'sym': [], 'lab': []})['lab'].append(compact(p)); continue
        static.append(compact(p)); continue
    if p['l'] == 'Contorno do mapa' and p['c'] == '#ff0000': continue  # linhas de divisão: desenhadas pelo sistema
    if p['l'] not in NONSYM:
        cx = sum(x for x, y in ps) / len(ps); cy = sum(y for x, y in ps) / len(ps)
        if not legend(cx, cy) and not inset(cx, cy):
            best, bk = 7.0, None
            for k, v in est.items():
                d = math.hypot(v['x'] - cx, v['y'] - cy)
                if d < best: best, bk = d, k
            if bk: st.setdefault(bk, {'sym': [], 'lab': []})['sym'].append(compact(p)); continue
    static.append(compact(p))
for k, v in st.items():
    e = est[k]; v.update(x0=R(e['x']), y0=R(e['y']), r=e.get('r'), m=e.get('m'), pm=e.get('pm', 0))
    if e.get('lx') is not None: v.update(lx0=R(e['lx']), ly0=R(e['ly']))
# itens da legenda que não entram na prancha: infraestrutura telefônica, repetidoras, estações, enlaces,
# infra, quadro de equipamentos e contagem "SP - n - estações"
def centro(p):
    f = p[4] if p[0] == 'p' else [c for r in p[2] for c in r] if p[0] == 'f' else [p[3], p[4]] if p[0] == 'c' else [p[1], p[2]]
    return sum(f[0::2]) / len(f[0::2]), sum(f[1::2]) / len(f[1::2])
def fora_da_prancha(p):
    if p[0] in ('p', 'f', 'c') and p[1] == '#5b5b5b': return False  # contorno do estado
    x, y = centro(p)
    if p[0] == 't':
        t = ' '.join(''.join(s[0] for s in ln) for ln in p[7])
        if t.startswith('LEGENDA:'):
            titulo = p[7][0]; keep = False
            for i, ln in enumerate(p[7]):
                lt = ''.join(s[0] for s in ln)
                if 'CANAL VIRTUAL' in lt:
                    keep = True
                    if i >= 2: p[7][i - 2] = titulo  # "LEGENDA:" desce para logo acima do que ficou
                if not keep and p[7][i] is not titulo: p[7][i] = []
            if p[7][0] is titulo and any(l is titulo for l in p[7][1:]): p[7][0] = []
            return False
    return (4395 < x < 4600 and 340 < y < 520) or (4580 < x < 4700 and 255 < y < 340)
static = [p for p in static if not fora_da_prancha(p)]
out = {'box': [R(X0), R(Y0), R(X1), R(Y1)], 'static': static, 'st': st, 'alab': alab, 'atual': atual}
json.dump(out, open(REPO + '/data/prancha.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('static', len(static), 'estações com símbolo', sum(1 for v in st.values() if v['sym']), 'com rótulo', sum(1 for v in st.values() if v['lab']), 'áreas', len(alab), 'descartados', dropped)
print('sem símbolo:', [est[k]['n'] for k in est if k not in st or not st[k]['sym']])
