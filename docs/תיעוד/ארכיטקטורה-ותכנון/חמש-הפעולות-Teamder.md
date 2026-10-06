# חמש הפעולות — Teamder

**דוח סבב סגירת Contextual Auth**

| | |
|---|---|
| תאריך | 24.09.2026 |
| ענף | `perf/firestore-read-costs` |
| Checkpoint | `7d986f7` |
| **כללים בפרודקשן** | **לא נפרסו — מאומת** |
| **Build / Release** | **לא בוצע** |

| מדד | ערך |
|---|---|
| jest | **1959** (1925 → **+34**) · 143 suites |
| rules | **268** · 265 pass · **3 fail — אותן שלוש** |
| typecheck | app ✅ · functions ✅ |
| analytics wiring | ✅ 5/5 |

---

## 1 · Checkpoint

```
commit 7d986f7adf28fc407ad00f53c65a5bc77191e2db
Sign in at the moment it matters, and finish what was asked
```

עץ העבודה היה נקי אחריו. אימתתי לפני ה-commit: ruleset חי מ-`2026-09-22T07:11:58Z`, jest 1925, rules 268/265/3, בנייה אחרונה 22.09.

**לא עשיתי push.** עבודת הסבב הזה **לא committed**.

---

## 2 · חוזה חמש הפעולות

| פעולה | PendingAction | Draft | Resumer | תוצאה טרמינלית |
|---|---|---|---|---|
| `join_game` | ✅ | — | ✅ `requestJoinGame` | joined · waitlisted · approval_pending |
| `join_club` | ✅ | — | ✅ `requestJoinById` | joined · approval_pending |
| `create_club` | ✅ | `club` | ✅ `createClubFromValues` | created |
| `create_game` | ✅ | `game` | ✅ `createGameFromValues` | created |
| `save_availability` | ✅ | `availability` | ✅ `persistAvailability` | created |

**כל החמש מקיימות את אותו חוזה.** אין יותר חורים.

---

## 3 · Create Game — לפני ואחרי

### לפני

```
mount → useEffect → ensurePersonalGroup()  ← קבוצה נכתבת בשרת
                                              לפני שמישהו הקליד תו
      → isOrphan = orphanGroup !== null
      → אורח: isGuest → return  →  אין קבוצה  →  isOrphan=false
                                   →  quick-mode gate  →  LOADER אינסופי
      → Save → אורח: park draft → אין resumer → held לנצח
```

### אחרי

```
mount → ensurePersonalGroup רק לחשבון מלא
      → isOrphan = orphanGroup !== null || isGuest   ← quick הוא מצב UI, לא קבוצה
      → אורח רואה את האשף, בלי קבוצה
      → Save → האישורים (מועד עבר / חג) → park draft + targetId
      → auth → profile אם צריך
      → resumer → ensurePersonalGroup תחת ה-uid האמיתי → createGameFromValues
      → navigateAfterCreate → cleanup
```

> ⛔ **ה-loader האינסופי היה באג אמיתי שיצרתי בסבב הקודם.** `if (isGuest) return` על ההקצאה השאיר `orphanGroup` null, ואז השער `if (params.quick && !orphanGroup && !orphanFailed)` תפס את האורח לנצח. התיקון: **quick הוא מצב UI ולא קבוצה** — `isOrphan` נגזר גם מ-`isGuest`, ושלושת שערי הרינדור לא תופסים אורח.

**סדר האישורים תוקן.** ה-branch של האורח עבר **אחרי** שני הדיאלוגים (מועד שעבר, חג) — אלה שאלות על הטופס, והרגע הנכון לשאול אותן הוא כשהאדם מסתכל עליו. כך טיוטה שנחנתה היא כזו שהוא **כבר אישר**, וזה מה שמאפשר ל-resume להיות ללא תנאי.

---

## 4 · הקצאת ה-personal group

| מתי | באיזה uid | איפה |
|---|---|---|
| חשבון מלא, quick mode | שלו | `GameCreateScreen` effect (כמו קודם) |
| חשבון מלא, CTA ידני | שלו | `OrphanCta` → `startOrphanFlow` (כמו קודם) |
| **אורח** | **לא מוקצה בכלל** | — |
| **resume אחרי auth** | **ה-uid המלא** | `gameCreation.ts:resolveGroupId` |

