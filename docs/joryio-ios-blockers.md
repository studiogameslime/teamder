# Joryio SDK — integration notes and backend findings

**Reported by:** Teamder (React Native / Expo app, iOS deployment target 15.1)
**Date:** 2026-08-22
**Android status:** ✅ integrated and verified end-to-end — events arrive, `is_bot=false`, sessions and identify both work.
**iOS status:** ✅ integrated — `pod install` resolves and `Joryio/Core` + `Joryio/UI` are installed from a local path.

Both platforms consume the SDK **by path** from a vendored copy of the monorepo
sources (`vendor/joryio/`), since the packages are not published yet. That works
today; the items in §1–§3 below are therefore **not blockers**, they are the
maintenance cost of vendoring and a list of what to fix when you do publish.

> **In-app messaging findings live in a separate document:**
> [`joryio-inapp-findings.md`](./joryio-inapp-findings.md) — covers the
> free-`String` action parameter that silently records a click as a display,
> the stale `push_permission` attribute, the duplicate device rows, and the
> discarded `present()` return value in `Joryio.kt`.

---

## 1. `@joryio/react-native-sdk` is not published to npm (not a blocker — vendored)

The docs (`developers/sdk/react-native-sdk`) instruct:

```
npm install @joryio/react-native-sdk
```

The package does not exist on the public registry:

| package | registry.npmjs.org |
|---|---|
| `@joryio/react-native-sdk` | **404** |
| `@joryio/web-sdk` | **404** |

A registry search for `joryio` returns **0 results**.

Both packages are marked publishable (no `"private": true`) in
`packages/sdk-react-native/package.json` and `packages/sdk-web/package.json`,
version `1.0.0` — they appear to have simply never been pushed.

**Impact:** we vendored `packages/sdk-react-native`, `packages/sdk-android` and
`packages/sdk-ios` into `vendor/joryio/` and reference them with a `file:`
dependency (npm) and `:path` (CocoaPods). This builds on both platforms.

The cost is maintenance, not capability: every SDK update has to be re-copied by
hand instead of `npm update`, and the vendored copy has to be committed to our
repo for cloud builds to see it.

---

## 2. The iOS podspec points at a repository that does not exist (worked around)

`packages/sdk-react-native/joryio-react-native.podspec`:

```ruby
s.source     = { :git => "https://github.com/HippoCampus-Tech/Joryio.git", :tag => s.version }
s.dependency "Joryio/UI", "~> 1.0"
```

`packages/sdk-ios/Joryio.podspec`:

```ruby
s.source     = { :git => 'https://github.com/HippoCampus-Tech/joryio-sdk-ios.git', :tag => s.version.to_s }
```

Checked against the GitHub API **while authenticated as a user who can read
your private `HippoCampus-Tech/Hippomation` repo** (so this is not a
private-repo visibility artifact):

| repository | result |
|---|---|
| `HippoCampus-Tech/Hippomation` | ✅ exists (private) |
| `HippoCampus-Tech/Joryio` | ❌ **404 — does not exist** |
| `HippoCampus-Tech/joryio-sdk-ios` | ❌ **404 — does not exist** |

The actual iOS sources live in `Hippomation/packages/sdk-ios`.

**Impact:** none while consuming by `:path` — CocoaPods never reads `s.source`
for a path-based pod. It WILL matter the moment anyone tries to consume the pod
normally, so it still needs fixing before publication.

---

## 3. The `Joryio` pod is not published to CocoaPods (worked around)

`joryio-react-native.podspec` declares `s.dependency "Joryio/UI", "~> 1.0"`.

| pod | trunk.cocoapods.org |
|---|---|
| `Joryio` | **404 — not published** |
| `SQLite.swift` | ✅ 200 (transitive dep, fine) |
| `Stencil` | ✅ 200 (transitive dep, fine) |

**Impact:** we supply `Joryio` ourselves from `vendor/joryio/ios`:

```ruby
pod 'Joryio', :path => '../vendor/joryio/ios', :subspecs => ['Core', 'UI']
```

One change was required to make this resolve: `joryio-react-native.podspec`
declares `s.dependency "Joryio/UI", "~> 1.0"`, and the version pin makes
CocoaPods look for a *published* spec rather than accepting the local one.
Dropping the constraint to `s.dependency "Joryio/UI"` resolves cleanly.
Consider shipping the podspec without the pin, or documenting the local-path
recipe.

---

## What we would like when you publish

Not urgent — we are unblocked — but these are what turn our vendored copy back
into a normal dependency:

1. **Publish `@joryio/react-native-sdk` to npm** (and `@joryio/web-sdk`).
2. **Publish the `Joryio` pod to CocoaPods trunk**, including the `UI` subspec.
3. **Fix `s.source` in both podspecs** to point at a repository that exists, and
   push a git tag matching the podspec version (`1.0.0`).
