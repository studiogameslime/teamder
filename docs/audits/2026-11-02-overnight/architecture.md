# מיפוי הארכיטקטורה והמוצר

נאסף ב-2.11.2026 מתוך הקוד הנוכחי. זהו מיפוי סטטי של המבנה ותנאי התצוגה, יחד עם קריאה ממוקדת במחסנים, בשערי הכניסה, בדגלי המוצר ובמסכי המעטפת. לא בוצעו במסגרת סוכן זה הרצת אימולטור, כתיבה למסד, שינוי קוד מוצר או בדיקה תפקודית.

## היקף ומספרים

- 62 קבצים תחת `src/screens`, ובהם 43,832 שורות.
- 302 קבצים תחת `src/components`, ובהם 52,244 שורות.
- 729 מקורות יישום נבדקו לצורך גרף התלויות. הפולס אינו חלק מבדיקה זו.
- ארבע לשוניות ושישה מחסני ניווט. נמצאו 154 רישומי מסך, 55 שמות מסלול ו-54 שמות רכיב רשומים. הרישומים החוזרים נדרשים לשמירת מסלול החזרה בתוך הלשונית.
- במסכים נספרו 752 קישורי אירוע, מהם 397 אירועי לחיצה, 64 מופעי חלון או בורר ו-47 מופעי קלט. ברכיבים נספרו 1,053 קישורי אירוע, מהם 722 לחיצות, 113 חלונות או בוררים ו-42 פקדי טופס. אלה מופעי מקור, לא ספירת לחצנים ייחודיים ברינדור ולא הוכחת בדיקה שלהם.
- במסכים זוהו 542 ביטויי תצוגה מותנית ו-507 משתני מצב מקומיים. ברכיבים זוהו 1,003 ביטויי תצוגה מותנית ו-395 משתני מצב. תנאי המקור ושורותיהם מפורטים בקובץ המלאי.
- לא נמצאו פערים בבדיקה הסטטית המצומצמת של יעד ניווט מילולי מתוך מסך רשום מול המחסן המארח. הבדיקה אינה מכסה ניווט דינמי, קישור חיצוני או תלות בתזמון.

[המלאי המלא לקריאה ולעדכון](inventory.json) מכיל רשומה נפרדת לכל קובץ מסך ורכיב: חותמת מקור, מסלולים, פרמטרים, ייבוא ותלויות, צרכנים, תנאים, משתני מצב, חלונות, פקדי טופס וקישורי אירועים עם שורות מקור.

## הארכיטקטורה הפעילה

היישום משתמש ב-`Expo 53`, ב-`React Native 0.79.6`, ב-`React 19` וב-`TypeScript`. מחסני `Zustand` מחזיקים מצב משתמש, מועדונים ושיחות. שירותי המוצר מפרידים בין מסד מרוחק לבין נתוני הדגמה בזיכרון. `src/firebase/config.ts` מכריע לפי הגדרה מלאה והדגל `EXPO_PUBLIC_FOOTY_FORCE_MOCK`; הפעלת הדגל מונעת את יצירת חיבור המסד דרך `getFirebase`. אין להסיק מכך ששירות חיצוני אחר מושבת בלי לבדוק את המימוש שלו.

שער השורש ב-`RootNavigator` בוחר בין פתיחה, בחירת כוונה, כניסה, השלמת פרופיל והיישום. המשתמש המלא מגיע לבית `Profile`; אורח מגיע ל-`GuestHome`. ארבע הלשוניות הן בית, מועדונים, מחזורים וחברים. כל לשונית מחזיקה מחסן משלה; מסכים משותפים נרשמים בכמה מחסנים כדי שהחזרה תשמור על מקור הכניסה.

מסלול הנתונים הוא ממשק, שירות, מסד או נתוני הדגמה, ממיר קריאה, מצב מקומי וחזרה לממשק. ממירי הקריאה ב-`src/firebase/firestore.ts` מעתיקים שדות במפורש; דמו אינו מאמת אותם. לוגיקת מחזור מחייבת הפרדה בין ערב שלם למשחק בתוכו, ושאלת קיום הערב נשענת על `eveningPlayed.ts`. נתוני עונה פעילה, ארכיון חתום והיסטוריה אישית אינם ניתנים להחלפה.