**לעולם לא נעשה שימוש בקבוצה שנוצרה עבור uid אנונימי** — כי לא נוצרת כזו. `ensurePersonalGroup` אידמפוטנטי לכל משתמש, אז מי שכבר יש לו מקבל את שלו חזרה.

הבדיקה: `provisions the personal group at creation time, not before` + `createdBy` נבדק שהוא ה-uid המלא.

---

## 5 · Game draft — schema ושחזור

```
footy.draft.game = {
  id, kind: 'game', createdAt, updatedAt, appVersion,
  values: GameFormValues        ← serializable בלבד
}
```

**מה לא נשמר:** אין אובייקטי React, אין navigation, אין `selectedGroup`. ההקשר של המועדון נשמר ב-**`PendingAction.targetId`** — שדה שכבר היה קיים על `DraftedAction`, כך שלא נדרש שינוי schema:

| סוג | `targetId` |
|---|---|
| משחק במועדון | `groupId` |
| משחק עצמאי | `undefined` → ה-resumer מקצה |

**השחזור:** `draftStore.restoreGameValues` ממזג על ברירות המחדל **הנוכחיות**, ולכן שדה שהוסר מהאשף לא יכול לחזור מטיוטה ישנה. הכל שורד unmount, roundtrip של ספק, הרג האפליקציה ו-restart.

---

## 6 · Create Game — סיווג התוצאות

| סוג | מתי | terminal | draft |
|---|---|---|---|
| **הצלחה** | המשחק נוצר | ✅ | נמחק |
| **דורש תיקון** | `startsAt` עבר | ❌ | **נשמר** |
| **Retryable** | `unavailable` · `deadline-exceeded` · `resource-exhausted` | ❌ | **נשמר** |
| **כשל טרמינלי** | המועדון נמחק | ✅ | נשמר |
| **כשל טרמינלי** | אין הרשאת admin יותר | ✅ | נשמר |
| **כשל טרמינלי** | `GAME_OVERLAP` ואחרים | ✅ | נשמר |
| **טיוטה פגה** | אין מה ליצור | ✅ | — |

**ההרשאה נבדקת לפני היצירה ולא מתגלית כדחיית rules:** ה-resumer מוודא שהמועדון קיים ושהחשבון הזה מנהל אותו.

---

## 7 · Availability — לפני ואחרי

### לפני

```
Save → persistAvailability(user.id, …)   ← כתיבה ל-/users
       אורח: אין מסמך כזה בכלל
```

### אחרי

```
Save → ולידציה + reverse-geocode (כמו קודם)
     → אורח: draftStore.write('availability', {availability, coords})
              PendingAction(save_availability)
              → auth → **profile אם חדש** → persistAvailability תחת ה-uid המלא
     → חשבון מלא: persistAvailability מיד, בדיוק כמו קודם
```

**אין `/users/{anonymousUid}`.** זמינות של אורח היא טיוטה מקומית ותו לא.

`persistAvailability` **חולצה** מהמסך ל-`src/services/availabilitySave.ts` — עם כל התיעוד שלה, כולל שני מסלולי ההתאוששות שנכתבו בעקבות דיווחי פרודקשן. לא מימוש שני.

---

## 8 · Availability draft — schema

```
footy.draft.availability = {
  values: {
    availability: UserAvailability,   ← מה שהמסך באמת בונה
    coords: {lat, lng} | null
  }
}
```

**רק מה שהמסך שומר היום.** לא הרחבתי את מודל הזמינות.

ה-`coords` נשמרות כי ה-reverse-geocode קרה **בזמן שהאדם היה על המסך** — לגזור אותן מחדש אחרי התחברות היה אומר לבקש מיקום שוב.

**אין PII מיותר:** שם עיר (ציבורי), ימים, שעות ורדיוס. אין שם, אין אימייל, אין טלפון.

---

## 9 · Profile ordering — ההוכחה

