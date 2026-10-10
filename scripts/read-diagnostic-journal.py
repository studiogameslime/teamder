"""Print a diagnostic export locally. Never execute recorded actions."""
import argparse
import json
from pathlib import Path


def snapshots(document):
    if isinstance(document, str):
        document = json.loads(document)
    if not isinstance(document, dict):
        return
    if document.get('schema') == 1 and isinstance(document.get('entries'), list):
        yield 'journal', document
        return
    # Also accept a Firestore REST document, without needing credentials.
    fields = document.get('fields', document)
    for key in ('journal', 'lastJournal', 'previousJournal'):
        value = fields.get(key)
        if isinstance(value, dict):
            value = value.get('stringValue')
        if not value:
            continue
        try:
            snapshot = json.loads(value) if isinstance(value, str) else value
            if snapshot.get('schema') == 1 and isinstance(snapshot.get('entries'), list):
                yield key, snapshot
        except (ValueError, AttributeError):
            continue


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file', type=Path)
    args = parser.parse_args()
    if args.file.stat().st_size > 2_000_000:
        parser.error('Export exceeds 2 MB')
    document = json.loads(args.file.read_text(encoding='utf-8-sig'))
    found = False
    for name, snapshot in snapshots(document):
        found = True
        print(f"{name}: session={snapshot.get('sessionId')} total={snapshot.get('total')} omitted={snapshot.get('omitted', 0)}")
        previous = 0
        for entry in snapshot['entries']:
            seq = int(entry.get('seq', 0))
            if seq > previous + 1:
                print(f'  [... {seq-previous-1} steps omitted ...]')
            previous = seq
            data = json.dumps(entry.get('data', {}), ensure_ascii=False)
            print(f"  #{seq:04d} +{entry.get('ms', 0)}ms {entry.get('kind')} {entry.get('name')} screen={entry.get('screen', '-')} {data}")
    if not found:
        parser.error('No supported diagnostic journal found')


if __name__ == '__main__':
    main()
