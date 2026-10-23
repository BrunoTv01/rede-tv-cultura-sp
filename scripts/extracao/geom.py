import collections,math,json,pickle
exec(open('clean.py').read())
vb=collections.defaultdict(list)
for o in objs:
    if o.get('entity')=='VERTEX_2D': vb[o['ownerhandle'][-1]].append(o['point'][:2])
MS=[o for o in objs if o.get('entity') and o.get('ownerhandle',[0,0,0,0])[-1]==0]
def P(o): return o['points'] if o['entity']=='LWPOLYLINE' else vb[o['handle'][-1]]
border=[];red=[];rmsp=[];rmspout=[];pedr=[]
for o in MS:
    if o['entity'] not in('LWPOLYLINE','POLYLINE_2D'): continue
    ly=L(o); ci=o['color'].get('index'); pts=[p[:2] for p in P(o)]
    if not pts: continue
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    if ly in('Contorno do mapa','Contornos municípios') and ci==251: border.append(pts)
    elif ly=='Contorno do mapa' and ci==1 and o['handle'][-1]!=101213745: red.append(pts)
    elif ly in ('Contornos municípios','Contorno Grande S.Paulo') and min(xs)>4915 and min(ys)>645: rmsp.append(pts)
json.dump(dict(border=border,red=red,rmsp=rmsp),open('geom.json','w'))
print(len(border),len(red),len(rmsp))
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
fig,ax=plt.subplots(figsize=(16,11))
for p in border: ax.plot(*zip(*p),'k-',lw=.8)
for p in red: ax.plot(*zip(*p),'r-',lw=1.2)
for p in rmsp: ax.plot(*zip(*p),'b-',lw=.5)
ax.set_aspect('equal'); plt.savefig('geom.png',dpi=50,bbox_inches='tight')
