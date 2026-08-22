#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Invite attribution → Joryio custom attributes.

Teamder already records who brought each person and through which surface —
`invitedBy`, `invitedByType`, `invitedByTargetId`, `invitedAt` on the user doc.
None of it had reached Joryio, so the growth loop was invisible there.

Sends two things per invited user:
  • attributes — invitedBy (uid), invitedByName (readable), invitedVia
    (game/community/app), invitedAt. These make "who did X bring" a segment.
  • one `Invite Accepted` event stamped with the REAL invitedAt, so the
    referral shows up on the timeline where it happened rather than today.

`invitedByType` is stored as the internal surface name; it is mapped to plain
words here because these attributes are read by humans in the dashboard:
    session → game · team → community · app → app
"""
import json, os, subprocess, sys, time, urllib.error, urllib.request

P = "soccer-app-52b6b"
FS = f"https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents"
BASE = os.environ.get("JORYIO_BASE_URL", "").rstrip("/")
KEY = os.environ.get("JORYIO_API_KEY", "")
LIVE = "--live" in sys.argv
BATCH = 100

VIA = {"session": "game", "team": "community", "app": "app"}


def val(x):
    k = next(iter(x))
    if k == "integerValue": return int(x[k])
    if k == "doubleValue": return float(x[k])
    if k == "nullValue": return None
    if k == "arrayValue": return [val(i) for i in x[k].get("values", [])]
    if k == "mapValue": return {a: val(b) for a, b in x[k].get("fields", {}).items()}
    return x[k]


def iso(v):
    """`invitedAt` is an ISO string on some docs and ms-epoch on others — accept
    both, and return None for anything unusable rather than stamping 'now'."""
    if isinstance(v, str):
        s_ = v.strip()
        if len(s_) >= 19 and s_[4] == "-" and s_[7] == "-":
            return s_ if s_.endswith("Z") else s_[:19] + ".000Z"
        return None
    if not isinstance(v, (int, float)) or v <= 0:
        return None
    if v < 1e11:
        v *= 1000
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(v / 1000))


tok = subprocess.run(["gcloud", "auth", "print-access-token"],
                     capture_output=True, text=True).stdout.strip()
H = {"Authorization": f"Bearer {tok}"}

users, npt = [], None
while True:
    u = f"{FS}/users?pageSize=300" + (f"&pageToken={npt}" if npt else "")
    d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=120))
    for x in d.get("documents", []):
        r = {a: val(b) for a, b in x.get("fields", {}).items()}
        r["_id"] = x["name"].rsplit("/", 1)[-1]
        users.append(r)
    npt = d.get("nextPageToken")
    if not npt:
        break

names = {u["_id"]: u.get("name") for u in users}
known = set(names)
attrs, events = [], []
from collections import Counter
by_type = Counter()

for u in users:
    inviter = u.get("invitedBy")
    if not inviter:
        continue
    via = VIA.get(u.get("invitedByType") or "", u.get("invitedByType") or "unknown")
    by_type[via] += 1
    a = {"invitedBy": inviter, "invitedVia": via}
    nm = names.get(inviter)
    if nm:
        a["invitedByName"] = nm
    if u.get("invitedByTargetId"):
        a["invitedByTargetId"] = u["invitedByTargetId"]
    when = iso(u.get("invitedAt"))
    if when:
        a["invitedAt"] = when
    attrs.append({"externalId": u["_id"], "attributes": a})

    # The referral itself, on the day it happened. Without a real timestamp the
    # event would land today and distort every cohort it touches, so it is
    # dropped rather than approximated.
    if when and inviter in known:
        # NOTE the field names. The REST endpoint (/users/track, jry_live key)
        # takes `name` + `time`; the SDK endpoint (/v1/track, jry_sdk key) takes
        # `type` + `timestamp` for the same thing. Mixing them up returns 200
        # with processed:0 and a failed[] entry — easy to miss in a loop.
        events.append({
            "externalId": u["_id"],
            "name": "Invite Accepted",
            "time": when,
            "clientEventId": f"invacc:{u['_id']}",
            "properties": {"invitedVia": via, "invitedBy": inviter,
                           **({"targetId": u["invitedByTargetId"]}
                              if u.get("invitedByTargetId") else {})},
        })

# How many people each inviter brought — a number worth segmenting on.
brought = Counter(u.get("invitedBy") for u in users if u.get("invitedBy"))
for uid, n in brought.items():
    if uid in known:
        attrs.append({"externalId": uid, "attributes": {"usersInvited": n}})

print(f"  משתמשים: {len(users)}")
print(f"  עם ייחוס: {sum(by_type.values())}")
for v, c in by_type.most_common():
    print(f"     {v:12} {c}")
print(f"  מזמינים: {len(brought)}")
print(f"  אירועי Invite Accepted: {len(events)}")

if not LIVE:
    print("\n  DRY-RUN. להרצה: --live")
    if attrs: print("  דוגמה:", json.dumps(attrs[0], ensure_ascii=False)[:230])
    sys.exit()


def post(body):
    for i in range(5):
        try:
            req = urllib.request.Request(
                f"{BASE}/users/track", data=json.dumps(body).encode(),
                headers={"Authorization": f"Bearer {KEY}",
                         "Content-Type": "application/json"})
            return json.load(urllib.request.urlopen(req, timeout=300))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(int(e.headers.get("x-ratelimit-reset") or 20) + 2); continue
            if e.code in (500, 502, 503, 504) and i < 4:
                time.sleep(2 ** i); continue
            return {"_error": e.code, "_msg": e.read().decode()[:200]}
        except Exception as e:
            if i < 4:
                time.sleep(2 ** i); continue
            return {"_error": "net", "_msg": str(e)[:150]}


ok = 0
for i in range(0, len(attrs), BATCH):
    r = post({"attributes": attrs[i:i + BATCH]})
    if "_error" in r:
        print(f"  ✗ {r['_error']} {r['_msg'][:120]}"); continue
    ok += r.get("attributes", {}).get("processed", 0)
print(f"  פרופילים עודכנו: {ok}/{len(attrs)}")

eok = 0
for i in range(0, len(events), BATCH):
    r = post({"events": events[i:i + BATCH]})
    if "_error" in r:
        print(f"  ✗ {r['_error']} {r['_msg'][:120]}"); continue
    eok += r.get("events", {}).get("processed", 0)
print(f"  אירועים נקלטו: {eok}/{len(events)}")
