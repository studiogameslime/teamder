#!/usr/bin/env python3
"""What is live on every Google Play track, straight from the Play API.

Use this to decide the next version number before a build, and to VERIFY
after a submit — the EAS log says what it tried to do, this says what Google
actually holds. A release has already gone out believed-internal while it was
sitting in production; one call here would have caught it.

    python3 scripts/play-tracks.py

Needs `credentials/gplay-service-account.json` (gitignored — copy it by hand
onto any new machine) and PyJWT.

⚠️ Do NOT run this while `eas submit` is in flight. It opens a Play edit of
its own, which deletes the edit fastlane is holding and fails the submit.
"""

import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

try:
    import jwt
except ImportError:
    sys.exit("PyJWT is missing:  pip3 install pyjwt")

PACKAGE = "com.studiogameslime.soccerapp"
KEY = pathlib.Path(__file__).resolve().parent.parent / "credentials" / "gplay-service-account.json"
BASE = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}"


def access_token() -> str:
    if not KEY.exists():
        sys.exit(f"missing service account key: {KEY}")
    sa = json.loads(KEY.read_text())
    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": sa["client_email"],
            "scope": "https://www.googleapis.com/auth/androidpublisher",
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now,
            "exp": now + 3600,
        },
        sa["private_key"],
        algorithm="RS256",
    )
    body = urllib.parse.urlencode(
        {
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        }
    ).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body)
    return json.load(urllib.request.urlopen(req, timeout=60))["access_token"]


def main() -> None:
    headers = {"Authorization": f"Bearer {access_token()}", "Content-Type": "application/json"}

    def get(url: str, method: str = "GET", payload: dict | None = None):
        req = urllib.request.Request(
            url,
            headers=headers,
            method=method,
            data=json.dumps(payload).encode() if payload is not None else None,
        )
        return json.load(urllib.request.urlopen(req, timeout=90))

    # An edit is required even to read. It is never committed, so it expires
    # on its own and changes nothing.
    edit = get(f"{BASE}/edits", "POST", {})["id"]

    print(f"{'track':24} {'version':14} {'versionCode':12} status")
    print("-" * 62)
    for track in get(f"{BASE}/edits/{edit}/tracks")["tracks"]:
        for release in track.get("releases", []):
            codes = ",".join(str(c) for c in release.get("versionCodes", []) or ["—"])
            print(
                f"{track['track']:24} {str(release.get('name', '—')):14} "
                f"{codes:12} {release.get('status', '—')}"
            )


if __name__ == "__main__":
    main()