הסדר נאכף במקום אחד, ב-`RootNavigator`:

```
useEffect(() => {
  if (!currentUser || currentUser.isGuest === true) return;
  if (!hasCompletedOnboarding) return;   ← ה-gate
  void resumePendingAction();
}, [currentUser?.id, currentUser?.isGuest, hasCompletedOnboarding]);
```

לחשבון חדש `hasCompletedOnboarding` הוא `false`, ה-effect יוצא, ו-`PostSignInOnboardingScreen` מוצג. אחרי Save `complete()` מהפך את הדגל → ה-effect רץ מחדש → resume.

**כלומר עבור זמינות:**
```
auth → PostSignInOnboarding → completeOnboarding() יוצר את מסמך /users
     → hasCompletedOnboarding=true → resume → persistAvailability
```
ולא הפוך. ובנוסף ה-resumer עצמו בודק `fullUser()` ומחזיר `held` לאורח — שתי הגנות.

ויש בדיקה: `never writes while the viewer is a guest`.

---

## 10 · Restart

| תרחיש | מה קורה |
|---|---|
| Save → auth → **הרג** לפני שה-auth הושלם | הפעולה והטיוטה על הדיסק. ה-sheet **לא** נפתח לבד |
| Save → auth הושלם → **הרג** לפני resume | בפתיחה הבאה ה-effect נורה → resume |
| Save → auth → resume נכשל ברשת → **הרג** | הכל נשמר, resume חוזר |
| `startsAt` עבר בזמן שהיה בחוץ | הטופס נפתח משוחזר + `'המועד שבחרת עבר — בחר מועד חדש'` |
| מועד חדש + Save, כבר מחובר | **אין auth נוסף** — הענף `isGuest` לא נלקח |

הבדיקה `survives a restart before the action ran` מדמה זאת: קואורדינטור טרי מעל אותו דיסק.

---

## 11 · תיקון ה-analytics

**זו הייתה טעות בדוח שלי, לא בקוד.** בדקתי: `required_profile` **לא היה בקוד בכלל** — רק `had_prefill`, ומשמעותו הייתה נכונה מההתחלה.

הפרמטר עצמו אכן היה חסר, והוא שווה — אז הוספתי אותו נכון:

| פרמטר | אירוע | משמעות |
|---|---|---|
| `required_profile` | `auth_completed` | האם היה צורך באישור פרופיל **אחרי** השדרוג |
| `had_prefill` | `profile_confirmation_viewed` / `profile_confirmed` | האם **הספק** נתן שם שימושי להתחיל ממנו |

**ולא גזרתי אחד מהשני.** `required_profile` נקרא מה-**gate** עצמו (`!hasCompletedOnboarding()`) ולא מ-`!is_existing_account`. הם קרובים אבל לא זהים: חשבון מקושר תמיד חייב פרופיל, וחשבון קיים בדרך כלל לא — **אלא אם הוא קדם לדגל `onboardingCompleted`**, ואז כן. גזירה הייתה מתייגת בדיוק את החשבונות האלה לא נכון.

---

## 12 · Analytics — reuse לפני יצירה

בדקתי מה כבר קיים לפני שהוספתי. **לא הוספתי אף אירוע חדש בסבב הזה.**

| מה שנדרש למדוד | האירוע הקיים |
|---|---|
| game create requested | `GameCreateStarted` (קיים, `stage`/`source`) |
| game create completed | `GameCreated` · `QuickGameCreated` |
| game create failed | `GameSaveBlocked` · `GameWizardSubmitFailed` |
| availability saved | `AvailabilitySet` |
| draft restored | `DraftRestored` (נוסף בסבב הקודם) |
| pending action resumed | `PendingActionResumed` |

**המשפכים שביקשת, מהאירועים הקיימים:**

