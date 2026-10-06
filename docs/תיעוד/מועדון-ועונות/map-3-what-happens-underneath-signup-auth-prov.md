> **Repo root:** `/Users/matan/Projects/soccer`. All paths below are absolute.
> **Live hosting domain:** `https://teamderfc.web.app` — there is no custom domain. Nothing in this surface depends on it, but the email-verification and password-reset emails Firebase sends are Firebase-hosted (`/Users/matan/Projects/soccer/src/firebase/auth.ts:171`, `:202`), so their links carry a `firebaseapp.com` action handler, not a Teamder domain.
> **Report scope:** the invisible half of signup. Everything a consultant cannot see by tapping through the app.

---

### 1. Every auth provider offered

There are **five** distinct entry paths into an identity, exposed by four buttons on one screen.

#### 1.1 The buttons on `SignInScreen`

`/Users/matan/Projects/soccer/src/screens/auth/SignInScreen.tsx:173-275`

| Order on screen | Label (verbatim) | Gloss | Handler | Platform |
|---|---|---|---|---|
| 1 | `'המשך עם Google'` | "Continue with Google" | `handlePress` — `SignInScreen.tsx:44-93` | Android + iOS |
| 2 | `'המשך עם Apple'` | "Continue with Apple" | `handleApple` — `SignInScreen.tsx:97-139` | **iOS only** — gated by `Platform.OS === 'ios'` at `SignInScreen.tsx:212` |
| 3 | `'המשך עם מייל'` | "Continue with email" | navigates to `EmailAuth` — `SignInScreen.tsx:236-252` | both |
| 4 | `'המשך כאורח'` | "Continue as guest" | `handleGuest` — `SignInScreen.tsx:143-155` | both |

Strings: `/Users/matan/Projects/soccer/src/i18n/he.ts:1795` `signInGoogle: 'המשך עם Google'`, `:1796` `signInApple: 'המשך עם Apple'`, `:1797` `signInEmail: 'המשך עם מייל'`, `:1798` `signInGuest: 'המשך כאורח'`.

Screen copy: `he.ts:1793` `signInTitle: 'בואו נכיר'` ["let's get started"], `he.ts:1794` `signInSubtitle: 'התחבר כדי להירשם, להצטרף למועדון ולעקוב אחרי הסטטיסטיקות שלך.'`, `he.ts:1799` `signInPrivacy: 'באמצעות התחברות אתה מסכים לתנאי השימוש'` ["by signing in you agree to the terms of use"] — rendered as plain `<Text>` at `SignInScreen.tsx:272`, **not a link**; nothing in this file opens a terms document.

Note the **title/subtitle grammar mix**: the title is plural/polite (`בואו`) and the subtitle is masculine-singular imperative (`התחבר`). Both are on screen at the same time.

Note also `he.ts:1846` `profileTitle: 'בוא נכיר'` and `he.ts:2839` `psoProfileTitle: 'בוא נכיר'` — the *next* screen's title ("let's get acquainted") is one character away from the sign-in title `'בואו נכיר'`.

#### 1.2 The five service-layer signup paths

All in `/Users/matan/Projects/soccer/src/services/userService.ts`:

1. **`signInAsGuest`** — `userService.ts:61-67` → `fbSignInAnonymously` (`/Users/matan/Projects/soccer/src/firebase/auth.ts:407-412`). **Writes no `/users` doc at all.**
2. **`signInWithGoogle`** — `userService.ts:167-212` → `signInWithGoogle` (`auth.ts:79-128`), native picker via `@react-native-google-signin/google-signin`.
3. **`signInWithApple`** — `userService.ts:214-256` → `signInWithApple` (`auth.ts:331-399`), `expo-apple-authentication` with a SHA-256 hashed nonce (`auth.ts:343-349`).
4. **`signInWithEmail`** (existing account) — `userService.ts:263-298` → `auth.ts:148-159`.
5. **`signUpWithEmail`** (new account) — `userService.ts:306-343` → `auth.ts:161-197`.

Plus a sixth, non-button path: **`getCurrentUser` lazy-create** — `userService.ts:140-158`. On cold start, if Firebase Auth restores a user but `/users/{uid}` does not exist, the doc is created there. Comment at `userService.ts:134-139` states the two cases it covers: a brand-new sign-in whose `setDoc` never ran, and recovery after a previous launch left an Auth user with no doc.

#### 1.3 Guest — what an anonymous session actually is

`buildGuestUser` — `userService.ts:44-53`:

```
{ id: uid, name: '', avatarId: pickRandomAvatarId(), createdAt: Date.now(),
  onboardingCompleted: true, isGuest: true }
```

This object exists **only in memory**. It is never written to Firestore, and `cacheAuthUser` explicitly refuses to persist it (`userService.ts:881-883`). `onboardingCompleted: true` is a lie told to the navigator so it skips the profile gate (`userService.ts:90-91`, `/Users/matan/Projects/soccer/src/navigation/RootNavigator.tsx:267`).

A guest hitting any account action gets a dialog from `ensureNotGuest` (`/Users/matan/Projects/soccer/src/utils/guestGate.ts:39-64`):
- Title `he.ts:1801` `guestRegisterTitle: 'נדרשת הרשמה'` ["registration required"]
- Default body `he.ts:1802` `guestRegisterBody: 'כדי להשתמש בתכונה הזו צריך חשבון. רוצה להירשם עכשיו?'`
- Per-action bodies: `he.ts:1803` `guestRegisterJoinGame: 'כדי להירשם למחזור צריך חשבון. רוצה להירשם עכשיו?'`; `:1804` `guestRegisterJoinCommunity: 'כדי להצטרף למועדון צריך חשבון. רוצה להירשם עכשיו?'`; `:1805` `guestRegisterChatAdmin: 'כדי לשלוח הודעה למנהל צריך חשבון. רוצה להירשם עכשיו?'`; `:1806` `guestRegisterCreate: 'כדי ליצור צריך חשבון. רוצה להירשם עכשיו?'`; `:1807` `guestRegisterChat: 'כדי להשתמש בצ׳אט צריך חשבון. רוצה להירשם עכשיו?'`
- Buttons: `he.ts:52` `cancel: 'בטל'` and `he.ts:1808` `guestRegisterCta: 'הרשמה'`

Choosing `'הרשמה'` **signs the guest out entirely** (`guestGate.ts:58`) — the whole navigator swaps and they land back on `SignInScreen`. The action they were attempting is stashed first as a pending invite (`guestGate.ts:51-57`) so `RootNavigator`'s consumer can resume it after signup (`RootNavigator.tsx:63-166`).

---

### 2. The exact document written to `/users/{uid}` on first signup

This is the single most commonly mis-stated fact about this codebase: **the object built in `userService` is not the object stored.** Every write goes through `docs.user(uid)` (`/Users/matan/Projects/soccer/src/firebase/firestore.ts:2039-2041`), which is `doc(col.users(), uid)`, and `col.users()` carries `.withConverter(userConverter)` (`firestore.ts:1911-1913`). So `setDoc(ref, fresh)` writes `userConverter.toFirestore(fresh)` (`firestore.ts:183-264`).

#### 2.1 The object the service builds

Google — `userService.ts:181-188`; Apple — `:228-239`; email sign-up — `:320-327`; email sign-in lazy-create — `:277-284`; cold-start lazy-create — `:140-147`.

