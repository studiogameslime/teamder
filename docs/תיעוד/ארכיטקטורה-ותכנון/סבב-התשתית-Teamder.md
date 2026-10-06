# שכבת התשתית — Teamder

**דוח סבב implementation · ממשיך את "מפת הכניסה" ו"ארכיטקטורת היעד"**

| | |
|---|---|
| תאריך | 24.09.2026 |
| ענף | `perf/firestore-read-costs` |
| מצב | לא הוקמט — הכל בעץ העבודה |

| מדד | ערך |
|---|---|
| בדיקות jest | **1844 — כולן עוברות** |
| חדשות בסבב הזה | **150** |
| שגיאות typecheck | **0** |
| נפילות rules | **3 — בדיוק כמו קודם** |

---

## 1 · סיכום

### בוצע

- **`src/services/pendingAction.ts`** — איחוד מתויג לשמונת סוגי הפעולה, מיגרציה **לא הרסנית** מ-`PendingInvite`, ומתאם תאימות.
- **`src/services/draftStore.ts`** — טיוטות עם TTL של 7 ימים, סלוט יחיד לכל סוג, וה-helpers הטהורים לשחזור.
- **`src/utils/pendingActionMachine.ts`** — מכונת המצבים כ-reducer טהור, בלי ניווט, בלי Firebase, בלי אחסון.
- **תיקון הזהות ב-Joryio** — עטיפת `alias`, החלטה אחת מרוכזת ב-`bindIdentity`, וניתוק הזהות ב-sign-out.
- **אירוע מדידה אחד**, עם אתר קריאה אמיתי.
- **150 בדיקות חדשות** בארבעה קבצים.

### לא בוצע — לפי ההנחיה

שער הכניסה ב-`RootNavigator`, התחברות אנונימית אוטומטית, מסלול ה-onboarding, `ProfileSetup`, שני הטפסים ושערי השמירה שלהם, ה-bottom sheet, הרשאת push, נתיבי deep-link, Hosting, האתר, דפי הנחיתה, ו-`firestore.rules`. **אף אחד מהם לא נפתח.**

> ✅ **שלושת המודולים החדשים אינרטיים**
>
> בדקתי: **אין להם אף אתר קריאה באפליקציה.** `writePendingAction`, `readPendingAction`, `consumePendingAction`, `draftStore.*` — אף אחד לא נקרא משום מקום ב-`src/` או ב-`App.tsx`. הם נבנו, נבדקו, וממתינים.
>
> המשמעות: **השינוי ההתנהגותי היחיד בסבב הזה הוא תיקון הזהות ב-Joryio.** אם משהו במודולים האלה שגוי, הוא לא יכול להגיע למשתמש עד שהסבב הבא יחבר אותם.

---

## 2 · קבצים

### שונו

| קובץ | שינוי | למה |
|---|---|---|
| `src/firebase/auth.ts` | +98 −27 | `waitForAuthRestore` פוצל: הבטחה חד-פעמית שמתנתקת + `ensureIdentityWatch()` — מנוי יחיד לכל התהליך. ראו ממצא 1 |
| `src/services/joryio.ts` | +127 | `alias()`, `bindIdentity()`, `resetIdentity()` + seam לבדיקות. שום פונקציה קיימת לא שונתה |
| `src/services/userService.ts` | +9 | שורה אחת ב-`signOut` + ייבוא. **שתי פונקציות הייחוס לא נגעו בהן** — אפס שורות ב-diff |
| `src/services/analyticsService.ts` | +6 | קבוע אחד: `IdentityAliased` |

### נוספו

| קובץ | שורות |
|---|---|
| `src/services/pendingAction.ts` | 354 |
| `src/services/draftStore.ts` | 301 |
| `src/utils/pendingActionMachine.ts` | 394 |
| `tests/logic/pendingAction.test.ts` | 491 · 39 בדיקות |
| `tests/logic/draftStore.test.ts` | 382 · 43 |
| `tests/logic/pendingActionMachine.test.ts` | 501 · 38 |
| `tests/logic/joryioIdentity.test.ts` | 250 · 19 |

---

## 3 · PendingAction

