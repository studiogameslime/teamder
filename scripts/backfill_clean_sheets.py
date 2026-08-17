#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Backfill the "שער נקי" (clean sheet) counter from stored round history.

A clean sheet is one mini-game whose side finished with nothing conceded,
credited to every player who counted as a participant in that mini-game —
exactly the rule `commitRoundStats` applies to new rounds.

  python3 scripts/backfill_clean_sheets.py                 # DRY RUN (default)
  python3 scripts/backfill_clean_sheets.py --group <id>    # one club
  python3 scripts/backfill_clean_sheets.py --commit        # actually write

Safety:
  • Dry run unless --commit is passed.
  • Each game is written in ONE atomic commit that also creates
    games/{id}/statBackfills/cleanSheets with an exists=false precondition, so
    a second run over the same game fails that precondition and changes
    nothing. Re-running is safe by construction, not by convention.
  • Only rounds credited BEFORE --cutoff are considered (default: now), so a
    round already credited live by commitRoundStats is never counted twice.
  • A game is only credited when its stored round history is provably complete:
    one roundHistory doc for every entry in the committedRounds latch. Anything
    less is reported and skipped rather than half-credited.

Participation is re-derived the same way commitRoundStats derives it: real
users only (guests have no cross-game identity), on the game roster, not marked
no-show, deduped, and never on both sides.
"""
import argparse, json, subprocess, sys, time, urllib.error, urllib.request
from collections import defaultdict

PROJECT = "soccer-app-52b6b"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
DEFAULT_GROUP = "0cdCmLhkaOdTsQA2AF0a"  # כדורגל אנשים טובים

TOKEN = subprocess.run(
    ["gcloud", "auth", "print-access-token"], capture_output=True, text=True
).stdout.strip()
H = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def val(x):
    if not isinstance(x, dict):
        return x
    k = next(iter(x))
    y = x[k]
    if k == "arrayValue":
        return [val(i) for i in y.get("values", [])]
    if k == "mapValue":
        return {kk: val(vv) for kk, vv in y.get("fields", {}).items()}
    if k == "integerValue":
        return int(y)
    if k == "doubleValue":
        return float(y)
    if k == "booleanValue":
        return bool(y)
    if k == "nullValue":
        return None
    return y


def flds(doc):
    return {k: val(v) for k, v in doc.get("fields", {}).items()}


def get(path):
    return json.load(urllib.request.urlopen(urllib.request.Request(BASE + path, headers=H)))


def post(path, body):
    return json.load(
        urllib.request.urlopen(
            urllib.request.Request(
                BASE + path, data=json.dumps(body).encode(), headers=H, method="POST"
            )
        )
    )


def page(path):
    """Every document under a collection path, following pageToken."""
    out, tok = [], None
    while True:
        url = f"{path}?pageSize=300" + (f"&pageToken={tok}" if tok else "")
        d = get(url)
        out += d.get("documents", [])
        tok = d.get("nextPageToken")
        if not tok:
            return out


def is_guest(i):
    return isinstance(i, str) and i.startswith("guest:")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", default=DEFAULT_GROUP)
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--cutoff", type=int, default=int(time.time() * 1000))
    args = ap.parse_args()

    res = post(
        ":runQuery",
        {
            "structuredQuery": {
                "from": [{"collectionId": "games"}],
                "where": {
                    "fieldFilter": {
                        "field": {"fieldPath": "groupId"},
                        "op": "EQUAL",
                        "value": {"stringValue": args.group},
                    }
                },
                "limit": 500,
            }
        },
    )
    games = [
        (d["document"]["name"].split("/")[-1], flds(d["document"]))
        for d in res
        if "document" in d
    ]
    finished = [(i, g) for i, g in games if g.get("status") == "finished"]
    finished.sort(key=lambda t: t[1].get("startsAt", 0), reverse=True)

    print(f"club {args.group}: {len(games)} games, {len(finished)} finished\n")

    eligible, skipped, per_player = [], [], defaultdict(int)
    per_player_games = defaultdict(set)
    anomalies = []

    for gid, g in finished:
        when = time.strftime("%d.%m.%Y", time.localtime(g.get("startsAt", 0) / 1000))
        rounds = [flds(d) for d in page(f"/games/{gid}/roundHistory")]
        latched = page(f"/games/{gid}/committedRounds")
        marker = None
        try:
            marker = get(f"/games/{gid}/statBackfills/cleanSheets")
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise

        if marker is not None:
            skipped.append((when, gid, "already backfilled"))
            continue
        if not rounds:
            skipped.append((when, gid, f"no roundHistory (latch has {len(latched)})"))
            continue
        if len(rounds) < len(latched):
            skipped.append(
                (when, gid, f"incomplete: {len(rounds)} stored vs {len(latched)} committed")
            )
            continue

        roster = set(g.get("players") or []) | set(g.get("waitlist") or [])
        arrivals = g.get("arrivals") or {}
        credits, usable, rejected = defaultdict(int), 0, 0

        for r in rounds:
            at = r.get("at")
            if isinstance(at, int) and at >= args.cutoff:
                rejected += 1
                anomalies.append(f"{when}: round {r.get('roundId')} is newer than the cutoff")
                continue
            sa, sb = r.get("scoreA"), r.get("scoreB")
            ta, tb = r.get("teamA") or [], r.get("teamB") or []
            if not isinstance(sa, int) or not isinstance(sb, int) or not ta or not tb:
                rejected += 1
                anomalies.append(f"{when}: round {r.get('roundId')} has no usable score/rosters")
                continue
            seen, A, B = set(), [], []
            for src, dst in ((ta, A), (tb, B)):
                for uid in src:
                    if (
                        isinstance(uid, str)
                        and uid
                        and not is_guest(uid)
                        and uid in roster
                        and arrivals.get(uid) != "no_show"
                        and uid not in seen
                    ):
                        seen.add(uid)
                        dst.append(uid)
            if not A or not B:
                rejected += 1
                anomalies.append(f"{when}: round {r.get('roundId')} has no real players on a side")
                continue
            usable += 1
            if sb == 0:
                for uid in A:
                    credits[uid] += 1
            if sa == 0:
                for uid in B:
                    credits[uid] += 1

        if usable == 0:
            skipped.append((when, gid, "no usable rounds"))
            continue
        eligible.append((when, gid, usable, rejected, dict(credits)))
        for uid, n in credits.items():
            per_player[uid] += n
            per_player_games[uid].add(gid)

    # names
    uids = sorted(per_player)
    names = {}
    for u in uids:
        try:
            names[u] = val(get(f"/users/{u}").get("fields", {}).get("name")) or u[:6]
        except Exception:
            names[u] = u[:6]

    print("=== games ===")
    for when, gid, usable, rejected, _ in eligible:
        extra = f"  ({rejected} rounds rejected)" if rejected else ""
        print(f"  ELIGIBLE  {when}  {gid[:14]}  {usable} rounds{extra}")
    for when, gid, why in skipped:
        print(f"  skipped   {when}  {gid[:14]}  — {why}")

    print(f"\nscanned {len(finished)} finished games")
    print(f"computable: {len(eligible)}")
    if eligible:
        print(f"oldest included: {eligible[-1][0]}")
    print(f"skipped: {len(skipped)}")

    print("\n=== clean sheets to be credited ===")
    print(f"{'player':22} {'clean sheets':>12} {'games':>7}")
    for u in sorted(per_player, key=lambda x: -per_player[x]):
        print(f"{names[u]:22} {per_player[u]:>12} {len(per_player_games[u]):>7}")
    total = sum(per_player.values())
    print(f"\n{len(per_player)} players, {total} clean sheets total")

    docs = 0
    for _, gid, _, _, credits in eligible:
        docs += 1 + 3 * len(credits)  # marker + 3 stores per player
    print(f"documents to touch: {docs} (marker + users/community/game rows)")

    if anomalies:
        print("\n=== anomalies ===")
        for a in anomalies[:40]:
            print(f"  {a}")

    if not args.commit:
        print("\nDRY RUN — nothing was written. Re-run with --commit to apply.")
        return

    print("\nwriting…")
    for when, gid, _, _, credits in eligible:
        writes = [
            {
                "update": {
                    "name": f"projects/{PROJECT}/databases/(default)/documents/games/{gid}/statBackfills/cleanSheets",
                    "fields": {
                        "at": {"integerValue": str(int(time.time() * 1000))},
                        "players": {"integerValue": str(len(credits))},
                        "credited": {"integerValue": str(sum(credits.values()))},
                    },
                },
                "currentDocument": {"exists": False},
            }
        ]
        for uid, n in credits.items():
            writes.append(
                {
                    "update": {
                        "name": f"projects/{PROJECT}/databases/(default)/documents/users/{uid}"
                    },
                    "updateMask": {"fieldPaths": []},
                    "updateTransforms": [
                        {"fieldPath": "stats.cleanSheets", "increment": {"integerValue": str(n)}}
                    ],
                }
            )
            writes.append(
                {
                    "update": {
                        "name": f"projects/{PROJECT}/databases/(default)/documents/communityPlayerStats/{args.group}__{uid}",
                        "fields": {
                            "groupId": {"stringValue": args.group},
                            "userId": {"stringValue": uid},
                        },
                    },
                    "updateMask": {"fieldPaths": ["groupId", "userId"]},
                    "updateTransforms": [
                        {"fieldPath": "cleanSheets", "increment": {"integerValue": str(n)}}
                    ],
                }
            )
            writes.append(
                {
                    "update": {
                        "name": f"projects/{PROJECT}/databases/(default)/documents/gamePlayerStats/{gid}__{uid}",
                        "fields": {
                            "gameId": {"stringValue": gid},
                            "userId": {"stringValue": uid},
                        },
                    },
                    "updateMask": {"fieldPaths": ["gameId", "userId"]},
                    "updateTransforms": [
                        {"fieldPath": "cleanSheets", "increment": {"integerValue": str(n)}}
                    ],
                }
            )
        try:
            post(":commit", {"writes": writes})
            print(f"  wrote {when} {gid[:14]} ({len(credits)} players)")
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            if "FAILED_PRECONDITION" in body or e.code == 409:
                print(f"  skipped {when} {gid[:14]} — already backfilled")
            else:
                print(f"  FAILED {when} {gid[:14]}: {body[:200]}", file=sys.stderr)
    print("done")


if __name__ == "__main__":
    main()
