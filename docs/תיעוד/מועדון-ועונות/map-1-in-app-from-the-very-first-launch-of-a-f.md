## The app from first launch to a usable account

Repo root `/Users/matan/Projects/soccer`. All paths below are absolute-from-repo-root. App version in `app.json` at the time of reading: `"version": "1.1.10"` (`/Users/matan/Projects/soccer/app.json`, `expo.version`).

Every Hebrew string is quoted verbatim from source with its `file:line`. Strings that live in `src/i18n/he.ts` are given as `key: 'value'` at their `he.ts` line, plus the line of the screen that renders them.

---

### 0. What runs before any pixel of ours is drawn

These fire at **module load of `App.tsx`**, i.e. before React mounts, before the user has seen or agreed to anything.

| Order | What | File:line | Notes |
|---|---|---|---|
| 1 | `void joryio.init();` | `App.tsx:17` | Joryio analytics/messaging SDK starts **before the first screen, before sign-in, before any consent UI**. Implementation: `src/services/joryio.ts:103-118` (`initJoryio` → `Joryio.initialize(KEY, API_HOST, {...})`). SDK keys are hardcoded literals as fallback at `src/services/joryio.ts:39-49`. |
| 2 | `ExpoSplash.preventAutoHideAsync()` | `App.tsx:19-21` | Holds the OS splash up until our React splash paints. |
| 3 | `LogBox.ignoreLogs([...])` | `App.tsx:29-39` | Dev-only noise suppression. |
| 4 | `Notifications.setNotificationHandler({...})` | `App.tsx:67-137` | Foreground push behaviour. Does **not** request permission. |
| 5 | `Notifications.setNotificationCategoryAsync('NEW_GAME_RSVP', [...])` | `App.tsx:164-175` | Registers the action button `buttonTitle: 'אני מגיע'` (`App.tsx:167`). |
| 6 | `Notifications.setNotificationCategoryAsync('SPOT_OFFER', [...])` | `App.tsx:180-193` | Action buttons `buttonTitle: 'מאשר/ת'` (`App.tsx:185`) and `buttonTitle: 'ויתור'` (`App.tsx:190`). |
| 7 | `I18nManager.allowRTL(true)` / `forceRTL(true)` | `App.tsx:253-258` | RTL forced on first launch. Comment at `App.tsx:256-257` notes a forced RTL switch normally needs a JS reload. |
| 8 | Global `Text` / `TextInput` `defaultProps` → `textAlign:'right'`, `writingDirection:'rtl'` | `App.tsx:274-295` | Every string in the app is right-aligned by default. |
| 9 | `installGlobalErrorHandlers()` | `App.tsx:305` | Crash + unhandled-rejection catch-all. |

**Firebase App Check** initialises lazily the first time `getFirebase()` runs — `src/firebase/config.ts:156-163` (`const { initAppCheck } = require('./appCheck'); void initAppCheck(_app);`).

**Firebase Analytics** is the native `@react-native-firebase/analytics` SDK (`src/services/analyticsService.ts:13-17`); there is no in-app analytics opt-in before it collects.

**There is no App Tracking Transparency prompt on iOS.** Verified by grep across `src`, `App.tsx`, `app.json`, `plugins`: no `requestTrackingPermissionsAsync`, no `expo-tracking-transparency`, no `NSUserTrackingUsageDescription`.

**There is no AdMob UMP / GDPR consent form.** `adsService.initializeAds()` (`src/services/adsService.ts:327-394`) calls `sdk.initialize()` (`:379`) and creates the app-open ad with `requestNonPersonalizedAdsOnly: true` (`:383`) — no consent-info-update, no form.

---

### 1. Screen 1 — Native OS splash

- **File / config:** `/Users/matan/Projects/soccer/app.json` → `expo.splash = {"image": "./splash-blank.png", "resizeMode": "contain", "backgroundColor": "#1E40AF"}`.
- **Shown:** always, at process start, on every launch.
- **Content:** the image file is literally named `splash-blank.png` — the visible result is a flat `#1E40AF` blue field.
- **Strings:** none.
- **Controls:** none. Not skippable, not backable.
- **Dismissed by:** `ExpoSplash.hideAsync()` called from inside our React splash's first effect — `src/screens/SplashScreen.tsx:372-374`. The comment at `App.tsx:393-397` explains this is deliberate, so there is no black flash between native dismiss and React first paint.
- Android adaptive icon / Android splash background also `#1E40AF` (`app.json`, `expo.android.adaptiveIcon.backgroundColor`).

---

### 2. Screen 2 — Animated splash (`SplashScreen`)

- **File:** `/Users/matan/Projects/soccer/src/screens/SplashScreen.tsx`
- **Mounted from:** `App.tsx:1006-1011` — `{!splashDone ? <SplashScreen ready={userHydrated && (!currentUserId || groupHydrated)} onFinish={handleSplashFinish} /> : null}`. It renders **over** `RootNavigator`, which mounts and hydrates behind it (`App.tsx:989-1005`).
- **Shown:** always, every cold start.
- **Duration:** minimum hold `const MIN_HOLD_MS = 1400;` (`src/screens/SplashScreen.tsx:41`), then a `FADE_MS = 320` fade-out (`:42`). The fade only starts once `ready` is true (`:376-398`). For a signed-out fresh install, `ready` = `userHydrated` alone, because of the `!currentUserId` short-circuit at `App.tsx:1008` (documented at `App.tsx:996-1005` — waiting on `groupHydrated` would pin the splash forever for a signed-out user, since `hydrateGroup` only runs once a `currentUser` exists, `RootNavigator.tsx:201-211`).
- **Animation sequence** documented at `src/screens/SplashScreen.tsx:3-13`: pitch lines draw on (~480-700ms), ball kicked at the camera from `KICK_AT = 440` (`:105`), wordmark rises at ~1100ms.
- **Strings, verbatim:**
  - `Teamder` — `src/screens/SplashScreen.tsx:285` (hardcoded, `allowFontScaling={false}`)
  - `המשחק הבא שלך מתחיל כאן` [your next game starts here] — `src/screens/SplashScreen.tsx:288` (hardcoded, **not** in `he.ts`)
  - Three pulsing dots, no text — `:290-294`
- **Controls:** none. No tap advances or skips it.
- **On finish:** `handleSplashFinish` (`App.tsx:871-903`). Critically, **the app-open ad is skipped entirely when there is no signed-in user** — `if (useUserStore.getState().currentUser) { ... }` at `App.tsx:879`, with the rationale at `App.tsx:872-878`: "a fresh install (incl. the Play reviewer) goes straight to the app, never sitting on the splash behind an ad." Even for signed-in users the ad is raced against a 3500ms hard timeout (`App.tsx:884-892`).
- **Second appearance:** `RootNavigator` renders the same visual again via `SplashVisual` (`src/navigation/RootNavigator.tsx:274`, `:287-289`) when `!groupHydrated` after sign-in. So a brand-new user sees the ball splash a **second** time between tapping "המשך" on the profile screen and landing on the tabs.

---

### 3. The decider — `RootNavigator`

**File:** `/Users/matan/Projects/soccer/src/navigation/RootNavigator.tsx`. This is the single branch point. Exact order of the gates (`:251-279`):

```
251  if (!userHydrated)                                  → <Splash />
253  if (!onboardingDone)                                → <OnboardingScreen />
255  if (!currentUser)                                   → <AuthStack initialRoute="SignIn" />
260  const isGuest = currentUser.isGuest === true
267  if (!isGuest && currentUser && !hasCompletedOnboarding) → <PostSignInOnboardingScreen />
271  if (!isGuest && !profileComplete)                   → <AuthStack initialRoute="ProfileSetup" />
274  if (!groupHydrated)                                 → <Splash />
279  return <MainTabs />
```

