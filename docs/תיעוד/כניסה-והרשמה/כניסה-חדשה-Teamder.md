# הכניסה החדשה — Teamder

**דוח סבב entry architecture**

| | |
|---|---|
| תאריך | 24.09.2026 |
| ענף | `perf/firestore-read-costs` |
| Checkpoint | `ffcba25` |
| **כללים בפרודקשן** | **לא נפרסו — מאומת** |

| מדד | ערך |
|---|---|
| jest | **1857** (1844 → +13) · 139 suites |
| rules | **268** · 265 pass · **3 fail — אותן שלוש** |
| typecheck | app ✅ · functions ✅ |
| analytics wiring | ✅ 5/5 |

---

## 1 · Checkpoint

```
commit ffcba25a8bbc5cd1e7466d0c9859133feb3cbaeb
Guest groundwork: a public face, a stash that survives, and one identity
```

22 קבצים, שלושת הסבבים שאושרו. הודעת ה-commit מתעדת את שלושת החלקים ואת ההחלטה שהכללים לא נפרסים.

**git status אחרי:** עץ עבודה נקי לחלוטין (`## perf/firestore-read-costs...origin/... [ahead 236]`).

**לא עשיתי push.** הענף 236 commits לפני origin — זה לא workflow שגרתי בריפו הזה, ולא push-תי בלי אישור.

לפני ה-commit אימתתי מחדש מה נפרס: ה-ruleset החי עדיין מ-`2026-09-22T07:11:58Z`, `syncUserPublic` קיים, 708/708 מראות.

---

## 2 · Entry architecture — לפני ואחרי

### לפני

```
!userHydrated            → Splash
!onboardingDone          → OnboardingScreen      ← 3 שקפים, לפני שראו כלום
!currentUser             → AuthStack(SignIn)     ← ⛔ קיר
!isGuest && !onboarded   → PostSignInOnboarding
!isGuest && !profileOk   → AuthStack(ProfileSetup)
!groupHydrated           → Splash
                         → MainTabs  →  ProfileTab
```

### אחרי

```
!userHydrated            → Splash
!currentUser             → guestInitFailed ? AuthStack(SignIn) : Splash
                           ↑ hydrate כבר יצר סשן אנונימי; זה frame הגנתי
!isGuest && !onboarded   → PostSignInOnboarding
!isGuest && !profileOk   → AuthStack(ProfileSetup)
!groupHydrated           → Splash
                         → MainTabs  →  אורח: GameTab · חשבון: ProfileTab
```

**מה שהשתנה בעיקרון:** הגעה לא עולה יותר חשבון. וסשן אנונימי הוא **מצב חוקי** של האפליקציה — לא שגיאה, לא הרשמה חצי-גמורה, ולא משהו שצריך לעשות ממנו onboarding.

---

## 3 · Silent guest — איך זה עובד

השינוי יושב ב-`userStore.hydrate`, לא ב-effect. זו החלטה:

```
hydrate():
  [onboardingDone, user] = await Promise.all([...])
  if (user)         → set({hydrated:true, currentUser:user})        ← ללא שינוי
  if (USE_MOCK_DATA)→ set({hydrated:true, currentUser:null})        ← mock ללא שינוי
  try  guest = await userService.signInAsGuest()
       logEvent(GuestSessionStarted, {origin:'silent'})
  catch → logError + BootHydrateFailed{source:'silent_guest'}
  set({hydrated:true, currentUser:guest, guestInitFailed: guest===null})
```

**למה בתוך hydrate ולא ב-effect:** ה-boot נשאר אטומי. `hydrated` מתהפך **פעם אחת**, כשהסשן כבר ביד, ואף frame לא מרנדר את העץ המנותק. ב-effect היה נצבע מסך ההתחברות לפריים אחד — בדיוק מה שהשינוי בא להסיר.

**`guestInitFailed`** הוא שסתום הביטחון. בלעדיו אין דרך להבדיל בין "סשן אורח בדרך" ל"לא יהיה סשן לעולם", ו-RootNavigator היה יושב על ה-splash לנצח — מצב שאין ממנו יציאה חוץ מ-force-close. הריפו הזה כבר היה שם; ההערה על `hydrate` על עטיפת כל ענף קיימת בדיוק מהסיבה הזו.

### מה נשמר

