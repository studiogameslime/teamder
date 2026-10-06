# התחברות בהקשר — Teamder

**דוח סבב Contextual Authentication + Resume Action**

| | |
|---|---|
| תאריך | 24.09.2026 |
| ענף | `perf/firestore-read-costs` |
| Checkpoint | `0f8a037` |
| **כללים בפרודקשן** | **לא נפרסו — מאומת** |
| **Release** | **לא בוצע** |

| מדד | ערך |
|---|---|
| jest | **1925** (1857 → **+68**) · 142 suites |
| rules | **268** · 265 pass · **3 fail — אותן שלוש** |
| typecheck | app ✅ · functions ✅ |
| analytics wiring | ✅ 5/5 |

---

## 1 · Checkpoint

```
commit 0f8a0379fd40fa3c8bbad54f5860c117193d9dcd
Arriving no longer costs an account
```

עץ העבודה היה נקי אחריו. אימתתי לפני ה-commit: ה-ruleset החי עדיין מ-`2026-09-22T07:11:58Z`, jest 1857, rules 268/265/3.

**לא עשיתי push** — הענף 237 commits לפני origin.

עבודת הסבב הזה **עדיין לא committed**.

---

## 2 · ארכיטקטורת ה-auth

ארבעה מודולים חדשים, וכל אחד עונה על שאלה אחת:

| מודול | שאלה |
|---|---|
| `src/services/authUpgrade.ts` | **מה קרה** — נורמליזציה אחת של כל ספק וכל דרך לכשול |
| `src/services/actionCoordinator.ts` | **מתי** — מי רשאי להריץ פעולה, ומתי בטוח לשכוח אותה |
| `src/services/actionResumers.ts` | **מה בדיוק לעשות** — אחד לכל סוג פעולה, רשומים ב-boot |
| `src/components/auth/ContextualAuthSheet.tsx` | **איך זה נראה** |
| `src/hooks/useAuthenticatedAction.tsx` | הדבק — מה שמסך קורא לו |

```
מסך → useAuthenticatedAction.request({kind, targetId, draft, execute})
            │
            ├─ חשבון מלא → execute() מיד, ניקוי אם terminal
            │
            └─ אורח → draftStore.write + writePendingAction
                       → ContextualAuthSheet
                       → upgradeAnonymous(method)
                       → resumePendingAction() → הresumer הרשום
```

**חשוב:** ה-resume עובר **תמיד** דרך ה-resumer הרשום, ולעולם לא דרך ה-`execute` שהמסך העביר. זה תיקון לבאג שמצאתי בעצמי — ראו סעיף 19.

---

## 3 · ה-UI

`SpringSheet` — אותו wrapper של `ConfirmDialog`, `ScreenshotReportSheet` ו-`CommunityFilterSheet`. כפתורי הספקים הם אותה קומפוזיציה של `Pressable` + `Ionicons` + `ACCENT` כמו ב-`SignInScreen`. **לא הומצאה שפה חדשה**: רקע בהיר, כרטיס לבן, כחול המותג, typography קיימת.

| פעולה | כותרת | טקסט |
|---|---|---|
| `join_game` | עוד רגע אתה בהרכב | מתחברים כדי לשמור את המקום שלך במשחק. |
| `join_club` | עוד רגע אתה בסגל | מתחברים כדי להצטרף למועדון. |
| `create_club` | שומרים את המועדון | מתחברים כדי ליצור את המועדון ולהזמין את החבר׳ה. |
| `create_game` | שומרים את המשחק | מתחברים כדי ליצור את המשחק ולהזמין שחקנים. |
| `save_availability` | שומרים את הזמינות | מתחברים כדי שנוכל להתאים לך משחקים. |

הניסוחים שלך, בלי שינוי. **הצעה אחת** שלי, מיושמת: מתחת לכפתורים, כשיש טיוטה — *"מה שמילאת נשמר."* זה הדבר היחיד שמישהו באמצע טופס צריך לשמוע לפני שהוא עוזב את המסך.