Gate definitions:
- `onboardingDone` — hydrated from AsyncStorage key `ONBOARDING_DONE: 'footy.onboarding.done'` (`src/services/storage.ts:7`, read at `:84-86`, written at `:88-90`). Loaded in `useUserStore.hydrate` (`src/store/userStore.ts:109-122`). **Sign-out does NOT clear it** (`src/store/userStore.ts:164-187` wipes group/game/chat stores only), so the intro slides are shown **once per install**, never again.
- `profileComplete` — `isProfileComplete: () => !!u && u.name.trim().length > 0` (`src/store/userStore.ts:243-246`).
- `hasCompletedOnboarding` — `!!u && u.onboardingCompleted === true` (`src/store/userStore.ts:248-251`).

Side-effects mounted here, with their firing conditions:
- `hydrateUser()` + `void initRemoteConfig()` + `adsService.initializeAds()` on mount — `RootNavigator.tsx:170-181`.
- App-open ad once on MainTabs, only when `membership === 'member' && gameStatus !== 'locked'` — `:186-193`.
- `hydrateGroup` / `subscribeGroups` / `hydratePlayers` once `currentUser` exists — `:201-218`.
- Live `/users/{uid}` listener — `:226-229`.
- **Push permission request** — `:235-248`. See §7.
- Pending-invite deep-link consumer — `:63-166`. Error toast string: `toast.error('הקישור לא תקין או שהפריט כבר לא קיים')` — `RootNavigator.tsx:124` (hardcoded, not in `he.ts`).

---

### 4. Screen 3 — Pre-sign-in onboarding (`OnboardingScreen`)

- **File:** `/Users/matan/Projects/soccer/src/screens/onboarding/OnboardingScreen.tsx`
- **Shown when:** `!onboardingDone` (`RootNavigator.tsx:253`) — i.e. exactly once per install, before any auth.
- **Skipped when:** the AsyncStorage flag is already `true`. A signed-out returning user on the same install goes **straight to SignIn**, never sees the slides again.
- **Layout:** full-screen `LinearGradient` with `const GRADIENT = ['#0F172A', '#1E3A8A', '#1E40AF']` (`:55`). Comment at `:1-6` records that this is a trim from an earlier **4-slide green** version to "the 3 highest-signal pitches".
- **Carousel:** horizontal paging `FlatList` with `inverted` (`:122-144`, `inverted` at `:129`) — inverted because of forced RTL, so the user swipes right-to-left.
- **Pagination:** three animated dots, width interpolating 8→24dp (`:146-150`, `Dot` at `:192-216`).

#### Slide contents (`SLIDES` array at `:43-47`)

**Slide 1** — preview `PreviewMatches` (`:44`)
- Image: `assets/images/onboarding/games.png` — `src/screens/onboarding/OnboardingPreviews.tsx:37`
- Title, rendered at `OnboardingScreen.tsx:139`: `onb1Title: 'שחקו עם אנשים בקרבת מקום'` — `src/i18n/he.ts:1781`
- Body, rendered at `:140`: `onb1Body: 'גלו מחזורי כדורגל פתוחים באזור שלכם והצטרפו בלחיצה — או פגשו שחקנים חדשים לידכם'` — `src/i18n/he.ts:1782`

**Slide 2** — preview `PreviewClub` (`:45`)
- Image: `assets/images/onboarding/club.png` — `OnboardingPreviews.tsx:41`
- `onb2Title: 'מועדון קבוע, מחזור אוטומטי'` — `src/i18n/he.ts:1783`
- `onb2Body: 'בנו את הסגל הקבוע שלכם — והמחזור השבועי נפתח לבד עם הזמנה לכולם'` — `src/i18n/he.ts:1784`

**Slide 3** — preview `PreviewLive` (`:46`)
- Image: `assets/images/onboarding/live.png` — `OnboardingPreviews.tsx:45`
- `onb3Title: 'הכל זורם מעצמו'` — `src/i18n/he.ts:1785`
- `onb3Body: 'מישהו ביטל? המקום מתמלא אוטומטית מרשימת ההמתנה עם תזכורות חכמות שדואגות שכולם יגיעו'` — `src/i18n/he.ts:1786`

The three previews are **real cropped screenshots of the live app** shown inside a drawn phone bezel — `OnboardingPreviews.tsx:1-5` ("REAL captures of the live app … Source PNGs live in assets/images/onboarding/ (600×1253, status bar / ad / gesture bar stripped)"), frame at `:28-34`, `FRAME_W = Math.min(236, SCREEN_W * 0.62)` (`:21`).

#### Controls

| Control | Label (verbatim) | he.ts line | Rendered at | Behaviour |
|---|---|---|---|---|
| Skip pill, top-leading | `onbSkip: 'דלג'` | `src/i18n/he.ts:1775` | `OnboardingScreen.tsx:117` | `handleSkip` (`:100-103`) → `logEvent(AnalyticsEvent.OnboardingSkipped, { slide: index + 1, total: SLIDES.length })` then `completeOnboarding()`. **Rendered only when `!isLast`** (`:115`) — there is no skip on slide 3. |
| Primary CTA, slides 1-2 | `onbNext: 'הבא'` | `src/i18n/he.ts:1776` | `OnboardingScreen.tsx:180` | `advance()` (`:73-77`) → `scrollToIndex(index+1)`. |
| Primary CTA, slide 3 | `onbCtaStart: 'המשך'` | `src/i18n/he.ts:1780` | `OnboardingScreen.tsx:167` | `handleStart` (`:84-94`) → `logEvent(AnalyticsEvent.OnboardingCompleted, { via: 'cta', slide: index + 1 })` → `await completeOnboarding()`. Disabled while `busy`. |

The slides are **purely informational** — no sign-in button lives here. Comment at `:79-83`: "This avoids the old duplication where both the last slide AND the sign-in screen carried login buttons."

#### Dead / unused strings still in `he.ts`
These exist but nothing on this screen renders them: `onbStart: 'בוא נתחיל'` (`:1777`), `onbCtaSignIn: 'התחבר עם Google'` (`:1778`), `onbCtaSignInApple: 'התחבר עם Apple'` (`:1779`), `onb4Title: 'בוא נתחיל'` (`:1789`), `onb4Body: 'התחבר ותתחיל לארגן מחזורים'` (`:1790`) — explicitly flagged as legacy at `he.ts:1787-1788`.

#### Required vs skippable, backing out
- Required: **no**. One tap on `'דלג'` clears the whole thing.
- Android hardware back on this screen: no stack to pop and we are not on a tab, so `useAndroidBack` (`App.tsx:352`, implementation `src/navigation/useAndroidBack.ts`) falls to rule 3 — first press arms + shows a toast `backAgainToExit: 'לחץ שוב כדי לצאת'` (`src/i18n/he.ts:51`), second press within `CONFIRM_WINDOW_MS = 2000` (`useAndroidBack.ts:47`) leaves the app. iOS: no hardware back (`useAndroidBack.ts:20-21, :69`).
- Once completed or skipped, **the slides are unreachable** — there is no "show intro again".

#### Permissions / SDK on this screen
None fire here. Joryio already started at module load (§0). No push prompt yet (guarded on `currentUser`, `RootNavigator.tsx:236`).

