# ארכיטקטורת היעד — Teamder

**דוח תכנון טכני · ממשיך את "מפת הכניסה"**

| | |
|---|---|
| נבדק מול הקוד | 24.09.2026 |
| ענף | `perf/firestore-read-costs` |
| שינויי קוד | **אפס** |

---

## התשובה לשאלה הקשה ביותר: אין מה למזג

החשש הגדול מ-`linkWithCredential` הוא תמיד מיזוג נתונים — מה קורה לעבודה שהמשתמש האנונימי כבר עשה. **אצלנו הוא לא קיים.**

אורח חסום היום מכל פעולה שכותבת נתונים: הצטרפות למשחק, הצטרפות למועדון, יצירת מועדון, יצירת מחזור, זמינות וצ'אט — כולן עוברות דרך `ensureNotGuest()` (8 אתרי קריאה). והוא גם לא מקבל מסמך `/users` — `buildGuestUser` בונה אובייקט זמן-ריצה בלבד.

כלומר **לחשבון האנונימי אין שום נכס**. כל מה שיש לו הוא מקומי למכשיר ולא תלוי ב-uid: הפעולה הממתינה והטיוטה. לכן גם המסלול הנכון (קישור) וגם מסלול הנפילה (התחברות רגילה) בטוחים באותה מידה מבחינת נתונים — ההבדל ביניהם הוא *חוויה*, לא סיכון.

---

## 1 · ארכיטקטורת היעד

הריפקטור לא מוסיף שכבה. הוא מרחיב מנגנון אחד שכבר קיים ועובד — הצרכן ב-`RootNavigator` — ומזיז שני שערים.

### המודולים החדשים (שלושה קבצים, כולם טהורים)

| קובץ | תפקיד |
|---|---|
| `src/services/pendingAction.ts` | קריאה/כתיבה/מחיקה של הפעולה הממתינה + מיגרציה מ-`PendingInvite`. עוטף את `storage.ts`. |
| `src/services/draftStore.ts` | שמירת טיוטות עם TTL. סלוט יחיד לכל סוג. לא יודע כלום על auth. |
| `src/utils/pendingActionMachine.ts` | מכונת המצבים כ-reducer טהור. **חייב להיות טהור** — `jest.config.js` מגדיר `testEnvironment: 'node'` ו-`roots: ['tests']`, כך שרק מודול בלי React ובלי Expo ניתן לבדיקה אוטומטית. |

### הקבצים הקיימים שזזים

| קובץ | מה משתנה |
|---|---|
| `src/navigation/RootNavigator.tsx` | שער `!currentUser` (255) → אתחול אורח שקט; שער `!onboardingDone` (253) יורד; הצרכן (57–166) מקבל טיפול בפעולות; אפקט ה-push (233–246) יוצא החוצה. |
| `src/utils/guestGate.ts` | `ensureNotGuest` מקבל `PendingAction`, מפסיק `signOut`, פותח bottom sheet. |
| `App.tsx` | `handleWarm` (471) בודק היום `isProfileComplete()` ולכן חוסם אורחים כמו הצרכן. **שני המקומות חייבים להשתנות יחד.** |
| `src/screens/groups/CreateGroupScreen.tsx` | ה-`submit` שלו (34) הוא שער השמירה. |
| `src/screens/games/GameCreateScreen.tsx` | אותו דבר ב-`submit` (397). |
| `src/services/notificationsService.ts` | `requestAndRegisterPushToken` (734) נשאר; רק מי שקורא לו משתנה. |

> ✅ **מה לא נוגעים בו:** `GroupWizardForm` ו-`GameWizardForm` לא משתנים. שניהם כבר מקבלים `initial` מבחוץ ומחזירים ערכים דרך `onSubmit(values)`. **אפס שינוי מבני בטפסים.**

### עקרון-על: צרכן אחד

היום יש בדיוק מקום אחד שמנווט אחרי auth, וזה מה שמונע לולאות הפניה (מתועד ב-`guestGate.ts:32`). **הארכיטקטורה החדשה חייבת לשמור על כך.** כל תוספת של מסלול ניווט מקביל היא הסיכון מספר אחת.

---

## 2 · דיאגרמת ניווט

### היום — `RootNavigator.tsx:250–279`

```
!userHydrated            → Splash
!onboardingDone          → OnboardingScreen      // 3 שקפים
!currentUser             → AuthStack(SignIn)     // ⛔ השער הקשיח
!isGuest && !onboarded   → PostSignInOnboarding
!isGuest && !profileOk   → AuthStack(ProfileSetup)
!groupHydrated           → Splash
                         → MainTabs
```

### אחרי

```
!userHydrated            → Splash
!currentUser             → ensureGuestSession() → Splash   // שקט, בלי מסך
!isGuest && !onboarded   → PostSignInOnboarding  // שם + avatar
!groupHydrated           → Splash
                         → MainTabs
```

- **חדש — אתחול אורח שקט.** במקום `AuthStack`, מפעיל `userService.signInAsGuest()` ומציג Splash. המשתמש לא רואה מסך התחברות ולא לוחץ "המשך כאורח".
- **יורד — `!onboardingDone → OnboardingScreen`.** **3 references בלבד**: `RootNavigator.tsx:14,35,253`. המסך והדגל נשארים בקוד (PR 6).
- **יורד — `!profileComplete → ProfileSetup`.** כפילות. `isProfileComplete()` (`userStore.ts:243`) בודק בדיוק "יש שם", ו-`PostSignInOnboardingScreen` כבר אוסף אותו.
- **נשאר — `PostSignInOnboardingScreen`.** שם + avatar, בלי עיר. לא נוגעים.

> ⚠️ **שער חדש שלא היה:** אחרי השינוי `currentUser` כמעט לעולם אינו null. **כל קוד שהסתמך על "אין משתמש = לא מחובר" משנה משמעות.** הביטוי הנכון מעתה הוא `currentUser.isGuest === true`. צריך לסרוק את כל אתרי `if (!user)` לפני PR 5 — במיוחד `CreateGroupScreen.tsx:35`.

---

## 3 · PendingAction

שתי החלטות מבניות:

- **הטיוטה לא יושבת בתוך `PendingAction`.** הפעולה נקראת בכל עלייה; הטיוטה לעיתים נדירות. מחזורי חיים שונים (פעולה = עד מימוש, טיוטה = 7 ימים). `PendingAction` מחזיק `draftId` בלבד.
- **הקישורים הקיימים הופכים לפעולות גם הם.** `session`/`team`/`app` → `open_game`/`open_club`/`open_invite` — צרכן אחד ולא שניים.