## יכולות שממומשות בקוד

- יצירת מועדון, עריכתו, הזמנות, הצטרפות, סגל, אישורים, תפקידים ולוח מנהל.
- יצירה ועריכה של מחזור ושל סדרה, רשימות וגילוי, מפה, הרשמה, אישורים, המתנה ושריון מקומות.
- חלוקת כוחות, לוח קפטנים, עריכה ידנית, פרסום קבוצות, דירוגים, לייב רגיל ומתקדם, שערים, בישולים, תוצאות, חילופים, רוטציה, פנדלים ומחזיקי ציוד.
- בית אישי, זמינות, היסטוריית מחזורים, סטטיסטיקה, כרטיס שחקן, השוואת צמד, הישגים וסיכום אישי הניתן לשיתוף.
- שיחות מועדון ומחזור, שיחות אישיות, בקשות לשיחה, חברות, חיפוש שחקנים ופרטיות.
- כניסה, השלמת פרופיל, הזמנות וקישורי כניסה, התראות ודיווח בעיה.

הרשימה מתארת מימוש קיים. היא אינה טוענת לתקינות כוללת, זמינות לכל משתמש, פריסה או אימות מול השרת.

## מקורות שאינם מסך פעיל עצמאי

- `AdvancedLiveMatchScreen` מורכב מתוך `LiveMatchScreen` לפי מצב המחזור. יש לבדוק את שני הענפים.
- `GameWizardForm` ו-`GroupWizardForm` הם טפסים משותפים; יש לבדוק יצירה ועריכה בנפרד.
- `AdminApprovalScreen` מייצא את `RequestsScreen` ככינוי; `SeasonTitlesScreen` מייצא את `AchievementsScreen` ככינוי. אין לספור אותם כמימוש נוסף.
- `OnboardingScreen` ו-`OnboardingPreviews` נשמרים מחוץ למסלול הכניסה הפעיל; מסלול ההיכרות הנוכחי הוא `PostSignInOnboardingScreen`. זהו סיווג מתועד, ולא תקלה חדשה או הוראה למחיקה.
- `AnimationLab` הוא חלון פיתוח מתוך הבית, תחת `__DEV__`.
- `SplashScreen` ומסך ההיכרות שלאחר הרשמה נבחרים בשער השורש, ולא באמצעות טבלת מסלולי הלשוניות.

## גישה למצבים שאינם בטבלת כלי הבדיקה

ב-`QARouteLauncher` יש 70 תרחישי טבלה ו-50 מסלולים ייחודיים. כלי הבדיקה מחייב `__DEV__` וגם `EXPO_PUBLIC_QA_ROUTES=1`. תרחישי המעטפת המפורטים כאן מחייבים גם `EXPO_PUBLIC_FOOTY_FORCE_MOCK=1`. אין להשתמש בהם כדי להוכיח תפקוד מסד או הרשאות ייצור.

| מסלול שאינו בטבלה | גישה קיימת | מגבלה |
|---|---|---|
| `SocialPrivacy` | `footy://qa/_social_privacy` | מסך אמיתי במחסן השיחות |
| `ProfileSetup` | `footy://qa/ProfileSetup` | מעטפת חלון עם רכיב המקור, לא מעבר זהות שלם |
| `EntryIntent` | `footy://qa/_entry_invite` | מעטפת בחירת כוונה בהקשר הזמנה |
| `SignIn` | `footy://qa/_overlay_audit_night_signin` | מעטפת חלון, לא כשל אתחול מלא |
| `MyActivity` | דרך המחסן שבו הוא רשום, או גישה מקומית בתיאום הסוכן הראשי | הדגל כבוי ולכן נדרשת בדיקת הודעת אי זמינות בלבד |