#### Error states
None. `handleStart` swallows failures (`:89-91` `catch { // no-op }`), so a failed AsyncStorage write silently leaves the user on the slides with the CTA re-enabled.

---

### 5. Screen 4 — Sign-in (`SignInScreen`)

- **File:** `/Users/matan/Projects/soccer/src/screens/auth/SignInScreen.tsx`
- **Shown when:** `onboardingDone && !currentUser` → `<AuthStack initialRoute="SignIn" />` (`RootNavigator.tsx:255`). Stack config: `src/navigation/AuthStack.tsx:19-29`, `screenOptions={{ headerShown: false }}` (`:23`).
- **Palette:** `const ACCENT = '#1E40AF'; const ACCENT_SOFT = '#DBEAFE';` (`:28-29`), deliberately not the legacy green `colors.primary` (`:24-27`).
- **Hero:** a 140dp circle (`:281-289`) containing `<Ionicons name="football-outline" size={72} color={ACCENT} />` (`:177`).

#### Strings, verbatim

| Element | Value | he.ts | Rendered |
|---|---|---|---|
| Title | `signInTitle: 'בואו נתחיל'` | `:1793` | `SignInScreen.tsx:179` |
| Subtitle | `signInSubtitle: 'התחבר כדי להירשם, להצטרף למועדון ולעקוב אחרי הסטטיסטיקות שלך.'` | `:1794` | `:180` |
| Google button | `signInGoogle: 'המשך עם Google'` | `:1795` | `:204` |
| Apple button | `signInApple: 'המשך עם Apple'` | `:1796` | `:229` |
| Email button | `signInEmail: 'המשך עם מייל'` | `:1797` | `:251` |
| Guest link | `signInGuest: 'המשך כאורח'` | `:1798` | `:269` |
| Footer | `signInPrivacy: 'באמצעות התחברות אתה מסכים לתנאי השימוש'` | `:1799` | `:272` |

Note the mixed voice: the title `'בואו נתחיל'` is plural/formal, the subtitle `'התחבר…'` is masculine-singular imperative. Same tension appears between the slides (`'שחקו'`, `'גלו'`, `'בנו'` — plural) and everything after sign-in (`'בוא נכיר'` — masculine singular).

**The privacy footer is a plain non-tappable `<Text>`** (`:272`, style `privacy` at `:324`). It is **not** a link. Grep across `src/i18n/he.ts` for privacy/terms returns only this one string. A `public/privacy.html` exists on the hosting site but nothing in the in-app sign-up flow links to it.

#### Controls and branches

1. **`'המשך עם Google'`** — `Pressable` at `:188-207`. `handlePress` (`:44-93`):
   - `logEvent(AnalyticsEvent.SignInAttempted, { method: 'google' })` (`:45`)
   - `setBusyProvider('google')` → in-button `<ActivityIndicator />` (`:199-200`)
   - `signIn()` → `userStore.signInWithGoogle` (`src/store/userStore.ts:130-134`) → `userService.signInWithGoogle` (`src/services/userService.ts:167-212`) → `src/firebase/auth.ts:79-...`:
     - Android only: `GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })` (`auth.ts:93-95`) — can raise a **system Play Services update dialog**.
     - `GoogleSignin.signIn()` (`auth.ts:97`) — **system Google account chooser sheet**. One tap to pick an account.
     - `signInWithCredential` (`auth.ts:110`), plus `mirrorToNativeAuth` (`:112`) for the widget/watch.
   - New user → doc written at `userService.ts:181-194` with `name: fbUser.displayName ?? ''`, `email`, `avatarId: pickRandomAvatarId()`, `createdAt: Date.now()`, **`onboardingCompleted: false`** (`:187`). So a Google user arrives at the next screen **with their name pre-filled**.
   - Then `applyInviteAttributionIfFresh` + `applyAcquisitionIfFresh` (`:208-209`).
   - If the doc write fails, the user is **signed back out** (`:193-207`) to avoid an auth user with no `/users` doc.
   - `logEvent(AnalyticsEvent.SignInSuccess)` (`userStore.ts:133`).
   - Returning Google user → existing doc returned as-is (`userService.ts:176-180`), so `onboardingCompleted` stays `true` and the post-sign-in screen is skipped.

2. **`'המשך עם Apple'`** — `Pressable` at `:212-233`, wrapped in **`{Platform.OS === 'ios' && ...}`** (`:212`). **Android users never see this button.** `handleApple` (`:97-139`). New-user doc at `userService.ts:228-239`, `name: fbUser.displayName ?? fullName ?? ''` (`:234`) — the comment at `:230-233` notes Apple only returns the name on the *first* authorization. `usesAppleSignIn: true` in `app.json` (`expo.ios`).

3. **`'המשך עם מייל'`** — `Pressable` at `:236-252`. `logEvent(AnalyticsEvent.SignInAttempted, { method: 'email' })` then `nav.navigate('EmailAuth')` (`:238-239`). This is the **only** control here that is a navigation rather than an auth attempt. It carries no busy state (`:244-246` only dims when another provider is busy).

4. **`'המשך כאורח'`** — underlined text link, `Pressable` at `:255-271`, style `guestText` with `textDecorationLine: 'underline'` (`:330-335`). `handleGuest` (`:143-155`) → `userStore.signInAsGuest` (`userStore.ts:142-146`) → `userService.signInAsGuest` (`src/services/userService.ts:61-67`) → `fbSignInAnonymously` (`src/firebase/auth.ts:407-412`). Builds a **runtime-only** user (`userService.ts:44-53`): `name: ''`, `avatarId: pickRandomAvatarId()`, **`onboardingCompleted: true`**, `isGuest: true`. **No `/users` doc is created.** Rationale at `userService.ts:56-60` and `SignInScreen.tsx:141-142`: App Store guideline 5.1.1(v).
   - Consequence at `RootNavigator.tsx:260-271`: a guest **skips both the post-sign-in profile screen and the profile-setup screen** and lands on `MainTabs` in one tap.

#### Every error state on this screen

Error dialogs use `appAlert(he.error, ...)` where `error: 'שגיאה'` (`src/i18n/he.ts:188`). The message is resolved by `friendlySignInError` (`SignInScreen.tsx:158-171`):

| Condition | Message | he.ts |
|---|---|---|
| cancelled | `signInCancelled: 'ההתחברות בוטלה'` | `:1262` |
| `'OAuth client ID not configured'` | `signInConfigMissing: 'הגדרות Google עדיין לא מוגדרות'` | `:1263` |
| browser blocked (`isBrowserBlocked`) | `signInBrowserBlocked: 'לא ניתן לפתוח את הדפדפן במכשיר הזה, ולכן ההתחברות עם Google נחסמה. בדרך כלל זה מגיע מהגבלת תוכן ב"זמן מסך" או מפרופיל ניהול. אפשר להתחבר עם Apple או עם אימייל במקום.'` | `:1268-1269` |
| network / offline / `auth/network-request-failed` / `unavailable` | `signInNetworkError: 'אין חיבור לאינטרנט'` | `:1270` |
| anything else | `signInFailed: 'ההתחברות נכשלה. נסה שוב.'` | `:1264` |
| guest failure | `signInFailed` (direct, not via the mapper) | `SignInScreen.tsx:151` |

Important behavioural detail: **a user-cancelled Google or Apple chooser shows no dialog at all** — `if (!cancelled) { appAlert(...) }` at `:87-89` and `:133-135`. It just returns to the sign-in screen with the spinner cleared.