| | |
|---|---|
| חשבון קיים | לא נוגעים. `signInAsGuest` לא נקרא בכלל |
| אורח קיים | חוזר דרך `getCurrentUser` כמו כל אחד. **אין uid אנונימי שני** |
| mock mode | ללא שינוי — screenshot ו-QA רואים את מה שראו |
| `/users/{anonUid}` | **לא נוצר.** `getCurrentUser` יוצא על `isAnonymous` לפני היצירה העצלה, והכללים החדשים גם אוסרים |
| אופליין בהפעלה ראשונה | נופל ל-AuthStack — בדיוק לאן שהאדם הזה הגיע קודם |

---

## 4 · RootNavigator — decision tree

```
                    ┌─ !userHydrated ──────────────► Splash
                    │
                    ├─ !currentUser ───┬─ guestInitFailed ─► AuthStack(SignIn)
                    │                  └─ אחרת ───────────► Splash
                    │
   RootNavigator ───┼─ isGuest ────────────────────► MainTabs → GameTab
                    │
                    ├─ !hasCompletedOnboarding ────► PostSignInOnboarding
                    │
                    ├─ !profileComplete ───────────► AuthStack(ProfileSetup)
                    │
                    ├─ !groupHydrated ─────────────► Splash
                    │
                    └──────────────────────────────► MainTabs → ProfileTab
```

**אורח לא מגיע ל-profile confirmation.** שני השערים האלה מסויגים ב-`!isGuest` מאז ומתמיד — לא בניתי מחדש את flow האימות, רק אימתתי שהם לא שולחים אנונימי לשם.

---

## 5 · Legacy onboarding — מה יצא ומה נשאר

**יצא מהמסלול:** שורה אחת ב-`RootNavigator` וייבוא אחד.

**נשאר בקוד, כפי שסיכמנו:**

| | |
|---|---|
| `OnboardingScreen.tsx` | הקובץ שלם, לא נגעתי |
| `onboardingDone` ב-store | נשאר, ועדיין נקרא ב-`hydrate` |
| `storage.getOnboardingDone` / `setOnboardingDone` | נשארו |
| `completeOnboarding` ב-store | נשאר |
| `ProfileSetupScreen` | נשאר רשום ב-`AuthStack` והשער שלו פעיל |

חיפוש אחרי `OnboardingScreen` מחזיר עכשיו רק את הקובץ עצמו ואת ההערה שלי. הוא לא בדרך הכניסה.

`userService.completeOnboarding` היא פונקציה **אחרת** — אישור הפרופיל ב-PostSignIn — ונשארה בשימוש מלא.

---

## 6 · Deep-link consumer — PendingAction flow

```
URL / deferred source
   │
   ├─ parseAppLink   → campaign (לא נגעתי)
   └─ parseInviteUrl → PendingInvite → stashPendingInvite (המפתח הישן)
                                        │
                     RootNavigator ─────┴─► readPendingAction()
                                              │  (קורא את החדש, נגזר מהישן)
                                              ├─ !isOpenKind  → מוחזק, לא נמחק
                                              ├─ open_invite  → clear
                                              └─ open_game / open_club → navigate
```

**שני התיקונים שפתחו את זה לאורח:**

```
- if (!currentUser || !profileComplete || !hasCompletedOnboarding) return;   // RootNavigator
+ if (!currentUser) return;
+ const viewerIsGuest = currentUser.isGuest === true;
+ if (!viewerIsGuest && (!profileComplete || !hasCompletedOnboarding)) return;

- isAuthReady = !!currentUser && isProfileComplete() && hasCompletedOnboarding();   // App.tsx warm
+ isAuthReady = !!currentUser && (viewerIsGuest || (isProfileComplete() && hasCompletedOnboarding()));
```

`isProfileComplete()` הוא *"יש שם לא ריק"*, ולאורח השם ריק בהגדרה. לכן **כל** deep link שנפתח בידי מי שאין לו חשבון נשמר ולא נצרך, והאדם נחת על פיד המשחקים בתמיהה. צפייה ביעד ציבורי לא דורשת חשבון — זו כל המשמעות של הקישור.

### פעולות כתיבה — מוחזקות, לא נזרקות

`isOpenKind()` מפריד "לנווט לאיפה־שהוא" מ"לכתוב משהו". `join_game`, `join_club`, `create_club`, `create_game`, `save_availability` — אם אחת מהן מגיעה לצרכן, הוא **יוצא בלי למחוק**. ההתכוונות עדיין תקפה, והמכניקה שתשלים אותה מגיעה בסבב הבא. מחיקה כאן הייתה השלכה שקטה של מה שמישהו ביקש.