```
// קריאה / כתיבה — now מוזרק כדי שהמרה תישאר טהורה ובדיקה
readPendingAction(now?)    → PendingAction | null
writePendingAction(a)      → void   (כותב גם את המפתח הישן)
consumePendingAction(now?) → PendingAction | null  (בדיוק פעם אחת)
clearPendingAction()       → void   (מנקה את שני המפתחות)

// טהור
fromLegacyInvite(p, now)   toLegacyInvite(a)   parsePendingAction(raw)
isTargeted(a)              isDrafted(a)
```

### שמונת הסוגים

| קבוצה | סוגים | שדה חובה |
|---|---|---|
| **Targeted** | `open_game` `open_club` `join_game` `join_club` | `targetId: string` |
| **Drafted** | `create_club` `create_game` `save_availability` | `draftId: string` (+ `targetId?`) |
| **Bare** | `open_invite` | — |

האיחוד אמיתי: `TargetedAction` דורש `targetId` ברמת הטיפוס, כך שצרכן לעולם לא צריך לבדוק null, ו-`create_club` בלי `draftId` פשוט לא מתקמפל.

> ⛔ **ממצא — לא 3 קוראים אלא 8**
>
> בדוח השני כתבתי שלמפתח הישן `footy.invite.pending` יש שלושה קוראים. **הרצתי את החיפוש בפועל ויש שמונה אתרי קריאה בשישה מודולים** — בנוסף ל-`RootNavigator` ולשתי פונקציות הייחוס, גם:
>
> - `installReferrerService.ts:191`
> - `clipboardInviteService.ts:46`
> - `deepLinkService.ts:234`
> - `App.tsx:545,555,571`
>
> **ושלושת האחרונים משתמשים בו כשומר "אל תדרוס".** כל אחד קורא את המפתח לפני שהוא כותב, כדי לא לדרוס יעד קיים. אילו המיגרציה הייתה מוחקת את המפתח הישן, עלייה קרה הייתה יכולה **לדרוס קישור אמיתי למשחק ביעד של install-referrer** — באג שאף אחד לא היה מקשר למיגרציה.
>
> העיצוב הלא-הרסני מטפל בזה: הקריאה *גוזרת* מהמפתח הישן ומשאירה אותו, והכתיבה מקרינה חזרה אליו. יש בדיקה מפורשת לכך.

### שלוש התנהגויות שכדאי להכיר

- **המפתח החדש מנצח.** אם שניהם קיימים, נקרא החדש.
- **גרסה לא נתמכת נזרקת.** `version` שאינו 2 — חסר, ישן או חדש יותר — נדחה והמפתח נמחק, כך שבנייה עתידית לא תוקעת את הסלוט לנצח.
- **פעולת טיוטה מנקה את המפתח הישן.** ל-`create_club` אין מקבילה ישנה. אם היא נושאת מזמין היא מוקרנת ל-`type:'app'` (= "תן קרדיט, אל תנווט"); אחרת המפתח הישן נמחק כדי שהצרכן הישן לא ינווט ליעד שכבר לא רלוונטי.

---

## 4 · DraftStore

```
writeDraft(kind, id, values, now?)  → Draft
readDraft(kind, now?)              → Draft | null  (מוחק פג-תוקף)
peekExpired(kind, now?)            → boolean       (לא מוחק)
discardDraft(kind)                 → המשתמש ויתר
consumeDraft(kind)                 → העבודה נחתה

// טהור
mergeDraftValues(defaults, stored)
restoreValues(defaults, stored)              → {values, needsAttention}
restoreGameValues(defaults, stored, now)     → {values, needsAttention}
```

המפתחות: `footy.draft.club`, `footy.draft.game`, `footy.draft.availability`. `createdAt` נשמר כשעורכים *אותה* טיוטה, ו-`updatedAt` הוא מה שה-TTL מודד — כלומר עריכה מאריכה את החיים, כפי שאדם מצפה.

### המיזוג — שלושה כללים, כל אחד בגלל כשל אמיתי