Analytics on failure paths: `SignInCancelled` / `SignInFailed` (`:78-82` Google, `:126-130` Apple, `:150` guest). Transient errors are deliberately kept out of the error panel (`:63-77` Google, `:113-125` Apple).

#### Required vs skippable, backing out
- Some auth choice is **required** to proceed past this screen — but "guest" satisfies it, so no account is strictly required to reach the app.
- Android back on SignIn: nothing to pop, not on a tab → the "press again to exit" toast path (`useAndroidBack.ts`).
- There is no way back to the onboarding slides from here.

---

### 6. Screen 5 (email branch only) — `EmailAuthScreen`

- **File:** `/Users/matan/Projects/soccer/src/screens/auth/EmailAuthScreen.tsx`
- **Shown when:** the user taps `'המשך עם מייל'` on SignIn (`SignInScreen.tsx:239`). Registered at `src/navigation/AuthStack.tsx:27`.
- **Mode:** `const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')` — `:45`. **The screen opens in SIGN-IN mode.** A brand-new user must first tap the toggle link at the bottom to reach sign-up.
- **Header:** `<ScreenHeader title={isSignUp ? he.emailAuthSignUpTitle : he.emailAuthSignInTitle} />` (`:170-172`). `ScreenHeader` renders a back chevron when `navigation.canGoBack()` (`src/components/ScreenHeader.tsx:46, :59-64`; in RTL the back glyph is `chevron-forward`, `:61-62`) — so this is **the first screen in the whole flow with a visible back affordance**.
- `KeyboardAvoidingView` with `behavior='padding'` on iOS only (`:173-176`).

#### Strings, verbatim

| Element | Value | he.ts | Rendered |
|---|---|---|---|
| Title (sign-in mode) | `emailAuthSignInTitle: 'התחברות עם מייל'` | `:1813` | `:171` |
| Title (sign-up mode) | `emailAuthSignUpTitle: 'הרשמה עם מייל'` | `:1814` | `:171` |
| Email label | `emailAuthEmailLabel: 'כתובת מייל'` | `:1815` | `:178` |
| Email placeholder | `emailAuthEmailPlaceholder: 'name@example.com'` | `:1816` | `:182` |
| Password label | `emailAuthPasswordLabel: 'סיסמה'` | `:1817` | `:193` |
| Password placeholder | `emailAuthPasswordPlaceholder: 'לפחות 6 תווים'` | `:1818` | `:198` |
| Confirm label (sign-up only) | `emailAuthConfirmPasswordLabel: 'אימות סיסמה'` | `:1819` | `:226` |
| Confirm placeholder | `emailAuthConfirmPasswordPlaceholder: 'הקלד שוב את הסיסמה'` | `:1820` | `:231` |
| Inline mismatch error | `emailAuthPasswordMismatch: 'הסיסמאות לא תואמות'` | `:1821` | `:259` |
| Forgot link (sign-in only) | `emailAuthForgot: 'שכחת סיסמה?'` | `:1826` | `:266` |
| CTA (sign-in) | `emailAuthSignInCta: 'התחבר'` | `:1822` | `:284` |
| CTA (sign-up) | `emailAuthSignUpCta: 'הרשמה'` | `:1823` | `:284` |
| Toggle → sign-up | `emailAuthToggleToSignUp: 'אין לך חשבון? הרשמה'` | `:1824` | `:298` |
| Toggle → sign-in | `emailAuthToggleToSignIn: 'כבר יש לך חשבון? התחבר'` | `:1825` | `:298` |
| Eye button a11y | `'הצג סיסמה'` / `'הסתר סיסמה'` | hardcoded | `:212` and `:249` |

#### Controls
- **Email `TextInput`** (`:179-191`): `keyboardType="email-address"`, `autoCapitalize="none"`, `autoComplete="email"`, `textContentType="emailAddress"`, `textAlign="right"`.
- **Password `TextInput`** (`:195-207`): `secureTextEntry={!showPassword}`, `autoComplete` flips `'password-new'`/`'password'` by mode (`:203`).
- **Eye toggle** (`:208-219`, and a duplicate at `:245-256` for the confirm field) — one shared `showPassword` state (`:49`), positioned `left: spacing.md` (`:338-339`) i.e. the far side under RTL.
- **Confirm password field** — rendered only when `isSignUp` (`:224-262`).
- **`'שכחת סיסמה?'`** — rendered only when `!isSignUp` (`:264-268`).
- **Primary CTA** (`:270-287`): `disabled={!canSubmit}`, dimmed to `opacity: 0.5` when disabled (`:276`), `<ActivityIndicator />` while `busy` (`:280-281`).
- **Mode toggle link** (`:289-300`): `switchMode(...)` (`:64-70`, logs `AnalyticsEvent.AuthModeSwitched`) and clears the confirm field (`:292`).

#### Validation (all client-side, `:37, :52-60`)
- `EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/` (`:37`)
- `passwordOk = password.length >= 6` (`:54`)
- Sign-up additionally requires `passwordsMatch && confirmPassword.length > 0` (`:60`)
- `confirmError` only shows once the user has typed something into confirm (`:58`) — deliberate, per the comment at `:55-56`.
- **The CTA is disabled, not error-flagged**, until all of the above pass. There is no inline error for a bad email or a short password — only the disabled button.

#### Every error state
Resolved in `handleAuthError` (`:89-135`):

| Firebase code | Message | he.ts |
|---|---|---|
| `auth/invalid-email` | `emailAuthInvalidEmail: 'כתובת מייל לא תקינה'` | `:1827` |
| `auth/weak-password` | `emailAuthWeakPassword: 'הסיסמה חייבת להכיל לפחות 6 תווים'` | `:1828` |
| `auth/email-already-in-use` | `emailAuthAlreadyInUse: 'המייל הזה כבר רשום. אם נרשמת עם מייל וסיסמה — עבור להתחברות. אם נרשמת עם Google/Apple — חזור והשתמש בכפתור המתאים.'` with two actions: `cancel: 'בטל'` (`he.ts:52`) and `emailAuthSwitchToSignIn: 'עבור להתחברות'` (`he.ts:1834`) | `:1832-1833`, dialog at `:114-117` |
| `auth/wrong-password` / `auth/user-not-found` / `auth/invalid-credential` | `emailAuthWrongCredentials: 'מייל או סיסמה שגויים'` | `:1829` |
| `auth/too-many-requests` | `emailAuthTooManyAttempts: 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.'` | `:1830` |
| `auth/network-request-failed` | `signInNetworkError: 'אין חיבור לאינטרנט'` | `:1270` |
| unknown | `emailAuthGenericError: 'משהו השתבש, נסה שוב'` + `logError` to the error panel | `:1831`, `:106`, `:131` |
| `EmailRegisteredWithProviderError` google | `emailAuthRegisteredWithGoogle: 'הכתובת הזו כבר רשומה דרך Google. התחבר עם Google.'` | `:1835`, thrown from `src/firebase/auth.ts:181-190` |
| `EmailRegisteredWithProviderError` apple | `emailAuthRegisteredWithApple: 'הכתובת הזו כבר רשומה דרך Apple. התחבר עם Apple.'` | `:1836` |

Password reset (`onForgotPassword`, `:137-166`):
- No/invalid email typed → `emailAuthResetNeedEmail: 'הקלד קודם את כתובת המייל שלך'` (`he.ts:1840`), logged as `PasswordResetRequested { result: 'blocked', reason: 'invalid_email' }` (`:139-142`).
- Success (and, deliberately, also `user-not-found` — anti-enumeration, `:161`) → title `emailAuthResetSentTitle: 'נשלח מייל איפוס'` (`he.ts:1837`), body `emailAuthResetSentBody: (email) => \`שלחנו קישור לאיפוס סיסמה אל ${email}. בדוק את תיבת הדואר (וגם ספאם).\`` (`he.ts:1838-1839`).