```
create_game כאורח:
  GameCreateStarted{stage,source}
  → PendingActionSaved{kind:'create_game', has_draft:true}
  → AuthPromptShown{action_kind:'create_game'}
  → AuthMethodSelected{auth_method}
  → AuthCompleted{is_existing_account, required_profile}
  → [ProfileConfirmationViewed → ProfileConfirmed]{action_kind}
  → PendingActionResumed{kind, age_ms}
  → QuickGameCreated | GameCreated

availability כאורח:
  AvailabilityWeekOpened
  → PendingActionSaved{kind:'save_availability'}
  → AuthPromptShown → AuthMethodSelected → AuthCompleted
  → [ProfileConfirmed]
  → PendingActionResumed
  → AvailabilitySet
```

הקישור בין השלבים הוא `action_kind` המשותף ו-`age_ms`. **אפס PII** — אין שם, אימייל, טלפון או uid של מזמין.

---

## 13 · Tests

| פקודה | תוצאה |
|---|---|
| `npx tsc --noEmit` | ✅ PASS · 0 |
| `cd functions && npx tsc --noEmit -p .` | ✅ PASS · 0 |
| `npx jest` | ✅ **1959** · 143 suites (היה 1925 · 142) |
| `npm run test:rules` | **268** · 265 · **3 — אותן שלוש** |
| `npx jest analyticsWiring` | ✅ 5/5 |

### 34 בדיקות חדשות

**`gameCreation.test.ts` — 20 (חדש)**

| קבוצה | מה |
|---|---|
| משחק עצמאי | **הקצאה בזמן היצירה ולא לפני** · `createdBy` הוא ה-uid המלא · כותרת · לא recurring · דיווח quick |
| משחק במועדון | משתמש במועדון ולא מקצה · כותרת מהמועדון · recurring + scheduling · אין דיווח quick |
| המיפוי | trim · `maxPlayers` · clamp של חלון ההמתנה · משך לא-מספרי · `registrationOpensAt` · `fillerMinTrust` |
| אחרי | הזמנות חברים · **הזמנה שנכשלת לא מפילה** · auto-teams עם lead |
| כשל | עולה כדי שהקורא יסווג · הקצאה שנכשלה עוצרת |

**`actionResumers.test.ts` — +14**

`create_game`: 9 — עצמאי · במועדון עם ההקשר · ניווט דרך ה-ref · מועדון שנעלם · אין הרשאת admin · **מועד שעבר שומר הכל** · רשת · overlap · טיוטה פגה
`save_availability`: 6 — כתיבה דרך המסלול הקיים · **לא כותב כאורח** · רשת · retry מצליח · דחיית הרשאה טרמינלית · טיוטה פגה
`create_club`: נכתבו מחדש — **בלי מסך מורכב**, דרך ה-ref

---

## 14 · Five-action audit

### `join_game`

| | |
|---|---|
| כניסה | `MatchDetailsScreen.performPrimary` |
| PendingAction | `actionCoordinator.requestAction`, לפני שה-sheet נפתח |
| Draft | — |
| Copy | עוד רגע אתה בהרכב |
| Resumer | `gameService.requestJoinGame(gameId, uid, 'deep_link')` |
| טרמינלי | joined · waitlisted · approval_pending · started · deleted · rejected |
| Retryable | `unavailable` · `deadline-exceeded` · `resource-exhausted` |
| ניקוי | אחרי bucket מהשרת |
| Restart | הפעולה שורדת; resume בפתיחה הבאה |

### `join_club`

| | |
|---|---|
| כניסה | `CommunityDetailsPublicScreen` · `NearbyClubsSection` · `PublicGroupsFeedScreen` |
| PendingAction | אותו מקום |
| Draft | — |
| Copy | עוד רגע אתה בסגל |
| Resumer | `groupService.requestJoinById` |
| טרמינלי | joined · approval_pending · **כבר חבר** · not_found |
| Retryable | רשת |
| ניקוי | אחרי status מהשרת |
| Restart | שורד |

### `create_club`

| | |
|---|---|
| כניסה | `PublicGroupsFeedScreen.handleCreate` → `CreateGroupScreen` |
| PendingAction | ב-Save, אחרי הוולידציה של האשף |
| Draft | `club` — `GroupFormValues` |
| Copy | שומרים את המועדון |
| Resumer | `createClubFromValues` — **לא תלוי במסך** |
| טרמינלי | created · טיוטה פגה |
| Retryable | רשת · rate limit |
| ניקוי | אחרי `createGroup` החזיר id |
| Restart | הטיוטה נטענת; resume יוצר |

