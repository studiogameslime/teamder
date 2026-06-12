#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dump pulseFeatures / feedback / errors cleanly (no base64 images)."""
import subprocess, sys, json, urllib.request

PROJECT = "soccer-app-52b6b"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
TOKEN = subprocess.run(["gcloud","auth","print-access-token"],capture_output=True,text=True).stdout.strip()

def val(v):
    if not isinstance(v, dict): return v
    k = next(iter(v))
    x = v[k]
    if k == "arrayValue":
        return f"[{len(x.get('values',[]))} items]"
    if k == "mapValue":
        return "{...}"
    return x

def fetch(coll):
    docs, tok = [], None
    while True:
        url = f"{BASE}/{coll}?pageSize=300" + (f"&pageToken={tok}" if tok else "")
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
        d = json.load(urllib.request.urlopen(req))
        docs += d.get("documents", [])
        tok = d.get("nextPageToken")
        if not tok: break
    return docs

coll = sys.argv[1] if len(sys.argv) > 1 else "pulseFeatures"
skip_fields = {"images", "image", "screenshot", "screenshots", "stack", "stackTrace"}
only_status = sys.argv[2] if len(sys.argv) > 2 else None  # e.g. "!done" or "done"
docs = fetch(coll)
print(f"=== {coll}: {len(docs)} docs ===")
shown = 0
for doc in docs:
    f = doc.get("fields", {})
    status = val(f.get("status", {})) if "status" in f else None
    if only_status == "!done" and status == "done": continue
    if only_status and only_status != "!done" and status != only_status: continue
    did = doc["name"].split("/")[-1]
    parts = {k: val(v) for k, v in f.items() if k not in skip_fields}
    txt = parts.pop("text", "") or parts.pop("message", "") or parts.pop("body", "")
    print(f"\n[{did}]")
    print(f"  status={status} kind={parts.get('kind')} createdAt={parts.get('createdAt')}")
    if txt: print(f"  TEXT: {str(txt)[:400]}")
    other = {k:v for k,v in parts.items() if k not in ('kind','status','createdAt')}
    if other: print(f"  {other}")
    shown += 1
print(f"\n--- shown {shown} ---")
