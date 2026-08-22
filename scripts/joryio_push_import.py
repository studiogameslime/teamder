#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Push tokens → Joryio, in bulk.

Blocked until SDK 1.1.0: the only way to attach a token was one call per device
keyed by Joryio's internal 24-hex id, which we do not hold. `devices` is now a
fourth array on POST /users/track keyed by externalId, applied AFTER attributes,
up to 1000 per request.

Tokens live at /users/{uid}/private/push.fcmTokens — a self-only sub-doc, moved
off the public user doc for security. They are FCM tokens bound to Teamder's
Firebase sender, so they only work once Joryio holds this project's FCM service
account. Uploading them early is harmless and saves re-prompting every user for
a permission they already granted.
"""
import json, os, subprocess, sys, time, urllib.error, urllib.request

P = "soccer-app-52b6b"
FS = f"https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents"
BASE = os.environ.get("JORYIO_BASE_URL", "").rstrip("/")
KEY = os.environ.get("JORYIO_API_KEY", "")
LIVE = "--live" in sys.argv
# The documented cap is 1000, but a 400-device request 502s — the server does
# not survive the batch, and a gateway error carries no per-index detail to
# retry from. 50 keeps each request small enough to answer.
MAX_DEVICES = 50


def val(x):
    k = next(iter(x))
    if k == "arrayValue": return [val(i) for i in x[k].get("values", [])]
    if k == "integerValue": return int(x[k])
    if k == "mapValue": return {a: val(b) for a, b in x[k].get("fields", {}).items()}
    return None if k == "nullValue" else x[k]


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
print(f"משתמשים: {len(users)}")

devices, people = [], 0
for i, u in enumerate(users):
    uid = u["_id"]
    # Recorded per user by notificationsService; absent for anyone who never
    # granted permission.
    plat = u.get("platform")
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request(
            f"{FS}/users/{uid}/private/push", headers=H), timeout=30))
        f = {a: val(b) for a, b in r.get("fields", {}).items()}
    except urllib.error.HTTPError:
        continue
    toks = [t for t in (f.get("fcmTokens") or []) if isinstance(t, str) and t.strip()]
    if not toks:
        continue
    people += 1
    for t in toks:
        devices.append({
            "externalId": uid,
            # FCM tokens are issued per Firebase sender, not per OS, so a token
            # alone does not say which platform it came from. The user doc's
            # `platform` is the only signal we have; default to android, which
            # is where the overwhelming majority of this install base is.
            "platform": plat if plat in ("ios", "android", "web") else "android",
            "pushToken": t,
        })
    if i % 100 == 0:
        print(f"\r  {i}/{len(users)}", end="", flush=True)
print(f"\r  נסרקו {len(users)}        ")
print(f"  אנשים עם טוקן: {people} · מכשירים: {len(devices)}")
from collections import Counter
for p_, c in Counter(d["platform"] for d in devices).most_common():
    print(f"     {p_}: {c}")

if not LIVE:
    print("\n  DRY-RUN. להרצה: --live")
    print("  דוגמה:", json.dumps({**devices[0], "pushToken": devices[0]["pushToken"][:22] + "…"},
                                 ensure_ascii=False) if devices else "—")
    sys.exit()

ok = fail = 0
for i in range(0, len(devices), MAX_DEVICES):
    batch = devices[i:i + MAX_DEVICES]
    body = json.dumps({"devices": batch}).encode()
    print(f"  אצווה {i//MAX_DEVICES + 1}/{(len(devices)+MAX_DEVICES-1)//MAX_DEVICES}", flush=True)
    for attempt in range(5):
        try:
            req = urllib.request.Request(
                f"{BASE}/users/track", data=body,
                headers={"Authorization": f"Bearer {KEY}",
                         "Content-Type": "application/json"})
            res = json.load(urllib.request.urlopen(req, timeout=300))
            d_ = res.get("devices", {})
            ok += d_.get("processed", 0)
            for f_ in d_.get("failed", []):
                fail += 1
                if fail <= 5:
                    print(f"    ✗ index {f_.get('index')}: {f_.get('reason')}")
            break
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:250]
            if e.code == 429:
                time.sleep(int(e.headers.get("x-ratelimit-reset") or 20) + 2); continue
            if e.code in (500, 502, 503, 504) and attempt < 4:
                time.sleep(2 ** attempt); continue
            print(f"  ✗ HTTP {e.code}: {msg}"); break
        except Exception as e:
            if attempt < 4:
                time.sleep(2 ** attempt); continue
            print(f"  ✗ {str(e)[:150]}")
print(f"\n  נקלטו {ok}/{len(devices)}" + (f" · {fail} נכשלו" if fail else ""))
