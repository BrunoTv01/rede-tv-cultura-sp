import json, math, re
from collections import defaultdict
exec(open('regions.py').read().split("A=np.array(im)")[0].split("im=Image.new")[0])  # labels, C, S, constants
R=json.load(open('reg.json')); st=R['st']; circ={int(k):v for k,v in R['circ'].items()}
e=json.load(open('/home/claude/rede-tv-cultura-sp/data/estacoes.json'))
T=lambda X,Y:((44.64+(X-4378.88)*1.41567),(17.72+(824.16-Y)*1.41558))
iT=lambda px,py:(4378.88+(px-44.64)/1.41567, 824.16-(py-17.72)/1.41558)
vtn=lambda s: (re.search(r'(\d+)',s or '') or [None,None])[1]
cvn=lambda s: str(int(s.split('.')[0]))
# círculos com mesmo CF/CV na mesma região viram um grupo só
gid={}; groups=[]
for i,(cf,cv) in enumerate(labels):
    if cf=='38D' and cv=='54.1': continue  # Brasília/Brazlândia (fora do mapa)
    key=(cf,cv,circ[i])
    if key not in gid: gid[key]=len(groups); groups.append({'cf':cf,'cv':cv,'circ':[],'st':[]})
    groups[gid[key]]['circ'].append(i)
def cand(s, cvtoo=True):
    ch=(s.get('ch') or '').upper(); v=vtn(s.get('vt'))
    return [g for g,G in enumerate(groups) if G['cf']==ch and (not cvtoo or (v is not None and int(v)==int(cvn(G['cv']))))]
semsfn=[]
for k,s in e.items():
    reg=st[k]; px,py=T(s['x'],s['y'])
    dist=lambda g:min(math.dist((px,py),C[i][:2]) for i in groups[g]['circ'])
    # 1) círculo da própria região com o mesmo canal físico
    pick=[g for g in cand(s,False) if any(circ[i]==reg for i in groups[g]['circ'])]
    if pick: groups[pick[0]]['st'].append(k); continue
    # 2) círculo mais próximo com o mesmo canal físico e virtual
    cs=cand(s)
    if cs and dist(min(cs,key=dist))<=140: groups[min(cs,key=dist)]['st'].append(k); continue
    # 3) círculo mais próximo com o mesmo canal físico (há círculos com o virtual trocado, ex.: 41D/CV14.1)
    cs=cand(s,False)
    if cs and s.get('vt') and dist(min(cs,key=dist))<=60: groups[min(cs,key=dist)]['st'].append(k); continue
    semsfn.append(s['n']+' '+str(s.get('ch'))+' '+str(s.get('vt')))
for G in groups:
    G['st'].sort(key=lambda k:-(e[k].get('pop') or 0))
    G['nome']=e[G['st'][0]]['n'] if G['st'] else ''
    print(G['cf'],G['cv'],len(G['st']),G['nome'],'|',', '.join(e[k]['n'] for k in G['st']))
print('SEM SFN:',semsfn)
json.dump(groups,open('groups.json','w'),ensure_ascii=False)
