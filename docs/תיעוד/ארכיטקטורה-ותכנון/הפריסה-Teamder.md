# הפריסה שנעצרה — Teamder

**דוח rollout · נעצר בשלב F**

| | |
|---|---|
| תאריך | 24.09.2026 |
| פרויקט | `soccer-app-52b6b` |
| נפרס | `syncUserPublic` בלבד + backfill מלא |
| **לא נפרס** | `firestore.rules`, hosting, כל פונקציה אחרת |

---

## למה עצרתי

ספרתי את החשבונות האנונימיים בפרודקשן לפני הפריסה: **416 קיימים, 34 פעילים בשבוע האחרון, 75 בחודש.**

הבינארי שבחנויות נבנה מ-`3cba4766` — **לפני** העבודה של היום. הוא עדיין קורא את הרוסטר דרך `hydrateUsers`, שהיא שאילתת *list* על `/users`. ברגע שהכללים מהדקים, כל אחד מ-34 האנשים האלה פותח משחק ציבורי ורואה **רוסטר של שמות ריקים**, וכרטיס שחקן בלי שם — עד שתצא גרסה חדשה והם יעדכנו.

זה לא כישלון בדיקה. זה נזק צפוי שהמספרים חשפו בזמן, וכתבת: *"אני מעדיף rule אחד שנשאר רחב עוד סבב על פני שבירת production על סמך הנחה."* לכן **לא פרסתי את `firestore.rules`**. כל השאר — כן.

| שלב | מצב | מה |
|---|---|---|
| A | ✅ בוצע | PlayerCard — variant לאורח בתוך המסך הקיים |
| B | ✅ בוצע | אימות מלא לפני פריסה — ארבע סוויטות |
| C | ✅ **נפרס** | `syncUserPublic` בלבד · אומת על חשבון QA |
| D | ✅ בוצע | dry-run → canary 50 → מלא → אימות `+0 ~0` |
| E | ✅ בוצע | Integrity audit · 708/708 |
| F | 🟡 **מוחזק** | **פריסת הכללים — לא בוצעה** |
| G | ✅ חלקי | אימות של מה שכן נפרס · אפס שגיאות |

---

## 1 · PlayerCard — הענף כבר היה שם

לא נדרש מסך חדש ולא refactor. למסך כבר הייתה הסתעפות שלושת-כיוונים, והשלישית הייתה **`// Not signed in — minimal identity only`** — זהות בלבד. הבעיה: `me` *אמיתי* עבור אורח (סשן אנונימי הוא עדיין סשן), אז הוא נפל לענף השני.

```
// חמישה שינויים, כולם מוכלים
+ const isGuestViewer = me?.isGuest === true;
+ טעינת זהות מסתעפת:  usersPublic  |  getUserById
+ referral count  — מדולג לאורח (LIST על /users)
+ getMyGames      — מדולג לאורח (הוא לא מזמין אף אחד)
+ ענף אורח מוחזר לפני כל חישוב שנשען על user.
```

| | אורח | חשבון מלא |
|---|---|---|
| אווטאר + שם | ✅ כן, מ-`usersPublic` | כן, מ-`/users` |
| סטטיסטיקות, הישגים, כימיה | הודעה קצרה במקום | הכל, ללא שינוי |
| קריאות ל-`/users` | ✅ 0 | כרגיל |
| `/playerStats` · `/ratings` · `/pairStats` | ✅ 0 | כרגיל |
| permission-denied מכוון | ✅ אפס | — |
| Back | רגיל — שום דבר לא מונח מעל | רגיל |
| auth popup אוטומטי | ✅ אין | — |

> ✅ **ה-Pick הזה שוב:** `PlayerIdentity` מקבל `Pick<User,'id'|'name'|'avatarId'|'photoUrl'>` — **בדיוק** הטיפוס של `PublicUser`. המראה נופלת פנימה בלי שורת התאמה אחת. פעם שלישית שאותו Pick מתברר כחוזה הציבורי הנכון.

