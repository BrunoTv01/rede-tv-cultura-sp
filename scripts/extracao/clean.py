import json,re
d=json.load(open('m2.json'))
objs=d['OBJECTS']
lay={o['handle'][-1]:o['name'] for o in objs if o.get('object')=='LAYER'}
def L(o): return lay.get(o.get('layer',[0,0,0,0])[-1],'?')
def clean(t):
    t=t.replace('\\P','\n')
    cols=re.findall(r'\\C(\d+);',t)
    t=re.sub(r'\\[fF][^;]*;','',t); t=re.sub(r'\\[CHWQTALOlo][^;\\]*;?','',t)
    t=re.sub(r'\\[LlOoK]','',t); t=t.replace('{','').replace('}','').replace('\\~',' ')
    t=re.sub(r'[ \t]+',' ',t)
    return '\n'.join(x.strip() for x in t.split('\n') if x.strip()), cols