#### What the account looks like after email sign-up
`userService.signUpWithEmail` (`src/services/userService.ts:306-341`) writes `name: ''` (`:322`), `onboardingCompleted: false` (`:326`). A verification email is sent best-effort and **does not block usage** — `src/firebase/auth.ts:171-173`, and the comment at `userService.ts:303-304`. **There is no email-verification gate anywhere in the flow.**

Because `name` is empty, the email user must type their name on the next screen. The Google user does not.

#### Backing out
Back chevron pops to SignIn. Android back pops the same way (rule 1 in `useAndroidBack.ts:11-12`). Nothing is persisted — returning to this screen resets to sign-in mode with empty fields.

---

### 7. The push-permission prompt — fires **on top of** the next screen

`src/navigation/RootNavigator.tsx:235-248`:

```ts
useEffect(() => {
  if (!currentUser) return;
  if (currentUser.isGuest) return;          // :240
  notificationsService.requestAndRegisterPushToken(currentUser.id)
```

This effect runs the moment `currentUser` is set — which is the same render in which `RootNavigator` has already decided to show `PostSignInOnboardingScreen` (`:267-269`). So on a real device the **OS push-permission dialog appears over the "בוא נכיר" profile screen, immediately after the sign-in sheet closes**, before the user has typed anything.

Implementation `src/services/notificationsService.ts:634-696`:
- Bails out in Expo Go / storeClient (`:641-652`).
- `getPermissionsAsync()` (`:671`); only if not granted **and** `canAskAgain` does it call `requestPermissionsAsync()` (`:673-675`).
- Logs `AnalyticsEvent.PushPermissionResult { granted, can_ask_again }` (`:676-679`).
- Then `getFcmToken()` + `registerDeviceToken` (`:685-687`).
- Guests are skipped entirely — rationale at `RootNavigator.tsx:237-240`: "an anonymous session shouldn't trigger the OS push-permission prompt (App Store 5.1.1 friction)".
- `android.permissions` in `app.json` includes `"android.permission.POST_NOTIFICATIONS"` (so Android 13+ shows a runtime dialog).
- There is **no pre-prompt / priming screen** explaining why notifications matter. The system dialog is the first and only ask.
- Failure string used in the internal error panel: `requestAndRegisterPushToken: 'בקשת הרשאת התראות נכשלה'` (`src/services/errorLog.ts:185`).

`joryio.identify(user.uid, { email, name })` fires from the auth-state listener the first time a user appears — `src/firebase/auth.ts:466-474`, with the rationale at `:450-455` (a day-one user used to spend the whole first session as an anonymous Joryio record).

---

### 8. Screen 6 — Post-sign-in profile (`PostSignInOnboardingScreen`)

- **File:** `/Users/matan/Projects/soccer/src/screens/onboarding/PostSignInOnboardingScreen.tsx`
- **Shown when:** `!isGuest && currentUser && !hasCompletedOnboarding` (`RootNavigator.tsx:267-269`), i.e. every newly-created Google / Apple / email account.
- **Skipped when:** guest (`isGuest`), or a returning account whose `/users/{uid}.onboardingCompleted === true`.
- **History:** the header comment (`:1-6`) records that this used to be **three** screens (welcome → how it works → profile) and was collapsed to one because "the user already saw the value pitch on the pre-sign-in slides; repeating it here just adds taps before the app actually starts working."
- **Layout:** blue gradient hero with rounded bottom corners, `HERO_GRADIENT = ['#1E3A8A', '#1E40AF', '#3B82F6']` (`:32`), 132dp live avatar preview pulled up onto the hero (`:152-161`), then a form card, then a bottom-pinned CTA bar (`:221-235`).

#### Strings, verbatim

| Element | Value | he.ts | Rendered |
|---|---|---|---|
| Hero title | `psoProfileTitle: 'בוא נכיר'` | `:2839` | `:142` |
| Hero subtitle | `psoWelcomeBody: 'מארגנים כדורגל שכונתי בלי בלגן — הרשמה, ספסל, קבוצות, שוערים וטיימר.'` | `:2808-2809` | `:143` |
| Name field label | `profileName: 'שם'` | `:1847` | `:165` |
| Name placeholder | `profileNamePlaceholder: 'איך לקרוא לך?'` | `:1848` | `:168` |
| Photo section label | `profilePhotoLabel: 'תמונת השחקן'` | `:2810` | `:174` |
| Upload button | `profilePhotoUpload: 'העלאה מהגלריה'` | `:2811` | `:188` |
| Upload button after a photo is set | `profilePhotoChange: 'החלף תמונה'` | `:2812` | `:188` |
| Avatar grid label | `profileAvatarLabel: 'או בחר אווטאר'` | `:2813` | `:192` |
| CTA | `psoProfileSave: 'המשך'` | `:2840` | `:233` |

Note `psoWelcomeBody` is a **value pitch repeated after sign-up**, and it is worded in a different register (`'מארגנים'` — impersonal plural) from the hero title above it (`'בוא נכיר'` — masculine singular).

The user's email is shown as a small centred caption when present: `{user?.email ? <Text style={styles.email}>{user.email}</Text> : null}` (`:217`).

#### Controls

1. **Name `InputField`** (`:164-172`) — `maxLength={40}`, `icon="person-outline"`, `required` (`:171`). The `required` prop renders a **red asterisk** next to the label (`src/components/InputField.tsx:53-56`, `:103-109`). Pre-filled from `user?.name` (`:40`) — populated for Google (`userService.ts:183`) and usually for a first-time Apple authorization (`userService.ts:234`), **empty for email sign-up** (`userService.ts:322`).
2. **`'העלאה מהגלריה'`** (`:175-190`) → `handlePickPhoto` (`:63-96`) → `pickAndUploadAvatar(user.id)` (`src/services/photoService.ts`). This is where the **photo-library permission dialog** fires: `ImagePicker.requestMediaLibraryPermissionsAsync()` at `src/services/photoService.ts:123`, then `launchImageLibraryAsync` at `:131`. iOS prompt copy comes from `app.json` → `expo.ios.infoPlist.NSPhotoLibraryUsageDescription: "Teamder מבקשת גישה לתמונות שלך כדי שתוכל להעלות אווטאר אישי או תמונת קאבר לקהילה שלך."` (a camera string also exists: `NSCameraUsageDescription: "Teamder מבקשת גישה למצלמה כדי לצלם אווטאר אישי בלי לעזוב את האפליקציה."`).
3. **Avatar grid** (`:193-215`) — 24 procedurally-rendered avatars from `AVATARS` in `/Users/matan/Projects/soccer/src/data/avatars.ts:23-55` (coloured circle + emoji glyph: `⚽ 🏆 🎽 🥅`, then skin-tone/hair/age variants `👨🏻 👩🏻 … 🧓`). Selection ring `avatarCellActive` (`:336-338`). One is **pre-selected at random** on mount: `user?.avatarId ?? (user ? pickRandomAvatarId() : undefined)` (`:48-50`), and the sign-in services also assign a random `avatarId` at doc creation (`userService.ts:185, :236, :281, :324`).
4. Picking a photo clears the avatar (`:94`); picking an avatar clears the photo and best-effort deletes the uploaded file (`:99-106`).
5. **`'המשך'` CTA** (`:222-234`) — `disabled={!canSave}` where `canSave = name.trim().length > 0 && !busy && !uploading` (`:61`). Dimmed to `opacity: 0.5` (`:228`). `handleSave` (`:113-131`) → `completePostSignInOnboarding({ name, avatarId: photoUrl ? undefined : avatarId, photoUrl })` → `userService.completeOnboarding` → `logEvent(ProfileCreated)` + `logEvent(OnboardingCompleted)` (`src/store/userStore.ts:253-258`).

