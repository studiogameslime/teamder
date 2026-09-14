#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build a season archive from LIVE production data and check it — writing nothing.

The emulator proves the mechanics: ordering, the create() latch, which fields
survive. What it cannot prove is that the archive is faithful to a real club's
real data, with its real gaps — guests who score but hold no row, rounds that
predate a metric, players who left, accounts that were deleted.

So this reads production, builds exactly the archive `closeSeason` would build,
and reconciles it against the live table. It performs NO writes of any kind:
there is no --commit flag, and adding one would be the wrong shape. A rollover
is a Cloud Function's job, not a laptop's.

    python3 scripts/season_rollover_dryrun.py --group <id>
    python3 scripts/season_rollover_dryrun.py            # every club with data

What it checks, and why each one has bitten this codebase before:

  • club goals vs the sum of player goals — guest goals are counted in the club
    total but have no player row, so these are EXPECTED to differ by exactly
    guestGoals. A different gap means something else is wrong.
  • rounds vs wins+losses+ties per player — holds only for rounds credited
    after the tie fix; older rows are short, and the archive must not pretend
    otherwise.
  • csRounds/asRounds never exceeding rounds — a denominator larger than its
    own population prints a percentage over 100.
  • every player row carrying a name, since a sealed table has to stay
    readable after somebody deletes their account.
"""
import argparse, json, subprocess, sys, urllib.error, urllib.request
from collections import defaultdict

PROJECT = "soccer-app-52b6b"
API_ROOT = "https://firestore.googleapis.com/v1"
BASE = f"{API_ROOT}/projects/{PROJECT}/databases/(default)/documents"

TOKEN = subprocess.run(
    ["gcloud", "auth", "print-access-token"], capture_output=True, text=True
).stdout.strip()
H = {"Authorization": f"Bearer {TOKEN}"}


def req(url):
    try:
        return json.load(urllib.request.urlopen(
            urllib.request.Request(url, headers=H)))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def query(collection, where=None, limit=3000):
    q = {"from": [{"collectionId": collection}], "limit": limit}
    if where:
        f, v = where
        q["where"] = {"fieldFilter": {"field": {"fieldPath": f}, "op": "EQUAL",
                                      "value": {"stringValue": v}}}
    r = urllib.request.Request(
        f"{BASE}:runQuery", headers={**H, "Content-Type": "application/json"},
        method="POST", data=json.dumps({"structuredQuery": q}).encode())
    res = json.load(urllib.request.urlopen(r))
    return [x["document"] for x in res if "document" in x]


def val(v):
    k = next(iter(v))
    if k == "integerValue":
        return int(v[k])
    if k == "doubleValue":
        return float(v[k])
    if k == "nullValue":
        return None
    if k == "arrayValue":
        return [val(x) for x in v[k].get("values", [])]
    if k == "mapValue":
        return {a: val(b) for a, b in v[k].get("fields", {}).items()}
    return v[k]


def fields(d):
    return {a: val(b) for a, b in (d.get("fields") or {}).items()}


PLAYER_FIELDS = ["goals", "assists", "rounds", "wins", "losses", "ties",
                 "games", "cleanSheets", "ownGoals", "penTaken", "penScored",
                 "penMissed", "penFaced", "penSaved", "penConceded",
                 "csRounds", "asRounds"]
CLUB_FIELDS = ["rounds", "goals", "guestGoals", "ownGoals", "tiedRounds",
               "shootoutRounds", "scorelessRounds"]


def num(v):
    return v if isinstance(v, (int, float)) else 0


def build_archive(group_id):
    """Exactly what closeSeason builds, in memory."""
    rows = query("communityPlayerStats", where=("groupId", group_id))
    club = fields(req(f"{BASE}/communityStats/{group_id}") or {})
    pairs_docs = query("communityPairStats", where=("groupId", group_id))

    players = {}
    for d in rows:
        f = fields(d)
        uid = f.get("userId")
        if not uid:
            continue
        players[uid] = {k: num(f.get(k)) for k in PLAYER_FIELDS}
        players[uid]["displayName"] = f.get("displayName") or ""

    totals = {k: num(club.get(k)) for k in CLUB_FIELDS}
    totals["assists"] = sum(p["assists"] for p in players.values())
    totals["cleanSheets"] = sum(p["cleanSheets"] for p in players.values())

    pairs = {}
    for d in pairs_docs:
        f = fields(d)
        a, b = f.get("a"), f.get("b")
        if a and b:
            pairs["__".join(sorted([a, b]))] = num(f.get("assists"))

    return players, totals, pairs


def check(group_id, name):
    players, totals, pairs = build_archive(group_id)
    if not players:
        return True

    print(f"\n  {name}  ({group_id})")
    print(f"    {len(players)} players · {len(pairs)} pairs")
    print(f"    club: {totals['rounds']} rounds · {totals['goals']} goals · "
          f"{totals['assists']} assists · {totals['cleanSheets']} clean sheets")

    ok = True

    # Guest goals live in the club total and in no player row. The gap should
    # be exactly guestGoals — anything else means a row is missing or double
    # counted.
    player_goals = sum(p["goals"] for p in players.values())
    gap = totals["goals"] - player_goals
    if gap == 0:
        print(f"    goals reconcile: club {totals['goals']} = players {player_goals}")
    else:
        print(f"    goals gap {gap:+d} (club {totals['goals']} vs players "
              f"{player_goals}); guestGoals = {totals['guestGoals']}")
        if gap != 0 and gap != totals["guestGoals"]:
            print("      ! gap is not explained by guest goals")
            ok = False

    # Denominators can never exceed the population they describe.
    over = [u for u, p in players.items()
            if p["csRounds"] > p["rounds"] or p["asRounds"] > p["rounds"]]
    if over:
        print(f"      ! {len(over)} rows where a coverage denominator "
              f"exceeds rounds")
        ok = False
    else:
        print("    coverage denominators within rounds: ok")

    # rounds = wins + losses + ties, from the tie fix onward only.
    short = [(u, p["rounds"] - (p["wins"] + p["losses"] + p["ties"]))
             for u, p in players.items()
             if p["rounds"] != p["wins"] + p["losses"] + p["ties"]]
    if short:
        worst = max(abs(d) for _, d in short)
        print(f"    {len(short)} rows where rounds != wins+losses+ties "
              f"(max {worst}) — expected for pre-tie-fix history")

    # A sealed table has to survive somebody deleting their account.
    nameless = [u for u, p in players.items() if not p["displayName"]]
    if nameless:
        print(f"    {len(nameless)} rows with no stored name — the archive "
              f"would freeze a blank")

    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--group")
    a = ap.parse_args()
    if not TOKEN:
        sys.exit("no gcloud token")

    print("DRY RUN — reads only, writes nothing")

    if a.group:
        g = fields(req(f"{BASE}/groups/{a.group}") or {})
        targets = [(a.group, g.get("name", "?"))]
    else:
        seen = defaultdict(int)
        for d in query("communityPlayerStats"):
            gid = fields(d).get("groupId")
            if gid:
                seen[gid] += 1
        targets = []
        for gid in seen:
            g = fields(req(f"{BASE}/groups/{gid}") or {})
            targets.append((gid, g.get("name", "(no group doc)")))

    all_ok = True
    for gid, name in targets:
        if not check(gid, name):
            all_ok = False

    print("\n" + ("all clubs reconcile" if all_ok
                  else "SOME CLUBS DID NOT RECONCILE — see the ! lines above"))


if __name__ == "__main__":
    main()
