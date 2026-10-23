import pickle,json,re,unicodedata,numpy as np
out=pickle.load(open('out2.pkl','rb'))
data=json.load(open('../data.json'))
def norm(s): return re.sub(r'[^a-z]','',unicodedata.normalize('NFD',s).encode('ascii','ignore').decode().lower())
idx={norm(m['n']):m for m in data['m']}
FIX={'Assís':'Assis','Mocóca':'Mococa','Tanabí':'Tanabi','Barirí':'Bariri','Itajobí':'Itajobi','Itarirí':'Itariri','Cajatí':'Cajati','Sta. Adélia':'Santa Adélia','São João Boa Vista':'São João da Boa Vista','São Bento Sapucaí':'São Bento do Sapucaí','Mogi guaçu':'Mogi Guaçu',"Estrela D'Oeste":"Estrela d'Oeste","Santa Bárbara D'Oeste":"Santa Bárbara d'Oeste",'São Fco.Xavier':'São Francisco Xavier','Jaragua':'Jaraguá'}
MUN={'Santos / Guarujá':'Santos','Iguape / Ilha Comprida':'Iguape'}
P=[];Q=[]
for o in out:
    o['name']=FIX.get(o['n'],o['n'])
    key=MUN.get(o['name'],o['name'])
    m=idx.get(norm(key))
    o['mun']=m['n'] if m else None
    if m and o['rec']!='G': P.append((o['X'],o['Y'])); Q.append(m['c'])
P=np.array(P);Q=np.array(Q)
print(len(P),'unmatched',[o['name'] for o in out if not o['mun']])
A=np.c_[P,np.ones(len(P))]
keep=np.ones(len(P),bool)
for it in range(3):
    T,_,_,_=np.linalg.lstsq(A[keep],Q[keep],rcond=None)
    r=np.linalg.norm(A@T-Q,axis=1)*111
    keep=r<np.percentile(r[keep],90)*1.8
    print('iter',it,'median km',np.median(r),'p90',np.percentile(r,90),'kept',keep.sum())
for o in out:
    lon,lat=np.array([o['X'],o['Y'],1])@T; o['lon']=round(float(lon),4); o['lat']=round(float(lat),4)
bad=sorted([(round(float(x),1),o['name']) for x,o in zip(r,[o for o in out if o['mun'] and o['rec']!='G'])])[-8:]
print(bad)
pickle.dump((out,T.tolist()),open('out3.pkl','wb'))
