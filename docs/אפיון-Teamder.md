# אפיון מלא — אפליקציית Teamder

> מסמך-אמת חי של המערכת. נבנה אוטומטית מסריקת-עומק מרובת-סוכנים (16.07.2026) ומיועד לשמש **נקודת-פתיחה לפני כל פיצ׳ר חדש** — מה קיים, איפה הדברים גרים, ואילו מוסכמות חובה לשמור.

## 1. תקציר המוצר

**Teamder** היא אפליקציית ארגון-כדורגל מהיר (React Native / Expo, RTL מלא, Firebase). היא פותרת את הכאב של ארגון משחק שבועי בקבוצת-הודעות: מי מגיע, מי חסר, איך מחלקים כוחות, ואיך שומרים סטטיסטיקות — הכל במקום אחד.

* **קהל יעד:** קבוצות כדורגל קבועות ("הרגולרים") + השלמת-שחקנים לשבועות-חוסר ע״י הגעה לזרים בתוך האפליקציה.
* **תהליך-הליבה:** מנהל פותח משחק → נרשמים מתמלאים (כולל רשימת-המתנה) → יום-המשחק: מעבר ללייב, טיימר מסונכרן, חלוקת-כוחות, הבקעות → סיום-ערב → סטטיסטיקות + סיכום-הערב.
* **מה מבדיל מקבוצת-הודעות:** רשימה הוגנת לפי זמן-הקשה, קדימות-לרגולרים, השלמה אוטומטית מזרים, כוחות-מאוזנים, סטטיסטיקות-אמת, טיימר מסונכרן חוצה-מכשירים (כולל שעון ווידג׳ט), וייחוס-הזמנות.

## 2. מוסכמות-חובה לכל פיצ׳ר חדש  ⭐

לפני שכותבים פיצ׳ר — לעבור על הרשימה:

* **RTL תמיד.** כל מסך מיושר לימין. לא להסתמך על `flexDirection` — **לאמת עם צילום-מסך מהאמולטור.** מלכודות ידועות: avatar-first + `flexDirection:'row'` = אווטאר מימין; מחרוזת מרווחת `"{x} / {y}"` מתהפכת ב-RTL → לעטוף בבידוד-כיווניות (LRI `⁦` … PDI `⁩`); `<Button>` בלי `fullWidth` נערם.
* **מחרוזות רק ב-`src/i18n/he.ts`.** עברית בלבד בכל טקסט למשתמש — בלי אנגלית מעורבת.
* **רישום-מסכים בכל מחסנית.** מסך המשותף לכמה טאבים חייב להירשם ב**כל** מחסנית שמארחת את ההורה (`GameStack` / `CommunitiesStack` / `ProfileStack`) — אחרת `navigate()` **נכשל בשקט** (ה-cast של `nav` מסתיר את זה מ-tsc). זה גרם לבאג "קביעת כוחות לא עושה כלום ממסך המועדון".
* **מצב-מוק.** `USE_MOCK_DATA` / `EXPO_PUBLIC_FOOTY_FORCE_MOCK=1` (קובץ `.env.local`). ⛔ **למחוק `.env.local` לפני כל בניית-פרודקשן** (הוא מרעיל את הבילד). מנויי-הלייב במוק דורשים polling (לא callback חד-פעמי).
* **קריאות Firestore טריות:** להשתמש ב-`documents:runQuery` (orderBy) ולא ב-`list` — ה-list מחזיר נתונים ישנים.
* **טיימר-לייב:** בסיס-זמן הוא `serverNow()` (= `Date.now()+offset`), **לא** `Date.now()`. הנתונים הפיזיים מכוסים ל-`liveMatch.activeIntervals`.
* **סטטיסטיקות:** `commitRoundStats` (CF) הוא הנתיב האטומי היחיד — נעילת-אידמפוטנטיות (`committedRounds`), סינון no-show, וזוגות-שחקנים באותה batch.
* **מנהל = יוצר-המשחק (`createdBy`) או מנהל-קהילה (`group.adminIds`).** לבדוק את שניהם.
* **לוג-גרסאות:** כל תיקון/פיצ׳ר נרשם ל-`appConfig/releaseLog` (version `'next'`→`'1.0.x'`) + למסמך ב-Pulse.
* **אנימציות:** להשתמש בסט-האנימציות הקיים (`src/components/anim`: BallSwitch, RollAwayCta, RollInView, ArcPopIn, MatchClockLoader) לפני שמאמצים חלופה.
* **בנייה:** להעלות ל-track-בדיקה קודם, לפרודקשן רק באישור מפורש. לבמפ `version` + `versionCode` בכל בילד.

---



# 3. מסכים וניווט

I now have full coverage of all navigation files and all 44 screen files. Here is the report.

---

# מיפוי מסכים וניווט — אפליקציית Teamder (React Native/Expo)

**קבצים:** `src/navigation/` (8 קבצים), `src/screens/` (44 קבצי מסך). כל הממצאים להלן מבוססים על קריאת הקוד בפועל.

## 1. ארכיטקטורת הניווט הכללית

**`RootNavigator.tsx`** — "מחליט עליון" שאינו סטאק אמיתי אלא רנדור מותנה (כל מעבר מצב מרכיב מחדש את הסטאק, בלי היסטוריה משותפת):

1. `!userHydrated` → **Splash** (`SplashVisual`)
2. `!onboardingDone` → **OnboardingScreen** (טרום-הרשמה)
3. `!currentUser` → **AuthStack** (SignIn)
4. משתמש אורח (`isGuest`) → מדלג על כל השערים וישר ל-**MainTabs** (דרישת App Store 5.1.1(v) — עיון ללא חשבון; פעולות חשבון חסומות ב-`ensureNotGuest`)
5. `!hasCompletedOnboarding` → **PostSignInOnboardingScreen**
6. `!profileComplete` → **AuthStack** (ProfileSetup)
7. `!groupHydrated` → Splash → לבסוף **MainTabs**

תופעות לוואי שמנוהלות ב-RootNavigator: צריכת deep-link ממתין (מקום יחיד בקוד שמנווט מהזמנות), אתחול Remote Config ומודעות, מודעת app-open (רק כשחבר בקבוצה ולא בזמן משחק חי), listener חי על קבוצות ועל מסמך `/users/{uid}` של המשתמש, רישום טוקן פוש (מדלג על אורחים).

**`MainTabs.tsx`** — 4 טאבים (`createBottomTabNavigator`), טאב פתיחה: **ProfileTab (בית)**:

