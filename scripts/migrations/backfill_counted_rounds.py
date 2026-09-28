"""
countedRounds backfill.

`scorelessRounds` and `shootoutRounds` went live on 26.07.2026 (commit ced5513).
`rounds` was already accumulating before that, so dividing one by the other
reports a rate over a sample that never existed. `countedRounds` is the matching
denominator and it only starts counting from 28.09.2026, leaving every club's
existing history without one.

This fills it in:

    preCut        = mini-games committed BEFORE 26.07, summed per evening from
                    `rotation.round - 1` (calibrated against the one evening
                    that also carries `committedRoundCount`: 11 vs 10)
    lowerBound    = max(scorelessRounds, shootoutRounds + tiedRounds)
                    — the denominator can never be smaller than the outcomes it
                    has to contain, which is what saves the clubs where the
                    per-evening proxy overshoots
    countedRounds = min(rounds, max(rounds - preCut, lowerBound))

For any club whose first committed round is after 26.07 — every club created
since, and most of the existing ones — preCut is 0 and the result is EXACT.
Only a club with pre-26.07 history carries the proxy's error, and there the
band is about two percentage points.
"""
import json, urllib.request, os, sys, datetime

DRY = '--apply' not in sys.argv
TOK = os.popen('gcloud auth print-access-token 2>/dev/null').read().strip()
ROOT = "https://firestore.googleapis.com/v1/projects/soccer-app-52b6b/databases/(default)/documents"
CUT = datetime.datetime(2026, 7, 26).timestamp() * 1000

def rq(q):
    r = urllib.request.urlopen(urllib.request.Request(ROOT + ":runQuery", method='POST',
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'},
        data=json.dumps(q).encode()))
    return [x['document'] for x in json.load(r) if x.get('document')]

def patch(path, fields):
    mask = "&".join(f"updateMask.fieldPaths={k}" for k in fields)
    urllib.request.urlopen(urllib.request.Request(f"{ROOT}/{path}?{mask}", method='PATCH',
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'},
        data=json.dumps({"fields": fields}).encode()))

g = lambda f, k: list(f[k].values())[0] if k in f else None
num = lambda f, k: int(g(f, k) or 0)

def evenings(gid):
    """(startsAt, mini-games committed) for every finished evening, oldest first."""
    out = []
    for x in rq({"structuredQuery": {"from": [{"collectionId": "games"}],
                 "where": {"fieldFilter": {"field": {"fieldPath": "groupId"}, "op": "EQUAL",
                           "value": {"stringValue": gid}}}, "limit": 400}}):
        f = x['fields']
        if g(f, 'status') != 'finished':
            continue
        # `committedRoundCount` is exact but recent; `rotation.round` is the
        # next round's index and exists on every evening, so it is one too many.
        exact = g(f, 'committedRoundCount')
        if exact is not None:
            n = int(exact)
        else:
            rot = f.get('rotation', {}).get('mapValue', {}).get('fields', {})
            n = max(0, (int(list(rot['round'].values())[0]) if 'round' in rot else 0) - 1)
        out.append((int(g(f, 'startsAt') or 0), n))
    out.sort()
    return out

def counted(rounds, scoreless, shootout, tied, pre):
    lower = max(scoreless, shootout + tied)
    return min(rounds, max(rounds - pre, lower))

plans = []

# ── 1. communityStats — the running season, or all of it for a club with none ──
for d in rq({"structuredQuery": {"from": [{"collectionId": "communityStats"}], "limit": 400}}):
    f = d['fields']; gid = d['name'].split('/')[-1]
    rounds = num(f, 'rounds')
    if rounds == 0:
        continue
    sc, sh, ti = num(f, 'scorelessRounds'), num(f, 'shootoutRounds'), num(f, 'tiedRounds')
    # A club running seasons has had `rounds` zeroed by the last close, so the
    # live window starts THERE, not at the club's first evening. Counting the
    # whole history would charge the running season with mini-games that were
    # sealed into an archive months ago.
    win = 0
    try:
        gd = json.load(urllib.request.urlopen(urllib.request.Request(
            f"{ROOT}/groups/{gid}", headers={'Authorization': f'Bearer {TOK}'})))
        se = gd['fields'].get('seasons', {}).get('mapValue', {}).get('fields', {})
        if se.get('enabled', {}).get('booleanValue'):
            win = int(list(se['startedAt'].values())[0]) if 'startedAt' in se else 0
    except Exception:
        win = 0
    pre = sum(n for ts, n in evenings(gid) if win <= ts < CUT)
    cr = counted(rounds, sc, sh, ti, pre)
    plans.append((f'communityStats/{gid}', gid, rounds, sc, sh, ti, pre, cr, g(f, 'groupId')))

# ── 2. seasonSummary — each sealed season keeps its own sample ─────────────────
arch = sorted(rq({"structuredQuery": {"from": [{"collectionId": "seasonSummary"}], "limit": 400}}),
              key=lambda d: int(g(d['fields'], 'endedAt') or g(d['fields'], 'closedAt') or 0))
prev_end = {}
for d in arch:
    f = d['fields']; did = d['name'].split('/')[-1]; gid = did.split('__')[0]
    tot = f.get('totals', {}).get('mapValue', {}).get('fields', {})
    if not tot:
        continue
    t = lambda k: int(list(tot[k].values())[0]) if k in tot else 0
    rounds = t('rounds')
    if rounds == 0:
        continue
    end = int(g(f, 'endedAt') or g(f, 'closedAt') or 0)
    start = prev_end.get(gid, 0)
    prev_end[gid] = end
    pre = sum(n for ts, n in evenings(gid) if start <= ts < min(CUT, end))
    cr = counted(rounds, t('scorelessRounds'), t('shootoutRounds'), t('tiedRounds'), pre)
    plans.append((f'seasonSummary/{did}', did, rounds, t('scorelessRounds'),
                  t('shootoutRounds'), t('tiedRounds'), pre, cr, None))

print(f'{"מסמך":<34}{"rounds":>7}{"0:0":>5}{"pens":>6}{"ties":>6}{"לפני":>6}{"counted":>9}   0:0%')
for path, _id, rounds, sc, sh, ti, pre, cr, _ in plans:
    pct = f'{sc/cr*100:4.0f}%' if cr else '   —'
    exact = '' if pre else '  (מדויק)'
    print(f'{path:<34}{rounds:>7}{sc:>5}{sh:>6}{ti:>6}{pre:>6}{cr:>9}  {pct}{exact}')

if DRY:
    print(f'\n[הרצה יבשה] {len(plans)} מסמכים. הרץ עם --apply כדי לכתוב.')
else:
    for path, _id, *_ , cr, _g in plans:
        fields = {"countedRounds": {"integerValue": str(cr)}}
        if path.startswith('seasonSummary/'):
            fields = {"totals.countedRounds": {"integerValue": str(cr)}}
            mask = "updateMask.fieldPaths=totals.countedRounds"
            urllib.request.urlopen(urllib.request.Request(f"{ROOT}/{path}?{mask}", method='PATCH',
                headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'},
                data=json.dumps({"fields": {"totals": {"mapValue": {"fields":
                     {"countedRounds": {"integerValue": str(cr)}}}}}}).encode()))
        else:
            patch(path, fields)
        print(f'  ✓ {path} → countedRounds={cr}')
    print(f'\nנכתבו {len(plans)} מסמכים.')