1. **רק מפתחות שקיימים בברירות המחדל** מועתקים. שדה שהוסר מהטופס לא יכול לחזור מטיוטה ישנה.
2. **ברירת מחדל `undefined`** מקבלת כל ערך — אין טיפוס להשוות אליו, ושדה אופציונלי כמו `coords` חסר בלגיטימיות.
3. **אחרת הטיפוס חייב להתאים**, כולל היותו מערך. שדה שהטיפוס שלו השתנה בין בנייה לבנייה נזרק ולא מועבר לטופס שירנדר ממנו שטות.

> ⚠️ **`startsAt` — לא מנחשים**
>
> `restoreGameValues` מזהה מועד שכבר עבר ו**לא משחזר אותו**. הוא גם **לא ממציא מועד חדש**: השדה נשאר מה שטופס טרי היה מציג, ו-`needsAttention: ['startsAt']` אומר לקורא שהמשתמש חייב לבחור. כל שאר השדות נשמרים — העבודה שלו עדיין שלו, רק התאריך בשאלה. `now` נחשב כעבר, לא כעתיד.

**ניקוי:** הצלחה → `consumeDraft`; ויתור → `discardDraft`; תפוגה → נמחקת בקריאה. אין sweep ואין טיימר — **הקריאה היא מנגנון האיסוף היחיד**, וזה גם מה שמבטיח שבלוב פגום או מבנייה עתידית לא יכול לתקוע סלוט לנצח.

`discardDraft` ו-`consumeDraft` עושים היום אותו דבר בכוונה תחת שני שמות: אלה אירועים שונים, הם ידווחו שונה, ושינוי עתידי באחד אסור שיחול בשקט על השני.

---

## 5 · מכונת מצבים

המודול לא מבצע ניווט, לא נוגע ב-Firebase, לא קורא AsyncStorage ולא מחזיק state של React.

```ts
interface Transition {
  ctx: { state, kind }
  pendingAction: 'keep' | 'save' | 'clear'
  draft:         'keep' | 'save' | 'clear'
  notice:        NoticeKind | null
  ignored:       boolean
}
```

המכונה **מנסחת מצב ולא טקסט**. `notice` מחזיר שם של סיטואציה (`waitlisted`, `draft_expired`) — הניסוח שייך ל-`src/i18n/he.ts`, כי למודול טהור אין עסק להחזיק copy.

המצבים: `ANONYMOUS_BROWSING` · `ACTION_REQUESTED` · `AUTH_REQUIRED` · `AUTH_IN_PROGRESS` · `PROFILE_REQUIRED` · `RESUMING_ACTION` · `SUCCESS` · `FAILURE`

| מקרה קצה | מצב | פעולה | טיוטה |
|---|---|---|---|
| auth בוטל | ANONYMOUS_BROWSING | keep | keep |
| כשל ספק | AUTH_REQUIRED | keep | keep |
| התהליך נהרג | ACTION_REQUESTED / הצעה | keep | keep |
| היעד נמחק | FAILURE | clear | clear |
| המשחק התמלא | **SUCCESS** | clear | clear |
| אין רשת | ACTION_REQUESTED | **keep** | **keep** |
| חשבון קיים | RESUMING_ACTION | keep | keep |
| הטיוטה פגה | FAILURE | clear | clear |
| היעד חסום | **SUCCESS** | clear | — |
| כשל אמיתי אחר | FAILURE | clear | **keep** |

### שלוש החלטות ששווה להסביר

- **משחק מלא הוא הצלחה.** `joinGameV2` מחזיר `{bucket:'waitlist'}` — מקום בתור הוא תוצאה, לא שגיאה. דיווח ככישלון הוא איך משחק מלא נראה שבור למי שבדיוק נכנס לתור.
- **`ACCESS_BLOCKED` לא מגיע למכונה ככישלון בכלל.** יש predicate ייעודי, `isPresentButUnreadable()`, כדי שקורא לא יוכל לטעות: המסמך קיים, למסך היעד יש תצוגת חסימה, ו"הקישור לא תקין" הוא אמירה שקרית על משחק שהחבר שלו משחק בו.
- **כשל אמיתי שומר על הטיוטה.** המשחק התחיל או המועדון מלא — אבל מה שהוא הקליד עדיין שלו, ויעד אחר עשוי לקבל אותו. רק יעד שנמחק או טיוטה שפגה מנקים גם אותה.