| Field | Google `:183-187` | Apple `:234-238` | Email **sign-up** `:322-326` | Email **sign-in** lazy `:279-283` | Cold-start lazy `:142-146` |
|---|---|---|---|---|---|
| `name` | `fbUser.displayName ?? ''` | `fbUser.displayName ?? fullName ?? ''` | **`''` hardcoded** | `fbUser.displayName ?? ''` | `fbUser.displayName ?? ''` |
| `email` | `fbUser.email ?? undefined` | `fbUser.email ?? undefined` | `fbUser.email ?? email.trim()` | `fbUser.email ?? email.trim()` | `fbUser.email ?? undefined` |
| `avatarId` | `pickRandomAvatarId()` | same | same | same | same |
| `createdAt` | `Date.now()` | same | same | same | same |
| `onboardingCompleted` | `false` | `false` | `false` | `false` | `false` |

Apple's `fullName` is only available on the very first authorization; the comment at `userService.ts:230-233` and `auth.ts:326-329` both say so. `auth.ts:378-383` joins `givenName` + `familyName`.

`pickRandomAvatarId()` — `/Users/matan/Projects/soccer/src/data/avatars.ts:70-72` — picks uniformly from the 24 entries in `AVATARS` (`avatars.ts:23-55`), each an emoji glyph on a coloured circle (`a01` `⚽` … `a24` `🧓`). **Every new account therefore arrives with a randomly-assigned emoji avatar before the user has chosen anything.**

#### 2.2 The document that actually lands in Firestore

Produced by `userConverter.toFirestore` (`firestore.ts:183-264`). For a brand-new Google account:

| Firestore field | Initial value | Source line |
|---|---|---|
| `name` | the provider display name, or `''` | `firestore.ts:185` |
| `email` | the address, or `null` | `firestore.ts:186` |
| `avatarId` | `'a01'`…`'a24'` (random) | `firestore.ts:187` |
| `position` | `null` | `firestore.ts:188` |
| `createdAt` | device-clock epoch ms | `firestore.ts:189` |
| `updatedAt` | `Date.now()` (since `u.updatedAt` is undefined) | `firestore.ts:190` |
| `onboardingCompleted` | `false` | `firestore.ts:191` |
| `availability` | `null` | `firestore.ts:192-217` |
| `stats` | `null` | `firestore.ts:218-243` |
| `notificationPrefs` | `null` | `firestore.ts:250` |
| `dmFriendsOnly` | `false` | `firestore.ts:251` |
| `newGameSubscriptions` | `[]` | `firestore.ts:252` |
| `personalGroupId` | `null` | `firestore.ts:253` |
| `jersey` | `null` | `firestore.ts:254` |
| `achievements` | `null` | `firestore.ts:255` |
| `discipline` | `null` | `firestore.ts:256` |
| `invitedBy` | `null` | `firestore.ts:257` |
| `invitedByType` | `null` | `firestore.ts:258` |
| `invitedByTargetId` | `null` | `firestore.ts:259` |

**Fields deliberately NOT written on create**, each for a stated reason:
- `photoUrl` — absent from `toFirestore` entirely. The comment at `firestore.ts:274` says "photoUrl kept readable for legacy docs; never written by new code." **Consequence: the Google account photo is discarded at signup.** A new user's picture is the random emoji until they upload one on the onboarding screen.
- `fcmTokens` — moved to the self-only subdoc `/users/{uid}/private/push`; `firestore.ts:244-249` explains that writing them on the world-readable doc re-leaked every device token to any signed-in user.
- `invitedAt` — written separately with `serverTimestamp()` so a re-save cannot clobber the server time (`firestore.ts:260-263`, written at `userService.ts:934`).
- `friends` — read but never written; owned by the server-side accept/remove callables (`firestore.ts:294-298`).
- `qa`, `platform`, `lastSeenAt`, `acquisition`, `lastBroadcastAt` — none exist at create; each is added later by a different writer.

#### 2.3 Notification preferences on day one

`notificationPrefs` is `null` on the document. The **effective** defaults come from `defaultNotificationPrefs` (`/Users/matan/Projects/soccer/src/types/index.ts:405-424`): all 18 types default `true` except `growthMilestone: false` (`types/index.ts:414`). `marketingPush: true` (`types/index.ts:423`) — a new user is opted **in** to marketing push by default, with nothing on the signup screens saying so.

#### 2.4 What Firestore rules require of that create

`/Users/matan/Projects/soccer/firestore.rules:262-277`:

```
allow create: if isSelf(uid) &&
  (!('invitedBy' in request.resource.data) || request.resource.data.invitedBy != uid) &&
  isOptionalShortString(request.resource.data, 'name', 60) &&
  nameNotReserved(request.resource.data) &&
  nameNotEmail(request.resource.data) &&
  isOptionalShortString(request.resource.data, 'email', 200) &&
  isOptionalShortString(request.resource.data, 'photoUrl', 2048) &&
  isOptionalShortString(request.resource.data, 'avatarId', 80);
```

`isSelf` — `firestore.rules:31-33`. `isOptionalShortString` — `firestore.rules:124-127` (missing **or null** **or** short enough), which is what lets the converter's `null` placeholders through. `allow read: if isSignedIn()` (`firestore.rules:260`) — **every signed-in user can read every user document**, including a brand-new one. `allow delete: if false` (`firestore.rules:343`).

Two size mismatches worth naming: the rule caps `name` at **60** characters (`firestore.rules:272`) while both name inputs cap at **40** (`PostSignInOnboardingScreen.tsx:169`, `ProfileSetupScreen.tsx:81`).

---

### 3. Validation on the name field

There are **four** layers, and they do not all say the same thing.

#### 3.1 Layer 1 — the input itself

- `PostSignInOnboardingScreen.tsx:164-172`: `maxLength={40}`, `required`, label `he.profileName`, placeholder `he.profileNamePlaceholder`. **No `returnKeyType`/submit wiring.**
- `ProfileSetupScreen.tsx:76-88`: `maxLength={40}`, `required`, plus `returnKeyType="done"` and `onSubmitEditing` that saves (`ProfileSetupScreen.tsx:84-87`).
- Save CTA enabled only when `name.trim().length > 0` — `PostSignInOnboardingScreen.tsx:61`, `ProfileSetupScreen.tsx:27`.

Strings: `he.ts:1847` `profileName: 'שם'` ["name"], `he.ts:1848` `profileNamePlaceholder: 'איך לקרוא לך?'` ["what should we call you?"], `he.ts:1849` `profileNameRequired: 'שם הוא שדה חובה'` ["name is a required field"] — **`profileNameRequired` has no call site in either signup screen**; the CTA simply stays disabled instead.

#### 3.2 Layer 2 — sanitisation

`sanitizeDisplayString` — `/Users/matan/Projects/soccer/src/utils/validate.ts:111-119`. Strips C0 control characters + DEL, then zero-width and bidirectional-override characters (U+200B–U+200F, U+202A–U+202E, U+2060–U+206F, U+FEFF), then trims. Called at `userService.ts:363` (`completeOnboarding`) and `userService.ts:730` (`updateProfile`). The comment at `userService.ts:360-362` notes onboarding used to only `trim()`, so impersonation and layout-reversal characters persisted.

#### 3.3 Layer 3 — the reserved-brand and email-shaped checks (client)

`/Users/matan/Projects/soccer/src/utils/officialAccount.ts`.

**Reserved brand** — `officialAccount.ts:32`:
```
export const RESERVED_NAME_RE = /teamder|טימדר|טיאמדר|תימדר/i;
```
`isReservedName` (`officialAccount.ts:47-52`) strips whitespace, dots, underscores and hyphens first (`.replace(/[\s._-]/g, '')`) so `"T e a m d e r"` and `"team-der"` fall to the same test. Deliberately a **substring** match (`officialAccount.ts:25-32`): `"Teamder Support"`, `"teamder.app"` and `"צוות טימדר"` are all blocked. The Hebrew variants are `טימדר`, `טיאמדר`, `תימדר`.

