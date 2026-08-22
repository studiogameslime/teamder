#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Teamder + Pulse → Joryio, complete.

Three destinations, each for the kind of thing that belongs there:
  • attributes  → who a person is (POST /users/track)
  • events      → what a person did, on the real date it happened
  • entities    → objects that are not people: games, communities, and the
                  Pulse dev-inbox records (errors, tasks, ideas, feedback)

Rules held throughout:
  - An event is emitted only when a REAL timestamp and a REAL person exist.
    Nothing is back-filled with "now" and nothing is invented.
  - Events for a uid with no /users document are dropped, otherwise Joryio
    creates a nameless ghost profile out of the event alone.
  - Base64 screenshots (feedback.image, tasks.images, pulseFeatures.images) are
    never sent: they blow the 50KB attribute cap and carry no analytical value.
  - No purchases, ever. Teamder has no payments.
"""
import argparse, json, os, subprocess, sys, time, urllib.error, urllib.request
from collections import defaultdict

PROJECT = "soccer-app-52b6b"
FS = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
WORKSPACE = "33b93794-3468-4241-aeaf-d752166ae066"

MAX_ATTRS, MAX_EVENTS, MAX_RECORDS = 100, 100, 500
IMAGE_KEYS = {"image", "images", "screenshot", "photo", "lastStack", "stack"}


# ── Firestore ──────────────────────────────────────────────────────────────
def gtoken():
    t = subprocess.run(["gcloud", "auth", "print-access-token"],
                       capture_output=True, text=True).stdout.strip()
    if not t:
        sys.exit("gcloud token unavailable")
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


def fs_all(coll, tok, page=300):
    out, npt = [], None
    while True:
        u = f"{FS}/{coll}?pageSize={page}" + (f"&pageToken={npt}" if npt else "")
        req = urllib.request.Request(u, headers={"Authorization": f"Bearer {tok}"})
        d = json.load(urllib.request.urlopen(req, timeout=120))
        for x in d.get("documents", []):
            r = {a: val(b) for a, b in x.get("fields", {}).items()}
            r["_id"] = x["name"].rsplit("/", 1)[-1]
            out.append(r)
        npt = d.get("nextPageToken")
        print(f"\r  {coll}: {len(out)}", end="", flush=True)
        if not npt:
            break
    print()
    return out


# ── helpers ────────────────────────────────────────────────────────────────
def iso(v):
    """ms-epoch OR an ISO string → ISO 8601 UTC. None when there is no usable
    timestamp, so the caller drops the fact instead of stamping it 'now'."""
    if isinstance(v, str):
        s = v.strip()
        if len(s) >= 19 and s[4] == "-" and s[7] == "-":
            return s if s.endswith("Z") else s[:19] + ".000Z"
        return None
    if not isinstance(v, (int, float)) or v <= 0:
        return None
    if v < 1e11:            # seconds, not ms
        v *= 1000
    if v > 4e12:            # beyond ~2096 — corrupt
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(v / 1000))


def is_guest(u):
    return not isinstance(u, str) or u.startswith("guest:") or u.startswith("system:")


def clean(d):
    return {k: v for k, v in d.items()
            if (v is not None and v != "" and v != [] and v != {}) or v is False}


def strip_images(d):
    """Screenshots and stack traces are megabytes of base64/noise."""
    return {k: v for k, v in d.items() if k not in IMAGE_KEYS}


def s(v, n=250):
    return (v[:n] if isinstance(v, str) else v)


# ══════════════════════════════════════════════════════════════════════════
def build(tok, want_entities=True):
    print("קורא מ-Firestore:")
    C = {}
    for name in ["users", "groups", "games", "gamePlayerStats", "communityPlayerStats",
                 "eveningStandings", "groupJoinRequests", "friendRequests",
                 "notifications", "communityPlayerEvents", "dmConversations",
                 "inviteLinks", "gameDeletions", "feedback", "errors", "tasks",
                 "pulseIdeas", "pulseFeatures", "ratings", "communityStats"]:
        C[name] = fs_all(name, tok)

    users = [u for u in C["users"] if not u.get("isGuest") and not is_guest(u["_id"])]
    known = {u["_id"] for u in users}
    group_name = {g["_id"]: g.get("name", "") for g in C["groups"]}
    game_by_id = {g["_id"]: g for g in C["games"]}

    members_of, group_joined = defaultdict(list), {}
    for g in C["groups"]:
        ja = g.get("joinedAt") or {}
        for uid in (g.get("playerIds") or []):
            if not is_guest(uid):
                members_of[uid].append(g["_id"])
                if uid in ja:
                    group_joined[(uid, g["_id"])] = ja[uid]

    club_totals = defaultdict(lambda: defaultdict(int))
    for r in C["communityPlayerStats"]:
        uid = r.get("userId")
        if uid and not is_guest(uid):
            for f in ("goals", "assists", "wins", "losses", "rounds",
                      "cleanSheets", "ownGoals", "penScored", "penSaved",
                      "penTaken", "penFaced"):
                club_totals[uid][f] += int(r.get(f) or 0)

    stats_by_game = defaultdict(dict)
    for r in C["gamePlayerStats"]:
        if r.get("gameId") and r.get("userId") and not is_guest(r["userId"]):
            stats_by_game[r["gameId"]][r["userId"]] = r

    attended = defaultdict(int)
    for g in C["games"]:
        if g.get("status") != "finished":
            continue
        arr = g.get("arrivals") or {}
        for uid in (g.get("players") or []):
            if not is_guest(uid) and arr.get(uid) != "no_show":
                attended[uid] += 1

    # per-person side facts used as profile attributes
    friends = defaultdict(int)
    for fr in C["friendRequests"]:
        if fr.get("status") == "accepted":
            for k in ("fromUserId", "toUserId"):
                if not is_guest(fr.get(k)):
                    friends[fr[k]] += 1
    notif_count = defaultdict(int)
    for n in C["notifications"]:
        if not is_guest(n.get("recipientId")):
            notif_count[n["recipientId"]] += 1
    invites, invite_clicks = defaultdict(int), defaultdict(int)
    for il in C["inviteLinks"]:
        if not is_guest(il.get("invitedBy")):
            invites[il["invitedBy"]] += 1
            invite_clicks[il["invitedBy"]] += int(il.get("clicks") or 0)
    peer_rating = {r["userId"]: r.get("average") for r in C["ratings"]
                   if r.get("userId") and r.get("average") is not None}
    admin_rating = {}
    for g in C["groups"]:
        for uid, v in (g.get("adminRatings") or {}).items():
            admin_rating.setdefault(uid, v)
    # the most recent platform / app version we ever saw for this person
    seen_client = {}
    for row in sorted(C["feedback"], key=lambda r: str(r.get("createdAt") or "")):
        if row.get("userId"):
            seen_client[row["userId"]] = (row.get("platform"), row.get("appVersion"))
    for row in C["errors"]:
        if row.get("lastUserId") and row["lastUserId"] not in seen_client:
            seen_client[row["lastUserId"]] = (row.get("platform"), row.get("appVersion"))

    # ── profiles ───────────────────────────────────────────────────────────
    attrs = []
    for u in users:
        uid = u["_id"]
        t = club_totals.get(uid, {})
        plat, ver = seen_client.get(uid, (None, None))
        av = u.get("availability") or {}
        a = clean({
            "name": u.get("name"),
            "avatarId": u.get("avatarId"),
            "signedUpAt": iso(u.get("createdAt")),
            "onboardingCompleted": bool(u.get("onboardingCompleted")),
            "isQaTester": bool(u.get("qa")) or None,
            "platform": plat, "appVersion": ver,
            "communityCount": len(members_of.get(uid, [])) or None,
            "communityNames": [group_name[g] for g in members_of.get(uid, [])
                               if group_name.get(g)] or None,
            "eveningsAttended": attended.get(uid) or None,
            "careerGoals": t.get("goals") or None,
            "careerAssists": t.get("assists") or None,
            "careerWins": t.get("wins") or None,
            "careerLosses": t.get("losses") or None,
            "careerMiniGames": t.get("rounds") or None,
            "careerCleanSheets": t.get("cleanSheets") or None,
            "careerOwnGoals": t.get("ownGoals") or None,
            "penaltiesScored": t.get("penScored") or None,
            "penaltiesSaved": t.get("penSaved") or None,
            "friendCount": friends.get(uid) or None,
            "notificationsReceived": notif_count.get(uid) or None,
            "inviteLinksCreated": invites.get(uid) or None,
            "inviteLinkClicks": invite_clicks.get(uid) or None,
            "internalRating": admin_rating.get(uid),
            "peerRating": peer_rating.get(uid),
            "availableDays": (av.get("days") if isinstance(av, dict) else None) or None,
        })
        attrs.append(clean({"externalId": uid, "email": u.get("email"),
                            "attributes": a}))

    # ── events ─────────────────────────────────────────────────────────────
    ev, no_time, orphan = [], defaultdict(int), defaultdict(int)

    def add(uid, name, when, cid, props=None):
        if is_guest(uid) or not uid:
            return
        t_ = iso(when)
        if not t_:
            no_time[name] += 1
            return
        if uid not in known:
            orphan[name] += 1
            return
        ev.append(clean({"externalId": uid, "name": name, "time": t_,
                         "clientEventId": cid,
                         "properties": clean(strip_images(props or {}))}))

    for u in users:
        add(u["_id"], "Account Created", u.get("createdAt"), f"acct:{u['_id']}")

    for (uid, gid), ms in group_joined.items():
        add(uid, "Community Joined", ms, f"cjoin:{gid}:{uid}",
            {"communityId": gid, "communityName": group_name.get(gid, "")})

    for r in C["groupJoinRequests"]:
        uid, gid = r.get("userId"), r.get("groupId")
        base = {"communityId": gid, "communityName": group_name.get(gid, ""),
                "status": r.get("status")}
        add(uid, "Community Join Requested", r.get("createdAt"),
            f"jreq:{r['_id']}", base)
        if r.get("decidedAt") and r.get("status") in ("approved", "rejected"):
            add(uid, "Community Join Approved" if r["status"] == "approved"
                else "Community Join Rejected", r.get("decidedAt"),
                f"jdec:{r['_id']}", base)

    for g in C["games"]:
        gid = g["_id"]
        base = clean({"gameId": gid, "communityId": g.get("groupId"),
                      "communityName": group_name.get(g.get("groupId"), ""),
                      "title": s(g.get("title"), 120), "city": g.get("city"),
                      "fieldName": s(g.get("fieldName"), 120),
                      "format": g.get("format")})
        add(g.get("createdBy"), "Game Created", g.get("createdAt"),
            f"gcreate:{gid}", base)
        for uid, ms in (g.get("joinedAt") or {}).items():
            add(uid, "Game Joined", ms, f"join:{gid}:{uid}", base)
        # autoTeamsGeneratedBy is always the literal "system" — a server job, not
        # a person. Emitting it as a user event invented an actor, so the fact
        # lives on the game entity instead.
        # Un-registering is the clearest intent-to-leave signal in the product,
        # and `cancellations` stores {uid: ms} — a real actor and a real time.
        for uid, ms in (g.get("cancellations") or {}).items():
            add(uid, "Game Registration Cancelled", ms, f"gcancel:{gid}:{uid}", base)
        for uid, ms in (g.get("adminRemovals") or {}).items():
            add(uid, "Removed From Game", ms, f"grm:{gid}:{uid}", base)
        # A guest is not a user, but the member who brought them is.
        for gu in (g.get("guests") or []):
            if isinstance(gu, dict) and gu.get("addedBy"):
                add(gu["addedBy"], "Guest Added", gu.get("createdAt"),
                    f"guest:{gid}:{gu.get('id')}",
                    {**base, "guestRating": gu.get("estimatedRating")})

        if g.get("status") != "finished":
            continue
        arr = g.get("arrivals") or {}
        rows = stats_by_game.get(gid, {})
        for uid in (g.get("players") or []):
            if is_guest(uid) or arr.get(uid) == "no_show":
                continue
            r = rows.get(uid)
            p = dict(base)
            if r:
                p.update({"miniGames": int(r.get("rounds") or 0),
                          "wins": int(r.get("wins") or 0),
                          "losses": int(r.get("losses") or 0),
                          "goals": int(r.get("goals") or 0),
                          "assists": int(r.get("assists") or 0),
                          "cleanSheets": int(r.get("cleanSheets") or 0),
                          "statsRecorded": True})
            else:
                p["statsRecorded"] = False
            add(uid, "Game Attended", g.get("startsAt"), f"att:{gid}:{uid}", p)
            if arr.get(uid) == "no_show":
                pass
        for uid in (g.get("players") or []):
            if arr.get(uid) == "no_show" and not is_guest(uid):
                add(uid, "Game No Show", g.get("startsAt"), f"nos:{gid}:{uid}", base)

    for r in C["gameDeletions"]:
        by = r.get("deletedBy")
        add(by, "Game Deleted", r.get("deletedAt"), f"gdel:{r['_id']}",
            clean({"gameId": r.get("gameId"), "communityId": r.get("groupId"),
                   "gameTitle": s(r.get("gameTitle"), 120),
                   "rosterCount": r.get("rosterCount"), "source": r.get("source")}))

    for st in C["eveningStandings"]:
        uid, gid = st.get("userId"), st.get("gameId")
        g = game_by_id.get(gid, {})
        add(uid, "Evening Summary Received", st.get("at") or g.get("startsAt"),
            f"sum:{gid}:{uid}",
            clean({"gameId": gid, "communityId": g.get("groupId"),
                   "communityName": group_name.get(g.get("groupId"), ""),
                   "score": st.get("score"), "rank": st.get("scoreRank"),
                   "outOf": st.get("scoreTotal")}))

    # yellow/red are disciplinary cards, not chores — they deserve their own names.
    DUTY = {"jerseys": "Jerseys Brought", "ball": "Ball Brought",
            "yellow": "Yellow Card Received", "red": "Red Card Received"}
    for r in C["communityPlayerEvents"]:
        add(r.get("userId"), DUTY.get(r.get("type"), "Player Duty Logged"),
            r.get("at"), f"duty:{r['_id']}",
            clean({"type": r.get("type"), "gameId": r.get("gameId"),
                   "communityId": r.get("groupId"),
                   "communityName": group_name.get(r.get("groupId"), "")}))

    for n in C["notifications"]:
        pl = n.get("payload") or {}
        add(n.get("recipientId"),
            "Notification Delivered" if n.get("delivered") else "Notification Sent",
            n.get("deliveredAt") or n.get("createdAt"), f"notif:{n['_id']}",
            clean({"notificationType": n.get("type"),
                   "gameId": pl.get("gameId") if isinstance(pl, dict) else None,
                   "delivered": bool(n.get("delivered"))}))

    for fr in C["friendRequests"]:
        a_, b_ = fr.get("fromUserId"), fr.get("toUserId")
        add(a_, "Friend Requested", fr.get("createdAt"), f"freq:{fr['_id']}",
            {"status": fr.get("status")})
        if fr.get("status") == "accepted" and fr.get("updatedAt"):
            add(a_, "Friend Accepted", fr["updatedAt"], f"facc:{fr['_id']}:a", {})
            add(b_, "Friend Accepted", fr["updatedAt"], f"facc:{fr['_id']}:b", {})

    for c in C["dmConversations"]:
        for uid in (c.get("participants") or []):
            add(uid, "Conversation Started", c.get("createdAt"),
                f"dm:{c['_id']}:{uid}", {})

    for il in C["inviteLinks"]:
        add(il.get("invitedBy"), "Invite Link Created", il.get("createdAt"),
            f"inv:{il['_id']}",
            clean({"linkType": il.get("type"), "clicks": il.get("clicks")}))

    for f in C["feedback"]:
        add(f.get("userId"), "Feedback Submitted", f.get("createdAt"),
            f"fb:{f['_id']}",
            clean({"feedbackType": f.get("type"), "screen": f.get("screen"),
                   "platform": f.get("platform"), "appVersion": f.get("appVersion"),
                   "message": s(f.get("message"), 250),
                   "resolved": bool(f.get("fixedAt") or f.get("resolvedAt"))}))

    for e in C["errors"]:
        add(e.get("lastUserId"), "Error Encountered",
            e.get("firstSeen") or e.get("lastSeen"), f"err:{e['_id']}",
            clean({"title": s(e.get("title"), 200), "operation": e.get("operation"),
                   "category": e.get("category"), "appVersion": e.get("appVersion"),
                   "platform": e.get("platform"), "status": e.get("status")}))

    for t_ in C["tasks"]:
        add(t_.get("reporterId"), "Dev Task Reported", t_.get("createdAt"),
            f"task:{t_['_id']}",
            clean({"title": s(t_.get("title"), 200), "category": t_.get("category"),
                   "priority": t_.get("priority"), "screen": t_.get("screen"),
                   "source": t_.get("source")}))

    ev.sort(key=lambda e: e["time"])

    # ── entities (objects that are not people) ─────────────────────────────
    ents = {}
    if want_entities:
        ents["teamder_games"] = {
            "displayName": "Teamder Games", "displayField": "title",
            "fields": [("gameId", "string"), ("title", "string"),
                       ("communityId", "string"), ("communityName", "string"),
                       ("status", "string"), ("startsAt", "datetime"),
                       ("city", "string"), ("fieldName", "string"),
                       ("format", "string"), ("playerCount", "integer"),
                       ("waitlistCount", "integer"), ("maxPlayers", "integer"),
                       ("recurring", "boolean"), ("visibility", "string"),
                       ("teamsGeneratedAt", "datetime"), ("teamsMethod", "string"),
                       ("goalsScored", "integer"), ("miniGames", "integer")],
            "records": [clean({
                "gameId": g["_id"], "title": s(g.get("title"), 200) or "—",
                "communityId": g.get("groupId"),
                "communityName": group_name.get(g.get("groupId"), ""),
                "status": g.get("status"), "startsAt": iso(g.get("startsAt")),
                "city": g.get("city"), "fieldName": s(g.get("fieldName"), 200),
                "format": g.get("format"),
                "playerCount": len([p for p in (g.get("players") or []) if not is_guest(p)]),
                "waitlistCount": len(g.get("waitlist") or []),
                "maxPlayers": g.get("maxPlayers"),
                "recurring": bool(g.get("recurring")),
                "visibility": g.get("visibility"),
                "teamsGeneratedAt": iso(g.get("autoTeamsGeneratedAt")),
                "teamsMethod": g.get("autoTeamsMethod"),
                "goalsScored": sum(int(r.get("goals") or 0)
                                   for r in stats_by_game.get(g["_id"], {}).values()) or None,
                "miniGames": max([int(r.get("rounds") or 0)
                                  for r in stats_by_game.get(g["_id"], {}).values()] or [0]) or None,
            }) for g in C["games"]]}

        ents["teamder_communities"] = {
            "displayName": "Teamder Communities", "displayField": "name",
            "fields": [("communityId", "string"), ("name", "string"),
                       ("city", "string"), ("memberCount", "integer"),
                       ("adminCount", "integer"), ("isOpen", "boolean"),
                       ("createdAt", "datetime"), ("maxMembers", "integer")],
            "records": [clean({
                "communityId": g["_id"], "name": s(g.get("name"), 200) or "—",
                "city": g.get("city"),
                "memberCount": len(g.get("playerIds") or []),
                "adminCount": len(g.get("adminIds") or []),
                "isOpen": bool(g.get("isOpen")),
                "createdAt": iso(g.get("createdAt")),
                "maxMembers": g.get("maxMembers"),
            }) for g in C["groups"]]}

        # ── Pulse: the dev inbox, as queryable objects ──────────────────────
        ents["pulse_errors"] = {
            "displayName": "Pulse Errors", "displayField": "title",
            "fields": [("fingerprint", "string"), ("title", "string"),
                       ("operation", "string"), ("category", "string"),
                       ("status", "string"), ("appVersion", "string"),
                       ("platform", "string"), ("firstSeen", "datetime"),
                       ("lastSeen", "datetime"), ("count", "integer")],
            "records": [clean({
                "fingerprint": e.get("fingerprint") or e["_id"],
                "title": s(e.get("title"), 200) or "—",
                "operation": e.get("operation"), "category": e.get("category"),
                "status": e.get("status"), "appVersion": e.get("appVersion"),
                "platform": e.get("platform"),
                "firstSeen": iso(e.get("firstSeen")), "lastSeen": iso(e.get("lastSeen")),
                "count": e.get("count") or e.get("occurrences"),
            }) for e in C["errors"]]}

        ents["pulse_tasks"] = {
            "displayName": "Pulse Tasks", "displayField": "title",
            "fields": [("taskId", "string"), ("title", "string"),
                       ("category", "string"), ("priority", "string"),
                       ("screen", "string"), ("source", "string"),
                       ("reporterName", "string"), ("createdAt", "datetime"),
                       ("done", "boolean")],
            "records": [clean({
                "taskId": t_["_id"], "title": s(t_.get("title"), 200) or "—",
                "category": t_.get("category"), "priority": t_.get("priority"),
                "screen": t_.get("screen"), "source": t_.get("source"),
                "reporterName": t_.get("reporterName"),
                "createdAt": iso(t_.get("createdAt")),
                "done": bool(t_.get("doneAt")),
            }) for t_ in C["tasks"]]}

        ents["pulse_ideas"] = {
            "displayName": "Pulse Ideas", "displayField": "text",
            "fields": [("ideaId", "string"), ("text", "string"),
                       ("status", "string"), ("createdAt", "datetime")],
            "records": [clean({
                "ideaId": i["_id"], "text": s(i.get("text"), 500) or "—",
                "status": i.get("status"), "createdAt": iso(i.get("createdAt")),
            }) for i in C["pulseIdeas"]]}

        ents["pulse_feedback"] = {
            "displayName": "Pulse Feedback", "displayField": "message",
            "fields": [("feedbackId", "string"), ("message", "string"),
                       ("type", "string"), ("screen", "string"),
                       ("platform", "string"), ("appVersion", "string"),
                       ("userName", "string"), ("createdAt", "datetime"),
                       ("resolved", "boolean")],
            "records": [clean({
                "feedbackId": f["_id"], "message": s(f.get("message"), 500) or "—",
                "type": f.get("type"), "screen": f.get("screen"),
                "platform": f.get("platform"), "appVersion": f.get("appVersion"),
                "userName": f.get("userName"), "createdAt": iso(f.get("createdAt")),
                "resolved": bool(f.get("fixedAt") or f.get("resolvedAt")),
            }) for f in C["feedback"]]}

        ents["pulse_features"] = {
            "displayName": "Pulse Features", "displayField": "text",
            "fields": [("featureId", "string"), ("text", "string"),
                       ("kind", "string"), ("status", "string"),
                       ("createdAt", "datetime")],
            "records": [clean({
                "featureId": p["_id"], "text": s(p.get("text"), 500) or "—",
                "kind": p.get("kind"), "status": p.get("status"),
                "createdAt": iso(p.get("createdAt")),
            }) for p in C["pulseFeatures"]]}

    return attrs, ev, ents, dict(no_time), dict(orphan)


# ── HTTP ───────────────────────────────────────────────────────────────────
def call(base, key, path, body, method="POST", tries=5):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{base}{path}", data=data, method=method,
        headers={"Authorization": f"Bearer {key}",
                 "Content-Type": "application/json",
                 "X-Workspace-Id": WORKSPACE})
    for i in range(tries):
        try:
            r = urllib.request.urlopen(req, timeout=300)
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:280]
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(2 ** i); continue
            return {"_error": e.code, "_msg": msg}
        except Exception as e:
            if i < tries - 1:
                time.sleep(2 ** i); continue
            return {"_error": "net", "_msg": str(e)[:200]}


def chunks(xs, n):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--only", choices=["profiles", "events", "entities"], default=None)
    ap.add_argument("--out", default="joryio_full.json")
    a = ap.parse_args()

    base = os.environ.get("JORYIO_BASE_URL", "").rstrip("/")
    key = os.environ.get("JORYIO_API_KEY", "")
    if a.live and not (base and key):
        sys.exit("חסר JORYIO_BASE_URL / JORYIO_API_KEY")

    attrs, ev, ents, no_time, orphan = build(gtoken())

    by = defaultdict(int)
    for e in ev:
        by[e["name"]] += 1
    print(f"\n{'='*66}\nמוכן\n{'='*66}")
    print(f"  פרופילים: {len(attrs)}")
    print(f"  אירועים:  {len(ev)}  ({len(by)} סוגים)")
    for n, c in sorted(by.items(), key=lambda t: -t[1]):
        print(f"     {n:30} {c:>5}")
    print(f"  ישויות: {len(ents)}")
    for n, e in ents.items():
        print(f"     {n:30} {len(e['records']):>5} רשומות")
    if no_time:
        print("  לא נשלחו — אין חותמת זמן:")
        for n, c in sorted(no_time.items(), key=lambda t: -t[1]):
            print(f"     {n:30} {c:>5}")
    if orphan:
        print("  לא נשלחו — אין מסמך /users:")
        for n, c in sorted(orphan.items(), key=lambda t: -t[1]):
            print(f"     {n:30} {c:>5}")
    if ev:
        print(f"  טווח: {ev[0]['time'][:10]} → {ev[-1]['time'][:10]}")

    json.dump({"attributes": attrs, "events": ev,
               "entities": {k: v["records"] for k, v in ents.items()}},
              open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n  נשמר: {a.out}")
    if not a.live:
        print("\n  DRY-RUN — לא נשלח דבר. הרצה אמיתית: --live")
        return

    if a.only in (None, "profiles"):
        print(f"\nפרופילים ({len(attrs)}):")
        ok = 0
        for b in chunks(attrs, MAX_ATTRS):
            r = call(base, key, "/users/track", {"attributes": b})
            if "_error" in r:
                print(f"  ✗ {r['_error']} {r['_msg']}"); continue
            ok += r.get("attributes", {}).get("processed", 0)
        print(f"  נקלטו {ok}/{len(attrs)}")

    if a.only in (None, "events"):
        print(f"\nאירועים ({len(ev)}):")
        ok, bad = 0, 0
        for i, b in enumerate(chunks(ev, MAX_EVENTS), 1):
            r = call(base, key, "/users/track", {"events": b})
            if "_error" in r:
                print(f"  ✗ אצווה {i}: {r['_error']} {r['_msg']}"); bad += len(b); continue
            p = r.get("events", {})
            ok += p.get("processed", 0)
            for f in p.get("failed", [])[:3]:
                print(f"    ✗ {json.dumps(f, ensure_ascii=False)[:180]}")
        print(f"  נקלטו {ok}/{len(ev)}" + (f"  ({bad} באצוות שנכשלו)" if bad else ""))

    if a.only in (None, "entities"):
        print(f"\nישויות:")
        existing = call(base, key, "/entities", None, method="GET")
        have = {e["name"]: e["id"] for e in existing} if isinstance(existing, list) else {}
        for name, spec in ents.items():
            eid = have.get(name)
            if not eid:
                r = call(base, key, "/entities", {
                    "name": name, "displayName": spec["displayName"],
                    "displayField": spec["displayField"],
                    "fields": [{"name": f, "displayName": f, "fieldType": t,
                                "displayOrder": i}
                               for i, (f, t) in enumerate(spec["fields"])],
                    "settings": {"allowDuplicates": False, "enableAudit": False,
                                 "softDelete": True}})
                if "_error" in r:
                    print(f"  ✗ {name}: יצירה נכשלה {r['_error']} {r['_msg']}"); continue
                eid = r.get("id")
            recs = [x for x in spec["records"] if x]
            ins = 0
            for b in chunks(recs, MAX_RECORDS):
                r = call(base, key, f"/entities/{eid}/records",
                         [{"data": x} for x in b])
                if "_error" in r:
                    print(f"  ✗ {name}: {r['_error']} {r['_msg']}"); break
                ins += r.get("inserted", r.get("processed", 0))
                for f in (r.get("failed") or [])[:2]:
                    print(f"    ✗ {json.dumps(f, ensure_ascii=False)[:180]}")
            print(f"  {name:30} {ins}/{len(recs)}")


if __name__ == "__main__":
    main()
