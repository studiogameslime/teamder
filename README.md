# Footy ⚽ — neighborhood 5v5 manager

React Native (Expo) app for organizing a fixed weekly football night up to 15 players.

> **Status:** MVP with Firebase wiring. Onboarding → Google sign-in → group flow → bottom tabs all run
> end-to-end. The app auto-detects whether Firebase config is present: with config → real Firestore + Auth;
> without → in-memory mock mode. FCM, GPS arrival, weather API, deep-link invite, and Cloud Functions
> are not yet wired — see "Next steps".

## Mock mode vs. real mode (read this)

The app boots in one of **exactly two modes**, decided by whether `EXPO_PUBLIC_FIREBASE_*` env vars are filled in:

| | Mock mode | Real mode |
| --- | --- | --- |
| Trigger | `.env` empty (or partial) | All required env vars present |
| Banner at top of screen | "מצב נתוני דמו — לא קיים חיבור ל-Firebase" | (nothing) |
| Active user | Canned `mockCurrentUser` ("דניאל") | Whoever signed in with Google |
| Groups visible | Canned 25-person community + 5 seeded public groups | Only groups created by real users |
| Players, stats, history | Canned demo seed | Empty until users register / play |
| Active game night | Pre-seeded with 12 registered + 3 waitlisted | Admin must press "צור את ערב הערב" |
| Console boot log | `[footy] mode: MOCK (config missing)` | `[footy] mode: FIREBASE` |

**Real mode starts EMPTY.** No fake groups, no fake players, no fake stats, no fake history. The Communities feed shows "אין עדיין קהילות" with a "צור קבוצה ראשונה" CTA. Stats shows "אין עדיין נתונים". History shows "אין משחקים קודמים". Game tab shows the admin's "create night" button or the player's "ממתין למנהל" message.

**Mock mode is for local development only.** A high-visibility amber banner at the top of every screen makes the mode obvious. Mock data lives entirely under `src/data/{mockData,mockUsers}.ts` and is read only from `if (USE_MOCK_DATA)` branches inside services. Real mode does not import mock data into any user-visible path.

**Switching modes** is a `.env` change and an app restart — env vars don't hot-reload. Use `EXPO_PUBLIC_FOOTY_FORCE_MOCK=1` to keep the app in mock mode even when Firebase config is filled in (useful for offline dev).

## Quick start (mock mode, no setup)

```bash
cd /Users/matan/Projects/soccer
npm install
npx expo start
```

Scan the QR with Expo Go on your Android phone. With an empty `.env`, the app starts in **mock mode** — full UI flow against in-memory data, perfect for design review and demos. After first launch, shake → Reload once (RTL flip needs a JS reload — see "RTL note").

## Firebase setup (switch out of mock mode)

The app auto-detects Firebase config from `EXPO_PUBLIC_*` env vars. Fill in the values below and the next start-up will run against real Firestore + Auth. Console boot log shows the active mode: `[footy] mode: FIREBASE` or `[footy] mode: MOCK (config missing)`.

### 1. Create a Firebase project

1. https://console.firebase.google.com → "Add project". Name it whatever; the app id in `app.json` is `com.studiogameslime.soccerapp`.
2. **Authentication** → Sign-in method → enable **Google**.
3. **Firestore Database** → create in production mode (the rules at `firestore.rules` will lock it down properly).
4. Project Settings → "Your apps" → register a Web app (any name). Copy the `firebaseConfig` snippet.

### 2. Google OAuth client IDs

Firebase auto-creates a Web OAuth client when you enable Google sign-in. You also need iOS + Android clients for mobile.

1. Google Cloud Console → APIs & Services → Credentials (same project as Firebase).
2. Create three OAuth 2.0 client IDs:
   - **Web** (already exists from Firebase) — copy its client ID.
   - **iOS** — bundle ID: `com.studiogameslime.soccerapp`.
   - **Android** — package name: `com.studiogameslime.soccerapp`. Add your debug + release SHA-1 fingerprints (`./gradlew signingReport` from the Android project, or `eas credentials` if using EAS).
