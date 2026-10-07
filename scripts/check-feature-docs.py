"""Read-only checks for repository feature documentation. No external packages."""
from pathlib import Path
import hashlib
import json
import re
import sys
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/features'

def source_digest(path, source):
    data = path.read_bytes()
    if source.get('hashMode') == 'text-lf':
        data = data.replace(b'\r\n', b'\n')
    return hashlib.sha256(data).hexdigest()

def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    failures = []
    docs = sorted(BASE.rglob('*.md'))
    content = {p: p.read_text(encoding='utf-8') for p in docs}
    for doc, body in content.items():
        for target in re.findall(r'!?\[[^\]]*\]\((<[^>]+>|[^)]+)\)', body):
            target = target.strip('<>').split('#')[0]
            if target and not re.match(r'^[a-z]+:', target) and not (doc.parent / unquote(target)).exists():
                failures.append(f'{doc.relative_to(ROOT)}: missing {target}')
    for source in sorted((ROOT / 'src/screens').rglob('*.tsx')):
        name = source.relative_to(ROOT).as_posix()
        if not any(name in body for doc, body in content.items() if 'reviews' not in doc.parts and doc.name != 'coverage.md'):
            failures.append(f'unmapped screen: {name}')
    pair_file = BASE / 'document-pairs.json'
    pairs = json.loads(pair_file.read_text(encoding='utf-8')) if pair_file.exists() else []
    domains = {'entry', 'home', 'profile', 'clubs', 'rounds', 'statistics', 'chat', 'shared'}
    technical_docs = {p.relative_to(BASE).as_posix() for p in docs
                      if p.parent.name in domains and p.name != 'README.md'
                      and not p.name.endswith('.simple.md')}
    simple_docs = {p.relative_to(BASE).as_posix() for p in docs if p.name.endswith('.simple.md')}
    if {p['technical'] for p in pairs} != technical_docs:
        failures.append('document pairs do not cover every feature technical document')
    if {p['simple'] for p in pairs} != simple_docs:
        failures.append('document pairs do not cover every simple document')
    if len({p['technical'] for p in pairs}) != len(pairs):
        failures.append('duplicate document pairs')
    for pair in pairs:
        technical, simple = BASE / pair['technical'], BASE / pair['simple']
        if not technical.is_file() or not simple.is_file():
            failures.append(f'missing document pair: {pair["technical"]}')
            continue
        if f'({simple.name})' not in content[technical] or f'({technical.name})' not in content[simple]:
            failures.append(f'document pair missing reciprocal links: {pair["technical"]}')
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
        if not path.is_file() or source_digest(path, source) != source['sha256']:
            failures.append(f'historical source missing or changed: {source["key"]}')
    extra_path = BASE / 'additional-source-catalog.json'
    extras = json.loads(extra_path.read_text(encoding='utf-8')) if extra_path.exists() else []
    for source in extras:
        path = ROOT / source['path']
        if not path.is_file() or source_digest(path, source) != source['sha256']:
            failures.append(f'additional source missing or changed: {source["path"]}')
        if not (BASE / source['review']).is_file():
            failures.append(f'additional source review missing: {source["review"]}')
    failures = list(dict.fromkeys(failures))
    result = dict(documents=len(docs), featurePairs=len(pairs), screenFiles=len(list((ROOT / 'src/screens').rglob('*.tsx'))), screenshots=len(shots), historicalSources=len(sources), additionalSources=len(extras), failures=failures)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if failures else 0

if __name__ == '__main__':
    sys.exit(main())
