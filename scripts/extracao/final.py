import pickle,math,re,json,unicodedata,collections
import numpy as np
exec(open('clean.py').read())
labels,stations,M,special=pickle.load(open('m3.pkl','rb'))
groups,=pickle.load(open('groups.pkl','rb'))
def norm(s): return re.sub(r'[^a-z]','',unicodedata.normalize('NFD',s).encode('ascii','ignore').decode().lower())
def tclean(t):
    t=re.sub(r'\\[a-zA-Z]+[\d.]*;','',t); return t
def inner(s,g):
    cx,cy,r=s['x'],s['y'],s['r']; k=set()
    for o in g:
        if o['entity']=='HATCH':
            pp=[q for p in o['paths'] for q in (p.get('polyline_paths') or [])]
            if pp and all(math.dist(q['point'][:2],(cx,cy))<r+0.4 for q in pp):
                b=[abs(q['bulge']) for q in pp]
                if len(pp)==2 and all(abs(x-1)<0.05 for x in b): k.add('full')
                elif any(x>0.9 for x in b): k.add('half')
        if o['entity']=='LINE':
            ps=[o['start'][:2],o['end'][:2]]
            if all(math.dist(p,(cx,cy))<r+0.3 for p in ps) and math.dist(*ps)>1.5*r:
                k.add('v' if abs(ps[0][0]-ps[1][0])<0.3 else 'h')
    if 'full' in k: return 'full'
    if 'v' in k and 'h' in k: return 'cross'
    if 'half' in k: return 'half'
    if 'h' in k: return 'line'
    return 'full'
def recep(name,g,lay):
    ls=set(L(o) for o in g)
    if 'Costa Norte' in ls or lay=='Costa Norte': return 'N'
    cols=[o['color'].get('index') for o in g]
    if any(o['color'].get('rgb','').endswith('727430') for o in g): return 'J'
    if 6 in cols: return 'G'
    if norm(name).startswith('mogiguacu'): return 'X'
    tv=[o for o in g if L(o)=='TV Cultura Paulista']
    def innerline(o): return o['entity']=='LINE' and max(abs(o['start'][1]-o['end'][1]),0)<0.3 and abs(abs(o['start'][0]-o['end'][0])-3)<0.3
    if any(not innerline(o) for o in tv): return 'C'
    return 'R'
out=[]
for i,j in M.items():
    l=labels[i]; s=stations[j]; g=groups[j]
    raw=tclean(l['t']); lines=[x.strip() for x in raw.split('\n') if x.strip()]
    full=' '.join(lines)
    m=re.search(r'cn\s*([0-9O]{1,2}\s*[A-Z]?-?)',full); ch=m.group(1).replace('O','0').replace(' ','') if m else ''
    v=re.search(r'VT\s*(\d+)',full); vt=('VT%02d'%int(v.group(1))) if v else ''
    namel=[x for x in lines if not re.match(r'^(cn|\(|VT|/)',x)]
    name=' '.join(namel); name=re.sub(r'\s*cn .*$','',name).strip()
    obs=''
    mo=re.search(r'\(([^)]*[a-zA-Z][^)]*)\)',name)
    if mo and not mo.group(1).startswith('VT'): obs=mo.group(1).strip(); name=name.replace(mo.group(0),'').strip()
    name=re.sub(r'\s+/\s+Costa Norte VT 48','',name)
    out.append(dict(n=name,ch=ch,vt=vt,obs=obs,X=s['x'],Y=s['y'],inner=inner(s,g),rec=recep(name,g,l['lay']),lay=l['lay'],pm=any(L(o)=='Canal Prefeitura' for o in g)))
for o in sorted(out,key=lambda o:o['n']):
  if o['rec']=='C': print(o['n'],'|',o['ch'],o['vt'],o['obs'],o['inner'],o['rec'],'PM' if o['pm'] else '')
pickle.dump(out,open('out.pkl','wb'))