| טאב | סטאק | מסך שורש |
|---|---|---|
| ProfileTab (בית) | ProfileStack | Profile |
| CommunitiesTab (מועדונים) | CommunitiesStack | CommunitiesFeed |
| GameTab (משחקים) | GameStack | GamesList |
| ChatTab (צ'אטים) | ChatStack | ChatsList (+ badge לא-נקראו מ-`chatStore`) |

- באנר פרסומת (`BannerAd`) מוצמד מעל שורת הטאבים, **מוסתר כשהמסך העליון הוא `LiveMatch`** (`NO_ADS_ROUTES`).
- לחיצה על טאב מאפסת את הסטאק הפנימי לשורש הקבוע (`TAB_ROOT`) — כולל "ריפוי עצמי" של סטאק פרסיסטנטי מושחת מ-deep-link.
- מנוי unread גלובלי לצ'אט רץ ברמת MainTabs.

**דפוס שכפול מכוון:** שרשרת מסכי המשחק (MatchDetails, LiveMatch, MatchPlayers, AvailablePlayers, AddMembers, GameEdit, EveningSummary, GameCreate) ושרשרת מסכי המועדון (CommunityDetails/Edit/Players/Stats/History) רשומות **בשלושה סטאקים** (Game/Communities/Profile), ו-PlayerCard/PlayerCompare גם ב-ChatStack — כדי ש-back יחזור למקור ולא יקפוץ טאב. הערות בקוד מתעדות באג ידוע: מסך שחסר באחד הסטאקים גורם ל-`navigate()` להיכשל בשקט.

## 2. עץ ניווט מלא

```
Root (רנדור מותנה)
├─ SplashVisual
├─ OnboardingScreen (טרום-הרשמה, 3 שקופיות)
├─ AuthStack: SignIn → EmailAuth / ProfileSetup
├─ PostSignInOnboardingScreen
└─ MainTabs
   ├─ ProfileTab → ProfileStack:
   │   Profile, Requests, ProfileEdit, AvailabilityEdit, NotificationsSettings,
   │   BlockedUsers, PlayerCard, PlayerCompare, PlayerTimeline, AdminApproval,
   │   History, Achievements, Statistics, Friends, Referrals, Feedback,
   │   + שרשרת משחק (MatchDetails, EveningSummary, MatchPlayers, AvailablePlayers,
   │     AddMembers, GameEdit, LiveMatch, GameCreate)
   │   + שרשרת מועדון (CommunityDetails, CommunityEdit, CommunityPlayers,
   │     CommunityStats, CommunityHistory)
   ├─ CommunitiesTab → CommunitiesStack:
   │   CommunitiesFeed, Requests, CommunitiesMap (MapScreen), CommunitiesCreate,
   │   CommunityDetails, CommunityDetailsPublic, CommunityEdit, CommunityPlayers,
   │   CommunityStats, CommunityHistory, PlayerCard, PlayerCompare, PlayerTimeline,
   │   AdminApproval, History + שרשרת משחק מלאה
   ├─ GameTab → GameStack:
   │   GamesList, Requests, GamesMap (MapScreen), GameCreate, GameEdit,
   │   MatchDetails, EveningSummary, LiveMatch, AvailablePlayers, AddMembers,
   │   MatchPlayers, DraftSetup, DraftBoard, PlayerCard, PlayerCompare,
   │   PlayerTimeline, AdminApproval, History, PromoteOrphan + שרשרת מועדון
   └─ ChatTab → ChatStack:
       ChatsList, GameChat, CommunityChat, DirectChat, PlayerCard, PlayerCompare
```

הערה: `DraftSetup`, `DraftBoard`, `PromoteOrphan`, `GamesMap` רשומים **רק ב-GameStack**; `CommunityDetailsPublic`, `CommunitiesCreate`, `CommunitiesMap` רק ב-CommunitiesStack; `Feedback`, `Referrals`, `Friends`, `Achievements`, `Statistics`, `ProfileEdit`, `AvailabilityEdit`, `NotificationsSettings`, `BlockedUsers` רק ב-ProfileStack.

## 3. מלאי מסכים

### 3.1 טעינה, אימות ואונבורדינג

| מסך | פרטים |
|---|---|
| **SplashScreen** (`SplashScreen.tsx`) | אנימציית פתיחה (מגרש נצייר + כדור קופץ + לוגו "Teamder", מינימום 1.4 שניות). מייצא `SplashVisual` לשימוש חוזר ב-RootNavigator כדי שלא יהיו שני לואדרים שונים. אין ניווט/דאטה. |
| **OnboardingScreen** | 3 שקופיות מכירה על גרדיאנט כחול; ה-Preview-ים הם צילומי מסך אמיתיים בתוך מסגרת טלפון (`OnboardingPreviews.tsx` — קומפוננטות, לא מסכים). כפתור סיום קורא `completeOnboarding` (userStore, persist מקומי). |
| **SignInScreen** | כניסה: Google, Apple (iOS בלבד — דרישת 4.8), "המשך עם מייל" → EmailAuth, וכניסת אורח (`signInAsGuest`). ספינר פר-ספק; סינון שגיאות טרנזיינטיות מ-error log; ביטול ע"י המשתמש לא מציג שגיאה. |
| **EmailAuthScreen** | טופס אחד עם שני מצבים (הרשמה/כניסה) + "שכחת סיסמה?" (reset email). ולידציה: regex אימייל, סיסמה ≥6, אימות סיסמה בהרשמה. מזהה `EmailRegisteredWithProviderError`. |
| **ProfileSetupScreen** | לכידת שם ראשונית שחוסמת כניסה לאפליקציה (מוצג רק כש-`!profileComplete`). כותב דרך `updateProfile`; כשל מציג דיאלוג (לא נכשל בשקט). |
| **PostSignInOnboardingScreen** | צעד יחיד אחרי הרשמה: שם + תמונת פרופיל (העלאה מהגלריה דרך `pickAndUploadAvatar` או אווטאר מובנה — בחירה אחת מנקה את השנייה). דחיית הרשאת גלריה עוברת בשקט (5.1.1(iv)). שמירה → `completePostSignInOnboarding` (כותב `onboardingCompleted` על `/users/{uid}`). |

### 3.2 טאב בית (ProfileStack)

| מסך | פרטים |
|---|---|
| **ProfileScreen** ("בית") | מסך הנחיתה של האפליקציה: ברכת שלום (`HomeGreetingHeader`) + פעמון בקשות (מונה מ-`getInboxCount`) → Requests; כרטיס המשחק הבא; כרטיס/פרומפט זמינות ("פנויים לשחק לידך", מוזן מ-`homeConfigService`, יכול לפתוח GameCreate עם prefill תאריך/עיר/`inviteAvailable`); צ'קליסט התחלה (תמונה→ProfileEdit, זמינות→AvailabilityEdit, מועדון→CommunitiesTab, משחק→GameTab, הזמן חברים); כרטיס "הידעת" עם טיפים מנווטים; כרטיס הפניות (→Referrals, מאחורי דגל `feature_referrals`); תפריט המבורגר ☰ עם: הישגים, סטטיסטיקות, עריכת פרופיל, חברים (`feature_friends`), זמינות, היסטוריה, אישורי הצטרפות (אדמין בלבד), הגדרות התראות, חסומים, דיווח תקלה/הצעת שיפור (`feature_feedback`), דרג את האפליקציה (rcString store_url), התנתקות ומחיקת חשבון (`DeleteAccountSheet`). מרענן `/users` טרי בכל focus. **קוד מוסתר:** `DisciplineRow` (מד אמינות) מיובא בהערה — הוסתר מה-UI בכוונה. |
| **ProfileEditScreen** | עריכת שם + תמונה/אווטאר. מסנכרן state מקומי מהחנות בכל שינוי (המסך חי בסטאק בין ביקורים). כותב `updateProfile` + Storage לתמונה. |
| **AvailabilityEditScreen** ("מצא לי משחקים") | ימים (chips), חלונות זמן (בוקר/צהריים/ערב), מפת רדיוס (5–50 ק"מ) עם פין + reverse-geocode לעיר, טוגל התראות הזמנה. שומר `users/{uid}.availability`; מזין את מנוע ההתאמות בצד השרת ואת מסך הזמינות ב-Pulse. `useUnsavedChangesGuard` נגד יציאה בלי שמירה. |
| **NotificationsSettingsScreen** | טוגלים לכל סוג פוש בקטגוריות (משחקים/מועדונים/חברים/כללי); שומר `users/{uid}.notificationPrefs` (הפונקציות בענן מכבדות לפני שליחה). שער "הפעל התראות" ברמת ה-OS מעל הטוגלים כשההרשאה לא ניתנה (כולל קפיצה ל-Settings). |
| **BlockedUsersScreen** | רשימת חסומי-צ'אט מ-`/users/{uid}/blocked` (listener חי) + כפתור ביטול חסימה (מחיקת המסמך). |
| **AchievementsScreen** | גריד הישגים אישיים + פופאובר פירוט; מושך `/users/{uid}` טרי ומחשב מונים נגזרים (רשימת unlocked שנשמרה תמיד גוברת). יעד הפוש `growthMilestone`. |
| **StatisticsScreen** | מספרי השחקן + סופרלטיבים חברתיים (הכי שיחקתי איתו, הצמד המנצח, הקורבן, הנמסיס) מ-`playerStatsService` (≤3 קריאות); גולים נמשכים מהשרת (לא מהחנות המקומית שעלולה לפגר). |
| **FriendsScreen** | בקשות נכנסות (אישור/דחייה) + רשימת חברים (טאפ→PlayerCard, הסרה) + שיתוף קישור הזמנה קצר. הכל דרך `friendsService` (callable באישור). יעד הפוש `friendRequest`/`friendRequestAccepted`. |
| **ReferralsListScreen** | "שחקנים שהצטרפו דרכי" — כל מי ש-`invitedBy` שלו = המשתמש, מיון חדש-ראשון; טאפ→PlayerCard. קריאה חד-פעמית בכל focus. |
| **FeedbackScreen** | טופס תקלה/הצעה (טוגל מוסתר כשמגיעים עם `type` קבוע מהתפריט); ≤2000 תווים; כותב מסמך ל-collection‏ `feedback` (נקרא ב-Pulse). |
| **HistoryScreen** | היסטוריה **אישית חוצת-קבוצות** — משחקים שהמשתמש שובץ בהם והתקיימו (`getPlayedGames`); שורה→MatchDetails. שגיאת טעינה נרשמת (לא מוסווית כ"אין היסטוריה"). |
| **RequestsScreen** | אינבוקס בקשות מאוחד (מהפעמון): בקשות חברות, הצטרפות למועדונים שאני מנהל, הצטרפות למשחקים שיצרתי — כולל "אשר הכל" פר-קטגוריה (`requestsService`, תוצאות bulk עם ok/failed). רשום ב-3 סטאקים (לא בצ'אט). |

### 3.3 טאב מועדונים (CommunitiesStack)

| מסך | פרטים |
|---|---|
| **PublicGroupsFeedScreen** ("מועדונים") | פיד: הירו, חיפוש + סינון (כולל "לידי" מבוסס הרשאת מיקום/רדיוס), "המועדונים שלי" (אדמין צף למעלה), "ממתינים לאישור", "מועדונים פתוחים" (מ-`/groupsPublic`), FAB יצירה, וכניסה ל-**CommunitiesMap**. בקשת הצטרפות ישירות מהפיד (`requestJoinById`, אורח נחסם ב-`ensureNotGuest`; `GroupJoinRejectedError` מטופל). חבר→CommunityDetails; לא-חבר→CommunityDetailsPublic. |
| **CommunityDetailsScreen** (חברים בלבד — קורא `/groups/{id}`) | דף המועדון: הירו אצטדיון (החלפת קאבר לאדמין — גלריה מובנית או העלאה), גריד סטטיסטיקות + רמת מועדון (`computeClubLevel`), טוגל התראות, כרטיס המשחק הבא + משחקים קרובים, רייל שחקנים, טבלת אליפות, CTA שיתוף הזמנה (קישור קצר `createShortInviteUrl` + WhatsApp). תפריט ☰: עריכה (אדמין), צור משחק קבוע → GameCreate‏ `recurring:true` (אדמין), אישורים (אדמין), רשימת שחקנים, היסטוריה, סטטיסטיקות, הזמן חברים, צור קשר עם אדמין (WhatsApp), עזיבה (חבר), **מחיקה — יוצר בלבד** (`creatorId`). פרמטר `celebrate` מפעיל קונפטי אחרי יצירה. **מוסתר:** `SCREENSHOT_MODE` (env `EXPO_PUBLIC_SCREENSHOT_MODE=1`) — פריסת צילום-שיווקי מצומצמת, לעולם לא בבילד חנות. |
| **CommunityDetailsPublicScreen** | תצוגת לא-חבר, קורא **רק** `/groupsPublic/{id}` (בלי רשימות חברים בכוונה). מציג פרטים + ימי/שעת משחק נגזרים ממשחקים פומביים קרובים; CTA בקשת הצטרפות/ביטול בקשה; WhatsApp לאדמין. יעד deep-link לצוות כשלא חבר, ויעד פוש `rejected`. |
| **CreateGroupScreen** / **CommunityEditScreen** | מעטפות דקות מעל **GroupWizardForm** (לא route): אשף 2 צעדים — פרטים (שם, עיר עם autocomplete, טלפון, תיאור, חוקים) / מתקדם (פתוח-פרטי, מקס' חברים, דירוג פנימי + הסתרתו, כרטיסים + ימי תוקף). יצירה מבצעת geocode לעיר (עד 7 שניות, לא חוסם); עריכה מטפלת ב-`GROUP_MAX_BELOW_CURRENT` עם חזרה לצעד 2. |
| **CommunityPlayersScreen** | רשימת חברים מלאה + משחקים ששוחקו; ממוינת אדמינים→לפי משחקים. לאדמין: תפריט פר-שחקן — דירוג פנימי (`AdminRatingSheet`, 1–10), כרטיס צהוב/אדום (`IssueCardSheet`), ניהול ציוד כדור/גופיות (`ManageEquipmentSheet`), ציר זמן → PlayerTimeline; באדג'ים של כרטיסים פעילים. |
| **CommunityStatsScreen** | דשבורד הקבוצה: סך גולים/בישולים/משחקונים/ערבים, מובילים, טבלת 10 כובשים, סופרלטיבים, תארי מועדון (`computeClubBadges`) ורמה. נגזר כולו בצד לקוח משני rollups (`getCommunityChampionship`, `getCommunityStats`). |
| **CommunityHistoryScreen** | רשימת הערבים שהסתיימו (`getHistory` מסונן `finished`); שורה→MatchDetails. |
| **AdminApprovalScreen** | תור אישורים מאוחד לכל המועדונים שאני אדמין בהם (שורה = groupId+userId); אשר/דחה עם נעילת שורה נגד דאבל-טאפ. יעד פוש `joinRequest` (ללא gameId). |
| **PlayerTimelineScreen** | **אדמין בלבד** — ציר זמן פר-שחקן-פר-מועדון: כרטיסים (פעיל/פג/בוטל, long-press לביטול), מסירות ציוד, ואבני דרך חברות סינתטיות (הצטרף/הפך אדמין). |

### 3.4 טאב משחקים (GameStack)

| מסך | פרטים |
|---|---|
| **GamesListScreen** ("משחקים") | שני מצבים: "פתוחים" (ברירת מחדל) / "שלי". סינון (כולל "לידי"), נאדג' זמינות (חד-פעמי + snooze 3 ימים), הרשמה מהכרטיס (כולל `RegistrationConflictModal` להתנגשות מועדים), כניסה ל-**GamesMap**. FAB "+" פותח בורר יצירה: **משחק מהיר** (ללא מועדון; מאחורי דגל `feature_quick_games`; מקצה קבוצה אישית נסתרת) או **משחק מועדון** (נעול עם רמז כשאין מועדון). פרמטר `openCreate` (מהבית) פותח את אותו בורר. |
| **GameCreateScreen** / **GameEditScreen** | מעטפות מעל **GameWizardForm** (לא route): אשף 3 צעדים — מתי ואיפה (תאריך, מגרש, עיר + autocomplete/מפה) / פורמט (5v5 וכו', מס' קבוצות, משך, טוגלים) / ניהול (נראות, אישור נדרש, משחק קבוע → `registrationOpensAt`, דדליין ביטול, הערות, כדור/גופיות, הזמנת חברים). יצירה דרך `createGameV2` (+ פוש `newGameInCommunity`), עריכה דרך `updateGameV2`. פרמטרים: `groupId`, `recurring`, `quick`, `prefillDateMs/Window/City`, `inviteAvailable`. |
| **MatchDetailsScreen** (הגדול ביותר, ~4,700 שורות) | המסך המרכזי של משחק: הירו, גריד פרטים, מזג אוויר (`weatherService`), מונה שחקנים, רשימות players/waitlist/pending/אורחים, קבוצות שהוגרלו (DraftTeamCard), אליפות הערב, טבלת עובדות, הודעת אדמין נעוצה, צ'אט המשחק. CTA דביק: הרשמה (אופטימית, עם celebration כשנתפס מקום אמיתי; ווייטליסט/פנדינג עם טוסט מובחן) / ביטול / אישור הצעת מקום (`confirmSpotOffer`) / "הגש מועמדות" ל-fillers חיצוניים. תפריט ☰ (אדמין): עריכה, ניהול לייב/צפייה, ניהול שחקנים→MatchPlayers, חלוקת כוחות→DraftSetup/DraftBoard, הזמן זמינים→AvailablePlayers (+ "שלח לכולם" בפולסים), הוסף חברים→AddMembers (+מצב reserve), הפוך לפומבי/קהילתי, עזיבה, מחיקה. אחרי סיום: שיתוף "סיכום הערב"→EveningSummary, גולים רטרואקטיביים (`RetroGoalsSheet`, אדמין). מנוי realtime דרך `useGameEvents`; ידית לכל סוגי הפוש כמעט. אורח נחסם בפעולות. |
| **MatchPlayersScreen** | סגל מלא בחתכים (רשומים/המתנה/ממתינים לאישור/אורחים) + חיווי איחור/הברזה (`arrivals`), מחזיקי ציוד, כרטיסים. לאדמין: תפריט פר-שחקן (הסרה, קידום מהמתנה, אישור/דחייה, סימון הגעה, אורח — עריכה/דירוג-אורח), הוספת אורח (`GuestModal`). טאפ→PlayerCard. |
| **AvailablePlayersScreen** | לאדמין: מועמדים שהזמינות שלהם תואמת (יום+עיר+שעה, `findAvailablePlayers`), הזמנה פר-שורה (פוש `inviteToGame`) + כפתור "שליחה לכל הזמינים בפולסים" (מנוע ה-fillers, מצב `pulseSent` "השליחה החלה ✓"). |
| **AddMembersScreen** | לאדמין: רישום מרובה של חברי מועדון ישירות למשחק (`adminAddPlayers`, גלישה להמתנה, פוש `addedToGame`). מצב `reserve` — שריון מקומות לפני פתיחת ההרשמה (אותו שרת, קופי שונה). |
| **DraftSetupScreen** | חלוקת כוחות צעד 1: בחירת שיטה (דראפט קפטנים / איזון אוטומטי לפי דירוג פנימי `balanceTeams` + `TeamsEditModal` לעריכה), בחירת קפטנים (סדר הבחירה = סדר הקבוצות, 2–4 קבוצות), שיטת דראפט snake/regular (ללא ברירת מחדל — חובה לבחור). |
| **DraftBoardScreen** | צעד 2: לוח הדראפט — בחירות בתורות עם התקדמות אוטומטית, צבעי קבוצות, סיכום עם "סיים" (שומר `draftTeams` + פוש `teamsGenerated`). פרמטרים: `resume` (שחזור מ-draftTeams שמור), `readOnly` (צפייה לחברים שאינם מנהלים). |
| **LiveMatchScreen** | **ראוטר פנימי**: משחק עם `advancedMode:true` → מרנדר את `AdvancedLiveMatchScreen`; אחרת טיימר בלבד. המסך הפשוט: סטופר משותף מסונכרן-שרת (`useSyncedTimer` על timerRunning/LastStartedAt/AccumulatedMs — אותם שדות שהשעון ב-Wear קורא), התחל/עצור/המשך/אפס + סיום משחק, יומן עצירות מחושב מ-`timerEvents` (כולל דדופ), טוסט "אדמין אחר הפעיל/עצר". **פקדים לאדמין בלבד** (יוצר או אדמין המועדון); אחרים צופים. כניסה נשלטת ע"י `canEnterLive` (נפתח 30 דק' לפני). |
| **AdvancedLiveMatchScreen** (~2,150 שורות; **אינו route** — מרונדר מתוך LiveMatch) | לייב מתקדם: לוח תוצאות חי, הזנת גולים/בישולים (scorer-attributed, אורחים לא צוברים סטטים), רוטציית "מנצחת נשארת" (`rotationEngine` — סיום משחקון, בוחר מנצחת בתיקו `WinnerPickerModal`, מילוי שחקן חסר `FillerPickerModal`), `commitRoundStats` בצד שרת, ובסיום ערב — מסירת ציוד (`EquipmentHandoffModal`, רק אם הטיימר רץ בפועל). אדמין בלבד לפעולות. הופעל בפרודקשן מאז 1.0.28. |
| **EveningSummaryScreen** | כרטיס "סיכום הערב" האישי + שיתוף (צילום ל-PNG עם `captureRef` → share sheet). מנסה לקלוט דאטה פיזי מ-Health Connect (`physicalSyncService.syncForGame`, סקופ לדקות הטיימר) + CTA "חבר שעון" כשההרשאה לא ניתנה. רשום ב-3 סטאקים; יעד פוש `eveningSummary`. |
| **PromoteOrphanScreen** | הפיכת משחק-מהיר שהסתיים למועדון: שם+עיר+תיאור+חוקים + בחירת מוזמנים מהמשתתפים → callable‏ `promoteOrphanToGroup` (חושף את הקבוצה האישית, פוש `groupInvitation` למוזמנים) → ניווט ל-CommunityDetails החדש. |
| **MapScreen** | קומפוננטה אחת, שני מצבים (`mode: 'games' | 'communities'`) ושני שמות route (GamesMap/CommunitiesMap). מקבלת `MapItem[]` סריאליזבילי מהמסך הקורא (לא עושה fetch בעצמה — עובד גם במוק), צ'יפים לפי מצב (תאריך/סטטוס), טוגל שכבה שנייה (overlay), כרטיס תחתון → MatchDetails או CommunityDetails/Public. |

### 3.5 טאב צ'אטים (ChatStack)

| מסך | פרטים |
|---|---|
| **ChatsListScreen** | כל הצ'אטים: מועדונים + משחקים חיים/קרובים (`getMyLiveOrUpcomingGames` בכל focus) + DMs; מיון לפי אחרון-הודעה, באדג' unread פר-שורה. |
| **GameChatScreen** | מעטפת מעל `ChatView` (scope=game). מנחה = מארגן או אדמין המועדון. חברים = הסגל הרשום. משחק שנמחק/אין הרשאה → fallback ידידותי עם חזרה. |
| **CommunityChatScreen** | מעטפת מעל ChatView (scope=community); מנחה = אדמין. אם הקבוצה לא בחנות — ה-listener ייחסם ויוצג "אין גישה". |
| **DirectChatScreen** | DM ‏1:1 — מזהה את הצד השני מ-`convId` (`uidA__uidB`), יוצר את מסמך השיחה, מסמן נקרא. מבחין `permission-denied` ("רק חברים", `dmRestricted`) מכשל טרנזיינטי (retry). נפתח מ"שלח הודעה" בכרטיס שחקן דרך `goToDirectChat`. |

### 3.6 מסכי שחקן

| מסך | פרטים |
|---|---|
| **PlayerCardScreen** | פרופיל של כל משתמש. שני מצבים: תצוגה עצמית (זהות, הפניות, הישגים) מול תצוגת-אחר (כפתור חבר `FriendActionButton`, "שלח הודעה" → DM, מועדונים משותפים כצ'יפים לחיצים, head-to-head: משחקים משותפים, מאזן נצחונות/הפסדים, "השווה אליי" → PlayerCompare, דירוג פנימי לאדמין). ראה גם "קוד מת" בסעיף 5. |
| **PlayerCompareScreen** | השוואת ראש-בראש פר-מועדון (`playerCompareService`) ככרטיס שיתופי + צילום PNG לשיתוף. |

## 4. Deep links, פושים וקמפיינים

**אין `linking` prop על NavigationContainer.** כל ה-deep-links עוברים במסלול ידני: `App.tsx` קורא `Linking.getInitialURL()`/listener → `deepLinkService.parseInviteUrl` → stash‏ (`storage.setPendingInvite`) → הצרכן היחיד ב-RootNavigator מנווט כשהמשתמש מוכן (כולל בדיקת קיום מוקדמת, טיפול ב-`ACCESS_BLOCKED`, וטוסט "הקישור לא תקין" אם היעד נמחק).

**פורמטים של קישורים** (`deepLinkService.ts`):
- `teamder://session/<id>`, `teamder://team/<id>`, `teamder://app` (+ `footy://` — סכימת legacy)
- `https://teamderfc.web.app/session/<id>` / `/team/<id>` / `/app` / `/go` (רכישה) — כולם נושאים `invitedBy` לאטריביוציה, וכן קישורים קצרים `/i/<code>`.

**יעדי ניווט** (`navigationRef.ts`):
- `navigateInvite`: session→GameTab/MatchDetails; team→CommunityDetails (חבר) או CommunityDetailsPublic (לא-חבר). תמיד `initial:false` כדי שהשורש יישב מתחת ליעד (back לא יוצא מהאפליקציה).
- `navigateForPush` — טבלת ניתוב מלאה לכל סוגי הפוש: `chatMessage`→GameChat/CommunityChat/DirectChat לפי scope; ‏`joinRequest`→MatchDetails (עם gameId) או AdminApproval; ‏`approved/rejected`→MatchDetails או CommunityDetails/Public (דחוי מקבל את המסך הציבורי בכוונה); ‏`newGameInCommunity`, `gameReminder`, `gameCanceledOrUpdated`, `spotOpened`, `spotOffered`, `guestPromoted`, `inviteToGame`, `addedToGame`, `rateReminder`, `gameFillingUp`, `gameRsvpNudge`, `gamePlayersJoined`, `playerCancelled`, `teamsGenerated`, `fillerNoCandidates`, `fillerInterestReceived`, `fillerOpportunity`, `gameShortageWarning` → MatchDetails (וללא gameId → פיד המועדונים); ‏`eveningSummary`→EveningSummary; ‏`groupDeleted`→פיד; ‏`growthMilestone`→Achievements; ‏`promotePrompt`→PromoteOrphan; ‏`groupInvitation`→CommunityDetails; ‏`friendRequest/friendRequestAccepted`→Friends.
- `navigateCampaign` — כפתורי קמפיין-פופאפ שנכתבים ב-Pulse: `openUrl` (רק https/teamder/footy — חוסם `javascript:`), `openGame`, `openCommunity`, `openProfile`, `openScreen` (allowlist: communities/games/achievements/profile).
- `goToGameChat`/`goToCommunityChat`/`goToDirectChat` — קפיצה חוצת-טאבים לצ'אט עם `initial:false`.

## 5. לא-גמור, קוד מת, נסתר וניסיוני

**קוד מת / stale:**
1. **PlayerCardScreen — לוגיקת "הזמן למשחק" מתה:** `blockedReason` ו-`canInvite` (שורות 246–259) מחושבים במלואם (כולל טעינת `nextGame` של המזמין) אך **אינם בשימוש ברנדור** — ה-CTA הוסר לטובת חבר/DM/השוואה. גם `inviteSent` לעולם לא משתנה. הערת הכותרת ("stub for v1") מיושנת.
2. **הערות "MatchManage"** ב-ProfileStack/CommunitiesStack/GameStack מתייחסות ל-route שאינו קיים (המסך פורק); ב-GameStack יש גם הערה תלושה בסוף ה-ParamList על מסך "דרג את חבריך מהמשחק" **בלי route אחריה** — שריד מפיצ'ר דירוג-עמיתים שנמחק (הדירוג כיום פנימי-לאדמין בלבד).
3. `RootStackParamList` — alias תאימות-לאחור ל-`GameStackParamList` (מוצהר עבור "GameRegistrationScreen" שכבר לא קיים בריפו).
4. `footy://` — סכימה legacy שנשמרת רק לתאימות.

**חצי-גמור:**
5. **PromoteOrphanScreen נגיש רק מפוש** (`promotePrompt`): ההערה בקובץ מגדירה "(Future) Inline CTA on the finished orphan game's details screen" — ואין שום `navigate('PromoteOrphan')` ב-MatchDetailsScreen. מי שפספס את הפוש אין לו דרך להגיע למסך.

**נסתר / מאחורי דגלים:**
6. **Remote Config flags** שמסתירים UI שלם: `feature_quick_games` (אופציית משחק מהיר בבורר היצירה), `feature_friends` (סעיף חברים בתפריט), `feature_feedback` (דיווח תקלה/הצעה), `feature_referrals` (כרטיס הפניות בבית); וכן `support_email`, `store_url_ios/android` כערכים נשלטים-שרת.
7. **`SCREENSHOT_MODE`** ב-CommunityDetailsScreen — פריסת צילומי-שיווק דרך env var‏ (`EXPO_PUBLIC_SCREENSHOT_MODE=1`); לא פעיל בבילד חנות.
8. **AdvancedLiveMatchScreen** — אינו route בשום סטאק; מופעל רק כשלמשחק `advancedMode === true` (נקבע ביצירה). כל הפעולות בו אדמין-בלבד; צופה רגיל מקבל תצוגה חיה בלבד.
9. **מצב אורח** — ענף שלם של חוויית עיון: RootNavigator מדלג על השערים, ו-`ensureNotGuest` שומר בפועל רק ב-4 מסכים (פיד מועדונים, פרטי מועדון ציבורי, רשימת משחקים, פרטי משחק).

**דפוסי אמינות שראויים לציון בספק:** ניווט-פוש/הזמנה תמיד עם `initial:false`; הרשמה למשחק אופטימית עם rollback; מסכי צ'אט/משחק מציגים fallback עם header גם כשהיעד נמחק; טעינות מציגות `SoccerBallLoader` אחיד וכמעט כל מסך רשימה כולל EmptyState ייעודי.


# 4. קטלוג פיצ׳רים (כולל נסתרים)

I have a complete map. Compiling the Hebrew catalog now.

# קטלוג פיצ'רים מקיף — Teamder (ציד פיצ'רים חוצה־מערכת)

מבוסס על קריאת הקוד בפועל: `src/screens/**`, `src/components/**`, `src/services/**`, `src/navigation/**`, `App.tsx`, ו־`functions/src/index.ts` (~65 פונקציות ענן).

---

## מבנה ניווט (הקשר לכל נקודות הכניסה)

4 טאבים (`src/navigation/MainTabs.tsx`): **בית** (`ProfileStack` — ProfileScreen הוא מסך הבית), **מועדונים** (`CommunitiesStack`), **משחקים** (`GameStack`), **צ'אטים** (`ChatStack`). מסכים משותפים (PlayerCard, MatchDetails, LiveMatch, EveningSummary, PlayerCompare, History, AdminApproval, Requests…) רשומים בכל stack שמארח אותם. לחיצה חוזרת על טאב מאפסת את ה־stack לשורש.

---

## א. פיצ'רים גלויים (זמינים לכל משתמש)

### מסך הבית (ProfileScreen — `src/screens/tabs/ProfileScreen.tsx`)
- **Smart hero**: `ProfileNextGameCard` (המשחק הקרוב) → אם אין משחק: `AvailabilityCalendarCard` ("פנויים לשחק לידך") → אם אין זמינות: `AvailabilityPromptCard` (קריאה לסמן זמינות).
- **לוח "פנויים לשחק לידך"** (`components/home/AvailabilityCalendarCard.tsx` + `services/availabilityFeedService.ts`): heatmap שבועי (7 ימים × בוקר/צהריים/ערב) של כמות שחקנים זמינים ברדיוס המשתמש שאינם רשומים למשחק באותו חלון — ספירה בלבד, ללא זהויות (פרטיות). המספרים מגיעים מה־callable `availabilityCounts` (צד שרת). **הקשה על חלון פותחת יצירת משחק־בזק** לאותו יום/שעה. נשלט מרחוק: `appConfig/features.availabilityCardEnabled === false` מכבה את הלוח בלבד (fail-open — `homeConfigService`).
- **צ'קליסט הפעלה "בוא נתחיל"** (`OnboardingChecklist`): טבעת התקדמות + צעדי setup (תמונה, זמינות, מועדון, משחק); נעלם כשהכול הושלם.
- **"ידעת ש…"** (`DidYouKnowCard`): טיפים מתחלפים אוטומטית לגילוי פיצ'רים; הקשה מנווטת לפיצ'ר.
- **כרטיס הפניות** (`ReferralCard`) → מסך `ReferralsListScreen`: כל המשתמשים ש־`invitedBy` שלהם מצביע עליי.
- ברכת שעה (`HomeGreetingHeader`) + תפריט המבורגר (`HamburgerMenu`): הגדרות, התראות, חסומים, זמינות, חברים, הישגים, סטטיסטיקה, היסטוריה, פידבק, התנתקות, מחיקת חשבון (`DeleteAccountSheet` → callable `deleteMyAccount`).

### משחקים
- **פיד משחקים** (`GamesListScreen`): שני מצבים "פתוחים" (פומביים, `gameService.getOpenGames`) / "שלי"; פילטרים (`GameFilterSheet` + מפת רדיוס `FilterRadiusMap`); FAB יצירה; `MatchEmptyHintCard`.
- **יצירת/עריכת משחק — אשף 3 שלבים** (`GameWizardForm`, משותף ל־Create/Edit): (1) מתי ואיפה — תאריך, מגרש, עיר/כתובת עם autocomplete של govmap (`govmapService` — POI ישראליים חינם) + `israelLocationService` (data.gov.il) + בחירת מיקום במפה; (2) פורמט — 4v4–7v7, מספר קבוצות, משך משחקון, **מצב מתקדם** (ר' בהמשך); (3) ניהול — פומבי/קהילתי, דרישת אישור אדמין, **משחק מחזורי** (שיבוט שבועי אוטומטי, `recurringGameEnabled`), **פתיחת הרשמה מתוזמנת** (`registrationOpensAt` — push בשעה המדויקת דרך Cloud Tasks), דדליין ביטול, הערות, כדור/גופיות, **`autoTeamsAt` + `autoTeamsMethod` ('rating'/'random')** — יצירת כוחות אוטומטית מתוזמנת. שדות `publicOpenAt` (הפיכה לפומבי מאוחרת) ו־`guestsOpenAt` (מתי מותר ללא־אדמינים להוסיף אורחים) קיימים במודל (`types/index.ts` 1474–1484) ומיושמים בשרת.
- **משחק־בזק (quick game)**: `GameCreateScreen` עם `params.quick` — קבוצה אישית נסתרת (callable `ensurePersonalGroup`), בלי בחירת קהילה, כולל **`FriendsInvitePicker`** (בחירת חברים → push `inviteToGame` מיידי). ברירת מחדל: `acceptsFillers` דולק במשחקי בזק.
- **הרשמה הוגנת** (`services/joinFairness.ts`): כל הקשה נושאת `tappedAt` משעון מסונכרן־שרת (`serverClock`); חלון settle מסדר את פרץ הפתיחה לפי זמן הקשה אמיתי ולא לפי מהירות רשת. מודול טהור + reconciler שרת (`reconcileJoinsTask`).
- **ספסל / רשימת המתנה**: עודף הרשמות → waitlist; כשמתפנה מקום — **הצעת ספוט** (push `spotOffered` עם כפתורי "מאשר/ויתור" — `notificationActionService`), עם טיימאאוט מתקדם לבא בתור, או קידום אוטומטי (`waitlistApprovalRequired`). המקום המוצע שמור (רזרבציה) — אורח לא יכול לגנוב אותו.
- **התנגשות הרשמות** (`RegistrationConflictModal`): ניסיון להירשם למשחק חופף → פופאפ עם המשחק המתנגש ושתי דרכי פעולה.
- **מסך פרטי משחק** (`MatchDetailsScreen`, ~4,600 שורות): גריד פרטים, **צ'יפ מזג אוויר** (`weatherService` — Open-Meteo לפי שעת המשחק, נופל לגיאוקוד עיר), רשימת משתתפים (`MatchParticipantsSection` — כולל תגי איחור/לא־הגיע), הודעת אדמין נעוצה (`PinnedAdminMessageCard` — אדמין עורך, כולם רואים), Waze + שיתוף (`QuickActionsRow`), **פידבק על הכוחות** (like/dislike, `setDraftTeamFeedback` + ספירה מוצגת), **CTA "סיכום הערב"** למשחק שהסתיים, טבלת מלך השערים של הערב (`GameChampionship`), באנרים realtime (`useGameEvents` — הצטרפויות/עזיבות מקובצות, שערים, סיום, ביטול).
- **רשימת שחקנים מלאה** (`MatchPlayersScreen`): רשומים / ספסל (כולל מצב הצעת ספוט + קידום ידני) / ממתינים לאישור (אשר/דחה) / בוטלו (כולל תג "ביטל באיחור") / הוסרו / אורחים.
- **אורחים** (`GuestModal` + `types.GameGuest`): מוסיף־האורח נותן שם + דירוג משוער 1–5; רק המוסיף עורך (callable `setGuestRating`); אורח יכול להיות על הספסל (`waitlisted`) בלי לתפוס מקום; קידום אורח "להרכב" דרך reorder ייעודי.
- **חלוקת כוחות — דראפט קפטנים** (`DraftSetupScreen` → `DraftBoardScreen`): בחירת קפטנים (סדר הבחירה = סדר קבוצות), שיטת נחש/רגיל (`DraftOrderPath`), בחירות בתורות עד השלמה. נכנסים מבאנר "נהל כוחות" ב־MatchDetails.
- **עריכת כוחות בגרירה** (`TeamsEditModal`): drag-and-drop להחלפת שחקנים בין קבוצות; שמירה מסמנת `teamsEditedManually` כדי שהמחולל האוטומטי לא ידרוס.
- **לייב — טיימר משותף** (`LiveMatchScreen` פשוט): סטופר start/pause/reset מסונכרן לכל המכשירים + שעון (3 פרימיטיבים ב־Firestore, `useSyncedTimer` + היסט שעון שרת); "עבר ללייב" נפתח 30 דק' לפני; כניסה למשתתפים בלבד (`gameLifecycle.canEnterLive`).
- **סיכום הערב** (`EveningSummaryScreen` + `EveningSummaryCard` + `eveningSummaryService`): כרטיס שיתופי אישי — שערים/בישולים/ניצחונות/eveningScore (שלב 1), אחוז תרומה/החזקת מגרש/GF-GA מ־`roundHistory` (שלב 2), פאנל פיזי מהשעון (שלב 3), heatmap+radar DNA (שלב 4) — כל סקציה אופציונלית לפי קיום דאטה. צילום ל־PNG ושיתוף (`react-native-view-shot` + expo-sharing). push סוף־ערב מהשרת.
- **נתונים פיזיים מהשעון** (`healthService` + `physicalSyncService`): קריאה מ־Health Connect (אנדרואיד; iOS מוגדר null בכוונה) בחלון דקות־הטיימר הפעילות (`liveMatch.activeIntervals`), העלאה דרך callable `saveGamePhysical`. no-op שקט בלי wearable.

### מועדונים (קהילות)
- **פיד מועדונים** (`PublicGroupsFeedScreen`): שלי / ממתינים לאישור / פתוחים + חיפוש ופילטר (`CommunityFilterSheet`); FAB יצירה (`CreateGroupScreen`/`GroupWizardForm`, כולל העלאת קאבר דרך callable `uploadGroupCover` ו־`CoverImagePicker` עם גלריה מובנית).
- **דף מועדון** (`CommunityDetailsScreen`): hero אצטדיון, גריד סטטיסטיקות, טוגל התראות "משחקים חדשים" (`CommunityNotifyToggle` → `newGameSubscriptions`), כרטיס המשחק הבא, rail שחקנים, CTA "שתף הזמנה למועדון". תפריט המבורגר: עריכה, **משחק מחזורי**, אישורי הצטרפות, שחקנים, היסטוריה, סטטיסטיקות, הזמנת חברים (callable `inviteFriendsToGroup`), **צור קשר עם אדמין ב־WhatsApp** (`whatsappService` — נורמליזציה ישראלית ל־wa.me), עזיבה, מחיקה. חוקי מועדון ב־markdown-lite (`RichRulesInput`/`RichRulesText`).
- **דף מועדון פומבי לצפייה** (`CommunityDetailsPublicScreen`) + בקשת הצטרפות (`groupJoinRequests`).
- **סטטיסטיקות מועדון** (`CommunityStatsScreen`): שערים/בישולים/משחקונים/ערבים, מצטיינים, טבלת טופ-10, סופרלטיבים + **תארי מועדון ורמת מועדון** (`data/clubAchievements.ts` + `utils/clubLevel.ts` — רמה 1–10 מנוסחת נקודות: ערבים×10, חברים×8, ותק×6, שערים×1; נגזרת קליינט טהורה, ללא persistence).
- **אליפות המועדון** (`CommunityChampionship` + `ChampionshipTable`): טבלת מלך שערים/בישולים מצטברת (שער=2 נק', בישול=1) מ־rollup `communityPlayerStats`; כל חברי המועדון מוצגים גם עם אפס.
- **רשימת שחקני מועדון** (`CommunityPlayersScreen`): כרטיס זהות + משחקים למועדון; **תפריט ⋮ לכל שחקן** — ר' פיצ'רים מותני־אדמין.
- **היסטוריית מועדון** (`CommunityHistoryScreen`) והיסטוריה אישית (`HistoryScreen` — משחקים שבהם שובצתי בפועל).

### פרופיל ושחקנים
- **כרטיס שחקן** (`PlayerCardScreen`): פרופיל, סטטיסטיקות, **TrustMeter** (ציון אמינות 0–100 מ־`trustService`: נוכחות 90 יום − ביטולים רכים×3 − קשים×10; "חדש" מתחת למינימום משחקים), הישגים + חגיגת קונפטי (`AchievementCelebration`), כפתור חבר (`FriendActionButton`), "שלח הודעה" → DM.
- **חברים** (`FriendsScreen` + `friendsService`): בקשות נכנסות (אשר/דחה), רשימת חברים, הסרה; שליחה/דחייה — כתיבת קליינט תחת rules; **אישור והסרה — callables** (`acceptFriendRequest`, `removeFriendship`); push על בקשה ועל אישור.
- **סטטיסטיקה אישית** (`StatisticsScreen` + `playerStatsService`): מספרים + סופרלטיבים יחסיים (הכי שיחקתי עם, צמד מנצח, קורבן, נמסיס) — ≤3 קריאות (games + שני חצאי `pairStats`).
- **השוואת שחקנים "השווה אליי"** (`PlayerCompareScreen` + `playerCompareService`): השוואה ראש־בראש **פר־מועדון בלבד** (בכוונה בלי head-to-head גלובלי), כרטיס שיתופי PNG. כניסה: תפריט ⋮ ברשימת שחקני המועדון.
- **הישגים אישיים** (`AchievementsScreen` + `achievementsService`): שני מסלולים — legacy bump (counters ב־user doc, sticky) + **נגזרת ממקורות אמת** (deriveCounters: משחקים ששיחקתי, קבוצות שיצרתי/הצטרפתי, הזמנות אמיתיות דרך `invitedBy`, שחקנים שאימנתי).
- **ציר משמעת אישי** (`disciplineService` + `DisciplineRow` בפרופיל): צהוב/אדום גלובליים על `/users/{uid}.discipline`.
- **זמינות "מצא לי משחקים"** (`AvailabilityEditScreen`): ימים × חלונות זמן + פין מיקום במפה + רדיוס (`AvailabilityRadiusMap`) + טוגל התראות; גיאוקוד עיר בשמירה (`geocodeService` — govmap/Nominatim); מזין את מנוע ההתאמות בשרת (`onAvailabilityUpdated`, `gameShortageWarning`).
- **עריכת פרופיל** (`ProfileEditScreen`): שם + תמונה אמיתית או אווטאר מובנה (`data/avatars.ts`); קונספט הג'רזי הוסר.

### צ'אט
- **3 סקופים על אותו רכיב** (`ChatView` + `chatService`): צ'אט משחק, צ'אט מועדון, **DM 1-על-1** (`DirectChatScreen`, נפתח מכרטיס שחקן). רשימת צ'אטים (`ChatsListScreen`) ממוינת לפי הודעה אחרונה + badge לא־נקראו על הטאב.
- **מודרציה מלאה** (דרישת החנויות): שער תנאי שימוש חד־פעמי (`ChatTermsModal`), פילטר ניבולים קו־ראשון (`data/profanity.ts`), תפריט long-press להודעה: מחיקה (שולח/מודרטור), **דיווח** (callable `reportChatMessage` — השרת טוען את ההודעה האמיתית כדי למנוע הפללה, כותב ל־`/chatReports`), **חסימת משתמש** (`/users/{uid}/blocked/{id}`) + מסך "חסומים" (`BlockedUsersScreen`); השתקת צ'אט פר־שיחה (mute).
- קישוטים כדורגליים (`ChatPitch`: פסי דשא, מגרש ריק, כרטיס אדום כאייקון מחיקה).

### תיבת בקשות מאוחדת
- **פעמון + inbox** (`RequestsBell` + `RequestsScreen` + `requestsService`): בקשות חברות + הצטרפות לקהילות שאני מנהל + הצטרפות למשחקים שיצרתי, עם "אשר הכול" פר־סקציה; badge ספירה זולה בפוקוס.

### שיתוף, הזמנות וייחוס (attribution)
- **כל שיתוף מזכה את המזמין**: `invitedBy` נכתב בהרשמה. **קישורים קצרים `/i/<code>`** (`inviteLinkService` → `inviteLinks/{code}` + CF `serveInviteCode`); fallback לקישור ארוך אם הכתיבה נכשלה.
- שחזור הזמנה אחרי התקנה: **אנדרואיד** — Play Install Referrer (`installReferrerService`); **iOS** — clipboard deferred deep link (`clipboardInviteService`, קריאה חד־פעמית מאחורי `hasUrlAsync`). דיפ־לינקים: `teamder://` + `https://teamderfc.web.app/session|team/<id>` (`deepLinkService` — סטאש ידני, לא linking של react-navigation). דף קהילה משורת ב־CF (`serveCommunityPage`).
- **בקשת דירוג בחנות** (`storeReviewService`): בשיאי חוויה (המשחק שלי התמלא / משחק הסתיים), עם dedup פר־session + cooldown 90 יום.

### מפות
- **MapScreen** אחד לשני מצבים (משחקים/מועדונים): צ'יפי סינון לפי מצב, מקרא, טוגל שכבה שנייה, כרטיס תחתון; הדאטה מגיע serializable מהמסך שקרא אותו (אין fetch נוסף). מבוסס `MapWebView`.

---

## ב. פיצ'רים נסתרים / מותני־הרשאה / מותני־דגל

### אדמין מועדון בלבד
- **תפריט ⋮ על שחקן מועדון** (`CommunityPlayersScreen`): כרטיס שחקן; "השווה אליי" (לכולם); **ציר זמן** (אדמין); **דירוג פנימי** (`AdminRatingSheet` + `groupService.setAdminRating` — סקאלה עשרונית 0–5, 0=ניקוי; מזין איזון כוחות אוטומטי; נראה לאדמין בלבד); **כרטיס צהוב/אדום** (`IssueCardSheet` → `communityPlayerEvents`; אדום פעיל חוסם הרשמה); **נהל ציוד** (`ManageEquipmentSheet` — טוגלים בלתי־תלויים כדור/גופיות פר־שחקן, ריבוי מחזיקים); ניהול חבר/הסרה.
- **ציר זמן שחקן** (`PlayerTimelineScreen` — אדמין בלבד, פר־מועדון): כרטיסים (פעיל/פג/בוטל — long-press לביטול) + מסירות ציוד; קולקציה `communityPlayerEvents` (עד 200 אירועים).
- **פופאפ ציוד בסיום ערב** (`EquipmentHandoffModal`, נפתח מ"סיים ערב" בלייב המתקדם): מי לקח כדור/גופיות הביתה, עם רמזי "לקח לאחרונה" (`LastTakenMap`); "דלג" משאיר מחזיקים.
- **אישורי הצטרפות מאוחדים** (`AdminApprovalScreen`): כל הקהילות שאני מנהל בתור אחד.

### אדמין/מארגן משחק בלבד
- **הוספת חברי קהילה למשחק** (`AddMembersScreen` → callable `adminAddPlayers`, גלישה לספסל + push לכל אחד).
- **שחקנים זמינים להזמנה** (`AvailablePlayersScreen` → `userService.findAvailablePlayers` לפי יום/עיר/שעה) + **"שלח לכל הזמינים בפולסים"** — כפתור שמפעיל את מנוע פולסי־המילוי ידנית (callable `startGameFillerPulse`; ר' מנוע fillers).
- **סידור רוסטר מחדש** (drag/העברות דרך callable `adminReorderRoster`): שליטה מי מקבל ספוט משוחרר; כולל reorder לאורחים בספסל וקידום אורח.
- **שערים רטרואקטיביים** (`RetroGoalsSheet` — אדמין, אחרי סיום): זיכוי שער שפוספס (כובש + מבשל, כולל undo) דרך callables `addRetroGoal`/`removeRetroGoal`; תיקון סטטיסטי טהור, לא נוגע בתוצאת משחקון.
- **ניהול משחק מוצנע** (`MatchManageSection` — collapsible): שינוי נראות + מחיקה.
- **חלוקת כוחות אוטומטית מתוזמנת**: `autoTeamsAt`+`autoTeamsMethod` באשף; ביצוע בשרת (sweep polling, push `teamsGenerated`), מכבד `teamsEditedManually`.

### מצב מתקדם (advancedMode — פר־משחק, toggle ביצירה)
- `GameWizardForm` שורה 252: `const ADVANCED_MODE_ENABLED = true` — דלוק בפרודקשן; ההערה "while the feature is unfinished" שרידית.
- `LiveMatchScreen` מפצל: `game.advancedMode === true` → **`AdvancedLiveMatchScreen`**: רוטציית "מנצחת נשארת" (`rotationEngine` — טהור ודטרמיניסטי; קבוצה חסרה מושלמת בהשאלה temporary/permanent, מצב 3 קבוצות; מצב תיקו ל־4 קבוצות veteranOut/bothOut), **לוח תוצאה חי + "הוסף גול"** עם ייחוס כובש/מבשל (`LiveScoreboardCard`, אדמין בלבד), **בחירת מנצחת** (`WinnerPickerModal`), **השלמת הרכב** (`FillerPickerModal` — חובה לבחור בדיוק N, אין ביטול), **"הלך הביתה"** (`PlayerActionMenu` → `markPlayerWentHome` + refill בלי לאפס שעון), פאנל רוטציה (`RotationPanel`), סיום ערב → `commitRoundStats` בשרת (סטטיסטיקות פר־שחקן + pairStats) + פופאפ ציוד.

### מותנה־שרת / Pulse / Remote Config (ללא ריליס)
- **מסך תחזוקה + באנר הכרזה** (`RemoteGates`: `maintenance_mode`, `announcement_*` — Remote Config, `remoteConfigService` עם defaults בקוד).
- **קמפיינים־פופאפ** (`CampaignGate` + `campaignService`): קמפיינים שנכתבים ב־Pulse ב־`campaigns/{id}`, סגמנטציה קליינט־סייד + מכסת תדירות מקומית; קמפייני push נשלחים משרת (`adminUserPush`).
- **פופאפ עדכון גרסה** (`UpdateModal` + `updateService`): optional/force מ־`appConfig`, קישורי חנות.
- **פרסומות AdMob** (`adsService`): מאחורי `EXPO_PUBLIC_ADMOB_ENABLED=1` (**דלוק ב־.env הנוכחי**) + kill-switches ב־Remote Config (`app_open_ad_enabled`, cooldown) + `appConfig/ads`; מודעת app-open לעולם לא חוסמת splash (לקח מדחיית גוגל).
- **דגל home** `appConfig/features.availabilityCardEnabled` (ר' לעיל).
- **Rate limiting** (`rateLimitService`): מוני חלון־דקה פר־(משתמש, פעולה) ב־`/rateLimits`.

### שער אורח (anonymous browse)
- `utils/guestGate.ts`: סשן אנונימי רשאי לגלוש; כל פעולת חשבון (הצטרפות/יצירה/צ'אט) → פרומפט הרשמה (דרישת App Store 5.1.1(v)). לא לבלבל עם "אורחי משחק".

### שירותים גלובליים "שקטים"
- **דיווח בצילום מסך** (`ScreenshotReportSheet` ב־App.tsx): זיהוי screenshot → sheet דיווח עם צילום נקי + annotator (`ScreenshotAnnotator`) → קולקציית `feedback` (תיבת הפיתוח ב־Pulse). בנוסף `FeedbackScreen` ידני (באג/הצעה, ≤2000 תווים, צירוף תמונה).
- **לוג שגיאות אגרגטיבי** (`errorLog.ts`): doc אחד פר־חתימת שגיאה בקולקציית `errors` (count, first/last seen, קונטקסט אחרון) — מזין את ה־dev inbox; לעולם לא זורק.
- **סנכרון שעון Wear OS + ווידג'ט** (`watchSyncService`): דוחף payload אחד (live/upcoming/none) ל־Data Layer + SharedPreferences; כפתורי הווידג'ט כותבים ל־Firestore מ־Kotlin. אנדרואיד בלבד, best-effort. קוד נייטיב ב־`plugins/wear-src/{wear,watch,widget}`.
- **התראות**: קליינט כותב `/notifications/{id}` → CF שולח FCM לפי `notificationPrefs` + `fcmTokens`; **מסך העדפות פר־סוג** (`NotificationsSettingsScreen`) עם שער הרשאת OS; dedup דטרמיניסטי (`notificationDedup`); כפתורי פעולה על push ("אני בא"/"לא בא", "מאשר"/"ויתור" — `notificationActionService`, רץ גם מקונטקסט קר).
- `MockModeBanner` + שכבת mock מלאה בכל השירותים (`USE_MOCK_DATA`).

### מנוע ה־Fillers (מילוי שחקנים חוצה־קהילות)
- **צד שרת חי**: `fillerPulseTask`, `startGameFillerPulse`, `submitFillerInterest`, `approveFiller`, `declineFiller`, `onFillerInterestCreated`.
- **צד אפליקציה**: `FillerInterestsSection` — סקציית אדמין ב־MatchDetails (רק כש־`acceptsFillers === true` ויש מועמדים pending): כרטיסי מועמדים עם TrustMeter גדול + אשר/דחה; העדפת משתמש `acceptsFillerPush`.
- **חצי־חשוף**: אין UI שבו שחקן יוזם התעניינות מתוך פיד "פתוחים" — תוכנית "fillers in feed" מאושרת אך לא נבנתה. ההפעלה כיום: push מהמנוע או כפתור "שלח לכולם" של האדמין.

### עוד מוסתרים
- **promoteOrphan** (`PromoteOrphanScreen`): אחרי משחק־בזק — push `promotePrompt` (~30 דק' אחרי סיום) → הפיכת הקבוצה האישית לקהילה אמיתית (callable `promoteOrphanToGroup`). נגיש רק דרך ה־push (ה־CTA המשני מסומן "Future" בקוד).
- **AvailabilityNudgeModal**: פופאפ בטאב משחקים למי שלא סימן `preferredDays`.

---

## ג. פיצ'רים לא־גמורים / חצי־מחווטים

1. **סימון הגעה/איחור/לא־הגיע — אין כותב ב־UI**: `gameService.setArrival` קיים (כולל כתיבת field-path בטוחה) + תצוגת תגים (`MatchPlayersScreen`, `MatchParticipantsSection`) + מראה משמעת בשרת (`onGameRosterChanged` מנפיק צהוב ≤60 דק' / אדום >60 או no_show, כולל ביטול) — **אבל אף מסך לא קורא ל־setArrival**. גם נתיב "אאחר" של דיווח עצמי (`disciplineService` Phase 4) חסר UI. ההערה בקוד: "foundation for GPS-based detection" (Phase 5).
2. **fillers בפיד "פתוחים"** — מתוכנן ולא נבנה (ר' לעיל).
3. **head-to-head פר־מועדון בהשוואת שחקנים** — TODO מפורש ב־`playerCompareService` (דורש rollup חדש).
4. **heatmap GPS / כיול מגרש**: הקליינט נטש (אין ExerciseRoute), אך callable `savePitchCalibration` עדיין פרוס ו־`EveningSummaryCard` עדיין יודע לרנדר `heatGrid` אם קיים — שריד ניסיוני.
5. **HealthKit ב־iOS**: `healthService` מחזיר null ב־iOS בכוונה ("deferred follow-up") — פאנל פיזי לא מוצג שם.
6. **"הזמן למשחק" מכרטיס שחקן**: הערת header ב־`PlayerCardScreen` מכריזה על stub, בפועל אין כפתור כזה במסך (ההזמנה קיימת רק דרך `AvailablePlayersScreen`); ההערה מיושנת.
7. **הערות header מיושנות**: `AdvancedLiveMatchScreen` נושא את ה־header של הטיימר הפשוט ("Deliberately minimal: NO teams…") למרות שהוא מסך הכוחות המלא; `friendsService` מתאר את ה־callables כ"Phase 2 עתידי" למרות שהם פרוסים.

---

## ד. קוד מת / שרידים (קיים, לא מיובא בשום מקום — נבדק ב־grep על כל src + App.tsx)

- `components/DisciplineCards.tsx` — תצוגת כרטיסים צהוב/אדום הישנה; הוחלפה ב־`TrustMeter`.
- `components/RatingScale.tsx` — צ'יפים לדירוג; המסלול בפועל הוא `RatingSlider` (0–5 עשרוני).
- `components/RadiusSelector.tsx` — הוחלף במפות רדיוס (`AvailabilityRadiusMap`/`FilterRadiusMap`).
- `components/anim/MorphButton.tsx`.
- `components/match/`: `MatchPlayersPreview`, `MatchSegmentControl`, `MatchNotesRow`, `MatchHeroStrip` — שרידי עיצובים קודמים של MatchDetails.
- `components/players/WinLossRing.tsx`.
- `components/profile/`: `ProfileAvailabilityCard`, `ProfileCollectionCard`, `ProfileHeader`, `AchievementsRail`, `ProfileHeroCard`, `HeroStatsCard` — שרידי הפרופיל לפני רה־עיצוב הבית.
- טיפוס `RatingVote` + הערות "peer-voted" ב־`types`/`groupService` — שרידי דירוג ההמונים שנמחק (הדירוג היחיד כיום: פנימי של אדמין).
- שדות deprecated במודל: `recurringDayOfWeek`/`recurringTime` וכו' (הוחלפו ב־`recurringGameEnabled` פר־משחק).
- `test_draft_sample.ts` בשורש הריפו.
- בשרת: `onVoteWrittenLegacy`, `backfillGroupCreatorIdsOnce` (מיגרציה חד־פעמית) — עדיין exported.

---

### הערות רוחב
- **Realtime**: `onSnapshot` על משחק חי (`useGameEvents`, טיימר), צ'אט, mute; רוב השאר one-shot reads בפוקוס.
- **Offline/כשל**: כמעט כל שירות עטוף try/catch → `logError`, עם fail-open לדגלי תצורה ו־fallbacks (קישור ארוך במקום קצר, הסתרת צ'יפ מזג אוויר וכו').
- **גבול אמון**: כתיבות חוצות־משתמשים תמיד ב־callables (חברויות, הוספת שחקנים, reorder, retro goals, דיווח צ'אט, סטטיסטיקות `commitRoundStats`), עם `ENFORCE_APP_CHECK=false` כרגע (מושבת בכוונה עד אימות App Attest).


# 5. שירותים ומודל-הנתונים

# מיפוי שכבת השירותים (Client Services) — Teamder

## 1. תשתית Firebase (src/firebase)

### config.ts
- קורא קונפיג מ־`EXPO_PUBLIC_FIREBASE_*`; אם חסר/`EXPO_PUBLIC_FOOTY_FORCE_MOCK=1` → `USE_MOCK_DATA=true` וכל שירות עובר לענף in-memory. `getFirebase()` זורק שגיאה במצב mock (מונע פניה לרשת בטעות).
- Firestore מאותחל עם `experimentalForceLongPolling:true` (WebChannel לא יציב ב־RN/Hermes — listeners נפלו) ו־`ignoreUndefinedProperties:true`.
- Auth עם persistence של AsyncStorage; Functions נעולות ל־`us-central1`; App Check מאותחל לפני כל בקשה יוצאת.

### appCheck.ts
- גשר כפול: מודול native (`@react-native-firebase/app-check`, Play Integrity בפרודקשן / debug provider בפיתוח) + `CustomProvider` של ה־JS SDK כדי שכל קריאת Firestore/Storage/Functions תישא טוקן. רענון טוקן כל 30 דק'. נכשל בשקט אם המודול לא מקושר. ⚠️ לפי הזיכרון הפרויקטלי — אכיפת App Check כבויה בצד השרת (ENFORCE_APP_CHECK=false).

### auth.ts
- `signInWithGoogle` (GoogleSignin → credential), `signInWithApple` (מחזיר גם `fullName` חד־פעמי), `signInWithEmail/signUpWithEmail` (+שליחת אימות מייל לא חוסמת), `sendPasswordReset`, `signInAnonymously` (מצב אורח), `signOutFirebase`, `waitForAuthRestore` (המתנה לשחזור סשן בקולד־סטארט), `deleteCurrentFirebaseUser` (+`NeedsPasswordReauthError`).
- **שיקוף לסשן native** (`mirrorToNativeAuth` / `ensureNativeAuthMirror`, אנדרואיד בלבד): הכניסה נעשית ב־JS SDK, אבל הווידג'ט והשעון כותבים ל־Firestore מ־Kotlin עם FirebaseAuth ה־native — לכן כל sign-in משוכפל לסשן native (Google silent sign-in בכל boot אם native מנותק). best-effort.

### firestore.ts (1,772 שורות)
- Converters לכל הטיפוסים + מפת `col`/`docs` — מקור האמת לשמות האוספים (ראו טבלה בסעיף 5).
- `docs.userPrivatePush(uid)` = `/users/{uid}/private/push` — נבנה בכוונה בלי ה־converter של User (באג היסטורי: ירושת converter גרמה לכשל שקט ברישום טוקני פוש).
- ⚠️ **קוד מת**: `col.ratings` / `col.ratingVotes` / `col.globalRatings` / `col.globalRatingVotes` / `col.playerStats` מוגדרים אך ללא אף קורא בקוד (שריד מדירוג העמיתים שנמחק ב־24.6). `col.rounds` בשימוש רק בנתיבי legacy של gameService.

---

## 2. gameService (7,440 שורות) — ליבת המשחקים

מצב mock: עותק עמוק של `mockGamesV2` בזיכרון. כל מוטציה מנקה cache מקומי של "המשחקים שלי" (TTL 15 שנ'). עטיפת `withAuthRaceRetry` לריטריי יחיד על permission-denied בזמן שחזור auth.

### קריאה/רשימות
- `getGameById` — null = לא קיים; זריקת `{code:'ACCESS_BLOCKED'}` על permission-denied (מסך "אין גישה" בלי דליפת מידע).
- `getMyGames` / `getMyLiveOrUpcomingGames` / `subscribeMyLiveOrUpcomingGames` — שאילתת `participantIds array-contains` + רצפת `startsAt >= now-48h` (חיסכון בקריאות — היה עלות ה־Firestore הגדולה באפליקציה; דורש אינדקסים מרוכבים). cache 15 שנ'. המנוי הוא ה־feed גם לסנכרון השעון.
- `getCommunityGames`, `getUpcomingPublicGamesForGroup`, `getUpcomingGamesForGroup`, `getOpenGames` (פיד "פתוחים"), `getHistory`, `getPlayedGames`, `getPlayedGamesCount`.
- ⚠️ **Legacy/מת**: `createGame` (יצירה ישנה ליום חמישי), `getActiveGameForGroup`, `saveGame` (כותב `rounds`), `listPlayers` — אין להם קוראים במסכים; נשמרים לתאימות.

### סטטיסטיקות (קריאה)
- `getCommunityPlayerStats` — rollup שרת `communityPlayerStats` (שאילתת groupId אחת).
- `getPairStats` — סריקת משחקי finished של הצופה + doc מ־`pairStats` (יחד/נגד/בישולים דו־כיווניים).
- `getCommunityStats`, `getCommunityChampionship` (טבלת אליפות מ־`communityPlayerStats`), `getCommunityDeadlyDuo` (`communityPairStats`), `getGameChampionship` (`gamePlayerStats` לפי gameId).
- גולים רטרו: `getRetroGoals` (תת־אוסף `games/{id}/retroGoals`), `addRetroGoal`/`removeRetroGoal` — callables (`addRetroGoal`/`removeRetroGoal`), תיקון סטטיסטי בלבד.

### יצירה/עריכה
- `createGameV2` — ולידציה עברית מלאה (כותרת/מגרש/הערות/כמות), rate-limit `createGame` (10/שעה), אינווריאנטים (registrationOpensAt/publicOpenAt/guestsOpenAt לפני קיקוף), **חסימת חפיפה** ±2ש' באותה קהילה (`GAME_OVERLAP`), משחק נדחה → `status:'scheduled'` (CF יהפוך ל־open וישלח פוש), quick-game (isOrphanContext) רושם את היוצר אוטומטית, geocoding אסינכרוני (govmap→Nominatim) לפין במפה, שיגור `newGameInCommunity` (recipientId=groupId כסמן fan-out ל־CF). אנליטיקות GameCreated/RecurringGameCreated.
- `updateGameV2` — עריכת מטא־דטה + פוש `gameCanceledOrUpdated` (reason 'updated').
- `skipRecurringWeek` — יוצר את שבוע הבא (שכפול הגדרות +7 ימים) ואז מוחק את הנוכחי.
- `deleteGame` — לוכד את הרוסטר/כותרת לפני המחיקה ומטמין אותם ב־payload של הפוש (המסמך כבר לא קיים כשה־CF רץ).
- `setVisibility`, `lockRegistration`, `cancelGameByAdmin` (פוש `gameCanceledOrUpdated` reason 'cancelled'), `setPinnedMessage`.

### הרשמה הוגנת (fair join)
- `requestJoinGame` — **הנתיב הפעיל**: לוכד `tappedAt=serverNow()` לפני כל await, בדיקות (open / חלון גרייס שעה אחרי קיקוף / לא live / לא rejected / קונפליקט יומן ±4ש' דרך `findRegistrationConflict`), ואז כותב doc אישי ל־`games/{id}/joinRequests/{uid}` (`state:'queued'`); reconciler בשרת מושיב לפי סדר ההקשה. `predictBucket` מדמה מקומית את joinFairness להצגה מיידית.
- `joinFairness.ts` — מודול טהור: מיון לפי tappedAt מוגבל ב־grace של 15 שנ' נגד backdating, הקצאה ל־players/waitlist/pending; משוכפל 1:1 בשרת.
- ⚠️ `joinGameV2` — נתיב טרנזאקציה ישן; אין לו קוראים במסכים (מוזכר רק בתיעוד) — legacy בפועל.
- `approveGameJoin`/`rejectGameJoin` — אישור/דחיה של pending ע"י מנהל, פוש `approved`/`rejected` + bump הישג; rejected נכנס ל־`rejectedPlayerIds`.
- `findRegistrationConflict` — עד 50 משחקי המשתמש, חלון ±4 שעות; זריקת `REGISTRATION_CONFLICT` עם ה־payload + אירוע אנליטיקס מרכזי.

### ביטול/הסרה/waitlist
- `cancelGameV2` — טרנזאקציה: הסרה מכל המערכים, חותמת `cancellations[uid]`, ניקוי הצעת קידום שמופנית למבטל. **קידום waitlist ופוש spotOpened/spotOffered עברו לשרת** (`onGameRosterChanged`) — כתיבה חוצת־משתמשים אסורה מהקליינט. פוש למנהל דרך callable `notifyPlayerCancelled` (אגרגציה). אנליטיקות GameCancelled/LateCancel.
- `removePlayer` — הרחקה ע"י מנהל (מוריד גם מ־assignments של הלייב, לא חותם cancellations), פוש `gameCanceledOrUpdated` למורחק.
- הצעות מקום: `confirmSpotOffer` (טרנזאקציה, אידמפוטנטי, `STALE_OFFER`), `passSpotOffer` (מעביר לבא בתור + `spotOffered`), `adminAdvanceOffer`.
- `leaveAllGamesForAccountDeletion` — סריקת כל המשחקים הפעילים, איחוד פושים למנהל אחד (mock/legacy; המחיקה האמיתית ב־callable `deleteMyAccount`).

### ניהול רוסטר ע"י מנהל
- `adminAddMembers` → callable `adminAddPlayers` (עם ריטריי על unauthenticated אחרי רענון טוקן — באג אמיתי מ־1.0.40), `adminReorderRoster` → callable, `adminReorderGuests`.

### כוחות/רוטציה (advanced live)
- `saveDraftTeams` (+`teamsEditedManually` שמונע דריסה ע"י מחולל אוטומטי), `setDraftTeamFeedback` (👍/👎 per-uid field-path), `notifyTeamsReady` → callable (פוש מותאם אישית "אתה בקבוצה עם…"), `startFillerPulse` → callable `startGameFillerPulse` (פולסים של 10 נמענים כל 2 דק').
- רוטציית "מנצח נשאר": `startRotation`/`recordWinner`/`recordTie` + מסלול אינטראקטיבי (`prepareStartRotation`/`prepareRefillPlaying`/`prepareRoundResult`/`commitFilledRotation`), `stopRotation`, `swapPlayers`, `markPlayerWentHome`/`restorePlayer`, `nudgeRotationAfterFillCancel`. כל המתמטיקה ב־**rotationEngine.ts** — מודול טהור ודטרמיניסטי (loans זמניים/קבועים, השלמת קבוצה חסרה מהמפסידה).
- `finalizeRoundAndRotate` + `_commitRoundStatsAndClear` — סטטיסטיקות הסיבוב נכתבות **בשרת** דרך callable `commitRoundStats` עם `roundId` אידמפוטנטי (`round:updatedAt`); הלוח נמחק רק אחרי commit מוצלח (גול לא הולך לאיבוד על כשל רשת).

### גולים בלייב
- `recordGoal` — `arrayUnion` על `liveMatch.goals` + `increment` על scoreA/B + `goalTally.<uid>` (אורחים לא נספרים בטאלי; own-goal בלי scorer). id עמיד להתנגשויות. `removeGoal`/`undoLastGoal` סימטריים (arrayRemove + increment(-1)).

### מחזור חיים של הערב
- `startEvening` (status→active, phase→roundReady), `markGameStarted` (חותמת `liveMatch.startedAt` — מקור האמת ל"המשחק קרה"; field-paths בלבד נגד דריסת טיימר מקבילה), `endEvening` (status→finished + phase→finished + סגירת activeIntervals פתוחים + `endedAt`).

### טיימר משותף
- `startTimer`/`pauseTimer`/`resetTimer` — שלושה פרימיטיבים (`timerRunning`, `timerLastStartedAt`, `timerAccumulatedMs`) בבסיס זמן שרת (`serverNow()`), כתיבות field-path קטנות, `timerEvents` (start/resume/pause) + `activeIntervals` (חלונות ריצה — מזינים את קריאת ה־Health). `readTimerState` קורא תמיד מהשרת (לא cache) לחישובי המצטבר. reset מאפס גם score+goals (הטאלי שורד).

### נוכחות/ציוד/אורחים
- `setArrival` — field-path `arrivals.<uid>`; מעבר ל'late' מפעיל `disciplineService.reportLate`, 'no_show' מנפיק כרטיס אדום (בפועל בצד שרת). `setBringingBall` (arrayUnion/Remove על ballBringerIds).
- אורחים: `addGuest` (בדיקת הרשאה `assertGuestPermission` — יוצר/אדמין/משתתף אחרי guestsOpenAt; קיבולת משותפת), `updateGuest`, `setGuestRating` (בעלות המוסיף — callable בצד שרת לפי הזיכרון), `removeGuest`.

### Realtime
- `subscribeLiveMatch`, `subscribeRotation`, `subscribeLiveGame` (listener אחד משולב — חוסך חצי מהקריאות), `subscribeMyLiveOrUpcomingGames`. במצב mock — pub/sub פנימי + polling של 800ms.

---

## 3. שירותי ליבה נוספים

### userService (943 שורות)
- אימות: אורח אנונימי (User סינתטי, בלי doc), Google/Apple/Email — כל אחד קורא/יוצר `/users/{uid}` ומריץ `applyInviteAttributionIfFresh` (כתיבת `invitedBy/invitedByType/invitedByTargetId/invitedAt` פעם אחת מה־PendingInvite) + `applyAcquisitionIfFresh` (תג UTM: source/campaign/linkId/gameId, set-once). כשל בכתיבת ה־doc → sign-out יזום (מונע Auth-בלי-doc).
- `getCurrentUser` — race של 8 שניות מול getDoc; על timeout משחזר snapshot מ־AsyncStorage (כניסה גם באזור ללא קליטה); כולל `touchPresence` (platform+lastSeenAt, throttle 6 שעות, kill-switch `feature_campaigns`).
- `completeOnboarding`/`updateProfile` — סניטיזציה של שם (bidi/zero-width נגד התחזות), `photoUrl` ריק → `deleteField()`.
- `findAvailablePlayers` — מועמדים להזמנה: שאילתת `availability.preferredDays array-contains` + סינון קליינט לפי רדיוס Haversine (`availabilityRadiusKm`, ברירת מחדל 20 ק"מ), חלון זמן (morning/noon/evening) והחרגות.
- `deleteOwnAccount` — כולו בשרת דרך callable `deleteMyAccount` (עוזב קהילות/משחקים/חברויות, אנונימיזציה, מחיקת Auth אחרון).
- `getInvitedUsersCount` (אגרגציית count על invitedBy), `listInvitedUsers` (רשימת מוזמנים לכרטיס שחקן).

### groupService (2,181 שורות)
- קריאה: `listForUser`/`subscribeForUser` (playerIds array-contains — realtime לתורי אישורים), `listPendingForUser`, `get`, `findSharedCommunities`, `searchGroups`, `getPublic`/`listPublicGroups`/`searchPublicGroups` (`groupsPublic`), `hydrateUsers` (batched `in` queries על users).
- יצירה: `createGroup` → **callable `createGroupCallable`** (rate-limit עבר לשרת אחרי ממצא אבטחה — `/rateLimits` היה client-writable), `ensurePersonalGroupId` → callable `ensurePersonalGroup` (קבוצה אישית נסתרת ל־quick games), `promoteOrphanGroup` → callable `promoteOrphanToGroup` (הפיכת קבוצה אישית לקהילה + פושי `groupInvitation`), `inviteFriendsToGroup` → callable.
- חברות: `requestJoinByCode`/`requestJoinById` (pendingPlayerIds + doc ביקורת ב־`groupJoinRequests`; `GroupJoinRejectedError` על דחיה קודמת), `cancelJoinById`, `approveMember` (בדיקת קיבולת; פוש `approved` + bump), `rejectMember`, `getMemberApprover`, `leaveGroup` (זריקת LAST_ADMIN), `removeMember`, `deleteGroup` (מחיקה + מראה ציבורית + פוש `groupDeleted`), `promoteToCoach`/`demoteCoach`.
- ניהול: `updateGroupMetadata` (שדות נעולים מסוננים), `setAdminRating` (דירוג פנימי 0–5 עשרוני, field-path `adminRatings.<uid>`; בעברית ההצגה 1–10), `setEquipmentHolders` (ballHolderIds/jerseysHolderIds).

### chatService (419)
- שלושה scopes על אותה צורת subcollection: game / group / dm (`dmConversations/{a__b}`). `subscribeMessages` — חלון 100 הודעות אחרונות, ממתין ל־auth-restore לפני פתיחת listener (באג "אין גישה לצ'אט" אחרי עדכון). `sendMessage` (דה־נורמליזציה של שם+אווטאר, 1000 תווים), `deleteMessage` (שולח/מודרטור לפי rules), `ensureDmConversation` (חוסם self-DM; יצירה נבדקת ב־rules מול `dmFriendsOnly`), `touchMyDmEntry`.
- אינדקס נקרא: `users/{uid}/chatUnread` (subscribeUnread → chatStore, markChatRead), read-receipts (`reads`), typing (`typing`), mute (`chatSettings`), חסימות (`users/{uid}/blocked`).
- דיווח הודעה → **callable `reportChatMessage`** (השרת טוען את ההודעה האמיתית — מונע הפללה בתוכן מפוברק).

### notificationsService (650) + notificationDedup (375)
- `dispatch` — כתיבת doc ל־`notifications` עם **id דטרמיניסטי** (dedupe bucket לפי cooldown per-type) + `dedupeKey`; בדיקת strict-unread ל־`gameCanceledOrUpdated`; `createdByUid` נאכף ע"י rules; CF מאזין onCreate ושולח FCM. best-effort, לעולם לא זורק.
- `notifyPlayerCancelled` → callable (אגרגציית ביטולים), `inviteToGame` → callable `sendGameInvite` (IDs בלבד — מניעת פישינג של שם מנהל; קודי שגיאה מוחזרים typed), `markRead`.
- העדפות/טוקנים: `loadPreferences`/`savePreferences` + `registerDeviceToken`/`unregisterThisDevice` — הכל ב־`/users/{uid}/private/push` (הועבר מה־doc הציבורי אחרי ממצא אבטחה); `unregisterThisDevice` נקרא לפני sign-out (userStore ממתין ל־ack עד 4 שנ' — מניעת דליפת פושים למשתמש הבא במכשיר). `setCommunitySubscription` (מערך `newGameSubscriptions` על ה־user). `requestAndRegisterPushToken`/`getPushPermissionStatus` — degrade מלא ב־Expo Go.
- notificationDedup — קטלוג 27 סוגי התראות + חלונות cooldown per-type; משוכפל בין קליינט ל־functions.

### notificationActionService (221)
- טיפול בכפתורי פוש מרקע (עם `waitForAuthRestore`): gameReminder — "אני בא"→`requestJoinGame` / "לא בא"→`cancelGameV2` (+התראה מקומית עם התוצאה); spotOffered — CONFIRM/PASS; fillerOpportunity — "מעוניין"→callable `submitFillerInterest`, "לא הפעם"→אנליטיקס בלבד. קונפליקט הרשמה נבלע בכוונה.

### friendsService (385)
- מודל: `/friendRequests/{from__to}` + `users.friends[]` (נכתב רק בשרת). שליחה/דחיה/ביטול — כתיבות ישירות תחת rules; **אישור והסרה — callables** (`acceptFriendRequest`, `removeFriendship`). חסימת שליחה מחדש אחרי decline (`FriendRequestDeclinedError`). `getRelationship` — קריאות נפרדות try/catch לכל כיוון (permission-denied על doc חסר = "אין בקשה"). ⚠️ ההערה בראש הקובץ ("callables land in Phase 2 — until then throws") מיושנת — ה־callables קיימים ונקראים.

### requestsService (154)
- "תיבת בקשות" מאוחדת: בקשות חברות + pending בקהילות שאני מנהל + pending במשחקים שיצרתי. `getInboxCount` (badge זול, בלי רזולוציית שמות) / `getInboxRequests` (מלא) / `approveAll*` (רץ סדרתי, עוצר ספירה כשמתמלא).

---

## 4. שירותי תמיכה

### serverClock (130)
- שעון שרת משותף לטיימר: 3 probes ל־callable `getServerTime`, בחירת דגימת ה־RTT הנמוך, offset נשמר ב־AsyncStorage; `serverNow()` סינכרוני; resync כל 2 דק' בזמן לייב. נופל ל־offset 0 בכשל — לעולם לא זורק.

### useSyncedTimer / useGameEvents (hooks בשכבת services)
- `useSyncedTimer` — שחזור הטיימר מ־3 הפרימיטיבים ב־serverNow, tick כל 250ms, resync תקופתי, חשיפת "מופעל ע"י X".
- `useGameEvents` — listener על doc המשחק שממיר דיפים לבאנרים (הצטרף/עזב עם שמות — coalescing של 1.5 שנ' עם קיזוז join/leave, אורח נוסף, ערב הסתיים, בוטל) + מראה snapshot חזרה למסך (`onUpdate`) + `onAccessBlocked` על permission-denied.

### gameLifecycle (298)
- החוזה של מחזור החיים: `effectiveStatus` (נורמליזציית legacy phase='live'), predicates `canJoinGame` (open + עד שעה אחרי קיקוף), `canCancelRegistration` (open/locked בלבד), `canEditGame`, `canAddGuest` (open בלבד + guestsOpenAt), `canStartEvening` (חלון 30 דק' לפני עד 6 שעות אחרי), `canEnterLive` (מנהל/משתתף בלבד), `canEndEvening`, `canCancelGame`/`canDeleteGame`, פילטרי נראות לרשימות. קבועים: גרייס הרשמה 1ש', staleness 6ש'.

### errorLog (394)
- לוג שגיאות ל־`errors/{fingerprint}` — doc אחד לחתימה (djb2 על operation+הודעה מנורמלת), `count` מצטבר, flush כל 12 שנ', תקרת 30 כתיבות לחתימה לסשן. כותרות עבריות per-operation, קטגוריות action/silent/crash. `logUnexpected` לכשלים שקטים (post-condition), `isExpectedDenial` לסינון רעש, `installGlobalErrorHandlers` (ErrorUtils + unhandled rejections), `logRenderError` ל־ErrorBoundary.

### analyticsService (341)
- עטיפה על `@react-native-firebase/analytics`; ~120 אירועים typed (auth, קבוצות, משחקים, לייב, חברים, quick-games, שעון/ווידג'ט, גילוי וסינון, קמפיינים, fillers, שגיאות). `logEvent` לעולם לא זורק; mock=console בלבד; `platform` מוזרק לכל אירוע.

### achievementsService (587)
- שני מסלולים: `bump` legacy (increment עצמי בלבד; cross-user נעשה ב־CF) ו־**נגזרת** `deriveCounters` — חישוב מהמקורות (סריקת `games` participantIds עם שער `isAttendedGame`, `pairStats` ל־maxWins יחד, count של invitedBy, קבוצות מה־store). `persistDerivedUnlocks` — דיפים לפי tiers, "הישג לא נלקח לעולם" (מונוטוני — הגנה מאובדן דרגה על blip), מיגרציית legacy בלי קונפטי. אירוע AchievementUnlocked.

### disciplineService (443)
- כרטיסים גלובליים על `users.discipline`: `reportLate` (5–60 דק'=צהוב, מעל=אדום), `issueCard` — **בפועל בפיירבייס רק אנליטיקס** (הכתיבה ב־CF `onGameRosterChanged`; mock כותב מקומית), `revokeCard` (קריאה-עדכון על ה־doc), `getPlayerDisciplineSnapshot` (10 המשחקים האחרונים: צהוב=ביטול אחרי דדליין, אדום=no-show לפי teams[]). ⚠️ **קוד מת**: `applyFirebase` מוגדר ולא נקרא; בדיקת ה"אדום" תלויה ב־`teams[]` שלא נכתב מאז המעבר לטיימר־בלבד — סיגנל מת בפועל.

### trustService (220)
- ציון אמינות 0–100: חלון 90 יום, attendance% מינוס 3 לביטול רך / 10 לביטול אחרי דדליין; פחות מ־3 משחקים → null ("חדש"). `computeTrustFromGames` טהור + `getSummary` (סריקת games participantIds). מחליף את תצוגת הכרטיסים הישנה.

### communityEventsService (342)
- טיימליין per־שחקן per־קהילה ב־`communityPlayerEvents`: כרטיסים צהובים/אדומים ע"י מנהל (עם snapshot של expiresAt), אירועי ציוד (כדור/גופיות — אוטומטי מהפופאפ + ידני מ"נהל ציוד"), `getPlayerTimeline` (עד 200), `getLastTakenMap`, `getActiveCardCounts` (badges ברוסטר), `revokeCard`, `hasActiveRedCard` (חוסם הרשמה כשהפיצ'ר פעיל). mock עם seed דמו עשיר.

### playerStatsService (235) / playerCompareService (161) / eveningSummaryService (296)
- playerStats — מסך "סטטיסטיקה": סריקת games + שני חצאי pairStats → נוכחות, שותף מוביל, קורבן/נמסיס, בישולים דו־כיווניים.
- playerCompare — "השווה אליי" per־קהילה בלבד (מ־getCommunityChampionship; אין h2h פר־קהילה — TODO מתועד).
- eveningSummary — כרטיס "סיכום הערב": קריאות מקבילות מ־game + `gamePlayerStats/{gameId__uid}` + `games/{id}/roundHistory` + `games/{id}/physical/{uid}`; כל שכבה אופציונלית (degrade לפי גיל המשחק/היעדר צמיד). כולל מודל mock עם נתוני הבעלים.

### healthService (471) + physicalSyncService (124)
- health — קריאת Health Connect (אנדרואיד בלבד; iOS/HealthKit לא מחובר — מוחזר null): Distance/Steps/Calories/Speed. **HeartRate הוסר ב־14.7** (מדיניות Google) — avgHr/maxHr/hrZones מוחזרים 0/ריק. ספרינטים = rising-edges מעל 19 קמ"ש, סינון דגימות מעל 43 קמ"ש. `readSessionMulti` קורא את כל הטווח פעם אחת ו**חותך** כל רשומה לפי חפיפה עם חלונות הטיימר (מניעת ספירה כפולה). latch "המשתמש סירב" ב־AsyncStorage. `HEALTH_ENABLED=true` (דגל קוד).
- physicalSync — אחרי משחק finished: המרת `liveMatch.activeIntervals` מזמן שרת לזמן מכשיר (offset), coalescing חפיפות, תקרת 4 שעות, קריאת session והעלאה דרך callable `saveGamePhysical`. no-op שקט בלי צמיד/הרשאה.

### watchSyncService (408)
- מפרסם מצב לשעון/ווידג'ט דרך WatchBridge (אנדרואיד: Data Layer native; iOS: Expo module + WatchConnectivity). Payload: kind live/upcoming/scheduled/notRegistered + פרימיטיבי טיימר + `serverNowMs`/`baseElapsedMs` (עמיד לסטיית שעון — תיקון באג "טיימר תקוע על 0") + רוסטר + `canControl` (יוצר בלבד) + viewer (לכתיבה native מהווידג'ט). `useWatchSync` — מנוי על subscribeMyLiveOrUpcomingGames + republish כל 60 שנ' בלייב + ניקוי ב־logout; iOS מפרסם רק כששעון מצומד (polling לצימוד מאוחר). מונה sequence מונוטוני נגד publish ישן שדורס חדש.

### adsService (656) — **חבוי מאחורי דגל**
- כל המערכת מאחורי `EXPO_PUBLIC_ADMOB_ENABLED=1`; בלי הדגל — no-op מוחלט (ה־require לא רץ). BannerAd (kill-switch RC `banner_enabled` + מתג Pulse `appConfig/ads.bannerEnabled`), App-Open ad עם שרשרת שערים: מתג Pulse (`appOpenEnabled`, ממתין לקריאה עד 2.5 שנ'), RC kill-switch, דיכוי פתיחה-מכוונת (פוש/לינק, 20 שנ'), גרייס משתמש חדש (48ש'), cooldown 4ש' + תקרה 3/יום (AsyncStorage). מצב screenshot/mock מסתיר מודעות. `AdDebugOverlay` לדיבוג.

### campaignService (294)
- צרכן קמפייני popup מ־Pulse (`campaigns` where type='popup', status='active'): הערכת segment בקליינט (מנוע rules עם תאימות לאחור לשני פורמטים ישנים), frequency cap מקומי (maxImpressions+cooldown ב־AsyncStorage), קמפייני test מוצגים רק ל־testUserId והחדש בלבד. `trackCampaignEvent` → callable. kill-switch `feature_campaigns`.

### remoteConfigService (207)
- Firebase Remote Config עם דיפולטים בקוד (תדירויות מודעות, kill-switches לפיצ'רים: quick_games/referrals/friends/feedback/ios_clipboard_invite/campaigns, maintenance_mode+message, review prompt, לינקים לחנויות, באנר הכרזה). קריאות סינכרוניות עם fallback; `useRemoteConfig` tick לרענון UI.

### שרשרת ההזמנות/אטריביוציה
- **deepLinkService** (253) — פרסור `teamder://` + `footy://` legacy + דומייני hosting (session/team/app/go), `invitedBy`, תגי UTM (`b` בסיס64→source, `c`, `l` linkId), `?g=` לדיפ־לינק למשחק; stash set-once ל־AsyncStorage (RootNavigator צורך אחרי login).
- **inviteLinkService** (66) — לינק קצר: כתיבת `inviteLinks/{code}` (7 תווי base62) → `https://teamderfc.web.app/i/<code>?invitedBy=`; fallback ללינק הארוך על כל כשל.
- **installReferrerService** (223) — אנדרואיד: Play Install Referrer → פרסור `invite_<type>_<id>[_by_<uid>]` → PendingInvite; latch חד־פעמי.
- **clipboardInviteService** (98) — iOS: קריאת clipboard חד־פעמית בהתקנה ראשונה (`hasUrlAsync` לפני prompt), kill-switch RC.

### קטנים
- **storage** (254) — עטיפת AsyncStorage: משתמש/קבוצה נוכחית, PendingInvite, latches (referrer/clipboard/deleteSweep), מצב app-open ad, presence ping, ledger קמפיינים, cooldown ביקורת חנות.
- **rateLimitService** (120) — מוני `rateLimits/{uid}_{op}` (createGroup/createGame/inviteToGame/joinRequest/rateVote); fail-open; מתועד שהתקרה הקשיחה בצד שרת (createGroup כבר עבר).
- **feedbackService** (80) — "דווח על בעיה/הצע פיצ'ר" → doc ב־`feedback` (עד 2000 תווים + צילום מסך base64 עד 700KB).
- **updateService** (118) — קריאת `appConfig/{android|ios}` (latestVersion/minimumSupportedVersion) → none/optional/force; `openStore` עם fallback ל־https ב־iOS.
- **storeReviewService** (128) — פרומפט ביקורת: dedup לסשן + cooldown 90 יום (RC) + expo-store-review.
- **photoService** (280) — העלאת אווטאר ל־Storage `users/{uid}/avatar.jpg` (512², JPEG 0.8) + מחיקה; cover קהילה דרך callable `uploadGroupCover` (1280×720).
- **geocodeService/govmapService/israelLocationService/weatherService** — govmap (מפ"י, POI בעברית) → fallback Nominatim (מוגבל IL); השלמת ערים מ־data.gov.il; תחזית Open-Meteo לשעת הקיקוף (memo, עד 14 יום).
- **whatsappService** (80) — נרמול טלפון ישראלי → wa.me, ו־share עם טקסט.
- **availabilityFeedService** (129) — לוח "פנויים לשחק לידך": callable `availabilityCounts` (אגרגציה בשרת), cache 15 דק' + de-dupe inflight + epoch invalidation.
- **homeConfigService** (25) — מתג Pulse `appConfig/features.availabilityCardEnabled` (fail-open).
- **activeChat** (24) — tracker של הצ'אט הפתוח לדיכוי באנר פוש על אותו צ'אט.
- **index.ts** — re-exports חלקיים בלבד (רוב השירותים מיובאים ישירות).

---

## 5. חנויות Zustand (src/store)

- **userStore** — hydrate (AsyncStorage+getCurrentUser, עמיד לכשל חלקי), פעולות auth, `subscribeCurrentUser` (listener חי על `/users/{uid}` — תיקון שורש למחלקת "store מיושן"), sign-out/delete עם המתנה ל־ack של הסרת טוקן (עד 4 שנ') ואיפוס כל החנויות (מניעת דליפה בין חשבונות).
- **gameStore** — מצומצם: מפת `players` (hydrate מ־users עם TTL 5 דק', סינון ids ריקים שנפלו על in-query), `currentUserId`, `game` placeholder (רק status נקרא). מתועד כשריד מהזרימה הישנה שנמחקה.
- **groupStore** — קהילות המשתמש + pending, listener חי (`subscribe`), currentGroupId, פעולות עוטפות של groupService (בלי dispatch כפול של פושים — תוקן), reset.
- **chatStore** — אינדקס unread לפי chatKey + `totalUnread` ל־badge.

---

## 6. טבלת אוספי Firestore — מי קורא/כותב מהקליינט

| אוסף | קריאה | כתיבה |
|---|---|---|
| `users` | userService, groupService.hydrateUsers, friendsService, achievements, watchSync | userService (self), notificationsService (newGameSubscriptions), achievements/discipline (self) |
| `users/{uid}/private/push` | notificationsService | notificationsService (טוקנים+העדפות) |
| `users/{uid}/chatUnread·chatSettings·blocked` | chatService/chatStore | chatService |
| `groups` (+`messages/reads/typing`) | groupService, gameService (הרשאות) | groupService (חברות/מטא/דירוגים/ציוד), chatService |
| `groupsPublic` | groupService (גילוי) | שרת בלבד (מראה) |
| `groupJoinRequests` | groupService | groupService (audit) |
| `games` (+`messages/reads/typing`) | gameService (כל השאילתות+listeners), trust, discipline, playerStats, achievements | gameService (רוסטר/לייב/טיימר/גולים/arrivals), chatService |
| `games/{id}/joinRequests` | — | gameService.requestJoinGame (create/delete עצמי) |
| `games/{id}/retroGoals` | gameService.getRetroGoals | callable בלבד |
| `games/{id}/roundHistory`, `games/{id}/physical` | eveningSummaryService | שרת/callable בלבד |
| `rounds` | gameService (legacy) | gameService.saveGame (legacy) |
| `pairStats` | playerStats, achievements, gameService.getPairStats | שרת בלבד |
| `communityPlayerStats`, `communityPairStats`, `gamePlayerStats` | gameService (אליפות/סטטים), eveningSummary | שרת בלבד |
| `notifications` | dispatch (בדיקת dedupe) | notificationsService.dispatch, markRead |
| `friendRequests` | friendsService | friendsService (create/decline/delete) |
| `dmConversations` (+תתי) | chatService | chatService |
| `chatReports` | — | callable בלבד |
| `inviteLinks` | — | inviteLinkService |
| `communityPlayerEvents` | communityEventsService | communityEventsService |
| `campaigns` | campaignService | Pulse בלבד |
| `rateLimits` | rateLimitService | rateLimitService (self) |
| `errors` | — | errorLog |
| `feedback` | — | feedbackService (create בלבד) |
| `appConfig/{android,ios,ads,features}` | updateService, adsService, homeConfigService | Pulse/ידני בלבד |
| `ratings`, `groups/{gid}/ratings`, `playerStats` | **אין** — הגדרות מתות ב־firestore.ts | — |

**Callables בשימוש (23):** getServerTime, deleteMyAccount, createGroupCallable, ensurePersonalGroup, promoteOrphanToGroup, inviteFriendsToGroup, sendGameInvite, notifyPlayerCancelled, reportChatMessage, acceptFriendRequest, removeFriendship, adminAddPlayers, adminReorderRoster, commitRoundStats, addRetroGoal, removeRetroGoal, notifyTeamsReady, startGameFillerPulse, submitFillerInterest, saveGamePhysical, availabilityCounts, trackCampaignEvent, uploadGroupCover.

---

## 7. דגלים מרוכזים — לא־גמור / מת / חבוי / ניסיוני

**קוד מת/legacy:**
- gameService: `createGame`, `getActiveGameForGroup`, `saveGame`, `listPlayers`, `joinGameV2` — ללא קוראים (הוחלפו ב־V2/fair-join).
- firestore.ts: הגדרות `ratings`/`globalRatings`/`ratingVotes`/`playerStats` — שרידי דירוג עמיתים שנמחק.
- disciplineService: `applyFirebase` לא נקרא; בדיקת no-show ב־snapshot תלויה ב־`teams[]` שלא נכתב יותר.
- notificationsService: פרמטרים deprecated ב־`inviteToGame`; שדות deprecated ב־createGameV2 (hasReferee/hasPenalties/hasHalfTime/extraTimeMinutes → ruleTags).
- deepLinkService: תמיכה ב־`footy://` ובדומיינים `teamder.web.app` — תאימות לאחור בלבד.

**חבוי/מאחורי דגל:**
- adsService — כבוי כברירת מחדל (`EXPO_PUBLIC_ADMOB_ENABLED`), עם מתגי Pulse+RC.
- healthService — `HEALTH_ENABLED=true` בקוד אך תלוי בהצהרת Health ב־Play; HR הוסר.
- Remote Config kill-switches לכל הפיצ'רים הצומחים + maintenance mode + באנר הכרזה (announcement — כבוי כברירת מחדל).
- מתגי Pulse: `appConfig/ads`, `appConfig/features.availabilityCardEnabled`.
- advanced live match (rotation/goals) — פעיל בפרודקשן אך admin-only.

**לא גמור/TODO מתועד בקוד:**
- iOS HealthKit לא מחובר (הפאנל הפיזי לא מוצג ב־iOS).
- playerCompareService — אין h2h פר־קהילה (דורש rollup בשרת, TODO).
- watchSync — רענון כשהאפליקציה מתה דורש FCM-data path ("out of scope for v1").
- friendsService — תיעוד כותרת מיושן ("Phase 2 callables" כבר קיימים).
- rateLimitService — אכיפה קשיחה בצד שרת רק ל־createGroup; שאר ה־ops עדיין client-side בלבד.


# 6. חוקים, הרשאות וסוגי-משתמשים

I have everything needed. Compiling findings.

# מודל האבטחה וההרשאות — Teamder

**מקורות:** `firestore.rules` (1,781 שורות), `storage.rules` (91 שורות), הצלבה מול `functions/src/index.ts` ו-`src/services/*`, `src/firebase/appCheck.ts`, `src/firebase/auth.ts`. שני הקבצים מחוברים לפריסה ב-`firebase.json`.

**עיקרון-על:** deny-by-default. כל נתיב כתיבה מוגבל לשדות שהוא חייב לגעת בהם, עם תקרות אורך למחרוזות ותקרות גודל למערכים (הגנת DoS). מוטציות רגישות (סטטיסטיקות, חברויות, אישורי הצטרפות, דירוגי אורחים, פוש מערכתי) עוברות דרך Cloud Functions בלבד (Admin SDK עוקף rules). קיימות 31 פונקציות callable (בהן `sendGameInvite`, `acceptFriendRequest`, `commitRoundStats`, `createGroupCallable`, `adminAddPlayers`, `approveFiller`, `addRetroGoal`, `uploadGroupCover`, `deleteMyAccount`).

---

## 1. מודל התפקידים

אין collection של roles — התפקיד נגזר משדות במסמכים עצמם:

| תפקיד | הגדרה בקוד | יכולות עיקריות |
|---|---|---|
| **משתמש לא-מחובר** | `request.auth == null` | קריאה בלבד של `appConfig` ו-`communityShowcase` (דפי שיתוף ציבוריים); כתיבת דוחות שגיאה ל-`/errors` (בכוונה, ללכידת כשלי sign-in לפני auth) |
| **אורח (Anonymous Auth)** | `signInAnonymously` (`src/firebase/auth.ts:406`) — "מצב אורח" לגלישה ללא הרשמה, לא נוצר לו מסמך `/users` | עובר את `isSignedIn()` בכל ה-rules! כלומר קורא את כל `/users`, `/groupsPublic`, משחקים ציבוריים, `playerStats`, `ratings`, `campaigns` — כמו משתמש רשום |
| **משתמש רשום (שחקן)** | `isSignedIn()` + מסמך `/users/{uid}` | עריכת הפרופיל שלו בלבד; הצטרפות/ביטול למשחקים ולקהילות (self-only, ראו מטריצה); צ'אטים במקומות שהוא חבר בהם; הבעת עניין כ-filler; בקשות חברות; דיווח/פידבק |
| **חבר קהילה** | `isGroupMember(gid)` — `uid in groups/{gid}.playerIds` או `adminIds` | קריאת מסמך הקבוצה, קריאת משחקי הקהילה, צ'אט קהילה, יצירת משחק בקהילה |
| **מארגן משחק** | `game.createdBy == uid` | עריכת כל שדות המשחק (למעט `createdBy`, `groupId`, ומצבים סופיים), מחיקת משחק, ניהול `rounds`, מודרציית צ'אט המשחק |
| **מנהל קהילה (admin/coach)** | `isGroupAdmin(gid)` — `uid in groups/{gid}.adminIds` (עד 20) | כל מה שמארגן יכול בכל משחקי הקהילה + עריכת הקבוצה, אישור/דחיית מצטרפים, כרטיסים צהובים/אדומים (`communityPlayerEvents`), דירוג פנימי (`adminRatings` על מסמך הקבוצה), מודרציית צ'אטים |
| **יוצר הקהילה (creator)** | `groups.creatorId` — mandatory, immutable | היחיד שרשאי: לרוטט את `adminIds`, למחוק את הקהילה, ולעזוב רק עם העברת בעלות (handoff באותה כתיבה). מנהל רגיל לא יכול לנשל אותו |
| **"אורח" במשחק (guest)** | מחרוזות במערך `games.guests` — לא משתמש Auth | אין לו זהות; שחקן רשום מוסיף אותו, ודירוגו נכתב רק דרך callable `setGuestRating` (רק המוסיף עורך) |
| **super-admin** | UID קשיח בקוד: `updateAppConfig` ב-functions בודק `uid === '1IdtNEjbEXfiRSqvLrJVn99NsfI2'` | עדכון `appConfig` (version gate) |

בצד הלקוח ההגדרה עקבית: `isAdmin = game.createdBy === user.id || group.adminIds.includes(user.id)` (למשל `MatchDetailsScreen.tsx:709`).

---

## 2. מטריצת גישה פר-Collection

### ליבה

| Collection | Read | Create | Update | Delete |
|---|---|---|---|---|
| `/users/{uid}` | כל מחובר (כולל אנונימי) | self בלבד; ולידציית שדות; `invitedBy != self` | self בלבד; `invitedBy` הוא first-set-only (null לא נועל); `stats` חסום לגמרי (server-derived); תקרות `fcmTokens≤20`, `newGameSubscriptions≤200` | אסור (מחיקת חשבון דרך callable `deleteMyAccount`) |
| `/users/{uid}/private/{doc}` | self | self | self | self — נועד ל-fcmTokens/notificationPrefs מוסתרים |
| `/users/{uid}/campaignSeen`, `chatUnread`, `chatSettings`, `blocked` | self | self | self | self |
| `/groups/{gid}` | חברים + מנהלים + **ממתינים (`pendingPlayerIds`)** | כל מחובר; `adminIds==[self]`, `playerIds⊆[self]`, pending ריק | 7 ענפים: (1) מנהל — הכל למעט `creatorId` immutable ו-`adminIds` creator-only, תקרות `playerIds≤500`/`adminIds≤20`; (2) self-add ל-pending (קבוצה סגורה, עם capacity gate); (3) self-withdraw מ-pending; (4) self-join ל-players (קבוצה פתוחה `isOpen`); (5) self-leave שחקן; (6) self-leave co-admin (לא creator, נשאר לפחות מנהל אחד); (7) creator-leave עם העברת `creatorId` למנהל נשאר באותה כתיבה. כל הענפים העצמיים עם הגנות anti-hijack (±1 בדיוק, `hasAll` על הרשימה הישנה, חסימת dup-padding) | creator בלבד (fallback ל-`adminIds[0]` בקבוצות legacy ללא creatorId) |
| `/groupsPublic/{gid}` | כל מחובר (פיד discovery) | כל מחובר, `memberCount ∈ {0,1}` (ולידציה לפי צורה — בגלל batch אטומי עם המסמך הקנוני) | מנהל הקבוצה; `memberCount ≤ playerIds.size()` הקנוני | מנהל, או כל מחובר אם המסמך הקנוני לא קיים (ניקוי יתומים) |
| `/games/{id}` | מחובר אם: המשחק `public`, או חבר קהילה, או ב-`participantIds`, או `createdBy`, או ב-`invitedUserIds`, או שהמשחק `acceptsFillers` ולא private | חבר בקהילה, `createdBy==self`, `status∈{open,scheduled}`, `maxPlayers 1–50`, תקרות טקסט | 5 ענפים — ראו פירוט מטה | `createdBy` או מנהל קהילה |
| `/rounds/{id}` | **כל מחובר** | מארגן המשחק או מנהל הקהילה | מארגן/מנהל; `gameId` immutable | אסור |

**ענפי update על `/games/{id}` (החוק הכבד ביותר):**
1. **Self join/cancel** — רק ב-`open` (ב-`locked` רק פרישה); חסום כשה-`liveMatch.phase` הוא live/roundRunning; משתמש שנדחה (`rejectedPlayerIds`) חסום; דלתא של ±1 בדיוק בכל מערך (`players`/`waitlist`/`pending`) והמשתנה הוא הקורא בלבד; אינווריאנט `participantIds == players ∪ waitlist ∪ pending`; אסור self-add ל-waitlist/pending (רק דרך `joinRequests` + reconciler CF); self-add ל-players מותר רק כמימוש הצעת מקום (`pendingPromotion.uid == self`, שדה שרק השרת קובע); מפות `cancellations`/`joinedAt` — רק המפתח של הקורא.
2. **Self-toggle "אני מביא כדור"** (`ballBringerIds`) — משתתף רשום, רק ה-uid שלו, ±1.
3. **Self like/dislike על חלוקת כוחות** (`draftTeamFeedback`) — רק תחת מפתח ה-uid של הקורא.
4. **Self הוספת אורח** (`guests`) — שחקן רשום, משחק open, append בלבד (+1 עם `hasAll`), כפוף ל-`guestsOpenAt`.
5. **מארגן/מנהל** — הכל, למעט: מצבים סופיים (`finished`/`cancelled` חסומים לעדכון), `createdBy` ו-`groupId` immutable; תקרות מערכים (players≤100 וכו').

### תתי-collections של משחק

| נתיב | Read | Write |
|---|---|---|
| `/games/{id}/messages` (צ'אט משחק) | `isGamePlayer` (שחקן רשום/מארגן/מנהל) | create: שחקן, `senderId==self`, טקסט 1–1000; אין עריכה; מחיקה: מחבר/מארגן/מנהל |
| `/games/{id}/reads`, `/typing` | שחקני המשחק | self בלבד |
| `/games/{id}/joinRequests/{uid}` (הרשמה הוגנת) | self | create: self, `state=='queued'`, `requestedAt == request.time` (חותמת שרת, אנטי-backdate); update אסור (reconciler CF); delete: self (משיכת בקשה) |
| `/games/{id}/fillerInterests/{uid}` | המחבר או מנהל הקהילה | create: self, רק אם `acceptsFillers==true`, `status=='pending'`; update: self רק ל-`cancelled`; delete אסור (audit trail) |
| `/games/{id}/retroGoals` | מארגן/מנהל | server-only (callables) |
| `/games/{id}/roundHistory`, `/committedRounds` | שחקני המשחק | server-only (`commitRoundStats`) |
| `/games/{id}/physical` | שחקני המשחק | server-only |

### צ'אט קהילה ו-DM

| נתיב | Read | Write |
|---|---|---|
| `/groups/{gid}/messages` | חברי קהילה | create: חבר, `senderId==self`, ≤1000; מחיקה: מחבר או מנהל |
| `/groups/{gid}/reads`, `/typing` | חברים | self |
| `/dmConversations/{convId}` | שני הצדדים (uid מקודד ב-convId — עובד גם לפני שהמסמך קיים) | create: מחובר, 2 משתתפים כולל self, וכפוף ל-`dmFriendsOnly` של הצד השני; update: משתתף, שדות מוגבלים; delete אסור |
| `.../messages` | משתתפים | create: משתתף + **בדיקת `dmFriendsOnly` פר-הודעה** (סוגר עקיפה של כתיבה ישירה בלי ליצור שיחה); מחיקה: השולח |
| `/friendRequests/{rid}` | שני הצדדים | create: השולח, `pending`; update: הנמען→`declined` (סופי — אי אפשר re-pending אחרי דחייה), או השולח→re-`pending`; **אישור חברות רק דרך callable `acceptFriendRequest`**; delete: שני הצדדים |

### נוטיפיקציות, דירוגים, אדמין

| Collection | Read | Write |
|---|---|---|
| `/notifications/{id}` | מסמך לא-קיים: כל מחובר (dedupe getDoc); קיים: הנמען בלבד | create: מחובר, `type` ב-whitelist של 8 סוגים בלבד (`gameCanceledOrUpdated`, `newGameInCommunity`, `approved`, `rejected`, `groupDeleted`, `spotOpened`, `spotOffered`, `playerCancelled`); `inviteToGame` הוסר בכוונה (עבר ל-callable אחרי פרצת spoofing); `srv` אסור ללקוח; `delivered==false`, `read==false`; תקרות payload; update: הנמען, רק `read/readAt→true`; delete אסור |
| `/ratings/{uid}` + `/votes` | summary: כל מחובר; vote: המצביע | summary: server-only; vote: המצביע, 1–5, לא על עצמו |
| `/groups/{gid}/ratings/...` (legacy) | כמו לעיל + דרישת חברות בקבוצה | vote עדיין פתוח לכתיבה — הושאר לגרסאות ≤1.0.11 |
| `/playerStats`, `/pairStats`, `/communityPlayerStats`, `/gamePlayerStats`, `/communityStats`, `/communityPairStats` | כל מחובר | server-only |
| `/communityPlayerEvents/{id}` (כרטיסים/ציוד) | מנהל הקהילה + המשתמש רואה את האירועים של עצמו | create: מנהל, `type∈{yellow,red,ball,jerseys}`, `at` עד +1h סטיית שעון, כרטיס עם `issuedBy==self`; update: revoke-only (ערכים ננעלים); delete אסור (append-only) |
| `/groupJoinRequests` | המבקש או מנהל הקבוצה | create: self, `pending`; update: מנהל → approved/rejected; delete אסור |
| `/errors/{fp}` | אסור ללקוח | create/update **ללא auth בכלל** (בכוונה — שגיאות pre-auth), עם תקרות שדות |
| `/feedback`, `/inviteLinks`, `/chatReports` | אסור | create בלבד: מחובר + owner check (`invitedBy==self` וכו') |
| `/campaigns` | כל מחובר | server-only |
| `/appConfig/{platform}` | **פתוח לעולם** (`if true`) | server-only (callable עם UID קשיח) |
| `/communityShowcase` | פתוח לעולם (דפי שיתוף) | server-only |
| `/rateLimits/{uid}_*` | self (legacy) | self — הלקוח שולט במונה שלו |
| `/serverRateLimits`, `/cityGeocode`, `/gameUpdateLatches`, `/adminConfig` | אסור לגמרי | אסור לגמרי (Admin SDK בלבד) |

### Storage

| נתיב | Read | Write |
|---|---|---|
| `/users/{uid}/avatar.jpg` | כל מחובר | הבעלים בלבד; ≤1MB; `image/(jpeg\|png\|webp)` בלבד (SVG נחסם במפורש נגד XSS ב-WebView); delete מותר לבעלים; שם קובץ קשיח (אין wildcard — נגד image hosting חינם) |
| `/groups/{gid}/cover.jpg` | כל מחובר | **חסום ללקוח** — עובר דרך callable `uploadGroupCover` (כי `firestore.get()` מתוך Storage rule לא נושא App Check token) |
| כל שאר הנתיבים | אסור | אסור (catch-all) |

---

## 3. חוקים חשודים / ממצאים

**חמור-בינוני:**
1. **מצב אורח אנונימי = "מחובר" מלא בכל ה-rules.** `signInAnonymously` קיים ופעיל בקוד (`auth.ts:406`, `userService.ts:91`), ואין אף rule שבודק `token.firebase.sign_in_provider != 'anonymous'`. אנונימי יכול לקרוא את **כל** מסמכי `/users` (כולל email, ו-fcmTokens/notificationPrefs בשדות legacy שטרם הועברו ל-`/private`), את כל `playerStats`, `ratings`, ואף לכתוב notifications מה-whitelist, vote-ים ב-`/ratings`, ו-`friendRequests`.
2. **`/users` read חושף שדות רגישים.** ההערה בקובץ עצמו (שורות 123–134) מודה: `fcmTokens` ו-`notificationPrefs` יושבים במסמך הראשי הקריא לכל מחובר. תוקן חלקית — נוספה תת-collection `/private/push`, אך המסמך הראשי עדיין קריא במלואו.
3. **`chatReports` create עדיין פתוח — הטיה מכוונת שנדחתה.** הלקוח יכול לזייף דיווח (טקסט/מחבר שרירותיים). ההערה בקובץ: flip ל-`if false` ממתין לאימוץ 1.0.50 (הלקוח החדש עובר דרך callable `reportChatMessage`). נכון להיום — עדיין לא הוחלף (audit #7).
4. **`notifications.createdByUid` הוא opt-in.** אם השדה קיים הוא חייב להיות `== auth.uid`, אבל **מותר להשמיטו** (סובלנות ללקוחות ישנים) — ה-CF `onNotificationCreated` אמור לוודא זהות פר-סוג לפני שליחה. עד ה-flip הקשיח, לקוח יכול ליצור מסמך `approved`/`gameCanceledOrUpdated` לכל נמען, וההגנה היחידה היא בצד ה-CF.
5. **דירוג פנימי (`adminRatings`) גלוי לכל חבר קהילה ברמת הדאטה.** הדירוג נכתב כמפה על מסמך `/groups/{gid}` עצמו (`groupService.setAdminRating`), ומסמך הקבוצה קריא לכל חבר **וגם לממתינים ב-pendingPlayerIds**. הדגל `hideInternalRating` הוא הסתרת-UI בלבד — אין אכיפת קריאה ברמת rules.

**קוד מת / legacy פתוח:**
6. **`/groups/{gid}/ratings/.../votes` ו-`/ratings/{uid}/votes` עדיין כתיבים (1–5)** — אבל פיצ'ר דירוג-העמיתים **נמחק מהלקוח** (24.6, מעבר לדירוג פנימי בלבד; אין שום קוד ב-`src/services` שנוגע ב-collections האלה). זה משטח כתיבה פתוח ללא צרכן — מועמד לסגירה (`if false`).
7. **`/rateLimits` legacy** — הלקוח שולט במונה של עצמו (יכול לאפס quota); הוחלף ב-`/serverRateLimits` server-only עבור `createGroup`, אך ה-collection הישן עדיין פתוח.
8. **`spotOpened`** ב-whitelist הנוטיפיקציות מסומן "legacy auto-promote (kept for rollout)".
9. **`backfillGroupCreatorIdsOnce`** — callable מיגרציה חד-פעמית שעדיין פרוס.

**נקודות עדינות שנבדקו ותקינות (ראוי לציין בספק):**
- `joinedAt` נכתב ע"י הלקוח (best-effort, רק המפתח של עצמו) — מזין תצוגת "הצטרף לפני X" בפאנל אדמין, לא סטטיסטיקות.
- `rounds` (תוצאות משחקונים) נכתבים ע"י לקוח המארגן/מנהל ומזינים בעקיפין את `playerStats` דרך `commitRoundStats` — by design (מנהל מיוחס), אבל זה נתיב לקוח→סטטיסטיקות. בנוסף `rounds` קריא לכל מחובר, לא רק לחברי הקהילה.
- `/errors` create ללא auth — מכוון ומתועד, מוגן בתקרות גודל בלבד; ההערה עצמה מציינת "harden later with App Check".

---

## 4. סטטוס אכיפת App Check ו-Auth

- **App Check ב-Cloud Functions: כבוי גלובלית.** `functions/src/index.ts:78`: `const ENFORCE_APP_CHECK = false;` — כל 31 ה-callables מקבלים את הדגל הזה. כובה כדי לא לחסום iOS עד אימות App Attest (מתועד גם בזיכרון הפרויקט: להחזיר כש-App Attest מאומת).
- **App Check ב-Firestore rules: קיים helper `hasAppCheck()` אך אינו בשימוש באף rule.** ההערות בקובץ מתעדות שהוא הוסר מ-`groupJoinRequests`, `fillerInterests` ו-`notifications` כי גשר ה-JS SDK (`CustomProvider` ב-`src/firebase/appCheck.ts`) לא הנפיק tokens אמין — משתמשים לגיטימיים קיבלו permission-denied. TODO מפורש להחזיר.
- **צד לקוח:** תשתית App Check מלאה קיימת (native Play Integrity + גשר CustomProvider ל-JS SDK, debug provider ל-dev) — הבעיה היא באכיפה, לא בהנפקה.
- **Storage:** ההערה על `cover.jpg` מציינת ש-cross-service `firestore.get()` מ-Storage rule לא נושא App Check token — לכן הועבר ל-callable.
- **Auth:** אין דרישת אימות email; אנונימי נחשב מחובר (ממצא 1). `updateAppConfig` מוגן ב-UID קשיח יחיד.

**שורה תחתונה:** שכבת ה-Firestore rules בשלה ומוקשחת מאוד (הגנות anti-hijack מפורטות פר-מערך, immutables, append-only audit trails), אבל שלושה "ברזים" ידועים ממתינים לסגירה: אכיפת App Check (functions + rules), flip של `chatReports` ל-server-only, ו-flip של `createdByUid` לחובה — כולם מתועדים בקוד כ-deferred.


# 7. התראות, קישורים עמוקים וייחוס

# דוח מיפוי: התראות (Push) מקצה-לקצה, דיפ-לינקים, שיתוף והזמנות

**קבצים מרכזיים:** `src/services/notificationsService.ts`, `src/services/notificationActionService.ts`, `src/services/notificationDedup.ts`, `App.tsx`, `src/navigation/navigationRef.ts`, `functions/src/index.ts` (11,563 שורות), `functions/src/chatPush.ts`, `functions/src/adminPush.ts`, `functions/src/adminUserPush.ts`, `functions/src/reviewAlerts.ts`, `functions/src/notificationDedup.ts`, `src/services/deepLinkService.ts`, `src/services/inviteLinkService.ts`, `src/services/installReferrerService.ts`, `src/services/clipboardInviteService.ts`, `public/invite.html`, `firebase.json`, `app.json`.

---

## 1. ארכיטקטורת מערכת ההתראות

### צינור ההתראות הראשי (`/notifications`)
- **כתיבה**: הלקוח (`notificationsService.dispatch`) או השרת (`createNotificationOnce` ב-`functions/src/index.ts`) כותבים מסמך ל-collection `notifications` עם `type`, `recipientId`, `payload`, `dedupeKey`, `createdByUid`, `cooldownMs`, `read:false`, `delivered:false`, `schemaVersion:2`. מסמכי שרת מסומנים `srv:true` (חוקי ה-rules אוסרים על לקוח לכתוב שדה זה — משמש להוכחת מקור).
- **טריגר**: `onNotificationCreated` (onDocumentCreated על `notifications/{id}`) בונה את הטקסט העברי ב-`buildMessage`, פותר נמענים ב-`resolveRecipients`, ושולח דרך `deliverBatch` → `messaging.sendEachForMulticast` (עד 500 טוקנים לקריאה). בסיום מעדכן `delivered:true` + `stats`.
- **קנוניזציה נגד ספופינג**: `canonicaliseNotificationPayload` דורס את `gameTitle`/`groupName`/`startsAt` מהמסמכים הקנוניים ב-`/games` ו-`/groups` לפני בניית הטקסט — לקוח לא יכול לזייף תוכן.
- **אימות שולח ל-fan-out**: `isFanoutSenderAuthorized` — סוגי fan-out (`newGameInCommunity`, `gameCanceledOrUpdated`, `gamePlayersJoined`, `gameFillingUp`) שנכתבו מלקוח נבדקים: `createdByUid` חייב להיות אדמין קהילה / יוצר משחק, אחרת ההתראה נשלחת ל-**אף אחד**. `srv:true` עוקף את הבדיקה.

### רישום טוקנים
- `requestAndRegisterPushToken(uid)` — מבקש הרשאה + `getDevicePushTokenAsync` ושומר ב-`/users/{uid}/private/push.fcmTokens` (arrayUnion, מרובה-מכשירים). דילוג נקי ב-Expo Go / mock.
- `unregisterThisDevice(uid)` — מסיר את טוקן המכשיר בהתנתקות/מחיקת חשבון (מניעת דליפת פוש למשתמש הבא על אותו טלפון).
- **תאימות לאחור**: `loadUsers` בשרת ממזג את המסמך הפרטי עם השדות הישנים על `/users/{uid}` (fcmTokens/notificationPrefs שהיו פומביים — Security Audit Finding #1).
- **גיזום טוקנים מתים**: `deliverBatch`/`chatPush`/`adminPush` מסירים טוקנים שקיבלו `registration-token-not-registered` / `invalid-registration-token` (במכוון לא על `invalid-argument`, שהוא שגיאת הודעה ולא טוקן).

### דדופ (שני קבצים תאומים — `src/services/notificationDedup.ts` ↔ `functions/src/notificationDedup.ts`, חייבים lockstep)
- **מזהה דטרמיניסטי**: `dedupeIdFor` = `type:recipient:entityType:entityId:reason__b<bucket>` כאשר bucket = חלון cooldown לפי סוג (טבלת `COOLDOWN_MS`: מ-30 שניות ל-`inviteToGame` עד 7 ימים ל-`rateReminder`). כתיבה שנייה באותו bucket = `AlreadyExists` → נזרקת.
- **STRICT_UNREAD_DEDUP** (`gameCanceledOrUpdated` בלבד): לפני כתיבה, שאילתה על מסמך unread עם אותו dedupeKey — אם קיים ולא ישן מ-7 ימים (`STALE_UNREAD_TTL_MS`), ההתראה נבלעת. קריאת המסמך היא שמשחררת את הבא.
- **AGGREGATE_ON_DUPLICATE** (`playerCancelled`, `gamePlayersJoined`): כפילות בתוך ה-bucket ממוזגת למסמך הקיים (count + רשימות שמות) בלי פוש נוסף.
- **Latch נוסף**: `gameUpdateLatches/{gameId}__{update|cancel}` — חלון 60 שניות בין fan-out-ים של עדכון/ביטול משחק (מופרד לפי קטגוריה כדי שביטול אחרי עריכה לא ייבלע).

### העדפות משתמש
- נשמרות ב-`/users/{uid}/private/push.notificationPrefs`; מסך `NotificationsSettingsScreen` (פרופיל) עם 15 מתגים ב-3 קטגוריות + חסימת-OS gate. `deliverBatch` מדלג על נמען עם pref כבוי; מיפוי מיוחד: `approved`+`rejected`→מתג `approvedRejected`, `friendRequest`+`friendRequestAccepted`→מתג `friendRequest`.
- מנוי פר-קהילה ל"משחק חדש": מערך `newGameSubscriptions` על מסמך המשתמש (`setCommunitySubscription`).
- Opt-in נפרד לפושי מילוי-מקום: `availability.acceptsFillerPush` על מסמך המשתמש.

---

## 2. קטלוג מלא — כל סוגי ההתראות בצינור `/notifications`

| סוג | טריגר/שולח | נמענים | כותרת/תוכן (עברית, מ-`buildMessage`) | יעד הקשה (`navigateForPush`) | דדופ/cooldown |
|---|---|---|---|---|---|
| `joinRequest` | שרת: `onGroupPendingChanged` (גידול `pendingPlayerIds`) + `onGameRosterChanged` (גידול `pending` במשחק) | כל אדמיני הקהילה | "בקשת הצטרפות חדשה" / "בקשת הצטרפות למשחק" | עם gameId → MatchDetails; בלי → ProfileTab›AdminApproval | 5 דק', reason=`req-<requesterId>` |
| `approved` | לקוח: `groupService`/`gameService` (אישור אדמין); שרת: `approveFiller` | המבקש | "הבקשה אושרה" (וריאנט waitlist: "נכנסת לרשימת המתנה") | gameId→MatchDetails; groupId→CommunityDetails | שעה |
| `rejected` | לקוח: `groupService`/`gameService` | המבקש | "הבקשה נדחתה" | gameId→MatchDetails; groupId→**CommunityDetailsPublic** (נדחה אינו חבר) | שעה |
| `newGameInCommunity` | לקוח: יצירת משחק ידנית; שרת: `flipScheduledGameOnce` (פתיחת הרשמה מתוזמנת, Cloud Task מדויק + cron גיבוי) ו-clone שבועי | מנויי `newGameSubscriptions` של הקהילה ∩ חברי הקהילה הנוכחיים, פחות מי שכבר ברוסטר; ביצירה ידנית המארגן מוחרג, בפתיחת הרשמה הוא דווקא נכלל (`alsoNotifyUid`) | "משחק חדש: {שם}" | MatchDetails (נפילה ל-CommunityDetails) | 12 שע'; **קטגוריית כפתורים NEW_GAME_RSVP** ("אני מגיע" — join ברקע) |
| `gameReminder` | שרת: Cloud Task מדויק ב-T−60 דק' (`scheduledGameMomentTask` moment=`reminder1h`) + cron 15-דק' כרשת ביטחון (לעולם לא מוקדם מ-60 דק'); latch `reminderSent` | `game.players` בלבד | "תזכורת למשחק — {משחק} מתחיל {מתי}" | MatchDetails | 6 שע'; **ללא כפתורים** (הוסרו בהחלטת מוצר) |
| `gameRsvpNudge` | שרת: cron 15-דק' (`runSendRsvpNudges`), חלון T−5שע'±10דק', latch `rsvpNudgeSent` | חברי הקהילה שאינם ברוסטר, לא ביטלו, לא המארגן; מדולג אם המשחק מלא | "אתה בא למשחק?" | MatchDetails | 6 שע'; ללא כפתורים |
| `gameCanceledOrUpdated` | לקוח: עריכה/ביטול/הסרת שחקן ע"י אדמין; שרת: מחיקת משחק (`onGameRosterChanged` delete-branch, רוסטר מה-payload כי המסמך נמחק), מחיקת חשבון | players+waitlist+pending (מוחרג `editorUid`); וריאנט `directedTo` → רק המשוחרר ("הוסרת מהמשחק") | "המשחק בוטל" / "המשחק עודכן" / "הוסרת מהמשחק" | MatchDetails (בלי gameId → CommunitiesFeed) | 30 דק' + strict-unread + latch 60ש' |
| `spotOpened` | שרת: `onGameRosterChanged` קידום אוטומטי מהמתנה; לקוח (וריאנטים) | המקודם | "נפתח לך מקום במשחק! … אתה רשום כעת" | MatchDetails | דקה |
| `spotOffered` | שרת: `onGameRosterChanged` כשנכתב `pendingPromotion.uid` (הצעת מקום הדורשת אישור); לקוח בזרימות ביטול | ראש רשימת ההמתנה | "התפנה לך מקום! … מאשר/ת הגעה?" | MatchDetails; **קטגוריית SPOT_OFFER**: "מאשר/ת" (CONFIRM_SPOT) / "ויתור" (PASS_SPOT) — שניהם ברקע | דקה |
| `guestPromoted` | שרת: `onGameRosterChanged` — אורח עלה מהמתנה להרכב | השחקן שהוסיף את האורח | "האורח שלך נכנס להרכב!" | MatchDetails | דקה |
| `gamePlayersJoined` | שרת: buffer `pendingJoinerIds` על המשחק → Cloud Task `flushPendingJoinerNotifsTask` (פוש ראשון מיידי, הצטרפויות נוספות ב-5 דק' מתמזגות) | אדמיני הקהילה (מוחרג אדמין שהצטרף בעצמו) | "{שם} סימן שיגיע" / "{א} ועוד N סימנו שיגיעו" | MatchDetails | 5 דק' + aggregation |
| `playerCancelled` | שרת: callable `notifyPlayerCancelled` (הלקוח שולח gameId בלבד; השם נפתר בשרת); וריאנט מחיקת-חשבון מרובת-משחקים | מנהל המשחק (self-cancel של האדמין מדולג) | "שחקן ביטל השתתפות — {שם} ביטל ב{משחק}… כדאי לחפש מחליף" (+וריאנט "שחקן מרשימת ההמתנה אושר במקומו", +"שחקן מחק את החשבון") | MatchDetails | 5 דק' + aggregation (שמות מצטברים) |
| `gameFillingUp` | שרת: `onGameRosterChanged` בחציית 90% תפוסה (latch `capacityNoticeSent`), לא כשמלא | חברי קהילה שאינם ברוסטר | "N מקומות אחרונים ב{משחק}" | MatchDetails | 24 שע' |
| `gameShortageWarning` | שרת: cron 15-דק' (`runSendShortageWarnings`), T−2שע', רשומים < 2×גודל-קבוצה לפי `format`; latch `shortageWarningSentAt` | מנהל המשחק | "אין מספיק שחקנים למשחק — רשומים X/Y… תחליט/י אם לבטל" | MatchDetails | 12 שע' |
| `inviteToGame` | שרת: callable `sendGameInvite` — הלקוח מעביר IDs בלבד; השרת מאמת הרשאה, rate-limit ב-`serverRateLimits/{uid}_inviteToGame`, וכותב `inviterName` קנוני | המוזמן | "הזמנה למשחק — {מזמין} הזמין אותך ל{משחק}" | MatchDetails | 30 שנ', reason=`inv-<inviterId>` |
| `addedToGame` | שרת: callable `adminAddPlayers` (אדמין רשם חבר ישירות) | הנרשם | "נרשמת למשחק!" / "נוספת לרשימת ההמתנה" | MatchDetails | 5 דק' |
| `rateReminder` | **מושבת** — `runSendRateReminders` הוא no-op מפורש (החלטת מוצר 2026-06-14) | — | ("דרג את חבריך מהמשחק") | MatchDetails | 7 ימים |
| `growthMilestone` | שרת: `dispatchGrowthMilestoneIfNeeded` מתוך `onGroupPendingChanged` — חציית 10/25/50/100/250/500 חברים; claim טרנזקציוני על `groups.notifiedMilestones[]` | אדמיני הקהילה | "{קהילה} חצה N חברי סגל 🎉" | ProfileTab›Achievements | 24 שע'; **ברירת מחדל של המתג: כבוי** |
| `groupDeleted` | לקוח: `groupService` במחיקת קהילה | כל החברים והאדמינים | "המועדון נסגר — {שם} נמחק על ידי המנהל" | CommunitiesFeed | 24 שע' |
| `fillerOpportunity` | שרת: cron 15-דק' `runFindFillerCandidates` + פולסים ידניים `startGameFillerPulse`/`fillerPulseTask` ("שלח לכל הפנויים") — סינון לפי עיר/רדיוס haversine, ימים/שעות מועדפים, `acceptsFillerPush`, תקרת פושים יומית פר-משתמש (`reserveFillerPush`), היסטוריה `fillerPushHistory` | מועמדים חיצוניים | "הזדמנות למילוי משחק — {משחק} ב{עיר} צריך שחקנים… רוצה להגיש מועמדות?" (שם המשחק, לא הקהילה — בכוונה) | MatchDetails; **ללא כפתורים** (הוסרו; הקשה פותחת את המשחק) | 6 שע' |
| `fillerInterestReceived` | שרת: `onFillerInterestCreated` (מסמך `games/{id}/fillerInterests/{uid}`) | מנהל המשחק | "מישהו מעוניין למלא… עיין בפרופיל לפני אישור" (שם המועמד מוסתר בכוונה) | MatchDetails | דקה, פר-מועמד |
| `fillerNoCandidates` | שרת: matcher שלא מצא מועמדים (latch `fillerNoCandidatesAt` 6 שע') | מנהל המשחק | "אין כרגע מועמדים מתאימים" | MatchDetails | 6 שע' |
| `promotePrompt` | שרת: cron שעתי `runSendPromotePrompts` — משחק יתום (`isPersonal` group) שהסתיים; latch `promotePromptSent` | יוצר המשחק | "היה אחלה משחק! 🤝 רוצה לשמור את החברים…" | GameTab›PromoteOrphan (עם groupId+gameId) | 24 שע' |
| `groupInvitation` | שרת: `promoteOrphanToGroup` (לכל משתתפי המשחק היתום) + callable `inviteFriendsToGroup` (הזמנת חברים לקבוצה, מוסיף ל-playerIds/pending לפי `isOpen`) | המוזמנים | "הזמנה למועדון — {מזמין} מזמין אותך להצטרף ל'{שם}'" | CommunityDetails | 24 שע' |
| `friendRequest` | שרת: `onFriendRequestCreated` (מסמך `friendRequests/{from__to}`); `fromName` קנוני מהשרת | הנמען | "בקשת חברות חדשה — {שם} רוצה להתחבר אליך" | ProfileTab›Friends | 24 שע', keyed על השולח |
| `friendRequestAccepted` | שרת: callable `acceptFriendRequest` | השולח המקורי | "בקשת החברות אושרה 🤝" | ProfileTab›Friends | 24 שע', keyed על המאשר (תוקן מבאג קודם) |
| `teamsGenerated` | שרת: `fanOutTeamsReadyPush` (חלוקת כוחות אוטומטית מתוזמנת `runScheduledAutoGenerateTeams`, או callable `notifyTeamsReady` בפרסום אדמין); **כותב ישירות batch עם doc-id `{gameId}__teamsReady__{uid}`** (לא דרך `createNotificationOnce`); latch `teamsNotifiedAt` | כל שחקן רשום, גוף אישי | "הכוחות להיום מוכנים! ⚽ אתה בקבוצה עם {שמות}" | MatchDetails | doc-id דטרמיניסטי פר-שחקן |
| `eveningSummary` | שרת: `onGameRosterChanged` במעבר לסטטוס finished | כל `players` פרט ל-`no_show` | "סיכום הערב שלך מוכן! 🏆" | GameTab›**EveningSummary** | 24 שע' |

**דגש על כפתורי-פעולה ברקע** (`notificationActionService.ts` + רישום קטגוריות ב-`App.tsx`):
- `JOIN_GAME` ("אני מגיע", על newGameInCommunity): רץ ברקע בלי לפתוח את האפליקציה (`opensAppToForeground:false`), קורא `requestJoinGame`, ומפרסם **התראה מקומית** עם התוצאה (הרכב/המתנה/ממתין לאישור). `REGISTRATION_CONFLICT` נבלע כתוצאה צפויה.
- `CONFIRM_SPOT`/`PASS_SPOT`: `confirmSpotOffer`/`passSpotOffer` ברקע + התראה מקומית; שגיאות צפויות (STALE_OFFER וכו') לא מדווחות.
- דדופ הקשות: `handledActionTaps` Set ברמת module (תיקון triple-fire 1.0.56), key = notifId|action|gameId.
- באנדרואיד, פוש עם כפתורים נשלח **data-only** (בלי בלוק notification) כדי ש-expo-notifications יבנה את הכרטיס ויצרף את הכפתורים (`categoryId` באנדרואיד, `categoryIdentifier`+`aps.category` ב-iOS).

---

## 3. ערוצי פוש מחוץ לצינור `/notifications`

| ערוץ | קובץ | טריגר | נמענים | התנהגות |
|---|---|---|---|---|
| **צ'אט** (`type:'chatMessage'`) | `chatPush.ts` | onDocumentCreated על `games/*/messages`, `groups/*/messages`, `dmConversations/*/messages` | משתתפי הצ'אט פחות השולח, פחות חוסמים (בדיקת `users/{uid}/blocked/{sender}` ב-getAll אחד), פחות DM-friends-only | "פוש אחד עד פתיחה": טרנזקציה על `users/{uid}/chatUnread/{scope__parentId}` — פוש רק במעבר 0→1; mute פר-צ'אט ב-`chatSettings`; גוף "{שם}: {טקסט}" (120 תווים). הקשה → ChatTab›GameChat/CommunityChat/DirectChat. בנוסף, `setNotificationHandler` ב-App.tsx משתיק באנר לצ'אט שכבר פתוח (`isActiveChatNotification`) |
| **סנכרון טיימר שקט** (`type:'timerSync'`) | `onGameTimerChanged` ב-index.ts | שינוי פרימיטיב טיימר ב-`liveMatch` או מעבר ל-finished/cancelled | משתתפי המשחק, **אנדרואיד בלבד** (`platform==='android'`) | data-only שקט; מתקבל בקוד נייטיב (`TeamderMessagingService`) לעדכון ווידג'ט הבית + Tile של השעון; נושא `serverNowMs` (עוגן שעון), `updatedAtMs` (סדר), `gameEnded` לניקוי |
| **קמפיינים אדמין→משתמשים** (`type:'adminBroadcast'`) | `adminUserPush.ts` (`processCampaign` מ-onCampaignCreated + sweep כל 5 דק') | Pulse כותב מסמך `campaigns/{id}` | סגמנטציה בזמן שליחה (SegmentFilters: עיר/פלטפורמה/משחקים/קבוצה/ימי-אי-פעילות…), תקרה 20,000, **פוש-ברודקאסט אחד לכל משתמש ב-24 שעות** (`lastBroadcastAt`), עד 6 ניסיונות claim | הקשה: App.tsx מדווח מטריקת `open` (`trackCampaignEvent`) — **אין ניווט** (default ב-navigateForPush). קמפיינים מסוג popup נקראים ישירות באפליקציה (`CampaignGate`) עם ניווט כפתורים דרך `navigateCampaign` (openGame/openCommunity/openProfile/openScreen/openUrl עם allowlist סכימות) |
| **התראות מייסד (Pulse)** | `adminPush.ts` `pushToAdmins` | `onNewUserJoined` (כולל ייחוס "הוזמן ע"י X / דרך קישור Y" אחרי polling של עד ~14 שניות), `onGameCreatedAlert`, `onGameJoinedAlert`, `onCommunityCreatedAlert`, `onCommunityJoinedAlert`, `onAvailabilityUpdated`, `onErrorLogged`, `onFeedbackSubmitted`, `runReviewAlerts` (polling ביקורות App Store/Play כל 15 דק' עם JWT) | טוקנים ב-`adminConfig/push.tokens` | מתגי-סוג ב-`adminConfig/prefs`; throttle 20 שניות פר-סוג (`adminPushLatches`) |

---

## 4. מפת דיפ-לינקים

### סכימות ודומיינים
- **סכימות מותאמות** (`app.json → scheme`): `footy` (מקורית, בכל build ששוחרר — דף הנחיתה משתמש בה), `teamder`, `com.studiogameslime.soccerapp`.
- **דומיין hosting**: `https://teamderfc.web.app` (וגם `teamderfc.firebaseapp.com`; `teamder.web.app`/`firebaseapp.com` נשמרים לפרסינג בלבד — הדומיין תפוס ע"י פרויקט אחר).
- **Android App Links** (`intentFilters`, autoVerify): רק `/session`, `/team`, `/app`. ⚠️ **אין** verified links ל-`/i/**`, `/go`, `/c/**` — אלה נפתחים בדפדפן ומגיעים לאפליקציה דרך redirect ל-`footy://` / intent:// בדף הנחיתה.
- **iOS**: `associatedDomains: ["applinks:teamderfc.web.app"]` מוגדר ב-app.json, אך לפי הערות בקוד/ידע הפרויקט Universal Links לא פעילים בפועל (entitlement חסר בפרופיל build מקומי) — הנתיב בפועל ב-iOS הוא clipboard.

### נתיבי URL (firebase.json rewrites)
| נתיב | טיפול |
|---|---|
| `/session/**`, `/app`, `/go` | סטטי → `invite.html` |
| `/team/**`, `/c/**` | CF `serveCommunityPage` — SSR שמזריק OG tags (שם קהילה, תיאור, תמונת קאבר מ-showcase) ל-invite.html (ל-/team) או לדף הצגת מועדון (ל-/c); cache 5/10 דק' |
| `/i/**` | CF `serveInviteCode` — פותר `inviteLinks/{code}` → מזריק `window.__INVITE__={type,id,invitedBy}` + OG, מונה קליקים על המסמך (`clicks`, `lastClickAt`); alias טהור בלי redirect |
| `/track-click` | CF `trackLinkClick` — beacon ספירת קליקים: `adLinks/{l}.clicks`, `linkClicks/{s}`, `inviteClicks/{inviter}` |

### פרסינג בלקוח (`parseInviteUrl`)
- צורות נתמכות: `teamder://session/<id>`, `teamder://team/<id>`, `footy://…`, `https://<host>/session|team/<id>`, גנרי `…/app`|`/go` (± `?g=<gameId>` לדיפ-לינק למשחק מתוך לינק רכישה).
- פרמטרים: `invitedBy` (ייחוס מזמין), `b` (source מקודד base64url — מפוענח ב-decoder עצמי כי ל-Hermes אין atob), `s`/`utm_source`, `c`/`utm_campaign`, `l` (linkId פר-קישור), `g` (יעד משחק).
- **במכוון לא משתמשים ב-`linking` של React Navigation** — עץ הניווט תלוי-auth; במקום זה: stash ב-storage + consumer.

### צנרת צריכת לינק (App.tsx + RootNavigator)
1. **Cold start**: `Linking.getInitialURL()` → stash (`stashPendingInvite`, set-once); RootNavigator צורך את ה-stash פעם אחת אחרי auth+onboarding (`consumedRef`) → `navigateInvite`.
2. **Warm**: `Linking.addEventListener('url')` → ניווט ישיר אם navigator+auth מוכנים, אחרת `pendingLink` בזיכרון (last-write-wins) + stash, עם effect שצורך ברגע שהכול מוכן. דדופ URL זהה בחלון 3 שניות.
3. **אין URL**: אנדרואיד → Play Install Referrer; iOS → clipboard (סעיף 6).
4. פתיחה מלינק/פוש מסמנת `adsService.noteIntentfulOpen()` — מדלגת על מודעת app-open.

### `navigateInvite`
- `session/<id>` → GameTab›MatchDetails (`initial:false` — GamesList נשאר מתחת כיעד back).
- `team/<id>` → חבר: CommunityDetails; לא-חבר: CommunityDetailsPublic (קורא `groupsPublic`, בטוח להרשאות).

---

## 5. זרימת הזמנה/ייחוס (attribution) צעד-אחר-צעד

1. **שיתוף**: 4 מסכי כניסה — MatchDetails (שתף משחק, `type:'session'`), CommunityDetails (שתף קהילה, `type:'team'`), ProfileScreen + FriendsScreen ("צרף חברים", `type:'app'` גנרי). כולם: `createShortInviteUrl` כותב `inviteLinks/{code}` (7 תווי base62) ומחזיר `https://teamderfc.web.app/i/<code>?invitedBy=<uid>` (ה-invitedBy גם ב-URL כגיבוי אם ה-CF לא מזריק); fallback ללינק הארוך אם הכתיבה נכשלה. שיתוף דרך `Share.share` של המערכת; קיים גם `shareToWhatsApp` (סכימת `whatsapp://` → wa.me) ו-`openWhatsApp` לאיש קשר קהילה (נרמול טלפון ישראלי).
2. **דף הנחיתה** (`public/invite.html`, RTL): קורא `window.__INVITE__` (מלינק קצר) או את ה-path; שולח beacon ל-`/track-click`; משנה כותרת ("הוזמנת למשחק/לקבוצה ב־Teamder") ללינקים אישיים; שומר `pendingInvite` ב-localStorage.
3. **Redirect**: לינק אישי (session/team) במובייל — אוטומטי: אנדרואיד-Chrome דרך `intent://…scheme=footy…browser_fallback_url=<Play+referrer>`; אנדרואיד אחר ישירות ל-Play. לינק רכישה (`app`/`go`) **לא** עושה redirect — מציג את דף השיווק. iOS לעולם לא אוטומטי (כתיבת clipboard דורשת מחוות משתמש).
4. **אנדרואיד — Install Referrer**: כפתור ההתקנה נושא `&referrer=invite_<type>_<id>[_by_<uid>]` או `utm_source=…&utm_campaign=…&g=…&l=…`. בהפעלה ראשונה `installReferrerService` (Android בלבד, latch `consumed`) מפרסר את שתי הצורות + צורת UTM ו-stash-ים PendingInvite.
5. **iOS — Clipboard**: הקשה על "הורד" מעתיקה את ה-URL המלא ל-clipboard; בהפעלה ראשונה `clipboardInviteService` (kill-switch ב-Remote Config `feature_ios_clipboard_invite`, latch חד-פעמי, `hasUrlAsync` כדי לא להקפיץ prompt לחינם) מפרסר ומנקה את ה-clipboard.
6. **כתיבת הייחוס**: `applyInviteAttributionIfFresh` ב-userService — ביצירת משתמש טרי בלבד: `invitedBy`, `invitedByType`, `invitedByTargetId` (או 'app'), `invitedAt` (serverTimestamp). set-once, self-invite נחסם. בנפרד `applyAcquisitionIfFresh` כותב `acquisition{source,campaign,linkId}`.
7. **דיווח**: `onNewUserJoined` שולח למייסד פוש "משתמש חדש" עם "הוזמן ע"י {שם}" / "דרך קישור {שם לינק}"; ספירת מוזמנים פר-משתמש ב-query על `invitedBy` (userService).

---

## 6. פערים, קוד מת, פיצ'רים חבויים

1. **`rateReminder` — פיצ'ר מת-למחצה**: המתג במסך ההגדרות, הטקסט ב-buildMessage, ה-routing וה-cooldown קיימים, אבל השולח `runSendRateReminders` הוא no-op מפורש. המתג באפליקציה מטעה.
2. **אין inbox התראות באפליקציה**: `notificationsService.markRead` קיים אך **אינו נקרא מאף מסך** — קוד מת. משמעות מעשית: `read` לעולם לא מתעדכן, ולכן ב-`gameCanceledOrUpdated` (strict-unread) נמען יקבל לכל היותר פוש "המשחק עודכן" אחד ל-7 ימים פר-משחק (עד ה-TTL/מחיקת dailyCleanup), גם אם היו עדכונים אמיתיים נוספים.
3. **`adminBroadcast` ללא ניווט**: הקשה על פוש קמפיין רק רושמת מטריקת open ונופלת ל-default (אין case ב-navigateForPush) — המשתמש נוחת על המסך האחרון/בית גם אם ה-data של הקמפיין מכיל action.
4. **handler ללא כפתור — `DISMISS_NEW_GAME`**: App.tsx מטפל בפעולה זו, אבל הקטגוריה `NEW_GAME_RSVP` רושמת רק את `JOIN_GAME` (כפתור "לא מגיע" הוסר) — ענף מת. גם `CANCEL_GAME` מטופל רק ללגסי ("retired").
5. **מתגים חסרים במסך ההגדרות**: `spotOffered` ו-`friendRequest` קיימים כמפתחות prefs ונבדקים ב-deliverBatch, אבל אין להם שורה ב-UI (רק 15 שורות). סוגים בלי מפתח pref כלל (לא ניתנים להשתקה): `addedToGame`, `teamsGenerated`, `eveningSummary`, `promotePrompt`, `groupInvitation`, `guestPromoted` (לצ'אט יש mute פר-שיחה; לפילר opt-in נפרד).
6. **`teamsGenerated` עוקף את `createNotificationOnce`**: נכתב ב-batch ישיר עם doc-id ידני — לא עובר את מסלול ה-strict-dedup/entity הרגיל (מוגן ב-latch `teamsNotifiedAt` בלבד), חריג יחיד בצינור.
7. **App Links חלקיים**: לינקים קצרים `/i/<code>` — פורמט השיתוף העיקרי כיום — אינם ב-intentFilters של אנדרואיד ולא נפתחים ישירות באפליקציה מותקנת; תלויים ב-redirect בדפדפן. iOS Universal Links מוגדרים ב-app.json אך לא פעילים בפועל.
8. **הערת iOS על טוקנים**: `registerDeviceToken` שומר את מה ש-`getDevicePushTokenAsync` מחזיר; ההערה בקוד עצמו מציינת שב-iOS זה טוקן APNs גולמי ו"הצרכן יצטרך להמיר... אם אי-פעם תכוון ל-iOS" — הערה שלא עודכנה למרות ש-iOS בפרודקשן (ראוי לוודא שהמסירה ל-iOS אכן עובדת דרך ה-FCM SDK).
9. **דגלים/מצבים זמניים**: `ENFORCE_APP_CHECK=false` על כל ה-callables (השבתה זמנית בגלל iOS App Attest — מסומן RE-ENABLE); kill-switch מרוחק `feature_ios_clipboard_invite`; mock-mode מדמה dispatch-ים בזיכרון (`__getMockDispatches`).
10. **הערת-תיעוד שקרית בלקוח**: הכותרת של `notificationsService.ts` טוענת "The Cloud Function is NOT in this repo" — ה-CF כן ברפו (`functions/src/index.ts`); תיעוד ישן.
11. **דומיינים רדומים בפרסינג**: `teamder.web.app`/`teamder.firebaseapp.com` נתמכים בפרסינג בלבד ואינם ניתנים להגשה (הדומיין שייך לפרויקט אחר) — לגסי מכוון.


# 8. אפליקציית השעון והווידג׳טים

# ‏Wear OS + ווידג'טים + פלאגינים נייטיביים — מיפוי מלא

## 1. ארכיטקטורה כללית

- **מקור אמת אחד לכל המשטחים:** ה־JS ‏(`src/services/watchSyncService.ts`) מחשב payload JSON יחיד (`WatchPayload`) ומפיץ אותו דרך מודול נייטיבי `WatchBridge` לשלושה משטחים: אפליקציית השעון (Wear OS), ה־Tile של השעון, ושני ווידג'טים במסך הבית של הטלפון. ב־iOS אותו JSON נשלח ל־Apple Watch דרך WatchConnectivity.
- **`plugins/withWearApp.js` (config plugin של Expo):** מכיוון ש־`android/` ב־gitignore ומתחדש בכל prebuild, קוד ה־Kotlin חי ב־`plugins/wear-src/` והפלאגין מעתיק אותו פנימה בכל prebuild: מודול `wear` (אפליקציית השעון, application נפרד), `watch` (גשר בצד הטלפון), `widget` (Kotlin + משאבי res). בנוסף: מוסיף `include ':wear'` ל־settings.gradle; מוסיף תלויות `play-services-wearable`, `firebase-firestore`, `firebase-auth`, `firebase-messaging` ל־app (נדרשות ל־compile classpath של הקוד הנייטיבי); רושם את `WatchBridgePackage` ב־MainApplication; ורושם ב־AndroidManifest של הטלפון: שני receivers של ווידג'טים, `TimerActionReceiver` (exported=false), ‏`PlayersRemoteViewsService`, ‏`WearTimerCommandService` (מאזין להודעות מהשעון בנתיב `/teamder/timer-command`), ו־`TeamderMessagingService` כשירות FCM בעדיפות 0 (גובר על expo-notifications שבעדיפות ‎-1). הכול אידמפוטנטי.
- **`wear/build.gradle`:** מודול נייטיבי טהור (Kotlin + Compose for Wear OS), **אותו applicationId** כמו הטלפון (`com.studiogameslime.soccerapp`) — כך Play מתייחס אליו כגרסת השעון של אותה אפליקציה (multi-APK). ‏minSdk 30 (Wear OS 3, ‏Galaxy Watch 4+), טווח versionCode נפרד וגבוה (כרגע **1027, גרסה 1.0.30**) — יש להעלות ידנית בכל build. חתימת release נמשכת מ־`credentials.json` של EAS רק כשמוגדר `EAS_BUILD_WORKINGDIR` (בילד מקומי debug רגיל לא קורס).

## 2. אפליקציית השעון (Wear OS)

קבצים: `MainActivity.kt`, ‏`ui/WearScreens.kt`, ‏`model/WearGameState.kt` + `WearStatePayload.kt`, ‏`data/WearStateRepository.kt` + `WearCommandSender.kt`.

### 2.1 מצבים (WearGameState) — מה השעון מציג
| מצב | תצוגה |
|---|---|
| `Loading` | לוגו + ספינר + "טוען…" |
| `Disconnected` | "פתח את האפליקציה בטלפון כדי לראות את המשחקים שלך" — כשאין פריט Data Layer (לא מזווג / אף פעם לא פורסם / נמחק בהתנתקות) |
| `Live` | סטופר גדול (mm:ss, מתעדכן כל 250ms) + כותרת המשחק + "המשחק רץ"/"מושהה" + שורת כפתורי שליטה (רק ל־`canControl`) |
| `Upcoming` | כרטיס "המשחק הקרוב": כותרת, מתי (dd/MM HH:mm), מגרש, עיר, וצ'יפ "רשימת שחקנים (x/y)" שנפתח ל־drill-down |
| `Upcoming → PlayersScreen` | רשימת שחקנים נגללת: אווטאר (תמונה דרך Coil, אחרת אות ראשונה על כחול מותג), שם, תגית תפקיד ("מנהל" כחול / "אורח" אפור; חבר רגיל בלי תגית) + כפתור "חזרה" |
| `Scheduled` | "‎{כותרת}\nיפתח להרשמה ב־d.M HH:mm" (registrationOpensAt) |
| `NotRegistered` | "עדיין לא נרשמת למשחק" + צ'יפ "צור משחק מהטלפון" |

- **"צור משחק מהטלפון"** — פותח דרך `RemoteActivityHelper` את הדיפ־לינק `teamder://create` בטלפון המזווג (best-effort, כשל נבלע).
- **עיצוב:** רקע **שחור חובה** (Google דחתה build עם רקע לבן — vc1004 — פעמיים); כחול־שמיים ‎#60A5FA לטיימר/הדגשות, כחול־מותג ‎#1E40AF למילויי צ'יפים, טקסט slate-200. כל האפליקציה RTL‏ (`LocalLayoutDirection = Rtl`). מסכים נגללים = `ScalingLazyColumn` עם `PositionIndicator` ו־Vignette (דרישות Wear App Quality). לוגו "נושם" (פולס 1.07×) בראש רוב המסכים; במסך הסטופר הוסר בכוונה כדי שהכפתורים לא ייחתכו.

### 2.2 שליטה בטיימר מהשעון
- שורת כפתורים עגולים (48dp) המשקפת את לוגיקת הווידג'ט: רץ → [השהה][אפס]; מושהה עם זמן → [הפעל][אפס]; טרם התחיל → [הפעל].
- **איפוס הוא הרסני** (מאפס שעון + תוצאת/שערי הסיבוב; הסיכום הערבי שורד) ולכן **אישור דו־שלבי**: לחיצה ראשונה "חומשת" (הכפתור הופך אדום, "לאפס?") ל־3 שניות; לחיצה שנייה בתוך החלון מבצעת.
- הכפתורים מוצגים **רק כש־`canControl=true`** — שמחושב בטלפון כ־**יוצר המשחק בלבד** (`live.createdBy === viewer.id`; מנהלי־קהילה שותפים לא שולטים מהשעון — מגבלה מתועדת בקוד).
- כל לחיצה שולחת דרך `WearCommandSender` הודעת MessageClient לנתיב `/teamder/timer-command` בפורמט `"<action>|<gameId>"` לכל node מחובר. **Fire-and-forget**: אם הטלפון לא זמין — ההודעה נזרקת ונרשמת ללוג בלבד; אין ניסיון חוזר.
- אייקון Pause מצויר ידנית (ImageVector) כדי לא לגרור את material-icons-extended.

### 2.3 קליטת מצב בשעון (`WearStateRepository`)
- מאזין ל־DataItem בנתיב `/teamder/state` (מפתחות `json` + `ts`). ‏DataItems **פרסיסטנטיים**, כך שבפתיחה קרה נמשך הערך האחרון גם אם הטלפון כבוי כרגע.
- מיגון race: דגל `sawChangeSinceStart` מונע מה־fetch של resume לדרוס Live טרי שהגיע בינתיים ב־onDataChanged; ‏TYPE_DELETED → `Disconnected`.
- **התיישנות (`parseWearStateFresh`):** payload‏ LIVE שגילו (לפי `ts` של הפרסום) מעל **3 שעות** מתורגם ל־`Disconnected` — מונע טיימר שסופר לנצח כשהטלפון מת באמצע משחק. רק LIVE מתיישן; upcoming/scheduled תקפים שעות.

### 2.4 חישוב הזמן (הפתרון לבאג "תקוע על 00:00")
- ה־payload נושא `baseElapsedMs` — הזמן שחלף **שהוקפא ברגע הפרסום**, בלי תלות בשעון של אף מכשיר. ה־parser מגלגל פנימה פעם אחת את הזמן שעבר מאז הפרסום (‏`wallClock + clockOffsetMs − serverNowMs`‏), ומצמיד עוגן מונוטוני `parseAnchorRealtimeMs = SystemClock.elapsedRealtime()`.
- בזמן ריצה: ‏`elapsed = baseElapsedMs + (elapsedRealtime() − anchor)` — חסין להסטת שעון־קיר בין השעון לטלפון. נתיב legacy (שחזור לפי `lastStartedAt` + ‏`clockOffsetMs`) נשמר לטלפונים ישנים שלא שולחים `baseElapsedMs`.
- ‏parse פגום → `Disconnected` (הגנתי — ה־Tile חייב תמיד לרנדר).

### 2.5 ‏Tile‏ (`TeamderTileService` + `TileUpdateListenerService`)
- Tile אדפטיבי (ProtoLayout — ‏Compose אסור ב־Tiles) הקורא סינכרונית את אותו DataItem: **live** → כותרת + טיימר + "● רץ"/"מושהה"; ברגע ריצה מוצגת **רזולוציית דקות בלבד** ("12׳") כי Tile מתרענן לכל היותר ~פעם בדקה, ובהשהיה mm:ss מדויק; **upcoming** → כותרת + זמן יחסי ("בעוד X דק׳/שע׳/ימים") + מגרש/עיר + "x/y שחקנים"; **scheduled** → "יפתח להרשמה ב־…"; אחרת placeholder‏ "אין משחק רשום". כל שטח ה־Tile לחיץ ופותח את אפליקציית השעון.
- ‏freshness: ‏60ש' בזמן live, ‏5 דק' idle (רשת ביטחון). `TileUpdateListenerService` (WearableListenerService על `/teamder/state`) דוחף רענון Tile מיידי בכל שינוי — כולל כשהאפליקציה סגורה — כך start/pause מהטלפון מופיע תוך שניות; מחיקת הפריט → רענון מיידי ל־placeholder.

### 2.6 ‏Ongoing Activity‏ (`LiveOngoingActivity`)
- בזמן משחק חי: נוטיפיקציה מתמשכת + אינדיקטור על פני־השעון + צ'יפ ב־recents (דרישת Wear App Quality — ‏Google דחתה את vc1023 על היעדרה). מבוסס נוטיפיקציה (לא foreground service — עוקף מגבלות Android 14).
- רץ → תבנית `StopwatchPart` שסופרת לבד מבסיס מונוטוני; מושהה → mm:ss סטטי. מנוהל מ־`TileUpdateListenerService`; נעלם כשהמצב אינו live, ובנוסף `setTimeoutAfter(3h)` — התאבדות עצמית אם הטלפון מת ולא מגיעים רענונים. ‏`MainActivity` מבקש פעם אחת הרשאת POST_NOTIFICATIONS ‏(Wear OS 4+).
- ‏SecurityException (אין הרשאה) נבלע — no-op.

### 2.7 מצבי דמו (debug בלבד)
ב־build הניתן לדיבוג בלבד, כשאין מצב אמיתי, טאפ על המסך מדפדף בין 5 מצבי דמו ("חמישי כדורגל" רץ/מושהה/upcoming עם 8 שחקני pravatar/scheduled/notRegistered) — לצילומי חנות. ב־release משתמש לא מזווג רואה את המסך האמיתי בלבד. **אין קומפליקציה (complication) בצד Wear OS** — קיימת רק ב־Apple Watch (סעיף 5); ה"קומפליקציה" של Wear היא בפועל ה־Tile.

הערה קטנה: הערת המניפסט "Reads the live-match doc + user games over the network" מיושנת — השעון אינו קורא Firestore בכלל (thin client); הרשאת INTERNET משמשת בפועל לטעינת תמונות שחקנים (Coil). הרשאת `AD_ID` מוצהרת רק לעקביות הצהרות Play (אין פרסומות בשעון).

## 3. סנכרון — שני הכיוונים, אפליקציה חיה ומתה

### 3.1 טלפון → שעון/ווידג'טים (אפליקציה חיה)
- `useWatchSync(userId)` (ממונטש ב־`App.tsx`): ‏onSnapshot על כל המשחקים החיים/הקרובים של המשתמש → בכל שינוי `publishWatchState`. בנוסף, בזמן live — פרסום מחדש כל 60ש' גם בלי שינוי (מרענן את offset השעון ואת חותמת ה־freshness שמזינה את גילוי "טלפון מת").
- `computeWatchPayload`: בוחר את המצב — live (משחק עם `liveMatch.phase !== 'finished'`) > המשחק העתידי הקרוב ביותר (scheduled אם ההרשמה טרם נפתחה, אחרת upcoming) > ‏notRegistered. פותר את הרוסטר מ־`/users` (שם+תמונה; יוצר='admin'; אורחים לא־waitlisted='guest'), ומצרף `viewer` (id+שם), `clockOffsetMs`, ‏`serverNowMs`, ‏`baseElapsedMs`, ‏`canControl`, ‏`controlledBy/Name`.
- מיגון out-of-order: מונה `publishSeq` (לא serverNowMs, שעלול לסגת אחרי תיקון offset) מפיל פרסום ישן שנוחת אחרי חדש. ‏`syncServerClock()` נכפה לפני פרסום ראשון. כשל = best-effort, לוג dev בלבד. ‏mock ו־builds ללא bridge — ‏no-op שקט.
- `WatchBridgeModule.kt` (צד טלפון): ‏`publishState(json)` כותב (1) ל־SharedPreferences ‏`TeamderWidgetState` + משדר APPWIDGET_UPDATE לשני הווידג'טים, (2) ל־Data Layer ‏`/teamder/state` עם timestamp‏ (`setUrgent`) — ה־ts מבטיח TYPE_CHANGED גם כשה־JSON זהה. ב־unmount/התנתקות מתפרסם payload ריק (notRegistered) כדי שלא יישאר משחק של חשבון קודם על השעון.

### 3.2 שעון → טלפון (פקודות טיימר)
שעון (`WearCommandSender`) → ‏MessageClient‏ `/teamder/timer-command` → בטלפון `WearTimerCommandService` (WearableListenerService, עובד גם כשהאפליקציה מתה) מתרגם ל־broadcast מפורש אל `TimerActionReceiver` — **בדיוק אותו מסלול של כפתורי הווידג'ט**, כך ששעון/ווידג'ט/אפליקציה מתכנסים למוטציה אחת. ‏gameId חסר משוחזר מה־payload השמור ב־prefs; שם המפעיל ("מופעל ע״י X") נקרא משם גם כן.

### 3.3 אפליקציה מתה — נתיב ה־FCM השקט
- ‏Cloud Function‏ `onGameTimerChanged` (‏`functions/src/index.ts`‏): על כל שינוי פרימיטיב טיימר ב־`games/{id}` **או** מעבר ל־finished/cancelled, שולח FCM‏ data-only שקט (`type:'timerSync'`) לכל המשתתפים **שפלטפורמתם 'android' בלבד**, עם כל שדות הטיימר + `serverNowMs` (עוגן שעון) + `updatedAtMs` (מפתח סדר מונוטוני) + `createdBy` + ‏`gameTitle` (בכוונה לא `title`/`body` — כדי שלקוחות ישנים לא יציגו נוטיפיקציה גלויה) + `gameEnded:'true'` בסיום.
- בטלפון `TeamderMessagingService` (יורש מ־ExpoFirebaseMessagingService; הודעות שאינן timerSync מועברות ל־super): ממזג ל־prefs (משמר roster/viewer/offset אם אותו משחק), **מחשב מחדש** `baseElapsedMs`/`serverNowMs` לרגע הקבלה (קריטי — בלי זה הטיימר קופץ קדימה), מחשב מחדש `canControl` מ־createdBy, מיישם מיגון out-of-order לפי `updatedAtMs` per-game, מרענן את שני הווידג'טים, **וממתין (Tasks.await, ‏5ש')** לכתיבת ה־Data Layer לשעון לפני שהתהליך נקצר. ‏`gameEnded` → מוריד את הכרטיס ל־notRegistered (רק אם זה אותו gameId — לא דורס משחק חי אחר).

## 4. ווידג'טים במסך הבית (Android)

### 4.1 ווידג'ט הטיימר (`TeamderWidgetProvider`, ‏3×2, ניתן למתיחה)
- **live:** כותרת + **Chronometer** שמתקתק בעצמו בתהליך הלאנצ'ר (בסיס מתורגם ל־elapsedRealtime עם אותה נוסחת baseElapsedMs/fallback, עם clamp נגד ספירה לאחור) + "מופעל ע״י X" כשמנהל אחר נגע בטיימר + כפתורי play/pause/reset לפי מצב (רץ → השהה+אפס; מושהה עם זמן → הפעל+אפס; טרם התחיל → הפעל). **upcoming:** כותרת + זמן יחסי + מגרש/עיר + "x/y שחקנים". **scheduled:** "יפתח להרשמה ב־{תאריך}". אחרת: "אין משחק רשום".
- טאפ על אזורי הטקסט פותח את האפליקציה; בכוונה לא על ה־root (לאנצ'ר של Samsung One UI בולע קליקים על כפתורי־בן כשה־root לחיץ). `updatePeriodMillis=30min` כ־fallback בלבד — העדכונים נדחפים.

### 4.2 `TimerActionReceiver` — מוטציה נייטיבית של הטיימר
- כפתורי הווידג'ט (ופקודות השעון) כותבים **ישירות ל־Firestore מ־Kotlin**, ללא JS, בטרנזקציה על `games/{id}.liveMatch`, בשיקוף מדויק של `gameService.startTimer/pauseTimer/resetTimer`: ‏start/resume כותב `timerEvents` ("start" רק בראשון); ‏pause מוסיף את חלון הריצה ל־`activeIntervals` (בסיס לקריאת הבריאות!); ‏reset סוגר interval פתוח, מאפס שעון + `scoreA/scoreB` + `goals` (לא נוגע ב־goalTally וב־activeIntervals). כל פעולה חותמת `timerControlledBy/Name`.
- **חותמת זמן הטאפ** (שעון מקומי + `clockOffsetMs` מה־prefs) נלקחת לפני ההמתנה — כך הזמן הרשום תואם למה שהמשתמש ראה.
- **תהליך קר:** ‏goAsync + המתנה עד **8 שניות** לשחזור FirebaseAuth מהדיסק; אם לא שוחזר — Toast‏ "התחברו לאפליקציה כדי לשלוט בטיימר". טרנזקציה no-op (משחק הסתיים / אידמפוטנטי) → "לא ניתן לעדכן את הטיימר כרגע"; כשל (בד"כ כללי Firestore — לא מנהל) → "פעולת הטיימר נכשלה — רק מנהל המשחק יכול לשלוט". אף טאפ אינו no-op שקט.
- אחרי הצלחה: עדכון אופטימי של ה־prefs (כולל re-stamp של baseElapsedMs/serverNowMs **גם ב־root וגם בתוך timer** — הווידג'ט והשעון קוראים ממקומות שונים), רענון ווידג'ט, ופרסום ל־Data Layer של השעון — עם השארת חלון ה־goAsync פתוח עד שהכתיבה נשטפה.

### 4.3 ווידג'ט השחקנים (`TeamderPlayersWidgetProvider` + `PlayersRemoteViewsService`, ‏3×3)
- רוסטר נגלל של המשחק הקרוב **וגם בזמן live** (אותם שדות). כותרת + מונה x/y + תת־כותרת "זמן יחסי · מקום"; שורת שחקן = שם + תגית "מנהל"/"אורח". ‏scheduled → "יפתח להרשמה ב…"; אחרת "אין משחק קרוב". ‏ListView דרך RemoteViewsService (קורא את אותם prefs); טאפ בכל מקום פותח את האפליקציה. **אין תמונות שחקנים בווידג'ט** (שם+תגית בלבד, בשונה מהשעון).

## 5. ‏Apple Watch (iOS) — `targets/` + `modules/watch-bridge`

- **גשר iOS** (`modules/watch-bridge`, ‏Expo module, ‏iOS בלבד): ‏`publishState(json)` שולח דרך WCSession גם `updateApplicationContext` (latest-wins, נמסר כשהשעון מתעורר) וגם `sendMessage` מיידי כשה־watch reachable; ‏`isWatchPaired()` — true רק כששעון מזווג **עם האפליקציה מותקנת**; ‏`useWatchSync` מדלג על מאזין ה־Firestore ב־iOS בלי שעון (חוסך קריאות), עם polling כל 60ש' שמזהה זיווג באמצע session.
- **אפליקציית watchOS** (`targets/watch`, ‏SwiftUI, מוזרקת ב־prebuild ע"י `@bacons/apple-targets`, ‏bundle id ‏`…​.watchkitapp`, ‏watchOS 9.4): שלושה מסכים — `TimerView` (סטופר, אותה נוסחת baseElapsedMs + uptime מונוטוני, כולל "מנוהל ע״י X"), ‏`NextGameView` ‏(upcoming/scheduled: כותרת, "EEEE HH:mm" בעברית, מגרש, מונה, רשימת שמות), ‏EmptyState‏ ("אין משחק קרוב / פתח את Teamder בטלפון"). **פערים מול Wear:** אין שליטה בטיימר מהשעון, אין תמונות/תגיות ברוסטר, אין התיישנות 3h, אין Ongoing/Tile.
- **קומפליקציה** (`targets/complication`, ‏WidgetKit): ‏v1 = **לאנצ'ר סטטי בלבד** (כדורגל שפותח את האפליקציה; accessoryCircular/Inline/Rectangular). מידע חי דורש App Group — מתועד כאיטרציה הבאה. **חצי־גמור בכוונה.**
- ⚠️ לפי הערת הקונפיג, ה־bundle ids של השעון והקומפליקציה חייבים provisioning בפורטל של Apple + בפרופיל `production-ios-local` — אותה משפחת חסמים כמו Associated Domains; כלומר ייתכן שה־target לא נכלל בפועל ב־build החנות עד שיוסדר.

## 6. ‏Health Connect‏ (`plugins/withHealth.js` + ‏JS)

- **הפלאגין** (רשום ב־app.json יחד עם `react-native-health-connect`): מוסיף למניפסט הרשאות READ בלבד — **Steps, Distance, ActiveCalories, TotalCalories, Speed** — ו־`<queries>` לחבילת Health Connect. **בכוונה בלי** READ_HEART_RATE (הוסר 14.7 בגלל מדיניות ה"essential" של Google), בלי ExerciseSession/ExerciseRoute (חימום ה־GPS heatmap בוטל). צד iOS ‏(`withHealthIos` — ‏HealthKit entitlement + מחרוזות usage בעברית) **כתוב אך לא מחובר** — מחכה ל־capability בפרופיל; קוד רדום.
- **`healthService.ts`:** קורא מ־Health Connect (ה"תיבת דואר" שכל צמיד/שעון — ‏Samsung/Garmin/Fitbit/Xiaomi/Wear — מסנכרן אליה; **לא** חיישני הטלפון). `HEALTH_ENABLED=true`. ‏`ensurePermissions` מציג את גיליון ההרשאות לכל היותר פעם אחת (דגל declined ב־AsyncStorage; ‏`forcePrompt` עוקף בחיבור ידני). נגזרות: מרחק, צעדים, קלוריות (Active עם fallback ל־Total), מהירות שיא/ממוצעת, ספירת ספרינטים לפי rising-edge‏ (≥5.3 m/s), סינון דגימות לא סבירות (>12 m/s). שדות דופק/zones/effort **קיימים אך מאופסים** (תאימות טיפוסים) — קוד חצי־רדום עד שדופק יוחזר. ‏iOS מחזיר null — הפאנל הפיזי פשוט לא מוצג.
- **`physicalSyncService.ts`:** אחרי משחק **שהסתיים בלבד** — קורא את חלונות `liveMatch.activeIntervals` (הדקות שבהן הטיימר רץ, כולל אלו שנרשמו מהווידג'ט/שעון), ממיר מזמן שרת למקומי, קוצץ ל־4 שעות מקס', מאחד חפיפות, וקורא דרך `readSessionMulti` — קריאה אחת על כל הטווח עם **clipping לפי חפיפה** (מונע ספירה כפולה של רשומה שחוצה הפסקה). ‏fallback לחלון המשחק כולו כשאין intervals. מעלה דרך callable ‏`saveGamePhysical`. מופעל ממסך `EveningSummaryScreen`. ‏no-op בטוח ב־mock/ללא binding.

## 7. פערים, קוד רדום ומגבלות ידועות (סיכום)

1. **שליטה מהשעון = יוצר המשחק בלבד** (`canControl: live.createdBy === viewer.id`) — מנהלי קהילה שותפים לא רואים כפתורים בשעון (מתועד כבחירה שמרנית).
2. **קומפליקציית Apple Watch** — לאנצ'ר סטטי; מידע חי דורש App Group (לא נבנה). **Apple Watch כולו ללא שליטה בטיימר** (מראה בלבד), וייתכן שאינו משוחרר בפועל (provisioning).
3. **`withHealthIos` — קוד מת כרגע** (מוגדר, לא נקרא); ‏HealthKit ל־iOS נדחה במפורש.
4. **דופק/hrZones/effortScore — שדות מאופסים** בכל הצנרת מאז הסרת READ_HEART_RATE; הערת קוד מציינת שה־effort יבוסס מחדש על מדדי תנועה.
5. **מצבי דמו בשעון** — debug בלבד (טאפ מדפדף); ב־release כבויים.
6. הערת מניפסט השעון על קריאת Firestore — מיושנת (אין קריאה ישירה).
7. ‏Tile בזמן ריצה מציג דקות בלבד (מגבלת ריענון של Wear OS) — שניות מדויקות רק באפליקציית השעון.
8. ‏FCM‏ timerSync נשלח **רק למשתמשי Android** ורק למי ש־`platform==='android'` הוחתם — משתמש ללא platform לא יקבל רענון-כשמת.
9. שכבות הגנה מרובות מפני "טלפון מת": התיישנות LIVE ‏3h בפרסר, ‏`setTimeoutAfter(3h)` ל־Ongoing, ‏freshness ‏5 דק' ל־Tile idle, פרסום־חוזר כל 60ש' מה־JS.

**קבצים מרכזיים:** `/Users/matan/Projects/soccer/plugins/withWearApp.js`, ‏`/Users/matan/Projects/soccer/plugins/withHealth.js`, ‏`/Users/matan/Projects/soccer/plugins/wear-src/{wear,watch,widget}/…`, ‏`/Users/matan/Projects/soccer/modules/watch-bridge/`, ‏`/Users/matan/Projects/soccer/targets/{watch,complication}/`, ‏`/Users/matan/Projects/soccer/src/services/{watchSyncService,healthService,physicalSyncService}.ts`, ‏`/Users/matan/Projects/soccer/functions/src/index.ts` ‏(onGameTimerChanged, ‏שורה ~3852).


# 9. מערכת העיצוב, i18n ו-RTL

All research complete. Here is the Hebrew inventory:

---

# מערכת ה-UI, עיצוב, i18n ו-RTL — מיפוי מלא

## 1. שכבת העיצוב (Design Tokens) — `src/theme/`

| קובץ | תפקיד |
|---|---|
| `colors.ts` | פלטה שטוחה (`colors.primary` וכו'). המותג הוחלף מירוק לכחול (`#1E40AF`); ירוק נשמר סמנטית ל-success, מגרש (`field*`), כפפות שוער ו-team3. **קיימת פלטת Dark מלאה (`darkPalette`) אך היא כבויה בכוח**: `isDarkTheme=false` קשיח, `Appearance.getColorScheme` לא נקרא — קוד "רדום" שמור לעתיד. אין החלפת ערכת נושא חיה |
| `spacing.ts` | סולם ריווח קשיח של 8 נקודות (`xs=4` עד `xxxxl=48`), רדיוסים (`sm=8`…`pill=999`), ושלושה טוקני צל: `card` / `raised` / `hero` |
| `typography.ts` | 9 סגנונות (h1–h3, body, bodyBold, caption, label, button, number). פונטים של המערכת (SF/Roboto) — אין פונט עברי מותאם |
| `rtl.ts` | הקבוע `RTL_LABEL_ALIGN = 'left'` — הפתרון הקנוני ליישור לימין ויזואלי תחת `forceRTL` (שם 'right' מתפרש כ"סוף פסקה" = שמאל ויזואלי). בשימוש ב-**115 קבצים** |
| `index.ts` | Barrel שמייצא הכול |

## 2. אתחול RTL גלובלי — `App.tsx` (שורות 192–234)

- `I18nManager.allowRTL(true)` + `forceRTL(true)` בטעינת המודול (דורש reload ראשון ב-Expo Go).
- **Patch גלובלי על defaultProps** של `Text` ו-`TextInput`: כל טקסט באפליקציה מתחיל עם `textAlign:'right'` + `writingDirection:'rtl'` כברירת מחדל.
- **מתח בין שתי קונבנציות**: `rtl.ts` מזהיר במפורש "אל תשתמשו ב-`writingDirection:'rtl'` על תוויות — זה מפעיל את אותו swap פעמיים", בעוד ברירת המחדל הגלובלית ב-`App.tsx` עושה בדיוק את זה. בפועל 115 קבצים דורסים עם `RTL_LABEL_ALIGN` — שני המנגנונים חיים זה לצד זה.

## 3. i18n — `src/i18n/he.ts`

- קובץ יחיד, **1,986 מפתחות**, עברית בלבד. אין ספריית i18n — גישה סטטית `he.key` בלבד (אין גישה דינמית `he[...]`, אין destructuring). 137 קבצים מייבאים.
- **587 מפתחות יתומים (~30%!) שאינם בשימוש בשום מקום** — שרידים של פיצ'רים שנמחקו/עוצבו מחדש. אשכולות בולטים:
  - `rating*` / `ratePlayers*` (19+5) — דירוג העמיתים 1–5 שנמחק ב-24.6.
  - `wizardHasReferee/HasPenalties/HasHalfTime` ועוד `wizard*` (26) — הוחלפו ב-RuleTagsInput.
  - `rotation*` (15) — מסך הרוטציה הישן (המפרט הוחלף — לייב = טיימר בלבד).
  - `profile*` (33), `pairStats*` (13), `stats*`/`stat*` (15) — עיצוב הפרופיל הישן ומסך ה-head-to-head שהוסר.
  - `groups*`/`group*` (24) — עידן השמות "קבוצות" לפני המעבר ל"מועדונים".
  - `discipline*` (20) — כרטיסי צהוב/אדום הישנים שהוחלפו ב-TrustMeter/IssueCardSheet.
  - וכן `createGame*` (25), `availability*` (23), `communityDetails*` (20) — גרסאות קודמות של מסכים חיים.
- **מומלץ לסמן במפרט: נדרש ניקוי** — שליש מהקובץ מת.

## 4. רכיבי הבסיס (root של `src/components/`)

הרכיבים הנפוצים ביותר (מספר קבצים מייבאים בסוגריים):

- **`ScreenHeader` (38)** — כותרת מסך סטנדרטית: חזרה + כותרת + `actions[]` (עם badge). כולל prop ישן `rightIcon` המסומן `@deprecated`.
- **`AppDialog` (36)** — תחליף גלובלי ל-`Alert.alert` בסגנון האפליקציה (API אימפרטיבי `appAlert(...)`).
- **`Button` (35)** — 7 וריאנטים (primary/secondary/outline/danger/team1/team2/success), 3 גדלים, אייקונים, loading.
- **`Toast` (32)** — טוסט גלובלי אימפרטיבי (`toast.success/error/info`), Host יחיד בשורש, ללא תלות חיצונית.
- **`UserAvatar` (28)** — רכיב תמונת הפרופיל המאוחד: תמונה → אווטאר נבחר → אווטאר דטרמיניסטי מ-id. החליף את שכבת ה"חולצה" (Jersey).
- **`SoccerBallLoader` (25)** — תחליף ל-ActivityIndicator עם כדורגל מסתובב (Reanimated, UI-thread).
- **`Card` (23)** — כרטיס לבן בסיסי עם tint אופציונלי.
- **`SpringSheet` (12)** — עטיפת bottom-sheet עם כניסת spring; הבסיס לכל הגיליונות.
- **`BallSwitch` (11)** — Switch שממותג ככדור "מתגלגל".
- **`PressableScale` (9)** — Pressable עם scale 0.96 (Reanimated). הערת קוד "load-bearing": ה-Pressable חייב להיות האלמנט החיצוני; ידועה מלכודת "row-stacking" (ילדים חייבים עטיפת View פנימי flex-row).
- **`EmptyState` (9)** — בלוק "אין כאן כלום" אחוד (איקון בעיגול + כותרת + CTA), החליף ~20 מימושים ידניים.
- **`PlayerIdentity` (8)** — משטח הזהות היחיד של שחקן (אווטאר+שם) בכל המסכים.
- **`InputField` (6)** — שדה טופס סטנדרטי: pill אפור, איקון בימין (RTL).
- **`Avatar` (6)** — רכיב אווטאר ישן יותר (avatarId/uri + טבעת "נושמת"); עדיין חי ב-6 מקומות (RequestsScreen, FriendsScreen, ReferralsList, PlayerCompareCard, FillerInterestsSection, FriendsInvitePicker) — **כפילות מול UserAvatar**.
- **`InfoTip` (5)** — ⓘ עם popover מעוגן (חץ מצביע על האייקון).
- **`ConfirmDialog` / `ConfirmDestructiveModal` (3/4)** — אישור רגיל / אישור הרסני עם checkbox "אני מבין" שמונע double-tap.
- **`AchievementBadge` (4) + `AchievementCelebration` (3)** — מדליית תואר (ברונזה/כסף/זהב) + מסך חגיגה מלא (sunburst, גלי הדף, קונפטי) עם תור הישגים.
- **`TrustMeter` (3)** — קשת מעגלית 0–100 של אמינות + תווית עברית; החליף את זוג כרטיסי המשמעת.
- אחרים: `AutocompleteInput` (debounce + fallback הקלדה), `Badge` (pill סטטוס לפי tone), `Banner` (התראה חגיגית מלמעלה, API כמו Toast), `CollapsibleContent` ("קרא עוד" רק כשבאמת גולש), `DateTimeFields` (שדות תאריך/שעה + מודאל), `FormSectionHeader`, `StepIndicator` (כדור "מתגלגל" בין שלבי wizard; מודע-RTL עם `I18nManager.isRTL`), `RangeSlider` (סליידר PanResponder ללא native dep; **מסילה LTR מכוונת**), `GuestModal` (הוספת אורח + דירוג 1–5), `AdminRatingSheet` + `RatingSlider` (דירוג פנימי עשרוני 1.0–5.0), `RuleTagsInput` (צ'יפים חופשיים, תואם firestore.rules), `PlayerCountBar` (פס התקדמות "7/10"), `RequestsBell` (פעמון + ספירה, ניווט ל-Requests בכל stack), `CommunityFilterSheet`/`GameFilterSheet` (סינון feeds), `AvailabilityNudgeModal`, `RegistrationConflictModal`, `ErrorBoundary` (fallback עברי RTL), `SoccerBall` (SVG מוויקימדיה).

## 5. תיקיות המשנה — סיכום לפי דומיין

- **`anim/` (16)** — שפת האנימציה: `AnimatedTabIcon`, `AnimatedWeatherIcon` (גליף מזג-אוויר חי לפי קוד WMO), `AppearItem` (stagger לרשימות), `BouncingBall`, `Breathing` (pulse/bob), `CelebrationOverlay`+`ConfettiBurst`, `CountUp`, `LivingIcon`, `MatchCardSkeleton`+`Shimmer`, `PulseOnChange`, `RollInView` (אווטאר "מתגלגל" פנימה), `SpringSheet`. הערה: הרכיבים `RollAwayCta`/`ArcPopIn`/`MatchClockLoader` שמוזכרים בתיעוד ישן — כבר לא קיימים בקוד.
- **`availability/` (2)** — מפת רדיוס חיפוש (MapLibre + OpenFreeMap ללא מפתח API) + גרסת מודאל אינטראקטיבית.
- **`chat/` (3)** — `ChatView` (משטח הצ'אט המשותף לשני ה-scopes: משחק+מועדון), `ChatTermsModal` (שער תנאי-שימוש חובה — Apple 1.2 / Google UGC, "אפס סובלנות"), `ChatPitch` (רקע דשא + כרטיס אדום כאייקון מחיקה).
- **`community/` (18)** — כרטיסי הפיד והפרטים: `CommunityCard`, `CommunityStadiumHero`, `NextGameCard`, `CommunityStatsGrid/Table`, `CommunityChampionship`, `IssueCardSheet` (מתן כרטיס צהוב/אדום — אדמין), `ManageEquipmentSheet` (מי מחזיק כדור/חולצות — דגלים בלתי-תלויים), `CoverImagePicker`, `RichRulesInput/Text` (markdown-lite ללא תלות), `CardCountBadges` (צ'יפים של כרטיסים פעילים — אדמין בלבד).
- **`compare/`** — `PlayerCompareCard`: כרטיס "השווה אליי" הניתן לשיתוף (captureRef→PNG).
- **`draft/` (3)** — לוח הדראפט: `DraftOrderPath` ("מסלול הבחירה"), `DraftTeamCard`, `DraftScalePop` (עוקף באג "Unable to find viewState" של layout-animations).
- **`games/` (6)** — בורר מיקום (`LocationSearchSheet` — כל מיקום עם קואורדינטות אמיתיות ל-Waze/מסנן קרבה, `LocationPickerMap` וקטורי), מפות רדיוס לסינון, `FriendsInvitePicker` (מולטי-בחירת חברים → פוש `inviteToGame`).
- **`home/` (5)** — `AvailabilityCalendarCard` (heatmap "פנויים לשחק לידך" — ספירה בלבד, ללא זהויות; fail-soft), `AvailabilityPromptCard` (hero אקטיבציה), `DidYouKnowCard` (טיפים מתחלפים), `HomeGreetingHeader`, `OnboardingChecklist` ("בוא נתחיל").
- **`map/`** — `MapWebView`: מפה אינטראקטיבית בחינם (MapLibre GL JS בתוך WebView, ללא Google/מפתח), נעולה לישראל, נקודות + clusters.
- **`match/` (31)** — הדומיין הגדול ביותר: hero (`MatchStadiumHero` + `LiveCountdown` שהופך ל-MM:SS חי בשעה האחרונה), רשימה (`MatchListCard`, `MatchesHero`), פרטים (`MatchDetailsGrid`, `MatchFactsRow`, `MatchStatsStrip`, `MatchStatusCTACard`, `MatchParticipantsSection`, `PinnedAdminMessageCard`), לייב (`LiveScoreboardCard`, `RotationPanel` + `rotationView.ts` — זיהוי קבוצות לפי צבע, `TimerProgressRing`, `WinnerPickerModal` — בחירה + "אישור" מפורש, `FillerPickerModal` — ללא ביטול, חייב בדיוק N), אדמין (`RetroGoalsSheet`, `TeamsEditModal` — drag&drop החלפה, `EquipmentHandoffModal` — אחרי "סיים ערב", `PlayerActionMenu`, `FillerInterestsSection` — סקירת מועמדי-השלמה, מוצג רק כש-`acceptsFillers===true`).
- **`profile/` (16, מתוכם 8 מתים — ראו §7)** — חיים: `HamburgerMenu`, `DeleteAccountSheet` (מחיקה בהקלדת "בטוח"), `FriendActionButton` (CTA חברות self-contained), `DisciplineRow`, `ProfileLocationMap`, `ProfileNextGameCard`, `ReferralCard`.
- **`summary/`** — `EveningSummaryCard`: כרטיס "סיכום הערב" הניתן לשיתוף; כל סקציה נרנדרת רק אם יש דאטה.

## 6. Utilities — `src/utils/`

| קובץ | תפקיד (הכול טהור/ללא תלות RN אלא אם צוין) |
|---|---|
| `cardState.ts` | מחזור חיים של כרטיס משמעת (revoked/expired/active) לטיימליין |
| `championship.ts` | ניקוד אליפות משותף: גול=2, בישול=1; טבלת משחק = יעילות פר-משחקון, טבלת מועדון = מצטבר |
| `clubLevel.ts` | רמת מועדון — נגזרת client-side, ללא persistence |
| `draft.ts` | הלוגיקה הטהורה של דראפט קפטנים (regular / snake, 2–4 קפטנים) |
| `eveningScore.ts` | ציון ערב 6.0–10.0 (win share + תרומה + נוכחות) — מופרד לשם בדיקות jest |
| `eveningStats.ts` | reducers לסיכום הערב (roundHistory → streaks, GF/GA, נתוני wearable "מצחיקים") |
| `format.ts` | פורמט תאריך/שעה קנוני — איחד 6 מימושים סוטים |
| `gameFilters.ts` | לוגיקת הסינון הטהורה מאחורי GameFilterSheet (הרכיב re-exports) |
| `geo.ts` | Haversine בק"מ, ללא ספריות |
| `guestGate.ts` | חסימת פעולות-חשבון לאורחים אנונימיים (App Store 5.1.1(v)) |
| `haptics.ts` | אוצר מילים הפטי אחיד (success/light/…) מעל expo-haptics |
| `heroAtmosphere.ts` | "שמיים חיים" ל-hero: גרדיאנט לפי שעה + סיווג מזג אוויר (WMO) |
| `nearby.ts` | פתרון מיקום ל"קרוב אליי": GPS → reverse-geocode → עיר שמורה |
| `physical.ts` | מתמטיקת heatmap/דופק (נורמליזציה למגרש, אזורי HR) — בשימוש `healthService` בלבד |
| `playedGames.ts` | ההגדרה הקנונית של "משחק ששוחק" (finished+past+players[]+לא no_show) |
| `rating.ts` | סולם הדירוג הפנימי: **עשרוני 1.0–5.0** (0=לא דורג); מזין את איזון הכוחות |
| `stripUndefined.ts` | ניקוי `undefined` לפני כל כתיבת Firestore |
| `validate.ts` | ולידציית קלט בצד לקוח, בכפילות מכוונת עם firestore.rules |

כל ה-utils בשימוש חי (אין מתים). **לא נמצאו כלל הערות TODO/FIXME/HACK** ב-components/utils/theme/i18n.

## 7. קוד מת — רכיבים שאינם מיובאים משום מקום (מאומת גם ב-import וגם ב-JSX)

**23 קבצים מתים**, רובם שרידי עיצובים קודמים:

1. `src/components/DisciplineCards.tsx` — הוחלף ב-TrustMeter
2. `src/components/RadiusSelector.tsx` — הוחלף בסליידרים בתוך הגיליונות
3. `src/components/RatingScale.tsx` — צ'יפים 1–10; **הוחלף בפועל ב-RatingSlider עשרוני 1.0–5.0** (תיעוד ישן שמדבר על "מעבר ל-1–10" — לא משקף את הקוד הנוכחי)
4. `src/components/anim/MorphButton.tsx` — נבנה ומעולם לא אומץ
5. `src/components/community/ChampionshipTable.tsx` — הוחלף ב-CommunityChampionship/GameChampionship
6–12. שרידי עיצוב MatchDetails הישן: `match/MatchHeroStrip`, `match/MatchManageSection`, `match/MatchNotesRow`, `match/MatchPlayersPreview`, `match/MatchSegmentControl`, `match/MatchStatusCard`, `match/QuickActionsRow`
13. `src/components/players/WinLossRing.tsx` — שריד מסך ה-head-to-head שהוסר (תואם ליתומי `pairStats*` ב-he.ts)
14–21. שרידי עיצוב הפרופיל הישן: `profile/AchievementsRail`, `profile/HeroStatsCard`, `profile/ProfileActivityCard`, `profile/ProfileAvailabilityCard`, `profile/ProfileCollectionCard`, `profile/ProfileHeader`, `profile/ProfileHeroCard`, `profile/StatsGrid` (+ `profile/StatCard` שמיובא רק ע"י StatsGrid המת — מת טרנזיטיבית)
22–23. **כפילות**: `src/components/SectionTitle.tsx` ו-`src/components/StatTile.tsx` מתים — אך רכיבים בשם זהה **מומשו מחדש לוקאלית** בתוך `CommunityStatsScreen.tsx` (שורה 432) ו-`PlayerCardScreen.tsx` (שורה 335).

בנוסף: `darkPalette` ב-`colors.ts` — מוגדרת ולא נגישה (dark mode כבוי קשיח).

## 8. פיצ'רים נסתרים / מגודרי-דגל

- **`ScreenshotReportSheet`** — צילום-מסך של המשתמש פותח אוטומטית גיליון "דווח על באג" עם capture נקי מצורף; **פעיל רק למשתמשים עם `users/{uid}.qa === true`** (מסומנים מדשבורד Pulse). כולל `ScreenshotAnnotator` (סימון חופשי באדום → JPEG משוטח).
- **`MockModeBanner`** — פס כתום "נתוני דמו"; מוצג רק כש-`USE_MOCK_DATA` (מ-`firebase/config`), ומוסתר גם ע"י `EXPO_PUBLIC_SCREENSHOT_MODE=1`.
- **`EXPO_PUBLIC_SCREENSHOT_MODE=1`** — מצב צילומי-חנות: משנה layout ב-`CommunityDetailsScreen` (שורה 709) ומנקה chrome של dev.
- **`RemoteGates`** — `MaintenanceGate` (מסך חסימה מלא) + `AnnouncementBanner`, נשלטים חיים מ-Remote Config ללא release.
- **`CampaignGate`** — מודאל קמפיין-פופאפ חד-פעמי שנכתב ב-Pulse; frequency-capped; fail-silent.
- **`ADVANCED_MODE_ENABLED = true`** — קבוע קשיח ב-`src/screens/games/GameWizardForm.tsx:252`; ההערה בשורה 754 עדיין אומרת "behind ADVANCED_MODE_ENABLED while the feature is unfinished" — הדגל דלוק בפרוד אך נשאר בקוד כ-kill-switch.
- **`FillerInterestsSection`** — מנוע ה"משלימים" הרדום; מוצג רק לאדמין וכש-`game.acceptsFillers===true` (ברירת מחדל כבויה — הפיצ'ר בפועל כמעט בלתי-נראה; קיימת תוכנית מאושרת שטרם נבנתה להעלותו לפיד).

## 9. דפוסי RTL ונקודות סיכון ספציפיות

**הדפוסים בקוד:**
1. `forceRTL` גלובלי + defaultProps על Text/TextInput (App.tsx).
2. `RTL_LABEL_ALIGN` ('left') — הדפוס הקנוני ליישור תוויות, 115 קבצים.
3. `flexDirection:'row-reverse'` — **110 מופעים ב-30 קבצים** (בין היתר: `ProfileScreen`, `RequestsScreen`, `CommunityDetailsScreen`, `ChatView`, `RotationPanel`, `LiveScoreboardCard`, `TeamScore`, `PlayerActionMenu`, `GameFilterSheet`, `InputField`, `ManageEquipmentSheet`). תחת forceRTL, שימוש ב-row-reverse הופך את הסדר פעמיים — כל מופע כזה הוא נקודה שדורשת אימות ויזואלי.
4. סימוני LRM (`‎`) סביב "x / y" — קיימים בשני המקומות היחידים עם התבנית המסוכנת.

**רשימת נקודות סיכון קונקרטיות:**
- `textAlign:'right'` ליטרלי על **Text** (בניגוד להנחיית `rtl.ts`; על TextInput זה השילוב הנכון עם writingDirection): `src/components/InfoTip.tsx:172,178`, `src/components/match/PlayerActionMenu.tsx:248,272,278`, `src/components/compare/PlayerCompareCard.tsx:219`, `src/components/chat/ChatView.tsx:997`, `src/screens/map/MapScreen.tsx:636`.
- תבנית "{x} / {y}" עם רווחים (ממוגנת LRM אך שבירה בעריכה): `src/screens/FeedbackScreen.tsx:99`, `src/components/PlayerCountBar.tsx:93`.
- הסתירה הגלובלית: ברירת מחדל `textAlign:'right'+writingDirection:'rtl'` (App.tsx:220-233) מול ההנחיה ההפוכה ב-`src/theme/rtl.ts` — כל רכיב חדש שלא ידרוס עם `RTL_LABEL_ALIGN` תלוי בהתנהגות ה-swap.
- `RangeSlider` ו-`RatingSlider` — מסילות **LTR מכוונות** (מתועד בקוד); שינוי עתידי "לתקן ל-RTL" ישבור את מתמטיקת המיקום.
- `StepIndicator` — הרכיב היחיד שמסתעף על `I18nManager.isRTL` בזמן ריצה (שורה 75).
- `PinnedAdminMessageCard.tsx:281` — הסתמכות מפורשת על remap של `left` תחת isRTL.
- שורות אווטאר-ראשון עם `flexDirection:'row'` — הדפוס המועד לפורענות המתועד (אווטאר קופץ לימין תחת forceRTL); הפתרון הקיים בקוד הוא row-reverse מקומי + אימות בצילום מסך.

## 10. נגישות

**321 מופעים** של `accessibilityLabel` / `accessibilityRole` / `accessible=` ברחבי הקוד — דפוס עקבי ברכיבי הבסיס (Button, InfoTip עם `infoTipA11y`, BallSwitch, CollapsibleContent, RequestsBell ועוד ~20 רכיבים). אין תמיכה מוצהרת ב-Dynamic Type מעבר ל-defaults (`allowFontScaling` מופיע רק בטיפוס ה-defaultProps).


# 10. קונפיגורציה, דגלים ותשתית

# תצורה, בילד, דגלים, משימות רקע ואינטגרציות — ממצאים מהקוד

## 1. זהות האפליקציה ותצורת Expo (`app.json`)

- **name:** Teamder, **slug:** `soccer-game`, **version:** 1.0.67, **Android versionCode:** 36 (בפועל EAS עם `autoIncrement` + `appVersionSource: remote` — המספר בקובץ אינו המקור), **package/bundleId:** `com.studiogameslime.soccerapp`, **owner:** `studiogameslimes-organization`, projectId של EAS: `382fd359-9632-4210-ad26-fb967a8a893a`.
- **schemes לדיפ-לינקים:** `footy` (legacy), `teamder`, `com.studiogameslime.soccerapp`.
- **iOS:** Apple Sign-In מופעל (`usesAppleSignIn`), `associatedDomains: applinks:teamderfc.web.app` (Universal Links מוצהר ב-app.json), לוקליזציה he+en, מחרוזות הרשאה בעברית (מיקום, תמונות, מצלמה), `ITSAppUsesNonExemptEncryption:false`, `LSApplicationQueriesSchemes: itms-apps` (לפתיחת App Store).
- **Android:** הרשאות `POST_NOTIFICATIONS` + `DETECT_SCREEN_CAPTURE`; App Links מאומתים (`autoVerify:true`) ל-`teamderfc.web.app` בנתיבים `/session`, `/team`, `/app`; minSdk 26, target/compileSdk 35.
- **Splash:** `splash-blank.png` על רקע `#1E40AF` (לקח מדחיית גוגל 1.0.10 — אסור לחסום את ה-splash על מודעה).

## 2. קטלוג דגלי סביבה (EXPO_PUBLIC_*)

| משתנה | תפקיד |
|---|---|
| `EXPO_PUBLIC_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / STORAGE_BUCKET / MESSAGING_SENDER_ID / APP_ID / MEASUREMENT_ID` | תצורת Firebase JS SDK (`src/firebase/config.ts`). חוסר בשדות חובה ⇒ נפילה אוטומטית ל-mock mode |
| `EXPO_PUBLIC_GOOGLE_OAUTH_WEB/IOS/ANDROID_CLIENT_ID` | Google Sign-In |
| `EXPO_PUBLIC_FOOTY_FORCE_MOCK=1` | **מתג המאסטר של mock mode** — כופה `USE_MOCK_DATA=true` גם כשיש תצורת Firebase; גם מכבה מודעות לחלוטין (`IS_MOCK_BUILD` ב-adsService) |
| `EXPO_PUBLIC_ADMOB_ENABLED=1` | מפעיל את כל מערך המודעות; בלעדיו ה-`require('react-native-google-mobile-ads')` לא מתבצע כלל (הגנה מקריסת מודול חסר) |
| `EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID / APP_OPEN_UNIT_ID / IOS_BANNER_UNIT_ID / IOS_APP_OPEN_UNIT_ID` | מזהי יחידות מודעה פר-פלטפורמה; חסר ⇒ נפילה ל-Test IDs |
| `EXPO_PUBLIC_ADMOB_USE_TEST_IDS=1` | כופה Test IDs גם ב-release (לבדיקות פנימיות) |
| `EXPO_PUBLIC_SCREENSHOT_MODE=1` | מצב צילומי-חנות: מסתיר מודעות ופס דיבאג — **מכובד רק ב-`__DEV__`**, כך ש-.env שגוי לא יכבה הכנסות בפרודקשן |
| `EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN` | טוקן debug ל-App Check (QA על אמולטור שאין בו Play Integrity) |

### מנגנון ה-mock
- `USE_MOCK_DATA = !FIREBASE_CONFIGURED || FORCE_MOCK`; `getFirebase()` **זורק חריגה** אם נקרא במצב mock — אי-אפשר לגעת ברשת בטעות. כל שירות ב-`src/services/*` בודק את הדגל ופונה לענף in-memory.
- נתוני mock: `src/data/mockData.ts` (711 שורות — `mockPlayers` בשמות עבריים, `mockGame`, `mockGamesV2` כולל משחק לייב מתקדם מלא: rotation, goals עם assists, leftHome, טיימר — בנוי במפורש לצילומי אימות-תיקונים) ו-`src/data/mockUsers.ts` (`mockCurrentUser`, `mockGroup`, `mockOtherGroup`, `mockPublicGroups`, `mockHistory`).
- `MockModeBanner.tsx` מציג באנר רק כש-`USE_MOCK_DATA` פעיל.

## 3. Firebase Remote Config (`src/services/remoteConfigService.ts`)

מפתחות + ברירות מחדל בקוד (`RC_DEFAULTS`), ניתנים לשינוי חי מהקונסול בלי גרסה; fetch עד פעם בשעה בפרוד (0 ב-dev); דגרדציה חיננית — מודול חסר ⇒ ברירות מחדל:

- **מודעות app-open:** `app_open_ad_enabled` (true), `app_open_cooldown_ms` (4 שעות), `app_open_max_per_day` (3), `app_open_new_user_grace_ms` (יומיים "ירח דבש" לחשבון חדש), `app_open_intentful_suppress_ms` (20 שניות אחרי פתיחה מפוש/לינק).
- **באנר:** `banner_enabled` (true).
- **kill-switches לפיצ'רים:** `feature_quick_games` (כפתור במסך המשחקים), `feature_referrals`, `feature_friends`, `feature_feedback` (שלושתם בפרופיל), `feature_ios_clipboard_invite` (שחזור הזמנה מה-clipboard ב-iOS), `feature_campaigns` (כל מערך הקמפיינים: פופאפים, שאילתת זכאות, presence ping).
- **תחזוקה:** `maintenance_mode` + `maintenance_message` — `MaintenanceGate` (`src/components/RemoteGates.tsx`) הוא overlay מסך-מלא חוסם.
- **בקשת דירוג:** `review_prompt_enabled`, `review_prompt_cooldown_days` (90).
- **תוכן:** `support_email`, `store_url_ios`, `store_url_android`.
- **באנר הכרזה:** `announcement_enabled`, `announcement_text`, `announcement_url` — `AnnouncementBanner` נסגר ע"י המשתמש.
- `useRemoteConfig()` — hook שמרנדר מחדש UI כשה-fetch מתאקטב (חיוני לשער התחזוקה ולהסתרת כפתורים).

## 4. מסמכי `appConfig` ב-Firestore (מתגי Pulse — ללא גרסה)

- **`appConfig/android`, `appConfig/ios`** — `latestVersion` (פופאפ עדכון אופציונלי) + `minimumSupportedVersion` (עדכון כפוי). נקראים ב-`updateService.checkForUpdate()` בכל עלייה קרה (App.tsx); השוואת גרסאות semver-ית פשוטה; `openStore()` עם fallback iOS מ-itms-apps ל-https. נכתבים ע"י ה-callable **`updateAppConfig`** — נעול ל-UID יחיד של הבעלים (`1IdtNEjbEXfiRSqvLrJVn99NsfI2`).
- **`appConfig/ads`** — `appOpenEnabled` / `bannerEnabled`: מתגי מאסטר של Pulse, גוברים על כל חוקי ה-RC. רק `false` מפורש מכבה; כשל קריאה ⇒ נשאר הערך האחרון; מודעת app-open ראשונה **ממתינה** (עד 2.5 שניות) לקריאה כדי שלא תחמוק מודעה כשהמתג כבוי.
- **`appConfig/features`** — `availabilityCardEnabled`: מסתיר את לוח הזמינות בבית (fail-open) — `homeConfigService.ts`.
- **`appConfig/releaseLog`** — לא נקרא/נכתב מקוד הריפו הזה; זהו החוזה עם Pulse (מנוהל ידנית/מכלים).
- **`adminConfig/prefs`** — מתגי on/off פר-סוג להתראות מייסד (`functions/src/adminPush.ts`).

## 5. דגלים קשיחים בקוד (hidden/experimental)

- `ADVANCED_MODE_ENABLED = true` — `src/screens/games/GameWizardForm.tsx:252`: מצב לייב מתקדם דלוק בפרוד (היה חבוי).
- `PULSE_ENGINE_ENABLED = false` — `functions/src/index.ts:8989`: **מנוע ה"פולסים" האוטומטי למילוי משחק כבוי בפרוד**; רק ההפעלה הידנית של אדמין (`startGameFillerPulse`) עובדת, ושרשרת שכבר רצה תמיד מסתיימת. חצי-מופעל בכוונה (תוכנית fillers-in-feed מאושרת אך לא נבנתה).
- `ENFORCE_APP_CHECK = false` — `functions/src/index.ts:78`: אכיפת App Check כבויה על **כל** ה-callables (זמני מ-2026-06-04, לשחרור iOS עד אימות App Attest). ה-Auth עדיין נאכף.
- `SHOW_AD_DEBUG = false` (adsService) — פס דיבאג מודעות לבילד פנימי; `FORCE_TEST_IDS` דרך env.
- `plugins/withHealth.js`: פונקציית `withHealthIos` (HealthKit) **כתובה אך לא מחוברת** — Android-only עד שה-capability יופעל ב-Apple App ID (קוד מת-בכוונה עם הוראת החזרה).

## 6. אינטגרציות

**Firebase (היברידי JS SDK + React-Native-Firebase נייטיבי):**
- Firestore (JS SDK, `experimentalForceLongPolling:true` — עקיפת כשלי WebChannel ב-RN/Hermes; `ignoreUndefinedProperties:true`), Auth (התמדה ב-AsyncStorage), Storage, Functions (`us-central1` — חייב להתאים ל-`setGlobalOptions`), Analytics (`@react-native-firebase/analytics` — `analyticsService.ts` עם קבועי אירועים typed; במצב mock/dev מדפיס לקונסול), Remote Config, App Check (`src/firebase/appCheck.ts`: נייטיב Play Integrity/App Attest + גשר `CustomProvider` ל-JS SDK; debug provider ב-dev/עם טוקן env), FCM.
- קבצי תצורה: `google-services.json` + `GoogleService-Info.plist` בשורש, מוזרקים דרך `googleServicesFile` ב-app.json.

**מודעות:** `react-native-google-mobile-ads` v14 — AdMob appId אמיתי לשתי הפלטפורמות ב-app.json (`ca-app-pub-4452511612073107~…`), `skAdNetworkItems: []` (ריק — ראוי לתשומת לב ל-iOS attribution). שני פורמטים: באנר 320×50 (קורס לגובה 0 בכשל טעינה) ו-app-open עם 4 שכבות שערים (מתג Pulse ← RC kill-switch ← דיכוי פתיחה-מכוונת ← גרייס משתמש-חדש ← cooldown+מכסה יומית ב-AsyncStorage). בקשות תמיד `requestNonPersonalizedAdsOnly:true`.

**התחברות:** Google Sign-In (`@react-native-google-signin`), Apple Sign-In (`expo-apple-authentication`).

**בריאות:** `react-native-health-connect` (Android בלבד) — קריאה בלבד: צעדים, מרחק, קלוריות, מהירות. **בלי דופק ובלי exercise-route** (הוסרו במכוון ב-2026-07-14 בגלל מדיניות Google ינואר-2026). iOS HealthKit דחוי.

**שירותי רשת חינמיים (ללא מפתח):**
- **Open-Meteo** (`weatherService`) — תחזית לשעת המשחק (טמפ' + סיכוי גשם + WMO code).
- **govmap / מפ"י** (`govmapService`) — אוטוקומפליט כתובות ומוסדות בעברית כולל קואורדינטות (המרת EPSG:3857).
- **Nominatim/OSM** (`geocodeService`) — עיר→קואורדינטות בשמירת זמינות (מוגבל ל-il).
- **data.gov.il** (`israelLocationService`) — אוטוקומפליט שמות ערים.
- **wa.me** (`whatsappService`) — דיפ-לינק וואטסאפ עם נרמול מספרים ישראליים.

**ייחוס התקנות:** `react-native-play-install-referrer` (Android — `invite_<type>_<id>` דרך Play), clipboard deferred deep-link ל-iOS (`clipboardInviteService`, קריאה חד-פעמית עם `hasUrlAsync` כדי לא להקפיץ "Allow Paste"), קיצורי `/i/<code>`.

**חנויות:** `expo-store-review` (`storeReviewService` — 3 שכבות rate-limit), פולינג ביקורות ASC + Google Play ב-CF (`reviewAlerts.ts`, JWT עם jsrsasign) → פוש למייסד.

**שעונים ווידג'טים:**
- Wear OS: מודול נייטיב מלא דרך `plugins/withWearApp.js` (ראו §7).
- Apple Watch: `targets/watch` + `targets/complication` דרך `@bacons/apple-targets` — אפליקציית SwiftUI (טיימר + משחק הבא דרך WatchConnectivity) + קומפליקציה שהיא **launcher בלבד** (v1; נתונים חיים דורשים App Group — לא נבנה). ⚠️ דורש provisioning ל-`…watchkitapp` — אותה מחלקת בעיה כמו Associated Domains בפרופיל המקומי.
- `modules/watch-bridge` — Expo module ל-iOS (`WatchBridgeModule`).

## 7. פלאגיני build (`plugins/*.js`) — כולם אידמפוטנטיים, רצים בכל prebuild

| פלאגין | מה עושה |
|---|---|
| `withWearApp.js` | מעתיק `plugins/wear-src/{wear,watch,widget}` לתוך `android/` (שה-gitignored), מוסיף `:wear` ל-settings.gradle, תלויות play-services-wearable + firebase-firestore/auth/messaging ל-compile classpath, רושם במניפסט: `TeamderWidgetProvider` (וידג'ט טיימר), `TeamderPlayersWidgetProvider` (וידג'ט רשימת שחקנים עם RemoteViewsService), `TimerActionReceiver` (כפתורי play/pause/reset שכותבים ל-Firestore מ-Kotlin נייטיבי), `WearTimerCommandService` (פקודות טיימר מהשעון בנתיב `/teamder/timer-command`), `TeamderMessagingService` (תופס FCM לפני expo-notifications לטובת הודעות `timerSync`) |
| `withHealth.js` | הרשאות Health Connect (Android בלבד) + `<queries>` לחבילת Health Connect; ענף iOS קיים אך מנותק |
| `withScreenCapture.js` | מודול PixelCopy נייטיבי לצילומי מסך (מקור: `plugins/screenshot-src`); ב-iOS נופל ל-react-native-view-shot |
| `withIoniconsAsset.js` | מטמיע `ionicons.ttf` (אותיות קטנות) ב-assets — עוקף באג פונטים ב-SDK 53 |
| `withFmtConstevalFix.js` | מזריק patch ל-Podfile שמכבה `FMT_USE_CONSTEVAL` — תיקון קומפילציית fmt מול clang של Xcode 16/26 |
| `withRemoveAlwaysLocation.js` | מוחק מ-Info.plist את מחרוזות מיקום-"Always" הגנריות ש-expo-location מזריק (מונע דגל ב-App Review) |

## 8. משימות רקע (Cloud Functions, `us-central1`, maxInstances 10, Node 20)

### Cron — 3 dispatchers בלבד (אוחדו מ-10 ג'ובים לחיסכון בעלות Cloud Scheduler; כל sweep עטוף כך שכשל אחד לא מפיל את השאר):
- **`cronEvery5Min`:** `runFlipScheduledGames` (פתיחת הרשמה), `runFlipPublicGames` (הפיכה לציבורי), `runCloneRecurringGames` (שכפול שבועי 3 שעות אחרי משחק), `runScheduledAutoGenerateTeams` (כוחות אוטומטיים ב-autoTeamsAt), `runExpireStaleOffers`, `sweepDueCampaigns` (⚠️ מוקד עלות-קריאות ידוע כשקמפיין נתקע ב-queued).
- **`cronEvery15Min`** (540s, 512MiB, עם secrets): `runSendGameReminders`, `runSendRsvpNudges`, `runSendShortageWarnings`, `runSendRateReminders`, `runFindFillerCandidates` (המנוע הכבד של התאמת משלימים), `runReviewAlerts` (פולינג ביקורות חנויות → פוש ל-Pulse).
- **`cronEvery60Min`:** `runCleanupStaleGames`, `runSendPromotePrompts`, `runDailyCleanupIfDue` (ניקוי יומי בשער Firestore `cronMeta/dailyCleanup` — פעם ב-~23 שעות).

### Cloud Tasks (תזמון מדויק, "fire-but-verify" — הקרון נשאר רשת ביטחון):
- **`scheduledGameMomentTask`** — רגעי משחק בשנייה המדויקת: `registrationOpen`, `publicOpen`, `reminder1h` (startsAt−60ד'); enqueue מ-`enqueueGameMoments` (נקרא מ-`onGameRosterChanged`) רק לרגעים עתידיים, בתוך אופק 25 יום, וכשהמועד השתנה. ביטול/דחייה — הטסק הישן no-op בזכות latches אידמפוטנטיים.
- **`flushPendingJoinerNotifsTask`** — איגוד התראות מצטרפים (החליף קרון דקתי; ~96% פחות invocations).
- **`reconcileJoinsTask`** — reconcile הצטרפויות עם dedupe דטרמיניסטי לפי חלון-זמן (`rj-<gameId>-<bucket>` — פרץ לחיצות בפתיחת הרשמה מתמזג לטסק אחד).
- **`fillerPulseTask`** — שרשרת "שלח-לכולם בפולסים" שמתזמנת את עצמה מחדש עד שהמשחק מתמלא.

### טריגרים על מסמכים (עיקריים): `onNotificationCreated` (תור הפוש היוצא ← FCM, עם dedupe משותף client/server ב-`notificationDedup.ts` — שני עותקים שחייבים להישאר תואמים), `onGameRosterChanged`, `onGameTimerChanged`, `onGameRotationChanged` (**no-op מאז 1.0.49 — קוד מת בכוונה**), `onGroupPendingChanged`, `onVoteWritten` + `onVoteWrittenLegacy`, `onJoinRequestCreated`, `onFillerInterestCreated`, `onFriendRequestCreated`, `onCampaignCreated`, טריגרי התראות-מייסד (`onNewUserJoined`, `onGameCreatedAlert`, `onGameJoinedAlert`, `onCommunityCreatedAlert`, `onCommunityJoinedAlert`, `onAvailabilityUpdated`, `onErrorLogged`, `onFeedbackSubmitted`), `stampMembershipDates`, `updateShowcaseOnGroupChange/GameChange`, וצ'אט: `onGameChatMessage`/`onCommunityChatMessage`/`onDmChatMessage` (`chatPush.ts` — "פוש אחד עד פתיחה" לפי מונה unread).

### HTTP (hosting rewrites): `serveCommunityPage` (`/team/**`, `/c/**` — דפי שיתוף), `serveInviteCode` (`/i/**` — קישורים מקוצרים), `trackLinkClick` (`/track-click` — ייחוס הורדות פר-לינק). דפי `/session/**`, `/app`, `/go` → `invite.html` סטטי. שני אתרי hosting זהים: `teamderfc` + `soccer-app-52b6b`.

### Secrets: `ASC_P8` (App Store Connect API key) + `PLAY_SA` (service account של Play) — רק ל-`cronEvery15Min`/reviewAlerts.

## 9. צנרת build/release

- **פרופילי EAS** (`eas.json`): `development`, `preview` (APK), `preview-ios-simulator`, `production` (autoIncrement), **`production-wear`** — track נפרד לגמרי (`:wear:bundleRelease`, מסלול Play `wear:production`/`wear:internal`), **`production-ios-local`** — חתימה מקומית (`credentialsSource: local`; מכסת הענן החינמית אזלה). Submit עם מפתח ASC ב-`~/.teamder-update-watch/AuthKey_SQBY46Q3DC.p8` ו-SA JSON ב-Downloads.
- **פריסת פונקציות:** `firebase deploy --only functions` עם predeploy build (`scripts/copy-template.js` + tsc).
- **אינדקסים** (`firestore.indexes.json`): 25 אינדקסים מורכבים — כבדים על `games` (סטטוס/נראות/משתתפים/זמנים/recurring/autoTeamsAt), `groups`, `groupJoinRequests`, `campaigns` (type+status+sendAt), `communityPairStats`, `communityPlayerEvents`, `rounds`, `notifications` (dedupeKey+read); collection-group overrides על `messages.createdAt` + `messages.senderId` (מוניטור הצ'אט של Pulse).
- **Watcher לפופאפ עדכון:** `~/.teamder-update-watch/watch.py` (מחוץ לריפו) — פולינג ASC + Play; כשגרסה LIVE הוא כותב `appConfig/{ios|android}.latestVersion`. ל-Android יש grace של ~4 שעות כי ה-track מדווח "completed" לפני סוף הביקורת. בתיקייה גם עשרות סקריפטי submit חד-פעמיים פר-גרסה (`ios_10XX_submit.py`) — תוצרי עבודה, לא תשתית.
- **`functions/update-appconfig.js`** — סקריפט אדמין ישן לעדכון ידני של appConfig; **מקובע על 0.2.5 — stale/קוד מת**, הוחלף בפועל ב-callable + watcher.
- **מנגנון version-gating במוצר:** force-update (מתחת ל-minimumSupportedVersion — לא ניתן לסגירה) / optional (מתחת ל-latestVersion) — נבדק בכל עלייה + בכל חזרה לחזית (App.tsx).
- **סקריפטי עזר בריפו** (`scripts/`): `rulestest.mjs` (הרנס לבדיקת firestore.rules), `pulse_dump.py`, `qa500.py`, `ui.py`/`shot.py`/`rec.py` (QA על אמולטור), `migrate_rating_to_5.py`, `make_test_plan.py`.
- **package.json:** `postinstall` מוחק `dist/module/package.json` של RN-Firebase (עקיפת בעיית resolution) + `patch-package`; Expo SDK 53, RN 0.79.6, React 19; async-storage מוחרג מ-`expo install` (נעילת גרסה).

## 10. חצי-גמור / מת / חבוי — ריכוז

- **חבוי/כבוי בשרת:** `PULSE_ENGINE_ENABLED=false` (פולסים אוטומטיים); `ENFORCE_APP_CHECK=false` (זמני, ממתין ל-App Attest).
- **חצי-גמור:** HealthKit ל-iOS (קוד קיים, מנותק); קומפליקציית Apple Watch (launcher בלבד, בלי App Group); Universal Links ב-iOS (מוצהר ב-app.json אך הפרופיל המקומי חסר entitlement — לפי הערות בקוד `withHealth.js` על "אותה מחלקה"); `skAdNetworkItems` ריק.
- **קוד מת:** `onGameRotationChanged` (no-op מוצהר); `functions/update-appconfig.js` (גרסאות 0.2.x); scheme `footy://` נשמר רק לתאימות לאחור; `onVoteWrittenLegacy` (נתיב הצבעות ישן).
- **ניסיוני/דמו:** `mockGamesV2` בנוי לצילומי דמו; `AdDebugOverlay` + `SHOW_AD_DEBUG`; `EXPO_PUBLIC_ADMOB_USE_TEST_IDS` כפתח-מילוט לבדיקות.
- **אדמין-בלבד:** `updateAppConfig` נעול ל-UID של הבעלים; מתגי `appConfig/ads`+`features`+`adminConfig/prefs` נשלטים רק מ-Pulse.