**מעבר לא חוקי לא ממציא מצב.** הוא מוחזר עם `ignored: true`, ההקשר ללא שינוי, ושני הסלוטים ב-`keep`. יש בדיקה שעוברת על **כל 96 הצירופים** של (מצב × אירוע) ומוודאת שהמכונה טוטאלית ושאף צירוף לא נוגע בשמור.

---

## 6 · Joryio

כל ההחלטה יושבת במקום אחד — `bindIdentity()` — ונקראת על כל פליטה של `onAuthStateChanged`:

```
if (!subject)                  → 'none'      // אין משתמש
if (subject.isAnonymous)       → 'none'      // אורח: שום identify, שום alias
                                             // רק מסמנים שיש ריצה אנונימית
if (identifiedUid === uid)     → 'none'      // כבר קשור — אין identify כפול

if (unclaimedAnonymousRun)     → alias(uid)  // לפני identify
identify(uid, {email, name})   → 'aliased' | 'identified'
```

> **למה `alias` ולא רק `identify` — שתי הפלטפורמות לא מסכימות**
>
> **אנדרואיד** — `Joryio.kt:467` שולח `IdentifyRequest(userId, anonymousId, attributes)`. ה-`anonymousId` נכלל, אז השרת תופר לבד.
>
> **iOS** — `JoryioSDK.swift:425` שולח `IdentifyRequest(userId:attributes:)`. ל-`IdentifyRequest` ב-`Models/User.swift:23–31` **אין שדה `anonymousId` בכלל**, ו-`NetworkClient.swift` לא מוסיף header כזה. ב-iOS, identify לבדו לא תופר כלום.
>
> `alias` שולח `AliasRequest(anonymousId, userId)` ל-`v1/alias` בשתיהן — ולכן הוא מה שמשווה את ההתנהגות. **לא נגעתי ב-vendor SDK**; `alias` כבר היה מחווט מקצה לקצה (`index.ts:407` → `JoryioModule.kt:113` / `JoryioModule.swift:124` → הנייטיב). הוא פשוט לא היה עטוף ולא נקרא אף פעם.

### ארבעת הסיכונים שביקשת לאמת

| סיכון | המנגנון שמונע אותו | בדיקה |
|---|---|---|
| identify נשלח פעמיים | `identifiedUid === uid` → יציאה מוקדמת | ✅ 3 מקרים |
| alias עם uid אנונימי | מעבירים תמיד את ה-uid *האמיתי*; ה-anonymousId מגיע מה-SDK | ✅ נבדק במפורש |
| משתמש קיים בעלייה קרה מקבל alias שגוי | `alias` רק כשהייתה ריצה אנונימית *בתהליך הזה* | ✅ 2 מקרים |
| sign-out ← כניסה של מישהו אחר מחברת שני אנשים | `resetIdentity()` ב-`signOut` מתחיל סשן אנונימי חדש | ✅ 4 מקרים |

> ⛔ **הבאג שתוקן, במילים פשוטות**
>
> קודם: אורח נכנס ← Joryio קיבל את ה-uid האנונימי בתור *אדם* ← המאזין **התנתק**. עשר שניות אחר כך אותו אדם נרשם — ולא נשאר מי שיקשיב. החשבון האמיתי נקלט רק בעלייה הבאה, כפרופיל **שני ולא מקושר**.
>
> כלומר: שתי רשומות אדם לכל הרשמה, אחת מהן זבל חסר שם, ואפס קשר בין הגלישה שהובילה להרשמה לבין החשבון שיצא ממנה.

`signOut` עכשיו קורא ל-`joryio.resetIdentity()`. `resetUser` היה מיוצא מאז שה-SDK חובר ו**לא היה לו אתר קריאה בשום מקום באפליקציה**.

---

## 7 · מדידה

### נוסף

| קבוע | ערך | אתר קריאה | פרמטרים |
|---|---|---|---|
| `IdentityAliased` | `identity_aliased` | `auth.ts:485` | `provider` |