#### Required vs skippable
- **A name is required.** There is no skip link, no "later", no back chevron, no header at all. This screen is a hard gate.
- Android hardware back: no stack to pop and not on a tab → "press again to exit" then the app closes. **Backing out of this screen means leaving the app with an account that is signed in but has `onboardingCompleted: false`** — the next launch lands right back here.
- Photo and avatar are both optional (an avatar is pre-selected anyway).

#### Error states
- Photo cancelled or permission denied → **silent**, no dialog. Only analytics: `PhotoUploadAbandoned { source: 'onboarding', reason: 'permission_denied' | 'cancelled' }` (`:74-77`). The comment at `:69-72` says this is deliberate, per App Store guideline 5.1.1(iv) — never nag after a denial.
  - Note: `profilePhotoPermissionDenied: 'אין הרשאה לגישה לגלריה. אפשר לאשר בהגדרות הטלפון.'` exists in `he.ts:2814-2815` but is **not** shown on this screen.
- `reason === 'network'` → `appAlert(he.error, he.profilePhotoUploadFailed)` where `profilePhotoUploadFailed: 'העלאת התמונה נכשלה. נסה שוב.'` (`he.ts:2816`), at `:84-85`.
- `reason === 'unavailable'` → `profilePhotoUnavailable: 'בחירת תמונה לא זמינה כרגע. בחר אווטאר מוכן בינתיים.'` (`he.ts:2818-2819`), at `:86-87`.
- Save failure → `appAlert(he.error, he.signInFailed)` — i.e. **`'ההתחברות נכשלה. נסה שוב.'`, a sign-in message shown for a profile-save failure** (`:127`). Analytics `ProfileSaveFailed { source: 'post_signin_onboarding', code }` (`:123-126`).

---

### 9. Screen 7 (effectively unreachable for new users) — `ProfileSetupScreen`

- **File:** `/Users/matan/Projects/soccer/src/screens/auth/ProfileSetupScreen.tsx`. Registered at `src/navigation/AuthStack.tsx:26`.
- **Shown when:** `!isGuest && !profileComplete` — but only **after** the `!hasCompletedOnboarding` check has already passed (`RootNavigator.tsx:267` runs before `:271`). Since `completePostSignInOnboarding` can only be reached with a non-empty name (`PostSignInOnboardingScreen.tsx:61`), a newly-created account can never land here. It is reachable only by a grandfathered account that has `onboardingCompleted === true` **and** an empty `name` — e.g. a pre-existing user whose name was later cleared.
- **Strings:**
  - Title `profileTitle: 'בוא נכיר'` (`he.ts:1846`) — rendered `:69`. Identical copy to the post-sign-in hero.
  - Name label `profileName: 'שם'` (`he.ts:1847`) — `:77`
  - Placeholder `profileNamePlaceholder: 'איך לקרוא לך?'` (`he.ts:1848`) — `:80`
  - CTA `profileSave: 'שמור והמשך'` (`he.ts:1850`) — `:93`
  - Unused here but adjacent in `he.ts`: `profileNameRequired: 'שם הוא שדה חובה'` (`:1849`)
- **Layout:** `ScreenContainer` → centred `PlayerIdentity` preview card (`:71-73`) → name `InputField` with `required` and `maxLength={40}` (`:76-88`) → bottom `Button` (`:92-100`). `returnKeyType="done"` submits (`:84-87`).
- **Errors** (`:28-55`): `RESERVED_NAME` → `officialNameTaken: 'השם הזה שמור לחשבון הרשמי של Teamder. בחרו שם אחר.'` (`he.ts:640-641`); `EMAIL_NAME` → `emailNameNotAllowed: 'כתובת אימייל היא לא שם. איך קוראים לכם?'` (`he.ts:642-643`); otherwise `profileSaveError: 'לא הצלחנו לשמור את הפרטים. בדוק את החיבור ונסה שוב.'` (`he.ts:189`). Analytics `ProfileSaveFailed { source: 'profile_setup', code }` (`:41`).
  - **Note:** these two reserved-name errors are enforced on `ProfileSetupScreen` but the `PostSignInOnboardingScreen` save path shows only `he.signInFailed` (`PostSignInOnboardingScreen.tsx:127`) for the same underlying failures.
- **No back, no skip.** Hard gate, same as §8.

---

### 10. Overlays that can appear during any of the above

Mounted in `App.tsx`'s render tree (`:920-1054`) and therefore able to cover a first-run screen.

| Overlay | Mount | Active condition | Copy |
|---|---|---|---|
| `MockModeBanner` | `App.tsx:970` | dev/mock only, renders nothing in prod (`App.tsx:962-963`) | — |
| `AnnouncementBanner` | `App.tsx:971` | Remote Config `announcement_enabled` + non-empty `announcement_text` (`src/components/RemoteGates.tsx:35-67`) | server-authored `announcement_text`; dismissible ✕ (`:61-63`) |
| **Force update modal** | `App.tsx:1015-1017` | `splashDone && updateKind === 'force'` | title `updateForceTitle: 'נדרש עדכון'` (`he.ts:151`), body `updateForceBody: 'יש גרסה חדשה לאפליקציה. חובה לעדכן כדי להמשיך להשתמש.'` (`he.ts:152`), single CTA `updateNow: 'עדכן עכשיו'` (`he.ts:155`). **Not dismissible** — `onRequestClose={() => {}}` and backdrop press disabled (`src/components/UpdateModal.tsx:21, :25`). This can be the **first interactive thing a brand-new installer sees**, before the slides are even usable. |
| Optional update modal | `App.tsx:1018-1032` | `splashDone && updateKind === 'optional'` | `updateOptionalTitle: 'גרסה חדשה זמינה'` (`he.ts:153`), `updateOptionalBody: 'יש גרסה חדשה זמינה לאפליקציה.'` (`he.ts:154`), buttons `updateLater: 'אולי אחר כך'` (`he.ts:156`) + `updateNow: 'עדכן עכשיו'`. Dismissal snoozes 24h via `OPTIONAL_UPDATE_SNOOZE_KEY` (`App.tsx:300-301, :1025-1028`). |
| `MaintenanceGate` | `App.tsx:1036` | Remote Config `maintenance_mode` | full-screen blocking; title `'בתחזוקה'` hardcoded at `src/components/RemoteGates.tsx:28`; default body `'אנחנו עורכים תחזוקה קצרה ונחזור עוד מעט. תודה על הסבלנות 🙏'` at `:17-18`, overridable by `maintenance_message`. |
| `CampaignGate` | `App.tsx:1040` | `splashDone && updateKind === 'none' && !!currentUserId` — **no onboarding gate**, so it can fire while the user is still on the post-sign-in profile screen. 1200ms delay after becoming active (`src/components/CampaignGate.tsx:38-49`). | Pulse-authored `popupTitle` / `popupBody`; default button text `'הבנתי'` (`CampaignGate.tsx:80`). |
| **`WhatsNewGate`** | `App.tsx:1044-1051` | `splashDone && updateKind === 'none' && !!currentUserId && onboardingComplete` | On a **fresh install** `seen` is `null`, so `resolveWhatsNew` falls into the `baseline === null` branch and surfaces **the current version's highlights** (`src/services/whatsNewService.ts:78-84`). A brand-new user who has just finished signing up can therefore be shown a "what's new in this version" modal for a version they have never not had. The comment at `:72-77` acknowledges the fresh-install case explicitly. |
| `ScreenshotReportSheet` | `App.tsx:982` | **testers only** — `if (!isTester) return;` (`src/components/ScreenshotReportSheet.tsx:88-91`). Not part of a normal new user's run. | `screenshotReportTitle: 'צילמת מסך — לדווח על באג?'` (`he.ts:1751`) |
| `InAppMessageHost` (Joryio) | `App.tsx:986` | inside the navigator, so Joryio in-app campaigns can render at any point | server-authored |
| `BannerAd` | in the tab bar, `src/navigation/MainTabs.tsx:56-68` | gated only by `EXPO_PUBLIC_ADMOB_ENABLED` (`src/services/adsService.ts:123`), the Pulse master switch, and RC `banner_enabled` (`adsService.ts:516-519`) — **no new-user grace** | An ad banner is present on the home screen from the account's first second. The app-open ad, by contrast, *does* have a new-user grace: `Date.now() - opts.accountCreatedAt < rcNumber('app_open_new_user_grace_ms')` (`adsService.ts:442-443`). |

