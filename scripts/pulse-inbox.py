#!/usr/bin/env python3
"""Read the Pulse inbox — the reports, errors and ideas Teamder collects.

    python3 scripts/pulse-inbox.py                  # how many are open, per stream
    python3 scripts/pulse-inbox.py --open           # the open items, in full
    python3 scripts/pulse-inbox.py --open --shots ./out   # …and save their screenshots
    python3 scripts/pulse-inbox.py --close <id> --stream feedback --note "what you did"

Auth is the signed-in gcloud user, same as everything else here:

    gcloud auth login
    gcloud config set project soccer-app-52b6b

── Three things that will mislead you ──────────────────────────────────────
1. **Every report carries a screenshot** in `image` (base64 JPEG). Triaging
   from the text alone gets it wrong — the owner draws a red circle round the
   thing he means. Use --shots and LOOK at them.
2. **`errors` is ordered by `lastSeen`, not `createdAt`.** Sorting by
   createdAt returns nothing, because the field does not exist on those docs.
3. **Firestore's REST `list` endpoint serves stale data here.** Always query
   through `documents:runQuery`, which this script does.

Closing an item uses a different status per stream — `errors` wants
'resolved', everything else wants 'done'. The wrong value leaves the item
counted as open in the app's badge. The table below is the authority.
"""

import argparse
import base64
import json
import pathlib
import subprocess
import sys
import urllib.parse
import urllib.request

PROJECT = "soccer-app-52b6b"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"

# stream -> (status value that means CLOSED, field it is ordered by)
STREAMS = {
    "feedback": ("done", "createdAt"),
    "errors": ("resolved", "lastSeen"),
    "pulseFeatures": ("done", "createdAt"),
    "pulseIdeas": (None, "createdAt"),  # parked ideas are the owner's — never close
    "chatReports": ("done", "createdAt"),
}


def token() -> str:
    out = subprocess.run(
        ["gcloud", "auth", "print-access-token"], capture_output=True, text=True
    )
    if out.returncode != 0:
        sys.exit("gcloud is not signed in — run:  gcloud auth login")
    return out.stdout.strip()


def headers() -> dict:
    return {"Authorization": f"Bearer {token()}", "Content-Type": "application/json"}


def scalar(fields: dict, key: str) -> str:
    """Firestore wraps every value in a type tag; unwrap the simple ones."""
    v = fields.get(key)
    if not v:
        return ""
    for t in ("stringValue", "integerValue", "booleanValue", "timestampValue", "doubleValue"):
        if t in v:
            return str(v[t])
    if "mapValue" in v:
        inner = v["mapValue"].get("fields", {})
        return json.dumps(
            {k: list(x.values())[0] for k, x in inner.items()}, ensure_ascii=False
        )
    return ""


def query(stream: str, limit: int = 300) -> list:
    order = STREAMS[stream][1]
    body = {
        "structuredQuery": {
            "from": [{"collectionId": stream}],
            "orderBy": [{"field": {"fieldPath": order}, "direction": "DESCENDING"}],
            "limit": limit,
        }
    }
    req = urllib.request.Request(
        f"{BASE}:runQuery", headers=headers(), data=json.dumps(body).encode()
    )
    rows = json.load(urllib.request.urlopen(req, timeout=120))
    return [r["document"] for r in rows if r.get("document")]


def is_open(stream: str, doc: dict) -> bool:
    closed = STREAMS[stream][0]
    status = scalar(doc["fields"], "status")
    if stream == "pulseIdeas":
        return status == "idea"
    return status != closed


def summary() -> None:
    print(f"{'stream':16}{'total':>7}{'open':>7}")
    print("-" * 30)
    for s in STREAMS:
        try:
            docs = query(s)
        except Exception as e:  # a stream may not exist yet
            print(f"{s:16}{'—':>7}{'—':>7}   ({str(e)[:40]})")
            continue
        o = sum(1 for d in docs if is_open(s, d))
        print(f"{s:16}{len(docs):>7}{o:>7}")
    print("\npulseIdeas are PARKED — the owner's, not yours. Do not close them.")


def show_open(shots: pathlib.Path | None) -> None:
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    for s in STREAMS:
        if s == "pulseIdeas":
            continue
        try:
            docs = [d for d in query(s) if is_open(s, d)]
        except Exception:
            continue
        if not docs:
            continue
        print(f"\n{'='*66}\n{s}  —  {len(docs)} open\n{'='*66}")
        for d in docs:
            f = d["fields"]
            did = d["name"].rsplit("/", 1)[-1]
            text = scalar(f, "message") or scalar(f, "lastMessage") or scalar(f, "title")
            print(f"\n[{did}]")
            print(f"  screen  : {scalar(f,'screen') or scalar(f,'lastScreen')}")
            print(f"  version : {scalar(f,'appVersion')} {scalar(f,'platform')}")
            print(f"  by      : {scalar(f,'userName') or scalar(f,'lastUserId')[:14]}")
            if scalar(f, "count"):
                print(f"  count   : {scalar(f,'count')}")
            print(f"  text    : {text}")
            if "image" in f and shots:
                raw = base64.b64decode(scalar(f, "image").split(",")[-1])
                p = shots / f"{s}-{did}.jpg"
                p.write_bytes(raw)
                print(f"  shot    : {p}   <-- OPEN THIS, do not judge from the text")


def close(stream: str, doc_id: str, note: str) -> None:
    status = STREAMS[stream][0]
    if status is None:
        sys.exit(f"{stream} items are parked — they are the owner's to close, not yours.")
    if not note.strip():
        sys.exit("a note is required: say what was actually fixed, not just 'done'")
    import time

    fields = {
        "status": {"stringValue": status},
        "claudeNote": {"stringValue": note},
        "claudeStatus": {"stringValue": "done"},
        "claudeAt": {"integerValue": str(int(time.time() * 1000))},
    }
    mask = "&".join(
        f"updateMask.fieldPaths={urllib.parse.quote(k)}" for k in fields
    )
    req = urllib.request.Request(
        f"{BASE}/{stream}/{doc_id}?{mask}",
        headers=headers(),
        method="PATCH",
        data=json.dumps({"fields": fields}).encode(),
    )
    urllib.request.urlopen(req, timeout=90)
    print(f"closed {stream}/{doc_id} as '{status}'")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--open", action="store_true", help="list the open items in full")
    ap.add_argument("--shots", type=pathlib.Path, help="directory to save report screenshots into")
    ap.add_argument("--close", metavar="DOC_ID", help="mark one item closed")
    ap.add_argument("--stream", choices=list(STREAMS), help="which stream --close refers to")
    ap.add_argument("--note", default="", help="what was actually fixed")
    a = ap.parse_args()

    if a.close:
        if not a.stream:
            sys.exit("--close needs --stream")
        close(a.stream, a.close, a.note)
    elif a.open:
        show_open(a.shots)
    else:
        summary()


if __name__ == "__main__":
    main()