המלאי מפרט שמות תרחיש שונים שמגיעים לאותו מסלול עם נתוני קלט אחרים, כגון סיכום אישי שקט, סיכום מוביל ונתונים ריקים או מלאים. מצב משחק חי ללא קבוצות, שגיאות קריאה, חלונות הרשמה ובקשות לשיחה נמצאים בענפי התרחישים המיוחדים, מחוץ לטבלת המסלולים. הפניה אינה הוכחה שהתרחיש נפתח בהצלחה בסביבה הנוכחית.

## פערים ומגבלות שנמצאו

1. המסמך הראשי `README.md` עדיין מתאר בכמה סעיפים ענפי מסד ריקים ותכנית מימוש, בעוד השירותים וממירי המסד ממומשים כיום. אין להשתמש בסעיפים אלה כהוכחה לפיצר חסר. יש להעדיף את מפת הפיצרים ואת המקור העדכני.
2. ספירת מסלולי כלי הבדיקה אינה מכסה את שערי האתחול, מצבים פנימיים, חלונות או נתונים מותנים. פתיחת כל שורות הטבלה בלבד אינה ביקורת מלאה.
3. `src/config/sportsActivity.json` מכיל `enabled: false` בעקבות החלטת הבעלים. מסך הפעילות נותר רשום לצורך מצב שמור, אבל מודעת שיווק אינה רשאית להציג מדידה כשירות זמין.
4. כל 62 קובצי המסך מופיעים גם במפת המצב הקצרה וגם במפת הכיסוי. לא נמצא קובץ מסך חדש ללא אזכור במפות אלה.
5. אין בסוכן זה ראיה חזותית חדשה או בדיקה תפקודית. מספר המסכים שאומתו באימולטור במסגרת סוכן זה הוא אפס. אין לסמן מסך כמושלם על סמך הדוח.
6. מיפוי הקוד מכסה את כל הקבצים, אך אינו קריאה סמנטית ידנית של כל אחת מ-96,076 שורות המסכים והרכיבים. מצבים נאספו מתוך מבנה הקוד כדי לאפשר בדיקה ממוקדת בלי להמציא כיסוי שלא בוצע.

## רשימת המסכים

העמודות המספריות סופרות מופעי מקור בלבד. ערך אפס במסך מעטפת עשוי להצביע על רכיב ילד שמכיל את כל הפעולות. טבלת הרכיבים והתלויות בקובץ המלאי מכסה אותם. לכל קובץ נשמר מצב בדיקה נפרד ושישה שמות שלבים לפי בקשת הבעלים. כרגע המיפוי הסטטי הושלם והבדיקה בהרצה טרם בוצעה במסגרת סוכן זה.