**Email-shaped name** — `officialAccount.ts:62`:
```
const EMAIL_NAME_RE = /[^@\s]@[^@\s]+\.[a-z]{2,}/i;
```
`isEmailLikeName` — `officialAccount.ts:87-89`. The doc comment (`officialAccount.ts:64-86`) records why it exists: Google Play's **pre-launch report** robot (Firebase Test Lab) is handed the demo credentials from Play Console's "App access" page and types them into every text input it meets, including this name field. **47 accounts named `appstore.review@teamder.app` accumulated between 22.06 and 19.09.2026**, all Android, clustering on release days. Two of them played in a finished game of a real seven-player club and sit inside its statistics; a third was in that club's pending queue 75 seconds after signing up. Of 676 live accounts on 19.09.2026, not one real person had chosen an email-shaped name.

Thrown as opaque codes: `userService.ts:368` `throw new Error('RESERVED_NAME')`, `userService.ts:373` `throw new Error('EMAIL_NAME')` (in `completeOnboarding`); mirrored at `userService.ts:731-732` (in `updateProfile`).

#### 3.4 Layer 4 — Firestore rules (the actual enforcement)

`firestore.rules:148-152` `nameNotReserved`:
```
!(data.name.lower().replace('[\\s._-]', '').matches('.*(teamder|טימדר|טיאמדר|תימדר).*'))
```
`firestore.rules:182-185` `nameNotEmail`:
```
!(data.name.lower().matches('.*[^@\\s]@[^@\\s]+[.][a-z]{2,}.*'))
```
On **update** both are relaxed to fire only when the name actually changes — `nameNotNewlyReserved` (`firestore.rules:203-207`) and `nameNotNewlyEmail` (`firestore.rules:191-195`) — so an account already carrying such a name is not locked out of unrelated writes (FCM token refresh, availability). Rationale at `firestore.rules:187-190` and `:196-202`.

The rules comment at `firestore.rules:154-181` carries the same 47-account history and adds the specific hole that was closed: `nameNotReserved` **used to exempt any name containing `'@'`**, and `appstore.review@teamder.app` contains "teamder", so the `@` escape hatch was the entire vulnerability.

Pinned cases live in `/Users/matan/Projects/soccer/tests/rules/displayName.test.mjs` — blocked at `:95-100` (`appstore.review@teamder.app`, `hazelblake.54551@gmail.com`, uppercase, `+tag`, padded, and an address **embedded** in a Hebrew name `'מתן someone@gmail.com'`); allowed at `:110-113` (`'עידן @ נחלים'`, `'DJ @Khaled'`, `user@localhost`, `a@b.c`).

#### 3.5 The Hebrew error strings — and where they are and are not shown

| Code | String (verbatim) | he.ts line |
|---|---|---|
| `RESERVED_NAME` | `officialNameTaken: 'השם הזה שמור לחשבון הרשמי של Teamder. בחרו שם אחר.'` | `he.ts:640-641` |
| `EMAIL_NAME` | `emailNameNotAllowed: 'כתובת אימייל היא לא שם. איך קוראים לכם?'` | `he.ts:642-643` |
| generic | `profileSaveError: 'לא הצלחנו לשמור את הפרטים. בדוק את החיבור ונסה שוב.'` | `he.ts:189` |
| dialog title | `error: 'שגיאה'` | `he.ts:188` |

**`ProfileSetupScreen` maps all three correctly** — `ProfileSetupScreen.tsx:44-51`.

**`PostSignInOnboardingScreen` does not.** Its catch block is `PostSignInOnboardingScreen.tsx:121-130`, and it shows `appAlert(he.error, he.signInFailed)` unconditionally (`:127`). `he.signInFailed` is `he.ts:1264` `'ההתחברות נכשלה. נסה שוב.'` ["sign-in failed. try again."]. So on the screen **every new user actually passes through**, a user who types `"Teamder"` or their own email address as their name is told that *sign-in* failed — a sentence about a step they already completed, with no indication that the name is the problem, and the CTA re-enables so they can tap it again forever. `he.profileSaveFailed` (`he.ts:2817` `'שמירת הפרופיל נכשלה. נסה שוב.'`) exists and is not used here either.

`ProfileSetupScreen` — the screen with the correct messages — is reachable only when `onboardingCompleted === true` **and** `name` is empty (`RootNavigator.tsx:267-271`), i.e. legacy accounts. Since `completeOnboarding` sets both in one write (`userService.ts:392-396`), a new user in 2026 never sees it.

---

### 4. What fires automatically on signup

Grouped by when it runs relative to the user seeing the next screen.

#### 4.1 Inside the signup call, awaited — blocks the transition

For Google (`userService.ts:167-212`), Apple (`:214-256`) and email **sign-up** (`:306-343`), in this exact order:

1. `getDoc(ref)` — one read to check whether the doc already exists (`userService.ts:175`, `:222`, `:314`).
2. `setDoc(ref, fresh)` — the create (`:194`, `:241`, `:329`).
3. **`applyInviteAttributionIfFresh(fresh.id)`** — `userService.ts:208`, `:252`, `:339`; implementation `userService.ts:908-940`. Reads the stashed pending invite, re-reads the user doc, and if an inviter exists writes:
   ```
   { invitedBy, invitedByType, invitedByTargetId, invitedAt: serverTimestamp() }
   ```
   (`userService.ts:930-935`). Hard bails: mock mode, no pending invite, no `invitedBy`, self-invite, or `invitedBy` already set (`userService.ts:912-920`). A generic app invite has no target, so `'app'` is substituted so the rules' "type+target present" guard passes (`userService.ts:922-925`). `serverTimestamp()` not `Date.now()` so a wrong device clock cannot corrupt the ordering (`userService.ts:926-929`).
4. **`applyAcquisitionIfFresh(fresh.id)`** — `userService.ts:209`, `:253`, `:340`; implementation `:949-978`. Set-once. Writes:
   ```
   acquisition: { source, campaign?, linkId?, gameId?, at: Date.now() }
   ```
   (`userService.ts:965-973`). `source` is the channel label (whatsapp/facebook/…), `linkId` the specific tracked link `al_…` — shapes at `/Users/matan/Projects/soccer/src/services/storage.ts:67-73`.
5. `cacheAuthUser(fresh)` — `userService.ts:210`, `:254`, `:341`; implementation `:879-888`. Writes the user JSON to AsyncStorage key `'footy.auth.user'` (`storage.ts:8`) as the offline cold-start fallback.

**Both attribution helpers are `await`ed**, so on a slow network the user stares at the sign-in button's spinner through two extra Firestore reads and up to two writes. Both swallow their own errors (`userService.ts:936-939`, `:974-977`) so they cannot fail the signup — but they can delay it.

**Asymmetry:** `signInWithEmail` (`userService.ts:263-298`) **does not call either helper** — it goes straight from `setDoc` (`:286`) to `cacheAuthUser` (`:296`). So if an account is first materialised through the sign-in path rather than the sign-up path, its referral and acquisition attribution is silently lost. The cold-start lazy-create *does* call both (`userService.ts:155-156`).

#### 4.2 Fired in parallel, not awaited

**Joryio `identify`** — `/Users/matan/Projects/soccer/src/firebase/auth.ts:466-474`. The `onAuthStateChanged` listener registered by `waitForAuthRestore` (`auth.ts:442-481`) stays alive after the first `null` emission specifically so a later sign-in still reaches Joryio. On sign-in it calls:
```
joryio.identify(user.uid, { email: user.email ?? undefined, name: user.displayName ?? undefined })
```
`identify` (`/Users/matan/Projects/soccer/src/services/joryio.ts:130-150`) also stamps `platform` and `appVersion` as attributes (`joryio.ts:146-147`). The comment at `auth.ts:450-455` records the bug this fixed: on a fresh install the first emission is `null`, `unsub()` used to run right there, and "a day-one user spent their entire first session as an anonymous record with no email and no `push_permission` — which is precisely the attribute the onboarding journey branches on."

