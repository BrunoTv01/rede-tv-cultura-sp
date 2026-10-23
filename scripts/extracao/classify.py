import pickle,math,collections
exec(open('clean.py').read())
labels,stations,M,special=pickle.load(open('m3.pkl','rb'))
layci={o['handle'][-1]:o['color'] for o in objs if o.get('object')=='LAYER'}
def colr(o):
    c=o['color']; i=c.get('index')
    if c.get('rgb','000000') not in ('000000',) and str(c.get('rgb','')).startswith('c2'): return 'rgb'+c['rgb'][2:]
    if i in (256,None):
        lc=layci.get(o['layer'][-1],{}); r=lc.get('rgb','')
        return int(r[-2:],16) if r.startswith('c3') else r
    return i
def pts_of(o):
    e=o['entity']
    if e in('CIRCLE','ARC'): return [o['center'][:2]]
    if e=='LINE': return [o['start'][:2],o['end'][:2]]
    if e=='LWPOLYLINE': return [q[:2] for q in o['points']]
    if e=='HATCH':
        return [q['point'][:2] for p in o.get('paths',[]) for q in (p.get('polyline_paths') or [])]
    return []
SX=[(s['x'],s['y']) for s in stations]
def owner(ps):
    cx=sum(p[0] for p in ps)/len(ps); cy=sum(p[1] for p in ps)/len(ps)
    j=min(range(len(SX)),key=lambda k:math.dist(SX[k],(cx,cy)))
    return j, math.dist(SX[j],(cx,cy))
groups=collections.defaultdict(list)
for o in objs:
    if not o.get('entity') or o.get('ownerhandle',[0,0,0,0])[-1]!=0: continue
    if o['entity'] not in ('CIRCLE','ARC','LINE','LWPOLYLINE','HATCH'): continue
    if L(o) in ('Contorno do mapa','Contorno divisão regional','Contornos municípios','Contorno Grande S.Paulo','MAPA CONTORNO','Legenda','Regional','Enlace UHF'): continue
    ps=pts_of(o)
    if not ps: continue
    j,d=owner(ps)
    if d<6: groups[j].append(o)
def inner(s,g):
    cx,cy=s['x'],s['y']
    kinds=set()
    for o in g:
        ps=pts_of(o)
        if o['entity']=='HATCH':
            pp=[q for p in o['paths'] for q in (p.get('polyline_paths') or [])]
            if len(pp)==2 and all(abs(math.dist(q['point'][:2],(cx,cy))-s['r'])<0.4 for q in pp):
                b=[q['bulge'] for q in pp]
                if all(abs(abs(x)-1)<0.05 for x in b): kinds.add('full')
                else:
                    # half: which side
                    kinds.add('half')
        if o['entity']=='LINE' and all(math.dist(p,(cx,cy))<s['r']+0.3 for p in ps) and math.dist(ps[0],ps[1])>1.5*s['r']:
            kinds.add('vline' if abs(ps[0][0]-ps[1][0])<0.3 else 'hline')
    if 'full' in kinds: return 'full'
    if 'vline' in kinds and 'hline' in kinds: return 'cross'
    if 'half' in kinds: return 'half'
    if 'hline' in kinds: return 'line'
    return 'open'
rows=[]
for i,j in M.items():
    s=stations[j]; g=groups[j]
    cols=collections.Counter((L(o),o['entity'],colr(o)) for o in g)
    rows.append((labels[i]['t'].split('\n')[0],labels[i]['lay'],inner(s,g),sorted(set(str(k[2]) for k in cols)), sorted(set(k[0] for k in cols))))
for r in sorted(rows,key=lambda r:(r[1],r[0])): print(r)
pickle.dump((groups,),open('groups.pkl','wb'))
