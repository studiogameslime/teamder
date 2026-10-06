# מודל הגישה — Teamder

**דוח סבב Firestore/access · ממשיך את שלושת הדוחות הקודמים**

| | |
|---|---|
| תאריך | 24.09.2026 |
| ענף | `perf/firestore-read-costs` |
| מצב | **לא נפרס** — לא rules, לא functions. ה-backfill לא הורץ |

| מדד | ערך |
|---|---|
| בדיקות access חדשות | **17 — כולן עוברות** |
| rules סה"כ | **266 · 263 עוברות** |
| נפילות | **3 — בדיוק אותן שלוש** |
| jest | **1844 — ללא שינוי** |

---

## 1 · סיכום

הסבב פתח ב-baseline — `tests/rules/anonymousAccess.test.mjs` מול החוקים *הקיימים*, לפני שנגעתי בהם. הוא נכשל ב-5 מקומות, וכל אחד הוא ניסוח מדויק של פער:

```
// BASELINE — החוקים כפי שהיו, 24.09 17:15
ok  1..5   guest CAN browse clubs / games / config
not ok  6  guest CANNOT read another person's private user document
not ok  7  guest CANNOT enumerate the user base
not ok  8  guest CANNOT read cross-club stat rollups
not ok 11  guest CANNOT write anything
not ok 12  usersPublic is world-readable
ok 13..16  full account keeps everything
# tests 16  # pass 11  # fail 5
```

אחרי השינוי: **17 מתוך 17**.

### בוצע

- **`isFullAccount()`** — helper אחד, מוגדר פעם אחת, על פי `sign_in_provider`.
- **`/usersPublic/{uid}`** — מראה ציבורית של ארבעה שדות, קריאה לכולם, כתיבה לאף אחד.
- **`syncUserPublic`** — טריגר שמחזיק אותה מסונכרנת, כולל מחיקה.
- **`/users` פוצל** ל-`get` / `list` / `create`, כולם מאחורי חשבון מלא.
- **חמש קולקציות** עברו ל-`isFullAccount()`.
- **מיגרציית לקוח אחת** — הרוסטר של מסך המשחק.
- **סקריפט backfill** — נכתב, **לא הורץ**.

> ⚠️ **שינוי אחד שלא ביקשת, ואני חושב שהוא נדרש**
>
> `getUserById` תופס דחייה ומדווח אותה ל-`logError`. אחרי ההידוק, אורח שנוגע בשורת שחקן מייצר `permission-denied` **מתוכנן** — ולוג השגיאות בפרודקשן היה מתמלא בו. עטפתי ב-`isExpectedDenial` הקיים. זו תוצאה ישירה של השינוי שלי, לא scope חדש.

### לא נגעתי

`RootNavigator`, אתחול אורח שקט, onboarding, `guestGate`, מסלול auth, `PendingAction`, טיוטות, טפסי יצירה, push, deep links, Hosting, האתר, דפי הנחיתה, `/i/`. **ולא פרסתי כלום.**

---

## 2 · Before / After — מטריצת הגישה