ה-`COPY` הוא `Record<PendingActionKind, …>` — **סוג חדש הוא שגיאת קומפילציה**, לא sheet שלא אומר כלום.

---

## 4 · מסלולי הספקים

לא הוספתי ספק. חילצתי את רכישת ה-credential מתוך הפונקציות הקיימות, כך שיש **מימוש אחד** לכל אחת:

```
acquireGoogleCredential()  → {idToken}
acquireAppleCredential()   → {identityToken, rawNonce, fullName?}
mirrorCredentialToNativeAuth(fn)
```

`signInWithGoogle` ו-`signInWithApple` הקיימות **עברו להשתמש בהן** — חילוץ אמיתי, לא שכפול. שער הפלטפורמה, הגדרת ה-SDK, בדיקת Play Services, ייצור ה-nonce וחילוץ השם קיימים פעם אחת כל אחד.

`fullName` של Apple מוחזר **רק בהרשאה הראשונה אי פעם** — מי שמפיל אותו איבד את השם לתמיד. לכן הוא נישא החוצה במפורש.

**email** לא נאסף ב-sheet. הוא דורש שני שדות, ולידציה ומסלול איפוס, ול-`EmailAuthScreen` יש את שלושתם. ה-sheet מנווט אליו — והפעולה כבר נשמרה, אז ה-resume קורה כשההתחברות שם נוחתת.

### נורמליזציית ביטול

שש צורות שונות, כולן ל-`{status:'cancelled'}`:

```
ERR_REQUEST_CANCELED · ERR_CANCELED · auth/popup-closed-by-user
auth/user-cancelled · -5 (iOS) · 12501 (Android) · /cancel/i במסר
```

---

## 5 · שדרוג אנונימי — היברידי

### Case A — credential שלא שייך לאף אחד

```
linkWithCredential(anonUser, credential)
→ אותו uid · הסשן לא נופל · הנavigator לא מתחלף · המסך לא מתפרק
→ {status:'linked', isNewAccount:true}
```

### Case B — credential ששייך לחשבון קיים

```
link נכשל → Firebase מחזיר את ה-credential על השגיאה
→ signInWithCredential(אותו credential)
→ {status:'switched', isNewAccount:false}
```

**המשתמש לא מתבקש להזדהות פעמיים** — יש בדיקה לזה.

שלושה קודים מסמנים את המצב הזה, לא אחד: `credential-already-in-use`, `email-already-in-use`, `provider-already-linked`. לכל שלושתם יש פתרון, אז אף אחד מהם לא מגיע למשתמש כשגיאה.

> **אחד שנראה כמוהם ואינו:** `auth/account-exists-with-different-credential`. הכתובת שייכת ל**ספק אחר**, ולכן ניסיון חוזר עם אותו credential לא יכול לפתור. הוא מדווח כשגיאה עם הודעה — יש בדיקה שמוודאת שלא מנסים fallback עליו.

ה-uid האנונימי היתום **לא נמחק**, כפי שהחלטנו — מחיקה הייתה מוסיפה נקודת כשל לרגע הרגיש ביותר בזרימה.

---

## 6 · אישור פרופיל

`PostSignInOnboardingScreen` — **בדיקתי: הוא כבר אוסף בדיוק שם + אווטאר, בלי עיר.** לא נדרש שינוי מבני.

| מצב | מה קורה |
|---|---|
| חשבון קיים, פרופיל תקין | **אין confirmation.** resume מיד |
| חשבון חדש | המסך הקיים · שם prefilled מהספק אם יש · אווטאר ברירת מחדל |
| אורח | **לעולם לא מגיע לשם** מעצם פתיחת האפליקציה — השער מסויג ב-`!isGuest` מאז ומתמיד |

אחרי Save: `complete()` מהפך את `onboardingCompleted` → האפקט ב-`RootNavigator` נורה → resume. **המשתמש לא לוחץ כלום פעם שנייה.**

הוספתי שתי מדידות: `ProfileConfirmationViewed` ו-`ProfileConfirmed`, שתיהן עם `action_kind` מהפעולה הממתינה — כך שנשירה במסך הזה מיוחסת לכוונה שהובילה אליו ולא נקראת כנטישת onboarding כללית.

