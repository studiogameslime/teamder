#!/usr/bin/env python3
"""Log a QA finding into the Teamder `errors` Firestore collection so it
shows up in Pulse (category 'qa', 🔍). Idempotent: the same screen+title
updates the same doc instead of duplicating.

Usage:
  python3 scripts/qa_finding.py \
    --screen GamesListScreen --severity med --area "רשימת משחקים" \
    --title "כותרת קצרה" --msg "תיאור הממצא" --rec "המלצה לתיקון"

severity: low | med | high
Requires: gcloud auth (studiogameslime@gmail.com), project soccer-app-52b6b.
"""
import argparse, hashlib, json, subprocess, sys, time, urllib.request, urllib.error

PROJECT = "soccer-app-52b6b"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"


def token():
    return subprocess.check_output(
        ["gcloud", "auth", "print-access-token"], text=True
    ).strip()


def fp(screen, title):
    h = hashlib.md5(f"{screen}|{title}".encode("utf-8")).hexdigest()[:12]
    return f"qa-{screen}-{h}"


def ts(ms):
    # Firestore timestampValue (RFC3339) — but loader uses Number(); we store
    # ms epoch as integerValue to be display/sort safe.
    return {"integerValue": str(ms)}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--screen", required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--msg", required=True)
    p.add_argument("--severity", default="med", choices=["low", "med", "high"])
    p.add_argument("--area", default="")
    p.add_argument("--rec", default="")
    a = p.parse_args()

    doc_id = fp(a.screen, a.title)
    now = int(time.time() * 1000)
    sev_he = {"low": "נמוכה", "med": "בינונית", "high": "גבוהה"}[a.severity]

    ctx = {
        "mapValue": {
            "fields": {
                "area": {"stringValue": a.area},
                "severity": {"stringValue": a.severity},
                "severityHe": {"stringValue": sev_he},
                "recommendation": {"stringValue": a.rec},
                "source": {"stringValue": "qa-emulator"},
                "screen": {"stringValue": a.screen},
            }
        }
    }
    fields = {
        "operation": {"stringValue": "qaFinding"},
        "title": {"stringValue": f"[{sev_he}] {a.title}"},
        "category": {"stringValue": "qa"},
        "lastMessage": {"stringValue": a.msg},
        "lastScreen": {"stringValue": a.screen},
        "lastContext": ctx,
        "lastUserId": {"nullValue": None},
        "platform": {"stringValue": "android"},
        "osVersion": {"stringValue": "15"},
        "appVersion": {"stringValue": "1.0.6-qa"},
        "count": {"integerValue": "1"},
        "status": {"stringValue": "new"},
        "fingerprint": {"stringValue": doc_id},
        "firstSeen": ts(now),
        "lastSeen": ts(now),
    }

    # PATCH with documentId == create-or-overwrite (no updateMask → full set).
    url = f"{BASE}/errors/{doc_id}"
    body = json.dumps({"fields": fields}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="PATCH")
    req.add_header("Authorization", f"Bearer {token()}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            r.read()
        print(f"OK  {doc_id}  [{sev_he}] {a.title}")
    except urllib.error.HTTPError as e:
        print(f"ERR {e.code} {doc_id}: {e.read().decode()[:300]}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