| קולקציה | פעולה | אורח לפני | | אורח אחרי | חשבון מלא | סיווג |
|---|---|---|---|---|---|---|
| `/users/{other}` | get | ❌ ALLOW | → | ✅ DENY | ALLOW | Private |
| `/users` | list | ❌ ALLOW | → | ✅ DENY | ALLOW | Private |
| `/users/{self}` | create | ❌ ALLOW | → | ✅ DENY | ALLOW | Private |
| `/usersPublic` | get | לא קיים | → | ✅ ALLOW | ALLOW | **Public** |
| `/usersPublic` | list | לא קיים | → | ✅ DENY | ALLOW | Public + מונע מניית |
| `/rounds` | read | ❌ ALLOW | → | ✅ DENY | ALLOW | Authenticated |
| `/playerStats` | read | ❌ ALLOW | → | ✅ DENY | ALLOW | Authenticated |
| `/ratings` | read | ❌ ALLOW | → | ✅ DENY | ALLOW | Authenticated |
| `/pairStats` | read | ❌ ALLOW | → | ✅ DENY | ALLOW | Authenticated |
| `…/seasonTitles` | read | ❌ ALLOW | → | ✅ DENY | ALLOW | Authenticated |
| `/groupsPublic` | get + list | ALLOW | = | ✅ ALLOW | ALLOW | **Public** |
| `/communityShowcase` | get | ALLOW | = | ✅ ALLOW | ALLOW | **Public** (גם מנותק) |
| `/games` ציבורי | get + query | ALLOW | = | ✅ ALLOW | ALLOW | **Public** |
| `/games` מועדון | get | DENY | = | ✅ DENY | חברים | Member-scoped |
| `/campaigns` | list | ALLOW | = | 🟡 ALLOW | ALLOW | Public — ראו §11 |
| `/appConfig` | get | ALLOW | = | ✅ ALLOW | ALLOW | **Public** (גם מנותק) |
| `/notifications` | get | DENY | = | ✅ DENY | בעלים | Private |
| `/friendRequests` | get | DENY | = | ✅ DENY | צדדים | Private |
| כל כתיבה | write | DENY* | → | ✅ DENY | לפי הכלל | — |

\* למעט יצירת מסמך משתמש משלו, שהייתה מותרת. ראו §12.

---

## 3 · usersPublic — ארבעה שדות, ולמה בדיוק הם

```
/usersPublic/{uid} = {
  id:        string   // = document id
  name:      string   // display name
  avatarId?: string   // built-in avatar
  photoUrl?: string   // legacy uploaded photo
}
```

> ✅ **ה-allowlist לא הומצא — הוא כבר היה בקוד**
>
> `src/components/UserAvatar.tsx:28` מגדיר את ה-prop שלו כ-`Pick<User, 'id'|'name'|'avatarId'|'photoUrl'>`. זה הרכיב **היחיד** שמצייר אדם על משטח ציבורי, ולכן ה-Pick שלו *הוא* החוזה הציבורי. משטח שצריך שדה חמישי אינו משטח ציבורי.
>
> `photoUrl` נכלל אף שהוא deprecated: משתמשים ותיקים עדיין נשענים עליו, והשמטתו הייתה שוברת להם את התמונה בכל מסך ציבורי. הוא URL לאובייקט Storage ציבורי — מזהה אווטאר, לא מידע פרטי.

**מה לא הועתק:** `email` · `phone` · `fcmTokens` · `availability` · `stats` · `invitedBy` · `invitedByType` · `acquisition` · `discipline` · `achievements` · `qa` · `dmFriendsOnly` · `onboardingCompleted` · `position` · הכול.

**allowlist ולא blacklist**, ובשלושה מקומות במקביל: `USERS_PUBLIC_FIELDS` בטריגר, `publicUserConverter` בלקוח, ו-`buildPublic` בסקריפט. שדה שיתווסף ל-`/users` לא יכול להתפרסם בטעות באף אחד מהם — הוא פשוט לא נקרא.

הקורא בלקוח בונה שדה-שדה בכוונה, כמו יתר ה-converters בקובץ: שדה שיתווסף למראה *לא עושה כלום* בקריאה עד שיתווסף גם שם. זו ההתנהגות הרצויה להקרנה ציבורית — ובדיוק המלכודת שעקצה במצב טיוטה של 1.0.85.

---

## 4 · סנכרון — טריגר, ולא dual-write

ביקשת שאבחר לפי הקוד בפועל ואסביר. **אין abstraction מרכזית אחת**, ולכן dual-write אינו אפשרי בבטחה:

| מסלול כתיבה ל-`/users` | איפה |
|---|---|
| חמישה ענפי התחברות (`setDoc(ref, fresh)`) | `userService.ts:166, 282, 329, 374, 417` |
| `updateProfile` | `userService.ts:840` |
| `recoverMissingUserDoc` | `userService.ts:478` |
| **Admin SDK — עוקף חוקים לגמרי** | `functions/src/index.ts:2318, 4238, 4258` ועוד |