זה האירוע היחיד בסבב הזה שיש לו התנהגות אמיתית למדוד — האיחוד עצמו. והוא נחוץ דווקא כאן: ה-SDK מדווח על alias שנכשל רק ל-logger שחסום מאחורי `enableDebug`, כלומר **בבנייה של חנות, תפירה שבורה היא שקטה לחלוטין**.

> ✅ **הוכחה שזה לא dummy:** בדיקת `analyticsWiring` מוודאת שלכל קבוע יש אתר קריאה, ויש בה **allowlist** לקבועים לא מחוברים. `IdentityAliased` **לא נוסף לרשימה הזו** והבדיקה עוברת — כלומר היא מצאה קריאה אמיתית בקוד.

### נדחו — 14, עם ה-PR שבו כל אחד יתווסף

| אירוע | למה נדחה | יתווסף ב-PR |
|---|---|---|
| `pending_action_saved` | שום דבר לא כותב פעולה עדיין | 3 · הצרכן מקבל אורחים |
| `pending_action_resumed` | אין resume | 3 |
| `pending_action_failed` | אין resume | 3 |
| `pending_action_abandoned` | אין resume | 3 |
| `entry_source_resolved` | שרשרת המקורות לא שונתה | 3 |
| `deferred_deep_link_resolved` | לא נגענו בשני השירותים | 3 |
| `anonymous_upgrade_linked` | `upgradeAnonymous` לא נבנה | 4 · bottom sheet |
| `anonymous_upgrade_fell_back` | אותו דבר | 4 |
| `guest_session_started` | אין אתחול אורח שקט | 5 · שער הכניסה |
| `organic_entry_viewed` | אין כניסה אורגנית | 5 |
| `profile_confirmation_viewed` | המסך לא שונה | 5 |
| `draft_saved` | שום טופס לא כותב טיוטה | 7 · טפסים לאורח |
| `draft_restored` | אין שחזור | 7 |
| `draft_discarded` · `draft_expired` | אין UI של ויתור, ואף אחד לא קורא את הסלוטים | 7 |

גם שני התיקונים לאירועים קיימים נדחו: הפרדת `bucket:'pending'` מ-`GameJoined` (PR 3), והוספת פרמטר `kind` ל-`GuestGateBlocked` (PR 4).

---

## 8 · בדיקות

| פקודה | תוצאה |
|---|---|
| `npx tsc --noEmit` | ✅ PASS — 0 שגיאות |
| `npx jest` | ✅ PASS — 138 suites · **1844 בדיקות** · 18.7s |
| `npx jest analyticsWiring` | ✅ PASS — 5/5, כולל "every constant has a call site" |
| `npm run test:rules` | 🟡 246 pass · 3 fail — ראו סעיף 9 |
| lint | 🟡 לא קיים — אין `scripts.lint` ואין קונפיג eslint בריפו |

### 150 הבדיקות החדשות

| קובץ | בדיקות | מה נבדק |
|---|---|---|
| `pendingAction.test.ts` | 39 | כל צורת legacy · 3 המיפויים · `invitedBy` · `acquisition` · JSON פגום בשני המפתחות · גרסה לא נתמכת (4 וריאציות) · צריכה פעם אחת · המתאם · **תאימות ייחוס** · סמנטיקת דריסה |
| `draftStore.test.ts` | 43 | כתיבה/קריאה · דריסה באותו סוג · סוגים עצמאיים · **גבול TTL ±1ms** · מבנה פגום · `appVersion` · מיזוג · `startsAt` ישן · ויתור · ניקוי · תפוגה |
| `pendingActionMachine.test.ts` | 38 | כל מעבר חוקי · **9 מקרי הקצה** · מיפוי קודי שגיאה · **כל 96 צירופי (מצב × אירוע)** |
| `joryioIdentity.test.ts` | 19 | ארבעת הסיכונים · סדר alias←identify · עמידות לזריקה |