---

### 11. Screen 8 — the landing screen (`MainTabs` → "בית")

- **File:** `/Users/matan/Projects/soccer/src/navigation/MainTabs.tsx`, `initialRouteName="ProfileTab"` (`:91`), root screen `Profile` = `/Users/matan/Projects/soccer/src/screens/tabs/ProfileScreen.tsx` (`src/navigation/ProfileStack.tsx:16, :132`).
- Tab labels, right-to-left order (`MainTabs.tsx:30-32` explains index 0 = rightmost under RTL):
  - `tabHome: 'בית'` — `he.ts:2887`, used `MainTabs.tsx:129`
  - `tabCommunities: 'מועדונים'` — `he.ts:1273`, used `:137`
  - `tabGame: 'מחזורים'` — `he.ts:2885`, used `:150`
  - `tabChat: "צ'אטים"` — `he.ts:4049`, used `:159`
- **First thing a new account sees on this screen:** a time-based greeting (`greetingMorning: 'בוקר טוב'` `he.ts:3073`, `greetingNoon: 'צהריים טובים'` `:3074`, `greetingEvening: 'ערב טוב'` `:3075`, `greetingNight: 'לילה טוב'` `:3076`; used `ProfileScreen.tsx:787-790`), plus the **activation checklist** (`ProfileScreen.tsx:1366-1371`, rendered while `homeDataReady && !checklistComplete`).
- Checklist card (`/Users/matan/Projects/soccer/src/components/home/OnboardingChecklist.tsx:73-77`):
  - `homeChecklistTitle: 'בוא נתחיל'` + a `⚡` appended in JSX (`OnboardingChecklist.tsx:74-76`) — `he.ts:1990`
  - `homeChecklistSubtitle: 'כמה צעדים קטנים כדי להפיק את המקסימום'` — `he.ts:1991`
  - progress ring `${done}/${total}` (`:62`)
- The five steps (`ProfileScreen.tsx:641-710`), each tappable:
  1. `homeStepPhoto: 'הוספת תמונת פרופיל'` (`he.ts:1992`, `ProfileScreen.tsx:644`) → `ProfileEdit`. Done when `user.photoUrl` — **an avatar does not count**, so a user who picked an avatar on the post-sign-in screen still sees this step undone.
  2. `homeStepAvailability: 'סמן מתי אתה פנוי'` (`he.ts:1993`, `:657`) → `AvailabilityEdit`
  3. `homeStepCommunity: 'הצטרף או פתח מועדון'` (`he.ts:1994`, `:670`) → `CommunitiesTab`
  4. `homeStepGame: 'הצטרף או צור מחזור ראשון'` (`he.ts:1995`, `:683`) → `GameTab`
  5. `homeStepInvite: 'הבא חבר למגרש'` (`he.ts:1996`, `:696`) → share sheet; done only when someone actually joined via the link (`:698-701`)
- `homeStepPosition: 'בחר עמדה מועדפת'` (`he.ts:1997`) exists but is **not** in the rendered list.
- Note the third repetition of the same phrase: `'בוא נכיר'` (post-sign-in hero, `he.ts:2839`), `'בוא נכיר'` (ProfileSetup title, `he.ts:1846`), `'בוא נתחיל'` (checklist, `he.ts:1990`) and `'בואו נתחיל'` (SignIn title, `he.ts:1793`).

---

### 12. The guest branch, and the wall it ends at

A guest reaches `MainTabs` in **one tap** from SignIn (`SignInScreen.tsx:256`, `RootNavigator.tsx:260`, `:279`). They have no `/users` doc (`userService.ts:56-60`) and no push token (`RootNavigator.tsx:240`).

The moment they try to do anything that needs an account, `ensureNotGuest` (`/Users/matan/Projects/soccer/src/utils/guestGate.ts:39-63`) shows a dialog:
- Title `guestRegisterTitle: 'נדרשת הרשמה'` (`he.ts:1801`)
- Body, context-specific:
  - default `guestRegisterBody: 'כדי להשתמש בתכונה הזו צריך חשבון. רוצה להירשם עכשיו?'` (`he.ts:1802`)
  - joining a game `guestRegisterJoinGame: 'כדי להירשם למחזור צריך חשבון. רוצה להירשם עכשיו?'` (`he.ts:1803`) — used at `src/screens/games/MatchDetailsScreen.tsx:907`
  - joining a club `guestRegisterJoinCommunity: 'כדי להצטרף למועדון צריך חשבון. רוצה להירשם עכשיו?'` (`he.ts:1804`)
  - messaging an admin `guestRegisterChatAdmin: 'כדי לשלוח הודעה למנהל צריך חשבון. רוצה להירשם עכשיו?'` (`he.ts:1805`)
  - creating `guestRegisterCreate: 'כדי ליצור צריך חשבון. רוצה להירשם עכשיו?'` (`he.ts:1806`)
  - chat `guestRegisterChat: 'כדי להשתמש בצ׳אט צריך חשבון. רוצה להירשם עכשיו?'` (`he.ts:1807`)
- Buttons: `cancel: 'בטל'` (`he.ts:52`) and `guestRegisterCta: 'הרשמה'` (`he.ts:1808`)
- Choosing `'הרשמה'` stashes the return target then calls `signOut()` (`guestGate.ts:51-58`), which **tears down the whole navigator and drops the user back on SignIn** — they then re-run §5 → §8. The stashed target is replayed by the pending-invite consumer in `RootNavigator.tsx:63-166` once the new account is ready.
- The profile tab also shows a standing guest card: `guestProfileTitle: 'הפרופיל שלך מחכה'` (`he.ts:1809`) + `guestProfileBody: 'אתה גולש כאורח. הירשם כדי לשמור מחזורים, להצטרף למועדונים ולבנות פרופיל שחקן.'` (`he.ts:1810-1811`) + `'הרשמה'` button — `ProfileScreen.tsx:1116-1119`.

---

### 13. Deep-link / install-attribution entry points that alter the first run

