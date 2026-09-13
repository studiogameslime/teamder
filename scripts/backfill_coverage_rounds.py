#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Backfill the coverage denominators `csRounds` and `asRounds`.

`communityPlayerStats` counts how many times something HAPPENED — cleanSheets,
assists — but never how many mini-games the metric was actually being measured
in. Dividing either by `rounds` therefore includes rounds from before that
metric existed:

    assists     collected from 2026-06-21   (commit d5533a1)
    cleanSheets collected from 2026-08-17   (commit 3321aff)
    the app     has existed since 2026-04-28

In the big club that is 229 of 1,044 player-rounds (22%) with no clean sheet
data at all, so `cleanSheets / rounds` understates every affected player by
about a fifth — and looks like a real number while doing it.

commitRoundStats now increments `csRounds` and `asRounds` alongside `rounds`,
so everything from here forward is covered. This closes the gap behind it.

    python3 scripts/backfill_coverage_rounds.py                 # DRY RUN
    python3 scripts/backfill_coverage_rounds.py --group <id>    # one club
    python3 scripts/backfill_coverage_rounds.py --commit        # write

A round counts as covered when its game is in the metric's era. For clean
sheets a PRE-era game also counts if scripts/backfill_clean_sheets.py already
credited it — that run left `games/{id}/statBackfills/cleanSheets` behind, and
those games do carry real clean-sheet data.

Per-player rounds come from `gamePlayerStats/{gameId}__{uid}`. Games with no
such documents contribute nothing, which is correct: every one of them predates
both eras, so its rounds are genuinely uncovered.

Safety:
  • Dry run unless --commit.
  • Absolute `set`, never `increment`, so re-running converges instead of
    doubling. The marker below is belt and braces, not the mechanism.
  • `games/{id}` is never touched. Only communityPlayerStats fields
    `csRounds` / `asRounds` are written.
  • Both are clamped to `rounds`: a denominator larger than the population it
    describes would produce a percentage over 100.