> **איך הם בדיקים בכלל:** `jest.config.js` מגדיר `testEnvironment: 'node'`, כך שמודול שמייבא React Native או Expo נכשל לפני שרץ מקרה אחד. המכונה טהורה לגמרי; שני מודולי האחסון נבדקים מול **AsyncStorage בזיכרון** דרך `jest.mock` — אותו דפוס שכבר קיים ב-`joryioPushRegistration.test.ts` וב-`groupHydrate.test.ts`. זה עדיף על פיצול המודול לשניים: `storage.ts` נטען אמיתי, אז **מסלול המפתח הישן נבדק מקצה לקצה**.

---

## 9 · נפילות קיימות

```
not ok 52  - games: self can join an open community game
not ok 66  - groupsPublic: admin of canonical group can create the public mirror
not ok 111 - OLD-CLIENT manual-offer cancel: B removes self AND sets pendingPromotion to head C

# tests 249  # pass 246  # fail 3
```

שלושתן **תואמות מילה במילה** את מה ש-`tests/rules/README.md` מתעד תחת "The three that fail". הכמות לא השתנתה. **לא נגעתי ב-`firestore.rules` בכלל** — הוא לא מופיע ב-diff.

הסיבה מתועדת שם: הראשונה והשלישית הן תקרת 1000 הביטויים בשרשרת ה-`update` של `/games` — הענף של המנהל יושב אחרון ולא מגיעים אליו.

> ⚠️ **הערה תפעולית:** ה-suite דורש JDK. `/usr/libexec/java_home` לא מצא אחד; הרצתי עם `JAVA_HOME=/opt/homebrew/opt/openjdk` (26.0.1). שווה לקבע את זה ב-`test:rules` או ב-README.

---

## 10 · ממצאים וסיכונים

> ⛔ **1 · דליפה שאני הכנסתי, ותיקנתי**
>
> התיקון הראשון שלי השאיר את המאזין ב-`waitForAuthRestore` חי לתמיד, כדי שהתחברות מאוחרת תזוהה. ה-quality gate תפס למה זה שגוי: **הפונקציה נקראת מ-7 מקומות** — `userService`, `chatService`, `gameService` (פעמיים) ו-`notificationActionService` (**שלוש פעמים, אחת לכל פעולת התראה**). מאזין שלא מתנתק היה מצטבר אחד לכל קריאה לאורך חיי התהליך.
>
> **התיקון:** הופרדו לשניים. ההבטחה היא מאזין חד-פעמי שמתנתק, ו-`ensureIdentityWatch()` הוא מנוי יחיד לכל התהליך. תופעת לוואי נוספת שנסגרה: קודם `ensureNativeAuthMirror()` היה רץ על כל פליטה של כל מאזין.

> ⛔ **2 · המפתח הישן — 8 קוראים, לא 3**
>
> מתואר בסעיף 3. שלושה מהם שומרי "אל תדרוס", ומיגרציה הרסנית הייתה יכולה לגרום לעלייה קרה לדרוס קישור אמיתי ביעד של install-referrer. **זו תיקון לדוח השני** — ההמלצה שנתתי שם נשארת נכונה, היא פשוט הייתה נכונה מסיבה גדולה יותר ממה שידעתי.

> **3 · תקדים מתועד לצמצום ה-rules**
>
> `firestore.rules:2311–2331` מתעד ביקורת קודמת (**audit P0-1**) שבה בדיוק ארבעה כללים הועברו מ-`allow read: if isSignedIn()` לשער חברות. השיטה שם היא בדיוק מה שנצטרך, **ויש בה אזהרה שחייבים לקרוא לפני סבב ה-rules:**
>
> *"Firestore ORs overlapping match blocks — the more specific rule does NOT win."* בפעם הקודמת בלוק `match` שני ומתירני יותר לאותה קולקציה **ביטל בשקט** את זה שגודר בחברות.

---

## 11 · סיכום diff

| | קבצים | נוספו | נמחקו |
|---|---|---|---|
| שונו | 4 | 213 | 27 |
| קוד חדש | 3 | 1049 | 0 |
| בדיקות חדשות | 4 | 1624 | 0 |
| **סה"כ** | **11** | **2886** | **27** |

### Quality gate — 7 הבדיקות שביקשת

