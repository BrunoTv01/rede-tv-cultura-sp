import json,pickle,numpy as np
from PIL import Image,ImageDraw
from scipy import ndimage
g=json.load(open('geom.json')); out=pickle.load(open('out.pkl','rb'))
X0,Y1,S=4380,840,4
W,H=int((5200-X0)*S),int((Y1-260)*S)
def tp(p): return ((p[0]-X0)*S,(Y1-p[1])*S)
im=Image.new('L',(W,H),0); d=ImageDraw.Draw(im)
for p in g['border']+g['red']: d.line([tp(q) for q in p],fill=255,width=3)
a=np.array(im)>0
lab,n=ndimage.label(~a)
seeds={4:(4590,673),3:(4836,629),2:(4701,516),1:(4930,432)}
reg={}
for k,(x,y) in seeds.items():
    px,py=tp((x,y)); reg[k]=lab[int(py),int(px)]
print(reg, n)
sizes=ndimage.sum(np.ones_like(lab),lab,range(n+1))
big=[(i,int(sizes[i])) for i in np.argsort(-sizes)[:8]]; print(big)
amap=np.zeros_like(lab)
for k,r in reg.items(): amap[lab==r]=k
# nearest filled for others
idx=ndimage.distance_transform_edt(amap==0,return_distances=False,return_indices=True)
full=amap[idx[0],idx[1]]
for o in out:
    px,py=tp((o['X'],o['Y'])); px=min(max(int(px),0),W-1); py=min(max(int(py),0),H-1)
    o['area']=int(full[py,px]); o['direct']=bool(amap[py,px])
print([ (o['n'],o['area']) for o in out if not o['direct']])
import collections; print(collections.Counter(o['area'] for o in out))
pickle.dump(out,open('out2.pkl','wb'))
# save region raster small for checking
Image.fromarray((amap*60).astype('uint8')).resize((W//4,H//4)).save('areas.png')
