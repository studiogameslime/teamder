"""Append the authorized local change to releaseLog, preserving concurrent edits."""
from pathlib import Path
import datetime
import json
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts'
log = (OUT / 'recurrence-jest.log').read_text(encoding='utf-8-sig')
assert re.search(r'Test Suites:\s+(\d+) passed,\s+\1 total', log)
assert re.search(r'Tests:\s+(\d+) passed,\s+\1 total', log)
for filename in ['recurrence-typecheck.log', 'recurrence-server-typecheck.log']:
    assert not (OUT / filename).read_text(encoding='utf-8-sig').strip()
token = subprocess.run([r'C:\Users\User\AppData\Local\TeamderTools\google-cloud-sdk\bin\gcloud.cmd', 'auth', 'print-access-token'], capture_output=True, text=True, check=True, timeout=45).stdout.strip()
BASE = 'https://firestore.googleapis.com/v1/projects/soccer-app-52b6b/databases/(default)/documents'

def request(url, body=None, method=None):
    req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(req, timeout=40) as response:
        return json.load(response)

def string(value):
    return {'stringValue': value}

item_id = 'inactive-recurring-rounds-2026-11-06'
title = 'מחזור קבוע נעצר אחרי שלושה מחזורים רצופים שבוטלו, שאושר שלא התקיימו או שנותרו ללא הרשמה. מחזור עם פעילות או הרשמה קוטע את הרצף, והיסטוריית המועדון נשמרת. המימוש מקומי וטרם הופעל בשרת; נדרשת פריסת מפתח שאילתה ושירותי התזמון, ובדיקות העסקאות בוצעו במאגר זיכרון.'
item = {'id': string(item_id), 'title': string(title), 'version': string('next'), 'kind': string('feature'), 'area': string('מחזורים קבועים')}
for attempt in range(3):
    original = request(BASE + '/appConfig/releaseLog')
    previous = original['fields'].get('items', {}).get('arrayValue', {}).get('values', [])
    matches = [entry for entry in previous if entry.get('mapValue', {}).get('fields', {}).get('id') == string(item_id)]
    if matches:
        assert matches == [{'mapValue': {'fields': item}}]
        break
    update = {'items': {'arrayValue': {'values': [{'mapValue': {'fields': item}}] + previous}},
        'updatedAt': {'timestampValue': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')}}
    assert len(json.dumps({**original['fields'], **update}).encode()) < 1000000
    query = urllib.parse.urlencode([('updateMask.fieldPaths', key) for key in update] + [('currentDocument.updateTime', original['updateTime'])])
    try:
        request('https://firestore.googleapis.com/v1/' + original['name'] + '?' + query, {'fields': update}, 'PATCH')
        saved = request('https://firestore.googleapis.com/v1/' + original['name'])
        assert all(saved['fields'].get(key) == value for key, value in original['fields'].items() if key not in update)
        break
    except urllib.error.HTTPError as error:
        if error.code not in (409, 412) or attempt == 2:
            raise
saved = request(BASE + '/appConfig/releaseLog')['fields']['items']['arrayValue']['values']
matches = [entry['mapValue']['fields'] for entry in saved if entry.get('mapValue', {}).get('fields', {}).get('id') == string(item_id)]
assert matches == [item]
receipt = {'id': item_id, 'readBackVerified': True, 'version': 'next', 'localOnly': True, 'deployed': False}
(OUT / 'recurrence-release-log-receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(receipt))