```ts
// src/services/pendingAction.ts

export const PENDING_ACTION_VERSION = 2;
// v1 = the legacy PendingInvite shape (no `version` field at all).

export interface AcquisitionTag {
  source?: string;
  campaign?: string;
  linkId?: string;
}

/** Where the intent was formed. Drives analytics, never navigation. */
export type ActionOrigin =
  | 'deep_link'           // Linking.getInitialURL / 'url' event
  | 'deferred_deep_link'  // install referrer (Android) / clipboard (iOS)
  | 'campaign'            // footy://open/<dest> — parseAppLink
  | 'in_app';             // the user tapped something inside the app

/** What the person was trying to do when they hit the wall. */
export type PendingActionKind =
  // Navigate-only. These are today's PendingInvite, renamed.
  | 'open_game' | 'open_club' | 'open_invite'
  // Act-on-a-target.
  | 'join_game' | 'join_club'
  // Act-on-a-draft.
  | 'create_club' | 'create_game' | 'save_availability';

interface Base {
  version: number;
  createdAt: number;
  origin: ActionOrigin;
  /** Referral credit. Read by applyInviteAttributionIfFresh. */
  invitedBy?: string;
  acquisition?: AcquisitionTag;
}

/** Kinds that name a document. `targetId` is REQUIRED by the type, so a
 *  consumer never has to null-check it. */
interface Targeted extends Base {
  kind: 'open_game' | 'open_club' | 'join_game' | 'join_club';
  targetId: string;
}

/** Kinds that carry work in progress. The draft lives in draftStore;
 *  this only points at it, so the stash stays a few hundred bytes. */
interface Drafted extends Base {
  kind: 'create_club' | 'create_game' | 'save_availability';
  draftId: string;
  /** create_game inside a club — the club the draft belongs to. */
  targetId?: string;
}

/** A personal invite: an inviter, no target, no draft. */
interface Bare extends Base {
  kind: 'open_invite';
}

export type PendingAction = Targeted | Drafted | Bare;
```

### מיגרציה

המפתח החדש הוא `footy.pending.action`. הישן `footy.invite.pending` נקרא פעם אחת, מומר, ונמחק.

```ts
function fromLegacy(p: PendingInvite): PendingAction {
  const base = {
    version: PENDING_ACTION_VERSION,
    createdAt: Date.now(),   // the legacy shape has no timestamp
    origin: 'deep_link' as const,
    invitedBy: p.invitedBy,
    acquisition: (p.source || p.campaign || p.linkId)
      ? { source: p.source, campaign: p.campaign, linkId: p.linkId }
      : undefined,
  };
  if (p.type === 'session') return { ...base, kind: 'open_game', targetId: p.id };
  if (p.type === 'team')    return { ...base, kind: 'open_club', targetId: p.id };
  return { ...base, kind: 'open_invite' };
}
```

> ⛔ **מלכודת — שני קוראים נסתרים**
>
> `applyInviteAttributionIfFresh` (`userService.ts:1011`) ו-`applyAcquisitionIfFresh` (`:1052`) קוראים **ישירות** ל-`storage.getPendingInvite()` וכותבים `invitedBy / invitedByType / invitedByTargetId`. שתיהן רצות בכל התחברות. אם המפתח נעלם מתחתן — **כל הייחוס של ההזמנות מת בשקט**, בלי שגיאה.
>
> **הפתרון:** להשאיר את `storage.getPendingInvite()` כתצוגת תאימות נגזרת — `toLegacyInvite(readPendingAction())` — כך ששתיהן ממשיכות לעבוד בלי שינוי ב-PR הראשון.
>
> בדקתי גם את חוקי Firestore: `firestore.rules:455–463` דורש ש-`invitedByType` יהיה *קיים*, לא ערך מסוים. אז שמות ה-kind לא ישברו את הכתיבה — אבל `invitedByType` צריך להמשיך לקבל את סוג הקישור, לא את שם הפעולה.

---

## 4 · שמירת טיוטות

שני הטפסים מחזירים אובייקטים קטנים:

- `GroupFormValues` (`GroupWizardForm.tsx:57–95`) — 14 שדות + אובייקט `seasons`. **~1KB**.
- `GameFormValues` (`GameWizardForm.tsx:112+`) — פרימיטיבים + `coords` + `ruleTags`. **~2KB**.

שניהם קטנים מספיק. ההפרדה מ-`PendingAction` נכונה מטעמי מחזור חיים, לא גודל.

```ts
// src/services/draftStore.ts

export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type DraftKind = 'club' | 'game' | 'availability';

export interface Draft<T> {
  id: string;
  kind: DraftKind;
  values: T;
  createdAt: number;
  updatedAt: number;
  /** The app version that wrote it. A draft written by an older build may
      have a different field set — the restorer merges onto the CURRENT
      EMPTY_*_FORM_VALUES rather than trusting the stored object whole. */
  appVersion: string;
}

// Key: `footy.draft.<kind>` — ONE slot per kind.
// A person creates one club at a time. A single slot removes an entire
// class of problems: unbounded growth, a "which draft?" picker, and
// orphan rows nothing ever cleans.
```

### שחזור — שלוש ולידציות

1. **תפוגה.** `now - updatedAt > DRAFT_TTL_MS` → מחיקה שקטה + `draft_expired`.
2. **מיזוג על ברירות המחדל.** `{ ...EMPTY_GROUP_FORM_VALUES, ...draft.values }` — לא להעביר את האובייקט השמור כמו שהוא.
3. **`startsAt` בעבר.** `GameFormValues.startsAt` הוא חותמת זמן מוחלטת. טיוטה בת 5 ימים תשוחזר עם מועד שעבר. **לאפס את השדה הזה** ולהשאיר את השאר.

### מתי כותבים

לא בכל הקלדה. **רק בלחיצה על שמירה** — באותו רגע שבו מתגלה שצריך auth. מכסה את כל התרחישים בלי לכתוב ל-AsyncStorage בכל תו.

### ניקוי

| מתי | מה קורה | איפה |
|---|---|---|
| **הצלחה** | טיוטה + פעולה נמחקות מיד אחרי ש-`createGroup` החזיר id | `CreateGroupScreen.tsx:79` |
| **ויתור מפורש** | "התחל מחדש" → מחיקה + `draft_discarded` | רכיב ההצעה החדש |
| **תפוגה** | נמחקת בקריאה הראשונה אחרי 7 ימים. אין sweep ואין טיימר | `draftStore.read()` |

> **"לא לפתוח את הטופס בכוח":** ההצעה היא **banner בבית**, לא ניווט. חריג אחד — כשהמשתמש חוזר *דרך אותה פעולה ממתינה* באותו מסע auth, שם כן פותחים ישירות. ההבחנה בקוד: `PendingAction` עם `draftId` תואם ← פתיחה; טיוטה בלי פעולה ← banner.

---

## 5 · אנונימי ← מזוהה

### ההמלצה: היברידי — נסה לקשר, תיפול להתחברות