### `create_game`

| | |
|---|---|
| כניסה | `GamesListScreen` FAB + availability slot → `GameCreateScreen` |
| PendingAction | ב-Save, **אחרי** האישורים · `targetId` = מועדון או undefined |
| Draft | `game` — `GameFormValues` |
| Copy | שומרים את המשחק |
| Resumer | `createGameFromValues` — מקצה קבוצה תחת ה-uid המלא |
| טרמינלי | created · מועדון נעלם · אין הרשאה · overlap · טיוטה פגה |
| **דורש תיקון** | `startsAt` עבר → **לא terminal**, הכל נשמר |
| Retryable | רשת · rate limit |
| ניקוי | אחרי `createGameV2` החזיר id |
| Restart | הטופס נפתח משוחזר |

### `save_availability`

| | |
|---|---|
| כניסה | `AvailabilityEditScreen.save` |
| PendingAction | ב-Save, אחרי הוולידציה וה-geocode |
| Draft | `availability` — `{availability, coords}` |
| Copy | שומרים את הזמינות |
| Resumer | `persistAvailability(uid, availability, coords)` |
| טרמינלי | נשמר · דחיית הרשאה · טיוטה פגה |
| Retryable | רשת |
| ניקוי | אחרי הכתיבה הצליחה |
| Restart | הגריד נטען מהטיוטה |

**כל החמש עומדות בחוזה.**

---

## 15 · Manual QA

### Create Game

| # | תרחיש | ציפייה | פלטפורמה |
|---|---|---|---|
| 1 | אורח → "+" → **האשף נפתח** | **לא loader אינסופי** · מצב quick | שתיהן |
| 2 | אורח → מלא → Save → בטל auth | הטופס מלא · אורח | שתיהן |
| 3 | ניסיון חוזר → Google חדש → פרופיל | **המשחק נוצר אוטומטית** | שתיהן |
| 4 | אורח → Save → Google **קיים** | נוצר · בלי פרופיל | שתיהן |
| 5 | Apple חדש / קיים | אותו דבר | iOS |
| 6 | **הרג בזמן auth** → פתח | טיוטה + פעולה | שתיהן |
| 7 | **הרג אחרי auth** → פתח | **resume אוטומטי** | שתיהן |
| 8 | משחק עצמאי | הקבוצה מוקצית תחת ה-uid המלא | שתיהן |
| 9 | משחק במועדון (חשבון מלא) | **בדיוק כמו קודם** | שתיהן |
| 10 | `startsAt` שעבר | הודעה + שאר הנתונים · Save שני **בלי auth** | שתיהן |
| 11 | כשל רשת אחרי auth | נשמר · retry | שתיהן |

### Availability

| # | תרחיש | ציפייה | פלטפורמה |
|---|---|---|---|
| 1 | אורח → בחר → Save → בטל | **הגריד שם** | שתיהן |
| 2 | ניסיון חוזר → חשבון חדש → **פרופיל** → נשמר | הסדר הזה, לא הפוך | שתיהן |
| 3 | חשבון קיים → נשמר מיד | בלי פרופיל | שתיהן |
| 4 | הרג/restart | הגריד נטען מהטיוטה | שתיהן |
| 5 | כשל רשת → retry | נשמר, ואז נשמר | שתיהן |
| 6 | חשבון מלא | **בדיוק כמו קודם** · אין sheet | שתיהן |

### Regression — המסלול המלא

| # | מה | ציפייה |
|---|---|---|
| R1 | חשבון מלא · Join משחק | ללא שינוי |
| R2 | חשבון מלא · צור מועדון | ללא שינוי, כולל seasons |
| R3 | חשבון מלא · צור משחק במועדון | ללא שינוי |
| R4 | חשבון מלא · quick game | ההקצאה בעלייה כמו קודם |
| R5 | חשבון מלא · זמינות | ללא שינוי |
| R6 | **אין roundtrip דרך storage** לחשבון מלא | ✓ הענף `isGuest` לא נלקח |
| R7 | אין push prompt בשום מקום | ✓ |