`ProfileSetupScreen` — לא נמחק.

---

## 7 · PendingAction כמקור אמת

עד הסבב הזה הוא היה **תצוגה מוטיפסת** מעל `PendingInvite`. עכשיו `writePendingAction` נקרא בפועל — מ**מקום אחד בלבד**: `actionCoordinator`.

| מה | איפה |
|---|---|
| `writePendingAction` | `actionCoordinator.ts:135` — היחיד |
| קריאה | `readPendingAction` (החדש, נגזר מהישן אם צריך) |
| ניקוי | `clearPendingAction` — מנקה את **שני** המפתחות |

**תאימות לאחור שלמה.** המפתח הישן `footy.invite.pending` לא נמחק ולא הפסיק להיכתב:

- deep links (game / club / personal) עוברים כרגיל דרך `stashPendingInvite`
- install referrer ו-clipboard — ללא שינוי, כולל שומר "אל תדרוס"
- `applyInviteAttributionIfFresh` ו-`applyAcquisitionIfFresh` — **אפס שורות ב-diff**
- ייחוס נשמר

---

## 8 · Resume coordinator

### Exactly-once — שני מנגנונים, לא אחד

**‏1 · `inFlight` lock.** מפתח לפי זהות הפעולה (`kind:targetId`), לא דגל בוליאני — כך שהצטרפות למשחק A לא חוסמת את B. **module state ולא React state**, כי כל הנקודה היא לשרוד את החלפת עץ הקומפוננטות, שזה בדיוק מה שהתחברות עושה.

שלושה צרכנים לגיטימיים מתחרים: ה-callback של ה-auth, המאזין `onAuthStateChanged` שמגיב לאותה התחברות, והאפקט ב-`RootNavigator` כש-`currentUser` מתהפך. **יש בדיקה שמריצה שלושה resume במקביל ומוודאת שה-resumer נקרא פעם אחת.**

**‏2 · ניקוי רק ב-terminal success.** תהליך שמת באמצע מוצא את הפעולה עדיין על הדיסק ומנסה שוב.

### מה נחשב terminal

| תוצאה | terminal | למה |
|---|---|---|
| `joined` | ✅ | — |
| `waitlisted` | ✅ | **מקום בתור הוא תוצאה.** הבקשה הושלמה |
| `approval_pending` | ✅ | הבקשה הוגשה; מנהל צריך לאשר |
| `created` | ✅ | — |
| `navigated` (כולל `ACCESS_BLOCKED`) | ✅ | המסמך קיים, למסך יש תצוגה |
| `network_unavailable` | ❌ | **המקרה היחיד שבו ניקוי הוא הבאג** |
| `rate_limited` | ❌ | יחלוף |
| כל השאר | ✅ | תשובה על העולם שלא תשתנה |

---

## 9 · Join Game — כל התוצאות

**חשבון מלא: אפס שינוי.** ה-`if (isGuest)` חוזר לפני כל שורה מהלוגיקה הקיימת — ה-splice האופטימי, הקונפטי, ההפטיקה, כולם כפי שהיו.

**אורח:** tap → `join_game` נשמר → sheet → auth → resume.

וה-resume **שואל את השרת מחדש**:

| מה קרה בזמן ה-auth | התוצאה |
|---|---|
| יש מקום | `joined` · terminal |
| **המקום האחרון נתפס** | `waitlisted` · terminal — **לא כישלון** |
| המועדון דורש אישור | `approval_pending` · terminal |
| המשחק התחיל | terminal · `game_started` |
| המשחק נמחק | terminal · הודעה קיימת |
| כבר רשום | terminal — לא כישלון |
| אין רשת | **לא terminal** · נשמר לניסיון חוזר |

לא שיניתי business logic. ה-resumer קורא ל-`requestJoinGame` הקיימת עם `source:'deep_link'`.

---

## 10 · Join Club — שלושה אתרי כניסה

`CommunityDetailsPublicScreen` · `NearbyClubsSection` · `PublicGroupsFeedScreen` — כל שלושתם.

