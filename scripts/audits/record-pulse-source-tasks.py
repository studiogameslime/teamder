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
OUT = ROOT / 'artifacts/pulse-source-tasks-2026-11-05'
log = (OUT / 'jest-verified.log').read_text(encoding='utf-8-sig')
assert re.search(r'Test Suites:\s+(\d+) passed,\s+\1 total', log)
assert re.search(r'Tests:\s+(\d+) passed,\s+\1 total', log)
for filename in ['typecheck-verified.log', 'pulse-typecheck-verified.log']:
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
    ('feedback', 'board-after', 'הצעות שיפור וייעול מוצגות בנפרד מדיווחי תקלות בלוח הפולס ובמסנני הפניות. אפשר להפוך פנייה למשימה עם טקסט, שולח וצילום, בלי לסגור את המקור ובלי ליצור עותק נוסף. מקומי וטרם הופץ; צילום רכיבי מקור בדפדפן עם נתונים בדויים.'),
    ('support', 'converted-message-after', 'אפשר להפוך הודעה נכנסת לתמיכה למשימה עם עותק מקור וקישור לשיחה. ניסיון חוזר פותח את אותה משימה ושומר עריכה ומצב קיימים; ההמרה אינה שולחת הודעה ואינה מסמנת שיחה כפתורה. מקומי בלבד, ללא אימות מכשיר או המרה חיה בייצור.'),
]

proofs = {}
for attempt in range(3):
    original = request(BASE + '/appConfig/releaseLog')
    previous = original['fields'].get('items', {}).get('arrayValue', {}).get('values', [])
    additions = []
    for suffix, scene, title in entries:
        item_id = 'pulse-source-tasks-' + suffix + '-2026-11-05'
        existing = next((item['mapValue']['fields'] for item in previous if item.get('mapValue', {}).get('fields', {}).get('id') == string(item_id)), None)
        if existing:
            assert existing['title'] == string(title)
            continue
        item = {'id': string(item_id), 'title': string(title), 'kind': string('feature'), 'version': string('next'), 'area': string('פניות ומשימות בפולס')}
        if scene:
            if scene not in proofs:
                buffer = io.BytesIO()
                Image.open(OUT / (scene + '.png')).convert('RGB').save(buffer, format='JPEG', quality=88)
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
    item_id = 'pulse-source-tasks-' + suffix + '-2026-11-05'
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
