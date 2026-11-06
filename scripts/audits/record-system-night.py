"""Record completed local fixes, then read each log entry and JPEG proof back."""
from pathlib import Path
import base64, datetime, hashlib, io, json, os, subprocess, urllib.error, urllib.parse, urllib.request
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/system-night'
tests=json.loads((OUT/'jest-complete.json').read_text(encoding='utf8'))
assert tests['numFailedTests']==0 and tests['numFailedTestSuites']==0 and tests['success']
for kind in ['app','server','pulse']:
 assert not (OUT/(kind+'-types-complete.log')).read_text(encoding='utf-8-sig').strip()
tool=r'C:\Users\User\AppData\Local\TeamderTools\google-cloud-sdk\bin\gcloud.cmd'
token=subprocess.run([tool,'auth','print-access-token'],capture_output=True,check=True,timeout=40).stdout.decode().strip()
BASE='https://firestore.googleapis.com/v1/projects/soccer-app-52b6b/databases/(default)/documents'
def request(url,body=None,method=None):
 req=urllib.request.Request(url,json.dumps(body,ensure_ascii=False).encode() if body is not None else None,
   {'Authorization':'Bearer '+token,'Content-Type':'application/json'},method=method)
 with urllib.request.urlopen(req,timeout=45) as response:return json.load(response)
