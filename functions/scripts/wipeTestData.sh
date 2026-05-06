#!/usr/bin/env bash
# One-shot: wipe ALL test data from Firestore (games, groups, related
# state) WITHOUT triggering any client-side notification dispatch.
# Uses the gcloud user token directly against the Firestore REST API
# — bypasses every client onCreate/onWrite hook.
#
# Skips:
#   /users/*       — keep tester accounts so they can sign back in
#   /appConfig/*   — version-gate config
#
# Run from anywhere on the dev machine.

set -euo pipefail

PROJECT="soccer-app-52b6b"
BASE="https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents"
TOKEN=$(gcloud auth print-access-token)

# List + delete every top-level doc in a collection. Quiet by default;
# prints a tally at the end.
wipe_collection() {
  local coll="$1"
  local deleted=0
  local page_token=""

  while :; do
    local url="${BASE}/${coll}?pageSize=300"
    [[ -n "$page_token" ]] && url="${url}&pageToken=${page_token}"

    local resp
    resp=$(curl -s -H "Authorization: Bearer ${TOKEN}" "$url")
    local doc_paths
    doc_paths=$(echo "$resp" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
for doc in d.get('documents', []):
    print(doc['name'])
")
    page_token=$(echo "$resp" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
print(d.get('nextPageToken', ''))
")

    if [[ -z "$doc_paths" ]]; then
      break
    fi

    while IFS= read -r path; do
      [[ -z "$path" ]] && continue
      curl -s -X DELETE -H "Authorization: Bearer ${TOKEN}" \
        "https://firestore.googleapis.com/v1/${path}" > /dev/null
      ((deleted++))
    done <<< "$doc_paths"

    [[ -z "$page_token" ]] && break
  done

  echo "  ${coll}: deleted ${deleted}"
}

# Recursively wipe ratings + votes nested under each group BEFORE
# deleting the group docs themselves.
wipe_group_ratings() {
  local groups
  groups=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
    "${BASE}/groups?pageSize=300" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
for doc in d.get('documents', []):
    print(doc['name'].split('/')[-1])
")

  if [[ -z "$groups" ]]; then
    echo "  no groups → skipping ratings sweep"
    return
  fi

  while IFS= read -r gid; do
    [[ -z "$gid" ]] && continue

    # ratings under this group
    local rated_users
    rated_users=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
      "${BASE}/groups/${gid}/ratings?pageSize=300" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
for doc in d.get('documents', []):
    print(doc['name'].split('/')[-1])
")
    while IFS= read -r ruid; do
      [[ -z "$ruid" ]] && continue
      # votes under this rating
      wipe_collection "groups/${gid}/ratings/${ruid}/votes" || true
      # the rating summary itself
      curl -s -X DELETE -H "Authorization: Bearer ${TOKEN}" \
        "${BASE}/groups/${gid}/ratings/${ruid}" > /dev/null
    done <<< "$rated_users"
  done <<< "$groups"
}

echo "→ Wiping ratings/votes subcollections…"
wipe_group_ratings

echo "→ Wiping top-level test collections…"
for coll in games groups groupsPublic groupJoinRequests rounds notifications gameUpdateLatches playerStats; do
  wipe_collection "$coll"
done

echo "✓ done."