**הניסוח:** *"הסטטיסטיקות, ההישגים והמשחקים המשותפים מופיעים אחרי התחברות"* — בכוונה לא *"נדרשת הרשמה"*. שום דבר לא נחסם; האדם נגע בשם וקיבל את השם. ה-CTA משני, אופציונלי, ולא חוסם Back.

**מסלול החשבון המלא לא זז.** ענף האורח חוזר לפני כל שורה שנשענת על המסמך המלא.

---

## 2 · בדיקות לפני הפריסה

| פקודה | תוצאה |
|---|---|
| `npx tsc --noEmit` | ✅ PASS · 0 |
| `cd functions && npx tsc --noEmit -p .` | ✅ PASS · 0 |
| `npx jest` | ✅ PASS · 138 suites · **1844** |
| `npm run test:rules` | **268** · 265 pass · **3 fail** |

**מול ה-baseline שביקשת:** jest נשאר 1844 — לא הוספתי בדיקות jest, כי המסך לא ניתן לרינדור ב-`testEnvironment: 'node'`. במקום זה הוספתי **שתי בדיקות rules** שמקבעות את חוזה הנתונים של הכרטיס: 266 → 268, שתיהן עוברות, הנפילות נשארו 3.

---

## 3 · הפריסה — פונקציה אחת, ותו לא

```
firebase deploy --only functions:syncUserPublic --project soccer-app-52b6b
✔ functions[syncUserPublic(us-central1)] Successful create operation.
```

v2, us-central1, 256MiB, nodejs20, טריגר `document.v1.written` על `users/{uid}`.

> ✅ **הוכחה ששום דבר אחר לא זז:** קראתי את חותמת הזמן של ה-ruleset החי ישירות מ-API: `cloud.firestore → last updated 2026-09-22T07:11:58Z`. זה התאריך של תיקון ה-`is list` מלפני יומיים. **הכללים בפרודקשן הם עדיין הישנים.** לא נגעתי ב-hosting ולא בפונקציה אחרת.

### אימות על חשבון ה-QA בלבד

| # | מה | ציפייה | תוצאה |
|---|---|---|---|
| 1 | כתיבה לשדה *מחוץ* ל-allowlist (`updatedAt`) | השומר עוצר — אין מראה | ✅ HTTP 404 |
| 2 | `avatarId` `a05 → a06` | מראה נוצרת | ✅ 3 שדות בדיוק |
| 3 | `avatarId` `a06 → a05` | מראה עוקבת | ✅ a05 |

```
  document id : BWBbCQe2CMeeza3Je46pTZoLp7g1
  FIELDS      : ['avatarId', 'id', 'name']       // המקור נושא 23
    avatarId  = a05
    id        = BWBbCQe2CMeeza3Je46pTZoLp7g1
    name      = QA · בדיקות ג'וריו
```

`photoUrl` הושמט נכון — למקור אין. המקור חזר ל-23 שדות ו-`avatarId=a05`, בדיוק כפי שהיה.

> ⚠️ **מה לא נבדק בפרודקשן — מסלול המחיקה.** הדרך היחידה לבדוק הייתה ליצור מסמך משתמש סינתטי ואז למחוק — אבל יצירה מפעילה גם את `onNewUserJoined`, שסורק אחר ייחוס ופונה ל-Joryio. לא ייצרתי את זה בפרודקשן בשביל בדיקה. הקוד נקרא ונבדק; המסלול יאומת בפעם הראשונה שמישהו באמת מוחק חשבון.

---

## 4–6 · Backfill — ארבעה צעדים, אף אחד לא דולג

| שלב | פקודה | scanned | +created | ~updated | unchanged |
|---|---|---|---|---|---|
| **D1** dry run | `backfillUsersPublic.mjs` | 708 | 707 | 0 | 1 |
| **D2** canary | `--live --limit 50` | 50 | 50 | 0 | 0 |
| **D3** מלא | `--live` | 708 | 657 | 0 | 51 |
| **D4** אימות | `backfillUsersPublic.mjs` | 708 | **0** | **0** | 708 |

