import json, math
from PIL import Image, ImageDraw
import numpy as np
from collections import deque, Counter, defaultdict
S=json.load(open('strokes.json'))
K=3; W,H=1191*K,842*K
GREY='rgb(46.273804%, 46.273804%, 46.273804%)'; RED='rgb(100%, 0%, 0%)'
labels=[('38D','21.1'),('38D','39.1'),('39D','22.1'),('38D','05.1'),('38D','04.1'),('39D','39.1'),('30D','04.1'),('44D','13.1'),('30D','05.1'),('54D','03.1'),('30D','05.1'),('44D','41.1'),('44D','47.1'),('30D','03.1'),('44D','04.1'),('34D','12.1'),('41D','19.1'),('36D','19.1'),('42D','20.1'),('34D','11.1'),('21D','03.1'),('30D','04.1'),('34D','35.1'),('36D','14.1'),('41D','14.1'),('36D','19.1'),('30D','34.1'),('38D','10.1'),('38D','54.1'),('43D','44.1'),('24D','02.1'),('36D','39.1'),('24D','02.1'),('21D','03.1'),('24D','08.1'),('50D','38.1'),('50D','27.1'),('38D','10.1')]
C=[c for c in json.load(open('circles.json')) if c[2]>12]
assert len(C)==len(labels)
im=Image.new('L',(W,H),0); d=ImageDraw.Draw(im)
def plen(sp): return sum(math.dist(a,b) for a,b in zip(sp,sp[1:]))
for p in S[GREY]:
    for sp in p['subs']:
        if len(sp)>1: d.line([(x*K,y*K) for x,y in sp],fill=1,width=4)
redsubs=[]
for p in S[RED]:
    for sp in p['subs']:
        if len(sp)>1 and plen(sp)>12:
            redsubs.append(sp); d.line([(x*K,y*K) for x,y in sp],fill=2,width=3)
A=np.array(im)
# outside: flood from corner through non-grey pixels
lab=np.full(A.shape,-1,np.int32)
def flood(sx,sy,val):
    q=deque([(sx,sy)]); lab[sy,sx]=val; n=0
    while q:
        x,y=q.popleft(); n+=1
        for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
            X,Y=x+dx,y+dy
            if 0<=X<W and 0<=Y<H and lab[Y,X]==-1 and A[Y,X]==0:
                lab[Y,X]=val; q.append((X,Y))
    return n
print('fora', flood(5,5,0))
T=lambda X,Y:((44.64+(X-4378.88)*1.41567),(17.72+(824.16-Y)*1.41558))
e=json.load(open('/home/claude/rede-tv-cultura-sp/data/estacoes.json'))
def region_at(px,py):
    x,y=int(px*K),int(py*K)
    for r in range(0,12):
        for dx in range(-r,r+1):
            for dy in (-r,r) if abs(dx)!=r else range(-r,r+1):
                X,Y=x+dx,y+dy
                if 0<=X<W and 0<=Y<H and A[Y,X]==0: return X,Y
    return None
nxt=[1]
def rid(px,py):
    p=region_at(px,py)
    if not p: return None
    X,Y=p
    if lab[Y,X]==-1: nxt[0]+=1; flood(X,Y,nxt[0])
    return int(lab[Y,X])
st={}
for k,v in e.items(): st[k]=rid(*T(v['x'],v['y']))
circ={}
for i,(x,y,w) in enumerate(C):
    r=rid(x,y)
    if r in (0,None):
        # círculo fora do estado: segue a seta vermelha
        best=None
        for sp in redsubs:
            for a,b in ((sp[0],sp[-1]),(sp[-1],sp[0])):
                dd=math.dist(a,(x,y))
                if dd<16 and (best is None or dd<best[0]): best=(dd,b)
        if best: r=rid(*best[1])
    circ[i]=r
reg=defaultdict(list)
for k,r in st.items(): reg[r].append(k)
lab2=defaultdict(list)
for i,r in circ.items(): lab2[r].append(i)
for r,ks in sorted(reg.items(),key=lambda t:-len(t[1])):
    chs=Counter((e[k].get('ch'),e[k].get('vt')) for k in ks)
    print(r, len(ks), [labels[i] for i in lab2.get(r,[])], chs.most_common(4), [e[k]['n'] for k in ks][:6])
print('círculos sem região:', [ (i,labels[i]) for i,r in circ.items() if r in (0,None)])
json.dump({'st':st,'circ':circ},open('reg.json','w'))
np.save('lab.npy',lab)