שמונה מסלולים ומעלה, ושלושה מהם בצד השרת. dual-write היה צריך להיזכר בכל אחד מהם, לתמיד — והאחד ששוכח משאיר שם ציבורי שחולק בשקט על האמיתי. **הוא גם היה מחייב ש-`/usersPublic` יהיה ניתן לכתיבה מהלקוח**, ולקוח שיכול לכתוב את המראה יכול לפרסם כל שם תחת כל uid.

```
export const syncUserPublic = onDocumentWritten('users/{uid}', …)

  !after                       → delete usersPublic/{uid}
  before && !fieldsChanged()   → return        // שומר
  otherwise                    → set(buildUsersPublic(...), {merge:false})
```

- **שומר על שינוי שדות** — מסמך משתמש נכתב על כל עריכת זמינות, עדכון טוקן ו-presence ping. בלי השומר הטריגר היה רץ אלפי פעמים ביום כדי לכתוב מסמך שלא השתנה. אותו דפוס כמו `showcaseGroupFieldsChanged` הקיים.
- **`merge: false`** — המראה *נבנית מחדש* בכל פעם. מיזוג היה מאפשר לשדה שנכתב פעם לשרוד אחרי שהוצא מה-allowlist.
- **מחיקה משקפת מחיקה** — חשבון שנמחק לא משאיר שם ציבורי מאחור.

זהו הדפוס שכבר עובד ל-`/communityShowcase`, שעושה בדיוק את אותו דבר למועדונים.

---

## 5 · משתמשים קיימים — backfill נכתב, לא הורץ

הטריגר מטפל מרגע הפריסה, אבל רק במי שנכתב אחריה. מי שלא יערוך פרופיל שוב לעולם — לא תהיה לו מראה כלל, וכל משטח ציבורי יציג אותו כשם ריק.

**`scripts/backfillUsersPublic.mjs`** — 239 שורות, בסגנון `backfillClubPairs.mjs` הקיים (REST + `gcloud auth print-access-token`).

| דרישה | איך |
|---|---|
| dry-run כברירת מחדל | `--live` הוא הדבר היחיד שכותב |
| idempotent | משווה לשדה ומדלג על מראה זהה. הרצה שנייה = `+0 ~0` |
| allowlist בלבד | `buildPublic()` — עותק של `buildUsersPublic` שבטריגר |
| batch בטוח | 300 לעמוד קריאה, 400 לכל commit (המגבלה 500) |
| pagination | `orderBy __name__` + cursor — מזהים יציבים וייחודיים |
| resume-safe | `--after <uid>`. הסקריפט מדפיס את המזהה האחרון בסיום |
| לא דורס מידע לא קשור | המראה שייכת לשרת במלואה. שדה חורג מדווח לפני שנדרס |
| `runQuery` ולא `list` | ה-REST list מגיש תצוגה ישנה — נשרפנו על זה בעבר |

> ⚠️ **הפקודות — לא הרצתי אף אחת**
>
> ```bash
> # 1 · dry run מלא — קורא, לא כותב
> node scripts/backfillUsersPublic.mjs
>
> # 2 · canary — 50 משתמשים אמיתיים, ואז עצירה
> node scripts/backfillUsersPublic.mjs --live --limit 50
>
> # 3 · הכל
> node scripts/backfillUsersPublic.mjs --live
>
> # 4 · אימות — צריך להדפיס +0 ~0
> node scripts/backfillUsersPublic.mjs
> ```
>
> **הסדר חשוב:** הטריגר חייב להיפרס *לפני* ה-backfill. אחרת כל מי שיערוך פרופיל בין השניים יקבל מראה, והסקריפט יראה אותה כשונה ויכתוב שוב — לא מזיק, רק בזבוז. ועדיין, קודם טריגר.

---

## 6 · מיגרציות לקוח — אחת. בדיוק אחת.

סיווגתי את כל 30+ אתרי הקריאה של `/users`. רובם `docs.user(self)` — לא מושפעים. השאר:

| אתר קריאה | מה נקרא | סיווג | פעולה |
|---|---|---|---|
| `gameStore.hydratePlayers:106` | הרוסטר במסך משחק | **Public presentation** | ✅ הועבר |
| `groupService.hydrateUsers:1866` | רוסטר מועדון (4 קוראים) | Authenticated | נשאר |
| `CommunityPlayersScreen:110` | שחקני מועדון + קלפים | Member-scoped | נשאר |
| `CommunityDetailsScreen:208` | חברי מועדון | Member-scoped | נשאר |
| `AdminApprovalScreen:69` | תור אישורים | Admin | נשאר |
| `ChemistrySection:101` | כימיה במועדון | Member-scoped | נשאר |
| `userService:886,921` | `invitedBy` — ההפניות שלי | Authenticated | נשאר |
| `userService:708` | חיפוש זמינות (filler) | Authenticated | נשאר |
| `disciplineService:161,409` | קלף על שחקן אחר | Admin | נשאר |
| `getUserById` — 30 קוראים | פרופיל / צ'אט / סטטיסטיקות | Authenticated | נשאר · ראו §11 |

> ⛔ **המיגרציה הזו הייתה חובה — בלעדיה שברתי משהו שעובד היום**
>
> `hydrateUsers` היא **שאילתת LIST** על `/users`. אורח יכול היום לפתוח משחק ציבורי, והרוסטר שלו עובר דרכה. ברגע ש-`list` עבר ל-`isFullAccount()`, המסך הזה היה מציג שמות ריקים לכל אורח.
>
> `hydratePlayers` צורכת **בדיוק** `id, name, photoUrl, avatarId` — ה-allowlist מילה במילה. לכן היא עברה ל-`hydratePublicUsers`, ו-`hydrateUsers` נשארה כפי שהיא עבור ארבעת הקוראים המאומתים.

### `hydratePublicUsers` — שני מסלולים, בכוונה

- **חשבון מלא** — אותה שאילתה מקובצת `documentId() in`. האופטימיזציה חשובה: רוסטר של 200 חברים הוא ~7 שאילתות ולא 200 קריאות מחויבות.
- **אורח** — קריאה לכל מסמך, כי `list` על המראה חסום לו. הוא מסתכל על משחק אחד — כמה עשרות קריאות, לא מאתיים.

הענף נקבע מ-`getFirebase().auth.currentUser?.isAnonymous` ולא מה-store: המודול יושב מתחת ל-store בגרף הייבוא ואסור לו לפנות כלפי מעלה.

---

## 7 · Rules — כל כלל ששונה

```
+ function isFullAccount() {
+   return isSignedIn()
+     && request.auth.token.firebase.sign_in_provider != 'anonymous';
+ }

  match /users/{uid} {
-   allow read:   if isSignedIn();
+   allow get:    if isSelf(uid) || isFullAccount();
+   allow list:   if isFullAccount();
-   allow create: if isSelf(uid) && …
+   allow create: if isFullAccount() && isSelf(uid) && …

+ match /usersPublic/{uid} {
+   allow get:   if true;
+   allow list:  if isFullAccount();
+   allow write: if false;
+ }

  /rounds · /playerStats · /ratings · /pairStats · …/seasonTitles
-   allow read: if isSignedIn();
+   allow read: if isFullAccount();
```

**למה `get` ו-`list` בנפרד:** `allow read` אחד היה נותן את החזק ביחד עם החלש. הם עונים על שאלות שונות — לפתור שם לפי מזהה זה מה שרוסטר צריך; למנות את כל בסיס המשתמשים זה דבר אחר לגמרי.

**למה לא `.get('firebase', {}).get(...)`:** הצורה ההגנתית עולה תקציב ביטויים, ו-`/games` כבר יושב על תקרת 1000 הביטויים — שתיים משלוש הנפילות הקיימות הן בדיוק זה. ובדקתי אמפירית שהבלוק תמיד קיים, אז הצורה הישירה לא יכולה לשגות.

### overlapping match — נבדק, כפי שדרשת

`firestore.rules:2314` מתעד ש-Firestore עושה **OR** בין בלוקי `match` חופפים, ושהספציפי *לא* מנצח — בפעם הקודמת בלוק מתירני ביטל בשקט אחד שגודר בחברות.

