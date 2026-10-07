"""Read-only checks for repository feature documentation. No external packages."""
from pathlib import Path
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/features'

def main():
    failures = []
    docs = sorted(BASE.rglob('*.md'))
    content = {p: p.read_text(encoding='utf-8') for p in docs}
    for doc, body in content.items():
        for target in re.findall(r'!?\[[^\]]*\]\((<[^>]+>|[^)]+)\)', body):
            target = target.strip('<>').split('#')[0]
            if target and not re.match(r'^[a-z]+:', target) and not (doc.parent / target).exists():
                failures.append(f'{doc.relative_to(ROOT)}: missing {target}')
    for source in sorted((ROOT / 'src/screens').rglob('*.tsx')):
        name = source.relative_to(ROOT).as_posix()
        if not any(name in body for doc, body in content.items() if 'reviews' not in doc.parts and doc.name != 'coverage.md'):
            failures.append(f'unmapped screen: {name}')
    shots = json.loads((BASE / 'screenshots/manifest.json').read_text(encoding='utf-8'))
    if len({s['file'] for s in shots}) != len(shots):
        failures.append('duplicate screenshot records')
    for shot in shots:
        path = BASE / 'screenshots' / shot['file']
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != shot['sha256']:
            failures.append(f'screenshot missing or changed: {shot["file"]}')
    sources = json.loads((BASE / 'source-catalog.json').read_text(encoding='utf-8'))
    if {s['key'] for s in sources} != {f'{i:03}' for i in range(1, 138)}:
        failures.append('historical source coverage must be 001–137')
    for source in sources:
        path = ROOT / source['path']
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != source['sha256']:
            failures.append(f'historical source missing or changed: {source["key"]}')
    result = dict(documents=len(docs), screenFiles=len(list((ROOT / 'src/screens').rglob('*.tsx'))), screenshots=len(shots), historicalSources=len(sources), failures=failures)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if failures else 0

if __name__ == '__main__':
    sys.exit(main())