**Native auth mirror** — `mirrorToNativeAuth` at `auth.ts:112` (Google) and `auth.ts:387-389` (Apple); `mirrorEmailToNativeAuth` at `auth.ts:157` / `:174` (email, Android only — `auth.ts:225`). Establishes a parallel `@react-native-firebase/auth` session so the home widget and Wear relay can write the timer (`auth.ts:239-252`).

**Email verification** — `sendEmailVerification(cred.user)` at `auth.ts:171`, explicitly `.catch()`-ed and never awaited. Comment at `auth.ts:133-135`: verification "only proves inbox control, not that the address is 'real'", so usage is not blocked on it. **Nothing in the app ever checks `emailVerified`** for the signup flow.

#### 4.3 Analytics events

All go to **two sinks at once** — Firebase Analytics and Joryio — via `logEvent` (`/Users/matan/Projects/soccer/src/services/analyticsService.ts:569-591`): `void joryio.track(name, cleaned)` at `:583`, then `analytics().logEvent(...)` at `:585-586`. `cleanParams` stamps `platform` on every event (`analyticsService.ts:598-612`). Joryio renames some events on the way out via `NAME_OVERRIDES` (`joryio.ts:71-89`) — relevant here: `onboarding_completed → 'Onboarding Completed'` (`joryio.ts:85`).

In firing order for a Google signup:

| Event constant | Wire name | Fired at |
|---|---|---|
| `SignInAttempted` | `sign_in_attempted` (`analyticsService.ts:319`) | `SignInScreen.tsx:45`, params `{ method: 'google' }` |
| `SignInSuccess` | `sign_in_success` (`analyticsService.ts:24`) | `/Users/matan/Projects/soccer/src/store/userStore.ts:133` |
| `PushPermissionResult` | `push_permission_result` (`analyticsService.ts:332`) | `/Users/matan/Projects/soccer/src/services/notificationsService.ts:676-679`, params `{ granted, can_ask_again }` |
| `ProfileCreated` | `profile_created` (`analyticsService.ts:30`) | `userStore.ts:256` |
| `OnboardingCompleted` | `onboarding_completed` (`analyticsService.ts:27`) | `userStore.ts:257` |

Guest signup logs `SignInSuccess` with `{ method: 'guest' }` (`userStore.ts:145`) — so **guests are counted as successful sign-ins in both analytics systems**, with only a param distinguishing them.

Optional events on the onboarding screen: `PhotoUploaded` `photo_uploaded` (`PostSignInOnboardingScreen.tsx:95`), `AvatarChanged` `avatar_changed` (`:107-110`, params `{ source: 'onboarding', avatarId }`), `PhotoUploadAbandoned` `photo_upload_abandoned` (`:74-77`), `PhotoUploadFailed` `photo_upload_failed` (`:79-82`), `ProfileSaveFailed` `profile_save_failed` (`:123-126`).

Email-path events: `AuthModeSwitched` `auth_mode_switched` (`EmailAuthScreen.tsx:65-68`), `SignInProviderConflict` `sign_in_provider_conflict` (`:91`), `SignInFailed` `sign_in_failed` (`:101-105`), `PasswordResetRequested` `password_reset_requested` (`:139-142`, `:148`, `:155`, `:158`, `:162`).

#### 4.4 Push permission — when the OS prompt appears

`RootNavigator.tsx:235-248`. The effect keys on `currentUser?.id`, so it fires **the instant `currentUser` is set** — i.e. immediately after `signInWithGoogle` resolves, at the same moment `RootNavigator` renders `PostSignInOnboardingScreen`. So on a real device the OS push-permission dialog lands **on top of the "בוא נכיר" profile screen**, before the user has typed their name.

Guests are explicitly skipped (`RootNavigator.tsx:240`) with the stated reason at `:237-239`: an anonymous session should not trigger the prompt (App Store 5.1.1 friction) and would only register an orphan token.

`requestAndRegisterPushToken` (`notificationsService.ts:634-696`): checks existing permission (`:671`), requests if `canAskAgain` (`:673-680`), fetches the FCM token (`:685`), then `registerDeviceToken` (`:687`). `registerDeviceToken` (`notificationsService.ts:475-510`) does three things: mirrors the token to Joryio (`:479`), writes `{ fcmTokens: arrayUnion(token), devices: {…}, updatedAt }` to `/users/{uid}/private/push` (`:481-497`), and prunes any 64-hex APNs tokens (`:509`). `joryio.registerPushToken` (`joryio.ts:239-259`) also sets the `push_permission` attribute (`:252-257`).

There is **no pre-permission priming screen anywhere in this flow** — no explanation of why notifications matter before the OS dialog.

#### 4.5 Presence ping

`touchPresence` — `userService.ts:987-1005`, called fire-and-forget from `getCurrentUser` at `:126` when the doc already exists. Writes `{ platform: Platform.OS, lastSeenAt: now }`. Throttled to once per 6h (`userService.ts:987`, `:992-995`) and gated behind the `feature_campaigns` remote-config kill-switch (`:991`). **It does not run on the signup path** — only on subsequent launches — so `platform` and `lastSeenAt` are absent from a day-zero user document.

#### 4.6 Cloud Functions that fire on the new `/users` doc

Exactly **one** Firestore trigger fires on user creation. `grep` over `/Users/matan/Projects/soccer/functions/src` for `onDocumentCreated` returns one match on the users collection:

**`onNewUserJoined`** — `/Users/matan/Projects/soccer/functions/src/index.ts:12829-12896`.

- Reads `name`; falls back to `'משתמש חדש'` ["new user"] when the name is empty or the tombstone `'משתמש שהוסר'` (`index.ts:12833-12834`).
- **Polls for attribution**: because `applyInviteAttributionIfFresh` / `applyAcquisitionIfFresh` land as *separate client updates* 1–3s later, neither is on the doc at create time. The function sleeps and re-reads three times with waits of **3000, 5000, 6000 ms** (`index.ts:12845-12857`), breaking early once an inviter or campaign lands. An organic signup waits out the full **14 seconds** and burns 3 extra document reads.
- Builds a Hebrew "via" suffix (`index.ts:12863-12888`), precedence: tracked link → personal referral → campaign → bare source:
  - `' · דרך קישור ' + linkName` / `' · דרך קישור'` (`:12874`)
  - `' · דרך ' + invName` / `' · דרך הזמנה'` (`:12880`, `:12882`)
  - `' · דרך קמפיין ' + campaign` (`:12885`)
  - `' · דרך קישור ' + source` (`:12887`)
- Sends **to the founder, not to the user** — `pushToAdmins('newUser', 'Teamder', \`מישהו נרשם לאפליקציה! 🎉 (${name})${via}\`, { uid })` (`index.ts:12890-12895`). `pushToAdmins` (`/Users/matan/Projects/soccer/functions/src/adminPush.ts:12-…`) honours a per-type mute in `adminConfig/prefs` (`:22-29`) and a 20-second same-type flood latch (`:38-49`).

**There is no welcome push, no welcome email, and no welcome notification to the new user.** `grep -rni "welcome" /Users/matan/Projects/soccer/functions/src` returns nothing.

**No server-side Joryio integration exists.** `grep -rn "joryio" /Users/matan/Projects/soccer/functions/src` returns nothing — every Joryio identify/track/attribute call in this system is client-side.

#### 4.7 Campaign enrolment

There is no enrolment step. Campaigns are **evaluated against a segment at send time**, so a new user is eligible from the moment their doc exists.