1. **diff מלא נסקר.** ✔
2. **שום דבר מחוץ לסקופ.** ✔ אף קובץ ב-`screens/`, `components/`, `navigation/`, `i18n/`, `public/`, `functions/`, ולא `App.tsx`, `app.json`, `firebase.json` או `firestore.rules`.
3. **כל הבדיקות הורצו.** ✔ ראו סעיף 8.
4. **`footy.invite.pending` — 4 אזכורים.** ההגדרה ב-`storage.ts:25`, שתי הערות, וקבוע בבדיקה. **אפס אתרי קריאה חדשים.**
5. **`getPendingInvite` — 8 אתרי קריאה קיימים, כולם ללא שינוי**, בתוספת 4 חדשים בתוך `pendingAction.ts` עצמו.
6. **הייחוס חי.** `applyInviteAttributionIfFresh` ו-`applyAcquisitionIfFresh` — **אפס שורות ב-diff**. הן עדיין קוראות את המפתח הישן, ו-3 בדיקות "attribution compatibility" קובעות את הצורה המדויקת שהן מפרקות.
7. **אפס שינוי UX.** ✔ שלושת המודולים בלי אתרי קריאה; השינוי ההתנהגותי היחיד הוא איזה מזהה נשלח ל-Joryio.

---

## 12 · הסבב הבא — לא ביצעתי

> ⚠️ **ההמלצה: סבב ה-rules, לא PR 3**
>
> בתוכנית המקורית הצעד הבא הוא PR 3 (הצרכן מקבל אורחים). **אני ממליץ להקדים לו את סבב ה-rules**, מהסיבה שאתה עצמך נתת: אסור שהצמצום יקרה אחרי שהאורח השקט כבר בפרודקשן.
>
> הנימוק הטכני: PR 3 פותח את מסלול ה-deep-link לאורחים, כלומר **מרחיב בפועל את מה שמשתמש אנונימי קורא** — הוא יגיע למסכי משחק ומועדון שלא הגיע אליהם קודם. זה הופך את הצמצום לדחוף יותר ולא פחות, ועדיף לעשות אותו כשהחשיפה עדיין מוגבלת למי שבחר "המשך כאורח".

הסבב שאני מציע:

1. למפות בפועל כל שאילתה שאורח מריץ — **מהקוד, לא מהזיכרון**, כולל הרחבות PR 3.
2. לכתוב `tests/rules/anonymousAccess.test.mjs` מול החוקים *הנוכחיים*, שמתעד מה אנונימי יכול היום. זה ה-baseline.
3. להדק את 8 הכללים הבלתי-מסויגים, אחד-אחד, כשכל אחד מוכיח את עצמו בשאילתת list אמיתית.
4. לאמת את ספירת 3 הנפילות לפני ואחרי.

**ואז** PR 3, שלוקח שורה אחת בכל אחד משני קבצים ונשען על התשתית שנבנתה עכשיו.

**לא אתחיל בשום דבר בלי אישור מפורש.**

---

# נספח: גישה אנונימית ב-Firestore

*מחקר בלבד. **לא שיניתי `firestore.rules`.***

## א · מה guest browsing יצטרך לקרוא

| קולקציה | הצורה | מי צריך |
|---|---|---|
| `/groupsPublic` | `getDocs(col.groupsPublic())` + `get(id)` | פיד המועדונים, פרטי מועדון ציבורי, הצרכן |
| `/communityShowcase` | `get(gid)` | כרטיס הראווה |
| `/games` | `where('visibility','==','public')` + `get(id)` | פיד המשחקים, פרטי משחק |
| `/users` | `get(uid)` לרשומים בלבד | אווטארים ברשימת המשתתפים |
| `/appConfig` | `get` | עדכון גרסה, maintenance |
| `/campaigns` | `list` | פופאפים שיווקיים |

**אורח לא צריך:** `/rounds`, `/playerStats`, `/ratings`, `/pairStats`, `/seasonTitles`, `/notifications`, `/friendRequests`, `/groupJoinRequests`, ואת מסמך `/users` של כל אחד אחר.

## ב · הכללים שרחבים מהנדרש

8 כללי קריאה נשענים על `isSignedIn()` **בלי שום תנאי נוסף**, ו-`isSignedIn()` הוא `request.auth != null` — כלומר כל משתמש אנונימי עובר. בדקתי: `firebase.sign_in_provider` **לא מופיע בקובץ החוקים אפילו פעם אחת**.

