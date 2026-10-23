import json,pickle,re,math,numpy as np,collections
from PIL import Image,ImageDraw
from scipy import ndimage
import contourpy
exec(open('clean.py').read())
g=json.load(open('geom.json')); out,T=pickle.load(open('out3.pkl','rb'))
labels,stations,M,special=pickle.load(open('m3.pkl','rb'))
X0,Y1,S=4380,840,4
W,H=int((5200-X0)*S),int((Y1-260)*S)
def tp(p): return ((p[0]-X0)*S,(Y1-p[1])*S)
im=Image.new('L',(W,H),0); d=ImageDraw.Draw(im)
for p in g['border']+g['red']: d.line([tp(q) for q in p],fill=255,width=3)
a=np.array(im)>0
lab,n=ndimage.label(~a)
outside=lab[2,2]; print("outside",outside,(lab==outside).sum())
seeds={4:(4590,673),3:(4836,629),2:(4701,516),1:(4930,432)}
amap=np.zeros_like(lab)
for k,(x,y) in seeds.items():
    px,py=tp((x,y)); amap[lab==lab[int(py),int(px)]]=k
idx=ndimage.distance_transform_edt(amap==0,return_distances=False,return_indices=True)
full=amap[idx[0],idx[1]]
inside=(lab!=outside)
# remove tiny outside slivers: fill holes of inside
inside=ndimage.binary_fill_holes(inside)
def dp(pts,tol):
    if len(pts)<3: return pts
    keep=[False]*len(pts); keep[0]=keep[-1]=True; st=[(0,len(pts)-1)]
    while st:
        i,j=st.pop(); (ax,ay),(bx,by)=pts[i],pts[j]; dx,dy=bx-ax,by-ay; Ln=math.hypot(dx,dy) or 1e-9
        best,bi=0,-1
        for k in range(i+1,j):
            px,py=pts[k]; dd=abs(dy*(px-ax)-dx*(py-ay))/Ln
            if dd>best: best,bi=dd,k
        if best>tol: keep[bi]=True; st+=[(i,bi),(bi,j)]
    return [p for p,k in zip(pts,keep) if k]
areas={}
for k in (1,2,3,4):
    mask=((full==k)&inside).astype(float)
    mask=ndimage.zoom(mask,0.5,order=1)
    cg=contourpy.contour_generator(z=mask)
    rings=[]
    LS=cg.lines(0.5)
    for line in LS:
        if len(line)<8: continue
        pts=[(round(X0+x*2/S,2),round(Y1-y*2/S,2)) for x,y in line]
        h=len(pts)//2; pts=dp(pts[:h+1],0.25)[:-1]+dp(pts[h:],0.25)
        if len(pts)>=4: rings.append(pts)
    areas[k]=rings
    print(k,len(rings),sum(len(r) for r in rings))
def simp(pl,t=0.15): return [[round(x,2),round(y,2)] for x,y in dp([tuple(p) for p in pl],t)]
border=[simp(p) for p in g['border']]; red=[simp(p) for p in g['red']]
# specials
MS=[o for o in objs if o.get('entity') and o.get('ownerhandle',[0,0,0,0])[-1]==0]
gsp=[o for o in MS if L(o)=='Geradora S.Paulo' and o['entity']=='CIRCLE']
gx,gy=max(gsp,key=lambda o:o['radius'])['center'][:2]
rep=[o for o in MS if L(o)=='Repetidora' and o['entity']=='CIRCLE'][0]['center'][:2]
rmsp=[]
for o in MS:
    if o['entity']=='MTEXT' and '\\c0;' in o.get('text','') and o['ins_pt'][0]>4915 and o['ins_pt'][1]>645:
        t,_=clean(o['text']); rmsp.append(' '.join(t.replace('\\c0;','').split()))
rmsp=sorted(set(rmsp))
print('rmsp',len(rmsp))
# label anchors per out item (match by order: out built from M items order)
items=list(M.items())
st=[]
for (i,j),o in zip(items,out):
    l=labels[i]
    t=re.sub(r'\\[a-zA-Z]+[\d.]*;','',l['t'])
    lines=[x.strip() for x in t.split('\n') if x.strip()]
    st.append(dict(n=o['name'],mu=o['mun'],ch=o['ch'],vt=o['vt'],ob=o['obs'],x=round(o['X'],2),y=round(o['Y'],2),
        lx=round(l['x'],2),ly=round(l['y'],2),ll=lines,a=o['area'],r=o['rec'],m=o['inner'],pm=1 if o['pm'] else 0,
        lon=o['lon'],lat=o['lat']))
# use municipality centroid for maps link where available
data=json.load(open('../data.json')); cen={m['n']:m['c'] for m in data['m']}
for s in st:
    if s['mu'] in cen: s['lon'],s['lat']=cen[s['mu']]
ped=[s for s in st if s['n']=='Pedreira'][0]
st.append(dict(n='São Paulo',mu='São Paulo',ch='24D',vt='VT02',ob='Geradora',x=round(gx,2),y=round(gy,2),lx=round(gx-2,2),ly=round(gy-4,2),ll=['SÃO PAULO','cn 24D (VT02)','(Geradora)'],a=1,r='H',m='',pm=0,lon=cen['São Paulo'][0],lat=cen['São Paulo'][1]))
st.append(dict(n='Japi',mu='Jundiaí',ch='',vt='',ob='Repetidora na Serra do Japi',x=round(rep[0],2),y=round(rep[1],2),lx=round(rep[0]+2,2),ly=round(rep[1]-1,2),ll=['Japí'],a=1,r='P',m='',pm=0,lon=-46.935,lat=-23.235))
st.append(dict(n='Pedreira Gap Filler Campinas',mu='Pedreira',ch='38D',vt='VT10',ob='Desenhado em destaque fora do mapa; posição aproximada',x=round(ped['x']+3.2,2),y=round(ped['y']-3.2,2),lx=None,ly=None,ll=[],a=1,r='F',m='',pm=0,lon=ped['lon'],lat=ped['lat']))
for s in st:
    if s['r']=='G': s['ob']=(s['ob']+' · ' if s['ob'] else '')+'Gap filler'
# area label positions
alab=[]
for o in MS:
    if o['entity']=='MTEXT' and L(o)=='Contorno do mapa' and 'ÁREA' in o.get('text',''):
        t,_=clean(o['text']); alab.append(dict(x=o['ins_pt'][0],y=o['ins_pt'][1],t=t.split('\n')))
res=dict(border=border,red=red,areas=areas,st=st,rmsp=rmsp,alab=alab)
json.dump(res,open('data2.json','w'),ensure_ascii=False,separators=(',',':'))
print(len(st),collections.Counter(s['a'] for s in st),collections.Counter(s['r'] for s in st),collections.Counter(s['m'] for s in st))
import os; print(os.path.getsize('data2.json')//1024,'KB')