- **Push campaigns**: `sweepDueCampaigns` (`/Users/matan/Projects/soccer/functions/src/adminUserPush.ts:422-435`) is run from the cron at `index.ts:13480`; it picks up to 10 queued campaigns whose `sendAt` has passed and calls `processCampaign` (`adminUserPush.ts:231-419`), which **reads the entire `/users` collection** (`adminUserPush.ts:311`) and matches each user against the segment.
- Segment fields relevant to a new signup (`adminUserPush.ts:320-344`): `daysSinceJoin` computed as `(now - u.createdAt) / DAY` (`:126`), `invited: !!u.invitedBy`, `platform: u.platform`, `inGroup`, `hasPush`.
- **`hasPush` is computed from the root `u.fcmTokens` field** (`adminUserPush.ts:341`) — which the converter no longer writes (`firestore.ts:244-249`). Actual delivery reads the private subdoc (`tokensFor`, `adminUserPush.ts:206-217`). So a brand-new user who granted push permission is `hasPush: false` for **targeting** while being perfectly reachable for **delivery**. The identical bug exists client-side for popup campaigns at `/Users/matan/Projects/soccer/src/services/campaignService.ts:131`.
- **Per-user daily cap**: anyone who received a broadcast in the last 24h is dropped (`adminUserPush.ts:356`), and `lastBroadcastAt` is stamped on everyone reached (`adminUserPush.ts:396-402`).

#### 4.8 The Joryio in-app onboarding wizard

A **second onboarding**, delivered as a Joryio in-app HTML campaign rather than as app code.

`/Users/matan/Projects/soccer/src/services/onboardingService.ts:1-12` describes it: an HTML document served under `script-src 'none'` — "it can show, it can branch, and it can hold what somebody typed, but it cannot call anything." A single `data-action="submit"` is turned into one call by the shim in `/Users/matan/Projects/soccer/src/components/joryio/InAppMessageHost.tsx:157`.

`submit` (`onboardingService.ts:72-118`):
- `role` is `'player'` or `'organiser'` (`:73`); `recordRole(role)` fires (`:74`).
- `clubMode === 'join'` → `groupService.requestJoinByCode(code)` (`:86`), advances to step `w6`.
- Otherwise creates a club via `groupService.createGroup` (`:105-110`) and advances to `w5` with a short invite link (`:112`).
- Error strings: `he.onboardingNeedCode` (`:83`), `he.onboardingBadCode` (`:88`), `he.onboardingNeedClubName` (`:102`), `he.error` (`:77`, `:95`, `:116`).

`recordRole` (`/Users/matan/Projects/soccer/src/services/roleService.ts:23-30`) writes the answer **both ways**: `logEvent(AnalyticsEvent.RoleSelected, { role })` (`:25`) and `joryio.setAttributes({ user_type: role })` (`:26`). The comment at `roleService.ts:13-22` explains why: "the event is the timestamp… the attribute is the state… Joryio gets no merge fields from us, so anything a future message wants to know has to be on the profile before it is sent."

The only channel an in-app message has is a link, because the document runs under `script-src 'none'` — `roleService.ts:3-6` gives the shape: `footy://open/create-community?role=organiser`.

**This means the "what kind of user are you?" question a consultant will look for is not in the binary.** It is authored in the Joryio console as an HTML campaign, and whether a given new user sees it depends on campaign targeting outside this repo.

#### 4.9 Organiser signals

`reportOrganiserState` — `/Users/matan/Projects/soccer/src/services/organiserSignals.ts:54-88`, called from `/Users/matan/Projects/soccer/src/store/groupStore.ts:158`. Sets Joryio attributes from the clubs the user **admins** (`organiserSignals.ts:60-62`) and raises `ClubRosterMilestone` / `ClubBecamePlayable` events (`:70-78`). Milestone high-water marks are kept in AsyncStorage under `'organiser:rosterBest:v1'` (`organiserSignals.ts:35`), so a reinstall re-sends one.

Two limitations stated in the file header (`organiserSignals.ts:9-18`): the facts are only as fresh as the last time the organiser opened a club screen, and it only ever reports clubs the person **admins** — "being told to grow somebody else's squad is the kind of message that gets an app muted."

A brand-new user has no clubs, so on signup this reports zero-length attribute arrays and fires no milestone.

#### 4.10 Ads

New accounts get an ad-free honeymoon: `showAppOpenAdIfAvailable({ accountCreatedAt: currentUser?.createdAt })` (`RootNavigator.tsx:189-191`), and the gate at `/Users/matan/Projects/soccer/src/services/adsService.ts:441-446` suppresses the app-open ad while `Date.now() - accountCreatedAt < rcNumber('app_open_new_user_grace_ms')`. Default **2 days** — `/Users/matan/Projects/soccer/src/services/remoteConfigService.ts:27`.

The app-open ad only runs once `membership === 'member'` (`RootNavigator.tsx:187`), so a user with no club never sees it regardless.

#### 4.11 Never called

`joryio.resetUser` exists (`joryio.ts:186-189`, exported at `joryio.ts:407`) but **has no call site anywhere in `src/` or `App.tsx`**. `userStore.signOut` (`userStore.ts:164-187`) clears the group, game and chat stores but does not reset the Joryio identity. So after sign-out the install stays bound in Joryio to the previous person, and a second person signing up on the same device is `identify`-ed over the top of the first.

---

### 5. Failure modes

#### 5.1 The `/users` doc write fails (rules denied, quota, network)

**Google / Apple / email-sign-up / email-sign-in** — `userService.ts:193-207` (Google), `:240-251` (Apple), `:285-295` (email sign-in), `:328-338` (email sign-up). All four do the same three things:
1. `logError('createUserDoc', err, { uid, provider, email })` — writes to the `/errors` collection via the buffered logger (`/Users/matan/Projects/soccer/src/services/errorLog.ts:235-275`), which in turn triggers the `onErrorLogged` founder alert (`functions/src/index.ts:13072`).
2. **Sign the user back out** — `signOutFirebase()` wrapped in its own try/catch (`userService.ts:201-205`). The stated reason at `:189-192`: otherwise we leave a Firebase Auth user with no `/users` doc and the next launch crashes on `currentUser.name`.
3. Re-throw.

The user then sees, from `SignInScreen.tsx:88` / `:134`: `appAlert(he.error, friendlySignInError(err))`. `friendlySignInError` (`SignInScreen.tsx:158-171`) has no branch for a Firestore permission error, so the message is the catch-all `he.ts:1264` `signInFailed: 'ההתחברות נכשלה. נסה שוב.'`. **The user is told sign-in failed when sign-in in fact succeeded and only the profile write failed** — and because they were silently signed out, retrying looks identical.

**Cold-start lazy-create** — `userService.ts:148-154`. Different behaviour: logs, and **returns `null`** instead of signing out. `hydrate` (`userStore.ts:115-120`) turns that into `currentUser: null`, and `RootNavigator.tsx:255` renders `AuthStack initialRoute="SignIn"`. A user with a valid Auth session is shown the sign-in screen with **no error message at all**.

#### 5.2 Offline

**Cold start, signed in, no network.** `getCurrentUser` races the `getDoc` against an **8-second timeout** (`userService.ts:104-109`). The comment at `:96-101` explains: with no offline persistence, an offline `getDoc` hangs forever and the boot awaits it, so the splash would spin indefinitely — "very common for this app: locker rooms / dead zones." On timeout it falls back to the AsyncStorage snapshot (`userService.ts:112-120`), but only if `cached.id === fbUser.uid` (`:116`) — the cross-account guard. If there is no snapshot, it returns `null` → sign-in screen.

