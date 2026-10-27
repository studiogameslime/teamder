# מלאי מסכים ופערי אחידות, 27.10.2026

תוספת בסיום הלילה: מצב כשל טעינה בשיחה תוקן ונוספו צילומי רינדור דפדפן מסומנים. זהו שינוי תחום אחרי עריכת המלאי, ללא פתיחה חדשה של כל המסכים. [התנהגות והראיות](../features/chat/message-interface.md#כשל-קריאת-שיחה-וניסיון-חוזר-27102026).

נסרקו כל 62 קובצי התצוגה תחת `src/screens`, קישורי התיעוד, רכיבים משותפים וגרף הייבוא מהכניסה `App.tsx`. שישים קבצים נגישים בגרף סטטי ושניים מחוצה לו. הגרף כולל גם טיפוסים, טפסים, כינויים וכלי פיתוח, ולכן המספר אינו מספר מסכי ניווט למשתמש. רשימת פולס בת 42 קבצים קיימת במפתח המצב, אך בקשת מלאי מסכי האפליקציה כאן מתייחסת ליישום טימדר.

לא בוצעה פתיחה חדשה של כל המסכים במכשיר. נצפו מחדש צילומי המקור של ההפניות, החסומים, הגדרות ההתראות ורשימת השיחות, וגם צילום תפריט הלייב מ-25.10. הצילומים ישנים ומוגבלים למצבים שהם מציגים; הביקורת אינה בדיקת חזות עדכנית של כל מצב. ספירת צבעים או עצם השימוש בכרטיס אינם הוכחה למסך שלא עוצב.

## מה כדאי להשלים בעיצוב

1. שחקנים שהצטרפו דרכי: נשארה מעטפת בסיסית של כותרת ורשימה, והראיה המקושרת היא מצב ריק ישן. זה המועמד הברור ביותר להשלמת השפה החזותית, בכפוף להשוואה למסך מרונדר עדכני. [קוד](../../src/screens/profile/ReferralsListScreen.tsx) ו[צילום שנצפה](../features/screenshots/Referrals.jpg).
2. משתמשים חסומים: מעטפת רשימה בסיסית וללא הוכחה חזותית עדכנית למצבי רשימה וריקנות. הצילום שנצפה מציג שגיאה בלבד, לכן אין בסיס לקביעה שכל המסך הושלם בעיצוב. [קוד](../../src/screens/profile/BlockedUsersScreen.tsx) ו[צילום הכשל שנצפה](../features/screenshots/audit-fix-BlockedUsers.jpg).
3. היסטוריה אישית, היסטוריית מועדון ולוח זמינות שבועי: להשוות את המעטפות ולשוניות הכותרת מול שפת המוצר החדשה. התוכן עצמו משתמש ברכיבים משותפים; אלה מועמדי אחידות ולא קביעה שהמסך מעולם לא עוצב.

אין בסיס לקבוע שרשימת השיחות, הדיווח, טפסי היצירה והעריכה, ההזמנה האישית או הלייב עדיין לא עוצבו. יש להם עבודות עיצוב מתועדות מהימים 11.10 עד 26.10. גם הפעילות שלי ופרטיות חברתית הן תוספות חדשות; אין לסווג אותן כישנות רק מפני שחסר צילום במפתח.

## פערי אחידות ממוקדים

| מקום | מה נמצא | רמת הראיה והמשך |
|---|---|---|
| `src/components/activity/MyActivityDashboard.tsx:157` | איך זה מחושב פותח `Alert.alert` מקורי של המערכת | קריאת קוד פעיל; לצלם וליישר לשפת `AppDialog` |
| `src/services/useMyActivity.ts:43` | גילוי והסכמה לחיבור נתוני בריאות משתמשים בחלון מערכת | קריאת קוד פעיל; בשינוי חובה לשמר סירוב, סגירת רקע ותשובת ההבטחה |
| `src/services/healthService.ts:80` | גילוי הנתונים במסלול סיכום פיזי משתמש בחלון מערכת ובנוסח אנגלי מעורב ישן | קריאת קוד; לבדוק את המארח והנגישות לפני החלפה |
| `AppDialog`, `ConfirmDialog`, `ConfirmDestructiveModal` | יש שפה רגילה ושפת כדורגל מותנית, עם סמל וכותרת שונים | זו שונות מוכחת בקוד, אך שלושה רכיבים אינם בהכרח שלוש תקלות; נדרשת החלטה אילו מצבים צריכים להתאחד |
| אישור הרסני | במצב כדורגל מופיעה תמונת כדור; באישור הרגיל סמל אזהרה | שונות בתוכן ולא ראיה לסמל שבור; יש לשמר את תפקיד האזהרה והאישור |
| זמינות ודרישה אזורית | עדיין יש שילוב `writingDirection:'rtl'` עם `RTL_LABEL_ALIGN` ב-11 סגנונות בארבעה מקורות שנרשמו ב-24.10 | חשד מוכר שנותר בקוד; נדרש צילום מתאים, אין הכרזת תיקון |
| תפריטי בית, מועדון, מחזור, שחקן ולייב | תפריטים מעוצבים מתועדים; תפריט הלייב נצפה בצילום 25.10 | לא נמצא בסיס להכריז שהתפריטים האלה ישנים; אין אישור חדש לגרירה בכל מארח |

בבדיקה הנוכחית לא נמצא שם סמל שגוי חדש שהוכח במילון הסמלים. אין לייחס כשל לסמל בגלל השימוש בספריית סמלים לעומת תמונה; אלה מקורות גרפיים שונים שדורשים בחינה בהקשר. סריקת 24.10 כבר הצליבה 602 שמות סמלים מול המילון, אך אינה הוכחה לכל ביטוי דינמי שנוסף אחר כך.

## כל קובצי המסכים

עמודת המצב מבדילה בין מסך פעיל, רכיב מוטמע, טופס וכינוי. קישורי התיעוד מובילים לראיות ומגבלות, ולא לאישור גורף של עיצוב מחדש. חותמות כל 62 המקורות נשמרו במלאי המקומי.

| קובץ | מצב הערכת העיצוב | פירוט ומקור |
|---|---|---|
| [AdvancedLiveMatchScreen.tsx](../../src/screens/AdvancedLiveMatchScreen.tsx) | מסך פנימי שעוצב | מורכב מתוך LiveMatch לפי סוג מחזור; עיצוב 16.10 ותוספות 25.10 [תיעוד](../features/rounds/fillers.md) |
| [auth/EmailAuthScreen.tsx](../../src/screens/auth/EmailAuthScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/entry/authentication.md) |
| [auth/ProfileSetupScreen.tsx](../../src/screens/auth/ProfileSetupScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/entry/profile-onboarding.md) |
| [auth/SignInScreen.tsx](../../src/screens/auth/SignInScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/entry/authentication.md) |
| [chat/ChatsListScreen.tsx](../../src/screens/chat/ChatsListScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/chat/chats-list.md) |
| [chat/CommunityChatScreen.tsx](../../src/screens/chat/CommunityChatScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/chat/conversation-scopes.md) |
| [chat/DirectChatScreen.tsx](../../src/screens/chat/DirectChatScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/chat/conversation-scopes.md) |
| [chat/GameChatScreen.tsx](../../src/screens/chat/GameChatScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/chat/conversation-scopes.md) |
| [communities/CommunityDetailsPublicScreen.tsx](../../src/screens/communities/CommunityDetailsPublicScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/clubs/public-preview-and-join.md) |
| [communities/CommunityDetailsScreen.tsx](../../src/screens/communities/CommunityDetailsScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/clubs/details.md) |
| [communities/CommunityEditScreen.tsx](../../src/screens/communities/CommunityEditScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/clubs/create-and-edit.md) |
| [communities/CommunityHistoryScreen.tsx](../../src/screens/communities/CommunityHistoryScreen.tsx) | דורש הכרעת אחידות | שורות היסטוריה משותפות בתוך מסלול מועדון; צריך להשוות לרשימת ההיסטוריה האישית [תיעוד](../features/clubs/history.md) |
| [communities/CommunityPlayersScreen.tsx](../../src/screens/communities/CommunityPlayersScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/clubs/members-and-administration.md) |
| [communities/CommunityStatsScreen.tsx](../../src/screens/communities/CommunityStatsScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/statistics/chemistry-and-records.md) |
| [communities/ManagerDashboardScreen.tsx](../../src/screens/communities/ManagerDashboardScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/clubs/manager-dashboard.md) |
| [communities/PublicGroupsFeedScreen.tsx](../../src/screens/communities/PublicGroupsFeedScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/clubs/discovery.md) |
| [dev/AnimationLab.tsx](../../src/screens/dev/AnimationLab.tsx) | כלי פיתוח | חלון בדיקה תחת שער פיתוח, אינו מסך חנות [תיעוד](../features/entry/legacy-and-hidden.md) |
| [entry/IntentScreen.tsx](../../src/screens/entry/IntentScreen.tsx) | כניסה נוכחית | משתמש באיור EntryArt ובחלון התחברות הקשרי; אינו מסך ההיכרות הישן [תיעוד](../features/entry/boot-and-intent.md) |
| [FeedbackScreen.tsx](../../src/screens/FeedbackScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/profile/feedback.md) |
| [games/AddMembersScreen.tsx](../../src/screens/games/AddMembersScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/rounds/add-members.md) |
| [games/AvailablePlayersScreen.tsx](../../src/screens/games/AvailablePlayersScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/rounds/available-players.md) |
| [games/DraftBoardScreen.tsx](../../src/screens/games/DraftBoardScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/rounds/draft-board.md) |
| [games/DraftSetupScreen.tsx](../../src/screens/games/DraftSetupScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/rounds/draft-setup.md) |
| [games/EveningSummaryScreen.tsx](../../src/screens/games/EveningSummaryScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/rounds/match-stats.md) |
| [games/GameCreateScreen.tsx](../../src/screens/games/GameCreateScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/rounds/game-create.md) |
| [games/GameEditScreen.tsx](../../src/screens/games/GameEditScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/rounds/game-edit.md) |
| [games/GamesListScreen.tsx](../../src/screens/games/GamesListScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/rounds/games-list.md) |
| [games/GameWizardForm.tsx](../../src/screens/games/GameWizardForm.tsx) | טופס משותף שעוצב | אותו טופס ליצירה ולעריכה; עיצוב 11.10 [תיעוד](../features/rounds/game-create.md) |
| [games/MatchDetailsScreen.tsx](../../src/screens/games/MatchDetailsScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/rounds/match-details.md) |
| [games/MatchPlayersScreen.tsx](../../src/screens/games/MatchPlayersScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/rounds/match-players.md) |
| [games/MatchRoundsScreen.tsx](../../src/screens/games/MatchRoundsScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/rounds/live-advanced.md) |
| [games/PromoteOrphanScreen.tsx](../../src/screens/games/PromoteOrphanScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/rounds/promote-orphan.md) |
| [groups/AdminApprovalScreen.tsx](../../src/screens/groups/AdminApprovalScreen.tsx) | כינוי למסך אחר | ייצוא של RequestsScreen, אין כאן עיצוב נוסף [תיעוד](../features/clubs/requests-and-approvals.md) |
| [groups/CreateGroupScreen.tsx](../../src/screens/groups/CreateGroupScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/clubs/create-and-edit.md) |
| [groups/GroupWizardForm.tsx](../../src/screens/groups/GroupWizardForm.tsx) | טופס משותף שעוצב | אותו טופס ליצירה ולעריכה; עיצוב 11.10 [תיעוד](../features/clubs/create-and-edit.md) |
| [home/AvailabilityWeekScreen.tsx](../../src/screens/home/AvailabilityWeekScreen.tsx) | דורש הכרעת אחידות | מעטפת כותרת ורכיב לוח משותף; בדיקת העיצוב היא ברכיב ולא רק בקובץ [תיעוד](../features/profile/availability-week.md) |
| [home/GuestHomeScreen.tsx](../../src/screens/home/GuestHomeScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/home/guest-home.md) |
| [invite/PersonalInviteScreen.tsx](../../src/screens/invite/PersonalInviteScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/entry/personal-invite.md) |
| [LiveMatchScreen.tsx](../../src/screens/LiveMatchScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/rounds/fillers.md) |
| [map/MapScreen.tsx](../../src/screens/map/MapScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/rounds/games-map.md) |
| [onboarding/OnboardingPreviews.tsx](../../src/screens/onboarding/OnboardingPreviews.tsx) | רכיב ישן לא פעיל | אינו מסך ניווט; מחוץ לגרף הייבוא הפעיל [תיעוד](../features/entry/legacy-and-hidden.md) |
| [onboarding/OnboardingScreen.tsx](../../src/screens/onboarding/OnboardingScreen.tsx) | היכרות ישנה לא פעילה | אינה מסע הכניסה הנוכחי; אין צורך לעצב אותה כדי לשנות כניסה [תיעוד](../features/entry/legacy-and-hidden.md) |
| [onboarding/PostSignInOnboardingScreen.tsx](../../src/screens/onboarding/PostSignInOnboardingScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/entry/profile-onboarding.md) |
| [players/PlayerCardScreen.tsx](../../src/screens/players/PlayerCardScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/home/home-menu.md) |
| [players/PlayerCompareScreen.tsx](../../src/screens/players/PlayerCompareScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/statistics/player-compare.md) |
| [players/PlayerTimelineScreen.tsx](../../src/screens/players/PlayerTimelineScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/clubs/player-management.md) |
| [profile/AchievementsScreen.tsx](../../src/screens/profile/AchievementsScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/profile/achievements.md) |
| [profile/AvailabilityEditScreen.tsx](../../src/screens/profile/AvailabilityEditScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/profile/availability-edit.md) |
| [profile/BlockedUsersScreen.tsx](../../src/screens/profile/BlockedUsersScreen.tsx) | עדיפות לבדיקת עיצוב | רשימה בסיסית; הצילום האחרון המקושר מציג כשל בלבד, ואינו מאמת רשימה מלאה או מצב ריק [תיעוד](../features/profile/blocked-users.md) |
| [profile/FriendsScreen.tsx](../../src/screens/profile/FriendsScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/profile/friends.md) |
| [profile/MyActivityScreen.tsx](../../src/screens/profile/MyActivityScreen.tsx) | מסך חדש עם פער אחידות | תוספת הפעילות מ-26.10; שני חלונות מערכת פעילים חורגים משפת האפליקציה [תיעוד](../features/profile/my-activity.md) |
| [profile/NotificationsSettingsScreen.tsx](../../src/screens/profile/NotificationsSettingsScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/profile/notification-settings.md) |
| [profile/ReferralsListScreen.tsx](../../src/screens/profile/ReferralsListScreen.tsx) | עדיפות לבדיקת עיצוב | כותרת ורשימת שורות בסיסיות; צילום Referrals.jpg מציג מצב ריק ישן, ללא הוכחת עיצוב מחדש מלאה [תיעוד](../features/profile/referrals.md) |
| [profile/SeasonSummaryScreen.tsx](../../src/screens/profile/SeasonSummaryScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/profile/season-titles.md) |
| [profile/SeasonTitlesScreen.tsx](../../src/screens/profile/SeasonTitlesScreen.tsx) | כינוי למסך אחר | הפניה לארון ההישגים; לבדוק את המסך המשותף [תיעוד](../features/profile/season-titles.md) |
| [profile/SocialPrivacyScreen.tsx](../../src/screens/profile/SocialPrivacyScreen.tsx) | מסך חדש במבנה משותף | משתמש ברכיבי SocialUI ו-FormTheme; היעדר צילום במפתח אינו הוכחה לעיצוב ישן [תיעוד](../features/profile/player-discovery.md) |
| [profile/StatisticsScreen.tsx](../../src/screens/profile/StatisticsScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/statistics/personal-statistics.md) |
| [RequestsScreen.tsx](../../src/screens/RequestsScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/clubs/requests-and-approvals.md) |
| [SplashScreen.tsx](../../src/screens/SplashScreen.tsx) | מעטפת פתיחה | משתמש ב-SplashHero; אינו מסך תוכן רגיל [תיעוד](../features/entry/boot-and-intent.md) |
| [tabs/HistoryScreen.tsx](../../src/screens/tabs/HistoryScreen.tsx) | דורש הכרעת אחידות | שורות היסטוריה משותפות; אין להסיק שרשימה פשוטה היא מסך שלא עוצב [תיעוד](../features/clubs/history.md) |
| [tabs/ProfileEditScreen.tsx](../../src/screens/tabs/ProfileEditScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/profile/profile-edit.md) |
| [tabs/ProfileScreen.tsx](../../src/screens/tabs/ProfileScreen.tsx) | עיצוב מתועד או רכיב מעוצב | קיים מימוש ייעודי וזוג תיעוד; אין כאן אישור לכל מצבי המסך [תיעוד](../features/entry/authentication.md) |

מקורות נוספים: [מפתח כל המסכים](../features/status/screens.md), [מפת הכיסוי](../features/coverage.md), [תפריטים ותנועה](../features/shared/menus-and-motion.md), [סריקת 24.10](2026-10-24-night-scan.md). זהו דוח מחקר, ללא שינוי חזותי, ולכן לא נוצר צילום תיקון חדש ולא שונה מניפסט צילומי המוצר.