| מצב | תוצאה |
|---|---|
| מועדון פתוח | `joined` · terminal |
| דורש אישור | `approval_pending` · terminal |
| **החשבון כבר חבר** | terminal, **בלי בקשה לשרת** — §24 |
| השרת אומר `already_member` | אותה תשובה |
| מועדון נמחק | terminal |
| אין רשת | נשמר |

לא שיניתי approval logic, membership rules או את הקשר מועדון-משחק.

---

## 11 · Create Club — draft + auth + restore

**הגבול ב-Save, לא בכניסה.** וזה דרש תיקון שגיליתי ב-quality gate — ראו סעיף 19.

```
אורח ממלא את כל הטופס
→ Save → ולידציה קיימת (בתוך האשף)
→ draftStore.write('club', …)  ← לפני שה-sheet נפתח
→ PendingAction(create_club, draftId)
→ sheet → auth → profile אם חדש
→ createFromValues() — אותה פונקציה שחשבון מלא מריץ
→ ניקוי, רק אחרי הצלחה
```

**לא שיניתי את `GroupWizardForm`** — לא שדה, לא עיצוב. השחזור עובר דרך ה-prop `initial` הקיים.

| מקרה | מה קורה |
|---|---|
| ביטול auth | חוזר לטופס **עם כל הנתונים** |
| האפליקציה נהרגה | הטיוטה על הדיסק |
| היצירה נכשלה | הטיוטה **נשארת** |
| הצלחה | ניקוי שניהם |
| הטיוטה פגה | terminal — אין מה ליצור |
| המסך עוד לא נטען | **HELD**, לא נכשל |

`setCreateClubHandler` מעביר את מסלול היצירה האמיתי ל-resumer, כך שמועדון שנוצר אחרי התחברות עובר את אותו geocoding, אותה קריאת seasons ואותו `celebrate` — במקום מימוש שני.

---

## 12 · Create Game — הגבול והטיוטה כן, ההשלמה האוטומטית לא

**מצאתי חסם אמיתי ולא עקפתי אותו.**

`GameCreateScreen` מקצה קבוצה נסתרת דרך ה-callable `ensurePersonalGroup` **באפקט בעלייה** — לפני שמישהו הקליד תו — כי אשף המשחק המהיר צריך שקבוצה תתקיים כדי לרנדר במצב quick.

עבור אורח זה אומר:
- המסלול היחיד הנגיש לו הוא העצמאי (הוא בלי מועדונים, כי לא היה יכול להצטרף)
- ובמסלול הזה **כבר הייתה תופעת לוואי בצד שרת** לפני שהגבול נגע

```
+ if (isGuest) return;   // לא מקצים קבוצה לאורח לפני שהוא החליט משהו
  if (params.quick && !orphanGroup && !orphanLoading) startOrphanFlow();
```

**מה כן חובר:** הגבול ב-Save + כתיבת הטיוטה + שחזור. אורח ממלא את כל האשף, מתחבר, וחוזר לטופס **שעדיין מלא**.

**מה לא חובר:** ההשלמה האוטומטית. אין resumer רשום, ולכן `resumePendingAction` עונה `held`, שום דבר לא מדווח ככישלון, והטיוטה נשארת.

> **למה לא הכרחתי:** resume נכון דורש או לדחות את ההקצאה עד אחרי ה-auth, או להוציא `selectedGroup` / `isOrphan` / `isRecurring` / ה-route params מהמסך אל resumer. שניהם refactor אמיתי של מסך שהסבב הזה לא אמור לעצב מחדש. וגרסה חצי-מחוברת — יצירת משחק מול קבוצה שהוקצתה תחת uid אנונימי שנזנח — גרועה מלבקש מהאדם ללחוץ save פעם נוספת על טופס מלא.

### `startsAt` ישן

`restoreGameValues` מסרב למועד שעבר, **לא ממציא חדש**, ומחזיר `needsAttention: ['startsAt']`. המסך מציג `'המועד שבחרת עבר — בחר מועד חדש'`. כל שאר השדות נשמרים.

