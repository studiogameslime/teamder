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
# Defaults to PRODUCTION. This used to be "", so an unset variable sent every
# request to a bare path and failed in a way that looked like an API fault.
BASE = os.environ.get("JORYIO_BASE_URL", "https://api-eu1.joryio.com/api").rstrip("/")
KEY = os.environ.get("JORYIO_API_KEY", "")
LIVE = "--live" in sys.argv
# The documented cap is 1000, but a 400-device request 502s — the server does
# not survive the batch, and a gateway error carries no per-index detail to
# retry from. 50 keeps each request small enough to answer.
MAX_DEVICES = 50

# Joryio app ids, one per platform (Settings → Apps in their dashboard). Every
# imported device MUST name one — see the comment on the payload below.
APP_IDS = {
    "android": "582c204f-327e-4d76-9703-b8655454b887",
    "ios": "61169e4e-72ab-45fd-84f0-7ec606be0424",
    "web": "418d3496-9a1e-49af-83a7-a7bdc8122d49",
}


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
        # FCM tokens are issued per Firebase sender, not per OS, so a token
        # alone does not say which platform it came from. The user doc's
        # `platform` is the only signal we have; default to android, which is
        # where the overwhelming majority of this install base is.
        platform = plat if plat in ("ios", "android", "web") else "android"
        app_id = APP_IDS.get(platform)
        if not app_id:
            raise SystemExit(f"no appId configured for platform {platform!r} — see APP_IDS")
        devices.append({
            "externalId": uid,
            "platform": platform,
            "pushToken": t,
            # REQUIRED. Campaign sends filter devices on `deviceInfo.appId`, and
            # a device without one is excluded from every send — while the
            # campaign reports "no active push devices", which reads as "this
            # person never installed the app" rather than "we are holding a
            # token we declined to use". The first import of this file had no
            # appId at all and 200 valid tokens sat unreachable because of it.
            #
            # There was briefly a server-side fallback that included untagged
            # devices when a workspace had exactly one app per platform. It has
            # been REMOVED, deliberately — it made reachability depend on how
            # many apps a workspace happened to have, and would have dropped
            # hundreds of recipients the day a second one was added. So this is
            # not optional regardless of how many apps exist.
            "appId": app_id,
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
