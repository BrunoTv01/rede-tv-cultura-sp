import json,re,unicodedata,difflib,pickle,collections,math
import openpyxl,numpy as np
def norm(s): return re.sub(r'[^a-z]','',unicodedata.normalize('NFD',str(s)).encode('ascii','ignore').decode().lower())
d=json.load(open('dwg/data2.json',encoding='utf8'))
geo=json.load(open('data.json',encoding='utf8')); cen={m['n']:m['c'] for m in geo['m']}; byn={norm(k):k for k in cen}
_,T=pickle.load(open('dwg/out3.pkl','rb')); T=np.array(T)  # [x,y,1]@T -> lon,lat
ws=openpyxl.load_workbook('p100.xlsx',data_only=True).worksheets[0]
rows=[]
for r in ws.iter_rows(min_row=5,values_only=True):
    if not r[0] or not isinstance(r[1],(int,float)): continue
    rows.append(dict(loc=str(r[0]).strip(),pop=int(r[1]),cf=r[2],cv=r[3],tx=str(r[4] or '').strip(),by=str(r[5] or '').strip(),pot=str(r[6] or '').strip(),en=str(r[7] or '').strip(),ag=str(r[8] or '').strip(),ab=str(r[9] or '').strip()))
print(len(rows))
for s in d['st']: s.pop('cov',None)
d.pop('unc',None); d.pop('covCut',None)
# station index by municipality
def skey(s):
    if s['r']=='H': return 'saopaulo'
    if s['n'].startswith('Jaragu'): return 'jaragua'
    return norm(s['mu'] or s['n'])
idx={}
for s in d['st']:
    if s['r'] in ('F','P'): continue
    idx.setdefault(skey(s),s)
ALIAS={'piquete':'guaratingueta','picodoataque':'guaratingueta','picodoataquepiquete':'guaratingueta','portoprimaveradistrosana':'rosana','palestinaondabranca':'palestina','riopreto':'saojosedoriopreto','valparaiso':'valparaiso'}
# stations from sheet not in DWG -> add at approximate position
Tinv=np.linalg.inv(np.r_[T.T,[[0,0,1]]])  # [lon,lat,1] -> [x,y,1]
stxy=[(s['x'],s['y'],s['a']) for s in d['st']]
added=[]
for r in rows:
    k=norm(r['loc'])
    if r['tx'].lower()=='sim' and k not in idx and r['by'].startswith('TX Pr'):
        c=cen.get(byn.get(k));
        x,y,_=Tinv@np.array([c[0],c[1],1])
        a=min(stxy,key=lambda t:(t[0]-x)**2+(t[1]-y)**2)[2]
        s=dict(n=r['loc'],mu=byn.get(k),ch=str(r['cf']) + 'D' if r['cf'] not in (None,'-') else '',vt='',ob='Consta na planilha Projeto 100%, mas não no desenho DWG · posição aproximada',x=round(float(x),2),y=round(float(y),2),lx=None,ly=None,ll=[],a=a,r='R',m='',pm=0,lon=c[0],lat=c[1],extra=1)
        d['st'].append(s); idx[k]=s; added.append(r['loc'])
print('added',added)
keys=list(idx.keys())
def find(name):
    k=norm(name); k=ALIAS.get(k,k)
    if k in idx: return idx[k]
    m=difflib.get_close_matches(k,keys,n=1,cutoff=0.8)
    return idx[m[0]] if m else None
unres=collections.Counter()
for s in d['st']: s['cov']=[]
info={}
for r in rows:
    k=norm(r['loc'])
    rec=dict(p=r['pop'])
    if r['by'].startswith('TX Pr') or r['tx'].lower()=='sim' and k in idx:
        s=idx.get(k)
        if s:
            s['sheet']=dict(pop=r['pop'],cf=r['cf'],cv=r['cv'],pot=r['pot'],en=r['en'],ag=r['ag'],ab=r['ab'],by=r['by'])
            s['cov'].append([r['loc'],r['pop']])
            continue
    if r['by'].startswith('TX Pr') and k=='limeira': pass
    by=r['by']
    if 'Não Possui' in by or 'Afiliada' in by:
        unres[by]+=1; info[r['loc']]=by; continue
    parts=[p for p in re.split(r'\s+e\s+|/',by) if p.strip()]
    ok=False
    for p in parts:
        s=find(p)
        if s: s['cov'].append([r['loc'],r['pop']]); ok=True
    if not ok: unres[by]+=1; info[r['loc']]=by
print('unresolved',unres)
# extra info lists
d['semSinal']=[[k,v] for k,v in info.items()]
for s in d['st']:
    own=s.get('mu')
    s['cov'].sort(key=lambda c:(norm(c[0])!=norm(own or ''),c[0]))
covered=set(norm(c[0]) for s in d['st'] for c in s['cov'])
d['totCidades']=len(rows); d['totPop']=sum(r['pop'] for r in rows)
print('covered cities',len(covered),'stations w/o sheet',[s['n'] for s in d['st'] if 'sheet' not in s and s['r'] not in('G','F','P')])
mism=[(s['n'],s['ch'],s['sheet']['cf']) for s in d['st'] if 'sheet' in s and s['ch'] and str(s['sheet']['cf']) not in s['ch']]
print('canal diferente',mism)
json.dump(d,open('dwg/data3.json','w',encoding='utf8'),ensure_ascii=False,separators=(',',':'))