הפונקציה מפרישה 3 מ-8, וסוג חדש שיתווסף נופל אוטומטית לצד ה"לא" — הכיוון הבטוח.

---

## 7 · Game / Club / Invite

### Game deep link

```
URL → open_game → pre-flight getGameById → MatchDetailsScreen
```

אורח רואה את המשחק. אין login, אין onboarding, אין profile setup. ה-pre-flight והטיפול בשגיאות **לא נגעתי בהם** — שלוש התוצאות הקיימות נשמרו כפי שהן: קיים → נווט; נמחק → הודעה קיימת + ניקוי; `ACCESS_BLOCKED` → נווט בכל זאת כדי שהמסך יציג את תצוגת החסימה שלו.

הוספתי `PendingActionFailed{reason:'target_deleted'}` לצד ה-`InviteLinkDead` הקיים — שני אירועים על אותו רגע, כי הראשון הוא על הקישור והשני על הפעולה.

### Club deep link

```
URL → open_club → CommunityDetails (חבר) | CommunityDetailsPublic (לא חבר)
```

ההפרדה הזו כבר הייתה ב-`navigateInvite`. `CommunityDetailsPublic` קורא `/groupsPublic`, שאורח מורשה לו גם בכללים החדשים. **לא פתחתי שום מידע member-only** ולא נגעתי בקומפוננטות.

### Personal invite — plumbing בלבד

`open_invite` הוא type חוקי שהצרכן מקבל. **כרגע הוא מנקה את ה-stash ומשאיר את האדם בבית.** אין מסך ייעודי ולא בניתי אחד.

מה כן נשמר: `invitedBy` ממשיך להיכתב בידי `applyInviteAttributionIfFresh`, ו-`acquisition` בידי `applyAcquisitionIfFresh` — **שתיהן לא נגעתי בהן**, ושתיהן קוראות את המפתח הישן שממשיך להתמלא. `has_inviter` נשלח על `entry_source_resolved` כדי שהערוץ יהיה נמיד.

> ההתנהגות הזו זהה למה שהיה קודם עבור `type:'app'`. השינוי היחיד הוא שעכשיו זה סוג מוצהר במקום ענף מיוחד.

---

## 8 · Push — מה השתנה ומה לא

**השתנה:** ה-startup לא מבקש הרשאה יותר.

```
- notificationsService.requestAndRegisterPushToken(currentUser.id)
+ notificationsService.registerPushTokenIfPermitted(currentUser.id)
```

הפונקציה החדשה זהה לישנה **חוץ מדבר אחד**: אין `requestPermissionsAsync`. היא בודקת `getPermissionsAsync`, ואם אין הרשאה — יוצאת בשקט.

**לא השתנה:**

| | |
|---|---|
| מי שכבר נתן הרשאה | הטוקן ממשיך להירשם בכל עלייה. FCM מסבב טוקנים, ובלי זה ההתראות שלו היו נכבות |
| `registerDeviceToken` | לא נגעתי |
| טיפול בהתראות | לא נגעתי |
| deep link מהתראה | לא נגעתי |
| `requestAndRegisterPushToken` | נשארה בדיוק כפי שהיא, ועדיין נקראת מ-`NotificationsSettingsScreen` — המקום ההקשרי הנכון, שבו האדם בעצמו מדליק התראות |
| אורחים | דולגו מאז ומתמיד |

לא בניתי contextual prompts. פשוט לא מבקשים לפני שיש הקשר.

---

## 9 · Joryio — התנהגות בפועל

התשתית מהסבב הקודם מתקיימת עכשיו על אורח **אמיתי**:

| תרחיש | מה קורה |
|---|---|
| אורח טרי | `bindIdentity({isAnonymous:true})` → **`'none'`**. אין identify, אין alias. ה-SDK נשאר אנונימי והאירועים נצברים על ה-anonymousId שלו |
| חשבון קיים בעלייה קרה | identify **פעם אחת**. `identifiedUid` חוסם חזרות של token refresh |
| מאזינים | אחד לכל התהליך (`ensureIdentityWatch`), וההבטחה מתנתקת — התיקון מהסבב הקודם |
| uid אנונימי כזהות | **לעולם לא נשלח** |
| היכולת ל-alias בעתיד | שלמה. `unclaimedAnonymousRun` מסומן כשהאורח נכנס, וכשיגיע ה-upgrade הוא יפעיל `alias` לפני `identify` |