| קולקציה | בלוקים |
|---|---|
| `/users/{uid}` ברמה העליונה | 1 |
| `/usersPublic` · `/rounds` · `/playerStats` · `/ratings` · `/pairStats` | 1 כל אחת |
| `/campaigns` · `/groupsPublic` · `/games` | 1 כל אחת |
| catch-all `match /{doc=**}` | **0** |

חמשת הבלוקים הנוספים תחת `/users/` הם תת-קולקציות (`campaignSeen`, `chatUnread`, `chatSettings`, `seasonTitles`, `blocked`) — נתיבים שונים, לא חפיפה.

---

## 8 · שאילתות — אמיתיות, לא `getDoc`

חוק יכול לעבור `getDoc` ועדיין לדחות את שאילתת הקולקציה. כל אלה נבדקו בצורה שבה האפליקציה מריצה אותן:

| שאילתה | מי מריץ | אורח | מלא |
|---|---|---|---|
| `col.groupsPublic()` — הקולקציה כולה | פיד המועדונים | ✅ ALLOW | ALLOW |
| `where('visibility','==','public')` | פיד המשחקים | ✅ ALLOW | ALLOW |
| `where('participantIds','array-contains',uid)` | "המשחקים שלי" | — | ✅ ALLOW |
| `usersPublic where(documentId(),'in',[…])` | רוסטר מקובץ | ✅ DENY | ✅ ALLOW |
| `usersPublic` — לפי מזהה | רוסטר של אורח | ✅ ALLOW | ALLOW |
| `users` — הקולקציה כולה | אף אחד (בדיקת חשיפה) | ✅ DENY | ALLOW |
| `campaigns` — list | פופאפים | ✅ ALLOW | ALLOW |

השאילתה השלישית היא זו שנשברה ב-22.09. נשארה בסוויטה כי היא זולה לשמור עליה.

---

## 9 · בדיקות

| פקודה | תוצאה |
|---|---|
| `npx tsc --noEmit` | ✅ PASS — 0 שגיאות |
| `cd functions && npx tsc --noEmit -p .` | ✅ PASS — 0 שגיאות |
| `npx jest` | ✅ PASS — 138 suites · 1844 בדיקות |
| `npm run test:rules` — **לפני** | 249 · 246 pass · **3 fail** |
| `npm run test:rules` — **אחרי** | 266 · 263 pass · **3 fail** |
| `node --check backfillUsersPublic.mjs` | ✅ PASS |
| lint | 🟡 לא קיים בריפו |

**17 בדיקות חדשות** ב-`anonymousAccess.test.mjs`: טענת ה-provider · מנותק · אורח יכול (מועדונים / משחקים / config) · אורח לא יכול (מסמך פרטי / מניית / רולאפים / משחק מועדון / פרטי / כתיבה) · `usersPublic` · הרוסטר לשני סוגי הצופה · חשבון מלא שומר על הכול · `get` ו-`list` · חבר קורא משחק מועדון · בעלים קורא וכותב את שלו.

---

## 10 · נפילות קיימות — בדיוק שלוש, ואותן שלוש

```
not ok  69 - games: self can join an open community game
not ok  83 - groupsPublic: admin of canonical group can create the public mirror
not ok 128 - OLD-CLIENT manual-offer cancel: B removes self AND sets pendingPromotion…

# tests 266  # pass 263  # fail 3
```

שמות זהים לתיעוד ב-`tests/rules/README.md`. מספרי ה-`ok` זזו (69/83/128 במקום 52/66/111) רק כי 17 בדיקות חדשות נכנסו לפניהן בסדר הריצה. **לא נגעתי בהן ולא הסתרתי אותן.**

> **מדוע 249 הבדיקות הקיימות לא הושפעו:** כולן משתמשות ב-`authenticatedContext(uid)` ללא אפשרויות, וה-provider שם הוא `'custom'` — אמפירית, לא בהנחה. לכן כולן נקראות כחשבון מלא ועוברות את `isFullAccount()` בלי שינוי.