**מה יש היום:** בדקתי את כל `src/firebase/auth.ts` (554 שורות): **`linkWithCredential` לא מופיע בשום מקום**. כל ארבעת הספקים עושים `signInWithCredential`. יש גם פרט שחייבים להכיר — האפליקציה מחזיקה **שתי סשנים במקביל**: ה-JS SDK הראשי, ו-`mirrorToNativeAuth` (`auth.ts:252`) שמשכפל ל-`@react-native-firebase/auth` עבור הווידג'ט והשעון.

### מצב א' — הספק עדיין לא שייך לאף חשבון

1. מקבלים credential מהספק — בדיוק כמו היום.
2. **`linkWithCredential(anonUser, credential)`** מצליח. **אותו uid נשמר.** הסשן לא נופל, העץ לא מתחלף, המסך לא מתפרק.
3. `mirrorToNativeAuth(...)` נקרא כמו היום. הסשן הנייטיב נפרד, אז הקישור לא משנה לו דבר.
4. `getCurrentUser()` (`userService.ts:74`) כבר יודע ליצור מסמך חסר — הוא ייצור אותו עם ה-uid שהיה אנונימי.

### מצב ב' — הספק כבר שייך למשתמש קיים

1. `linkWithCredential` זורק `auth/credential-already-in-use` או `auth/email-already-in-use`. **Firebase מחזיר את ה-credential על אובייקט השגיאה.**
2. `signInWithCredential(credential)` — המשתמש הקיים נכנס. ה-uid האנונימי ננטש. **אין מה למזג.**
3. הפעולה והטיוטה שורדות (AsyncStorage, לא תלוי uid). הסשן מתחלף, המסך מתפרק — וזה בדיוק מה שה-`PendingAction` קיים בשבילו.
4. ה-uid האנונימי נשאר יתום ב-Auth — בלי מסמך `/users`, **לא ישות עסקית**.

### למה היברידי

| | רק `signOut` (היום) | רק `link` | היברידי |
|---|---|---|---|
| משתמש חדש — הקשר נשמר | ❌ העץ מתחלף תמיד | ✅ | ✅ |
| משתמש קיים | ✅ | ❌ credential-already-in-use | ✅ |
| סיכון לנתונים | אין | אין | אין |
| חשבונות יתומים | כולם | אפס | רק במצב ב' |
| מורכבות | אפס | נמוכה | `try/catch` אחד |

**ההמלצה:** פונקציה אחת חדשה ב-`src/firebase/auth.ts` — `upgradeAnonymous(credential)` — שעוטפת את ה-try/catch, ושלושת הספקים קוראים לה כשהמשתמש הנוכחי אנונימי. ~30 שורות בקובץ אחד.

> ⚠️ **שלוש נקודות לטיפול בבנייה**
>
> **א. `EmailRegisteredWithProviderError`.** המסלול הקיים (`auth.ts:139,181`) מזהה מייל שרשום אצל Google/Apple ומכוון לכפתור הנכון. ה-bottom sheet חייב לשמר אותו.
>
> **ב. הסשן הנייטיב.** `signOutFirebase` (`auth.ts:414`) מנתק גם את הנייטיב. במצב ב' זה לא קורה. לוודא ש-`mirrorToNativeAuth` נקרא בשני המסלולים.
>
> **ג. ניקוי היתומים.** אחרי `signInWithCredential` החשבון האנונימי כבר אינו `currentUser` ולכן **אי אפשר למחוק אותו** — רק לפני. שאלה 3 בסעיף 14.

### ההשלכות של סשן אורח אוטומטי לכולם

> ⛔ **1 · חוקי Firestore — הממצא המשמעותי**
>
> `isSignedIn()` מוגדר `request.auth != null` (`firestore.rules:28`). **אין שום כלל שמבחין בין אנונימי למזוהה** — `firebase.sign_in_provider` לא מופיע בקובץ אפילו פעם אחת.
>
> 11 כללים נשענים על `isSignedIn()` בלבד, וביניהם `/users/{uid}` קריאה (`:408`) — **כל מי שמחובר קורא כל מסמך משתמש** — וכן `/groupsPublic` (`:818`), `/rounds` (`:1641`), `/playerStats` (`:1663`), `/ratings` (`:1817`).
>
> זו **חשיפה קיימת ולא חדשה** — כל מי שלוחץ "המשך כאורח" כבר נהנה ממנה. אבל הריפקטור הופך אותה מ"מי שבחר" ל"כל מי שפותח את האפליקציה". **כל שינוי כזה חייב מבחן שמריץ את השאילתה האמיתית** — ראו `tests/rules/gameListRegression.test.mjs` והתקלה מ-22.09.

- **2 · מגבלות קצב.** `enforceRateLimit(userId, …)` (`groupService.ts:775`) היא לפי uid. uid אנונימי טרי מאפס כל מונה.
- **3 · Firebase Analytics.** כל סשן אנונימי נספר כמשתמש. **מדדי ה-DAU/MAU יקפצו** ביום השחרור בלי שקרה דבר אמיתי.
- **4 · תמחור.** Firebase Auth הבסיסי לא מחייב לפי משתמש; Identity Platform כן. **לאמת בקונסולה באיזו רמה הפרויקט** לפני שחרור.

### רצף המדידה — ממצא שמשנה את סעיף 7

> ⛔ **איפה הרצף נשבר היום**
>
> `waitForAuthRestore` (`auth.ts:442–480`) קורא ל-`joryio.identify(user.uid)` על **הפליטה הראשונה** של `onAuthStateChanged` — ואז עושה `unsub()`.
>
> במסלול אורח: אנונימי נכנס ← `identify(ANON_UID)` ← המאזין מתנתק. אחר כך נרשם עם Google ← **אין identify שני באותו סשן**. בעלייה הבאה `identify(REAL_UID)`. סך הכול: **שתי רשומות אדם ב-Joryio**, אחת זבל, בלי קשר ביניהן.

