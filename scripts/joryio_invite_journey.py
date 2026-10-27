"""Create a draft and copy aggregate journey metrics to Pulse. Never activates or sends."""
import argparse
import base64
import json
import math
import os
from pathlib import Path
import subprocess
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://api-eu1.joryio.com/api'
DEFINITION = ROOT / 'docs/joryio-journeys/05-organiser-invites.json'
RECEIPT = ROOT / 'docs/joryio-journeys/05-organiser-invites.receipt.json'
DOC = 'appConfig/joryioInviteJourney'
FS = 'https://firestore.googleapis.com/v1/projects/soccer-app-52b6b/databases/(default)/documents'


def request(url, token, data=None, method=None):
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json', 'User-Agent': 'curl/8.0'},
        data=json.dumps(data, ensure_ascii=False).encode() if data is not None else None, method=method)
    with urllib.request.urlopen(req, timeout=35) as response:
        return json.load(response)


def management_key():
    key = os.environ.get('JORYIO_API_KEY', '').strip()
    if not key:
        path = ROOT / 'credentials/joryio-management-key.txt'
        if path.exists():
            key = ''.join(line.strip() for line in path.read_text().splitlines() if not line.lstrip().startswith('#'))
    if not key.startswith('jry_live_'):
        raise ValueError('Missing management credential')
    return key


def node(node_id, kind, title, **config):
    return {'id': node_id, 'type': kind, 'position': {'x': 0, 'y': 0}, 'config': {'blockName': title, **config}}


def group_event(event):
    return {'type': 'event', 'operator': 'performed', 'eventName': event,
        'propertyConditions': [{'property': 'groupId', 'operator': 'equals', 'value': '{{ trigger.properties.groupId }}'}]}


def branch(node_id, title, event):
    return node(node_id, 'condition', title, branchMode='yesno',
        filterGroups=[{'operator': 'AND', 'filters': [group_event(event)]}])