`cacheAuthUser` (`userService.ts:879-888`) is what populates that snapshot. The comment at `:870-872` records that before it existed, the key was only ever written under `USE_MOCK_DATA`, so **the fallback was dead code in production** — every dead-zone cold start bounced a real signed-in user to SignIn.

**Signing up while offline.** The Google chooser will fail; `SignInScreen.tsx:63-70` classifies `code === 'unavailable'` and messages containing `'network'`/`'offline'` as *transient* and deliberately does not log them to the error panel (`:71-77`), but does show `he.ts:1270` `signInNetworkError: 'אין חיבור לאינטרנט'` ["no internet connection"] via `friendlySignInError` (`SignInScreen.tsx:165-169`).

**Sign-out while offline.** `removeDeviceTokenBeforeAuthTeardown` (`userStore.ts:84-96`) races the token-removal write against a 4-second cap (`userStore.ts:77`). The long comment at `userStore.ts:57-77` explains the stakes: the write is self-only, so it must land before auth is revoked; the previous 1500 ms cap let slow-but-online writes lose the race, leaving the token on the old account and **leaking the previous user's pushes — including lockscreen DM previews — to the next user on the phone**.

#### 5.3 The user cancels a Google sign-in

`auth.ts:98-100`: `if (!isSuccessResponse(result)) throw new Error('Sign-in cancelled')`.

`SignInScreen.tsx:53-54` detects cancellation three ways: the message contains `'cancel'`, the code contains `'cancel'`, or the code is Google's `'12501'`. Then:
- **No error log** (`SignInScreen.tsx:71-77`).
- `logEvent(AnalyticsEvent.SignInCancelled, { method: 'google' })` (`:79`).
- **No dialog** — `SignInScreen.tsx:85-89`: "Don't pop an error dialog when the USER cancelled the Google chooser… cancelling isn't a failure."
- The spinner clears in `finally` (`:90-92`) and the user is back on the sign-in screen with nothing said.

`he.signInCancelled: 'ההתחברות בוטלה'` exists at `he.ts:1262` and is returned by `friendlySignInError` (`SignInScreen.tsx:162`) — but the dialog is suppressed for exactly the cancelled case, so **this string is effectively unreachable on the Google path**.

**Apple cancellation**: `auth.ts:360-366` maps `ERR_REQUEST_CANCELED` / `ERR_CANCELED` to the same `'Sign-in cancelled'`; `SignInScreen.tsx:106-107` detects it; same silent handling (`:126-135`).

**Guest failure**: no cancellation concept; any error shows `he.signInFailed` (`SignInScreen.tsx:151`).

#### 5.4 The name is rejected

Covered in §3.5. In summary: on `PostSignInOnboardingScreen` — the screen every new user sees — a rejected name produces `'שגיאה'` / `'ההתחברות נכשלה. נסה שוב.'` (`PostSignInOnboardingScreen.tsx:127`), which does not describe the problem. The specific messages exist (`he.ts:640-643`) and are wired only on the legacy `ProfileSetupScreen` (`ProfileSetupScreen.tsx:44-51`). If the client check is somehow bypassed, `firestore.rules:273-274` denies the write and the user gets a raw permission error through the same generic path.

#### 5.5 Email-path failures

`handleAuthError` — `EmailAuthScreen.tsx:89-135`:

| Firebase code | Shown | he.ts |
|---|---|---|
| `auth/invalid-email` | `'כתובת מייל לא תקינה'` | `:1827` |
| `auth/weak-password` | `'הסיסמה חייבת להכיל לפחות 6 תווים'` | `:1828` |
| `auth/wrong-password`, `auth/user-not-found`, `auth/invalid-credential` | `'מייל או סיסמה שגויים'` | `:1829` |
| `auth/too-many-requests` | `'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.'` | `:1830` |
| `auth/network-request-failed` | `'אין חיבור לאינטרנט'` | `:1270` |
| anything else | `'משהו השתבש, נסה שוב'` + `logError` | `:1831`, `EmailAuthScreen.tsx:131` |

`auth/email-already-in-use` gets a two-button dialog (`EmailAuthScreen.tsx:109-118`): body `he.ts:1832-1833` `emailAuthAlreadyInUse: 'המייל הזה כבר רשום. אם נרשמת עם מייל וסיסמה — עבור להתחברות. אם נרשמת עם Google/Apple — חזור והשתמש בכפתור המתאים.'`, buttons `'בטל'` (`he.ts:52`) and `'עבור להתחברות'` (`he.ts:1834`).

There is a *better* message that usually cannot fire. `signUpWithEmail` (`auth.ts:176-196`) tries `fetchSignInMethodsForEmail` to detect a social-provider collision and throw `EmailRegisteredWithProviderError`, which maps to `he.ts:1835` `'הכתובת הזו כבר רשומה דרך Google. התחבר עם Google.'` or `he.ts:1836` (Apple). But the comment at `EmailAuthScreen.tsx:110-113` states plainly: **"Email-enumeration protection makes the provider undetectable (`fetchSignInMethodsForEmail` returns `[]`)"** — so in practice the generic `emailAuthAlreadyInUse` is what users get.

Password reset (`EmailAuthScreen.tsx:137-166`) deliberately reports success for `user-not-found` so account existence is not leaked (`:161-163`): `he.ts:1837` `emailAuthResetSentTitle: 'נשלח מייל איפוס'` + `he.ts:1838-1839` `emailAuthResetSentBody: (email) => \`שלחנו קישור לאיפוס סיסמה אל ${email}. בדוק את תיבת הדואר (וגם ספאם).\``. Tapping reset with an invalid address: `he.ts:1840` `emailAuthResetNeedEmail: 'הקלד קודם את כתובת המייל שלך'`.

Client-side gates before submit: `EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/` (`EmailAuthScreen.tsx:37`), password ≥ 6 (`:54`), confirm must match on sign-up (`:57-60`), mismatch shown inline as `he.ts:1821` `'הסיסמאות לא תואמות'` (`:258-260`).

#### 5.6 Photo upload failure during onboarding

`PostSignInOnboardingScreen.tsx:63-96`. On `res.reason === 'cancelled' | 'permission'` the screen **says nothing at all** (`:73-77`) — the comment cites App Store guideline 5.1.1(iv): do not nag or point to Settings. `'network'` → `he.ts:2816` `profilePhotoUploadFailed: 'העלאת התמונה נכשלה. נסה שוב.'`; `'unavailable'` → `he.ts:2818-2819` `profilePhotoUnavailable: 'בחירת תמונה לא זמינה כרגע. בחר אווטאר מוכן בינתיים.'`. `he.ts:2814-2815` `profilePhotoPermissionDenied: 'אין הרשאה לגישה לגלריה. אפשר לאשר בהגדרות הטלפון.'` exists but is **not used on this screen**.

#### 5.7 Boot hydration failure

`hydrate` (`userStore.ts:103-123`) wraps each of its two reads so neither can leave `hydrated: false` forever — the comment at `:104-108` notes `RootNavigator` gates the splash on that flag and "silent rejections meant a perma-splash that was unrecoverable without a force-close." Failures log `BootHydrateFailed` `boot_hydrate_failed` (`analyticsService.ts:328`) with `source: 'storage'` or `source: 'user_read'` (`userStore.ts:113`, `:117`).

---

### 6. The `onboardingCompleted` flag

#### 6.1 There are two separate onboarding flags

They are frequently confused. Both are read by `RootNavigator`.

