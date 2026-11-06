"""Register source-rendered proof; optionally append/read back its release log."""
from pathlib import Path
import argparse
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
OUT = ROOT / 'artifacts/round-penalties-2026-11-06'
parser = argparse.ArgumentParser()
parser.add_argument('--release-log', action='store_true')
args = parser.parse_args()
browser = json.loads((OUT / 'browser-results.json').read_text())
assert not browser['errors'] and len(browser['results']) == 12
commit = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
manifest_path = ROOT / 'docs/features/screenshots/manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
new_shots = []
for scene in ['stats-before', 'stats-after', 'kicker-details-after', 'keeper-details-after']:
    filename = 'round-penalties-' + scene + '-2026-11-06.png'
    data = (OUT / (scene + '.png')).read_bytes()
    (ROOT / 'docs/features/screenshots' / filename).write_bytes(data)
    new_shots.append({
        'file': filename, 'source': 'artifacts/round-penalties-2026-11-06/' + scene + '.png',
        'platform': 'Web', 'environment': 'רכיבי מקור של לשונית סטטיסטיקת המחזור במתאם דפדפן עם נתוני הדגמה',
        'sourceCommit': commit, 'captured': '2026-11-06',
        'notes': ['שינויים מקומיים מעבר למקור הרשום. רוחב 390 וגופן רגיל. הצילום נפתח ונבחן.',
                  'אווטרים, סמלים ומעטפת מותאמים לדפדפן. הטבלה התחתונה הושמטה מהמארח.',
                  'אין בדיקת מכשיר או נתוני ייצור. מימוש מקומי וטרם הופץ.'],
        'sha256': hashlib.sha256(data).hexdigest(),
    })
names = {shot['file'] for shot in new_shots}
manifest_path.write_text(json.dumps(new_shots + [shot for shot in manifest if shot['file'] not in names], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
source_files = ['src/utils/roundPenalties.ts', 'src/components/match/RoundPenaltiesCard.tsx',
                'src/components/match/RoundPenaltiesSection.tsx', 'src/components/match/tabs/MatchStatsTab.tsx',
                'tests/logic/roundPenalties.test.tsx']
(OUT / 'source-proof.json').write_text(json.dumps({
    'commit': commit, 'localChanges': True, 'native': False,
    'sources': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in source_files},
    'screenshots': {shot['file']: shot['sha256'] for shot in new_shots},
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'registeredScreenshots': len(new_shots), 'native': False}))
if not args.release_log:
    raise SystemExit(0)

log = (OUT / 'jest-final.log').read_text(encoding='utf-8-sig')
assert re.search(r'Test Suites:\s+(\d+) passed,\s+\1 total', log)
assert re.search(r'Tests:\s+(\d+) passed,\s+\1 total', log)
assert not (OUT / 'typecheck-final.log').read_text(encoding='utf-8-sig').strip()
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

item_id = 'round-penalties-card-2026-11-06'
title = 'בסטטיסטיקת המחזור נוסף כרטיס פנדלים עם מעבר בין בועטים לשוערים והפרדה בין פנדלים במשחק לפנדלי הכרעה. לחיצה על שחקן מציגה את הבעיטות ותוצאותיהן; מידע חסר מסומן בלי להמציא עצירות. מקומי וטרם הופץ; אומת ברכיבי מקור בדפדפן עם נתוני הדגמה, ללא אימות מכשיר או שרת חדש.'
shot_id = None
for attempt in range(3):
    original = request(BASE + '/appConfig/releaseLog')
    previous = original['fields'].get('items', {}).get('arrayValue', {}).get('values', [])
    if any(item.get('mapValue', {}).get('fields', {}).get('id') == string(item_id) for item in previous):
        break
    if shot_id is None:
        image = Image.open(OUT / 'stats-after.png').convert('RGB')
        buffer = io.BytesIO()
        image.save(buffer, format='JPEG', quality=86, optimize=True)
        b64 = string(base64.b64encode(buffer.getvalue()).decode())
        # POST supplies an exact returned id; never reconstruct a document id.
        shot = request(BASE + '/releaseShots', {'fields': {'b64': b64}}, 'POST')
        shot_id = shot['name'].rsplit('/', 1)[1]
    item = {'id': string(item_id), 'title': string(title), 'version': string('next'),
            'kind': string('feature'), 'area': string('סטטיסטיקת מחזור'), 'shotId': string(shot_id)}
    update = {'items': {'arrayValue': {'values': [{'mapValue': {'fields': item}}] + previous}},
              'updatedAt': {'timestampValue': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')}}
    assert len(json.dumps({**original['fields'], **update}).encode()) < 1000000
    query = urllib.parse.urlencode([('updateMask.fieldPaths', key) for key in update] + [('currentDocument.updateTime', original['updateTime'])])
    try:
        request('https://firestore.googleapis.com/v1/' + original['name'] + '?' + query, {'fields': update}, 'PATCH')
        break
    except urllib.error.HTTPError as error:
        if error.code not in (409, 412) or attempt == 2:
            raise
saved = request(BASE + '/appConfig/releaseLog')['fields']['items']['arrayValue']['values']
item = next(v['mapValue']['fields'] for v in saved if v.get('mapValue', {}).get('fields', {}).get('id') == string(item_id))
assert item['title'] == string(title) and item['version'] == string('next')
shot_id = item['shotId']['stringValue']
shot = request(BASE + '/releaseShots/' + urllib.parse.quote(shot_id, safe=''))
image_bytes = base64.b64decode(shot['fields']['b64']['stringValue'])
assert image_bytes.startswith(b'\xff\xd8')
receipt = {'id': item_id, 'readBackVerified': True, 'version': 'next', 'localOnly': True, 'deployed': False,
           'shotId': shot_id, 'shotReadBackVerified': True, 'jpegSha256': hashlib.sha256(image_bytes).hexdigest()}
(OUT / 'release-log-receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'recordedAndReadBack': 1, 'proofsReadBack': 1, 'deployed': False}))