---

## 16 · Production safety

**`firestore.rules` לא נפרסו:**
```
live ruleset updateTime: 2026-09-22T07:11:58.924124Z  →  UNCHANGED ✓
```

**Build / release / submission — לא בוצע.** הבנייה האחרונה היא 1.1.14 מ-22.09. לא נגעתי ב-`minimumSupportedVersion`, ב-store metadata, ב-build number או ב-rollout.

---

## 17 · ממצאים

> ⛔ **1 · Loader אינסופי לאורח — באג שיצרתי בסבב הקודם**
>
> ה-`if (isGuest) return` שהוספתי על ההקצאה השאיר `orphanGroup` null, ואז שער הרינדור `if (params.quick && !orphanGroup && !orphanFailed)` תפס את האורח ב-spinner לנצח.
>
> **התיקון האמיתי:** quick הוא **מצב UI ולא קבוצה**. `isOrphan = orphanGroup !== null || isGuest`, ושלושת שערי הרינדור מסויגים ב-`!isGuest`. אורח יכול להיות רק במצב quick בכל מקרה — מצב מועדון דורש מועדון שהוא מנהל, ואין לו.

> ⛔ **2 · שני ה-resumers היו תלויים במסך — כלומר לא עבדו**
>
> בסבב הקודם `create_club` קיבל את מסלול היצירה שלו מהמסך דרך `setCreateClubHandler`, שנרשם רק כשהמסך מורכב. אבל **שני מסלולי ה-resume מפרקים אותו**: חשבון קיים מחליף את הסשן ומרכיב מחדש את הנavigator, וחשבון חדש מציג את מסך הפרופיל מעל הכל.
>
> כלומר ה-handler היה `null` **בדיוק במקרים שבהם resume קורה**, והמועדון היה נשאר `held` לנצח — בלי שגיאה, בלי מועדון.
>
> **התיקון:** חילצתי את היצירה לשלושה שירותים — `gameCreation.ts`, `clubCreation.ts`, `availabilitySave.ts`. המסכים קוראים להם, וה-resumers קוראים לאותן פונקציות. הניווט אחרי הצלחה עובר דרך `navigateAfterCreate` ב-`navigationRef`, שקיים בדיוק בשביל לפעול על הנavigator מחוץ לעץ.

> **3 · סדר האישורים ב-create_game**
>
> ה-branch של האורח היה **לפני** הדיאלוגים של מועד-שעבר וחג, כך שאורח מעולם לא נשאל. הזזתי אותו אחריהם: אלה שאלות על הטופס, והרגע לשאול אותן הוא כשהאדם מסתכל עליו. טיוטה שנחנתה היא כזו שהוא כבר אישר.

> **4 · `required_profile` — טעות בדוח, לא בקוד**
>
> מתואר בסעיף 11. הפרמטר לא היה בקוד כלל; `had_prefill` היה נכון מההתחלה. הוספתי את `required_profile` נכון, מה-gate.

> **5 · נשאר `ensureNotGuest` אחד**
>
> `CommunityDetailsScreen:424` — הודעה למנהל בצ'אט. לא מחמש הפעולות. מועמד לסבב הצ'אט.

---

## 18 · Git

**Committed:** `7d986f7` (Round 5).

**לא committed:**

| שונו (8) | + | − |
|---|---|---|
| `src/services/actionResumers.ts` | 252 | (שוכתב) |
| `src/screens/profile/AvailabilityEditScreen.tsx` | 198 | (חילוץ) |
| `src/screens/games/GameCreateScreen.tsx` | 189 | (חילוץ) |
| `src/screens/groups/CreateGroupScreen.tsx` | 147 | (חילוץ) |
| `src/navigation/navigationRef.ts` | 36 | |
| `src/components/auth/ContextualAuthSheet.tsx` | 8 | |
| `src/services/analyticsService.ts` | 8 | |
| `tests/logic/actionResumers.test.ts` | 239 | |
| **סה"כ** | **575** | **502** |