def string(s):return {'stringValue':s}
entries=[
 ('join-order','נשמר מקום ההרשמה המקורי גם כשמכשיר נוסף מנסה שוב. בדיקות תחרות והרשמה מול השלמה עברו מקומית.',None),
 ('offer-expiry','אישור מקום אחרי פקיעת ההצעה נדחה בזמן ההחלטה. ביטול חוזר והחלטה שכבר בוצעה אינם משנים שוב את המחזור.',None),
 ('business-events','מדידת הרשמה, השלמה, פנדל, ציוד ועונה מבדילה בין ניסיון, שינוי חדש ותוצאה שכבר קיימת.',None),
 ('profile','שמירת פרופיל ורענון שומרים על החשבון המקורי. כתיבה שאיבדה תשובה נבדקת בקריאת שרת לפני הצגת הצלחה.',None),
 ('club-choice','רענון מאוחר אינו מחליף מועדון שנבחר בינתיים. הצטרפות ישנה אינה מחזירה מועדון לחשבון אחר.',None),
 ('invite-priority','קישור שנפתח במפורש שומר קדימות על שחזור התקנה שקורא את האחסון באיחור.',None),
 ('guest-goals','תיקון שער של אורח לאחר המחזור מעדכן את מונה האורחים בלי להוסיף שער לשחקנים המדורגים. ביטול חוזר נשאר עקבי.',None),
 ('watch-replay','פקודת שעון חוזרת מתוך חלון הקבלה אינה מבטלת שער שנוסף אחרי הפעולה הראשונה.',None),
 ('invitation-state','הזמנות חסומות ופגות תוקף אינן חוזרות לתצוגה זמינה בגלל בקשת הרשמה אחרת. התוקף נבדק שוב בעת הלחיצה.',None),
 ('invite-transaction','הנפקת הזמנה בודקת את החסימה בתוך עסקת השרת כדי שחסימה שנשמרה בזמן ההמתנה תעצור את ההזמנה.',None),
 ('usage-isolation','מסך ומזהי הקשר מהחשבון הקודם אינם מועתקים לביקור של חשבון אחר.',None),
 ('sources','כשל טעינה בפולס שומר נתוני ייחוס קודמים ומציג כשל נפרד במקום להציג רשימה ריקה. אומת ברכיב מקור בדפדפן.',
  'docs/features/screenshots/pulse-sources-night-after-2026-11-04.png'),
 ('signin','מסך ההתחברות גולל בגופן מוגדל ובמסך קטן ומונע חפיפת הסבר וכפתור. אומת באנדרואיד מבודד עם נתוני הדגמה.',
  'docs/features/screenshots/night-signin-after-2026-11-05.png'),
 ('product-measurement','נוספו אירועים לפקדים ולתוצאות עסקיות, ודוחות ביצועים ואנשים בפולס. ספירת החשבונות החדשה דורשת הפעלה והפצה ונשארה כבויה.',
  'docs/features/screenshots/pulse-accounts-night-2026-11-05.png'),
 ('goal-comparison','שער חדש נמדד רק אחרי שהוסף, והשוואה מוצלחת נפרדת מפתיחה וממעבר לשונית. חזרה, ביטול ומחיקה אינם שער נוסף.',None),
 ('usage-memory','תור המדידה שומר על גבול 500 גם כשתוצאות הרשמה חוזרות בזמן שאחסון המכשיר תקוע.',None),
 ('account-time','דוח החשבונות מציין אירועים ששויכו לפי זמן קליטה ואירועים ללא איכות זמן. ספירות החשבונות והביצועים נשמרות.',
  'docs/features/screenshots/pulse-account-time-quality-after-2026-11-05.png'),
]
proofs={}
receipts=[]
for attempt in range(3):
 original=request(BASE+'/appConfig/releaseLog')
 previous=original['fields'].get('items',{}).get('arrayValue',{}).get('values',[])
 additions=[]
 for suffix,title,image in entries:
  item_id='system-night-'+suffix+'-2026-11-05'
  existing=next((e['mapValue']['fields'] for e in previous if e.get('mapValue',{}).get('fields',{}).get('id')==string(item_id)),None)
  full=title+' התיקון מקומי וטרם הופץ במסגרת המשימה.'
  if existing:
   assert existing['title']==string(full)
   continue
  item={'id':string(item_id),'title':string(full),'kind':string('fix'),'version':string('next'),'area':string('בדיקות לילה ואמינות')}
  if image:
   if suffix not in proofs:
    target=ROOT/image;buffer=io.BytesIO()
    Image.open(target).convert('RGB').save(buffer,format='JPEG',quality=85)
    b64=base64.b64encode(buffer.getvalue()).decode()
    proof=request(BASE+'/releaseShots',{'fields':{'b64':string(b64)}},'POST')
    assert request('https://firestore.googleapis.com/v1/'+proof['name'])['fields']['b64']==string(b64)
    proofs[suffix]=proof['name'].rsplit('/',1)[1]
   item['shotId']=string(proofs[suffix])
  additions.append({'mapValue':{'fields':item}})
 if not additions:break
 fields={'items':{'arrayValue':{'values':additions+previous}},
   'updatedAt':{'timestampValue':datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')}}
 assert len(json.dumps({**original['fields'],**fields}).encode())<1000000
 query=urllib.parse.urlencode([('updateMask.fieldPaths',k) for k in fields]+[('currentDocument.updateTime',original['updateTime'])])
 try:
  request('https://firestore.googleapis.com/v1/'+original['name']+'?'+query,{'fields':fields},'PATCH');break
 except urllib.error.HTTPError as e:
  if e.code not in (409,412) or attempt==2:raise
saved=request(BASE+'/appConfig/releaseLog')['fields']['items']['arrayValue']['values']
for suffix,title,image in entries:
 item_id='system-night-'+suffix+'-2026-11-05'
 item=next(e['mapValue']['fields'] for e in saved if e.get('mapValue',{}).get('fields',{}).get('id')==string(item_id))
 assert item['title']==string(title+' התיקון מקומי וטרם הופץ במסגרת המשימה.') and item['version']==string('next')
 row={'id':item_id,'readBackVerified':True}
 if image:
  shot=item['shotId']['stringValue']
  raw=base64.b64decode(request(BASE+'/releaseShots/'+urllib.parse.quote(shot,safe=''))['fields']['b64']['stringValue'])
  assert raw.startswith(b'\xff\xd8')
  row.update({'shotId':shot,'jpegSha256':hashlib.sha256(raw).hexdigest(),'shotReadBackVerified':True})
 receipts.append(row)
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'localOnly':True,'deployed':False,
        'testsPassed':tests['numPassedTests'],'entries':receipts}
(OUT/'release-log-receipt.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'entriesReadBack':len(receipts),'proofsReadBack':sum('shotId' in r for r in receipts)}))