---

## 11 · לא הכרעתי — שלושה דברים

> ⚠️ **1 · אורח יכול להגיע לכרטיס שחקן — וכעת הוא יתרוקן**
>
> `MatchDetailsScreen` מנווט ל-`PlayerCard` בארבעה מקומות (`3137, 3303, 3383, 3628`) **בלי `ensureNotGuest`**. אורח שנוגע בשורת משתתף במשחק ציבורי מגיע לשם.
>
> הכרטיס קורא `getUserById`, `playerStats` ו-`pairStats` — שלושתם עכשיו לחשבון מלא. **לפני** השינוי אורח ראה את כל הכרטיס, כולל הדירוג והסטטיסטיקות של אדם זר. **אחרי** — הכרטיס נטען אך מתרוקן. כל הקריאות עטופות ב-`catch`, אז אין קריסה.
>
> זו החלטת מוצר, לא נתונים: **האם אורח אמור לראות כרטיס שחקן בכלל?** שלוש אפשרויות — לחסום את הניווט, להעביר את השם והאווטאר למראה ולהשאיר את הסטטיסטיקות ריקות, או להשאיר כפי שהוא. לא ניחשתי.

> ⚠️ **2 · מסמך קמפיין נושא את הסגמנט שלו**
>
> בדקתי כפי שביקשת. `campaignService.ts:233` קורא `raw.segment` ומריץ `matchSegment` **על המכשיר**. כלומר מסמך הקמפיין כולל את הגדרת המיקוד: `daysSinceActive`, `hasPush`, `provider`, `city`, `inGroup` וסף המשחקים.
>
> **זו ארכיטקטורה מכוונת ולא דליפה** — המיקוד חייב להיות זמין ללקוח כדי לרוץ שם. אבל זה כן אומר שכל מי שמתקין את האפליקציה יכול להוריד את לוגיקת המיקוד השיווקי. אין בו PII. השארתי כפי שהוא: הידוק היה דורש הקרנה `campaignsPublic` או מעבר לצד שרת, שניהם מחוץ לסבב ושניהם עלולים לשבור פופאפים.

> **3 · `/groups` ו-`/communityPairStats` — לא נגעתי**
>
> `/groups` כבר מגודר בחברות (`firestore.rules:510`) ואורח נדחה. ארבעת הרולאפים המועדוניים גודרו כבר בביקורת P0-1. לא היה מה להדק, ולא הידקתי — **עדיף כלל שנשאר רחב עוד סבב על פני שבירה על סמך הנחה**, כפי שכתבת.

---

## 12 · ממצאים

> ⛔ **1 · אורח יכול ליצור מסמך משתמש — לא ציפיתי לזה**
>
> ה-baseline תפס את זה. `allow create: if isSelf(uid)` — **ו-uid אנונימי הוא "עצמו"**. הלקוח לא עושה זאת (`getCurrentUser` בודק `isAnonymous` ויוצא לפני היצירה העצלה), אבל החוק התיר.
>
> ברגע שכל התקנה טרייה מקבלת סשן, **כל אחת מהן הייתה יכולה לכתוב מסמך משתמש זבל** — ישירות, או דרך גרסת לקוח עתידית ששוכחת את הבדיקה. נסגר ב-`isFullAccount() && isSelf(uid)`.

> ⛔ **2 · ההידוק היה שובר את הרוסטר לאורחים**
>
> מתואר ב-§6. `hydrateUsers` היא שאילתת *list*, והרוסטר במסך משחק ציבורי — שאורח כבר מגיע אליו היום — עובר דרכה. בלי המיגרציה הייתי סוגר חור פרטיות ושובר מסך קיים באותה תנועה.

