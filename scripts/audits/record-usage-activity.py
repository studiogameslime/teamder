"""Record the local-only feature and verify the release log/proof by reading back."""
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
OUT = ROOT / 'artifacts/usage-activity-2026-11-04'
log = (OUT / 'jest-verified.log').read_text(encoding='utf-8-sig')
assert re.search(r'Test Suites:\s+(\d+) passed,\s+\1 total', log)
assert re.search(r'Tests:\s+(\d+) passed,\s+\1 total', log)
for filename in ['typecheck-verified.log', 'server-typecheck-verified.log', 'pulse-typecheck-verified.log']:
    assert not (OUT / filename).read_text(encoding='utf-8-sig').strip(), filename
assert not json.loads((OUT / 'browser-results.json').read_text())['errors']

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
    ('collection', None, 'נוסף מקומית זרם שימוש פרטי ונפרד מההצטרפות, עם ביקורים, הפרדת חשבונות, תור מוגבל ואישור קליטה. האיסוף החדש כבוי כברירת מחדל, ללא שינוי הרשאות או פריסה; לא בוצעה בדיקת מכשיר או מסד הדגמה.'),
    ('registration', None, 'ניסיון הרשמה מקושר לתוצאת השרת באותו ביקור וזהות, כולל הרשמה שאושרה, המתנה ואישור מנהל נדרש. דיווח לקוח חיובי לבדו אינו נספר כהצלחה מאומתת, ומשלוח חוזר אינו מגדיל מונים. מקומי בלבד והאיסוף כבוי.'),
    ('timeline', 'after', 'נוסף בכרטיס המשתמש בפולס אזור ביקורים עם מסננים, דפדוף, סיכומים ומקור אירוע. עדכונים ממתינים לבחירת המפעיל וכשל שומר מידע קודם באותו משתמש. מקומי וטרם הופץ; צילום רכיבי מקור בדפדפן עם נתוני הדגמה, ללא בדיקת מכשיר.'),
]
proof = None
for attempt in range(3):
    original = request(BASE + '/appConfig/releaseLog')
    previous = original['fields'].get('items', {}).get('arrayValue', {}).get('values', [])
    additions = []
    for suffix, scene, title in entries:
        item_id = 'usage-activity-' + suffix + '-2026-11-04'
        existing = next((item['mapValue']['fields'] for item in previous if item.get('mapValue', {}).get('fields', {}).get('id') == string(item_id)), None)
        if existing:
            assert existing['title'] == string(title)
            continue
        item = {'id': string(item_id), 'title': string(title), 'kind': string('feature'), 'version': string('next'), 'area': string('פעילות משתמשים בפולס')}
        if scene:
            if proof is None:
                buffer = io.BytesIO()
                Image.open(OUT / 'history-after.png').convert('RGB').save(buffer, format='JPEG', quality=88)
                b64 = string(base64.b64encode(buffer.getvalue()).decode())
                shot = request(BASE + '/releaseShots', {'fields': {'b64': b64}}, 'POST')
                assert request('https://firestore.googleapis.com/v1/' + shot['name'])['fields']['b64'] == b64
                proof = shot['name'].rsplit('/', 1)[1]
            item['shotId'] = string(proof)
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
    item_id = 'usage-activity-' + suffix + '-2026-11-04'
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
result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'localOnly': True, 'collectionEnabled': False, 'deployed': False, 'entries': receipts}
(OUT / 'release-log-receipt.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'recordedAndReadBack': len(receipts), 'proofsReadBack': sum('shotId' in r for r in receipts), 'deployed': False}))