---

## 13 · Availability — נדחה

**לא חובר, ובמכוון.**

`AvailabilityEditScreen` שומר דרך `updateProfile` על מסמך `/users` — כלומר הפעולה היא **עדכון פרופיל**, לא יצירת ישות. לאורח אין מסמך כזה בכלל, ולכן "שמור זמינות כאורח ואז השלם" דורש להחליט מה קורה לזמינות שנשמרה לפני שהיה פרופיל: להמתין ולכתוב אחרי, או לכתוב על המסמך החדש שנוצר ב-`complete()`.

זו החלטת מוצר קטנה אבל אמיתית, והיא לא הייתה בסבב. `save_availability` קיים כסוג חוקי, יש לו copy ל-sheet, והקואורדינטור יטפל בו ברגע שיהיה resumer. **דווח ונדחה, כפי שהרשית.**

---

## 14 · Joryio — alias בפועל

`bindUpgradedIdentity` נקרא **רק אחרי שדרוג מוצלח**. זה מה שמייצר את כל הערבויות:

| מצב | alias | identify |
|---|---|---|
| credential חדש (Case A) | ✅ פעם אחת | ✅ פעם אחת |
| חשבון קיים (Case B) | ✅ פעם אחת — **המסע האנונימי עובר לחשבון הקיים** | ✅ |
| ביטול | ❌ | ❌ |
| כשל | ❌ **אין alias מוקדם** | ❌ |

הסדר הוא `alias` → `identify`, בתוך `joryio.bindIdentity`. הפוך, ה-alias היה שולח anonymousId שה-SDK כבר עבר ממנו.

**אין alias כפול ב-restart:** `bindIdentity` אידמפוטנטי דרך `identifiedUid`, אז המאזין שנורה רגע אחרי על אותו uid הוא no-op. יש בדיקה.

**ו-`bindIdentity` שזורק לא מפיל את ההתחברות** — זהות אנליטית לא יכולה להיות סיבה לכשל auth.

---

## 15 · Analytics

### נוספו — 9 קבועים, כולם עם אתר קריאה

| קבוע | ערך | אתר קריאה |
|---|---|---|
| `AuthPromptShown` | `auth_prompt_shown` | `ContextualAuthSheet` — **פעם אחת להופעה** |
| `AuthMethodSelected` | `auth_method_selected` | ה-sheet, לכל ניסיון |
| `AuthCompleted` | `auth_completed` | ה-sheet |
| `AuthCancelled` | `auth_cancelled` | ה-sheet |
| `AuthFailed` | `auth_failed` | ה-sheet |
| `ProfileConfirmationViewed` | `profile_confirmation_viewed` | `PostSignInOnboardingScreen` |
| `ProfileConfirmed` | `profile_confirmed` | אותו מסך, אחרי Save |
| `DraftSaved` | `draft_saved` | `actionCoordinator` |
| `DraftRestored` | `draft_restored` | שני מסכי היצירה |

### פרמטרים

`action_kind` · `auth_method` · `is_existing_account` · `required_profile`(→`had_prefill`) · `origin` · `has_draft` · `age_ms` · `code` · `reason` · `is_guest`

**‏PII שלא נשלח:** email · phone · display name · inviter uid. במקום ה-uid יש `has_inviter: boolean`.

### §15 — לא לספור prompt פעמיים

**לא הוספתי `flow_id`.** המודל הקיים מספיק:

```
PendingActionSaved{kind}          ← intent אחד
AuthPromptShown{action_kind}      ← הופעה אחת של ה-sheet
AuthMethodSelected{auth_method}   ← ניסיון 1
AuthCancelled{auth_method}        ← בוטל
AuthMethodSelected{auth_method}   ← ניסיון 2
AuthCompleted{is_existing_account}
PendingActionResumed{kind, age_ms}
```

`AuthPromptShown` נורה על **הופעת** ה-sheet, לא על ניסיון — שני ניסיונות בכוונה אחת הם שני `AuthMethodSelected` תחת prompt אחד. ה-`action_kind` המשותף ו-`age_ms` על ה-resume מקשרים את הרצף בלי מזהה חדש. **הוספת `flow_id` הייתה מוסיפה מורכבות למשהו שכבר נקרא נכון.**