`guest_session_started` מתווסף עכשיו **כי יש לו אתר קריאה אמיתי** — אחרי `signInAsGuest` מוצלח ב-`hydrate`, ולא לפני.

---

## 10 · Analytics

### נוספו — 7 קבועים, כולם עם אתר קריאה

| קבוע | ערך | אתר קריאה | פרמטרים |
|---|---|---|---|
| `GuestSessionStarted` | `guest_session_started` | `userStore.hydrate` | `origin` |
| `EntrySourceResolved` | `entry_source_resolved` | `App.tsx` סוף שרשרת המקורות | `entry_source`, `resolved_by`, `is_guest`, `target_type`, `target_id`, `has_inviter` |
| `OrganicEntryViewed` | `organic_entry_viewed` | `RootNavigator` | `is_guest` |
| `DeferredDeepLinkResolved` | `deferred_deep_link_resolved` | `installReferrerService` + `clipboardInviteService` | `channel`, `target_type`, `target_id`, `has_inviter` |
| `PendingActionSaved` | `pending_action_saved` | `App.tsx` cold stash | `kind`, `origin`, `has_draft` |
| `PendingActionResumed` | `pending_action_resumed` | הצרכן | `kind`, `origin`, `age_ms`, `is_guest` |
| `PendingActionFailed` | `pending_action_failed` | הצרכן, יעד מחוק | `kind`, `reason` |

### נעשה שימוש חוזר — לא duplicate

**`deep_link_received` לא נוסף.** `InviteLinkOpened: 'invite_link_opened'` כבר היה מוגדר וזהה סמנטית — הוא פשוט לא נקרא אף פעם וישב ב-`KNOWN_UNWIRED`. חיברתי אותו והוצאתי אותו מה-allowlist, מה שגם מקיים את בדיקת "the allowlist has not gone stale".

### `entry_source` — אוצר מילים סגור

`organic` · `game_link` · `club_link` · `personal_invite` · `unknown`
ו-`resolved_by`: `deep_link` · `stash` · `deferred` · `organic`

**`entry_source_resolved` נורה פעם אחת בכל עלייה קרה, כולל `organic`.** זה כל הערך: בלי אירוע חיובי ל"בא מכלום", החלק האורגני נגזר מהיעדר אירועים אחרים — והיעדר הוא לא מספר שאפשר לסמוך עליו.

### PII

`target_id` נשלח רק עבור משחק או מועדון — **ציבוריים**, וזה מה שהופך שורת משפך למצטרפת ליעד אמיתי. **`inviter_uid` לא נשלח** — זו זהות של אדם. במקומו `has_inviter: boolean`, שעונה על שאלת הערוץ בלי לזהות אף אחד.

---

## 11 · Tests

| פקודה | תוצאה |
|---|---|
| `npx tsc --noEmit` | ✅ PASS · 0 |
| `cd functions && npx tsc --noEmit -p .` | ✅ PASS · 0 |
| `npx jest` | ✅ **1857** · 139 suites (היה 1844 · 138) |
| `npm run test:rules` | **268** · 265 pass · **3 fail — אותן שלוש** |
| `npx jest analyticsWiring` | ✅ 5/5 |

### 13 בדיקות חדשות

**`tests/logic/silentGuest.test.ts` — 10**

| קבוצה | מה נבדק |
|---|---|
| חשבון קיים | המשתמש האמיתי נשאר · `signInAsGuest` לא נקרא · אין `GuestSessionStarted` |
| אורח קיים | חוזר כרגיל · **אין חשבון אנונימי שני** |
| התקנה טרייה | סשן נוצר · נכנס לאפליקציה · האירוע נורה **פעם אחת** עם `origin:'silent'` |
| אטומיות | `hydrated` עוד `false` בתוך `signInAsGuest`, ו-`true` רק אחרי |
| אופליין | `hydrated` **כן** true · `guestInitFailed` true · `logError` נורה · אין `GuestSessionStarted` · hydrate מאוחר מצליח |
| כשל בקריאת המשתמש | עולה בכל זאת כאורח · `BootHydrateFailed{source:'user_read'}` |
| אובייקט האורח | `isGuest:true`, `name:''` · שום דבר לא כותב `/users` |

