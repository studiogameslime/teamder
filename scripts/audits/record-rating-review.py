"""Append and verify the local combined rating review and its separate proof."""
from pathlib import Path
import base64,datetime,hashlib,io,json,re,subprocess,urllib.error,urllib.parse,urllib.request
from PIL import Image
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/rating-review-2026-11-11'
log=(OUT/'jest-final.log').read_text(encoding='utf-8-sig')
assert re.search(r'Test Suites:\s+(\d+) passed,\s+\1 total',log)
assert re.search(r'Tests:\s+(\d+) passed,\s+\1 total',log)
assert not (OUT/'typecheck-final.log').read_text(encoding='utf-8-sig').strip()
browser=json.loads((OUT/'browser-results.json').read_text())
assert len(browser['results'])==51 and not any(row['overflow'] for row in browser['results'])
assert not (OUT/'server-typecheck-final.log').read_text(encoding='utf-8-sig').strip()
token=subprocess.run([r'C:\Users\User\AppData\Local\TeamderTools\google-cloud-sdk\bin\gcloud.cmd','auth','print-access-token'],capture_output=True,text=True,check=True,timeout=45).stdout.strip()
BASE='https://firestore.googleapis.com/v1/projects/soccer-app-52b6b/databases/(default)/documents'
def request(url,body=None,method=None):
    req=urllib.request.Request(url,data=json.dumps(body,ensure_ascii=False).encode() if body is not None else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method=method)
    with urllib.request.urlopen(req,timeout=40) as response:return json.load(response)
def string(value):return {'stringValue':value}
item_id='combined-rating-review-2026-11-11'
title='המלצות דירוג המנהל משלבות תוצאות קבוצתיות וביצועים מול שחקנים בעלי תפקיד ודירוג דומים, עם הסבר ופעולות לקבלה או המשך מעקב. נוספו שמירת דירוגים בתחילת מחזור, בדיקות עקביות והגנה מפני שינוי כפול או כרטיס שהתיישן. המימוש מקומי וטרם הופץ, וידרוש איסוף נתונים חדשים לאחר פריסה; הצילום הוא רכיב מקור עם נתוני הדגמה בדפדפן.'
buffer=io.BytesIO();Image.open(OUT/'card-up.png').convert('RGB').save(buffer,format='JPEG',quality=86,optimize=True)
expected=buffer.getvalue();shot_id=None
for attempt in range(3):
    original=request(BASE+'/appConfig/releaseLog');previous=original['fields'].get('items',{}).get('arrayValue',{}).get('values',[])
    if any(item.get('mapValue',{}).get('fields',{}).get('id')==string(item_id) for item in previous):break
    if shot_id is None:
        shot=request(BASE+'/releaseShots',{'fields':{'b64':string(base64.b64encode(expected).decode())}},'POST');shot_id=shot['name'].rsplit('/',1)[1]
    item={'id':string(item_id),'title':string(title),'version':string('next'),'kind':string('fix'),'area':string('לוח מנהל'),'shotId':string(shot_id)}
    update={'items':{'arrayValue':{'values':[{'mapValue':{'fields':item}}]+previous}},'updatedAt':{'timestampValue':datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')}}
    assert len(json.dumps({**original['fields'],**update}).encode())<1000000
    query=urllib.parse.urlencode([('updateMask.fieldPaths',key) for key in update]+[('currentDocument.updateTime',original['updateTime'])])
    try:
        request('https://firestore.googleapis.com/v1/'+original['name']+'?'+query,{'fields':update},'PATCH')
        saved=request('https://firestore.googleapis.com/v1/'+original['name'])
        assert all(saved['fields'].get(key)==value for key,value in original['fields'].items() if key not in update)
        break
    except urllib.error.HTTPError as error:
        if error.code not in (409,412) or attempt==2:raise
saved=request(BASE+'/appConfig/releaseLog')['fields']['items']['arrayValue']['values']
item=next(v['mapValue']['fields'] for v in saved if v.get('mapValue',{}).get('fields',{}).get('id')==string(item_id))
assert item['title']==string(title) and item['version']==string('next')
shot=request(BASE+'/releaseShots/'+urllib.parse.quote(item['shotId']['stringValue'],safe=''))
assert base64.b64decode(shot['fields']['b64']['stringValue'])==expected
receipt={'id':item_id,'readBackVerified':True,'shotId':item['shotId']['stringValue'],'shotReadBackVerified':True,'jpegSha256':hashlib.sha256(expected).hexdigest(),'version':'next','localOnly':True,'deployed':False}
(OUT/'release-log-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'recordedAndReadBack':1,'proofsReadBack':1,'deployed':False}))