> ✅ **התיקון — ואיך alias באמת עובד**
>
> בדקתי את ה-SDK בשני הצדדים (`vendor/joryio/`), וההתנהגות **לא סימטרית**:
>
> - **אנדרואיד** — `Joryio.kt:467` שולח `IdentifyRequest(userId, anonymousId, attributes)`. ה-anonymousId נכלל, השרת תופר לבד.
> - **iOS** — `JoryioSDK.swift:425` שולח `IdentifyRequest(userId: userId, attributes: [:])`. **ל-`IdentifyRequest` ב-iOS אין שדה `anonymousId` בכלל** (`Models/User.swift:23–31`), ואין header גלובלי שמוסיף אותו. **ב-iOS identify לבדו אינו תופר כלום.**
>
> `alias(userId)` כן קיים ומחווט מקצה לקצה בשתי הפלטפורמות — `index.ts:407` ב-RN, `JoryioModule.kt:113` + `JoryioModule.swift:124` בגשרים, `Joryio.kt:500` + `JoryioSDK.swift:459` בנייטיב — ושניהם שולחים `AliasRequest(anonymousId, userId)` ל-`v1/alias`. **הוא פשוט לא עטוף ב-`src/services/joryio.ts` ולא נקרא אף פעם.**
>
> **לכן שלושה תיקונים קטנים ולא "מערכת alias":**
> 1. לא לקרוא ל-`identify` על משתמש אנונימי — להשאיר את ה-SDK אנונימי כך שהאירועים נצברים על ה-anonymousId.
> 2. להסיר את ה-`unsub()` המוקדם כך שהתחברות מאוחרת באותו סשן כן מזוהה.
> 3. לחשוף `alias` ולקרוא לו *לפני* `identify` ברגע ההתחברות — זה מה שסוגר את הפער ב-iOS.

---

## 6 · מכונת מצבים

המכונה יושבת ב-`src/utils/pendingActionMachine.ts` כ-reducer טהור. זו לא בחירת סגנון — `jest.config.js` מגדיר `testEnvironment: 'node'`, כך שמודול שמייבא React Native או Expo נכשל לפני שרץ מקרה אחד. `src/utils/appLinks.ts` נבנה בדיוק כך ומכוסה ב-`tests/logic/appLinks.test.ts`.

```ts
export type MachineState =
  | 'ANONYMOUS_BROWSING'
  | 'ACTION_REQUESTED'
  | 'AUTH_REQUIRED'
  | 'AUTH_IN_PROGRESS'
  | 'PROFILE_REQUIRED'
  | 'RESUMING_ACTION'
  | 'SUCCESS'
  | 'FAILURE';
```

### המעברים

| ממצב | אירוע | למצב | תופעת לוואי |
|---|---|---|---|
| ANONYMOUS_BROWSING | `ACTION_TAPPED` | ACTION_REQUESTED | — |
| ACTION_REQUESTED | `IS_GUEST` | AUTH_REQUIRED | כתיבת טיוטה + `PendingAction` |
| ACTION_REQUESTED | `IS_AUTHED` | RESUMING_ACTION | — |
| AUTH_REQUIRED | `PROVIDER_PICKED` | AUTH_IN_PROGRESS | `auth_method_selected` |
| AUTH_IN_PROGRESS | `AUTH_OK` + חדש | PROFILE_REQUIRED | — |
| AUTH_IN_PROGRESS | `AUTH_OK` + קיים | RESUMING_ACTION | — |
| PROFILE_REQUIRED | `PROFILE_OK` | RESUMING_ACTION | — |
| RESUMING_ACTION | `RESUME_OK` | SUCCESS | מחיקת טיוטה + פעולה |
| RESUMING_ACTION | `RESUME_FAILED` | FAILURE | ראו הטבלה למטה |

### תשעת מקרי הקצה

| מקרה | מצב תוצאה | פעולה | טיוטה | מה המשתמש רואה |
|---|---|---|---|---|
| **auth בוטל** | ANONYMOUS_BROWSING | ✅ נשמרת | ✅ נשמרת | חוזר למסך המקור, בלי הודעה. ביטול הוא תשובה לגיטימית |
| **כשל ספק** | AUTH_REQUIRED | ✅ | ✅ | ה-sheet נשאר פתוח עם שגיאה. `auth_failed` עם `code` |
| **האפליקציה נהרגה** | נטען מחדש | ✅ | ✅ | יש פעולה → ממשיכים; רק טיוטה → banner |
| **היעד נמחק** | FAILURE | ❌ נמחקת | — | `'הקישור לא תקין או שהפריט כבר לא קיים'` — קיים ב-`RootNavigator.tsx:97–130` |
| **המשחק התמלא** | SUCCESS | ❌ | — | **לא כישלון.** `joinGameV2` מחזיר `{bucket:'waitlist'}` — תוצאה תקפה |
| **אין רשת** | AUTH_REQUIRED / RESUMING | ✅ | ✅ | ניסיון חוזר ידני. **לא למחוק** — המקרה היחיד שבו מחיקה היא באג |
| **חשבון קיים** | RESUMING_ACTION | ✅ | ✅ | מדלגים על PROFILE_REQUIRED |
| **הטיוטה פגה** | FAILURE | ❌ | ❌ | טופס ריק + הודעה. `draft_expired` |
| **היעד חסום** | SUCCESS | ❌ | — | מנווטים בכל זאת. הקוד כבר מבחין בין `ACCESS_BLOCKED` ל"לא קיים" (`RootNavigator.tsx:109–112`) |

> **קודי הכישלון כבר קיימים:** `joinGameV2` מגדיר רשימה סגורה (`gameService.ts:5740–5751`): `GAME_OVERLAP`, `REGISTRATION_CONFLICT`, `GAME_NOT_OPEN`, `GAME_STARTED`, `GAME_LIVE`, `GAME_JOIN_REJECTED`, `GROUP_FULL`, `STALE_OFFER`, `resource-exhausted`. **אלה ענפי ה-FAILURE** — רק למפות כל אחד להודעה.

---

## 7 · מדידה — 15 חדשים, לא 40

ספרתי את הקבועים ב-`src/services/analyticsService.ts`: **275**. הקונבנציה עקבית — `snake_case`, **ישות קודם ואז פועל בעבר**: `group_created`, `game_joined`, `sign_in_failed`. **לא** פועל-קודם כמו `create_club_started`.

שתי התאמות נוספות: המילה במאגר היא **`group` / `community`**, אף פעם לא `club`; והתחברות היא **`sign_in_*`**, לא `auth_*`.

> ✅ **הממצא המרכזי:** רוב המשפך **כבר קיים** ומדווח. בדוח הראשון כתבתי "1 מתוך 13" — נכון לשמות שהצעת מילה-במילה, לא לכיסוי בפועל. אחרי מיפוי מלא: **מתוך 40 הנקודות ברשימה, 25 כבר מדווחות** תחת שם אחר. צריך להוסיף 15.

### קיים — להשתמש, לא לשכפל