Cold start, in strict priority order (`App.tsx:537-577`):
1. `Linking.getInitialURL()` → `handleCold` (`:539-541`, handler `:436-458`)
2. existing stash in storage — if present, **stop**, skip 3 and 4 (`:545-547`)
3. Android Play Install Referrer — `consumeInstallReferrerIfFresh()` (`:552-553`, `src/services/installReferrerService.ts`)
4. iOS clipboard deferred deep link — `consumeClipboardInviteIfFresh()` (`:568-569`, `src/services/clipboardInviteService.ts`). Rationale at `App.tsx:562-567`: Apple has no install-referrer API, so the landing page copies the invite URL to the clipboard.

An invite-opened launch calls `adsService.noteIntentfulOpen()` to suppress the next app-open ad (`App.tsx:452, :488`). A campaign link `footy://open/<where>` with a `role` query param records the role via `recordRole` (`App.tsx:444, :478` → `src/services/roleService.ts:23-30` → `joryio.setAttributes({ user_type: role })`). The pending-destination consumer deliberately **does not wait on auth** — comment at `App.tsx:583-586`: "the role picker shows on a first run, and the tab it opens is reachable before a profile is complete."

The invite target itself is only navigated to once the user is signed in, profile-complete **and** onboarded (`RootNavigator.tsx:65`) — so an invited user still walks the full slides → sign-in → profile flow before reaching the game or club they tapped.

URL schemes / domains (`app.json`): `scheme: ["footy", "teamder", "com.studiogameslime.soccerapp"]`; iOS `associatedDomains: ["applinks:teamderfc.web.app"]`; Android verified App Links on `https://teamderfc.web.app` with `pathPrefix` `/session`, `/team`, `/app`. **There is no custom domain** — the only host is the Firebase Hosting default `teamderfc.web.app`, and it appears verbatim in the app's iOS entitlement and Android intent filter.

---

### 14. Tap-by-tap counts

"Tap" = one deliberate user action. System-UI taps (Google chooser, OS permission dialogs) are marked **[OS]** and counted separately so they can be excluded if the consultant prefers.

#### Branch A — Google, new user, no deep link (the likeliest Android path)

| # | Screen | Action |
|---|---|---|
| — | Native splash | wait (~instant) |
| — | Animated splash | wait ≥1.4s + 0.32s fade |
| 1 | Onboarding slide 1 | tap `'הבא'` (or swipe) |
| 2 | Onboarding slide 2 | tap `'הבא'` (or swipe) |
| 3 | Onboarding slide 3 | tap `'המשך'` |
| 4 | SignIn | tap `'המשך עם Google'` |
| **[OS]** | Google account chooser | tap the account (+ a Play Services update dialog if stale, `auth.ts:93-95`) |
| **[OS]** | Push permission dialog (fires over the next screen) | tap Allow / Don't allow |
| 5 | `'בוא נכיר'` | tap `'המשך'` (name already pre-filled from Google) |
| — | Animated splash again | wait for `groupHydrated` (`RootNavigator.tsx:274`) |
| — | `'בית'` | arrived |

**5 in-app taps, 2 OS taps, 0 text entries, 6 distinct screens** (2 splashes + 3 slides as one screen + sign-in + profile + home). Minimum path if the user taps `'דלג'` on slide 1: **3 in-app taps** (דלג → Google → המשך), 2 OS taps, 0 text entries.

#### Branch B — Email sign-up, new user

| # | Screen | Action |
|---|---|---|
| 1-3 | Onboarding | `'הבא'`, `'הבא'`, `'המשך'` |
| 4 | SignIn | tap `'המשך עם מייל'` |
| 5 | EmailAuth (opens in **sign-in** mode, `:45`) | tap `'אין לך חשבון? הרשמה'` |
| **T1** | | type email |
| **T2** | | type password (≥6) |
| **T3** | | re-type password |
| 6 | | tap `'הרשמה'` |
| **[OS]** | | push permission dialog |
| **T4** | `'בוא נכיר'` | type name (**empty** — `userService.ts:322`) |
| 7 | | tap `'המשך'` |
| — | | splash → `'בית'` |

**7 in-app taps, 1 OS tap, 4 text entries, 7 distinct screens.** Add 1 tap if the user also picks an avatar, 2+ taps and an **[OS]** photo-permission dialog if they upload a photo. Minimum with `'דלג'`: **5 in-app taps**, 4 text entries.

#### Branch C — Apple, new user, iOS

Same shape as A. `'המשך עם Apple'` at `SignInScreen.tsx:229` (iOS only, `:212`). The Apple sheet itself typically costs 1-2 **[OS]** interactions (share/hide email choice, then Face ID / Touch ID / password) — **not verified on device**. Name arrives from `fullName` on the *first* authorization only (`userService.ts:230-234`), so a re-authorizing user may land on `'בוא נכיר'` with an empty name and need 1 text entry.
**5 in-app taps, 2-3 OS taps, 0-1 text entries.**

#### Branch D — Guest

| # | Screen | Action |
|---|---|---|
| 1-3 | Onboarding | `'הבא'`, `'הבא'`, `'המשך'` |
| 4 | SignIn | tap `'המשך כאורח'` |
| — | | straight to `'בית'` |

**4 in-app taps, 0 OS taps, 0 text entries, 4 screens.** No push prompt (`RootNavigator.tsx:240`). But the account is not usable: the first attempt to join a game triggers the §12 wall, whose "register" path **signs them out** and restarts at SignIn — so the real cost of the guest path for a converting user is 4 taps + the dialog + the whole of Branch A or B again.

#### Branch E — returning user, already signed in

Splash → (optional `groupHydrated` splash) → `'בית'`. **0 taps.** A "מה חדש" modal may appear after a version bump (`App.tsx:1044-1051`).

#### Branch F — returning user after sign-out, same install

`onboardingDone` survives sign-out (`src/store/userStore.ts:164-187` never touches it; key at `src/services/storage.ts:7`), so the slides are skipped: Splash → SignIn → (provider) → `'בית'`. **1 in-app tap + 1 OS tap.** `onboardingCompleted` is already `true` on their `/users` doc, so `'בוא נכיר'` is skipped too.

#### Screen count summary

Distinct full screens a new Google user meets: **6** (native splash, animated splash, onboarding carousel, sign-in, post-sign-in profile, home) — 7 counting the second splash appearance separately. A new email user meets **7** (adds EmailAuth). A guest meets **4**.

---

### 15. Branches I did NOT check

Stated explicitly, per the brief:
- **Nothing was run on a device or emulator.** Every claim above is read from source. The exact rendering, the real ordering of the OS push dialog against the profile screen's first paint, and the exact Apple/Google system-sheet copy are **not** verified on hardware.
- I did not verify that the Play Install Referrer path or the iOS clipboard deferred-link path actually fire in a real store install — only that the code calls them and in what order (`App.tsx:552-576`).
- I did not read the landing pages (`public/index.html`, `public/get.html`, `public/invite.html`, `public/c/`, `public/downloads/`) — out of this surface.
- I did not enumerate `MainTabs` beyond the landing screen and the activation checklist.
- I did not check mock mode (`USE_MOCK_DATA`) behaviour beyond noting that every auth path short-circuits to `mockCurrentUser` (`userService.ts:168-172, :215-218, :264-268, :307-311`), which means **mock QA does not exercise any of the real first-run auth branches**.
- I did not verify the Remote Config defaults for `maintenance_mode`, `announcement_enabled`, `banner_enabled`, or `app_open_new_user_grace_ms` — only the code that reads them.