| | `onboardingDone` | `onboardingCompleted` |
|---|---|---|
| Where it lives | AsyncStorage, key `'footy.onboarding.done'` (`/Users/matan/Projects/soccer/src/services/storage.ts:7`) | Firestore field on `/users/{uid}` |
| Scope | **per device install** | per account |
| Read by | `userStore.ts:110`, `RootNavigator.tsx:35` | `userStore.ts:248-251`, `RootNavigator.tsx:38` |
| Set by | `userStore.completeOnboarding` → `storage.setOnboardingDone(true)` (`userStore.ts:125-128`, `storage.ts:88-90`) | `userService.completeOnboarding` (`userService.ts:394`) |
| Gates | the pre-sign-in slides (`RootNavigator.tsx:253`) | the post-sign-in profile screen (`RootNavigator.tsx:267-269`) |
| Survives reinstall? | **No** | Yes |
| Survives account switch on one device? | Yes (device-scoped) | No |

#### 6.2 Who sets `onboardingCompleted`

**Written `false` on every create** — via the converter at `firestore.ts:191` (`u.onboardingCompleted ?? false`), from the `fresh` objects at `userService.ts:187`, `:238`, `:283`, `:326`, `:146`.

**Set `true` in exactly one place**: `userService.completeOnboarding` (`userService.ts:355-419`). The update at `userService.ts:392-396` is:
```
{ name: trimmedName, onboardingCompleted: true, updatedAt }
```
plus `avatarId` if given (`:397`) and `photoUrl` if given (`:398`). Called only from `userStore.completePostSignInOnboarding` (`userStore.ts:253-258`), which is called only from `PostSignInOnboardingScreen.handleSave` (`PostSignInOnboardingScreen.tsx:116-120`).

So: **name and `onboardingCompleted` are set in the same single write.** There is no partial state where a user has a name but has not "completed onboarding" — except for legacy accounts that pre-date the field.

**Read back** with a strict equality check: `onboardingCompleted: d.onboardingCompleted === true` (`firestore.ts:278`) and `u.onboardingCompleted === true` (`userStore.ts:250`). Missing or null reads as `false`.

Because `updateDoc` bypasses Firestore converters, this write sends exactly those four keys — it does not re-serialise the whole user object.

#### 6.3 What is gated on it

1. **`PostSignInOnboardingScreen`** — `RootNavigator.tsx:267-269`:
   ```
   if (!isGuest && currentUser && !hasCompletedOnboarding) return <PostSignInOnboardingScreen />;
   ```
   This is a **full-screen block with no back button, no skip and no dismiss**. There is no route out of it except saving a valid name. Guests bypass it entirely via the `isGuest` term (`RootNavigator.tsx:260`, and `buildGuestUser` hard-codes `onboardingCompleted: true` at `userService.ts:50`).

2. **`ProfileSetupScreen`** — `RootNavigator.tsx:271`, reached only when onboarding *is* complete but the name is empty. Effectively legacy-only (see §3.5).

3. **The pending-invite / deep-link consumer** — `RootNavigator.tsx:65`:
   ```
   if (!currentUser || !profileComplete || !hasCompletedOnboarding) return;
   ```
   **A user who arrived from an invite link to a specific game does not reach that game until they have finished onboarding.** The stash survives (`RootNavigator.tsx:68`), the navigation is simply deferred until all three conditions hold, then pre-flighted for existence (`:95-115`) and navigated (`:146-157`). If the target no longer exists the user gets a toast: `'הקישור לא תקין או שהפריט כבר לא קיים'` (`RootNavigator.tsx:124`) plus an `InviteLinkDead` `invite_link_dead` event (`:120-123`, `analyticsService.ts:329`).

`isProfileComplete` (`userStore.ts:243-246`) is the independent second condition: `!!u && u.name.trim().length > 0`.

**Grandfathering** is deliberate. `RootNavigator.tsx:262-266`: "Existing accounts that never had this field stay grandfathered as long as the converter writes `false` rather than promoting them — they'll see it once."

---

### 7. Order and timing — a complete trace of one Google signup on a fresh install

**T-∞ — process start, before any UI.** `/Users/matan/Projects/soccer/App.tsx:17` `void joryio.init()` fires at module scope, before `ExpoSplash.preventAutoHideAsync()` at `:19`. `initJoryio` (`joryio.ts:103-118`) starts the SDK with the platform key (`joryio.ts:39-55`, literals present as fallbacks because an env-only key resolved to `''` in a store build and shipped analytics silently off — `joryio.ts:31-37`).

**T0 — boot.** `RootNavigator` mounts; `hydrateUser()` + `initRemoteConfig()` + `adsService.initializeAds()` (`RootNavigator.tsx:170-181`). `hydrate` reads `onboardingDone` and calls `getCurrentUser` in parallel (`userStore.ts:109-121`). `getCurrentUser` → `waitForAuthRestore()` (`userService.ts:86`) registers the `onAuthStateChanged` listener (`auth.ts:458`); first emission is `null`, promise resolves, **listener stays alive** (`auth.ts:456-474`). Returns `null`.

**T0+ — deep-link / attribution resolution, in parallel.** `App.tsx:537-577`, strictly ordered: `Linking.getInitialURL()` (`:539`) → if a pending invite already exists, stop (`:545-547`) → Android Play Install Referrer `consumeInstallReferrerIfFresh()` (`:553`) → iOS clipboard deferred deep link `consumeClipboardInviteIfFresh()` (`:569`). Whatever lands is stashed under `PENDING_INVITE` in AsyncStorage, shape at `storage.ts:75-81`.

**T1 — pre-sign-in slides.** `RootNavigator.tsx:253` renders `OnboardingScreen` while `onboardingDone` is false. (Not this surface.)

**T2 — `SignInScreen`.** `RootNavigator.tsx:255`.

**T3 — user taps `'המשך עם Google'`.** `logEvent(SignInAttempted, { method:'google' })` (`SignInScreen.tsx:45`) → `setBusyProvider('google')` → spinner replaces the button content (`:199-206`).

**T4 — native picker.** `ensureGoogleConfigured()` (`auth.ts:90`, config `:59-68`); Android-only `hasPlayServices` (`auth.ts:93-95`); `GoogleSignin.signIn()` (`auth.ts:97`).

**T5 — Firebase credential exchange.** `signInWithCredential` (`auth.ts:110`) → `mirrorToNativeAuth` fire-and-forget (`auth.ts:112`).

**T5a — in parallel, the surviving listener fires.** `ensureNativeAuthMirror()` (`auth.ts:462`) then `joryio.identify(uid, { email, name })` (`auth.ts:468-471`), then `unsub()` (`auth.ts:473`).

**T6 — one read.** `getDoc(docs.user(uid))` (`userService.ts:175`). Does not exist.

**T7 — one write.** `setDoc(ref, converter(fresh))` (`userService.ts:194`). **This is the moment `onNewUserJoined` starts.**

**T8 — attribution, awaited.** `applyInviteAttributionIfFresh` (`userService.ts:208`): AsyncStorage read + Firestore read + possible write. Then `applyAcquisitionIfFresh` (`:209`): AsyncStorage read + Firestore read + possible write. Then `cacheAuthUser` (`:210`).

**T9 — store update.** `set({ currentUser: user })` (`userStore.ts:132`), `logEvent(SignInSuccess)` (`:133`).

**T10 — the user sees the next screen.** `RootNavigator` re-renders. `hasCompletedOnboarding` is `false` → `PostSignInOnboardingScreen` (`RootNavigator.tsx:267-269`).

**T10a — same tick, background effects.**
- `subscribeCurrentUser(uid)` attaches a live `onSnapshot` on `/users/{uid}` (`RootNavigator.tsx:226-229`, `userStore.ts:207-224`).
- `hydrateGroup` / `setGameCurrentUserId` / `hydratePlayers` / `subscribeGroups` (`RootNavigator.tsx:201-218`).
- **`requestAndRegisterPushToken`** (`RootNavigator.tsx:241-247`) → the **OS push-permission dialog appears on top of the onboarding screen**.