3. For Android, download `google-services.json` and drop it at the project root (already referenced by `app.json`).

### 3. Fill in `.env`

```bash
cp .env.example .env
# edit .env with values from steps 1 + 2
```

Required keys:

```
EXPO_PUBLIC_FIREBASE_API_KEY=AIza...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=footy-xyz.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=footy-xyz
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=footy-xyz.appspot.com
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
EXPO_PUBLIC_FIREBASE_APP_ID=1:...
EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID=...apps.googleusercontent.com
```

Restart `npx expo start` — env changes don't hot-reload.

To force mock mode even with config filled in (e.g., for offline dev): `EXPO_PUBLIC_FOOTY_FORCE_MOCK=1`.

### 4. Deploy security rules + indexes

The app's Firestore queries (e.g. `where('groupId','==',X) + orderBy('startsAt','desc')`) require composite indexes. They're declared in `firestore.indexes.json`.

```bash
npm install -g firebase-tools
firebase login
firebase use --add   # pick your project
firebase deploy --only firestore:rules,firestore:indexes
```

Verify in the Firebase console: Firestore → Rules tab shows the deployed rules; Indexes tab shows the composite indexes building / built.

### 5. AdMob (OPT-IN — off by default)

**Ads are disabled unless you set `EXPO_PUBLIC_ADMOB_ENABLED=1` in `.env`.** With the flag off, the ad service never calls `require('react-native-google-mobile-ads')`, `BannerAd` returns `null`, and `showAppOpenAdIfAvailable()` is a no-op. This is the safe default — required because:

- AdMob is a native module and **does NOT work in Expo Go**.
- An unresolvable `require()` in Metro produces a stub that throws at runtime in a way that `try/catch` can't always intercept. Gating the require behind a runtime flag avoids the bundler ever needing to resolve the module unless you explicitly ask for it.

To turn ads on:

1. `EXPO_PUBLIC_ADMOB_ENABLED=1` in `.env`.
2. `npx expo install react-native-google-mobile-ads`.
3. Add to `app.json` under `plugins`:
   ```json
   ["react-native-google-mobile-ads", {
     "androidAppId": "ca-app-pub-XXX~XXX",
     "iosAppId": "ca-app-pub-XXX~XXX"
   }]
   ```