| ביקשת | הקבוע הקיים |
|---|---|
| `app_entry` | `SplashCompleted` · `AppForegrounded` |
| `deep_link_received` | `InviteLinkOpened` · `PublicPageDeepLinkOpened` |
| `create_club_started` | `CommunityCreateStarted` · `CommunityWizardStepCompleted` |
| `club_created` | `GroupCreated` |
| `club_creation_failed` | `GroupCreateFailed` (כבר עם `code` + `platform`) |
| `create_game_started` | `GameCreateStarted` |
| `game_created` | `GameCreated` |
| `game_creation_failed` | `GameWizardSubmitFailed` · `GameSaveBlocked` |
| `club_share_clicked` | `InviteShared` · `InviteShareCompleted` |
| `auth_method_selected` | `SignInAttempted` |
| `auth_completed` | `SignInSuccess` |
| `auth_cancelled` | `SignInCancelled` |
| `auth_failed` | `SignInFailed` · `SignInProviderConflict` |
| `auth_prompt_shown` | `GuestGateBlocked` · `GuestRegisterCtaTapped` |
| `profile_confirmed` | `ProfileCreated` · `OnboardingCompleted` |
| `game_join_completed` | `GameJoined` (כבר עם `bucket` + `source`) |
| `game_join_waitlisted` | `WaitlistJoined` |
| `club_join_clicked` | `GroupJoinRequested` |
| `club_join_completed` | `GroupJoined` · `GroupJoinFailed` |
| `availability_started` | `AvailabilityWeekOpened` |
| `availability_saved` | `AvailabilitySet` |

### חדש — 15 קבועים

| שם | טריגר | פרמטרים | תפקיד במשפך |
|---|---|---|---|
| `guest_session_started` | `signInAsGuest` הצליח באתחול השקט | `origin` | מכנה משותף — כל התקנה |
| `entry_source_resolved` | אחרי שכל 3 מקורות הקישור נבדקו (`App.tsx:539`) | `source`: `cold_link`/`stash`/`referrer`/`clipboard`/`none` | מפריד אורגני מקישור |
| `deferred_deep_link_resolved` | `consumeInstallReferrerIfFresh` / `consumeClipboardInviteIfFresh` מצאו יעד | `channel`, `kind` | **הוכחה שה-deferred עובד.** היום אין שום אירוע בשני הקבצים |
| `organic_entry_viewed` | MainTabs נטען בלי פעולה ממתינה | `is_guest` | גודל הערוץ האורגני |
| `pending_action_saved` | `ensureNotGuest` כתב פעולה | `kind`, `has_draft` | כמה נעצרו בקיר |
| `pending_action_resumed` | הצרכן התחיל להריץ פעולה | `kind`, `age_ms` | כמה חזרו |
| `pending_action_failed` | ה-resume נכשל | `kind`, `reason` | איפה נשברים |
| `pending_action_abandoned` | נמחקה בלי מימוש | `kind`, `reason` | דליפה |
| `draft_saved` | `draftStore.write` | `kind` | ראש משפך הטיוטות |
| `draft_restored` | הוזרמה לטופס | `kind`, `age_ms` | שיעור החזרה |
| `draft_discarded` | "התחל מחדש" | `kind`, `age_ms` | ויתור מודע |
| `draft_expired` | נמחקה אחרי TTL | `kind` | כיול ה-7 ימים |
| `anonymous_upgrade_linked` | `linkWithCredential` הצליח | `provider` | מצב א' |
| `anonymous_upgrade_fell_back` | נפילה ל-`signInWithCredential` | `provider`, `code` | מצב ב' — **והמדד שמצדיק את ההיברידי** |
| `profile_confirmation_viewed` | `PostSignInOnboardingScreen` עלה | — | הצלע החסרה מול `ProfileCreated` |

### שני תיקונים לאירועים קיימים

- **`game_join_approval_pending` לא צריך שם חדש.** `joinGameV2` מדווח `GameJoined` עם `bucket:'pending'` (`gameService.ts:5779`) — "הצטרף" ו"ממתין לאישור" מתערבבים. **התיקון בפילוח, לא בקבוע:** להפריד את ענף ה-`pending` באותו מקום שבו `waitlist` כבר מופרד.
- **`create_*_auth_required` לא צריך שני קבועים.** `GuestGateBlocked` כבר קיים — רק להוסיף לו פרמטר `kind`.

> **מגבלות שחייבים לכבד:** `logEvent()` (`analyticsService.ts:576`) כבר שולח לשני היעדים: `joryio.track()` ואז `analytics().logEvent()`. `cleanParams` מוסיף `platform` ומשמיט כל ערך שאינו פרימיטיבי. השם מוגבל לאיחוד טיפוסים בכוונה.
>
> 275 + 15 = **290** שמות. מגבלת Firebase Analytics היא 500 לאפליקציה, 40 תווים לשם, 25 פרמטרים לאירוע — כולם בטווח. יש בדיקה (`analyticsWiring`) שמוודאת שלכל קבוע יש אתר קריאה, **אז קבוע בלי שימוש יפיל את ה-suite** — להוסיף קבוע ואתר קריאה באותו PR.

---

## 8 · Deep links — שני תיקונים לדוח הראשון

> ⛔ **תיקון 1 · iOS לא מכוסה, בניגוד למה שכתבתי**
>
> בדוח הראשון כתבתי ש-`/i/` ו-`/c/` עובדים ב-iOS כי `applinks` חל על כל הדומיין. **זה לא נכון.** `public/.well-known/apple-app-site-association` מגביל במפורש:
>
> ```json
> "paths": ["/session/*", "/team/*", "/app"]
> ```
>
> כלומר `/i/*`, `/c/*` ו-`/go` **אינם Universal Links ב-iOS** בדיוק כמו באנדרואיד. הפער סימטרי.

> ⛔ **תיקון 2 · אסור להפוך את `/i/` ל-App Link**
>
> ביקשת תיקון App Links ל-`/i/<code>`. בדקתי — **זה ישבור אותו, לא יתקן.**
>
> `firestore.rules:2225` קובע `allow read, update, delete: if false` על `/inviteLinks/{code}`. **הלקוח לא יכול לפענח קוד מקוצר.** כל הפענוח בשרת: `serveInviteCode` (`index.ts:10763`) קורא את המסמך, מזריק `window.__INVITE__`, והדף בונה `footy://session/<id>` עם היעד **המפוענח**.
>
> אם נוסיף `/i/` ל-intent filters, האפליקציה תיפתח עם קוד שהיא לא יכולה לפתור — `parseInviteUrl` יחזיר null והקישור יעשה כלום. **היום זה עובד.**

### מה כן לעשות

| נתיב | Android | iOS (AASA) | נימוק |
|---|---|---|---|
| `/session/*` | ✅ קיים | ✅ קיים | — |
| `/team/*` | ✅ קיים | ✅ קיים | — |
| `/app` | ✅ קיים | ✅ קיים | — |
| `/go` | 🟡 להוסיף | 🟡 להוסיף | אותה משמעות כמו `/app`, `parseInviteUrl` כבר מזהה |
| `/c/*` | 🟡 להוסיף | 🟡 להוסיף | מזהה מועדון גלוי ב-URL; `parseInviteUrl` צריך להכיר אותו |
| `/i/*` | ❌ לא | ❌ לא | **חייב להישאר בדפדפן** — הפענוח בשרת |

### העלות האמיתית של `/i/`