**T10b — server side, 3 to 14 seconds.** `onNewUserJoined` sleeps 3s, reads; 5s, reads; 6s, reads (`index.ts:12845-12857`); builds the `via` suffix; pushes `'מישהו נרשם לאפליקציה! 🎉 (…)'` to the founder's Pulse devices (`index.ts:12890-12895`).

**T11 — the user types a name and taps `'המשך'`** (`he.ts:2840` `psoProfileSave: 'המשך'`). `complete({ name, avatarId, photoUrl })` (`PostSignInOnboardingScreen.tsx:116-120`) → `completeOnboarding` → sanitize (`userService.ts:363`) → reserved check (`:368`) → email-shape check (`:373`) → one `updateDoc` (`:400`) → `cacheAuthUser` (`:417`) → `ProfileCreated` + `OnboardingCompleted` events (`userStore.ts:256-257`).

**T12 — the app opens.** `RootNavigator.tsx:274` waits on `groupHydrated`, then `MainTabs` (`:279`). No dedicated "you have no club" screen exists — the comment at `RootNavigator.tsx:275-278` says both that state and "pending request" fall through to `MainTabs` and surface inline.

**T13 — deferred deep link, once.** `consumedRef` fires the pending-invite consumer exactly once per launch (`RootNavigator.tsx:62-66`).

**Minimum required interactions from a cold Google install to `MainTabs`**: tap `'המשך עם Google'` → pick an account in the OS sheet → answer the OS push dialog → type a name → tap `'המשך'`. Five, of which two are OS dialogs and one is free-text entry. Everything else on `PostSignInOnboardingScreen` — photo upload, the 24-avatar grid — is optional.

---

### 8. Branch matrix — what differs by state

| Branch | Where decided | Behaviour |
|---|---|---|
| **Android vs iOS — provider set** | `SignInScreen.tsx:212` | Apple button renders on iOS only. Android users have Google / email / guest. |
| **Android vs iOS — Apple availability** | `auth.ts:310-317`, `auth.ts:338-340` | `isAppleSignInAvailable` returns false off iOS; `signInWithApple` throws `'Apple Sign-In is only available on iOS.'`. **`isAppleSignInAvailable` is not called by `SignInScreen`** — the button is shown on all iOS versions rather than gated on iOS 13+. |
| **Android vs iOS — Play Services** | `auth.ts:93-95` | `hasPlayServices({ showPlayServicesUpdateDialog: true })` on Android only. |
| **Android vs iOS — install attribution** | `App.tsx:549-576` | Android: Play Install Referrer. iOS: clipboard deferred deep link (Apple has no referrer API). |
| **Android vs iOS — native auth mirror** | `auth.ts:225`, `auth.ts:283` | Android only; feeds the home widget and Wear relay. |
| **Android vs iOS — Google sign-out on signOut** | `auth.ts:418` | `GoogleSignin.signOut()` runs on Android only, so the next iOS sign-in may silently re-use the cached account. |
| **Guest vs registered** | `RootNavigator.tsx:260` | Guest: no `/users` doc, no push prompt (`:240`), no onboarding screen (`:267`), no profile gate (`:271`) — straight to `MainTabs`. |
| **Has name from provider vs not** | `userService.ts:183` / `:234` / `:322` | Google pre-fills the name field (`PostSignInOnboardingScreen.tsx:40` seeds from `user?.name`); Apple pre-fills on first authorization only; **email sign-up always starts empty** (`:322` hard-codes `''`). |
| **First Apple authorization vs later** | `auth.ts:326-329`, `userService.ts:230-233` | Apple returns `fullName` only once, ever. A user who deletes the account and signs in again with Apple gets no name. |
| **New account vs existing doc** | `userService.ts:176` / `:223` / `:272` / `:315` | If the doc already exists, the existing one is returned and **no attribution or acquisition is applied** — correct for a returning user, and the reason re-installs do not re-attribute. |
| **Email sign-up vs email sign-in** | `userService.ts:339-340` vs `:296` | Sign-up runs both attribution helpers; sign-in does not. |
| **Has pending invite vs organic** | `userService.ts:914`, `:954` | Organic signups skip both writes entirely, and `onNewUserJoined` waits the full 14s for nothing (`index.ts:12845-12857`). |
| **Has club vs no club** | `RootNavigator.tsx:187`, `organiserSignals.ts:60` | No club → no app-open ad; no organiser attributes; no milestone events. |
| **Online vs offline cold start** | `userService.ts:104-122` | 8s race; falls back to the AsyncStorage snapshot, else SignIn. |
| **Legacy account (no `onboardingCompleted`)** | `firestore.ts:278`, `RootNavigator.tsx:262-266` | Reads as `false`; sees `PostSignInOnboardingScreen` exactly once. |
| **Account with an empty name but `onboardingCompleted: true`** | `RootNavigator.tsx:271` | Only path to `ProfileSetupScreen`, the one screen with correct name-rejection copy. |
| **Mock mode (`USE_MOCK_DATA`)** | `userService.ts:62`, `:168`, `:215`, `:264`, `:307` | Every path returns `mockCurrentUser` and writes AsyncStorage only. Attribution, presence, analytics delivery (`analyticsService.ts:579`) and Joryio (`joryio.ts:104`, `:124`, `:134`) are all no-ops. **Mock QA cannot exercise any of this surface.** |

**Branches I did not check:** web (`Platform.OS === 'web'`) — `auth.ts:83-87` throws for any platform other than android/ios and `auth.ts:9` notes web Google sign-in is "not yet wired"; I did not verify whether the app is ever built for web. I also did not check Expo Go behaviour beyond noting the explicit bail-outs at `notificationsService.ts:641-652`.

---

### 9. Facts a consultant will ask about that are worth stating plainly

1. **No terms-of-service or privacy-policy link exists on the sign-in screen.** `he.ts:1799` `'באמצעות התחברות אתה מסכים לתנאי השימוש'` is rendered as inert text at `SignInScreen.tsx:272`.
2. **No pre-permission priming for push.** The OS dialog is the first and only thing said about notifications, and it lands mid-onboarding (`RootNavigator.tsx:235-248`).
3. **`marketingPush` defaults to `true`** (`types/index.ts:423`) and is never surfaced during signup.
4. **The Google profile photo is discarded** — `photoUrl` is absent from the converter's write path (`firestore.ts:183-264`, note at `:274`).
5. **Every new user is a random emoji until they act** (`userService.ts:185` + `avatars.ts:70-72`).
6. **Every signed-in user can read every user document** (`firestore.rules:260`).
7. **The founder gets a push for every signup; the user gets nothing** (`index.ts:12890-12895`; no welcome anything anywhere in `functions/src`).
8. **`createdAt` is the device clock** (`userService.ts:185`, `firestore.ts:189`), and `daysSinceJoin` segmentation is computed from it (`adminUserPush.ts:126`). A phone with a wrong clock lands in the wrong segments.
9. **`hasPush` segmentation is broken for all new users** — it reads a root field the converter no longer writes (`adminUserPush.ts:341` vs `firestore.ts:244-249`; same at `campaignService.ts:131`).
10. **Joryio is never reset on sign-out** (`joryio.ts:186-189` has no caller), so shared devices cross-contaminate the marketing profile.
11. **The "are you an organiser or a player?" question is not in the app.** It is a Joryio in-app HTML campaign (`onboardingService.ts:1-12`, `roleService.ts:3-6`), so whether a new user is asked at all is decided outside this repo.
12. **The name-rejection copy on the screen everyone sees is wrong** (`PostSignInOnboardingScreen.tsx:127`), and the correct copy exists two files away (`ProfileSetupScreen.tsx:44-51`, `he.ts:640-643`).