| שורה | קולקציה | מה נחשף | אורח צריך? |
|---|---|---|---|
| 408 | `/users/{uid}` | **כל מסמך משתמש באפליקציה** | 🟡 חלקית |
| 818 | `/groupsPublic/{gid}` | מראה ציבורית | ✅ כן |
| 1641 | `/rounds/{id}` | כל משחקון בכל מועדון | ❌ לא |
| 1663 | `/playerStats/{uid}` | סטטיסטיקות כל שחקן | ❌ לא |
| 1817 | `/ratings/{ratedUid}` | דירוגים מצרפיים | ❌ לא |
| 2241 | `/campaigns/{id}` | קמפיינים שיווקיים | ✅ כן |
| 2273 | `/users/{uid}/seasonTitles` | תארי עונה של כולם | ❌ לא |
| 2307 | `/pairStats/{pair}` | כימיה בין כל זוג | ❌ לא |

**`/users` היא החשובה.** היום, כל מי שלוחץ "המשך כאורח" יכול לקרוא כל מסמך משתמש. אחרי האורח השקט זה נכון לכל מי שפותח את האפליקציה.

## ג · הצעת rules מינימלית

```
// שער אחד חדש, לצד isSignedIn() הקיים.
function isFullAccount() {
  return isSignedIn()
    && request.auth.token.firebase.sign_in_provider != 'anonymous';
}

// 6 כללים עוברים ל-isFullAccount():
//   /rounds  /playerStats  /ratings  /pairStats  /users/{uid}/seasonTitles
//   ועוד אחד — ראו /users למטה

// /groupsPublic ו-/campaigns נשארים isSignedIn() — אורח באמת צריך אותם.

// /users: לא לחסום לגמרי — אורח כן צריך אווטאר של מי שרשום למשחק
// שהוא צופה בו. שתי אפשרויות, וזו החלטה שלך:
//   (א) מראה ציבורית /usersPublic{name,avatarId} — הדפוס שכבר עבד
//       ל-/communityShowcase, ועונה גם על פרטיות דף ההזמנה האישית;
//   (ב) להשאיר, ולקבל שכל מסמך משתמש קריא לכל מי שמחובר.
```

**(א) עדיפה** ופותרת שתי בעיות במכה אחת — היא גם התשובה לשאלה 6 בדוח השני, שכבר אישרת.

## ד · הבדיקות שנצטרך לפני האורח השקט

1. **baseline מול החוקים הנוכחיים.** `tests/rules/anonymousAccess.test.mjs` שמתעד מה אנונימי קורא *היום*, לפני שנוגעים בכלום.
2. **שאילתת list אמיתית לכל כלל שמשתנה** — לא רק `get`. זו התקלה מ-22.09 שעלתה 1h48m השבתה: בדיקת טיפוס בחוק קריאה חוסמת שאילתת list שלמה ומדווחת `false for 'list'` בלי שגיאה.
3. **זוג חיובי/שלילי לכל קולקציה**: אנונימי נחסם, חשבון מלא עובר.
4. **מבחן שלא נשאר `match` כפול** לאף קולקציה שנוגעים בה. `firestore.rules:2314–2320` מתעד את הפעם הקודמת שזה קרה: בלוק שני ומתירני **ביטל בשקט** את המגודר, כי Firestore עושה OR ולא "הספציפי מנצח".
5. **לוודא שספירת הנפילות נשארת 3** לפני ואחרי.
6. להריץ **סדרתית** (`npm run test:rules`, שמקבע `--test-concurrency=1`) ולעולם לא לבודד כלל בקובץ מקוצר — ה-catch-all עונה ראשון.

---

*ענף `perf/firestore-read-costs`, 24.09.2026. לא הוקמט — כל השינויים בעץ העבודה. `firestore.rules`, `app.json`, `firebase.json`, `public/` ו-`functions/` לא נגעו בהם. 1844 בדיקות jest עוברות; 3 נפילות ב-rules, קיימות ומתועדות, ללא שינוי בכמות.*
