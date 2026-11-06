"""Record verified local fixes, with optimistic concurrency and read-back."""
from pathlib import Path
import base64
import datetime
import hashlib
import io
import json
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/performance-2026-11-04'
log = (OUT / 'jest-full.log').read_text(encoding='utf-8-sig')
assert re.search(r'Test Suites:\s+(\d+) passed,\s+\1 total', log)
assert re.search(r'Tests:\s+(\d+) passed,\s+\1 total', log)
assert not (OUT / 'typecheck-final.log').read_text(encoding='utf-8-sig').strip()
assert len(json.loads((OUT / 'browser-results.json').read_text())['results']) == 24

gcloud = r'C:\Users\User\AppData\Local\TeamderTools\google-cloud-sdk\bin\gcloud.cmd'
token = subprocess.run([gcloud, 'auth', 'print-access-token'], capture_output=True, text=True, check=True, timeout=45).stdout.strip()
BASE = 'https://firestore.googleapis.com/v1/projects/soccer-app-52b6b/databases/(default)/documents'

def request(url, body=None, method=None):
    req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(req, timeout=40) as response:
        return json.load(response)

def string(value):
    return {'stringValue': value}

entries = [
    ('navigation', 'splash', 'טעינת 54 מודולי מסך נדחית לפתיחת המסך, וכל שמות מסלולי הניווט נשמרו. כלי תצוגה מקדימה אינם נטענים בייצור. שינוי מקומי שטרם הופץ; אין מדידת מכשיר, וביקור ראשון במסך אחר עשוי לכלול פענוח מודול.'),
    ('splash', 'splash', 'המתנת הספלאש המזערית למשתמש חוזר קוצרה מ-1400 ל-240 אלפיות שנייה, לאחר כל שערי המוכנות. קבלת הפנים למשתמש חדש נשמרת. מקומי וטרם הופץ; התזמון נבדק בשעון מבוקר והצילום הוא אזור מקור בדפדפן.'),
    ('shared-reads', None, 'בקשות חופפות לזהויות שחקנים ולדירוגי מועדון חולקות קריאה פעילה אחת באותה התחברות. שמירה מבטלת שיתוף קודם ותשובות שהושלמו אינן נשמרות במטמון חדש. מקומי וטרם הופץ; נבדקו כשל והחלפת חשבון ללא בדיקת שירות חי חדשה.'),
    ('personal-statistics', 'home', 'הבית והסטטיסטיקה האישית אוספים את נתוני הבסיס במקביל לקריאת הסכומים הטריים. סיכום הבסיס מופיע לפני העשרת ההיסטוריה, ושם השותף נבדק מול זהותו המעודכנת. מקומי וטרם הופץ; נבדקו תגובות מעוכבות ואזור מקור בדפדפן.'),
    ('club-roster', 'roster', 'שמות הסגל מופיעים בלי להמתין למדדים ולכרטיסים, עם חיווי עד סיום פרטי העזר. כשל שומר מידע מאושר באותו חשבון ומועדון. מקומי וטרם הופץ; בתרחיש מבוקר הופעת הסגל התקצרה מ-1300 ל-300 אלפיות שנייה, ללא מדידת מכשיר.'),
    ('available-players', None, 'המחזור ודף השחקנים הזמינים מתחילים להיטען יחד. המועמדים מוצגים רק אחרי אישור קיום המחזור, ותנאי הזכאות נשארים בשרת. מקומי וטרם הופץ; נבדקו דף מוקדם, מחזור חסר ותנאי תפוסה.'),
    ('stable-read-effects', None, 'רשימת המחזורים, הוספת חברים ולוח והגדרת הכוחות אינם קוראים שוב לנתונים בגלל שינוי שם, תמונה או אובייקט עם אותו תוכן. שינוי חשבון, השתייכות או הרשאת ניהול עדיין נבדק ופוסל תגובה קודמת. מקומי וטרם הופץ; נבדקו ספירות קריאות ותגובות מאוחרות.'),
    ('comparison', None, 'השוואת העונה הפעילה ממתינה למטא נתוני העונה אך אינה ממתינה לארכיון ואינה נטענת שוב בהגעתו. כל הזמנים עדיין מחכה לארכיון מאומת, וכשל אינו מוצג כאפס. מקומי וטרם הופץ; נבדקו עיכובים והחלפת תחום וחשבון, ללא מדידת מכשיר.'),
    ('hidden-live-timers', None, 'עדכוני תצוגת השעון, מונה העצירות וסנכרון הזמן המחזורי נעצרים כשהלייב מוסתר. בחזרה למסך הזמן מחושב מהעוגן המשותף בלי לשנות את שעון המשחק. מקומי וטרם הופץ; נבדקו ניקוי מרווחים וחזרה לאחר הסתרה.'),
    ('draft-skeleton', 'draft', 'נוסף שלד טעינה להגדרת הכוחות, בהתאם לארבע אפשרויות החלוקה. כשל ממשיך להציג ניסיון חוזר, ואין השהיה חדשה לפני הצגת התוכן. מקומי וטרם הופץ; נבדקו אזורי מקור בדפדפן בשלושה רוחבים, ללא אימות מכשיר חדש.'),
]
proofs = {}
for attempt in range(3):
    original = request(BASE + '/appConfig/releaseLog')
    previous = original['fields'].get('items', {}).get('arrayValue', {}).get('values', [])
    additions = []
    for suffix, scene, title in entries:
        item_id = 'screen-performance-' + suffix + '-2026-11-04'
        existing = next((item['mapValue']['fields'] for item in previous if item.get('mapValue', {}).get('fields', {}).get('id') == string(item_id)), None)
        if existing:
            assert existing['title'] == string(title)
            continue
        item = {'id': string(item_id), 'title': string(title), 'kind': string('fix'), 'version': string('next'), 'area': string('מהירות וטעינת מסכים')}
        if scene:
            if scene not in proofs:
                buffer = io.BytesIO()
                Image.open(OUT / f'{scene}-after.png').convert('RGB').save(buffer, format='JPEG', quality=88)
                b64 = string(base64.b64encode(buffer.getvalue()).decode())
                shot = request(BASE + '/releaseShots', {'fields': {'b64': b64}}, 'POST')
                assert request('https://firestore.googleapis.com/v1/' + shot['name'])['fields']['b64'] == b64
                proofs[scene] = shot['name'].rsplit('/', 1)[1]
            item['shotId'] = string(proofs[scene])
        additions.append({'mapValue': {'fields': item}})
    if not additions:
        break
    update = {'items': {'arrayValue': {'values': additions + previous}}, 'updatedAt': {'timestampValue': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')}}
    assert len(json.dumps({**original['fields'], **update}).encode()) < 1000000
    query = urllib.parse.urlencode([('updateMask.fieldPaths', key) for key in update] + [('currentDocument.updateTime', original['updateTime'])])
    try:
        request('https://firestore.googleapis.com/v1/' + original['name'] + '?' + query, {'fields': update}, 'PATCH')
        break
    except urllib.error.HTTPError as error:
        if error.code not in (409, 412) or attempt == 2:
            raise

saved = request(BASE + '/appConfig/releaseLog')['fields']['items']['arrayValue']['values']
receipts = []
for suffix, scene, title in entries:
    item_id = 'screen-performance-' + suffix + '-2026-11-04'
    item = next(v['mapValue']['fields'] for v in saved if v.get('mapValue', {}).get('fields', {}).get('id') == string(item_id))
    assert item['title'] == string(title) and item['version'] == string('next')
    receipt = {'id': item_id, 'readBackVerified': True, 'version': 'next'}
    if scene:
        shot_id = item['shotId']['stringValue']
        shot = request(BASE + '/releaseShots/' + urllib.parse.quote(shot_id, safe=''))
        image_bytes = base64.b64decode(shot['fields']['b64']['stringValue'])
        assert image_bytes.startswith(b'\xff\xd8')
        receipt.update({'shotId': shot_id, 'shotReadBackVerified': True, 'jpegSha256': hashlib.sha256(image_bytes).hexdigest()})
    receipts.append(receipt)
result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'localOnly': True, 'deployed': False, 'entries': receipts}
(OUT / 'release-log-receipt.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'recordedAndReadBack': len(receipts), 'proofsReadBack': sum('shotId' in r for r in receipts), 'deployed': False}))