### §14 — מה לא הוספתי כדפליקט

`sign_in_*` הקיימים נשארו למסך ההתחברות. `auth_*` החדשים נושאים `action_kind` — זה מה שמבדיל "פתח את האפליקציה והתחבר" מ"ניסה להצטרף למשחק ונאלץ".

**`DraftDiscarded` הוסר.** בדיקת ה-wiring תפסה שאין לו אתר קריאה — ואין: אין פעולת ויתור במוצר, וה-guard של האשפים נורה **לפני** שטיוטה נכתבת בכלל. הוא יגיע עם ה-UI שמציע אותו.

---

## 16 · בדיקות

| פקודה | תוצאה |
|---|---|
| `npx tsc --noEmit` | ✅ PASS · 0 |
| `cd functions && npx tsc --noEmit -p .` | ✅ PASS · 0 |
| `npx jest` | ✅ **1925** · 142 suites (היה 1857 · 139) |
| `npm run test:rules` | **268** · 265 · **3 — אותן שלוש** |
| `npx jest analyticsWiring` | ✅ 5/5 |

### 68 בדיקות חדשות

**`authUpgrade.test.ts` — 27**

| קבוצה | מה |
|---|---|
| Case A | link במקום · אותו uid · mirror נייטיב · Apple |
| Case B | שלושת הקודים · **לא מזדהים פעמיים** · mirror · כשל ב-fallback |
| ביטול | **6 צורות שונות** · אין alias · ביטול בתוך ה-link |
| כשל | קוד עולה · `account-exists-with-different-credential` **לא מנסה fallback** · אין alias מוקדם |
| זהות | bind פעם אחת · גם ב-fallback · `identified` לא מדווח alias · bind שזורק לא מפיל |
| בלי סשן אנונימי | התחברות רגילה · בלי סשן בכלל |
| פלטפורמה | Apple מסרב מחוץ ל-iOS |

**`actionCoordinator.test.ts` — 21**

| קבוצה | מה |
|---|---|
| חשבון מלא | מריץ מיד · אין קיר · ניקוי · retryable לא terminal |
| הקיר | לא מריץ · נשמר · **נשמר לפני שה-sheet יכול להיפתח** · draft · דיווח |
| exactly-once | אותה פעולה → `busy` · **פעולה אחרת לא נחסמת** · lock משתחרר · **3 resume במקביל → פעם אחת** |
| resume | ריק · אורח → held · navigate-only → held · kind ללא resumer → held · דיווח עם age |
| מה שורד | terminal מנקה שניהם · **retryable שומר שניהם** · retry מצליח ומנקה · waitlist+approval terminal · **שורד restart** |

**`actionResumers.test.ts` — 20**

‏join_game: 8 (כולל המקום שנתפס בזמן auth) · join_club: 6 (כולל כבר-חבר בלי בקשה) · create_club: 4 · create_game held: 1 · אורח לא יכול: 1

### מה לא ניתן לבדיקה אוטומטית

`testEnvironment: 'node'` — אין רינדור. ה-sheet עצמו, ה-hook, והתנהגות ה-modal נבדקים ידנית (סעיף 17).

---

## 17 · Manual QA

### Android

