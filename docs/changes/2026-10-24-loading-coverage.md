# מפת כיסוי טעינות ופעולות - הלילה 24-25.10.2026

כל 61 קובצי המסכים נכללו בסריקה התחבירית. נסרקו גם 279 רכיבים, 14 קובצי ניווט, 120 שירותים ושש חנויות נתונים. המספרים הם מופעי קוד, ולא מסכים שהורצו, מספר בקשות רשת או כפתורים ייחודיים. מאפייני אירוע כוללים גם גלילה, פריסה ושינוי בחירה. תבנית הקריאות כוללת גם בוררים ופעולות מקומיות; אין לפרש אותה כעלות מסד.

במיפוי המעודכן הוגדרה תבנית ניווט שמחריגה פעולות מערך ומחרוזת וכוללת פעולות שליחת ניווט, ונכללו כל מאפייני האירוע המתחילים ב-`on`. שינוי המספרים מהמיפוי הקודם נובע גם מהגדרת הסורק, ולא רק משינוי האפליקציה. שורות, קטעי מקור וחותמות מלאות נשמרו ב-`artifacts/loading-performance-2026-10-24/inventory.json`.

| קובץ מסך | אפקטים | קריאות לבדיקה | ניווט | מאפייני אירוע | תחום הבדיקה והמגבלה |
|---|---:|---:|---:|---:|---|
| [AdvancedLiveMatchScreen.tsx](../../src/screens/AdvancedLiveMatchScreen.tsx) | 11 | 12 | 8 | 56 | תלות הטעינה מוגבלת לזהות ולמצב אורח; עדכון פרופיל בלבד אינו טוען שוב. שינוי גישה רלוונטי עדיין מרענן. |
| [FeedbackScreen.tsx](../../src/screens/FeedbackScreen.tsx) | 1 | 0 | 2 | 9 | הטופס מקומי. הכנת תמונה מתבצעת בבחירה ובסימון, ושליחה ממתינה לאישור שמירת הדיווח; אין קריאת נתונים חוסמת בפתיחה. |
| [LiveMatchScreen.tsx](../../src/screens/LiveMatchScreen.tsx) | 7 | 7 | 7 | 17 | תלות הטעינה מוגבלת לזהות ולמצב אורח; עדכון פרופיל בלבד אינו טוען שוב. שינוי גישה רלוונטי עדיין מרענן. |
| [RequestsScreen.tsx](../../src/screens/RequestsScreen.tsx) | 2 | 3 | 1 | 17 | נתיב מיקוד יחיד עם דור וחשבון אורח. שינויי אישור ורענון ממתינים לכתיבה; לא הוסרו שערי עדכניות. |
| [SplashScreen.tsx](../../src/screens/SplashScreen.tsx) | 7 | 1 | 0 | 1 | נבדקו מסלול ההפעלה ושער ההזמנה. נשארה השהיית מותג מכוונת של 1.4 שניות; שער ההזמנה מסתיים כשמוכן ומוגבל ב-4.5 שניות. |
| [auth/EmailAuthScreen.tsx](../../src/screens/auth/EmailAuthScreen.tsx) | 2 | 5 | 2 | 9 | הזדהות קודמת לחידוש הפעולה הממתינה. אין לקצר המתנה ליצירת זהות באמצעות חידוש פעולה מוקדם. |
| [auth/ProfileSetupScreen.tsx](../../src/screens/auth/ProfileSetupScreen.tsx) | 1 | 2 | 1 | 8 | בחירת תמונה והעלאתה קודמות לשמירת הפרופיל; בחירת אווטאר מקומית. מחיקת תמונה ישנה מתבצעת רק אחרי שמירה מוצלחת ואינה חוסמת אותה. |
| [auth/SignInScreen.tsx](../../src/screens/auth/SignInScreen.tsx) | 0 | 0 | 1 | 4 | הכפתורים ממתינים לספק ההזדהות ומציגים מצב המתנה ייעודי. לא נבדק זמן הספק במכשיר. |
| [chat/ChatsListScreen.tsx](../../src/screens/chat/ChatsListScreen.tsx) | 1 | 0 | 2 | 1 | תוקנה טעינת פרופילים חוזרת ברכיב רשימת השיחות המשותף. |
| [chat/CommunityChatScreen.tsx](../../src/screens/chat/CommunityChatScreen.tsx) | 0 | 0 | 0 | 0 | שם המועדון ותפקיד נלקחים מהחנות. תוכן השיחה מנוהל ברכיב השיחה המשותף. |
| [chat/DirectChatScreen.tsx](../../src/screens/chat/DirectChatScreen.tsx) | 1 | 1 | 0 | 1 | הוסר סימון קריאה כפול שחסם פתיחה; סימון במיקוד ובהודעה חדשה נשאר ברכיב ההודעות. שערי הגישה נבדקו בקוד. |
| [chat/GameChatScreen.tsx](../../src/screens/chat/GameChatScreen.tsx) | 2 | 1 | 0 | 1 | נבדק מנוי הורה המחזור ושער הגישה. תוכן השיחה מנוהל ברכיב משותף. |
| [communities/CommunityDetailsPublicScreen.tsx](../../src/screens/communities/CommunityDetailsPublicScreen.tsx) | 3 | 5 | 4 | 8 | מידע ציבורי ומחזורים קרובים נקראים במקביל. המיקוד הוא נתיב הטעינה; הצטרפות נשארה פעולה מאושרת בשרת. |
| [communities/CommunityDetailsScreen.tsx](../../src/screens/communities/CommunityDetailsScreen.tsx) | 6 | 21 | 12 | 36 | המועדון קודם לנתונים התלויים בו; שמות ומחזורים נקראים במקביל ומתפרסמים בחלקים. דירוגים נשארו מאחורי אישור השרת. |
| [communities/CommunityEditScreen.tsx](../../src/screens/communities/CommunityEditScreen.tsx) | 0 | 0 | 1 | 3 | ערכים מקוריים מועברים לטופס. השמירה ואחריה רענון החנות נשמרו לצורך עדכניות ההגדרות והגישה. |
| [communities/CommunityHistoryScreen.tsx](../../src/screens/communities/CommunityHistoryScreen.tsx) | 1 | 1 | 1 | 3 | טעינת היסטוריה אחת; מסנן השתתפות מקומי ושגיאה נפרדת מרשימה ריקה. |
| [communities/CommunityPlayersScreen.tsx](../../src/screens/communities/CommunityPlayersScreen.tsx) | 2 | 4 | 3 | 12 | הסגל ממוין לפי מספר מחזורים ומציג ציוני מנהל וסמלי כרטיסים. פרסום לפני סטטיסטיקה ודירוגים עלול להציג אפסים וסדר שיתחלף. הצגה מוקדמת דורשת מצב מידע חסר מפורש; לא בוצעה עקיפה של שער הדירוגים. |
| [communities/CommunityStatsScreen.tsx](../../src/screens/communities/CommunityStatsScreen.tsx) | 4 | 10 | 5 | 10 | נבדק רצף עונה עקבי; הנתונים התלויים בעונה נקראים במקביל אחרי המועדון. היסטוריה ארוכה ופתרון שמות דורשים מדידה. |
| [communities/ManagerDashboardScreen.tsx](../../src/screens/communities/ManagerDashboardScreen.tsx) | 4 | 2 | 5 | 28 | נבדקו שערי ניהול; תור ציונים ותוצאות שופר בשירותים המשותפים. |
| [communities/PublicGroupsFeedScreen.tsx](../../src/screens/communities/PublicGroupsFeedScreen.tsx) | 5 | 2 | 4 | 13 | בוטלה השהיית הקלדה בחיפוש ריק; הקריאה המלאה של מועדונים ציבוריים נשארה נושא לעימוד. |
| [dev/AnimationLab.tsx](../../src/screens/dev/AnimationLab.tsx) | 8 | 0 | 0 | 5 | מופו אפקטים ותצוגות הנפשה של כלי הפיתוח; לא נמדדו במכשיר. |
| [entry/IntentScreen.tsx](../../src/screens/entry/IntentScreen.tsx) | 2 | 1 | 0 | 5 | שערי הכניסה מקומיים ותלויים בכוונה שנשמרה. אחרי הזדהות מרוענן הפרופיל לפני הכרעת הנתיב; לא נעקף שער זהות. |
| [games/AddMembersScreen.tsx](../../src/screens/games/AddMembersScreen.tsx) | 2 | 3 | 1 | 4 | תלות הטעינה מוגבלת לזהות ולמצב אורח; עדכון פרופיל בלבד אינו טוען שוב. שינוי גישה רלוונטי עדיין מרענן. |
| [games/AvailablePlayersScreen.tsx](../../src/screens/games/AvailablePlayersScreen.tsx) | 1 | 1 | 1 | 11 | המועמדים מתקבלים בדפדוף מהשרת לאחר פתרון המחזור. נשמרו סמן עמוד, מניעת טעינה מקבילה והפרדת הקשר. |
| [games/DraftBoardScreen.tsx](../../src/screens/games/DraftBoardScreen.tsx) | 2 | 4 | 8 | 19 | טעינת מיקוד קשורה לזהות טיוטה ולגרסה צפויה בחזרה משמירה. גרירה מקומית ואישור שמירה נשמרו. |
| [games/DraftSetupScreen.tsx](../../src/screens/games/DraftSetupScreen.tsx) | 3 | 5 | 5 | 27 | שער הרשאת מנהל וטעינת חלוקה שמורה נשמרו. הנפשת חישוב משלימה לפחות 300 אלפיות שנייה; קיצורה הוא החלטת חוויה. |
| [games/EveningSummaryScreen.tsx](../../src/screens/games/EveningSummaryScreen.tsx) | 1 | 2 | 0 | 4 | סיכום הבסיס מוצג לפני סיום קריאת שיאים אישיים. שיתוף מחכה להתייצבות פריסת הצילום. |
| [games/GameCreateScreen.tsx](../../src/screens/games/GameCreateScreen.tsx) | 4 | 9 | 1 | 13 | טיוטה, יצירה וצריכת טיוטה תלויות זו בזו למניעת יצירה כפולה ושיוך לחשבון הלא נכון. אין לאחד כתיבות אלה במקביל. |
| [games/GameEditScreen.tsx](../../src/screens/games/GameEditScreen.tsx) | 1 | 5 | 2 | 1 | קריאת מחזור אחת לפני הטופס. שמירת נראות, הגדרות וסדרה דורשת אישורי כתיבה ושמירת הסדר הקיים. |
| [games/GameWizardForm.tsx](../../src/screens/games/GameWizardForm.tsx) | 2 | 2 | 0 | 43 | שלבים ושדות נשמרים מקומית. כפתור שמירה והגנת שינויים שלא נשמרו מחכים לתוצאת השליחה. |
| [games/GamesListScreen.tsx](../../src/screens/games/GamesListScreen.tsx) | 8 | 8 | 10 | 35 | ארבע רשימות נטענות במקביל. זהויות אינן חוסמות פרסום; המתנת 800 אלפיות שנייה חלה רק בגיבוי לרענון חסר אחרי שינוי הרשמה. |
| [games/MatchDetailsScreen.tsx](../../src/screens/games/MatchDetailsScreen.tsx) | 15 | 6 | 23 | 51 | המיקוד כבר טוען פעם אחת. המנוי מעדכן מחזור וסגל ההורה משותף לרכיב השחקנים; פתרון זהויות אינו חוסם פרסום. |
| [games/MatchPlayersScreen.tsx](../../src/screens/games/MatchPlayersScreen.tsx) | 3 | 7 | 1 | 39 | תוקנו טעינה כפולה ופרסום תשובה ישנה; נבדק גם מצב בשליטת ההורה. |
| [games/MatchRoundsScreen.tsx](../../src/screens/games/MatchRoundsScreen.tsx) | 3 | 4 | 0 | 5 | נתוני המחזור והמשחקים נקראים במקביל. המיקוד הראשון מדולג במכוון כי אפקט ההרכבה כבר טוען. |
| [games/PromoteOrphanScreen.tsx](../../src/screens/games/PromoteOrphanScreen.tsx) | 1 | 1 | 1 | 11 | קריאת המחזור מספקת את הסגל והקשר המועדון. הקמת מועדון מהמחזור ממתינה לתוצאת שרת לפני ניווט. |
| [groups/AdminApprovalScreen.tsx](../../src/screens/groups/AdminApprovalScreen.tsx) | 0 | 0 | 0 | 0 | מסך מעטפת שמייצא את RequestsScreen. אין מסלול טעינה נפרד. |
| [groups/CreateGroupScreen.tsx](../../src/screens/groups/CreateGroupScreen.tsx) | 1 | 1 | 1 | 1 | טיוטה נשמרת, יצירת המועדון מחזירה מזהה ורק אחריה נצרכת הטיוטה ומתבצע ניווט. סדר זה מונע יצירה כפולה. |
| [groups/GroupWizardForm.tsx](../../src/screens/groups/GroupWizardForm.tsx) | 2 | 0 | 0 | 18 | מעברי השלבים מקומיים; כפתור השליחה ממתין לשמירה ומגן על שינויים שלא נשמרו. |
| [home/AvailabilityWeekScreen.tsx](../../src/screens/home/AvailabilityWeekScreen.tsx) | 1 | 0 | 2 | 2 | משתמש ברכיב הזמינות המשותף; לשירות כבר יש מטמון של 15 דקות, שיתוף בקשה פעילה, הפרדת חשבון וביטול אחרי שמירה. |
| [home/GuestHomeScreen.tsx](../../src/screens/home/GuestHomeScreen.tsx) | 3 | 1 | 8 | 10 | בחירת טיוטת המשך נותנת קדימות למועדון וקוראת טיוטת מחזור רק אם אין מועדון. אלה קריאות מקומיות עם פסילת תשובה לאחר עזיבה. |
| [invite/PersonalInviteScreen.tsx](../../src/screens/invite/PersonalInviteScreen.tsx) | 3 | 0 | 3 | 10 | שם המזמין ופעילותו נטענים במסלולים נפרדים כדי שהכותרת לא תמתין לשאילתות הפעילות. לא נוסף שער המתנה. |
| [map/MapScreen.tsx](../../src/screens/map/MapScreen.tsx) | 1 | 9 | 4 | 16 | מקבל סמנים בפרמטרי ניווט ומסנן מקומית. מיקום אינו חוסם פתיחה; מגבלת חמש שניות מופעלת רק בכפתור מצא אותי. |
| [onboarding/OnboardingPreviews.tsx](../../src/screens/onboarding/OnboardingPreviews.tsx) | 0 | 1 | 0 | 0 | תצוגות היכרות מקומיות. קריאת גודל חלון היא דוגמה למופע שאינו קריאת רשת. |
| [onboarding/OnboardingScreen.tsx](../../src/screens/onboarding/OnboardingScreen.tsx) | 1 | 1 | 0 | 4 | מעברי השקופיות מקומיים. סיום נשמר לפני מעבר לשער ההזדהות; אין בקשת מסד לכל שקופית. |
| [onboarding/PostSignInOnboardingScreen.tsx](../../src/screens/onboarding/PostSignInOnboardingScreen.tsx) | 2 | 3 | 0 | 8 | שמירת הפרופיל יכולה להמתין עד ארבע שניות להמרת עיר לנקודה. כשל מיקום אינו מונע שמירה; השלמה מאוחרת דורשת תכנון נפרד. |
| [players/PlayerCardScreen.tsx](../../src/screens/players/PlayerCardScreen.tsx) | 6 | 11 | 3 | 9 | המסלול העצמי מפנה לרכיב כרטיס עצמאי שטוען סעיפים בנפרד. אין להסיק כפילות ממסלול עצמי ישן שאינו מורכב; נשמרו שערי הפרטיות. |
| [players/PlayerCompareScreen.tsx](../../src/screens/players/PlayerCompareScreen.tsx) | 2 | 5 | 1 | 8 | קריאת הארכיון מותנית בהוכחה שהמועדון סגר עונה. השוואה ממתינה לרשימת העונות כדי לא לסכום תחום חסר. אין לאחד בעיוורון את הקריאות הסדרתיות. |
| [players/PlayerTimelineScreen.tsx](../../src/screens/players/PlayerTimelineScreen.tsx) | 1 | 4 | 0 | 6 | המועדון והאירועים נקראים במקביל. זהויות נקראות בנפרד ואינן מעכבות את פרסום האירועים; קיימת פסילת תשובה מדור קודם. |
| [profile/AchievementsScreen.tsx](../../src/screens/profile/AchievementsScreen.tsx) | 4 | 5 | 0 | 6 | רשומת המשתמש וחישוב ההתקדמות נטענים בנפרד. מקורות חישוב ההישגים שופרו למקביליות; כשל אינו ממציא מונים. |
| [profile/AvailabilityEditScreen.tsx](../../src/screens/profile/AvailabilityEditScreen.tsx) | 3 | 1 | 1 | 18 | הטופס המקומי אינו ממתין למיקום כדי להיפתח. שמירה כבר מעדכנת את החנות ומבטלת מטמון בלי קריאה חוזרת מיותרת. |
| [profile/BlockedUsersScreen.tsx](../../src/screens/profile/BlockedUsersScreen.tsx) | 2 | 1 | 0 | 2 | מנוי חי לרשימת חסומים, עם טעינת זהויות משותפת. שש שניות הן סף לכשל חיבור שקט ולא השהיית פתיחה. |
| [profile/FriendsScreen.tsx](../../src/screens/profile/FriendsScreen.tsx) | 1 | 4 | 1 | 10 | חברים, בקשות נכנסות ובקשות יוצאות מתחילים יחד. המיקוד הוא נתיב טעינה יחיד; דור וזהות מגינים על החלפת חשבון. |
| [profile/NotificationsSettingsScreen.tsx](../../src/screens/profile/NotificationsSettingsScreen.tsx) | 3 | 5 | 1 | 6 | קריאת הסכמת המעקב המקומית מתחילה אחרי בדיקת הרשאת התראות. הן עצמאיות, אך טרם נמדד עיכוב מהותי; העדפות השרת כבר נטענות באפקט נפרד. כפתור אישור הרשאה ממתין לתוצאת מערכת לפני בדיקה חוזרת, כמתחייב. |
| [profile/ReferralsListScreen.tsx](../../src/screens/profile/ReferralsListScreen.tsx) | 1 | 4 | 1 | 6 | טעינת מיקוד יחידה עם דור ובעלות. רענון מביא הזמנות חדשות וכשל שומר רשימה קודמת לצד מצב שגיאה. |
| [profile/SeasonSummaryScreen.tsx](../../src/screens/profile/SeasonSummaryScreen.tsx) | 1 | 1 | 0 | 4 | דור קריאה מונע תשובה מאוחרת מנתיב קודם. חלקי הארכיון שופרו במקור המשותף; שיתוף ממתין להכנת הצילום. |
| [profile/SeasonTitlesScreen.tsx](../../src/screens/profile/SeasonTitlesScreen.tsx) | 0 | 0 | 0 | 0 | מסלול ישן שמייצא את מסך ההישגים, ללא מסלול קריאה עצמאי. |
| [profile/SocialPrivacyScreen.tsx](../../src/screens/profile/SocialPrivacyScreen.tsx) | 1 | 0 | 0 | 3 | ההעדפות מתחילות מחנות החשבון ואין קריאת פתיחה נפרדת. שינוי מקומי נשמר בשרת רק בלחיצה ובכפוף למצב החשבון. |
| [profile/StatisticsScreen.tsx](../../src/screens/profile/StatisticsScreen.tsx) | 1 | 4 | 2 | 6 | תוקנו טעינה כפולה, המתנה סדרתית ופתרון זהויות מאוחר. |
| [tabs/HistoryScreen.tsx](../../src/screens/tabs/HistoryScreen.tsx) | 2 | 1 | 1 | 2 | טעינת היסטוריה אישית אחת; מעבר לפרטים במחסנית הנוכחית. |
| [tabs/ProfileEditScreen.tsx](../../src/screens/tabs/ProfileEditScreen.tsx) | 2 | 0 | 2 | 5 | בחירת תמונה כרוכה בספק ובהעלאה; הטופס מקומי ושמירה מחכה לאישור. אין בסיס לקרוא להמתנת כתיבה קריאה מיותרת. |
| [tabs/ProfileScreen.tsx](../../src/screens/tabs/ProfileScreen.tsx) | 17 | 22 | 41 | 24 | נבדקו מקורות הבית. שירותי המחזורים וההישגים שופרו בלי לשנות את מסלול המיקוד. |

כל הערה ממוקדת מתייחסת למסלול המתואר בלבד, ולא לכל ענף בקובץ. אין בטבלה טענה להרצה חיה של כל מסך. [התיקונים, הבדיקות והנושאים שנותרו](2026-10-24-loading-performance.md).