def definition():
    html = (ROOT / 'docs/joryio-journeys/inapp/organiser-invite.html').read_text(encoding='utf-8')
    stadium = base64.b64encode((ROOT / 'docs/joryio-journeys/inapp/organiser-stadium.jpg').read_bytes()).decode('ascii')
    html = html.replace('src="organiser-stadium.jpg"', 'src="data:image/jpeg;base64,' + stadium + '"')
    again = html.replace('המועדון מוכן.<br>מביאים את החבורה.', 'עדיין חסר מישהו<br>בחבורה?').replace(
        'שלח קישור אחד בקבוצת הוואטסאפ שלכם, והחברים יוכלו להצטרף למועדון.',
        'אפשר לשתף שוב את קישור המועדון עם החברים שעדיין לא הצטרפו.')
    def inapp(node_id, title, content):
        return node(node_id, 'in_app_message', title, customContent={'mode': 'html', 'html': content},
            _note='Requires the club-invite action handler in the next Teamder release. Verify display expiry and one-show delivery before activation.')
    nodes = [
        node('created', 'trigger', 'המארגן יצר מועדון', triggerType='event', eventName='Community Created'),
        inapp('invite_inapp', 'הודעה ראשונה בתוך האפליקציה', html),
        node('day_one', 'delay', 'המתנה של יום', delayType='duration', value=1, unit='days'),
        branch('ready_day_one', 'האם המועדון כבר הגיע ליעד?', 'Club Became Playable'),
        branch('shared', 'האם שותפה הזמנה למועדון הזה?', 'Invite Shared'),
        node('push_allowed', 'condition', 'האם יש הרשאה להתראות?', branchMode='yesno',
            filterGroups=[{'operator': 'AND', 'filters': [{'type': 'attribute', 'field': 'push_permission', 'operator': 'equals', 'value': 'granted'}]}]),
        node('invite_push', 'message', 'פוש אחד למי שעדיין לא שיתף', channel='push',
            pushTitle='מביאים את החבורה למועדון',
            pushBody='קישור אחד בקבוצת הוואטסאפ, והחברים יכולים להצטרף. פתח את המועדון ושתף הזמנה.',
            pushDeepLink='footy://team/{{ trigger.properties.groupId }}',
            appIds=['61169e4e-72ab-45fd-84f0-7ec606be0424', '582c204f-327e-4d76-9703-b8655454b887'],
            pushPlatforms=['ios', 'android']),
        node('day_three', 'delay', 'המתנה של יומיים נוספים', delayType='duration', value=2, unit='days'),
        branch('ready_day_three', 'בדיקת יעד לפני התזכורת האחרונה', 'Club Became Playable'),
        inapp('invite_followup', 'הודעה אחרונה בתוך האפליקציה', again),
    ]
    for i, row in enumerate(nodes):
        row['position'] = {'x': (i % 5) * 320, 'y': (i // 5) * 300}
    edges = []
    def edge(source, target, port=None):
        edges.append({'id': f'{source}_{target}', 'source': source, 'target': target,
            **({'sourceHandle': port} if port else {})})
    edge('created', 'invite_inapp'); edge('invite_inapp', 'day_one'); edge('day_one', 'ready_day_one')
    edge('ready_day_one', 'shared', 'no')
    edge('shared', 'day_three', 'yes'); edge('shared', 'push_allowed', 'no')
    edge('push_allowed', 'invite_push', 'yes'); edge('push_allowed', 'day_three', 'no')
    edge('invite_push', 'day_three'); edge('day_three', 'ready_day_three')
    edge('ready_day_three', 'invite_followup', 'no')
    return {'name': 'מארגן חדש מזמין את החבורה למועדון',
        'description': 'מועדון חדש, שתי הודעות בתוך האפליקציה ופוש אחד רק אם לא שותפה הזמנה. התנאים מקושרים למזהה המועדון באירוע הכניסה. טיוטה בלבד עד אימות ההודעות, שעות השקט, תוקף ההצגה והגרסה התומכת בשיתוף.',
        'sendType': 'trigger', 'entryTrigger': {'type': 'event', 'config': {'eventName': 'Community Created'}},
        'nodes': nodes, 'edges': edges, 'tags': ['teamder-organiser-invites-v1'],
        'settings': {'timezone': 'Asia/Jerusalem', 'reEntryPolicy': {'mode': 'block', 'minIntervalMinutes': 43200}}}


def count(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def snapshot(journey, stats, analytics):
    """Copy only aggregate facts. Missing metrics remain null, never an invented zero."""
    rows = []
    for item in journey['nodes']:
        metrics = analytics.get(item['id'], {})
        rows.append({'id': item['id'], 'label': item['config'].get('blockName', item['id']), 'type': item['type'],
            'entered': count(metrics.get('entered')), 'proceeded': count(metrics.get('proceededToNext')),
            'sent': count(metrics.get('sent')), 'displayed': count(metrics.get('impressions', metrics.get('displayed'))),
            'clicked': count(metrics.get('clicks', metrics.get('clicked')))})
    return {'schemaVersion': 1, 'journeyId': journey['id'], 'name': journey['name'], 'status': journey['status'],
        'source': BASE, 'syncedAt': int(time.time() * 1000), 'syncMode': 'manual', 'range': 'all_time',
        'entries': count(stats.get('totalEntries')), 'active': count(stats.get('active')),
        'completed': count(stats.get('completed')), 'exited': count(stats.get('exited')),
        'failed': count(stats.get('failed')), 'steps': rows}


def fs_value(value):
    if value is None: return {'nullValue': None}
    if isinstance(value, bool): return {'booleanValue': value}
    if isinstance(value, int): return {'integerValue': str(value)}
    if isinstance(value, float): return {'doubleValue': value}
    if isinstance(value, str): return {'stringValue': value}
    if isinstance(value, list): return {'arrayValue': {'values': [fs_value(v) for v in value]}}
    return {'mapValue': {'fields': {k: fs_value(v) for k, v in value.items()}}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--create-draft', action='store_true')
    parser.add_argument('--sync-pulse', action='store_true')
    args = parser.parse_args()
    body = definition()
    DEFINITION.write_text(json.dumps(body, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if not (args.create_draft or args.sync_pulse):
        print(json.dumps({'prepared': True, 'nodes': len(body['nodes'])})); return
    key = management_key()
    if RECEIPT.exists():
        receipt = json.loads(RECEIPT.read_text(encoding='utf-8'))
        journey = request(BASE + '/journeys/' + urllib.parse.quote(receipt['id'], safe=''), key)
    elif args.create_draft:
        # Recover an unknown prior creation by the unique tag; never create a duplicate on retry.
        found = request(BASE + '/journeys?tags=teamder-organiser-invites-v1&limit=100', key)['data']
        if len(found) > 1: raise ValueError('Ambiguous tagged journeys')
        journey = request(BASE + '/journeys/' + found[0]['id'], key) if found else request(BASE + '/journeys', key, body, 'POST')
    else:
        raise ValueError('Create and verify the draft first')
    if args.create_draft:
        if journey['status'] != 'draft': raise ValueError('Refusing to update a live journey')
        # Only an explicitly requested draft can be updated. This command never activates.
        if any(journey.get(k) != body[k] for k in ('nodes', 'edges', 'settings')):
            journey = request(BASE + '/journeys/' + journey['id'], key, body, 'PUT')
        saved = request(BASE + '/journeys/' + journey['id'], key)
        assert saved['status'] == 'draft' and saved['nodes'] == body['nodes'] and saved['edges'] == body['edges']
        RECEIPT.write_text(json.dumps({'id': saved['id'], 'status': 'draft', 'readBackVerified': True,
            'source': BASE, 'activationApproved': False}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        journey = saved
    stats = request(BASE + '/journeys/' + journey['id'] + '/stats', key)
    analytics = request(BASE + '/journeys/' + journey['id'] + '/node-analytics', key)
    report = snapshot(journey, stats, analytics)
    out = ROOT / 'artifacts/joryio-invites'; out.mkdir(parents=True, exist_ok=True)
    (out / 'snapshot.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    review = request(BASE + '/journeys/' + journey['id'] + '/launch-review', key)
    (out / 'launch-review.json').write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding='utf-8')
    if args.sync_pulse:
        gcloud = os.environ.get('GCLOUD_CMD', str(Path(os.environ['LOCALAPPDATA']) / 'TeamderTools/google-cloud-sdk/bin/gcloud.cmd'))
        token = subprocess.run([gcloud, 'auth', 'print-access-token'], capture_output=True, text=True, check=True, timeout=45).stdout.strip()
        fields = {k: fs_value(v) for k, v in report.items()}
        saved = request(FS + '/' + DOC, token, {'fields': fields}, 'PATCH')
        readback = request('https://firestore.googleapis.com/v1/' + saved['name'], token)
        assert readback['fields'] == fields
    print(json.dumps({'id': journey['id'], 'status': journey['status'], 'nodes': len(report['steps']),
        'entries': report['entries'], 'pulseSynced': args.sync_pulse, 'readBackVerified': True, 'activated': False}))


if __name__ == '__main__':
    main()