| חדשים (4) | שורות |
|---|---|
| `tests/logic/gameCreation.test.ts` | 304 |
| `src/services/gameCreation.ts` | 159 |
| `src/services/availabilitySave.ts` | 126 |
| `src/services/clubCreation.ts` | 107 |
| **סה"כ** | **696** |

**מרשימת §23 לא נגעתי בכלום.**

---

## 19 · מה נשאר מהאפיון המקורי

### גמור

| | |
|---|---|
| ✅ שכבת התשתית | PendingAction · draftStore · מכונת מצבים |
| ✅ זהות Joryio | alias → identify · reset ב-sign-out |
| ✅ מודל הגישה | `isFullAccount()` · `usersPublic` · טריגר · backfill |
| ✅ Entry architecture | אורח שקט · carousel מהמסלול · deep-link consumer |
| ✅ Contextual auth | sheet · שדרוג היברידי · coordinator |
| ✅ **כל חמש הפעולות** | join ×2 · create ×2 · availability |
| ✅ PlayerCard לאורח | |
| ✅ Push | לא מבקש ב-startup |

### נשאר

| # | מה | הערה |
|---|---|---|
| 1 | **QA ידני מלא** | §15 + המטריצות מהסבבים הקודמים. **השער.** |
| 2 | **פריסת `firestore.rules`** | ממתינה לאימוץ של גרסה עם `hydratePublicUsers` |
| 3 | מסך Personal Invite | `open_invite` מנווט לבית · הייחוס נשמר |
| 4 | Organic home | הבית לאורח הוא פיד המחזורים; ה-redesign לא נעשה |
| 5 | Website `/` | copy בטא · CTA לוואטסאפ |
| 6 | דפי נחיתה contextual | OG למשחק ולהזמנה אישית |
| 7 | `/i/` → 302 | אושר, לא יושם |
| 8 | OG לדפים המשפטיים | |
| 9 | Deep links: `/go` · `/c/*` | intent filters + AASA |
| 10 | `usersPublic` מצומצם ל-invite | החלטת הפרטיות שאושרה |
| 11 | Contextual push | |
| 12 | צ'אט לאורח | `ensureNotGuest` האחרון |
| 13 | Cleanup: carousel · `ProfileSetupScreen` · `onboardingDone` | release אחד אחרי היציבות |
| 14 | מחיקת ה-AAB הישן | אושר, נרשם ל-web cleanup |
| 15 | **Node 20 → 30.10.2026** | מחוץ לריפקטור, לא יכול לחכות |

**‏6–9 ו-14 הם סבב ה-web**, שלא נפתח כלל. ‏3–4 הם UX. ‏1–2 הם מה שחוסם שחרור.

---

## 20 · הסבב הבא — המלצה בלבד

הקוד של ה-app-side כמעט גמור. מה שנשאר מתחלק לשניים:

**מסלול א — לסגור את ה-app:** Personal Invite (3) + organic home (4) + צ'אט (12). שלושתם UX, ואף אחד לא חוסם.

**מסלול ב — סבב ה-web:** 5–9 + 14. עצמאי לגמרי מהאפליקציה, ואפשר לפרוס אותו **בלי build** — מה שאומר שהוא היחיד שיכול להתקדם בלי לחכות לאימוץ.

**ההמלצה שלי: מסלול ב.** הוא לא חוסם, לא תלוי בגרסה, ומנקה את החלק שהיה הכי מוזנח (copy בטא בדף הבית, אפס OG בדפים המשפטיים). וכשהוא נגמר, ה-QA הידני נעשה פעם אחת על הכל.

> **דבר אחד שלא חוסם ולא יכול לחכות:** Node 20 מפסיק לעבוד ב-**30.10.2026**. אחרי התאריך אי אפשר יהיה לפרוס שום Cloud Function, כולל תיקון דחוף. עוד חודש.

**לא אמשיך בלי אישור מפורש.**

---

*ענף `perf/firestore-read-costs`, 24.09.2026. Checkpoint `7d986f7`; העבודה שאחריו לא committed. לא נפרס דבר, לא בוצע build או release, והכללים בפרודקשן מאומתים כישנים.*