**`tests/logic/pendingAction.test.ts` — +3** על `isOpenKind`: שלושת סוגי ה-open מותרים, חמשת סוגי הכתיבה נדחים, וההפרשה מדויקת 3/5.

### מה לא ניתן לבדיקה אוטומטית

`testEnvironment: 'node'` — אין רינדור. ה-decision tree של `RootNavigator`, ה-`initialRouteName`, וההתנהגות של `MainTabs` נבדקים ידנית (סעיף 12). זו המגבלה של התשתית, לא בחירה.

---

## 12 · Manual QA matrix

### Android

| # | תרחיש | ציפייה |
|---|---|---|
| 1 | clean install, מקוון | ללא carousel · ללא login · נוחת על **פיד המחזורים** |
| 2 | clean install, **במטס** | נופל למסך התחברות, לא splash תקוע |
| 3 | clean install → כיבוי והפעלה | אותו סשן אנונימי, **לא נוצר שני** |
| 4 | אורח קיים | ממשיך כאורח · ללא carousel |
| 5 | חשבון קיים | **בדיוק** החוויה שלו · נוחת על ProfileTab |
| 6 | חשבון קיים שנתן push בעבר | התראות ממשיכות להגיע |
| 7 | clean install, הרשאת push undetermined | **אין דיאלוג OS בעלייה** |
| 8 | קישור למשחק, cold, מותקן | פותח את המשחק. אורח רואה אותו |
| 9 | קישור למשחק, warm | פותח מיד, בלי stash |
| 10 | קישור למשחק, cold, **לא מותקן** | Play → install referrer → המשחק |
| 11 | קישור למשחק שנמחק | ההודעה הקיימת + ניקוי |
| 12 | קישור למועדון, cold + warm | מועדון ציבורי · אורח רואה |
| 13 | קישור אישי `/app?invitedBy=` | נכנס לאפליקציה · הייחוס נשמר |
| 14 | קישור, ואז restart לפני צריכה | היעד שורד ונצרך |
| 15 | אותו קישור פעמיים | נצרך **פעם אחת** |
| 16 | install referrer מול קישור קיים | הקישור מנצח, ה-referrer לא דורס |
| 17 | פתיחה מהתראה | היעד עובד כרגיל |
| 18 | כרטיס שחקן כאורח | שם + אווטאר + ההודעה · Back רגיל |

### iOS

אותם 18, בשני הבדלים:

| # | תרחיש | ציפייה |
|---|---|---|
| 10′ | לא מותקן | App Store → **לוח** → המשחק |
| 8′ | בקשת ההדבקה | מופיעה **פעם אחת בלבד** להתקנה |

**לא שיניתי את התנהגות ה-deferred** מעבר למה שהצרכן דרש — שני השירותים קיבלו אירוע מדידה ולא לוגיקה.

### מה לזכור בזמן QA מול פרודקשן

**הכללים בפרודקשן עדיין רחבים יותר.** אורח שם קורא הכול. לכן QA מול פרודקשן מוכיח **ניווט וזרימה**, ולא את מודל הגישה. ההוכחה למודל החדש מגיעה מסוויטת האמולטור — 268 בדיקות, 19 מהן ב-`anonymousAccess.test.mjs`.

---

## 13 · Production safety

**`firestore.rules` לא נפרסו. מאומת מול ה-API, לא מהזיכרון:**

```
live ruleset updateTime: 2026-09-22T07:11:58.924124Z
→ STILL 22.09 — NOT deployed ✓
```

זה התאריך של תיקון ה-`is list`. לא פרסתי כללים, לא hosting, ולא פונקציה נוספת בסבב הזה. ההחלטה לא זזה גם כשכל הבדיקות עברו.

---

## 14 · ממצאים

> ⛔ **1 · הבית של אורח היה הפרופיל הריק שלו**
>
> `MainTabs` נוחת על `ProfileTab`. עבור אורח זה פרופיל של אדם שלא קיים — בלי שם, בלי משחקים, בלי checklist. הנחיתה הכי גרועה האפשרית למי שמחליט אם האפליקציה הזו בשבילו.
>
> תיקנתי במסך **קיים**, לא ב-redesign: אורח נוחת על `GameTab`. פיד המחזורים כבר מחזיק רשימת discovery וכבר מטפל ב"אתה בלי מועדונים" בשורה אחת ולא בקיר — הוא מציג משחקים אמיתיים בלי שינוי אחד. מיפיתי מה הוא קורא: `games` בלבד + `hydratePlayers` (שכבר עבר ל-`usersPublic`). **אפס קולקציות מגודרות.**