המספרים סוגרים בדיוק: 1 (מהטריגר) + 50 (canary) = 51 שלא נגענו בהם בהרצה המלאה, ו-657 + 51 = 708. **D4 החזיר `+0 ~0`** — אידמפוטנטיות מוכחת, לא מוצהרת.

### אימות ה-canary — קריאה חוזרת של כל 50

```
  mirrors now: 51                          (1 טריגר + 50 canary)
  fields outside the allowlist : 0
  PRIVATE fields present       : 0   <<< חייב להיות 0
  id != documentId             : 0
  name != source               : 0
  avatar != source             : 0
```

בדקתי מול רשימה מפורשת של 17 שדות פרטיים — `email`, `phone`, `fcmTokens`, `invitedBy`, `acquisition`, `availability`, `stats`, `discipline`, `qa` ועוד. **אף אחד לא הופיע באף מראה.** דגימה אמיתית:

```
04gRDnKxSf…  {avatarId:'a14', id:'04gRDnKxSf…', name:'סמי',
              photoUrl:'https://firebasestorage…/avatar.jpg'}
04mAZzonuC…  {avatarId:'a05', id:'04mAZzonuC…', name:'יוסף לימה'}
07CyV1JWgk…  {avatarId:'a03', id:'07CyV1JWgk…', name:'Tal Degani'}
```

---

## 7 · Integrity audit — 708 מול 708

כתבתי `scripts/auditUsersPublic.mjs` — קריאה בלבד, לעולם לא כותב, ויוצא בקוד שגיאה כשיש ממצא כדי שאפשר יהיה לשער בו צעד פריסה.

```
  /users                  708
  /usersPublic            708

  missing mirrors           0
  orphan mirrors            0
  extra fields              0
  id != documentId          0
  blank name               10
  avatar mismatch           0
```

> **10 השמות הריקים — לא משתמשים בכלל**
>
> המראה נאמנה למקור: **ב-`/users` עצמו השם ריק**. חקרתי את כל העשרה ולכולם אותה צורה:
>
> ```
> 9OeLP5zjwDNpe8jvREk7iWtTx573   ['achievements', 'updatedAt']
> DapmdRIKdlZ6bqc9aEn6H9cDSi73   ['achievements', 'updatedAt']
> dt_admin                       ['achievements', 'newGameSubscriptions', 'updatedAt']
> rg_caller / rg_creator         ['achievements', 'newGameSubscriptions', 'updatedAt']
> rgtest_owner / rgtest_player   ['achievements', 'updatedAt']
> ```
>
> שניים-שלושה שדות בלבד, בלי `email`, בלי `name`, בלי `createdAt`. **אלה לא חשבונות** — הם מסמכי-קצה שנוצרו כש-`achievementsService` כתב `merge:true` על uid שאין לו מסמך. חמישה נושאים מזהים סינתטיים לגמרי (`dt_admin`, `rg_*`, `rgtest_*`) — **פיקסצ'רים של בדיקות שדלפו לפרודקשן**.
>
> כפי שביקשת — **לא המצאתי תיקון**. אין להם השפעה: הם לא מופיעים באף רוסטר.

---

## 8 · הכללים — לא נפרסו

| חשבונות אנונימיים ב-Firebase Auth | |
|---|---|
| סה"כ | 416 |
| **פעילים ב-7 הימים האחרונים** | **34** |
| 8–30 ימים | 41 |
| 31–90 ימים | 263 |
| מעל 90 ימים | 78 |

(מתוך 1,104 חשבונות auth בסך הכול.)

### מה היה קורה

| שינוי בכללים | השפעה על אורח בבינארי ישן |
|---|---|
| `/usersPublic` — בלוק חדש | ✅ אין — שום קוד ישן לא קורא אותו |
| `/users` — שער `create` | ✅ אין — שום לקוח לא יוצר כאורח |
| `/users` — `get` + `list` | ❌ **רוסטר ריק** וכרטיס שחקן בלי שם |
| חמש קולקציות הסטטיסטיקה | 🟡 כרטיס מתרוקן |

