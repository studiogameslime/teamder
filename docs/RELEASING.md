# Shipping an Android build to Google Play

The exact sequence, as actually run for 1.1.32 (versionCode 267) on
06.10.2026. Read [`AGENTS.md`](../AGENTS.md) §6 first — the rules there
override anything convenient you find here.

---

## What you need before you start

| | Where it lives | Notes |
|---|---|---|
| **EAS login** | `eas login` → `studiogameslime` | **This is what unlocks the Android keystore.** |
| **Android keystore** | On Expo's servers, not on disk | Build Credentials `Qlpwp6SIuv`. **Irreplaceable** — lose it and this app can never be updated again, only republished under a new package name. |
| **Play service account** | `credentials/gplay-service-account.json` | Gitignored. Must be copied by hand onto any new machine. |
| **Build env vars** | The EAS `preview` environment | Pulled down by the build; nothing to do locally. |
| `.env.local` | Repo root, gitignored | Only needed to RUN the app locally, not to build a release. |
| **Toolchain** | Node 20, Java 17 | Verified working combination. |

Check you are ready:

```bash
npx eas whoami                              # must print studiogameslime
ls credentials/gplay-service-account.json   # must exist
java -version                               # 17
```

---

## 1. Before the build

**Read the production error log and triage it.** This is a gate, not a
courtesy — ask before fixing anything you find.

```bash
TOKEN=$(gcloud auth print-access-token)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
 "https://firestore.googleapis.com/v1/projects/soccer-app-52b6b/databases/(default)/documents:runQuery" \
 -d '{"structuredQuery":{"from":[{"collectionId":"errors"}],
      "orderBy":[{"field":{"fieldPath":"lastSeen"},"direction":"DESCENDING"}],"limit":40}}'
```

Errors are keyed by `lastSeen`, not `createdAt`. An item is open unless its
`status` is `resolved`.

**See what is live right now**, so you know what the next version number is:

```bash
python3 scripts/play-tracks.py    # prints every track + versionCode
```

**Bump the version.** Edit `expo.version` in `app.json` by hand. The
`versionCode` is NOT in `app.json` — EAS increments it remotely
(`autoIncrement: true`), so leave it alone.

**Green before you build:**

```bash
npx tsc --noEmit
npx jest
```

---

## 2. Build

A local build. The cloud quota is exhausted, and local is what the last
several releases used.

```bash
EAS_BUILD_NO_EXPO_GO_WARNING=true npx eas build \
  --platform android --profile production --local \
  --output /tmp/teamder-<version>.aab --non-interactive
```

- `--profile production` here selects the **build** profile. It does not mean
  the production track; that is decided at submit time.
- Expect ~8 minutes. A build that had to re-run `prebuild` recompiles the
  native libraries through CMake and takes longer than one that did not.
- Confirm in the log: `Incremented versionCode from N to N+1`, then
  `BUILD SUCCESSFUL`.

---

## 3. Submit — internal, not production

```bash
npx eas submit --platform android --profile internal \
  --path /tmp/teamder-<version>.aab --non-interactive
```

> **The trap that has already cost one accidental production release:**
> `eas.json` keeps SEPARATE build and submit profile lists. On *submit*,
> `--profile production` means the production **track**. For an internal
> upload the profile is `internal`. Read the `Release track:` line the
> command prints back before it starts.

> **Never query the Play API while a submit is running.** It opens an edit of
> its own and deletes the one fastlane is holding, failing the submit.

Promoting internal → production happens only on the owner's explicit
approval, and is a separate action.

---

## 4. Verify — from Play, not from the EAS log

```bash
python3 scripts/play-tracks.py
```

Confirm `internal` now carries the new version and versionCode, and that
`production` has **not** moved.

Also confirm the binary came from the commit you think it did. A release has
already gone out frozen at a pre-fix commit while everyone believed
otherwise — compare the build time against `git log` in UTC, and prefer
building from a clean tree so the commit is a real anchor.

---

## 5. After the ship

**Log every change to `appConfig/releaseLog`**, same turn. Any visual change
carries a proof screenshot: write the JPEG base64 to `releaseShots/{id}` and
reference it from the item's `shotId`.

**Prune the Pulse versions tab.** Keep, for each surface, its live version and
anything newer, plus `next`; drop the rest. The floor is the oldest version
still live in a store — on 06.10.2026 that was iOS 1.1.22, so everything
below it went.

---

## iOS, in one line

`eas submit -p ios` only reaches TestFlight. The App Store version must also
be created and submitted through the App Store Connect API — there is a
script for it under `~/.teamder-update-watch/`. A crash-on-launch justifies
asking Apple for an expedited review.
