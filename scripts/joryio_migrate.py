#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Teamder → Joryio migration.

Reads the production Firestore export and pushes it to Joryio through the one
documented ingest door: POST /users/track, which takes `attributes` (profiles)
and `events` (timeline) in a single call. Attributes are applied before events
within a request, so a person and their history can arrive together.

Firestore has NO event log — the app stores domain objects, not activity. Every
event below is DERIVED, and only ever with a timestamp that really exists in the
data. Nothing is invented: a fact without a real time is not emitted.

`purchases` is deliberately never sent. Teamder has no payments of any kind.

Auth: gcloud application-default credentials (no service-account key file).
Default mode is --dry-run; sending requires --live.
"""
import argparse, json, os, subprocess, sys, time, urllib.error, urllib.request
from collections import defaultdict

PROJECT = "soccer-app-52b6b"
FS = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"

# Joryio caps, from the Users API reference. A request over a cap is REJECTED,
# not truncated, so these are hard batch sizes.
# The documented caps are 1000/500, but a 584-profile request took the server
# longer than any sane client timeout to answer (it DID process them — the
# client just gave up first). Smaller batches keep each request well inside the
# timeout and make a failure cost one batch, not the whole run.
MAX_ATTRS, MAX_EVENTS = 100, 100
# Profile limits: 200 keys, 50KB, nesting depth 5.
MAX_ATTR_KEYS = 200


# ── Firestore REST ─────────────────────────────────────────────────────────
def gtoken():
    t = subprocess.run(["gcloud", "auth", "print-access-token"],
                       capture_output=True, text=True).stdout.strip()
    if not t:
        sys.exit("gcloud token unavailable — run: gcloud auth login")
    return t


def val(x):
    k = next(iter(x))
    if k == "integerValue": return int(x[k])
    if k == "doubleValue": return float(x[k])
    if k == "nullValue": return None
    if k in ("booleanValue", "stringValue", "timestampValue"): return x[k]
    if k == "arrayValue": return [val(i) for i in x[k].get("values", [])]
    if k == "mapValue": return {a: val(b) for a, b in x[k].get("fields", {}).items()}
    return x[k]


def fields(doc):
    d = {a: val(b) for a, b in doc.get("fields", {}).items()}
    d["_id"] = doc["name"].rsplit("/", 1)[-1]
    return d


def fs_all(coll, tok, page=300):
    """Every document in a collection, paged so nothing is held twice."""
    out, npt = [], None
    while True:
        u = f"{FS}/{coll}?pageSize={page}" + (f"&pageToken={npt}" if npt else "")
        req = urllib.request.Request(u, headers={"Authorization": f"Bearer {tok}"})
        d = json.load(urllib.request.urlopen(req))
        out += [fields(x) for x in d.get("documents", [])]
        npt = d.get("nextPageToken")
        print(f"\r  {coll}: {len(out)}", end="", flush=True)
        if not npt:
            break
    print()
    return out


# ── helpers ────────────────────────────────────────────────────────────────
def iso(ms):
    """ms-epoch → ISO 8601 UTC. None for anything unusable, so a bad timestamp
    drops the event rather than silently becoming 'now'."""
    if not isinstance(ms, (int, float)) or ms <= 0:
        return None
    if ms > 1e12 * 10:      # seconds mistakenly stored as ms, or vice versa
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(ms / 1000))


def is_guest(uid):
    return isinstance(uid, str) and uid.startswith("guest:")


def clean(d):
    """Drop empty values; Joryio counts every key against the 200-key cap."""
    return {k: v for k, v in d.items()
            if v is not None and v != "" and v != [] and v != {}
            or v is False}   # keep explicit False (e.g. statsRecorded)


# ── build the payload ──────────────────────────────────────────────────────
def build(tok):
    print("קורא מ-Firestore:")
    users = fs_all("users", tok)
    groups = fs_all("groups", tok)
    games = fs_all("games", tok)
    gps = fs_all("gamePlayerStats", tok)
    cps = fs_all("communityPlayerStats", tok)
    stand = fs_all("eveningStandings", tok)

    group_name = {g["_id"]: g.get("name", "") for g in groups}
    # Approved membership lives on `playerIds` (NOT `members` — that field does
    # not exist on the doc). `joinedAt` is stamped by the stampMembershipDates
    # function, so members who predate it have no entry; those get no join event.
    members_of = defaultdict(list)
    group_joined = {}
    for g in groups:
        ja = g.get("joinedAt") or {}
        for uid in (g.get("playerIds") or []):
            if not is_guest(uid):
                members_of[uid].append(g["_id"])
                if uid in ja:
                    group_joined[(uid, g["_id"])] = ja[uid]

    # per-game stat rows, and per-user club rollups
    stats_by_game = defaultdict(dict)
    for r in gps:
        gid, uid = r.get("gameId"), r.get("userId")
        if gid and uid and not is_guest(uid):
            stats_by_game[gid][uid] = r
    club_totals = defaultdict(lambda: defaultdict(int))
    for r in cps:
        uid = r.get("userId")
        if not uid or is_guest(uid):
            continue
        for f in ("goals", "assists", "wins", "losses", "rounds",
                  "cleanSheets", "ownGoals", "penScored", "penSaved"):
            club_totals[uid][f] += int(r.get(f) or 0)

    stand_by = defaultdict(list)
    for s in stand:
        if s.get("userId") and s.get("gameId"):
            stand_by[s["userId"]].append(s)

    games_by_id = {g["_id"]: g for g in games}
    attended = defaultdict(int)
    for g in games:
        if g.get("status") != "finished":
            continue
        arr = g.get("arrivals") or {}
        for uid in (g.get("players") or []):
            if not is_guest(uid) and arr.get(uid) != "no_show":
                attended[uid] += 1

    # ── profiles ───────────────────────────────────────────────────────────
    attrs = []
    for u in users:
        uid = u["_id"]
        if is_guest(uid) or u.get("isGuest"):
            continue
        t = club_totals.get(uid, {})
        a = clean({
            "name": u.get("name"),
            "avatarId": u.get("avatarId"),
            "signedUpAt": iso(u.get("createdAt")),
            "onboardingCompleted": bool(u.get("onboardingCompleted")),
            "isQaTester": bool(u.get("qa")) or None,
            "communityCount": len(members_of.get(uid, [])) or None,
            "communityNames": [group_name[g] for g in members_of.get(uid, [])
                               if group_name.get(g)] or None,
            "eveningsAttended": attended.get(uid) or None,
            "careerGoals": t.get("goals") or None,
            "careerAssists": t.get("assists") or None,
            "careerWins": t.get("wins") or None,
            "careerMiniGames": t.get("rounds") or None,
            "careerCleanSheets": t.get("cleanSheets") or None,
        })
        if len(a) > MAX_ATTR_KEYS:
            a = dict(list(a.items())[:MAX_ATTR_KEYS])
        rec = clean({"externalId": uid, "email": u.get("email"), "attributes": a})
        # externalId is the only create-or-update key; a row without it is unusable.
        if rec.get("externalId"):
            attrs.append(rec)

    # ── events ─────────────────────────────────────────────────────────────
    ev, skipped = [], defaultdict(int)

    def add(uid, name, ms, cid, props=None):
        t = iso(ms)
        if not t:
            skipped[name] += 1     # no real timestamp → not emitted
            return
        ev.append(clean({"externalId": uid, "name": name, "time": t,
                         "clientEventId": cid, "properties": clean(props or {})}))

    for u in users:
        uid = u["_id"]
        if is_guest(uid) or u.get("isGuest"):
            continue
        add(uid, "Account Created", u.get("createdAt"), f"acct:{uid}")

    for (uid, gid), ms in group_joined.items():
        add(uid, "Community Joined", ms, f"cjoin:{gid}:{uid}",
            {"communityId": gid, "communityName": group_name.get(gid, "")})

    for g in games:
        gid, gm_start = g["_id"], g.get("startsAt")
        gname = group_name.get(g.get("groupId"), "")
        base = clean({"gameId": gid, "communityId": g.get("groupId"),
                      "communityName": gname})
        joined = g.get("joinedAt") or {}
        roster = [u for u in (g.get("players") or []) if not is_guest(u)]

        # registration — a real per-player timestamp when the app stored one
        for uid, ms in joined.items():
            if not is_guest(uid):
                add(uid, "Game Joined", ms, f"join:{gid}:{uid}", base)

        if g.get("status") == "cancelled":
            for uid in roster:
                add(uid, "Game Cancelled", gm_start, f"cancel:{gid}:{uid}", base)
            continue
        if g.get("status") != "finished":
            continue

        arr = g.get("arrivals") or {}
        rows = stats_by_game.get(gid, {})
        for uid in roster:
            if arr.get(uid) == "no_show":
                continue
            # Only 18 of the finished games carry stat rows. For the rest,
            # emit attendance ALONE — a zeroed stat block would assert "played
            # and scored nothing", which is not what the absence of a row means.
            r = rows.get(uid)
            props = dict(base)
            if r:
                props.update({
                    "miniGames": int(r.get("rounds") or 0),
                    "wins": int(r.get("wins") or 0),
                    "losses": int(r.get("losses") or 0),
                    "goals": int(r.get("goals") or 0),
                    "assists": int(r.get("assists") or 0),
                    "cleanSheets": int(r.get("cleanSheets") or 0),
                    "statsRecorded": True,
                })
            else:
                props["statsRecorded"] = False
            add(uid, "Game Attended", gm_start, f"att:{gid}:{uid}", props)

    # the evening score + rank the player actually saw on their summary card
    for uid, rows in stand_by.items():
        if is_guest(uid):
            continue
        for s in rows:
            gid = s["gameId"]
            g = games_by_id.get(gid, {})
            add(uid, "Evening Summary Received", s.get("at") or g.get("startsAt"),
                f"sum:{gid}:{uid}", {
                    "gameId": gid,
                    "communityId": g.get("groupId"),
                    "communityName": group_name.get(g.get("groupId"), ""),
                    "score": s.get("score"),
                    "rank": s.get("scoreRank"),
                    "outOf": s.get("scoreTotal"),
                })

    # An event whose externalId has no profile would make Joryio CREATE a bare
    # record from the event alone — a nameless ghost. That happens for uids that
    # sit on a roster but whose /users doc is gone (deleted account). Drop them.
    known = {r["externalId"] for r in attrs}
    orphan = defaultdict(int)
    kept = []
    for e in ev:
        if e["externalId"] in known:
            kept.append(e)
        else:
            orphan[e["externalId"]] += 1
    ev = kept
    if orphan:
        print(f"\n  ⚠ {sum(orphan.values())} אירועים של {len(orphan)} משתמשים "
              f"ללא מסמך /users — לא נשלחים:")
        for uid, c in sorted(orphan.items(), key=lambda t: -t[1])[:10]:
            print(f"     {uid}  ({c})")

    ev.sort(key=lambda e: e["time"])   # oldest first, so timelines read correctly
    return attrs, ev, dict(skipped)


# ── send ───────────────────────────────────────────────────────────────────
def post(base, key, body, tries=5):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{base}/users/track", data=data,
        headers={"Authorization": f"Bearer {key}",
                 "Content-Type": "application/json"})
    for i in range(tries):
        try:
            return json.load(urllib.request.urlopen(req, timeout=300))
        except urllib.error.HTTPError as e:
            body_txt = e.read().decode()[:300]
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                wait = 2 ** i
                print(f"    HTTP {e.code} — ניסיון חוזר בעוד {wait}ש")
                time.sleep(wait)
                continue
            raise SystemExit(f"  נכשל HTTP {e.code}: {body_txt}")
        except urllib.error.URLError as e:
            if i < tries - 1:
                time.sleep(2 ** i)
                continue
            raise SystemExit(f"  שגיאת רשת: {e}")


def chunks(xs, n):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true",
                    help="שולח בפועל. בלי הדגל — dry-run בלבד")
    ap.add_argument("--limit-users", type=int, default=0,
                    help="שלח רק N משתמשים ראשונים (ריצת ניסיון)")
    ap.add_argument("--skip-profiles", action="store_true",
                    help="דלג על הפרופילים ושלח אירועים בלבד")
    ap.add_argument("--out", default="joryio_payload.json")
    a = ap.parse_args()

    base = os.environ.get("JORYIO_BASE_URL", "https://api-eu1.joryio.com/api").rstrip("/")
    key = os.environ.get("JORYIO_API_KEY", "")
    # `base` now always has the production default, so the KEY is the only
    # thing a live run can actually be missing.
    if a.live and not key:
        sys.exit("חסר JORYIO_API_KEY בסביבה")

    attrs, ev, skipped = build(gtoken())

    if a.limit_users:
        keep = {r["externalId"] for r in attrs[:a.limit_users]}
        attrs = [r for r in attrs if r["externalId"] in keep]
        ev = [e for e in ev if e["externalId"] in keep]

    by_name = defaultdict(int)
    for e in ev:
        by_name[e["name"]] += 1
    print(f"\n{'='*62}\nמוכן לשליחה\n{'='*62}")
    print(f"  פרופילים: {len(attrs)}")
    print(f"  אירועים:  {len(ev)}")
    for n, c in sorted(by_name.items(), key=lambda t: -t[1]):
        print(f"     {n:26} {c}")
    if skipped:
        print("  לא נשלחו (אין חותמת זמן אמיתית):")
        for n, c in skipped.items():
            print(f"     {n:26} {c}")
    if ev:
        print(f"  טווח: {ev[0]['time'][:10]} → {ev[-1]['time'][:10]}")

    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"attributes": attrs, "events": ev}, f,
                  ensure_ascii=False, indent=1)
    print(f"\n  המטען נשמר ל: {a.out}")

    if not a.live:
        print("\n  DRY-RUN — לא נשלח דבר. להרצה אמיתית: --live")
        if attrs:
            print("\n  דוגמת פרופיל:")
            print("   ", json.dumps(attrs[0], ensure_ascii=False)[:400])
        if ev:
            print("  דוגמת אירוע:")
            print("   ", json.dumps(ev[0], ensure_ascii=False)[:400])
        return

    # Profiles first and in full: an event for an unknown person would be
    # rejected, and attributes are only applied before events WITHIN a request.
    if a.skip_profiles:
        print("\nמדלג על פרופילים (--skip-profiles)")
        attrs = []
    print(f"\nשולח פרופילים ({len(attrs)}):")
    ok = fail = 0
    for i, b in enumerate(chunks(attrs, MAX_ATTRS), 1):
        r = post(base, key, {"attributes": b})
        p = r.get("attributes", {})
        ok += p.get("processed", 0)
        for f_ in p.get("failed", []):
            fail += 1
            print(f"    ✗ {json.dumps(f_, ensure_ascii=False)[:200]}")
        print(f"  אצווה {i}: {p.get('processed',0)}/{len(b)}")
    print(f"  סה\"כ פרופילים: {ok} הצליחו, {fail} נכשלו")

    print(f"\nשולח אירועים ({len(ev)}):")
    eok = efail = 0
    for i, b in enumerate(chunks(ev, MAX_EVENTS), 1):
        r = post(base, key, {"events": b})
        p = r.get("events", {})
        eok += p.get("processed", 0)
        for f_ in p.get("failed", []):
            efail += 1
            print(f"    ✗ {json.dumps(f_, ensure_ascii=False)[:200]}")
        print(f"  אצווה {i}: {p.get('processed',0)}/{len(b)}")
    print(f"  סה\"כ אירועים: {eok} הצליחו, {efail} נכשלו")


if __name__ == "__main__":
    main()
