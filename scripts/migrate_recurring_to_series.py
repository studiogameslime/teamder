#!/usr/bin/env python3
"""Migrate live weekly fixtures from `game.recurring` to `gameSeries` docs.

The old model kept a fixture alive inside its most recent match; the new one
keeps the settings in their own doc so an occurrence is disposable. This walks
the existing recurring games and creates the series for the fixtures that are
STILL RUNNING.

⚠️ ONLY LIVE CHAINS. A club whose newest recurring game is already in the past
has a dead chain — the weekly clone stopped (empty roster, a deletion, an
abandoned club). Creating a series for it would RESURRECT the fixture and start
producing matches for people who stopped playing, which is exactly the surprise
this whole refactor exists to remove.

Usage:
    python3 scripts/migrate_recurring_to_series.py            # dry run
    python3 scripts/migrate_recurring_to_series.py --apply    # write
"""
import json
import subprocess
import sys
import time
import urllib.request

PROJECT = "soccer-app-52b6b"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
APPLY = "--apply" in sys.argv


def token() -> str:
    return subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip()


TOK = token()


def req(path: str, method: str = "GET", body=None):
    r = urllib.request.Request(BASE + path, method=method)
    r.add_header("Authorization", f"Bearer {TOK}")
    if body is not None:
        r.add_header("Content-Type", "application/json")
        r.data = json.dumps(body).encode()
    with urllib.request.urlopen(r) as resp:
        raw = resp.read()
    return json.loads(raw) if raw else {}


def run_query(body):
    r = urllib.request.Request(BASE + ":runQuery", method="POST")
    r.add_header("Authorization", f"Bearer {TOK}")
    r.add_header("Content-Type", "application/json")
    r.data = json.dumps(body).encode()
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read())


def val(v):
    """Firestore typed value → python."""
    if v is None:
        return None
    (k, x), = v.items()
    if k == "integerValue":
        return int(x)
    if k == "doubleValue":
        return float(x)
    if k == "booleanValue":
        return bool(x)
    if k == "nullValue":
        return None
    if k == "arrayValue":
        return [val(i) for i in x.get("values", [])]
    if k == "mapValue":
        return {kk: val(vv) for kk, vv in x.get("fields", {}).items()}
    return x


def typed(v):
    """python → Firestore typed value."""
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, list):
        return {"arrayValue": {"values": [typed(i) for i in v]}}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {k: typed(x) for k, x in v.items()}}}
    raise TypeError(str(type(v)))


def settings_from_game(g: dict) -> dict:
    """Mirror of settingsFromGame (src/utils/seriesSchedule.ts)."""
    starts = g.get("startsAt") or 0

    def before(x):
        return starts - x if isinstance(x, int) and 0 < x < starts else None

    s = {
        "title": g.get("title") or "",
        "fieldName": g.get("fieldName") or "",
        "maxPlayers": g.get("maxPlayers") or 10,
        "visibility": "public" if g.get("visibility") == "public" else "community",
        "requiresApproval": g.get("requiresApproval") is True,
        "bringBall": g.get("bringBall") is True,
        "bringShirts": g.get("bringShirts") is True,
    }
    for key in (
        "city", "fieldAddress", "fieldLat", "fieldLng", "fieldType", "format",
        "numberOfTeams", "minPlayers", "matchDurationMinutes",
        "cancelDeadlineHours", "notes", "ruleTags", "acceptsFillers",
        "fillerMinTrust", "advancedMode", "advancedFillMode", "advancedTieMode",
    ):
        v = g.get(key)
        if v is not None:
            s[key] = v
    for src, dst in (
        ("registrationOpensAt", "registrationOpensBeforeMs"),
        ("publicOpenAt", "publicOpenBeforeMs"),
        ("guestsOpenAt", "guestsOpenBeforeMs"),
    ):
        b = before(g.get(src))
        if b is not None:
            s[dst] = b
    return s


def main() -> None:
    res = run_query({
        "structuredQuery": {
            "from": [{"collectionId": "games"}],
            "where": {"fieldFilter": {
                "field": {"fieldPath": "recurring"},
                "op": "EQUAL",
                "value": {"booleanValue": True}}},
            "limit": 1000,
        }
    })
    games = []
    for row in res:
        d = row.get("document")
        if not d:
            continue
        g = {k: val(v) for k, v in d.get("fields", {}).items()}
        g["_id"] = d["name"].split("/")[-1]
        games.append(g)

    now = int(time.time() * 1000)
    by_group: dict[str, list[dict]] = {}
    for g in games:
        if g.get("seriesId"):
            continue  # already migrated
        by_group.setdefault(g.get("groupId") or "", []).append(g)

    created = skipped = 0
    for gid, rows in sorted(by_group.items()):
        rows.sort(key=lambda x: x.get("startsAt") or 0)
        newest = rows[-1]
        starts = newest.get("startsAt") or 0
        title = (newest.get("title") or "")[:24]
        if starts <= now:
            print(f"SKIP  {gid[:10]:10s} | {title:24s} | newest {ts(starts)} is in the PAST — dead chain")
            skipped += 1
            continue

        settings = settings_from_game(newest)
        print(f"MIGRATE {gid[:10]:10s} | {title:24s} | anchor {ts(starts)} | {len(rows)} game(s) to stamp")
        if not APPLY:
            created += 1
            continue

        doc = {"fields": {k: typed(v) for k, v in {
            "groupId": gid,
            "active": True,
            "createdBy": newest.get("createdBy") or "",
            "createdAt": now,
            "updatedAt": now,
            "lastOccurrenceAt": starts,
            "settings": settings,
        }.items()}}
        out = req("/gameSeries", "POST", doc)
        sid = out["name"].split("/")[-1]
        # Stamp EVERY instance of this fixture: the legacy clone skips games
        # that carry a seriesId, so an unstamped older instance without its
        # latch could still spawn a duplicate week.
        for r in rows:
            req(
                f"/games/{r['_id']}?updateMask.fieldPaths=seriesId",
                "PATCH",
                {"fields": {"seriesId": {"stringValue": sid}}},
            )
        print(f"        → series {sid}")
        created += 1

    print(f"\n{'APPLIED' if APPLY else 'DRY RUN'}: {created} series, {skipped} dead chains left alone")


def ts(ms: int) -> str:
    if not ms:
        return "?"
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ms / 1000))


if __name__ == "__main__":
    main()