| # | תרחיש | ציפייה |
|---|---|---|
| 1 | אורח טרי → משחק → Join → **בטל auth** | נשאר במסך · אורח · **אין שגיאה אדומה** |
| 2 | ניסיון חוזר → Google → משתמש חדש → פרופיל | **מצטרף אוטומטית**, בלי לחיצה נוספת |
| 3 | אורח → Join → Google → **חשבון קיים** | מצטרף · **לא מזדהה פעמיים** |
| 4 | — | (Apple ב-iOS) |
| 5 | **המשחק מתמלא בזמן ה-auth** | **waitlist**, לא שגיאה |
| 6 | אורח → מועדון → Join | אותו מסלול · approval אם צריך |
| 7 | אורח → צור מועדון → מלא → Save → **בטל** | **כל הנתונים שם** |
| 8 | **הרוג את האפליקציה בזמן auth** → פתח | הטיוטה והפעולה שם |
| 9 | **הרוג אחרי auth לפני resume** → פתח | **resume אוטומטי** |
| 10 | כשל רשת אחרי auth | נשמר · ניתן לנסות שוב |
| 11 | **אין push prompt בשום מקום** | ✓ |
| 12 | מסע Joryio אחד לפני/אחרי | alias פעם אחת |
| 13 | חשבון קיים — Join רגיל | **בדיוק כמו קודם** |
| 14 | אורח → צור משחק → מלא → Save → auth → חזור | הטופס מלא · **לא נוצר אוטומטית** |
| 15 | טיוטת משחק עם מועד שעבר | הודעה + השדה מאופס, השאר נשמר |
| 16 | סגור את ה-sheet בגב המכשיר | נסגר · לא חוזר לבד |

### iOS

אותם 16, ובנוסף:

| # | תרחיש | ציפייה |
|---|---|---|
| 4′ | Apple → משתמש חדש | `fullName` מגיע · פרופיל prefilled |
| 4″ | Apple → חשבון קיים | fallback · מצטרף |
| 16′ | sheet מעל sheet | **אין** — הוא נסגר לפני מסך הפרופיל |

---

## 18 · Production safety

**`firestore.rules` לא נפרסו.** מאומת מול ה-API:

```
live ruleset updateTime: 2026-09-22T07:11:58.924124Z  →  NOT deployed ✓
```

**Release לא בוצע.** הבנייה האחרונה היא 1.1.14 מ-`3cba4766` — לא נגעתי, לא הגשתי, לא שיניתי `minimumSupportedVersion`.

---

## 19 · ממצאים

> ⛔ **1 · באג שהכנסתי ותפסתי — ההצטרפות לא הייתה קורית**
>
> ב-`useAuthenticatedAction` שמרתי את הבקשה המקורית וב-`onAuthenticated` הרצתי אותה שוב. לחשבון **קיים** זה אומר שה-`execute` של המסך היה רץ — וב-מסכים האלה הוא placeholder, כי בענף האורח הקואורדינטור לא מריץ אותו בכלל.
>
> התוצאה הייתה: הדיווח מצליח, ה-stash מתנקה, **והמשתמש לא מצטרף למשחק**.
>
> **התיקון:** ה-resume עובר **תמיד** דרך ה-resumer הרשום. הוא גם היחיד ששואל את השרת מחדש, וזו בדיוק הסיבה שהוא הנכון. ובנוסף הפכתי את ה-executors הבלתי-נגישים ל-`throw` מפורש — טעות עתידית תהיה רועשת ולא שקטה.

> ⛔ **2 · הכניסה לטפסים הייתה חסומה — כל עבודת ה-draft לא הייתה נגישה**
>
> ה-quality gate תפס. שלושה `ensureNotGuest` גדרו את **פתיחת** האשף: `GamesListScreen` ×2 ו-`PublicGroupsFeedScreen`. אורח שלחץ "צור מועדון" קיבל את ה-`appAlert` הישן ו-signOut, ולעולם לא הגיע ל-`CreateGroupScreen`.
>
> כלומר הטיוטה, השחזור וה-handler שבניתי היו **קוד מת עבור אורח**. הסרתי את שלושת השערים — הגבול שייך ל-Save.

> ⚠️ **3 · `create_game` מקצה קבוצה בעלייה**
>
> מתואר בסעיף 12. תופעת לוואי בצד שרת לפני שהאדם הקליד תו. הוספתי `if (isGuest) return` להקצאה, וה-resume נדחה עם נימוק.

> **4 · נשאר `ensureNotGuest` אחד**
>
> `CommunityDetailsScreen:424` — הודעה למנהל בצ'אט. צ'אט לא בחמש הפעולות של הסבב, והמסלול הישן עדיין עובד. מועמד לסבב הצ'אט.

---

## 20 · Git

**Committed:** `0f8a037` (Round 4).