`primary()` ב-`invite.html` מופיע פעם אחת והוא handler של לחיצה — **הדף אף פעם לא פותח את האפליקציה לבד**. קישור מקוצר עולה תמיד נקישה נוספת, גם כשהאפליקציה מותקנת.

שתי דרכים לתקן בלי לשבור את הפענוח:

1. **פתיחה אוטומטית בדף** — כש-`window.__INVITE__` מגיע מפוענח, לנסות את הסכמה אוטומטית עם אותו fallback של 1500ms שכבר קיים. הכי זול.
2. **הפניה בשרת** — `serveInviteCode` יחזיר 302 ל-`/session/<id>`, שהוא כבר App Link מאומת. גם מנקה את המודל.

### שימור לאורך auth

עובד היום ונשאר: הדף כותב `&referrer=invite_<type>_<id>` ל-URL של Play (`invite.html:229`), וב-iOS כותב ללוח. שני השירותים כותבים לאותו מפתח ובודקים קיום לפני דריסה. **המיגרציה חייבת לשמר את סדר העדיפויות** — `App.tsx:539–556`: קישור ← stash קיים ← install referrer.

> ⚠️ **שני הדומיינים:** `assetlinks.json` ו-AASA יושבים ב-`public/` שמתפרסם לשני האתרים — אז **אפשר להוסיף גם את `soccer-app-52b6b.web.app` ל-intent filters**. רלוונטי כי אתר הקשר ב-Google Play מצביע דווקא על השני.

---

## 9 · מפת ה-web — שלוש משפחות, אפס מחיקות

| משפחה | נתיב | מוגש בידי | OG | יעד |
|---|---|---|---|---|
| **Marketing** | `/` | `public/index.html` | 3 סטטיים | שכתוב — סעיף 10 |
| | `/get` | `public/get.html` | 3 סטטיים | נשאר. כבר מפנה לשתי החנויות |
| **Contextual** | `/session/**` | `public/invite.html` | ❌ סטטי | **ל-CF עם OG של המשחק** |
| | `/team/**` | `serveCommunityPage` | ✅ דינמי | נשאר |
| | `/app` · `/go` | `public/invite.html` | ❌ סטטי | **ל-CF עם OG של המזמין** |
| | `/i/**` | `serveInviteCode` | ✅ דינמי | נשאר בדפדפן |
| **Showcase** | `/c/**` | `serveCommunityPage` | ✅ דינמי | נשאר |
| **משפטי** | `/privacy` · `/terms` · `/delete-account` | סטטי | ❌ אפס | להוסיף OG |
| **שירות** | `/track-click` · `/invite-preview` | CF | — | נשאר |

**רשת הביטחון:** `cleanUrls: true` ו-`trailingSlash: false` בשני האתרים. כל `*.html` מקבל 301 לגרסה בלי הסיומת. **כל URL שפורסם אי פעם ימשיך לעבוד** כל עוד שמות הקבצים לא משתנים. אין צורך ברשימת redirects חדשה.

> ⛔ **שלושה ממצאים מהסריקה**
>
> **א. שני קבצי `invite.html`, וכבר יש ביניהם הבדל.** `public/invite.html` מוגש ישירות; `functions/templates/invite.html` הוא העותק ש-`serveCommunityPage` ו-`serveInviteCode` טוענים (`index.ts:10527`). אין שום סקריפט או מבחן שמסנכרן — **והם כבר נבדלים בשורה 191** (האחד מקשר ל-`/privacy`, השני ל-`/privacy.html`). כל שינוי חייב להיכתב בשניהם.
>
> **ב. `public/downloads/teamder-0.2.5.aab` — קובץ בנייה ישן של 42MB** שמוגש בפומבי משני האתרים. לא מקושר משום מקום. מועמד למחיקה — לאישורך.
>
> **ג. `public/c/index.html` מצל חלקית על ה-rewrite.** קובץ סטטי קודם ל-rewrite אצל Firebase, כך ש-`/c` ו-`/c/` מגישים את הקובץ ואילו `/c/<id>` מגיע ל-CF. עובד — אבל שווה לדעת.

---

## 10 · האתר הראשי

### מה יורד

- `<section class="beta" id="beta">` — `index.html:553–575`, במלואו.
- שני ה-CTA בתוכו: `wa.me/972546986121` (`:563`) ו-`mailto:studiogameslime@gmail.com` (`:569`).
- קישור הניווט `<a href="#beta">הצטרפות לבטא</a>` (`:408`).
- שני עוגני ה-`#beta` ב-hero (`:426`).

### המבנה החדש

1. **Hero** — "הכדורגל של החבר'ה. בלי הבלגן." · תת-כותרת · **שני כפתורי חנות** — אותם URL-ים שב-`get.html:44–45`, שכבר מוכחים.
2. **חמשת השלבים** — מקימים מועדון ← מזמינים חברים ← יוצרים משחקים ← מנהלים הרשמה ← משחקים.
3. **יכולות** — הסקשן הקיים `#features` (`:446`) נשאר, רק הניסוח מתעדכן.
4. **הוכחה** — ארבעת הצילומים שכבר בריפו: `shot-home.jpg`, `shot-games.jpg`, `shot-match.jpg`, `shot-teams.jpg`.
5. **CTA סוגר + footer** — שוב שתי החנויות. ה-footer (`:590–593`) נשאר, ארבעת הקישורים תקינים.

> ✅ **שפה ויזואלית — קיימת, לא חדשה:** הדף כבר טוען Heebo 400–900 (`index.html:14`), וכחול המותג הוא `#3B82F6` — אותו קבוע בדיוק כמו `ACCENT` ב-`GroupWizardForm.tsx:49`. **אין צורך להמציא design system.**

> ⚠️ **לפרוס לשני האתרים:** שתי הגדרות ה-hosting מצביעות על אותה תיקייה `public/`, ולכן פריסה אחת מעדכנת את שניהם **בתנאי שהפקודה כוללת את שניהם**. `.firebaserc` מגדיר `default: soccer-app-52b6b` בלבד.

---

## 11 · דפי נחיתה

שלושתם משתמשים במנגנון שכבר עובד ל-`/team/`: `loadTemplate()` ← שאילתה ← `buildMetaBlock()` ← `injectMeta()` (`index.ts:10534–10680`). `injectMeta` מחליף `<title>`, `meta[name=description]`, כל `og:*` ו-`twitter:*` — ויש בו כבר `escapeHtml`.

### Game — `/session/<gameId>`

| שדה | מקור |
|---|---|
| כותרת | `games/{id}.title` |
| תאריך ושעה | `.startsAt` |
| מיקום | `.fieldName` · `.city` · `.fieldAddress` |
| פורמט | `.format` · `.numberOfTeams` |
| רשומים / מקומות | כבר מחושב ב-`getInvitePreview` (`index.ts:13244–13252`): `players + guests + held` מול `maxPlayers` |
| אווטארים | `.players[]` → `users/{uid}.avatarId` |
| מזמין | `?invitedBy` → `users/{uid}.name` |
| CTA | פתח ב-Teamder / הורד — הלוגיקה כבר ב-`invite.html:231` |