| מקור | מסלולים | לחיצות | חלונות ובוררים | פקדי טופס | מצב חזותי ותפקודי |
|---|---|---:|---:|---:|---|
| [src/screens/AdvancedLiveMatchScreen.tsx](../../../src/screens/AdvancedLiveMatchScreen.tsx) | ללא מסלול עצמאי | 24 | 10 | 0 | טרם נבדק בהרצה |
| [src/screens/auth/EmailAuthScreen.tsx](../../../src/screens/auth/EmailAuthScreen.tsx) | EmailAuth | 6 | 0 | 2 | טרם נבדק בהרצה |
| [src/screens/auth/ProfileSetupScreen.tsx](../../../src/screens/auth/ProfileSetupScreen.tsx) | ProfileSetup | 6 | 0 | 1 | טרם נבדק בהרצה |
| [src/screens/auth/SignInScreen.tsx](../../../src/screens/auth/SignInScreen.tsx) | SignIn | 4 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/chat/ChatsListScreen.tsx](../../../src/screens/chat/ChatsListScreen.tsx) | ChatsList | 1 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/chat/CommunityChatScreen.tsx](../../../src/screens/chat/CommunityChatScreen.tsx) | CommunityChat | 0 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/chat/DirectChatScreen.tsx](../../../src/screens/chat/DirectChatScreen.tsx) | DirectChat | 2 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/chat/GameChatScreen.tsx](../../../src/screens/chat/GameChatScreen.tsx) | GameChat | 1 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/communities/CommunityDetailsPublicScreen.tsx](../../../src/screens/communities/CommunityDetailsPublicScreen.tsx) | CommunityDetailsPublic | 6 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/communities/CommunityDetailsScreen.tsx](../../../src/screens/communities/CommunityDetailsScreen.tsx) | CommunityDetails | 15 | 7 | 0 | טרם נבדק בהרצה |
| [src/screens/communities/CommunityEditScreen.tsx](../../../src/screens/communities/CommunityEditScreen.tsx) | CommunityEdit | 0 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/communities/CommunityHistoryScreen.tsx](../../../src/screens/communities/CommunityHistoryScreen.tsx) | CommunityHistory | 3 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/communities/CommunityPlayersScreen.tsx](../../../src/screens/communities/CommunityPlayersScreen.tsx) | CommunityPlayers | 6 | 4 | 1 | טרם נבדק בהרצה |
| [src/screens/communities/CommunityStatsScreen.tsx](../../../src/screens/communities/CommunityStatsScreen.tsx) | CommunityStats | 6 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/communities/ManagerDashboardScreen.tsx](../../../src/screens/communities/ManagerDashboardScreen.tsx) | ManagerDashboard | 17 | 2 | 1 | טרם נבדק בהרצה |
| [src/screens/communities/PublicGroupsFeedScreen.tsx](../../../src/screens/communities/PublicGroupsFeedScreen.tsx) | CommunitiesFeed | 7 | 1 | 1 | טרם נבדק בהרצה |
| [src/screens/dev/AnimationLab.tsx](../../../src/screens/dev/AnimationLab.tsx) | ללא מסלול עצמאי | 4 | 1 | 0 | טרם נבדק בהרצה |
| [src/screens/entry/IntentScreen.tsx](../../../src/screens/entry/IntentScreen.tsx) | EntryIntent | 2 | 1 | 0 | טרם נבדק בהרצה |
| [src/screens/FeedbackScreen.tsx](../../../src/screens/FeedbackScreen.tsx) | Feedback | 6 | 0 | 1 | טרם נבדק בהרצה |
| [src/screens/games/AddMembersScreen.tsx](../../../src/screens/games/AddMembersScreen.tsx) | AddMembers | 3 | 0 | 1 | טרם נבדק בהרצה |
| [src/screens/games/AvailablePlayersScreen.tsx](../../../src/screens/games/AvailablePlayersScreen.tsx) | AvailablePlayers | 8 | 0 | 1 | טרם נבדק בהרצה |
| [src/screens/games/DraftBoardScreen.tsx](../../../src/screens/games/DraftBoardScreen.tsx) | DraftBoard | 15 | 1 | 0 | טרם נבדק בהרצה |
| [src/screens/games/DraftSetupScreen.tsx](../../../src/screens/games/DraftSetupScreen.tsx) | DraftSetup | 17 | 1 | 0 | טרם נבדק בהרצה |
| [src/screens/games/EveningSummaryScreen.tsx](../../../src/screens/games/EveningSummaryScreen.tsx) | EveningSummary | 2 | 1 | 0 | טרם נבדק בהרצה |
| [src/screens/games/GameCreateScreen.tsx](../../../src/screens/games/GameCreateScreen.tsx) | GameCreate | 8 | 3 | 0 | טרם נבדק בהרצה |
| [src/screens/games/GameEditScreen.tsx](../../../src/screens/games/GameEditScreen.tsx) | GameEdit | 0 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/games/GamesListScreen.tsx](../../../src/screens/games/GamesListScreen.tsx) | GamesList | 14 | 5 | 0 | טרם נבדק בהרצה |
| [src/screens/games/GameWizardForm.tsx](../../../src/screens/games/GameWizardForm.tsx) | ללא מסלול עצמאי | 10 | 6 | 13 | טרם נבדק בהרצה |
| [src/screens/games/MatchDetailsScreen.tsx](../../../src/screens/games/MatchDetailsScreen.tsx) | MatchDetails | 29 | 5 | 0 | טרם נבדק בהרצה |
| [src/screens/games/MatchPlayersScreen.tsx](../../../src/screens/games/MatchPlayersScreen.tsx) | MatchPlayers | 21 | 4 | 0 | טרם נבדק בהרצה |
| [src/screens/games/MatchRoundsScreen.tsx](../../../src/screens/games/MatchRoundsScreen.tsx) | MatchRounds | 4 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/games/PromoteOrphanScreen.tsx](../../../src/screens/games/PromoteOrphanScreen.tsx) | PromoteOrphan | 4 | 0 | 6 | טרם נבדק בהרצה |
| [src/screens/groups/AdminApprovalScreen.tsx](../../../src/screens/groups/AdminApprovalScreen.tsx) | AdminApproval | 0 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/groups/CreateGroupScreen.tsx](../../../src/screens/groups/CreateGroupScreen.tsx) | CommunitiesCreate | 0 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/groups/GroupWizardForm.tsx](../../../src/screens/groups/GroupWizardForm.tsx) | ללא מסלול עצמאי | 4 | 0 | 8 | טרם נבדק בהרצה |
| [src/screens/home/AvailabilityWeekScreen.tsx](../../../src/screens/home/AvailabilityWeekScreen.tsx) | AvailabilityWeek | 0 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/home/GuestHomeScreen.tsx](../../../src/screens/home/GuestHomeScreen.tsx) | GuestHome | 9 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/invite/PersonalInviteScreen.tsx](../../../src/screens/invite/PersonalInviteScreen.tsx) | PersonalInvite | 8 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/LiveMatchScreen.tsx](../../../src/screens/LiveMatchScreen.tsx) | LiveMatch | 13 | 3 | 0 | טרם נבדק בהרצה |
| [src/screens/map/MapScreen.tsx](../../../src/screens/map/MapScreen.tsx) | CommunitiesMap, GamesMap | 11 | 2 | 2 | טרם נבדק בהרצה |
| [src/screens/onboarding/OnboardingPreviews.tsx](../../../src/screens/onboarding/OnboardingPreviews.tsx) | ללא מסלול עצמאי | 0 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/onboarding/OnboardingScreen.tsx](../../../src/screens/onboarding/OnboardingScreen.tsx) | ללא מסלול עצמאי | 3 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/onboarding/PostSignInOnboardingScreen.tsx](../../../src/screens/onboarding/PostSignInOnboardingScreen.tsx) | ללא מסלול עצמאי | 3 | 0 | 2 | טרם נבדק בהרצה |
| [src/screens/players/PlayerCardScreen.tsx](../../../src/screens/players/PlayerCardScreen.tsx) | PlayerCard | 8 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/players/PlayerCompareScreen.tsx](../../../src/screens/players/PlayerCompareScreen.tsx) | PlayerCompare | 3 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/players/PlayerTimelineScreen.tsx](../../../src/screens/players/PlayerTimelineScreen.tsx) | PlayerTimeline | 4 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/profile/AchievementsScreen.tsx](../../../src/screens/profile/AchievementsScreen.tsx) | Achievements | 4 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/profile/AvailabilityEditScreen.tsx](../../../src/screens/profile/AvailabilityEditScreen.tsx) | AvailabilityEdit | 8 | 2 | 3 | טרם נבדק בהרצה |
| [src/screens/profile/BlockedUsersScreen.tsx](../../../src/screens/profile/BlockedUsersScreen.tsx) | BlockedUsers | 2 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/profile/FriendsScreen.tsx](../../../src/screens/profile/FriendsScreen.tsx) | Friends | 9 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/profile/MyActivityScreen.tsx](../../../src/screens/profile/MyActivityScreen.tsx) | MyActivity | 14 | 2 | 0 | טרם נבדק בהרצה |
| [src/screens/profile/NotificationsSettingsScreen.tsx](../../../src/screens/profile/NotificationsSettingsScreen.tsx) | NotificationsSettings | 4 | 0 | 2 | טרם נבדק בהרצה |
| [src/screens/profile/ReferralsListScreen.tsx](../../../src/screens/profile/ReferralsListScreen.tsx) | Referrals | 4 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/profile/SeasonSummaryScreen.tsx](../../../src/screens/profile/SeasonSummaryScreen.tsx) | SeasonSummary | 2 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/profile/SeasonTitlesScreen.tsx](../../../src/screens/profile/SeasonTitlesScreen.tsx) | SeasonTitles | 0 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/profile/SocialPrivacyScreen.tsx](../../../src/screens/profile/SocialPrivacyScreen.tsx) | SocialPrivacy | 4 | 0 | 1 | טרם נבדק בהרצה |
| [src/screens/profile/StatisticsScreen.tsx](../../../src/screens/profile/StatisticsScreen.tsx) | Statistics | 5 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/RequestsScreen.tsx](../../../src/screens/RequestsScreen.tsx) | Requests | 12 | 1 | 0 | טרם נבדק בהרצה |
| [src/screens/SplashScreen.tsx](../../../src/screens/SplashScreen.tsx) | ללא מסלול עצמאי | 1 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/tabs/HistoryScreen.tsx](../../../src/screens/tabs/HistoryScreen.tsx) | History | 2 | 0 | 0 | טרם נבדק בהרצה |
| [src/screens/tabs/ProfileEditScreen.tsx](../../../src/screens/tabs/ProfileEditScreen.tsx) | ProfileEdit | 3 | 0 | 1 | טרם נבדק בהרצה |
| [src/screens/tabs/ProfileScreen.tsx](../../../src/screens/tabs/ProfileScreen.tsx) | Profile | 6 | 2 | 0 | טרם נבדק בהרצה |