> **2 · `ProfileScreen` כבר היה מוכן**
>
> 16 הסתעפויות `isGuest` קיימות בו. לא נדרש שינוי, ואורח שיגיע אליו ידנית יראה מסך תקין.

> **3 · המפתח החדש עדיין לא נכתב בכלל**
>
> `writePendingAction` אינו נקרא באפליקציה. `App.tsx` עדיין כותב דרך `stashPendingInvite` למפתח הישן, ו-`readPendingAction` **נגזר** ממנו. כלומר `PendingAction` מתפקד כרגע כ**תצוגה מוטיפסת מעל המפתח הישן**.
>
> זה מכוון: אפס מסלולי כשל חדשים, ושמונת הקוראים הישנים לא מרגישים כלום. העברת הכתיבות היא חלק מסבב ה-contextual auth, שבו נוצרות פעולות שלמפתח הישן אין בהן ייצוג.

> **4 · `onboardingDone` הוא עכשיו דגל מת**
>
> אין קורא חוץ מ-`hydrate`, ו-`completeOnboarding` נקרא רק מהמסך שלא מגיעים אליו. כפי שסיכמנו — נשאר בקוד. מועמד ל-cleanup יחד עם `ProfileSetupScreen` אחרי release אחד יציב.

---

## 15 · Git

**מאז `ffcba25`:**

| קובץ | + | − |
|---|---|---|
| `src/navigation/RootNavigator.tsx` | 136 | 19 |
| `App.tsx` | 77 | 3 |
| `src/store/userStore.ts` | 56 | 3 |
| `src/services/notificationsService.ts` | 50 | 0 |
| `src/services/analyticsService.ts` | 21 | 0 |
| `src/navigation/MainTabs.tsx` | 15 | 1 |
| `src/services/pendingAction.ts` | 12 | 0 |
| `src/services/installReferrerService.ts` | 9 | 0 |
| `src/services/clipboardInviteService.ts` | 7 | 0 |
| `tests/logic/pendingAction.test.ts` | 34 | 0 |
| `tests/logic/analyticsWiring.test.ts` | 0 | 1 |
| `tests/logic/silentGuest.test.ts` | 225 | חדש |
| **סה"כ** | **~618** | **27** |

**הכול עדיין לא committed.** אף קובץ מרשימת §21 לא נגע: `guestGate`, `draftStore`, שני האשפים, `CreateGroup`, `GameCreate`, `public/`, `firebase.json`, `app.json`, `firestore.rules`.

---

## 16 · הסבב הבא — המלצה בלבד

הזרימה החדשה שלמה עד הרגע שבו מישהו רוצה **לעשות** משהו. שם היא נעצרת בכוונה: פעולת כתיבה נשמרת ומוחזקת, ואין מה שישלים אותה.

1. **QA ידני על השינוי הזה** — במיוחד שורות 2, 3, 5, 7 בטבלה. שלוש מהן לא ניתנות לבדיקה אוטומטית והן הרגישות ביותר.
2. **Contextual auth** — ה-bottom sheet + `upgradeAnonymous` ההיברידי שכבר אושר. זה מה שהופך את הפעולות המוחזקות למבוצעות.
3. **חיבור הטיוטות** — `draftStore` ממתין עם אתר קריאה אפס.
4. **ואז** גרסה, אימוץ, ופריסת הכללים.

> **דבר אחד ששווה לשקול לפני 2:** אפשר לשלב את בניית ה-contextual auth עם שחרור גרסה שכוללת רק את סבב התשתית וסבב הכניסה. זה מתחיל לצבור אימוץ ל-`hydratePublicUsers` **במקביל** לפיתוח, במקום בטור אחריו — ומקצר את הדרך לפריסת הכללים. לא נגעתי, זו החלטה שלך.

**לא אתחיל את ה-contextual authentication flow בלי אישור מפורש.**

---

*ענף `perf/firestore-read-costs`, 24.09.2026. Checkpoint `ffcba25`; העבודה שאחריו לא committed. לא נפרס דבר בסבב הזה — הכללים בפרודקשן מאומתים כישנים.*