שקלתי לפרוס רק את שתי השורות הבטוחות ולהחזיק את השאר. **לא עשיתי זאת**: פיצול קובץ הכללים לשתי פריסות מוסיף סיכון משלו, ולשני החלקים הבטוחים אין דחיפות — הם לא עושים כלום עד שהשאר נפרס.

---

## 9 · Smoke tests — לא הורצו מול פרודקשן, ובכוונה

ה-smoke tests שהגדרת מבדילים בין אורח לחשבון מלא. **מול פרודקשן הם חסרי משמעות כרגע**: הכללים החיים הם הישנים, ובהם אורח וחשבון מלא זהים לחלוטין. הם היו עוברים מבלי להוכיח דבר.

אותם תרחישים בדיוק כן רצו — מול הכללים החדשים באמולטור, ב-`tests/rules/anonymousAccess.test.mjs`:

| תרחיש | אורח | חשבון מלא |
|---|---|---|
| browse מועדונים ציבוריים (get + list) | ✅ ALLOW | ALLOW |
| browse משחקים ציבוריים (שאילתה אמיתית) | ✅ ALLOW | ALLOW |
| פתיחת משחק ציבורי | ✅ ALLOW | ALLOW |
| **שמות ואווטארים ברוסטר** | ✅ ALLOW לפי מזהה | ALLOW מקובץ |
| קריאת `/users/{uid}` שרירותי | ✅ DENY | ALLOW |
| מניית `/users` | ✅ DENY | ALLOW |
| קולקציות הסטטיסטיקה | ✅ DENY | ALLOW |
| כתיבת `/users/{anonUid}` | ✅ DENY | — |
| פרופיל עצמי נטען ונערך | — | ✅ ALLOW |
| חבר קורא משחק מועדון | ✅ DENY | ✅ ALLOW |

הם ירוצו מול פרודקשן **מיד אחרי** שהכללים ייפרסו — read-only, בלי mutations.

---

## 10–11 · אחרי הפריסה

| בדיקה | תוצאה |
|---|---|
| `npx tsc --noEmit` | ✅ PASS |
| functions typecheck | ✅ PASS |
| `npx jest` | ✅ 1844 / 1844 |
| `npm run test:rules` | 268 · 265 · **3 — בדיוק אותן שלוש** |

### לוגים ונפח כתיבה

```
severity >= WARNING          → אין ולו שורה אחת
retry loops                  → אין
invocations since deploy     3   (שלוש בדיקות ה-QA)
```

> ✅ **האימות שהכי חששתי ממנו:** ה-backfill כתב **707 מסמכים** — והטריגר **לא נורה אפילו פעם אחת** בגללם. הוא מאזין ל-`users/{uid}`, וה-backfill כותב ל-`usersPublic`. אין לולאה, אין מפל, אין נפח בלתי צפוי.

**מדגם של מראות:** 708 בסך הכול; החמש האחרונות נכתבו ב-`15:00:01` — כולן מה-backfill. המראה היחידה שנוצרה על ידי **הטריגר** היא של חשבון ה-QA, ונבדקה שדה-שדה.

---

## 12 · Git — שום דבר לא הוקמט

`perf/firestore-read-costs` · HEAD עדיין `58f0aa5`.

**שונו (12):** `firestore.rules` · `functions/src/index.ts` · `functions/templates/invite.html` · `src/firebase/auth.ts` · `src/firebase/firestore.ts` · `src/i18n/he.ts` · `src/screens/players/PlayerCardScreen.tsx` · `src/services/analyticsService.ts` · `src/services/groupService.ts` · `src/services/joryio.ts` · `src/services/userService.ts` · `src/store/gameStore.ts`

**חדשים (9):** `scripts/auditUsersPublic.mjs` · `scripts/backfillUsersPublic.mjs` · `src/services/draftStore.ts` · `src/services/pendingAction.ts` · `src/utils/pendingActionMachine.ts` · 4 קבצי בדיקות