4. Set ad unit IDs in `.env` (use Google's test units in dev):
   - `EXPO_PUBLIC_ADMOB_BANNER_ANDROID` / `_IOS`
   - `EXPO_PUBLIC_ADMOB_APP_OPEN_ANDROID` / `_IOS`
5. Build a custom dev client: `eas build --profile development`.

### 6. Firebase Analytics (note)

`analyticsService` uses the firebase web SDK's `firebase/analytics` lazily. On React Native this is best-effort: `getAnalytics().isSupported()` returns `false` on some setups (Hermes), at which point all `logEvent` calls become no-ops. For a guaranteed-delivered analytics pipeline, install `@react-native-firebase/analytics` and swap the import inside `analyticsService.tryInit()`. Until then, console.log in dev mode is the source of truth for what would be sent.

### 7. End-to-end smoke test (12 steps, two devices)

The full happy path. Run these in order on two phones (User A = admin, User B = new community member).

| # | Action | Expected Firestore state |
| --- | --- | --- |
| **A** | User A signs in with Google | `/users/{A.uid}` doc exists with `name`, `email`, `photoUrl`, `createdAt`. |
| **B** | User A creates a group "חמישי כדורגל" | `/groups/{groupId}` exists with `adminIds: [A.uid]`, `playerIds: [A.uid]`, `pendingPlayerIds: []`, `inviteCode` set, `normalizedName: 'חמישי כדורגל'`. |
| **C** | User B signs in with Google | `/users/{B.uid}` doc exists. |
| **D** | User B opens "חפש קבוצה", searches "חמישי" | `searchGroups` query returns User A's group; the row shows "בקש להצטרף". |
| **E** | User B taps "בקש להצטרף" | `/groupJoinRequests/{rid}` doc with `groupId, userId: B.uid, status: 'pending'`. `groups/{groupId}.pendingPlayerIds` includes B.uid. The button flips to "הבקשה נשלחה". |
| **F** | User A → Profile tab → "X בקשות הצטרפות" → approves User B | `/groupJoinRequests/{rid}.status: 'approved'`. `groups/{groupId}.playerIds` adds B.uid; `pendingPlayerIds` removes B.uid. |
| **G** | User A → Game tab → "צור את ערב הערב" | `/gameNights/{nightId}` exists with `groupId`, `status: 'open'`, `registeredUserIds: []`, `waitlistUserIds: []`. |
| **H** | User B → Game tab → "אני מגיע" | `gameNights/{nightId}.registeredUserIds` adds B.uid (now contains 1 element). |
| **I** | Both users register additional members until `registeredUserIds.length === 15` | The 16th user attempting to register lands in `waitlistUserIds` instead — the registered list never exceeds 15. |
| **J** | One registered user cancels via "אני מבטל" | They're removed from `registeredUserIds`; the head of `waitlistUserIds` is moved into `registeredUserIds` (auto-promotion). |
| **K** | User A → "התחל ערב" | `gameNights/{nightId}.status: 'locked'`. Any subsequent attempt by User B to register/cancel is rejected by Firestore rules with `permission-denied`; the UI reflects no change. |
| **L** | The live match flow proceeds | Existing match flow runs unchanged: timer, "who won" → rotation, GK rotation per round. `/rounds/{nightId}_${index}` docs accumulate. |

**Failure modes worth catching during the smoke test:**
- After step E, if the `pendingPlayerIds` array on the group doc didn't update, your security rule's `isSelfJoinRequest` is rejecting the write. Check the rules log in Firebase console.
- After step H, if User B sees "permission denied" instead of registration succeeding, they either weren't approved (step F) or `isMemberRegistrationUpdate` rule needs a tweak.
- After step K, if User B can still register, the security rule isn't enforcing `status == 'open'`. Look for "diff" semantics in the rule.

## App flow

```
First launch
   │
   ▼
Onboarding (4 paged screens + Get-started)
   │
   ▼
Sign in with Google  ───►  (mock returns the canned user)
   │
   ▼
Profile setup (name + photo)  — skipped if already set
   │
   ▼
Group?
 ├─ no group ─► Choose: Search / Create / Join-by-code ─► Create or Pending
 ├─ pending  ─► Pending approval screen
 └─ member   ─► Bottom tabs (5)
                ├─ Game         → Registration → Team setup → GK → Live match
                ├─ Communities  → Public groups feed + search + create
                ├─ Stats        → games / wins / win% / attendance% / cancel rate
                ├─ History      → past game nights
                └─ Profile      → user, group, invite share, settings actions
```

## Conceptual model (read this first)

| Concept | What it is | Lives where |
| --- | --- | --- |
| **Group** (private) | A permanent football *community* (typically 20–40 people). Membership is persistent — admin approves new community members **once**. Read-locked to members. | `/groups/{groupId}` (`playerIds`, `pendingPlayerIds`, `adminIds`) |
| **GroupPublic** | Public-search projection of a group: name, field, city, member count, open/closed flag. No member lists. Readable by any signed-in user. | `/groupsPublic/{groupId}` |
| **Game night** | A single scheduled session. Belongs to one group. Up to 15 community members register **per night**; the rest go on a per-night waitlist. | `/gameNights/{gameNightId}` (`registeredUserIds`, `waitlistUserIds`) |

The same person plays many game nights as a member of a group, without re-applying. Admin approval is for the **community**, not the night.

## What works today (mock-mode end-to-end)

- **Onboarding** — 4-page paged carousel + skip/next/Get-started; persists "done" flag in AsyncStorage.
- **Auth** — `Continue with Google` button. In mock mode this signs you in as the canned user; in real mode it triggers the Firebase OAuth dance. Auth user persists in AsyncStorage; sign out clears it.
- **Profile setup + edit** — required name field; rendered when current user has no name. Editable later from the Profile tab.
- **Group discovery** — search the public group directory by name; per-row state shows "בקש להצטרף" / "הבקשה נשלחה" / "אתה כבר חבר".
- **Group system** — create a group (you become admin), search and request to join, or use a 6-char invite code. Admin reviews pending community members and approves/rejects. Mock seed has 2 pending users so admin flow is testable without inviting anyone.
- **Bottom tabs** — Game / Stats / History / Profile.
- **Game flow** — admin creates the night → community members register (capped at 15) → overflow lands on the per-night waitlist → cancellations auto-promote the waitlist head → admin shuffles teams → admin presses Start → live match flow with timer + rotation + GK rotation.
- **Stats** — reads from the player's mock stats on the Stats tab.
- **History** — list of past game nights with date, match count, last result.
- **Communities tab** — feed of public groups with search by name/city, request-to-join button per row, FAB to create a new group. Mock seed has 5+ public groups in varied states.
- **Settings actions on Profile** — report bug / suggest feature (mailto: with debug info), rate app (Play Store / App Store URL). Each tracks an analytics event.
- **Invite share** — Profile tab "הזמן שחקנים" opens the native share sheet with a Hebrew message + invite link. Logs `invite_shared`.
- **Analytics** — `analyticsService.logEvent` wired into 13 actions (auth, group lifecycle, registration, match, settings). Console-only in mock mode; best-effort to Firebase Analytics in real mode (web SDK).
- **Banner ads** — `BannerAd` wrapper renders nothing if the native module isn't available (Expo Go) or if the ad fails to load. Placed on Game / Communities / Stats / History / Profile tabs. Excluded from auth, onboarding, and the live match screen.
- **App-open ad** — Pre-warmed at boot, shown once per session when the user lands on MainTabs. Suppressed while a match is locked/in-progress.

## Permissions: who can do what

The same rules apply in both mock and Firebase mode — UI gates upfront and Firestore security rules enforce server-side.

| Action | Admin | Community member | Outsider |
| --- | --- | --- | --- |
| Search public group directory | ✅ | ✅ | ✅ (any signed-in user) |
| Read group game data | ✅ | ✅ | ❌ |
| Request to join the **community** | — | — | ✅ (lands in `pendingPlayerIds`) |
| Approve / reject community join requests | ✅ | ❌ | — |
| **Create tonight's game night** | ✅ | ❌ (sees "ממתין למנהל") | — |
| Register / cancel registration for the night | ✅ | ✅ while `status='open'` | ❌ |
| Pick ball / jerseys carrier | ✅ | ✅ | ❌ |
| Shuffle teams | ✅ | ✅ (visual only — change is local until lock) | ❌ |
| **Start the game (lock)** | ✅ | ❌ ("רק מנהל יכול להתחיל") | — |
| End match → rotate teams + advance GK | ✅ | ❌ | — |

**Two separate approval states.** A user can be: (1) approved into the community → can see and register for nights; (2) registered for a specific night → on the field tonight; (3) on tonight's waitlist → bumped into the registered list when someone cancels. (1) is permanent; (2) and (3) reset for each new night.

**Lock semantics.** When admin presses "התחל ערב", `gameNight.status` flips to `'locked'`. Security rule `isMemberRegistrationUpdate` requires `status == 'open'` both pre- and post-update, so registration writes are rejected once locked. Waitlist is frozen; no in-app drop-outs; only admin writes succeed.

**No active game yet.** When a group has no active `gameNight`:
- **Admin** sees "אין ערב פעיל. צור ערב חדש" + a "צור את ערב הערב" button.
- **Community member** sees "ממתין למנהל ליצור את ערב הערב" — no error, no create button.

**Permission errors.** All Firestore `permission-denied` errors are turned into UI states. Raw Firebase error messages are logged to the console only — never shown to the user.

## What's stubbed

| Area | Where | What's needed |
| --- | --- | --- |
| Firebase init | `src/firebase/config.ts` | Replace `firebaseConfig` placeholders; flip `USE_MOCK_DATA` to `false` |
| Google Sign-In | `src/firebase/auth.ts` → `signInWithGoogle()` | Wire `expo-auth-session/providers/google` and exchange the id token via Firebase Auth |
| Firestore reads/writes | `src/firebase/firestore.ts` | Implement the typed wrappers; collections sketched in the file header |
| Service-layer real impl | `src/services/{user,group,game}Service.ts` | Each service has `if (USE_MOCK_DATA)` branches; the Firebase branch is empty |
| Push notifications | n/a | FCM via `expo-notifications`; "slot opened" / "game full" / "game starting soon" sent from a Cloud Function |
| GPS arrival detection | n/a | `expo-location` with foreground geofence ~150m around the field at game time |
| Weather | hardcoded in `mockData.ts` | Open-Meteo `forecast` endpoint with `current=temperature_2m,precipitation_probability` |
| Analytics | n/a | `firebase/analytics`: `logEvent('game_join')`, `logEvent('match_end', { winner })`, etc. |
| Deep-link invite | `JoinGroupScreen` accepts code by typing | Set up `expo-linking` for the `footy://join/<code>` scheme; resolve to JoinGroup screen |

## Architecture

```
src/
├── theme/           colors, spacing, typography
├── i18n/he.ts       all Hebrew strings
├── types/index.ts   User, Group, Game, MatchRound, GameNight, Player
├── data/
│   ├── mockData.ts    15 mock players + active mock game
│   └── mockUsers.ts   mock current user + mock group + mock history
├── firebase/
│   ├── config.ts      USE_MOCK_DATA flag + firebaseConfig placeholder
│   ├── auth.ts        signInWithGoogle stub
│   └── firestore.ts   typed wrappers stubs
├── services/        ◄── single boundary between UI and data layer
│   ├── storage.ts     AsyncStorage wrapper (onboarding, auth, current group)
│   ├── userService.ts get/sign-in/sign-out/update profile
│   ├── groupService.ts list/create/join-by-code/approve/reject
│   ├── gameService.ts get-active-game/save-game/get-history
│   └── index.ts       barrel
├── store/           Zustand stores (call services, never import data/* directly)
│   ├── userStore.ts    hydrated, onboardingDone, currentUser, isProfileComplete
│   ├── groupStore.ts   hydrated, groups, pendingGroups, currentGroupId, useCurrentGroup, useIsAdmin
│   └── gameStore.ts    (unchanged API; routes writes through gameService.saveGame)
├── components/      Avatar, Button, Card, PlayerRow, TeamCard, FieldView, ScreenHeader
├── navigation/
│   ├── RootNavigator.tsx  decides Onboarding | Auth | Group | MainTabs based on store state
│   ├── GameStack.tsx      registration → details → team setup → GK → live match
│   ├── AuthStack.tsx      SignIn → ProfileSetup
│   ├── GroupStack.tsx     Choose → Create / Join
│   ├── ProfileStack.tsx   Profile → Edit / AdminApproval
│   └── MainTabs.tsx       Game / Stats / History / Profile
└── screens/
    ├── GameRegistrationScreen.tsx  ◄── existing 5 screens, untouched
    ├── GameDetailsScreen.tsx
    ├── TeamSetupScreen.tsx
    ├── GoalkeeperOrderScreen.tsx
    ├── LiveMatchScreen.tsx
    ├── onboarding/OnboardingScreen.tsx
    ├── auth/{SignInScreen, ProfileSetupScreen}.tsx
    ├── groups/{GroupChoose, CreateGroup, JoinGroup, PendingApproval, AdminApproval}.tsx
    └── tabs/{Profile, ProfileEdit, Stats, History}Screen.tsx
```

### Data flow rule

UI components → store hooks → services → (mock data | Firebase). Components never import from
`src/data/*` or `src/firebase/*` directly. This keeps the Firebase swap a single-layer change.

## Dev tips for testing each phase

The mock seed signs you in as **דניאל** (`mockPlayers[6]`), already a member + admin of `חמישי כדורגל`. To exercise other phases:

| Want to test | Trick |
| --- | --- |
| Onboarding | `await AsyncStorage.removeItem('footy.onboarding.done')` or wipe app data |
| Sign in / sign out | Sign out from Profile tab → bounces to SignInScreen |
| Profile setup | Sign out, then in `userService.signInWithGoogle` mock branch, return `{...mockCurrentUser, name: ''}` once |
| Group "Choose" screen | Edit `mockGroup.playerIds` in `src/data/mockUsers.ts` to remove the current user's id |
| Pending approval (player side) | Same as above, then add user id to `pendingPlayerIds` |
| Admin approval (admin side) | Default seed has 2 pending users — Profile tab → "X בקשות הצטרפות" |
| Non-admin "Start Game" gating | Edit `mockGroup.adminIds` in `src/data/mockUsers.ts` to remove the current user's id. The Start Game button on TeamSetup will be disabled with the explanatory text. |
| Non-admin "no active game" waiting screen | Switch to Firebase mode (config in `.env`), sign in as a non-admin user → Game tab shows "ממתין למנהל ליצור את ערב הערב" |
| Refresh state mid-session | In dev menu: Reload (R), or wipe AsyncStorage |

## RTL note

`App.tsx` calls `I18nManager.forceRTL(true)` on first launch. RN doesn't apply the flip until JS is reloaded — on first launch the layout will look LTR. Reload once (Expo Go: shake → "Reload") and it'll be RTL from then on.

For a production build, also force RTL natively (Android `supportsRtl="true"` is on by default in Expo SDK 51) and consider `Updates.reloadAsync()` after the forced flip on first launch.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Expo SDK 51 + React Native 0.74 |
| Language | TypeScript (strict) |
| Navigation | `@react-navigation/native-stack` + `@react-navigation/bottom-tabs` |
| State | `zustand` |
| Persistence | `@react-native-async-storage/async-storage` |
| Backend (planned) | Firebase: Auth (Google), Firestore, FCM, Analytics |
| Icons | `@expo/vector-icons` (Ionicons) |
| Avatars (mock) | DiceBear avataaars |

## Next steps in suggested order

1. **Wire up Firebase Auth** — replace the mock branch in `userService.signInWithGoogle()` and `src/firebase/auth.ts`. Smoke-test that the sign-in → profile → group flow still works end-to-end.
2. **Firestore: groups + games + registrations** — implement the wrappers in `src/firebase/firestore.ts` and the Firebase branch of each `services/*Service.ts`. Keep the mock branch alive behind `USE_MOCK_DATA` for development.
3. **Cloud Function: waiting-list promotion + FCM** — when a `Registration` doc flips to `cancelled`, promote the next waiter and push an FCM notification to them.
4. **Deep-link invite** — `expo-linking` config, handle `footy://join/<code>`, route to `GroupJoin` with code prefilled.
5. **Open-Meteo weather** — replace hardcoded `mockGame.weather` with a fetch in `gameService.getActiveGameForGroup`.
6. **GPS arrival** — geofence around the field at game time, mark `Registration.status = 'arrived' | 'no_show'` in a single sweep.
7. **Analytics events** — `game_join`, `game_cancel`, `game_start`, `match_end`, `app_open`.
