"""Bounded Pulse review handover. Does not close items or modify permissions."""
import argparse
import base64
import json
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request
import pulse_mcp as pulse

COLLECTIONS = {'tasks', 'feedback', 'errors', 'pulseFeatures', 'pulseIdeas'}
FIELDS = ('claudeStatus', 'claudeNote', 'claudeImages', 'claudeAt')


def prepare(item, directory):
    collection, doc_id = item.get('collection'), item.get('id')
    if collection not in COLLECTIONS or not isinstance(doc_id, str) or not doc_id or '/' in doc_id or doc_id in ('.', '..'):
        raise ValueError('Invalid handover target')
    if item.get('claudeStatus') != 'done':
        raise ValueError('Only review handovers are supported')
    note = item.get('claudeNote')
    if not isinstance(note, str) or not note.strip() or len(note) > 12000:
        raise ValueError('Invalid handover note')
    paths = item.get('claudeImages')
    if not isinstance(paths, list) or not 1 <= len(paths) <= 3:
        raise ValueError('One to three proof screenshots are required')
    images = []
    for value in paths:
        if not isinstance(value, str):
            raise ValueError('Invalid proof path')
        path = (directory / value).resolve()
        if not path.is_relative_to(directory.resolve()):
            raise ValueError('Proof must stay in the handover directory')
        raw = path.read_bytes()
        if not raw.startswith(b'\xff\xd8\xff') or len(raw) > 500000:
            raise ValueError('Proof must be a bounded JPEG')
        images.append(base64.b64encode(raw).decode('ascii'))
    if sum(len(image) for image in images) > 800000:
        raise ValueError('Combined proof images are too large')
    return collection, doc_id, note.strip(), images


def read(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=pulse.headers()), timeout=30) as response:
        return json.load(response)


def apply(prepared):
    collection, doc_id, note, images = prepared
    url = pulse.BASE + '/' + collection + '/' + urllib.parse.quote(doc_id, safe='')
    original = read(url)
    previous = original.get('fields', {})
    # Parked ideas never become actionable merely because a handover file exists.
    if collection == 'pulseIdeas' and pulse.unwrap(previous.get('status', {})) not in ('spec', 'build'):
        raise ValueError('Parked ideas cannot receive work handovers')
    old_note = pulse.unwrap(previous.get('claudeNote', {'stringValue': ''}))
    if old_note is not None and not isinstance(old_note, str):
        raise ValueError('Existing handover note is not text')
    # Re-running a verified handover is a read-only operation, not a duplicate note.
    if (pulse.unwrap(previous.get('claudeStatus', {})) == 'done'
            and isinstance(old_note, str) and old_note.endswith(note)
            and pulse.unwrap(previous.get('claudeImages', {})) == images):
        return {'collection': collection, 'id': doc_id, 'alreadyVerified': True}
    fields = {
        'claudeStatus': {'stringValue': 'done'},
        'claudeNote': {'stringValue': ((old_note + '\n\n') if old_note else '') + note},
        'claudeImages': {'arrayValue': {'values': [{'stringValue': image} for image in images]}},
        'claudeAt': {'integerValue': str(int(time.time() * 1000))},
    }
    if len(json.dumps({'fields': {**previous, **fields}}).encode()) > 950000:
        raise ValueError('Handover would exceed the document size limit')
    query = urllib.parse.urlencode([('updateMask.fieldPaths', field) for field in FIELDS]
                                  + [('currentDocument.updateTime', original['updateTime'])])
    request = urllib.request.Request(url + '?' + query, method='PATCH', headers=pulse.headers(),
                                     data=json.dumps({'fields': fields}).encode())
    with urllib.request.urlopen(request, timeout=30) as response:
        json.load(response)
    verified = read(url)
    actual = verified.get('fields', {})
    if any(actual.get(key) != value for key, value in fields.items()):
        raise RuntimeError('Handover read-back mismatch')
    if any(actual.get(key) != previous.get(key) for key in ('status', 'image', 'images')):
        raise RuntimeError('Source changed during handover; inspect before claiming completion')
    return {'collection': collection, 'id': doc_id, 'written': True, 'readBackVerified': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('handover', type=pathlib.Path)
    parser.add_argument('--apply', action='store_true', help='Save review fields and verify by reading back')
    args = parser.parse_args()
    try:
        data = json.loads(args.handover.read_text(encoding='utf-8'))
        # Validate the complete batch before the first mutation.
        prepared = [prepare(item, args.handover.parent) for item in data['items']]
        if not args.apply:
            print(json.dumps({'validated': len(prepared), 'productionUpdated': False}))
            return 0
        receipts = []
        for item in prepared:
            receipts.append(apply(item))
            print(json.dumps(receipts[-1]), flush=True)
        return 0
    except urllib.error.HTTPError as error:
        print(json.dumps({'error': 'Pulse request rejected', 'httpStatus': error.code}))
    except Exception as error:
        # Raw exceptions may contain native payloads or authorization material.
        print(json.dumps({'error': 'Handover failed', 'type': type(error).__name__}))
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
