#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Business-health facts → Joryio entities.

Answers the questions the events alone cannot: how many scheduled games actually
happen, how many communities are alive, who schedules auto-teams, who rates their
players, how many clubs are open to strangers.

Two destinations:
  • teamder_communities / teamder_games — existing records get the derived flags
    added, so they can be filtered and segmented on.
  • teamder_kpi — one row per run, so the ratios can be tracked over time instead
    of only ever showing today.
"""
import json, os, subprocess, sys, time, urllib.error, urllib.request
from collections import defaultdict, Counter

P = "soccer-app-52b6b"
FS = f"https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents"
BASE = os.environ.get("JORYIO_BASE_URL", "").rstrip("/")
KEY = os.environ.get("JORYIO_API_KEY", "")
WS = "33b93794-3468-4241-aeaf-d752166ae066"
LIVE = "--live" in sys.argv
DAY = 86400_000


def gtok():
    return subprocess.run(["gcloud", "auth", "print-access-token"],
                          capture_output=True, text=True).stdout.strip()


def val(x):
    k = next(iter(x))
    if k == "integerValue": return int(x[k])
    if k == "doubleValue": return float(x[k])
    if k == "nullValue": return None
    if k in ("booleanValue", "stringValue", "timestampValue"): return x[k]
    if k == "arrayValue": return [val(i) for i in x[k].get("values", [])]
    if k == "mapValue": return {a: val(b) for a, b in x[k].get("fields", {}).items()}
    return x[k]


def allof(c, tok):
    out, npt = [], None
    while True:
        u = f"{FS}/{c}?pageSize=300" + (f"&pageToken={npt}" if npt else "")
        d = json.load(urllib.request.urlopen(
            urllib.request.Request(u, headers={"Authorization": f"Bearer {tok}"}), timeout=120))
        for x in d.get("documents", []):
            r = {a: val(b) for a, b in x.get("fields", {}).items()}
            r["_id"] = x["name"].rsplit("/", 1)[-1]
            out.append(r)
        npt = d.get("nextPageToken")
        if not npt:
            return out


# Two independent limits, read off the response headers:
#   x-ratelimit-limit         500 / 60s   — ordinary reads and record writes
#   x-ratelimit-limit-strict   10 / 60s   — schema changes (creating fields)
# A 429 here is not a transient blip to retry three times and give up on: the
# window is a full minute, so the wait has to be long enough to actually clear.
_last_strict = [0.0]


def jry(path, body=None, method="GET", strict=False):
    if strict:
        gap = time.time() - _last_strict[0]
        if gap < 6.5:
            time.sleep(6.5 - gap)
        _last_strict[0] = time.time()
    for i in range(6):
        req = urllib.request.Request(
            f"{BASE}{path}",
            data=json.dumps(body).encode() if body is not None else None,
            method=method,
            headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
                     "X-Workspace-Id": WS})
        try:
            raw = urllib.request.urlopen(req, timeout=180).read().decode()
            return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:200]
            if e.code == 429:
                wait = int(e.headers.get("x-ratelimit-reset") or 0) or 20
                time.sleep(min(wait + 2, 70))
                continue
            if e.code in (500, 502, 503, 504) and i < 5:
                time.sleep(2 ** i); continue
            return {"_error": e.code, "_msg": msg}
        except Exception as e:
            if i < 5:
                time.sleep(2 ** i); continue
            return {"_error": "net", "_msg": str(e)[:150]}
    return {"_error": 429, "_msg": "rate limited after retries"}


def iso(ms):
    if not isinstance(ms, (int, float)) or ms <= 0:
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(ms / 1000))


def main():
    tok = gtok()
    print("קורא:")
    G = allof("games", tok);            print(f"  games {len(G)}")
    GR = allof("groups", tok);          print(f"  groups {len(GR)}")
    DEL = allof("gameDeletions", tok);  print(f"  gameDeletions {len(DEL)}")
    now = int(time.time() * 1000)

    by_group = defaultdict(list)
    for g in G:
        by_group[g.get("groupId")].append(g)
    deleted_by_group = Counter(d.get("groupId") for d in DEL)

    # ── per community ──────────────────────────────────────────────────────
    comm = {}
    for g in GR:
        gid = g["_id"]
        games = by_group.get(gid, [])
        starts = [x.get("startsAt") or 0 for x in games]
        last = max(starts) if starts else 0
        fin = [x for x in games if x.get("status") == "finished"]
        comm[gid] = {
            "memberCount": len(g.get("playerIds") or []),
            "adminCount": len(g.get("adminIds") or []),
            "gamesCreated": len(games),
            "gamesFinished": len(fin),
            "gamesDeleted": deleted_by_group.get(gid, 0),
            "lastGameAt": iso(last),
            "daysSinceLastGame": int((now - last) / DAY) if last else None,
            "everCreatedGame": bool(games),
            "activeLast30d": bool(last and now - last < 30 * DAY),
            "activeLast90d": bool(last and now - last < 90 * DAY),
            "ratesPlayers": bool(g.get("adminRatings")),
            "ratedPlayerCount": len(g.get("adminRatings") or {}),
            "isOpenToJoin": bool(g.get("isOpen")),
            "usesAutoTeams": any(x.get("autoTeamsGeneratedAt") for x in games),
            "schedulesAutoTeams": any(x.get("autoTeamsAt") for x in games),
            "soloShell": len(g.get("playerIds") or []) <= 1 and not games,
        }

    # ── per game ───────────────────────────────────────────────────────────
    gm = {}
    for g in G:
        gm[g["_id"]] = {
            "wasScheduled": bool(g.get("startsAt")),
            "happened": g.get("status") == "finished",
            "hadAutoTeams": bool(g.get("autoTeamsGeneratedAt")),
            "autoTeamsScheduled": bool(g.get("autoTeamsAt")),
            "teamsEditedManually": bool(g.get("teamsEditedManually")),
            "gotTeamFeedback": bool(g.get("draftTeamFeedback")),
            "guestCount": len(g.get("guests") or []),
            "waitlistCount": len(g.get("waitlist") or []),
            "cancellationCount": len(g.get("cancellations") or {}),
            "noShowCount": sum(1 for v in (g.get("arrivals") or {}).values() if v == "no_show"),
        }

    # ── org-level snapshot ─────────────────────────────────────────────────
    past = [x for x in G if (x.get("startsAt") or 0) < now]
    fin = [x for x in past if x.get("status") == "finished"]
    kpi = {
        "snapshotAt": iso(now),
        "communities": len(GR),
        "communitiesEverActive": sum(1 for c in comm.values() if c["everCreatedGame"]),
        "communitiesActive30d": sum(1 for c in comm.values() if c["activeLast30d"]),
        "communitiesActive90d": sum(1 for c in comm.values() if c["activeLast90d"]),
        "communitiesEmpty": sum(1 for c in comm.values() if not c["everCreatedGame"]),
        "communitiesSoloShell": sum(1 for c in comm.values() if c["soloShell"]),
        "communitiesRatingPlayers": sum(1 for c in comm.values() if c["ratesPlayers"]),
        "communitiesOpenToJoin": sum(1 for c in comm.values() if c["isOpenToJoin"]),
        "communitiesUsingAutoTeams": sum(1 for c in comm.values() if c["usesAutoTeams"]),
        "gamesCreated": len(G),
        "gamesPast": len(past),
        "gamesHappened": len(fin),
        "gamesDeleted": len(DEL),
        "gamesDeletedAuto": sum(1 for d in DEL if d.get("source") == "auto-cleanup"),
        "gamesWithAutoTeams": sum(1 for v in gm.values() if v["hadAutoTeams"]),
        "gamesTeamsEditedManually": sum(1 for v in gm.values() if v["teamsEditedManually"]),
        # Deleted games never reach 'finished', so the honest denominator for
        # "did the scheduled night happen?" is past games PLUS the deleted ones.
        "scheduledFulfilmentPct": round(100 * len(fin) / max(1, len(past) + len(DEL)), 1),
        "communityActivationPct": round(
            100 * sum(1 for c in comm.values() if c["everCreatedGame"]) / max(1, len(GR)), 1),
    }

    print("\n" + "=" * 60)
    for k, v in kpi.items():
        print(f"  {k:30} {v}")

    if not LIVE:
        print("\n  DRY-RUN. להרצה: --live")
        return

    ents = {e["name"]: e["id"] for e in (jry("/entities") or []) if isinstance(e, dict)}

    def upsert_flags(ent_name, key_field, data_by_key):
        eid = ents.get(ent_name)
        if not eid:
            print(f"  ✗ אין ישות {ent_name}")
            return
        # fields must exist on the definition before records can carry them
        have = {f["name"] for f in (jry(f"/entities/{eid}/fields") or []) if isinstance(f, dict)}
        sample = next(iter(data_by_key.values()))
        for fname, v in sample.items():
            if fname in have:
                continue
            ftype = ("boolean" if isinstance(v, bool)
                     else "integer" if isinstance(v, int)
                     else "datetime" if (isinstance(v, str) and v.endswith("Z")) else "string")
            r = jry(f"/entities/{eid}/fields", {"name": fname, "displayName": fname,
                                                "fieldType": ftype}, "POST", strict=True)
            if "_error" in r:
                print(f"    ✗ שדה {fname}: {r['_msg'][:80]}")
        # Pagination is `page`, NOT `offset` — the docs say offset, the API
        # rejects it with "property offset should not exist".
        recs, pg, n = [], 1, 0
        while True:
            page = jry(f"/entities/{eid}/records?limit=200&page={pg}")
            if isinstance(page, dict) and "_error" in page:
                print(f"    ✗ שליפה: {page.get('_msg','')[:120]}")
                break
            rows = page.get("data", []) if isinstance(page, dict) else []
            if not rows:
                break
            recs += rows; pg += 1
            if len(recs) >= int(page.get("total") or 0):
                break
        for idx, r in enumerate(recs):
            k = r.get(key_field)
            d = data_by_key.get(k)
            if not d:
                continue
            res = jry(f"/entities/{eid}/records/{r['_id']}", {"data": d}, "PUT")
            if "_error" not in res:
                n += 1
            elif idx < 3:
                print(f"    ✗ {res.get('_msg','')[:110]}")
            if idx % 25 == 0:
                print(f"    {idx}/{len(recs)}", flush=True)
        print(f"  {ent_name:24} עודכנו {n}/{len(recs)}")

    print("\nמעדכן ישויות:")
    upsert_flags("teamder_communities", "communityId", comm)
    upsert_flags("teamder_games", "gameId", gm)

    # KPI snapshot entity
    if "teamder_kpi" not in ents:
        r = jry("/entities", {
            "name": "teamder_kpi", "displayName": "Teamder KPI Snapshots",
            "displayField": "snapshotAt",
            "fields": [{"name": k, "displayName": k,
                        "fieldType": ("datetime" if k == "snapshotAt"
                                      else "number" if isinstance(v, float) else "integer"),
                        "displayOrder": i}
                       for i, (k, v) in enumerate(kpi.items())],
            "settings": {"allowDuplicates": True, "enableAudit": False, "softDelete": True},
        }, "POST", strict=True)
        if "_error" in r:
            print(f"  ✗ teamder_kpi: {r['_msg'][:200]}")
            return
        ents["teamder_kpi"] = r.get("id")
    # Single-record create also needs the envelope, despite the docs showing a
    # bare object: a flat body is rejected with "data must be an object".
    r = jry(f"/entities/{ents['teamder_kpi']}/records", {"data": kpi}, "POST")
    print(f"  teamder_kpi              {'✓ נרשם' if '_error' not in r else '✗ ' + str(r.get('_msg'))[:90]}")


if __name__ == "__main__":
    main()
