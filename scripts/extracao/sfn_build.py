import json, math, re
groups=json.load(open('groups.json'))
S=json.load(open('strokes.json'))
C=[c for c in json.load(open('circles.json')) if c[2]>12]
iT=lambda px,py:(round(4378.88+(px-44.64)/1.41567,2), round(824.16-(py-17.72)/1.41558,2))
e=json.load(open('/home/claude/rede-tv-cultura-sp/data/estacoes.json'))
R='rgb(100%, 0%, 0%)'
def plen(sp): return sum(math.dist(a,b) for a,b in zip(sp,sp[1:]))
lines=[]
for p in S[R]:
    for sp in p['subs']:
        if len(sp)<2 or plen(sp)<=12: continue
        mx=sum(x for x,y in sp)/len(sp); my=sum(y for x,y in sp)/len(sp)
        if mx<300 and my>590: continue          # legenda
        if mx>940 and 300<my<360: continue      # quadro "Nova Divisão"
        if mx<260 and my<180: continue          # quadro de cobertura
        lines.append([iT(x,y) for x,y in sp])
out={'fonte':'MAPA DE ROTAS - SFN (AutoCAD, outubro/2025)','linhas':lines,'redes':[],'estacoes':{}}
for G in groups:
    if not G['st']: continue
    nome=f"{G['cf']} CV{G['cv']} – {G['nome']}"
    circ=[iT(*C[i][:2]) for i in G['circ']]
    out['redes'].append({'nome':nome,'cf':G['cf'],'cv':G['cv'],'circulos':circ})
    for k in G['st']: out['estacoes'][k]=nome
json.dump(out,open('/home/claude/rede-tv-cultura-sp/data/sfn.json','w'),ensure_ascii=False,separators=(',',':'))
print(len(lines),'linhas',len(out['redes']),'redes',len(out['estacoes']),'estações')
for r in out['redes']: print(r['nome'])