**שימו לב:** `getInvitePreview` כבר מחזיר גם את המועדון-האב כדי שהדף ייפול חזרה ל"הצטרף למועדון" כשהמשחק עבר. ההיגיון קיים — רק צריך להזיז אותו מ-JS בצד-לקוח ל-OG בצד-שרת, כי crawler אף פעם לא מריץ JS.

### Club — `/team/<groupId>`

**כבר בנוי.** `ShowcaseSummary` (`index.ts:10549`) כולל `name`, `description`, `city`, `totalGamesFinished`, `totalMembers`, `coverPhotoUrl`. חסרים שניים: **אווטארים של חברים** ו**המשחק הקרוב**. שניהם קיימים במראה `/communityShowcase/{gid}` ולא דורשים שאילתה חדשה.

### Personal invite — `/app?invitedBy=` · `/go`

הדף היחיד שאין לו כלום. נדרשת `servePersonalInvite` על אותה תבנית: קריאת `users/{invitedBy}` → `name` + `avatarId` → `injectMeta("{name} הזמין אותך ל-Teamder", …)`.

> ⚠️ **פרטיות:** הדף חושף שם ואווטאר של אדם פרטי ל-URL שאינו מאומת — כל מי שמנחש `?invitedBy=<uid>` מקבל תשובה. המועדונים פתרו את זה עם מראה ציבורית ייעודית ולא קריאה ישירה. **מומלץ אותו דפוס.** שאלה 6.

---

## 12 · מטריצת בדיקות

התשתית: `npm test` = jest עם `testEnvironment: 'node'` ו-`roots: ['tests']` — **מודולים טהורים בלבד**. 116 קבצים ב-`tests/logic`. `npm run test:rules` = אמולטור, 21 קבצים, **חייב לרוץ סדרתית**. **אין Detox ואין E2E.**

### אוטומטי — jest

| קובץ מוצע | מכסה |
|---|---|
| `tests/logic/pendingAction.test.ts` | מיגרציה מכל 3 הצורות · `version` חסר · JSON פגום · צריכה פעם אחת · יעד לא תקין · `toLegacyInvite` מחזיר בדיוק את מה ששתי פונקציות הייחוס מצפות לו |
| `tests/logic/draftStore.test.ts` | כתיבה/קריאה · תפוגה ב-7 ימים ± · מיזוג על `EMPTY_*_FORM_VALUES` · איפוס `startsAt` שבעבר · סלוט יחיד דורס · שלושת מסלולי הניקוי |
| `tests/logic/pendingActionMachine.test.ts` | כל מעבר + **כל אחד מתשעת מקרי הקצה**, כל אחד קובע מצב-יעד + גורל הטיוטה + גורל הפעולה |
| `tests/logic/appLinks.test.ts` | **קיים** — להרחיב ל-`/c/` ול-`/go` |
| `tests/logic/inviteTemplatesInSync.test.ts` | `public/invite.html` זהה ל-`functions/templates/invite.html`. **ייכשל היום** — שורה 191 |

> ⚠️ **שלוש נפילות קיימות** ב-`tests/rules` שאינן קשורות לעבודה הזו (מתועדות ב-`tests/rules/README.md`). **לא להשתיק ולא לספור כרגרסיה** — ולוודא שהמספר נשאר 3 ולא עולה.

### אוטומטי — חוקים

נדרש רק אם נוסיף הבחנה בין אנונימי למזוהה. אז: `tests/rules/anonymousAccess.test.mjs` — **עם שאילתות list אמיתיות ולא רק `get`**, ובתוך עותק של `firestore.rules` המלא ולא קובץ מקוצר. שתי המלכודות האלה עלו 1h48m השבתה ב-22.09.

### ידני — מכשירים

| # | תרחיש | Android | iOS |
|---|---|---|---|
| 1 | `/session` · מותקן | App Link ישיר | Universal Link ישיר |
| 2 | `/session` · לא מותקן | Play + referrer | App Store + לוח |
| 3 | `/team` · מותקן | ✓ | ✓ |
| 4 | `/team` · לא מותקן | ✓ | ✓ |
| 5 | `/i` · מותקן | **חייב להישאר דרך הדפדפן.** לאמת שהפענוח עובד | ← |
| 6 | `/i` · לא מותקן | ייחוס שורד את ההתקנה | ← |
| 7 | התקנה טרייה + Install Referrer | ✓ | — |
| 8 | התקנה טרייה + לוח | — | ✓ ובקשת ההדבקה פעם אחת בלבד |
| 9 | חשבון חדש דרך פעולה ממתינה | `link` מצליח | `link` מצליח |
| 10 | חשבון קיים דרך פעולה ממתינה | נפילה ל-sign-in | נפילה ל-sign-in |
| 11 | ביטול auth באמצע | חוזר למסך המקור, טיוטה שלמה | ← |
| 12 | יצירת מועדון כאורח | טיוטה ← auth ← פרופיל ← `createGroup` ← `celebrate` | ← |
| 13 | יצירת מחזור כאורח | אותו מסלול | ← |
| 14 | process death בזמן auth | Don't Keep Activities | הרג ידני |
| 15 | שחזור אחרי הרג | banner, **לא פתיחה כפויה** | ← |
| 16 | יצירה מוצלחת | טיוטה + פעולה נמחקות | ← |
| 17 | יצירה כושלת | טיוטה **שורדת** | ← |
| 18 | הצטרפות שמתמלאת | `bucket:'waitlist'` — הצלחה, לא כישלון | ← |
| 19 | יעד שנמחק | הודעה + ניקוי | ← |
| 20 | ללא רשת | שומר, לא מוחק | ← |
| 21 | טיוטה בת 8 ימים | נמחקת, טופס ריק, הודעה | ← |
| 22 | ווידג'ט/שעון אחרי שדרוג | סשן הנייטיב על ה-uid החדש | — |

> ⛔ **שער חובה לפני שחרור:** לאמת את מספרי 9 ו-10 **על שני חשבונות אמיתיים בכל פלטפורמה**. זה המסלול היחיד שלא ניתן לבדיקה אוטומטית, והיחיד שבו טעות נוגעת בזהות של משתמש קיים. אמולטור לא מספיק — `signInWithApple` דורש מכשיר iOS אמיתי, `signInWithGoogle` דורש Play Services.

---

## 13 · תוכנית PR-ים

הסדר נגזר מכלל אחד: **כל PR חייב להיות בטוח לשחרור גם אם הבא אחריו לא יגיע לעולם.** לכן המדידה קודמת לשינויים ההתנהגותיים, ופתיחת השער האמיתי היא האחרונה.

