"""Required internal release-log entry and proof only. Does not deploy."""
from pathlib import Path
import base64,io,json,subprocess,urllib.request,uuid
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
D=ROOT/'artifacts/pro-planning-2026-10-30'
testlog=(D/'jest-final.txt').read_text(encoding='utf-8')
assert ' failed,' not in testlog and '6401 passed' in testlog
for filename in ['types-main.txt','types-pulse.txt']:
    assert not (D/filename).read_text(encoding='utf-8').strip()
plan=D/'release-plan.json'
if plan.exists():entry=json.loads(plan.read_text(encoding='utf-8'))
else:
    entry={'id':'pulse-pro-planning-2026-10-30','kind':'feature','version':'next','area':'תכנון בפולס','shotId':uuid.uuid4().hex,
        'title':"נוסף מסך תכנון פרו פנימי עם 84 פיצ'רים, סימון פרו או לא פרו, חיפוש וסינון לפי תחום וסימון. הבחירות נשמרות במכשיר הפולס בלבד ואינן משנות את האפליקציה. מימוש מקומי שטרם הופץ; המסך נבדק בתצוגת אנדרואיד מבודדת ובבדיקות המאגר, ללא התקנת פולס חדשה."}
    plan.write_text(json.dumps(entry,ensure_ascii=False,indent=2),encoding='utf-8')
token=subprocess.run([r'C:\Users\User\AppData\Local\TeamderTools\google-cloud-sdk\bin\gcloud.cmd','auth','print-access-token'],capture_output=True,text=True,check=True).stdout.strip()
base='https://firestore.googleapis.com/v1/projects/soccer-app-52b6b/databases/(default)/documents'
def api(url,data=None):
    request=urllib.request.Request(url,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},data=None if data is None else json.dumps(data).encode())
    with urllib.request.urlopen(request,timeout=45) as response:return json.load(response)
def enc(value):
    if isinstance(value,dict):return {'mapValue':{'fields':{k:enc(v) for k,v in value.items()}}}
    return {'stringValue':value}
log=api(base+'/appConfig/releaseLog')
items=log['fields']['items']['arrayValue'].get('values',[])
matching=[v for v in items if v.get('mapValue',{}).get('fields',{}).get('id')==enc(entry['id'])]
if not matching:
    image=Image.open(ROOT/'docs/features/screenshots/pulse-pro-only-2026-10-30.png').convert('RGB')
    image.thumbnail((720,1800))
    stream=io.BytesIO();image.save(stream,format='JPEG',quality=85)
    b64=base64.b64encode(stream.getvalue()).decode()
    shot=log['name'].rsplit('/appConfig/',1)[0]+'/releaseShots/'+entry['shotId']
    api(base+':commit',{'writes':[{'update':{'name':shot,'fields':{'b64':enc(b64)}},'currentDocument':{'exists':False}},
        {'transform':{'document':log['name'],'fieldTransforms':[{'fieldPath':'items','appendMissingElements':{'values':[enc(entry)]}}]},'currentDocument':{'updateTime':log['updateTime']}}]})
else:assert matching==[enc(entry)]
fresh=api(base+'/appConfig/releaseLog')
assert sum(v==enc(entry) for v in fresh['fields']['items']['arrayValue'].get('values',[]))==1
assert api(base+'/releaseShots/'+entry['shotId'])['fields']['b64']['stringValue']
receipt={'id':entry['id'],'shotId':entry['shotId'],'releaseLogVerified':True,'proofReadBack':True,'updateTime':fresh.get('updateTime'),'deployed':False}
(D/'release-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(receipt))