"""
import argparse, json, subprocess, sys, urllib.error, urllib.request
from collections import defaultdict

PROJECT = "soccer-app-52b6b"
API_ROOT = "https://firestore.googleapis.com/v1"
BASE = f"{API_ROOT}/projects/{PROJECT}/databases/(default)/documents"

# Era boundaries, from the commits that introduced each metric. Deliberately
# the COMMIT date rather than a deploy date: erring early would count
# uncollected rounds as covered, which is the failure we are fixing.
ASSISTS_FROM = 1781989200000   # 2026-06-21 00:00 Asia/Jerusalem
CLEANSHEET_FROM = 1786914000000  # 2026-08-17 00:00 Asia/Jerusalem

TOKEN = subprocess.run(
    ["gcloud", "auth", "print-access-token"], capture_output=True, text=True
).stdout.strip()
H = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def req(url, method="GET", body=None):
    r = urllib.request.Request(
        url, headers=H, method=method,
        data=json.dumps(body).encode() if body is not None else None)
    try:
        return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        print(f"  ! {e.code} {e.read().decode()[:200]}", file=sys.stderr)
        raise


def val(v):
    k = next(iter(v))
    if k == "integerValue":
        return int(v[k])
    if k == "doubleValue":
        return float(v[k])
    if k == "booleanValue":
        return v[k]
    if k == "nullValue":
        return None
    if k == "arrayValue":
        return [val(x) for x in v[k].get("values", [])]
    if k == "mapValue":
        return {a: val(b) for a, b in v[k].get("fields", {}).items()}
    return v[k]


def fields(d):
    return {a: val(b) for a, b in (d.get("fields") or {}).items()}


def query(collection, where=None, limit=2000, parent=""):
    q = {"from": [{"collectionId": collection}], "limit": limit}
    if where:
        field, value = where
        q["where"] = {"fieldFilter": {
            "field": {"fieldPath": field}, "op": "EQUAL",
            "value": {"stringValue": value}}}
    res = req(f"{BASE}{parent}:runQuery", "POST", {"structuredQuery": q}) or []
    return [r["document"] for r in res if "document" in r]


def club_ids():
    return [d["name"].rsplit("/", 1)[-1] for d in query("groups")]


def covered_games(group_id):
    """(games covered for clean sheets, games covered for assists)."""
    cs, asst, skipped = set(), set(), 0
    for g in query("games", where=("groupId", group_id)):
        gid = g["name"].rsplit("/", 1)[-1]
        f = fields(g)
        if f.get("status") != "finished":
            continue
        starts = f.get("startsAt") or 0
        if starts >= ASSISTS_FROM:
            asst.add(gid)
        if starts >= CLEANSHEET_FROM:
            cs.add(gid)
        elif req(f"{BASE}/games/{gid}/statBackfills/cleanSheets") is not None:
            # Credited retroactively by backfill_clean_sheets.py — real data.
            cs.add(gid)
        else:
            skipped += 1
    return cs, asst, skipped


def rounds_by_player(game_ids):
    """uid -> rounds, summed over the given games."""
    out = defaultdict(int)
    for gid in game_ids:
        for d in query("gamePlayerStats", where=("gameId", gid)):
            f = fields(d)
            uid = f.get("userId")
            if not uid or f.get("isGuest"):
                continue  # guests have no communityPlayerStats row
            out[uid] += f.get("rounds") or 0
    return out


def run(group_id, commit):
    cs_games, as_games, skipped = covered_games(group_id)
    rows = query("communityPlayerStats", where=("groupId", group_id))
    if not rows:
        return 0, 0

    cs_rounds = rounds_by_player(cs_games)
    as_rounds = rounds_by_player(as_games)

    print(f"\n  club {group_id}")
    print(f"    games covered — clean sheets {len(cs_games)}, "
          f"assists {len(as_games)}, uncovered {skipped}")

    written = 0
    total_rounds = total_cs = 0
    for d in rows:
        f = fields(d)
        uid = f.get("userId")
        if not uid:
            continue
        rounds = f.get("rounds") or 0
        # Clamp: a denominator can never exceed the rounds it describes.
        cs = min(cs_rounds.get(uid, 0), rounds)
        asst = min(as_rounds.get(uid, 0), rounds)
        total_rounds += rounds
        total_cs += cs
        if f.get("csRounds") == cs and f.get("asRounds") == asst:
            continue
        written += 1
        if commit:
            # `document.name` is a RELATIVE resource path
            # ("projects/…/documents/…"), not a URL — urllib rejects it
            # outright, which is how this was caught before anything was
            # written. API_ROOT turns it back into an address.
            req(f"{API_ROOT}/{d['name']}?updateMask.fieldPaths=csRounds"
                f"&updateMask.fieldPaths=asRounds", "PATCH",
                {"fields": {"csRounds": {"integerValue": str(cs)},
                            "asRounds": {"integerValue": str(asst)}}})

    pct = (100 * total_cs / total_rounds) if total_rounds else 0
    print(f"    player-rounds {total_rounds} · with clean-sheet data "
          f"{total_cs} ({pct:.0f}%)")
    print(f"    rows {'written' if commit else 'to write'}: {written}")
    return written, len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", help="one club id (default: every club)")
    ap.add_argument("--commit", action="store_true", help="actually write")
    a = ap.parse_args()

    if not TOKEN:
        sys.exit("no gcloud token — run `gcloud auth login`")

    groups = [a.group] if a.group else club_ids()
    print(f"{'COMMIT' if a.commit else 'DRY RUN'} · {len(groups)} club(s)")

    total_w = total_r = 0
    for gid in groups:
        w, r = run(gid, a.commit)
        total_w += w
        total_r += r

    print(f"\n{'wrote' if a.commit else 'would write'} {total_w} of "
          f"{total_r} player rows")
    if not a.commit:
        print("re-run with --commit to apply")


if __name__ == "__main__":
    main()
