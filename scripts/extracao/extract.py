exec(open('clean.py').read())
import math, collections
MS=[o for o in objs if o.get('entity') and o.get('ownerhandle',[0,0,0,0])[-1]==0]
def inmain(x,y): return 4380<x<5200 and 260<y<830
def legend(x,y): return x<4600 and y<490
def inset(x,y): return x>4915 and y>645
tris=[]
for o in MS:
    if o['entity']=='LWPOLYLINE' and len(o['points'])==3 and L(o) not in('Legenda',):
        p=o['points']; cx=sum(q[0] for q in p)/3; cy=sum(q[1] for q in p)/3
        if inmain(cx,cy) and not legend(cx,cy) and not inset(cx,cy): tris.append((cx,cy,o))
circles=[o for o in MS if o['entity']=='CIRCLE']
print('tris',len(tris))
def pts_of(o):
    e=o['entity']
    if e=='CIRCLE' or e=='ARC': return [o['center'][:2]]
    if e=='LINE': return [o['start'][:2],o['end'][:2]]
    if e=='LWPOLYLINE': return [q[:2] for q in o['points']]
    if e=='HATCH':
        r=[]
        for p in o.get('paths',[]):
            for q in p.get('polyline_paths',[]) or []: r.append(q['point'][:2])
            for s in p.get('segs',[]) or []:
                for k in ('first_endpoint','second_endpoint','center'):
                    if k in s: r.append(s[k][:2])
        return r
    return []
prims=[(o,pts_of(o)) for o in MS if o['entity'] in('CIRCLE','ARC','LINE','LWPOLYLINE','HATCH') and L(o) not in ('Contorno do mapa','Contorno divisão regional','Contornos municípios','Contorno Grande S.Paulo','MAPA CONTORNO','Legenda')]
stations=[]
for cx,cy,t in tris:
    # inner circle
    best=None
    for c in circles:
        d=math.dist(c['center'][:2],(cx,cy))
        if d<3 and (best is None or d<best[0]): best=(d,c)
    if best: px,py=best[1]['center'][:2]; r=best[1]['radius']
    else: px,py,r=cx,cy,1.5
    near=[]
    for o,ps in prims:
        if any(math.dist(q,(px,py))<6.5 for q in ps): near.append(o)
    stations.append(dict(x=px,y=py,tri=t,near=near,r=r))
json.dump([dict(x=s['x'],y=s['y']) for s in stations],open('sym.json','w'))
# labels
SKIPL={'Enlace UHF','Regional','Legenda','0','Contorno do mapa','Captação do Ar','Contorno Gde. São Paulo','Recepção Via Sat. Reserva','Telefonica (infra-estrutura)'}
labels=[]
for o in MS:
    if o['entity']!='MTEXT' or L(o) in SKIPL: continue
    x,y=o['ins_pt'][:2]
    if not inmain(x,y) or legend(x,y) or inset(x,y): continue
    raw=o.get('text','')
    if raw.startswith('{\\f@Arial Unicode MS|b0') and '\\c0;' in raw: pass
    t,cols=clean(raw)
    t=t.replace('\\c0;','')
    if 'cn' not in t and 'VT' not in t and L(o) not in ('Repetidora','Geradora','Geradora S.Paulo'): 
        print('skip',L(o),t.replace('\n','/')); continue
    w=o.get('extents_width') or 20; h=o.get('extents_height') or 10
    labels.append(dict(o=o,t=t,x=x,y=y,w=w,h=h,lay=L(o)))
print('labels',len(labels))
def bdist(l,s):
    dx=max(l['x']-s['x'],0,s['x']-(l['x']+l['w'])); dy=max(s['y']-l['y'],0,(l['y']-l['h'])-s['y'])
    return math.hypot(dx,dy)
pairs=sorted((bdist(l,s),i,j) for i,l in enumerate(labels) for j,s in enumerate(stations))
ul=set();us=set();match={}
for d,i,j in pairs:
    if i in ul or j in us or d>14: continue
    ul.add(i);us.add(j);match[i]=(j,d)
print('matched',len(match),'unmatched labels',[labels[i]['t'].replace('\n','/') for i in range(len(labels)) if i not in ul])
print('unmatched syms',[(round(stations[j]['x']),round(stations[j]['y'])) for j in range(len(stations)) if j not in us])
import pickle
pickle.dump((labels,stations,match),open('m.pkl','wb'))
for i,(j,d) in sorted(match.items(),key=lambda k:-k[1][1])[:15]: print(round(d,1),labels[i]['t'].replace('\n','/'))
