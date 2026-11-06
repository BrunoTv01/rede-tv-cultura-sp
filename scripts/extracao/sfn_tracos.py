import re,json
from PIL import Image, ImageDraw
s=open('sfn.svg').read()
paths=re.findall(r'<path ([^>]*)/>',s)
def attrs(a): return dict(re.findall(r'([\w-]+)="([^"]*)"',a))
def parse_d(d):
    toks=re.findall(r'[MLCZ]|-?[\d.]+',d); subs=[]; cur=[]; i=0; cmd=None
    while i<len(toks):
        t=toks[i]
        if t in 'MLCZ':
            cmd=t; i+=1
            if t=='M': 
                if cur: subs.append(cur)
                cur=[]
            if t=='Z':
                if cur: cur.append(cur[0]); subs.append(cur); cur=[]
            continue
        if cmd in 'ML': cur.append((float(toks[i]),float(toks[i+1]))); i+=2
        elif cmd=='C': cur.append((float(toks[i+4]),float(toks[i+5]))); i+=6
        else: i+=1
    if cur: subs.append(cur)
    return subs
out={}
for p in paths:
    a=attrs(p); st=a.get('stroke','')
    if 'd' not in a or not st.startswith('rgb'): continue
    m=re.match(r'matrix\(([^)]*)\)',a.get('transform','matrix(1,0,0,1,0,0)'))
    A=[float(x) for x in m.group(1).split(',')] if m else [1,0,0,1,0,0]
    subs=[[ (A[0]*x+A[2]*y+A[4], A[1]*x+A[3]*y+A[5]) for x,y in sp] for sp in parse_d(a['d'])]
    out.setdefault(st,[]).append({'w':float(a.get('stroke-width',1))*abs(A[0]),'subs':subs})
json.dump(out,open('strokes.json','w'))
for k,v in out.items(): print(k,len(v))
K=3; im=Image.new('RGB',(1191*K,842*K),'white'); d=ImageDraw.Draw(im)
for st,col in [('rgb(46.273804%, 46.273804%, 46.273804%)',(160,160,160)),('rgb(100%, 0%, 0%)',(255,0,0)),('rgb(0%, 0%, 0%)',(0,0,0))]:
    for p in out.get(st,[]):
        for sp in p['subs']:
            if len(sp)>1: d.line([(x*K,y*K) for x,y in sp],fill=col,width=2)
im.save('red.png'); im.resize((1191,842)).save('red_s.png')