> ✅ **3 · ה-token — נמדד, לא הונח**
>
> הרצתי probe ייעודי מול האמולטור לפני שכתבתי את ה-helper:
>
> ```
> authenticatedContext(uid)                   → 'custom'
>   {firebase:{sign_in_provider:'anonymous'}}  → 'anonymous'
>   {firebase:{sign_in_provider:'google.com'}} → 'google.com'
> custom claims, ללא בלוק firebase             → 'custom'
> ```
>
> שתי מסקנות: הבלוק **תמיד קיים**, ולכן הביטוי לא יכול לשגות; וברירת המחדל היא `custom`, ולכן **249 הבדיקות הקיימות עוברות בלי נגיעה**. בלי הבדיקה הזו הייתי צריך לנחש את שתיהן.

---

## 13 · Diff

| קובץ | + | − | למה |
|---|---|---|---|
| `firestore.rules` | 107 | 11 | `isFullAccount` · `usersPublic` · 7 כללים |
| `functions/src/index.ts` | 102 | 0 | `syncUserPublic` + ה-allowlist |
| `src/services/groupService.ts` | 61 | 1 | `hydratePublicUsers` |
| `src/firebase/firestore.ts` | 53 | 0 | `PublicUser` + converter + `col` |
| `src/services/userService.ts` | 8 | 1 | דחייה צפויה לא מדווחת כתקלה |
| `src/store/gameStore.ts` | 8 | 1 | המיגרציה |
| `tests/rules/anonymousAccess.test.mjs` | 369 | 0 | חדש |
| `scripts/backfillUsersPublic.mjs` | 239 | 0 | חדש |
| **סה"כ** | **947** | **14** | 8 קבצים |

### Quality gate — 10 הבדיקות

1. **diff מלא נסקר.** ✔
2. **typecheck** אפליקציה + functions. ✔
3. **jest** 1844. ✔
4. **rules** 266 · 263 · 3. ✔
5. **match כפול** — אין, ואין catch-all. ✔
6. **קריאות לקוח מ-`/users`** — 30+ סווגו, אחת הועברה. ✔
7. **כותבי name/avatar** — 8+ מסלולים כולל Admin SDK; לכן טריגר. ✔
8. **הוכחה שאורח לא קורא מסמך פרטי** — בדיקות 6+7, עם `email`/`fcmTokens`/`phone` בזרע. ✔
9. **הוכחה שה-browse עדיין עובד** — בדיקות 3,4,5,13. ✔
10. **הנפילות נשארו 3.** ✔

6 הקבצים מהסבב הקודם (`pendingAction`, `draftStore`, המכונה והבדיקות שלהם) לא נגעו בהם — אומת לפי חותמות זמן. `userService.ts` נגוע בשני הסבבים: `resetIdentity` בקודם, הדחייה הצפויה בזה.

---

## 14 · הסבב הבא — המלצה בלבד

הסדר שאני מציע, והוא לא "לפרוס ואז לבנות":

1. **להכריע את שאלת כרטיס השחקן** (§11.1). היא משפיעה על מה שנפרס.
2. **לפרוס את `syncUserPublic` לבדו.** הוא לא נוגע בשום מסלול קיים ואין לו קוראים — אפס סיכון.
3. **להריץ את ה-backfill** — dry-run, canary של 50, ואז הכול. באישורך המפורש.
4. **לאמת שהמראה מלאה** לפני שהחוקים נפרסים.
5. **ואז לפרוס את החוקים.**
6. **ואז PR 3** — הצרכן מקבל אורחים, על התשתית של הסבב הקודם.

> ⚠️ **הסדר הוא כל העניין**
>
> החוקים והמראה תלויים זה בזה בכיוון אחד בלבד: **המראה חייבת להתמלא לפני שהחוקים מהדקים**. הפוך — כל אורח שפותח משחק ציבורי רואה רוסטר של שמות ריקים, וזה לא יזעק בשום לוג.

**לא אמשיך ל-navigation או ל-onboarding בלי אישור מפורש.**

---

*ענף `perf/firestore-read-costs`, 24.09.2026. לא הוקמט ולא נפרס — לא חוקים, לא פונקציות, לא hosting. ה-backfill נכתב ו**לא הורץ**. 1844 בדיקות jest ו-263 מתוך 266 rules עוברות; שלוש הנפילות קיימות, מתועדות, וללא שינוי בכמות.*
