#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Push-reachability flags → Joryio profiles.

The token STRINGS are deliberately not sent. Joryio cannot deliver through them
(that needs Teamder's own FCM/APNs credentials uploaded to a Joryio App, and
registration through an SDK key), so shipping them would move a live push
credential out of the self-only /users/{uid}/private/push doc to no purpose.

What IS useful, and is what this sends: whether a person can be reached by push
at all, and on how many devices. That is enough to segment on.
"""
import json, os, subprocess, sys, time, urllib.error, urllib.request

P = "soccer-app-52b6b"
FS = f"https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents"
BASE = os.environ.get("JORYIO_BASE_URL", "").rstrip("/")
KEY = os.environ.get("JORYIO_API_KEY", "")
LIVE = "--live" in sys.argv

tok = subprocess.run(["gcloud", "auth", "print-access-token"],
                     capture_output=True, text=True).stdout.strip()
H = {"Authorization": f"Bearer {tok}"}


def val(x):
    k = next(iter(x))
    if k == "arrayValue": return [val(i) for i in x[k].get("values", [])]
    if k == "integerValue": return int(x[k])
    if k == "mapValue": return {a: val(b) for a, b in x[k].get("fields", {}).items()}
    return None if k == "nullValue" else x[k]


uids, npt = [], None
while True:
    u = f"{FS}/users?pageSize=300" + (f"&pageToken={npt}" if npt else "")
    d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=120))
    uids += [x["name"].rsplit("/", 1)[-1] for x in d.get("documents", [])]
    npt = d.get("nextPageToken")
    if not npt:
        break

rows, with_tok, total = [], 0, 0
for i, uid in enumerate(uids):
    n = 0
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request(
            f"{FS}/users/{uid}/private/push", headers=H), timeout=30))
        f = {a: val(b) for a, b in r.get("fields", {}).items()}
        n = len([t for t in (f.get("fcmTokens") or []) if isinstance(t, str)])
    except urllib.error.HTTPError:
        pass
    if n:
        with_tok += 1
        total += n
    rows.append({"externalId": uid,
                 "attributes": {"pushReachable": n > 0, "pushDeviceCount": n}})
    if i % 100 == 0:
        print(f"\r  {i}/{len(uids)}", end="", flush=True)
print(f"\r  נסרקו {len(uids)}        ")
print(f"  ניתנים לפוש: {with_tok} · מכשירים: {total} · ללא: {len(uids)-with_tok}")

if not LIVE:
    print("\n  DRY-RUN. להרצה: --live")
    sys.exit()

ok = 0
for i in range(0, len(rows), 100):
    b = rows[i:i + 100]
    req = urllib.request.Request(
        f"{BASE}/users/track", data=json.dumps({"attributes": b}).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    for attempt in range(4):
        try:
            ok += json.load(urllib.request.urlopen(req, timeout=300)) \
                    .get("attributes", {}).get("processed", 0)
            break
        except Exception:
            if attempt == 3:
                print(f"  ✗ אצווה {i//100+1}")
            else:
                time.sleep(2 ** attempt)
print(f"  עודכנו {ok}/{len(rows)} פרופילים")
