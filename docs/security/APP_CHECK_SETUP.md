# App Check + Play Integrity — setup & deploy

App Check verifies that requests to Firebase services originate from
your genuine app binary on a real device — not from `curl`, Postman,
a scraper, or a tampered APK. Without it, anyone with the public
`EXPO_PUBLIC_FIREBASE_API_KEY` can hammer Firestore / Functions /
Storage from any environment and burn your quota.

## What's already done in code

| Change | Location |
|---|---|
| `@react-native-firebase/app-check` installed | `package.json` |
| Expo plugin registered | `app.json` → `plugins` |
| App Check init helper (native + JS bridge) | `src/firebase/appCheck.ts` |
| Auto-init on first Firebase use | `src/firebase/config.ts` (`getFirebase()` calls `initAppCheck`) |
| Debug-token env var documented | `.env.example` (`EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN`) |

The init flow:

1. `getFirebase()` is called by any Firestore / Auth / Storage /
   Functions consumer. On the first call, it lazy-requires
   `appCheck.ts` and kicks off `initAppCheck(_app)`.
2. `initAppCheck` configures the native `@react-native-firebase/app-check`
   provider — Play Integrity in production, debug provider in
   `__DEV__`.
3. It then registers a `firebase/app-check` `CustomProvider` that
   delegates `getToken()` to the native module — so the JS SDKs
   (Firestore / Auth / Storage / Functions) attach the same App
   Check header as the native side.

The bridge is needed because we run a hybrid SDK setup: most data
flows go through the JS SDK (`firebase/*`), and native App Check
alone wouldn't decorate those calls.

## What you must still do manually

These steps live in Firebase / Play Console — there's no CLI for
them in `firebase-tools`.

### 1. Rebuild the dev client

The new native module is in `package.json` but not in the running
binary yet:

```sh
npx expo prebuild --clean
npx expo run:android
```

(The `--clean` is critical — without it the native android folder
keeps the previous module list and App Check won't link.)

### 2. Register Play Integrity in Firebase Console

1. Open **Firebase Console → Build → App Check**.
2. Pick the Android app (com.studiogameslime.soccerapp).
3. Click **Register** under **Play Integrity API**.
4. Enter the **SHA-256** fingerprint of your release signing key.
   - Get it from `cd android && ./gradlew signingReport` and copy
     the SHA-256 of the `release` variant.
   - You can register multiple SHA-256 values (debug + release +
     Play upload key). Add all of them.

### 3. Connect Firebase to Play Console

Play Integrity verdicts are issued by Google Play, not by Firebase
directly:

1. **Play Console → Setup → App Integrity → API access**.
2. Click **Link Cloud project** and pick your Firebase Cloud project
   (`soccer-app-52b6b`).
3. Wait 5–10 minutes for propagation.

### 4. Enforce App Check per service

By default App Check **collects metrics** for a few days, then you
flip enforcement. Recommended order to avoid breaking traffic
mid-rollout:

1. Run a debug build, sign in, exercise the app — ensures the dev
   client mints a token.
2. **Firebase Console → App Check → APIs**:
   - Cloud Firestore → **Enforced**
   - Cloud Storage for Firebase → **Enforced**
   - Cloud Functions → for each callable + scheduled function →
     **Enforced**

Production traffic will now be rejected unless the request carries
a valid App Check token.

### 5. Register the dev debug token

The first time the dev client runs, look in logcat for:

```
[FirebaseAppCheck] Enter this debug secret into the allow list in
the Firebase Console for your project:  XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
```

Copy that value and:
1. **Firebase Console → App Check → Apps → Android → Manage debug tokens**.
2. **Add** the token with a friendly name ("matan-pixel7-dev").
3. Optional but useful: paste it into `.env` as
   `EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN=...` so subsequent rebuilds
   reuse the same token instead of churning your allow-list.

## Verify

```sh
# 1. Dev client → should succeed (debug token recognised)
adb logcat | grep -i "AppCheck"

# 2. Plain curl with API key → should fail
curl "https://firestore.googleapis.com/v1/projects/soccer-app-52b6b/databases/(default)/documents/games" \
  -H "x-goog-api-key: $EXPO_PUBLIC_FIREBASE_API_KEY"
# Expected: 403 with "App Check token is not valid"

# 3. Release APK on a real device → should succeed (Play Integrity)
```

## Deployment checklist

- [x] `@react-native-firebase/app` + `app-check` installed
- [x] Plugin registered in `app.json`
- [x] `initAppCheck()` wired into `getFirebase()` boot path
- [x] Debug-token env var documented
- [ ] Dev client rebuilt with `expo prebuild --clean`
- [ ] Play Integrity provider registered in Firebase Console
- [ ] Play Console linked to Firebase Cloud project
- [ ] Enforcement turned ON for Firestore + Storage + Functions
- [ ] Dev debug token added to console allow-list

## What this protects against

| Attack | Without App Check | With enforcement |
|---|---|---|
| Scraping `/groupsPublic` from curl with leaked API key | works | 403 — App Check token missing |
| Bot creating fake users via REST | works | 403 |
| Quota DoS by spamming reads from a script | burns your quota | 403 — request rejected before billing |
| Modified APK distributed by attacker | works | 403 — Play Integrity verdict failed |
| Spam from emulator without debug token | works | 403 — debug token not in allow-list |

App Check is the hard ceiling on automated abuse. Firestore / Storage
rules tighten *what* can be done; App Check tightens *who* can do it.