**667 שורות נוספו, 55 נמחקו** בקבצים המנוהלים, על פני שלושת הסבבים. שלב זה הוסיף: `PlayerCardScreen` +136/−16, `he.ts` +6, ו-`auditUsersPublic.mjs` (151 שורות, חדש).

> ⚠️ **שינוי שהבנייה יצרה לבד:** `functions/templates/invite.html` מופיע כשונה — **ה-build עשה זאת, לא אני.** `functions/scripts/copy-template.js` מעתיק את `public/invite.html` לשם בכל בנייה. כלומר **יש מנגנון סנכרון** לשני קבצי ה-invite, והשוני שדיווחתי בדוח השני היה פשוט עותק ישן. **תיקון לממצא ההוא.**

---

## 13 · ממצאים

> ⛔ **1 · 416 אורחים, 34 פעילים**
>
> לא ציפיתי למספר. הוא מה שהפך את פריסת הכללים מ"הצעד הבא" ל"צעד שממתין לגרסה". הוא גם אומר משהו על המוצר: **יותר מ-400 אנשים בחרו "המשך כאורח" ולא נרשמו** — בדיוק הקהל שכל הריפקטור נועד לשרת.

> ⛔ **2 · עשרה מסמכי-קצה בפרודקשן, חמישה מהם פיקסצ'רים של בדיקות**
>
> `dt_admin`, `rg_caller`, `rg_creator`, `rgtest_owner`, `rgtest_player` — מזהים סינתטיים עם `achievements` ו-`updatedAt` בלבד. נוצרו בידי כתיבת `merge:true` על uid שאין לו מסמך. לא נגעתי.

> ✅ **3 · תיקון לדוח השני — יש סנכרון לתבניות**
>
> דיווחתי ש"אין מנגנון סנכרון ושני הקבצים כבר נבדלים". **יש מנגנון** — `copy-template.js` בצעד ה-build. ההבדל שראיתי היה עותק מקומי ישן, והבנייה של היום סגרה אותו מעצמה.

> ⚠️ **4 · שתי אזהרות מהפריסה**
>
> **Node.js 20 הוצא משימוש ב-30.04.2026 ויפסיק לעבוד ב-30.10.2026** — עוד חודש. אחרי התאריך אי אפשר יהיה לפרוס פונקציות בלי שדרוג. וגם: `firebase-functions` מיושן וכולל breaking changes בשדרוג. שניהם מחוץ לסבב, שניהם לא יכולים לחכות הרבה.

---

## 14 · הסבב הבא — המלצה בלבד

שכבת הנתונים גמורה ומאומתת. מה שחסר הוא **בינארי שיודע להשתמש בה**.

1. **להקמיט את העבודה** — שלושה סבבים יושבים בעץ העבודה בלי commit.
2. **לבנות ולשחרר גרסה** שמכילה את `hydratePublicUsers` ואת ה-variant של PlayerCard. זה התנאי היחיד שנותר.
3. **לחכות לאימוץ** — כמה ימים לפי ההיסטוריה של הריפו.
4. **ואז לפרוס את הכללים** + להריץ את ה-smoke tests מול פרודקשן.
5. **ואז PR 3** — הצרכן מקבל אורחים.

> **שאלה אחת שכדאי להכריע בדרך:** 34 אורחים פעילים על בינארי ישן הם גם טיעון ל**העלאת `minimumSupportedVersion`** אחרי שהגרסה תצא — זה הלחצן שהופך "רוב המשתמשים עדכנו" ל"כולם עדכנו", ומקצר את ההמתנה בשלב 3. לא נגעתי בו.

**לא אתחיל את הסבב הבא בלי אישור מפורש.**

---

*`soccer-app-52b6b`, 24.09.2026. נפרס: `syncUserPublic` בלבד. הורץ: backfill מלא (708 מראות). **לא נפרס:** `firestore.rules`, hosting, כל פונקציה אחרת. שום דבר לא הוקמט.*