## קבוצות הרכיבים

| תיקיית רכיבים | מספר קבצים |
|---|---:|
| `shared-root` | 65 |
| `match` | 52 |
| `community` | 34 |
| `anim` | 26 |
| `profile` | 20 |
| `home` | 14 |
| `games` | 10 |
| `chat` | 8 |
| `social` | 8 |
| `summary` | 8 |
| `anim/game` | 6 |
| `draft` | 6 |
| `manager` | 6 |
| `activity` | 4 |
| `stats` | 4 |
| `chemistry` | 3 |
| `club` | 3 |
| `forms` | 3 |
| `joryio` | 3 |
| `match/tabs` | 3 |
| `availability` | 2 |
| `entry` | 2 |
| `feedback` | 2 |
| `loading` | 2 |
| `notifications` | 2 |
| `support` | 2 |
| `auth` | 1 |
| `compare` | 1 |
| `map` | 1 |
| `players` | 1 |

הזהות המשותפת נשענת על `src/theme/colors.ts`, `spacing.ts`, `typography.ts`, `rtl.ts`, `motionTokens.ts` ו-`overlays.ts`. ערכת הרכיבים כוללת כפתור, שדות קלט, כותרת מסך, חלונות בטוחים, חלונות נגררים, התראות, שלדי טעינה ותנועה. קיימים רכיבי עיצוב תחומיים למשחק, מועדון, בית, שיחה וסטטיסטיקה. ריבוי צבעים מקומיים אינו לבדו הוכחת תקלה חזותית.

## סדר הבדיקה המומלץ

1. פתיחה, אורח, בחירת כוונה, כניסה והשלמת פרופיל, לרבות חזרה להזמנה ולטיוטה.
2. ארבע לשוניות המקור, מצבי ריק, טעינה וכשל וחזרה ממסך עמוק.
3. מועדון ציבורי לעומת חבר ומנהל, בקשות, הזמנות, סגל, ציוד והגדרות.
4. יצירה ועריכה של מחזור, הרשמה, המתנה, אישור מקום, מחזור סגור ומחזור שהסתיים.
5. חלוקה אוטומטית, ידנית וקפטנים, טיוטה מול פרסום, לייב רגיל ומתקדם, תוצאות וסיכומים.
6. שיחות, חיפוש שחקנים, בקשות לשיחה ופרטיות. סטטיסטיקה והיסטוריה עם תחום ומכנה מפורשים.
7. חזרה על מסלולים ושינויים לאחר ליטוש, בדיקת טיפוסים וכל חבילת הבדיקות, ולאחר מכן הפקת חומרי שיווק רק מתוך יכולות שהוכחו.