**לא committed** — עבודת הסבב הזה:

| שונו (13) | + | − |
|---|---|---|
| `src/firebase/auth.ts` | 135 | (חילוץ) |
| `src/screens/groups/CreateGroupScreen.tsx` | 109 | |
| `src/screens/games/GameCreateScreen.tsx` | 95 | |
| `src/screens/onboarding/PostSignInOnboardingScreen.tsx` | 40 | |
| `src/screens/games/MatchDetailsScreen.tsx` | 38 | |
| `src/screens/communities/PublicGroupsFeedScreen.tsx` | 33 | |
| `src/services/analyticsService.ts` | 31 | |
| `src/i18n/he.ts` | 29 | |
| `src/components/games/NearbyClubsSection.tsx` | 27 | |
| `src/screens/communities/CommunityDetailsPublicScreen.tsx` | 26 | |
| `src/navigation/RootNavigator.tsx` | 26 | |
| `src/screens/games/GamesListScreen.tsx` | 10 | |
| `App.tsx` | 5 | |
| **סה"כ** | **531** | **73** |

| חדשים (8) | שורות |
|---|---|
| `src/services/actionCoordinator.ts` | 299 |
| `src/components/auth/ContextualAuthSheet.tsx` | 310 |
| `src/services/authUpgrade.ts` | 278 |
| `src/services/actionResumers.ts` | 205 |
| `src/hooks/useAuthenticatedAction.tsx` | 126 |
| `tests/logic/actionCoordinator.test.ts` | 375 |
| `tests/logic/actionResumers.test.ts` | 321 |
| `tests/logic/authUpgrade.test.ts` | 293 |
| **סה"כ** | **2,207** |

**מרשימת §32 לא נגעתי בכלום:** organic home, Personal Invite, website, landing pages, `/i/`, public stats, push prompts, forced update, `minimumSupportedVersion`, rules deploy, legacy onboarding cleanup, `ProfileSetupScreen`, Node runtime.

---

## 21 · Release readiness

**כן — לדעתי הגיע הזמן. לא הוצאתי.**

הנימוק: `usersPublic` ממתין לאימוץ, וזה **התנאי היחיד** שחוסם את פריסת הכללים. כל יום שהגרסה לא יוצאת הוא יום שבו 34 האורחים הפעילים נשארים על בינארי בלי `hydratePublicUsers`, והכללים ממתינים.

מה שתומך ביציבות:
- ‏1,925 בדיקות עוברות, 68 מהן חדשות ועל ההתנהגות הזו
- אפס שגיאות typecheck בשני הפרויקטים
- שלוש נפילות ה-rules לא זזו לאורך ארבעה סבבים
- מסלול החשבון המלא לא נגוע — `if (isGuest)` חוזר לפני כל שורה קיימת

מה שמסייג:
- **§17 לא הורץ.** במיוחד 1, 3, 5, 8, 9 — ביטול, חשבון קיים, המשחק שמתמלא, ושני מקרי ההרג. אף אחד מהם לא ניתן לבדיקה אוטומטית ושלושה מהם נוגעים בזהות.
- הבאג בסעיף 19.1 היה בדיוק במסלול הזה ונתפס בקריאה, לא בבדיקה.

**ההמלצה:** QA ידני על §17 ואז build. לא לפני.

---

## 22 · הסבב הבא — המלצה בלבד

1. **QA ידני §17.** זה השער, לא הצעה.
2. **Build + release** לצורך אימוץ `usersPublic`.
3. **Availability** — החלטת המוצר בסעיף 13, ואז חיבור.
4. **`create_game` resume** — או דחיית ההקצאה עד אחרי auth, או הוצאת ההקשר מהמסך.
5. **ואז** פריסת הכללים, כשהאימוץ מספיק.

**לא אמשיך בלי אישור מפורש.**

---

*ענף `perf/firestore-read-costs`, 24.09.2026. Checkpoint `0f8a037`; העבודה שאחריו לא committed. לא נפרס דבר, לא בוצע release, והכללים בפרודקשן מאומתים כישנים.*
