#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One-time migration: internal rating scale 1–10 → 0.5–5.0 (÷2).

Divides every Group.adminRatings value and every guest's estimatedRating by 2,
rounded to one decimal. Run ONCE, together with the release that ships the new
decimal rating UI — running it before the new client is live would make the app
show out-of-range values, and running it twice would halve again.

Usage:
  python3 scripts/migrate_rating_to_5.py            # dry run (prints changes)
  python3 scripts/migrate_rating_to_5.py --commit   # actually writes
"""
import subprocess, sys, json, urllib.request

PROJECT = "soccer-app-52b6b"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
TOKEN = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True).stdout.strip()
COMMIT = "--commit" in sys.argv
HDRS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def half(v):
    # ÷2 onto the new 1.0–5.0 scale, one decimal, clamped to the [1, 5] range
    # (old min 1 → 0.5 → 1).
    return min(5.0, max(1.0, round(v / 2, 1)))


def fetch(coll):
    docs, tok = [], None
    while True:
        url = f"{BASE}/{coll}?pageSize=300" + (f"&pageToken={tok}" if tok else "")
        d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=HDRS)))
        docs += d.get("documents", [])
        tok = d.get("nextPageToken")
        if not tok:
            break
    return docs


def num(v):
    if "integerValue" in v: return int(v["integerValue"])
    if "doubleValue" in v: return float(v["doubleValue"])
    return None


def patch(path, fields_mask, body_fields):
    mask = "&".join(f"updateMask.fieldPaths={m}" for m in fields_mask)
    url = f"{BASE}/{path}?{mask}"
    req = urllib.request.Request(url, data=json.dumps({"fields": body_fields}).encode(),
                                 method="PATCH", headers=HDRS)
    urllib.request.urlopen(req)


groups_changed = guests_changed = 0

# ── Groups: adminRatings map ────────────────────────────────────────────
for doc in fetch("groups"):
    gid = doc["name"].split("/")[-1]
    ar = doc.get("fields", {}).get("adminRatings", {}).get("mapValue", {}).get("fields")
    if not ar:
        continue
    new_map = {}
    changed = False
    for uid, v in ar.items():
        old = num(v)
        if old is None:
            new_map[uid] = v
            continue
        nv = half(old)
        if nv != old:
            changed = True
        new_map[uid] = {"doubleValue": nv}
    if changed:
        groups_changed += 1
        print(f"group {gid}: " + ", ".join(f"{u}:{num(ar[u])}→{new_map[u]['doubleValue']}" for u in ar))
        if COMMIT:
            patch(f"groups/{gid}", ["adminRatings"],
                  {"adminRatings": {"mapValue": {"fields": new_map}}})

# ── Games: guests[].estimatedRating ─────────────────────────────────────
for doc in fetch("games"):
    gid = doc["name"].split("/")[-1]
    guests = doc.get("fields", {}).get("guests", {}).get("arrayValue", {}).get("values")
    if not guests:
        continue
    changed = False
    for g in guests:
        gf = g.get("mapValue", {}).get("fields", {})
        if "estimatedRating" in gf:
            old = num(gf["estimatedRating"])
            if old is not None:
                gf["estimatedRating"] = {"doubleValue": half(old)}
                changed = True
    if changed:
        guests_changed += 1
        print(f"game {gid}: guest ratings halved")
        if COMMIT:
            patch(f"games/{gid}", ["guests"],
                  {"guests": {"arrayValue": {"values": guests}}})

mode = "COMMITTED" if COMMIT else "DRY RUN (no writes)"
print(f"\n{mode}: {groups_changed} groups, {guests_changed} games with guest ratings.")