**PR 1 · מדידה + תיקון הזהות ב-Joryio** *(אין שינוי התנהגות, קטן)*
15 הקבועים + אתרי הקריאה. חשיפת `alias` ב-`joryio.ts`. הפסקת `identify` על אנונימי, הסרת ה-`unsub()` המוקדם ב-`auth.ts:474`, וקריאה ל-`alias` לפני `identify`.
*למה ראשון:* בלי זה אי אפשר לדעת אם משהו מכל השאר עבד. וזה מתקן בעיה שקיימת כבר היום.

**PR 2 · `PendingAction` + `draftStore` + המכונה** *(אין שינוי התנהגות, בינוני)*
שלושת המודולים, המיגרציה, מתאם `toLegacyInvite`, ושלושת קבצי המבחן. **עדיין אף אחד לא קורא להם.**

**PR 3 · הצרכן מקבל אורחים** *(שינוי התנהגות, קטן)*
הסרת `profileComplete` מהתנאי ב-`RootNavigator.tsx:61` **וגם** ב-`App.tsx:497`. **מכאן ואילך קישור למשחק עובד לאורח.**

**PR 4 · `upgradeAnonymous` + bottom sheet** *(שינוי התנהגות, בינוני)*
הפונקציה ההיברידית, ה-sheet שמחליף את `appAlert` ב-`guestGate.ts:44`, שימור `EmailRegisteredWithProviderError`, ווידוא ה-mirror.
*שער:* מקרים 9 ו-10 על מכשירים אמיתיים לפני מיזוג.

**PR 5 · אתחול אורח שקט** *(שינוי יסודי, גדול)*
השער ב-`RootNavigator.tsx:255`. **לפני כן — סריקה של כל `if (!user)`.**
**ה-PR המסוכן ביותר.** לשחרר לבדו, בלי שום שינוי אחר באותה גרסה.

**PR 6 · הסרת ה-carousel מהמסלול** *(קטן)*
שורה 253 וייבוא אחד. **המסך והדגל נשארים בקוד.**

**PR 7 · טפסים לאורח + רגע ההצלחה** *(בינוני)*
שער השמירה ב-`CreateGroupScreen.submit` ו-`GameCreateScreen.submit`, שחזור דרך `initial`, banner ההמשך.

> ✅ **מציאה — רגע ההצלחה כבר כתוב:** `src/services/onboardingService.ts` מממש בדיוק את מה שסעיף 7 באפיון מבקש: `createGroup` ← `clubInviteUrl()` ← `shareInvite()`, כולל קיצור דרך `createShortInviteUrl`. הוא נכתב לאשף ה-HTML של Joryio ולא נגיש מהאפליקציה. **לחלץ למודול משותף במקום לכתוב שוב.** וגם `celebrate: true` כבר עובר ל-`CommunityDetails` ול-`MatchDetails`.

**PR 8 · הרשאת push בהקשר** *(קטן)*
הוצאת האפקט מ-`RootNavigator.tsx:233–246` אל `src/services/pushPermission.ts` — `requestPushInContext(reason)` עם `reason` מטיפוס סגור: `'availability' | 'game_join' | 'club_join'`. הרשימה הסגורה תמנע פיזור חזרה לכל מקום.

**PR 9 · Deep links** *(בינוני)*
`/go` ו-`/c/*` ל-intent filters ול-AASA, שני הדומיינים, הרחבת `parseInviteUrl`, ושיפור מסלול `/i/`. **`/i/` לא הופך ל-App Link.**

**PR 10 · Public web** *(גדול)*
שכתוב `/`, OG לשלושת הדפים המשפטיים, CF לנחיתת משחק ולהזמנה אישית, ומבחן הסנכרון. לפרוס לשני האתרים.

> **מסלול שחרור:** PR 1–2 יחד בגרסה אחת. PR 3–4 בשנייה. **PR 5 לבדו.** 6–8 ברביעית. 9–10 אינם תלויים באפליקציה ויכולים לצאת במקביל — למעט AASA ו-intent filters ב-PR 9, שדורשים build.

---

## 14 · שאלות פתוחות

**1 · חוקי Firestore — להבחין בין אנונימי למזוהה?**
אחרי האתחול השקט, כל מי שפותח את האפליקציה מקבל `request.auth != null`. 11 כללים נשענים על זה בלבד — כולל קריאת **כל** מסמך משתמש.
*המלצה: לצמצם — אבל ב-PR נפרד ואחרי PR 5, עם מבחני list אמיתיים.*

**2 · מה קורה כשאורח סוגר את האפליקציה ולא חוזר?**
האתחול השקט יוצר חשבון Firebase לכל פתיחה ראשונה, כולל נטישות. **לאמת בקונסולה אם הפרויקט על Identity Platform** לפני השחרור.
*המלצה: להפעיל ניקוי אוטומטי לחשבונות אנונימיים לא-פעילים, ולתאם את קפיצת ה-DAU מראש.*

**3 · למחוק את ה-uid האנונימי היתום במצב ב'?**
אחרי הנפילה אי אפשר למחוק יותר — רק לפני.
*המלצה: להשאיר. בלי מסמך `/users` זו לא ישות עסקית, ומחיקה בתוך מסלול auth מוסיפה נקודת כשל לרגע הכי רגיש.*

**4 · `/i/` — פתיחה אוטומטית או 302?**
שתיהן מתקנות ומשמרות תאימות.
*המלצה: 302 — הקישור המקוצר הופך למה שהוא באמת, והיעד מקבל את כל יתרונות ה-App Link.*

**5 · `public/downloads/teamder-0.2.5.aab`**
42MB, מוגש בפומבי משני האתרים, לא מקושר משום מקום. למחוק? **לא אגע בלי אישור מפורש.**

**6 · דף ההזמנה האישית — מה מותר לחשוף?**
הדף מציג שם ואווטאר לפי `?invitedBy=<uid>` בלי אימות.
*המלצה: מראה ציבורית. קריאה מ-`/users` לדף לא מאומת הופכת כל שדה — גם עתידי — לשאלת פרטיות.*

**7 · שלושת שקפי ה-onboarding — מתי באמת למחוק?**
ביקשת להסיר מהמסלול ולא למחוק. אחרי כמה זמן בפרודקשן נמחק אותם, את `ProfileSetupScreen` ואת דגל `onboardingDone`?

---

*נכתב מקריאה בקוד בענף `perf/firestore-read-costs`, 24.09.2026. לא בוצע שום שינוי בקוד, בהגדרות, בנתונים או בפריסה. מספרי שורות מדויקים למצב הענף בתאריך זה. שני תיקונים לדוח הראשון מסומנים במפורש בסעיף 8.*