4. **Drop the `~> 1.0` pin** on `Joryio/UI` in the React Native podspec, or
   document the local-path recipe.

The findings in the next section matter more than any of the above — they affect
anyone using the SDK, published or not.

---

## Two more findings from the Android integration

Not iOS-specific, but you will hit both from any client:

### A. React Native's default User-Agent is classified as a bot

RN's `fetch` sends `User-Agent: okhttp/4.12.0` on Android. Your
`bot-detection.service.ts` flags that, and the event is stored with
`$is_bot: true` and `user_id: "bot:<anonymousId>"`. Every analytics query
filters on `$is_bot != 'true'` — so the events are written but **invisible**.

Measured:

| User-Agent sent | `$is_bot` | `$bot_type` |
|---|---|---|
| *(none)* | true | `http_library` |
| `okhttp/4.12.0` | **true** | `other_bot` |
| `Teamder/1.0.93 (android 36)` | false | — |

Your own `sdk-android` uses OkHttp/Retrofit, so it will be flagged too unless it
sets a custom User-Agent. We work around it by sending our own.

Note: `sdk-tracking.controller.ts` in the repo has `const isBotForRouting = false`
with a comment saying bot routing is off entirely — but the **deployed** backend
still applies the `bot:` prefix, so the running version is older than the source.

### B. Two doc/API mismatches in the Entities API

- **Pagination** — the docs document `offset`; the API rejects it with
  `"property offset should not exist"`. The working parameter is `page`.
- **Single-record create** — the docs show a bare object body; the API rejects
  it with `"data must be an object"`. Both single and array form require the
  `{ "data": { ... } }` envelope.

### C. The event name is read from `type`, not `name`

`POST /v1/track` takes the event name from the `type` field. A body of
`{"type":"track","name":"Game Joined"}` returns **200** and is persisted as
`event_name: "track"` — the `name` field is silently ignored. This matches your
own `sdk-android` implementation (`Event.kt` → `@SerializedName("type")`), so
the behaviour is intentional; the risk is that a 200 response gives no hint that
every event is collapsing into one bucket. Worth documenting explicitly.


---

## Findings from the 1.1.0 upgrade (2026-08-22)

Upgraded all three vendored SDKs to 1.1.0 and imported our push tokens. Both
platforms build; device properties and the bulk device import both work. Two
things to look at.

### D. A 400-device request 502s

`POST /users/track` with a `devices` array is documented as accepting up to
1000. Measured against the deployed backend:

| devices in one request | result |
|---|---:|
| 1 | ✅ 200, `devices: {processed: 1}` |
| 400 | ❌ **502**, empty body |
| 50 | ✅ 200 |

We shipped 398 of 400 tokens by batching at 50. The 502 is worse than a plain
error because it carries no `failed[]` array — there is no per-index detail to
retry from, so a caller has to guess which half of the batch to re-send. Either
the cap is lower than documented, or the request needs to survive its own
documented maximum.

The two rejections at 50/batch were legitimate and well-reported:
`E11000 duplicate key ... index: organizationId_1_workspaceId_1_pushToken_1` —
the same token registered under two of our users, i.e. a reinstall or a resold
handset. That is exactly the case the "record where a moved token went" half of
the commit describes, so it may be worth surfacing it as a *moved* outcome
rather than a duplicate-key error string.

### E. `react-native.config.js` is missing from the RN package

`packages/sdk-react-native` has no `react-native.config.js`. Without it the
React Native CLI does not detect the package at all: the app builds, Gradle runs
zero `:joryio-sdk` tasks, the APK contains zero `io.joryio` classes, and the SDK
degrades to its no-op path. **A completely green build that ships no analytics.**

We add the file ourselves after every re-vendor:

```js
module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import io.joryio.reactnative.JoryioPackage;',
        packageInstance: 'new JoryioPackage()',
      },
      ios: { podspecPath: './joryio-react-native.podspec' },
    },
  },
};
```

Worth shipping in the package — this failure is silent, and the no-op fallback
(good design in itself) is what hides it.

### Confirmed working in 1.1.0

- **Device properties** — 16 fields land on `Session Start`: `$manufacturer`,
  `$model`, `$os_version`, `$os_sdk_int`, `$app_version`, `$build_number`,
  `$locale`, `$languages`, `$timezone`, `$screen_width/height`, `$device_id`.
  Attached once per session rather than per event, which is the right call.
- **Bulk device import** — `devices` keyed by `externalId` is exactly what a
  migration needs. This unblocked us: previously we could not attach tokens at
  all without Joryio's internal 24-hex ids.
