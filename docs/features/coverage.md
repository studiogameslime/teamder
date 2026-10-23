# כיסוי מסכי המקור

23.10.2026: נוסף רכיב זמני `src/components/home/CrashTestCard.tsx` בתוך מסך `Profile` הקיים, ללא מסך או נתיב חדש. מופיע לכל המשתמשים המלאים; רק אישור מפורש מפעיל בדיקת קריסה בגרסה מקורית שאינה בפיתוח. [תנאים, בדיקות וצילום](home/dashboard.md).

19.10.2026: [מלאי מצב ושיוך מלא](status/screens.md) כולל את כל קובצי המסך
באפליקציה ובפולס. זהו מיפוי קבצים למסמכי מצב, ללא טענה להרצה מחדש או
לנגישות של כל קובץ בניווט. מצב החותמות נבדק בפקודת כרטיס הפיצ׳ר.

18.10.2026: נוסף `pulse/src/screens/GameDetailScreen.tsx` דרך `pulse/src/navigation/GamesStack.tsx`, לצד רשימות התמיכה, המשתמשים והמחזורים שעוצבו מחדש. משתמשים נטענים בעימוד שרת של עשרים. [מסלול הנתונים, ניווט ומגבלות](shared/pulse-management.md#תמיכה-משתמשים-ומחזורים-לפי-הסקיצה--18102026).

18.10.2026: `pulse/src/screens/WorkspacesScreen.tsx` ו־`pulse/src/components/Workspace.tsx` מאחדים פעילות, גיוס והתראות. מזהי הנתיבים הישנים נשמרו כמפנים ללשוניות. קובצי המסכים המקוריים משמשים כגופים משותפים. [מפת הניווט והתנהגות](shared/pulse-management.md#עיצוב-פחם-ואיחוד-מרכזי-העבודה--18102026).

17.10.2026: `UpdateBanner` הוא כרטיס בתוך `HomeHero` במסך `Profile` הקיים, ומחליף את שורת הכותרת רק בהצעה רגילה. `UpdateModal` נשאר לשער חובה; אין מסך או מסלול ניווט נוסף. [מצבים, אירועים וראיות](shared/global-gates.md#חלונית-עדכון-לפי-החנות-ומדידת-השלמה--17102026).

17.10.2026: בחירת ההכרעה משובצת בתוך חלונית הפנדלים הקיימת; אין חלונית מערכת שנייה במעבר ביניהן. תצוגת הרכב בהחזקה היא שכבה בתוך הגיליון. אין נתיב חדש. [החוזה והראיות](rounds/penalties.md#החזקה-להרכב-וחלון-משותף-לבחירת-הכרעה--17102026).

17.10.2026: כפתור החזרה ב־`ShootoutWizard` פותח מחדש את בחירת ההכרעה הקיימת ב־`AdvancedLiveMatchScreen`; אין מסך חדש. חזרה והמשך שומרים בעיטות, ואישור הכרעה חלופית בלבד מוחק אותן. [התנהגות, נתונים וראיות](rounds/penalties.md#שינוי-שיטת-הכרעה-בלי-לאבד-סדרה--17102026).

17.10.2026: `MatchActionPitch` ו־`MatchPlayerPicker` משותפים לחלוניות הגול והפנדל בתוך `AdvancedLiveMatchScreen`. החלוניות שומרות בחירה ישירה והנפשה לאחר אישור שמירה. אין נתיב ניווט חדש. `MatchSteps` אינו משמש עוד את שתי החלוניות האלה. [גול ולייב](rounds/live-advanced.md) · [פנדלים](rounds/penalties.md) · [ביקורת וראיות](../changes/2026-10-17-live-action-pitch.md).

16.10.2026: `TeamShirtIllustration` בקובץ `src/components/match/TeamShirt.tsx` משותף ל־`DraftGenerationPreview`, ללוח הלייב, לחלונות התוצאה ולשורות הקבוצות הנכנסות; אין מסך או מסלול ניווט חדש. [חלוקת כוחות](rounds/draft-setup.md) · [לוח המשחק והראיות](rounds/live-advanced.md).

16.10.2026: `TieDecisionModal` ב־`Shootout.tsx` עוצב מחדש בתוך `AdvancedLiveMatchScreen`, עם אישור יציאה כפולה באותו חלון. `MatchResultPanel` הוא רכיב תוצאה משותף לחלון התיקו ול־`EndMatchModal`. אין מסך או מסלול ניווט חדש. [מצבים וראיות](rounds/live-advanced.md) · [הכרעה ופנדלים](rounds/penalties.md).

16.10.2026: `src/components/match/EndMatchModal.tsx` מחליף את אישור סיום המשחק הכללי בתוך `AdvancedLiveMatchScreen`; אין מסך או מסלול ניווט חדש. `TeamShirt` הוא רכיב ציור משותף לחלון וללוח הלייב. [מצבים, נתונים, בדיקות וצילומים](rounds/live-advanced.md).

13.10.2026: נוסף `src/components/joryio/NativeCampaignView.tsx` כמציג משותף למארח הקמפיין הקיים ולכלי הדמו. אינו מסך ואינו נתיב מוצר חדש; [מסלול, בדיקות וצילומים](shared/menus-and-motion.md).

12.10.2026: נוסף `src/dev/OverlayAuditPreview.tsx` כקיצור תצוגה מנותק לרכיבי חלוניות קיימים. אינו מסך מוצר ואינו רשום במחסניות. נדרש פיתוח, דגל נתוני דמו ודגל קיצורי בדיקה. ראיות ומגבלות: [תפריטים וחלוניות](shared/menus-and-motion.md), [מיפוי המארחים](../audits/2026-10-12-overlay-audit.md).

8.10.2026: נוסף קיצור בדיקה `FinishedMatchStats` ב־`QARouteLauncher` למסך `MatchDetails` הקיים, מחזור הדמו `gv2-7` ולשונית הסטטיסטיקות. טבלת הציונים והמיון נצפו שם. אין מסך מוצר חדש; [תיעוד הציונים והראיות](rounds/match-stats.md).

עודכן 7.10.2026 מול `8e8fde5`. הטבלה מאתרת קובצי מסך בתיעוד; קישור למסמך אינו טענה שהמסך הורץ. מצבי ההרצה והחסרונות מפורטים בכל מסמך ובתוכנית האימות.

| מסך מקור | מסמכים במפה |
|---|---|
| `src/screens/profile/SocialPrivacyScreen.tsx` | [חיפוש שחקנים ופרטיות](profile/player-discovery.md) |
| `src/screens/communities/ManagerDashboardScreen.tsx` | [לוח מנהל](clubs/manager-dashboard.md) |
| `src/screens/AdvancedLiveMatchScreen.tsx` | [coverage.md](coverage.md) · [rounds/fillers.md](rounds/fillers.md) · [rounds/live-advanced.md](rounds/live-advanced.md) |
| `src/screens/auth/EmailAuthScreen.tsx` | [coverage.md](coverage.md) · [entry/authentication.md](entry/authentication.md) |
| `src/screens/auth/ProfileSetupScreen.tsx` | [coverage.md](coverage.md) · [entry/profile-onboarding.md](entry/profile-onboarding.md) |
| `src/screens/auth/SignInScreen.tsx` | [coverage.md](coverage.md) · [entry/authentication.md](entry/authentication.md) · [entry/legacy-and-hidden.md](entry/legacy-and-hidden.md) |
| `src/screens/chat/ChatsListScreen.tsx` | [chat/chats-list.md](chat/chats-list.md) · [coverage.md](coverage.md) |
| `src/screens/chat/CommunityChatScreen.tsx` | [chat/conversation-scopes.md](chat/conversation-scopes.md) · [coverage.md](coverage.md) |
| `src/screens/chat/DirectChatScreen.tsx` | [chat/conversation-scopes.md](chat/conversation-scopes.md) · [coverage.md](coverage.md) |
| `src/screens/chat/GameChatScreen.tsx` | [chat/conversation-scopes.md](chat/conversation-scopes.md) · [coverage.md](coverage.md) |
| `src/screens/communities/CommunityDetailsPublicScreen.tsx` | [clubs/public-preview-and-join.md](clubs/public-preview-and-join.md) · [coverage.md](coverage.md) |
| `src/screens/communities/CommunityDetailsScreen.tsx` | [clubs/details.md](clubs/details.md) · [coverage.md](coverage.md) |
| `src/screens/communities/CommunityEditScreen.tsx` | [clubs/create-and-edit.md](clubs/create-and-edit.md) · [coverage.md](coverage.md) |
| `src/screens/communities/CommunityHistoryScreen.tsx` | [clubs/history.md](clubs/history.md) · [coverage.md](coverage.md) |
| `src/screens/communities/CommunityPlayersScreen.tsx` | [clubs/members-and-administration.md](clubs/members-and-administration.md) · [coverage.md](coverage.md) |
| `src/screens/communities/CommunityStatsScreen.tsx` | [coverage.md](coverage.md) · [statistics/chemistry-and-records.md](statistics/chemistry-and-records.md) · [statistics/club-leaders-and-table.md](statistics/club-leaders-and-table.md) · [statistics/scopes-and-data.md](statistics/scopes-and-data.md) |
| `src/screens/communities/PublicGroupsFeedScreen.tsx` | [clubs/discovery.md](clubs/discovery.md) · [coverage.md](coverage.md) |
| `src/screens/dev/AnimationLab.tsx` | [coverage.md](coverage.md) · [entry/legacy-and-hidden.md](entry/legacy-and-hidden.md) |
| `src/screens/entry/IntentScreen.tsx` | [coverage.md](coverage.md) · [entry/boot-and-intent.md](entry/boot-and-intent.md) |
| `src/screens/FeedbackScreen.tsx` | [coverage.md](coverage.md) · [profile/feedback.md](profile/feedback.md) |
| `src/screens/games/AddMembersScreen.tsx` | [coverage.md](coverage.md) · [rounds/add-members.md](rounds/add-members.md) |
| `src/screens/games/AvailablePlayersScreen.tsx` | [coverage.md](coverage.md) · [rounds/available-players.md](rounds/available-players.md) |
| `src/screens/games/DraftBoardScreen.tsx` | [coverage.md](coverage.md) · [rounds/draft-board.md](rounds/draft-board.md) |
| `src/screens/games/DraftSetupScreen.tsx` | [coverage.md](coverage.md) · [reviews/rounds.md](reviews/rounds.md) · [rounds/draft-setup.md](rounds/draft-setup.md) |
| `src/screens/games/EveningSummaryScreen.tsx` | [coverage.md](coverage.md) · [rounds/match-stats.md](rounds/match-stats.md) |
| `src/screens/games/GameCreateScreen.tsx` | [coverage.md](coverage.md) · [rounds/game-create.md](rounds/game-create.md) |
| `src/screens/games/GameEditScreen.tsx` | [coverage.md](coverage.md) · [rounds/game-edit.md](rounds/game-edit.md) |
| `src/screens/games/GamesListScreen.tsx` | [coverage.md](coverage.md) · [rounds/games-list.md](rounds/games-list.md) · [rounds/registration.md](rounds/registration.md) |
| `src/screens/games/GameWizardForm.tsx` | [coverage.md](coverage.md) · [rounds/game-create.md](rounds/game-create.md) · [rounds/game-edit.md](rounds/game-edit.md) |
| `src/screens/games/MatchDetailsScreen.tsx` | [coverage.md](coverage.md) · [rounds/match-details.md](rounds/match-details.md) · [rounds/registration.md](rounds/registration.md) |
| `src/screens/games/MatchPlayersScreen.tsx` | [coverage.md](coverage.md) · [rounds/match-players.md](rounds/match-players.md) · [rounds/registration.md](rounds/registration.md) |
| `src/screens/games/MatchRoundsScreen.tsx` | [coverage.md](coverage.md) · [rounds/match-rounds.md](rounds/match-rounds.md) |
| `src/screens/games/PromoteOrphanScreen.tsx` | [coverage.md](coverage.md) · [rounds/promote-orphan.md](rounds/promote-orphan.md) |
| `src/screens/groups/AdminApprovalScreen.tsx` | [clubs/requests-and-approvals.md](clubs/requests-and-approvals.md) · [coverage.md](coverage.md) |
| `src/screens/groups/CreateGroupScreen.tsx` | [clubs/create-and-edit.md](clubs/create-and-edit.md) · [coverage.md](coverage.md) |
| `src/screens/groups/GroupWizardForm.tsx` | [clubs/create-and-edit.md](clubs/create-and-edit.md) · [coverage.md](coverage.md) |
| `src/screens/home/AvailabilityWeekScreen.tsx` | [coverage.md](coverage.md) · [profile/availability-week.md](profile/availability-week.md) |
| `src/screens/home/GuestHomeScreen.tsx` | [coverage.md](coverage.md) · [home/guest-home.md](home/guest-home.md) |
| `src/screens/invite/PersonalInviteScreen.tsx` | [coverage.md](coverage.md) · [entry/personal-invite.md](entry/personal-invite.md) |
| `src/screens/LiveMatchScreen.tsx` | [coverage.md](coverage.md) · [rounds/live-timer.md](rounds/live-timer.md) |
| `src/screens/map/MapScreen.tsx` | [coverage.md](coverage.md) · [rounds/games-map.md](rounds/games-map.md) |
| `src/screens/onboarding/OnboardingPreviews.tsx` | [coverage.md](coverage.md) · [entry/legacy-and-hidden.md](entry/legacy-and-hidden.md) |
| `src/screens/onboarding/OnboardingScreen.tsx` | [coverage.md](coverage.md) · [entry/legacy-and-hidden.md](entry/legacy-and-hidden.md) |
| `src/screens/onboarding/PostSignInOnboardingScreen.tsx` | [coverage.md](coverage.md) · [entry/profile-onboarding.md](entry/profile-onboarding.md) |
| `src/screens/players/PlayerCardScreen.tsx` | [coverage.md](coverage.md) · [profile/player-card.md](profile/player-card.md) |
| `src/screens/players/PlayerCompareScreen.tsx` | [coverage.md](coverage.md) · [statistics/player-compare.md](statistics/player-compare.md) |
| `src/screens/players/PlayerTimelineScreen.tsx` | [clubs/player-management.md](clubs/player-management.md) · [coverage.md](coverage.md) |
| `src/screens/profile/AchievementsScreen.tsx` | [coverage.md](coverage.md) · [profile/achievements.md](profile/achievements.md) |
| `src/screens/profile/AvailabilityEditScreen.tsx` | [coverage.md](coverage.md) · [profile/availability-edit.md](profile/availability-edit.md) |
| `src/screens/profile/BlockedUsersScreen.tsx` | [coverage.md](coverage.md) · [profile/blocked-users.md](profile/blocked-users.md) |
| `src/screens/profile/FriendsScreen.tsx` | [coverage.md](coverage.md) · [profile/friends.md](profile/friends.md) |
| `src/screens/profile/NotificationsSettingsScreen.tsx` | [coverage.md](coverage.md) · [profile/notification-settings.md](profile/notification-settings.md) |
| `src/screens/profile/ReferralsListScreen.tsx` | [coverage.md](coverage.md) · [profile/referrals.md](profile/referrals.md) |
| `src/screens/profile/SeasonSummaryScreen.tsx` | [coverage.md](coverage.md) · [statistics/season-summary.md](statistics/season-summary.md) |
| `src/screens/profile/SeasonTitlesScreen.tsx` | [coverage.md](coverage.md) · [profile/season-titles.md](profile/season-titles.md) |
| `src/screens/profile/StatisticsScreen.tsx` | [coverage.md](coverage.md) · [statistics/personal-statistics.md](statistics/personal-statistics.md) |
| `src/screens/RequestsScreen.tsx` | [clubs/requests-and-approvals.md](clubs/requests-and-approvals.md) · [coverage.md](coverage.md) · [profile/requests.md](profile/requests.md) |
| `src/screens/SplashScreen.tsx` | [coverage.md](coverage.md) · [entry/boot-and-intent.md](entry/boot-and-intent.md) · [entry/legacy-and-hidden.md](entry/legacy-and-hidden.md) |
| `src/screens/tabs/HistoryScreen.tsx` | [coverage.md](coverage.md) · [profile/personal-history.md](profile/personal-history.md) |
| `src/screens/tabs/ProfileEditScreen.tsx` | [coverage.md](coverage.md) · [profile/profile-edit.md](profile/profile-edit.md) |
| `src/screens/tabs/ProfileScreen.tsx` | [coverage.md](coverage.md) · [home/availability-preview.md](home/availability-preview.md) · [home/dashboard.md](home/dashboard.md) · [home/home-menu.md](home/home-menu.md) · [home/round-cards.md](home/round-cards.md) · [home/tips-carousel.md](home/tips-carousel.md) |

## רישומי ניווט במקור

הרישומים הבאים נשלפו מהצהרות מסך במקור. הם מציגים מחסנית מארחת, ולא מוכיחים שכל המשתמשים יכולים להיכנס לכל יעד. תנאי השערים, תפקידים והפרמטרים מפורטים במסמכי הפיצ׳רים. יש לבדוק מעבר גם מהמחסנית שממנה המשתמש הגיע.

| יעד | מחסנית/קובץ | רכיב רשום |
|---|---|---|
| `SignIn` | [AuthStack.tsx](../../src/navigation/AuthStack.tsx) | `SignInScreen` |
| `ProfileSetup` | [AuthStack.tsx](../../src/navigation/AuthStack.tsx) | `ProfileSetupScreen` |
| `EmailAuth` | [AuthStack.tsx](../../src/navigation/AuthStack.tsx) | `EmailAuthScreen` |
| `ChatsList` | [ChatStack.tsx](../../src/navigation/ChatStack.tsx) | `ChatsListScreen` |
| `GameChat` | [ChatStack.tsx](../../src/navigation/ChatStack.tsx) | `GameChatScreen` |
| `CommunityChat` | [ChatStack.tsx](../../src/navigation/ChatStack.tsx) | `CommunityChatScreen` |
| `DirectChat` | [ChatStack.tsx](../../src/navigation/ChatStack.tsx) | `DirectChatScreen` |
| `PlayerCard` | [ChatStack.tsx](../../src/navigation/ChatStack.tsx) | `PlayerCardScreen` |
| `PlayerCompare` | [ChatStack.tsx](../../src/navigation/ChatStack.tsx) | `PlayerCompareScreen` |
| `CommunityDetails` | [ChatStack.tsx](../../src/navigation/ChatStack.tsx) | `CommunityDetailsScreen` |
| `CommunityDetailsPublic` | [ChatStack.tsx](../../src/navigation/ChatStack.tsx) | `CommunityDetailsPublicScreen` |
| `CommunitiesFeed` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `PublicGroupsFeedScreen` |
| `Requests` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `RequestsScreen` |
| `CommunitiesMap` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `MapScreen` |
| `CommunitiesCreate` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `CreateGroupScreen` |
| `EmailAuth` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `EmailAuthScreen` |
| `CommunityDetails` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `CommunityDetailsScreen` |
| `CommunityDetailsPublic` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `CommunityDetailsPublicScreen` |
| `CommunityEdit` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `CommunityEditScreen` |
| `CommunityPlayers` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `CommunityPlayersScreen` |
| `CommunityStats` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `CommunityStatsScreen` |
| `CommunityHistory` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `CommunityHistoryScreen` |
| `PlayerCard` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `PlayerCardScreen` |
| `PlayerCompare` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `PlayerCompareScreen` |
| `PlayerTimeline` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `PlayerTimelineScreen` |
| `MatchDetails` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `MatchDetailsScreen` |
| `DraftSetup` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `DraftSetupScreen` |
| `DraftBoard` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `DraftBoardScreen` |
| `EveningSummary` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `EveningSummaryScreen` |
| `SeasonSummary` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `SeasonSummaryScreen` |
| `MatchRounds` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `MatchRoundsScreen` |
| `AddMembers` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `AddMembersScreen` |
| `MatchPlayers` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `MatchPlayersScreen` |
| `AvailablePlayers` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `AvailablePlayersScreen` |
| `GameEdit` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `GameEditScreen` |
| `LiveMatch` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `LiveMatchScreen` |
| `AdminApproval` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `AdminApprovalScreen` |
| `History` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `HistoryScreen` |
| `GameCreate` | [CommunitiesStack.tsx](../../src/navigation/CommunitiesStack.tsx) | `GameCreateScreen` |
| `EntryIntent` | [EntryStack.tsx](../../src/navigation/EntryStack.tsx) | `IntentScreen` |
| `EmailAuth` | [EntryStack.tsx](../../src/navigation/EntryStack.tsx) | `EmailAuthScreen` |
| `GamesList` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `GamesListScreen` |
| `Requests` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `RequestsScreen` |
| `GamesMap` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `MapScreen` |
| `GameCreate` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `GameCreateScreen` |
| `GameEdit` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `GameEditScreen` |
| `MatchDetails` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `MatchDetailsScreen` |
| `EveningSummary` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `EveningSummaryScreen` |
| `SeasonSummary` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `SeasonSummaryScreen` |
| `MatchRounds` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `MatchRoundsScreen` |
| `LiveMatch` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `LiveMatchScreen` |
| `AvailablePlayers` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `AvailablePlayersScreen` |
| `AddMembers` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `AddMembersScreen` |
| `MatchPlayers` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `MatchPlayersScreen` |
| `DraftSetup` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `DraftSetupScreen` |
| `DraftBoard` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `DraftBoardScreen` |
| `PlayerCard` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `PlayerCardScreen` |
| `PlayerCompare` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `PlayerCompareScreen` |
| `PlayerTimeline` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `PlayerTimelineScreen` |
| `CommunityDetails` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `CommunityDetailsScreen` |
| `CommunityDetailsPublic` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `CommunityDetailsPublicScreen` |
| `AvailabilityEdit` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `AvailabilityEditScreen` |
| `CommunityEdit` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `CommunityEditScreen` |
| `CommunityPlayers` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `CommunityPlayersScreen` |
| `CommunityStats` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `CommunityStatsScreen` |
| `CommunityHistory` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `CommunityHistoryScreen` |
| `AdminApproval` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `AdminApprovalScreen` |
| `EmailAuth` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `EmailAuthScreen` |
| `History` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `HistoryScreen` |
| `PromoteOrphan` | [GameStack.tsx](../../src/navigation/GameStack.tsx) | `PromoteOrphanScreen` |
| `ProfileTab` | [MainTabs.tsx](../../src/navigation/MainTabs.tsx) | `ProfileStack` |
| `CommunitiesTab` | [MainTabs.tsx](../../src/navigation/MainTabs.tsx) | `CommunitiesStack` |
| `GameTab` | [MainTabs.tsx](../../src/navigation/MainTabs.tsx) | `GameStack` |
| `ChatTab` | [MainTabs.tsx](../../src/navigation/MainTabs.tsx) | `ChatStack` |
| `GuestHome` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `GuestHomeScreen` |
| `PersonalInvite` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `PersonalInviteScreen` |
| `Profile` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `ProfileScreen` |
| `CommunitiesCreate` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `CreateGroupScreen` |
| `CommunityDetailsPublic` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `CommunityDetailsPublicScreen` |
| `EmailAuth` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `EmailAuthScreen` |
| `AvailabilityWeek` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `AvailabilityWeekScreen` |
| `Requests` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `RequestsScreen` |
| `ProfileEdit` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `ProfileEditScreen` |
| `BlockedUsers` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `BlockedUsersScreen` |
| `AvailabilityEdit` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `AvailabilityEditScreen` |
| `NotificationsSettings` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `NotificationsSettingsScreen` |
| `PlayerCard` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `PlayerCardScreen` |
| `PlayerCompare` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `PlayerCompareScreen` |
| `PlayerTimeline` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `PlayerTimelineScreen` |
| `AdminApproval` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `AdminApprovalScreen` |
| `History` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `HistoryScreen` |
| `Achievements` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `AchievementsScreen` |
| `SeasonTitles` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `SeasonTitlesScreen` |
| `Statistics` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `StatisticsScreen` |
| `Friends` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `FriendsScreen` |
| `Referrals` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `ReferralsListScreen` |
| `Feedback` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `FeedbackScreen` |
| `MatchDetails` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `MatchDetailsScreen` |
| `DraftSetup` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `DraftSetupScreen` |
| `DraftBoard` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `DraftBoardScreen` |
| `EveningSummary` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `EveningSummaryScreen` |
| `SeasonSummary` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `SeasonSummaryScreen` |
| `MatchRounds` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `MatchRoundsScreen` |
| `AddMembers` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `AddMembersScreen` |
| `MatchPlayers` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `MatchPlayersScreen` |
| `AvailablePlayers` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `AvailablePlayersScreen` |
| `GameEdit` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `GameEditScreen` |
| `LiveMatch` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `LiveMatchScreen` |
| `CommunityDetails` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `CommunityDetailsScreen` |
| `CommunityEdit` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `CommunityEditScreen` |
| `CommunityPlayers` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `CommunityPlayersScreen` |
| `CommunityStats` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `CommunityStatsScreen` |
| `CommunityHistory` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `CommunityHistoryScreen` |
| `GameCreate` | [ProfileStack.tsx](../../src/navigation/ProfileStack.tsx) | `GameCreateScreen` |

## חלונית בדיקת הנפשות — 8.10.2026

`src/dev/MotionPreview.tsx` נפתחת דרך QARouteLauncher ב־`footy://qa/_motion` ורק עם __DEV__, QA_ROUTES=1 ו־FORCE_MOCK=1. אינה מסך מוצר או מסלול רשום במחסניות הלקוח; מציגה את רכיבי ההרשמה, ההמתנה, TeamScore וחלוניות הציוד עם מצבים מקומיים. פירוט ומגבלות: [תשתית תנועה](shared/menus-and-motion.md), [יומן ההשלמה](../changes/2026-10-08-motion-completion.md). אין לראות אותה כהוכחת כתיבת שירות או כניסה למסכי המוצר המלאים.



עדכון 9.10.2026: `ManagerDashboard` כולל גם לשונית ״תמונת מועדון״ (`initialTab: club`) וחלון פירוט עשרת המחזורים, ללא מסך עצמאי חדש. תיעוד ובדיקות בזוג מסמכי לוח המנהל.

## אתר הנחיתה — 10.10.2026

ארבעת מצבי האתר, הנתיבים הקצרים והארוכים, מעבר לחנויות וייחוס מתועדים בזוג [דף הנחיתה והזמנות](entry/landing-and-links.md). אלו דפי אתר קיימים שעוצבו מחדש, לא מסכי ניווט חדשים באפליקציה. המקור הוא `public/index.html`, `public/invite.html`, `public/c/index.html` ו־`functions/templates/invite.html`.

## ממשק הפולס — 10.10.2026

מסך מקורות הפרסום וחלון פרטי הקישור בפולס מתועדים בזוג [קישורים וספירת ייחוס](shared/pulse-links.md). הקוד נמצא ב־worktree המצוין במסמך, מחוץ למקור אפליקציית טימדר הראשית; אינו מוסיף מסך או נתיב לניווט שלה. התיעוד מבדיל בין פתיחות, חשבונות בעלי מזהה קישור ודוח מקור כללי, ומתעד בנפרד את גרסת חבילת הפולס והראיות החזותיות.

## דפי מידע באתר — 10.10.2026

מדיניות, תקנון ופרטי מחיקת חשבון מתועדים בזוג [דפי מידע באתר](entry/legal-pages.md). אלה שלושה דפי אתר קיימים שעוצבו מחדש, ללא מסך או מסלול חדש באפליקציה.

| `pulse/src/screens/OnboardingActivityScreen.tsx` | [מסלול ההצטרפות](shared/onboarding-activity.md) |

עדכון 10.10.2026: מצב פתיחה של סטטיסטיקות מועדון משתמש ב־CommunityStatsWelcome; זהו מצב של CommunityStats הקיים, ללא מסך או מסלול מוצר חדש. כלי התצוגה זמין גם בשלב הכניסה בפיתוח בלבד.

עדכון 10.10.2026: Statistics מציג כרטיס אישי ומצב התחלה מעוצב באמצעות PersonalStatisticsCard/PersonalStatisticsWelcome, באותו מסלול קיים. שיתוף תמונה נוסף בתוך המסך; אין מסך מוצר חדש.

## קרוסלה אישית בבית — 11.10.2026

נוסף רכיב `src/components/home/HomePersonalStats.tsx` במסך `ProfileScreen` הקיים, עם קישור ל־`Statistics`. [מסמכי הבית](home/dashboard.md) ו[הסטטיסטיקה](statistics/personal-statistics.md) כוללים מצבים, חישובים וראיות. קיצורי הבדיקה `ProfileStatisticsFull` ו־`ProfileStatisticsEmpty` מציגים מצבים מקומיים בלבד; לא נוספו מסכי מוצר.


11.10.2026: `ChatsList`, `PlayerCard` ו־`Statistics` הקיימים הורחבו, ללא מסלול פרופיל מקביל. [תיעוד גילוי שחקנים](profile/player-discovery.md); בדיקת נראות בנתוני המחשה בלבד.


## שער כניסה מאובטח לפולס — 11.10.2026

`pulse/src/screens/AdminLoginScreen.tsx` נוסף כשער לפני לוח הניטור. [התיעוד](../../pulse/docs/secure-access.md). ב־13.10.2026 הותקן פולס `1.0.93 / 100` באמולטור ומסך הכניסה צולם. אין הוכחת התחברות אמיתית.


## שיחות צוות בפולס — 13.10.2026

`pulse/src/screens/MessagesScreen.tsx` נשאר בנתיב `Messages` ומשמש מסך ייעודי למעקב ומענה, בתווית ״שיחות עם משתמשים״. החלונית הקיימת `TeamderChatSheet` הורחבה; לא נוסף מסך בטימדר. [התיעוד והראיות](shared/pulse-support.md). רינדור דפדפן עם נתוני בדיקה נצפה; נוסף רכיב הגדרות ותור ליווי במסך הקיים. מסך הכניסה צולם באמולטור; מסך השיחות וההגדרות נבדקו ברינדור דפדפן עם נתוני דמו בלבד. אין הוכחת דחיפה חדשה.


### הרחבת חלוקת הכוחות — 14.10.2026

בתוך `DraftSetup` נוסף מצב `free` עם [`ManualAllocation`](../../src/components/draft/ManualAllocation.tsx), מתועד ב־[חלוקת כוחות](rounds/draft-setup.md). אין מסלול משתמש חדש. מסלולי QA בלבד `ManualAllocationThree` ו־`ManualAllocationFour` מציגים מצבים מבודדים בתנאי פיתוח ודמו, ללא שמירת שרת.


14.10.2026: רכיב `src/components/match/BalancedFillModal.tsx` נוסף לתהליך הלייב הקיים; תיעוד במפת [לייב מתקדם](rounds/live-advanced.md). תצוגות הדמו `balanced_teams` ו־`balanced_fill` אינן מסכי מוצר חדשים.


## תמיכה זמינה — 14.10.2026

נוספו רכיבי חלונית גלובלית `src/components/support/SupportChatHost.tsx`, בתוך מכל הניווט הקיים, ובפולס `NewSupportChatPicker` בתוך מסך `Messages` הקיים. אין מסלול מוצר חדש. תצוגת אנדרואיד בדמו, בדיקות אבטחה, בדיקות מסד מקומי ומגבלות מתועדות ב־[תמיכה](shared/support-chat.md). קיצורי QA `_support_open` ו־`_support_draft` דורשים פיתוח, דגל קיצורים ודגל דמו; אינם פתוחים בייצור.


עדכון 15.10.2026: סקשן ״באגים שלא נפתרו״ נוסף למסך `pulse/src/screens/TasksScreen.tsx` הקיים; אין מסך או מסלול חדש. [תיבת העבודה בפולס](shared/pulse-work-inbox.md).

עדכון 15.10.2026 — מבנה סטטיסטיקות המועדון: `src/components/community/ClubStatsDashboard.tsx` משמר בחירה בין סקירה, הטבלה וצמדים ושיאים. `src/components/community/ClubStatusCard.tsx` מוסיף כרטיס מצב הכולל מונים ומובילים יחד, תצוגת צילום נקייה וייצוא תמונה לחלונית השיתוף של המכשיר. הכול בתוך `CommunityStatsScreen` הקיים, ללא מסלול חדש. העונות משותפות לכל האזורים; הטבלה נשארת מורכבת ושומרת מצב במעבר פנימי. רכיב הקישוט `FootballStatsBackdrop` והגלריה האופקית הוסרו. [מבנה המסך והראיות](statistics/club-leaders-and-table.md).


עדכון 15.10.2026 — עיצוב מלא: `ClubStatsDashboard` כולל כותרת מגרש, פס מונים, ניווט פנימי וכרטיסי מובילים. רכיבי הטבלה, בחירת העונה, הצמדים, השיאים ותרשים התוצאות תומכים במראה מקומי `appearance="club"`. `ClubStatusCard` משתמש באותה שפה לתמונת השיתוף. מסלולי הכניסה לא השתנו; מעטפת המצב המוטמע נשמרת. [ראיות ומגבלות](statistics/club-leaders-and-table.md).


עדכון 15.10.2026 — הסקיצה המאושרת נבנתה בתוך `CommunityDetails > stats`, באמצעות `CommunityStatsScreen` המוטמע. `ClubStatsDashboard` מספק מגרש, דשא, רשימת כל התארים, אזורי תוכן וכותרת טבלה. `CommunityDetailsScreen` מעביר נראות לתנועה דרך `active`. `ChemistrySection preview` מציג צמד מנצח בסקירה, וכל כרטיסי הצמדים משתמשים בסמל חיבור. מסלולים רשומים לא נוספו ולא הוסרו. [תיעוד וראיות](statistics/club-leaders-and-table.md).


עדכון 15.10.2026 — `src/components/chemistry/PairChemistryIcon.tsx` החליף את רכיב לחיצת היד ומציג סמל הישג מקומי עם תנועה סופית בכרטיסי `ChemistrySection`, בתוך לשונית הסטטיסטיקה של `CommunityDetails`. `motionEnabled` משמר נראות הלשונית, ו־`useAmbientMotion` מכבד הפחתת תנועה, מיקוד, רקע וגלילה. אין מסלול חדש. [מימוש וראיות](statistics/chemistry-and-records.md).


עדכון 15.10.2026 — `PairHandshake.tsx` הוסר והוחלף ב־`PairChemistryIcon.tsx`; חמשת סמלי ההישג מוצגים בין השחקנים במקום סמל חיבור זהה. הפסדים משתמשים בריבוע עם ×, וכל הסמלים בטורקיז. השינוי חל גם על הצמד המנצח בסקירה. לא נוסף מסך או מסלול. [מימוש, צילומים ובדיקות](statistics/chemistry-and-records.md).

## מסכי המשחק המחודשים — 16.10.2026

בתוך `LiveMatch` נוספו מצבי רכיב, ללא נתיב רשום חדש: `src/components/match/OpeningTeamsPanel.tsx`, `GoalEntryModal.tsx`, `SubstitutionModal.tsx`, `ShootoutWizard.tsx` ו־`MatchSteps.tsx`. הם מתועדים ב־[לייב מתקדם](rounds/live-advanced.md), [משלימים](rounds/fillers.md) ו־[פנדלים](rounds/penalties.md). חלון ההשלמות הקיים נשמר; בורר הפנדלים הישן ולוח המגרש הוחלפו, וחלון צפייה נפרד בהרכב המתנה אינו נדרש כשכל ההרכב גלוי. קיצורי `_live_design_*` הם תרחישי פיתוח ודמו בלבד, עם משחקים ושחקנים בזיכרון ללא יצירת חשבונות או מועדונים. הם אינם מסכי מוצר.


עדכון 18.10.2026: המסלולים `Requests` ו־`AdminApproval` נשמרו בכל ארבע המחסניות ומרנדרים את אותו `RequestsScreen`. קובץ `AdminApprovalScreen.tsx` הוא כינוי יצוא; כניסה ממועדון מעבירה `groupId` כסינון התחלתי. אין מסך חדש או מסלול שהוסר.

### סיכום עונה — 18.10.2026

המסלול הקיים `SeasonSummary` כולל שתי לשוניות באותה עונה: אישית ושל המועדון. בחירת העונה מתבצעת במסך הסטטיסטיקה, גם בעונה הפעילה; אין בורר נוסף בסיכום. רכיבי `SeasonClubSummary` ו־`SeasonClubShareCard` אינם מסכי ניווט חדשים. [התנהגות, חישובים וראיות](statistics/season-summary.md).


### סמלי אליפות משותפים — 18.10.2026

`SeasonTitleEmblem` משותף ל־`SeasonSummary` האישי והמועדוני, למדף התארים ולשתי תמונות השיתוף. אין מסך או מסלול חדש. [סיכום העונה](statistics/season-summary.md) · [תארים אישיים](profile/season-titles.md).


### ארון תארים משותף — 18.10.2026

`Achievements` ו־`SeasonTitles` נשארים רשומים ב־`ProfileStack` ומציגים את אותו `AchievementsScreen`, עם שתי לשוניות. `SeasonTitlesScreen.tsx` הוא כינוי יצוא למסך המלא. רכיבי `AchievementCabinetCards` ו־`SeasonTitlesShelf` הם תצוגות בתוך המסך, לא מסלולים חדשים. [הארון והראיות](profile/achievements.md) · [מקור תארי העונה](profile/season-titles.md).

### דיווח והצעה — 18.10.2026

המסלול `Feedback` נשאר בכל ארבע המחסניות הקיימות. שני כפתורי התפריט פותחים לשונית מתאימה בטופס משותף, עם מעבר פנימי ושימור טיוטה. אין מסלול חדש. [מימוש וראיות](profile/feedback.md).

## פולס — ארגון וגרסאות, 18.10.2026

כל 35 קובצי המסכים נשארו; לא הוסרו נתיבים. `Users` קוּדם לסרגל ו־`Overview` נגיש בתפריט. `pulse/src/components/DeviceVersions.tsx` מוסיף שני רכיבים למסכי `UserDetailScreen` ו־`VersionsScreen`, ללא נתיב חדש. `ErrorDetail` מקבל אוסף ומזהה. [המיפוי](../audits/2026-10-18-pulse-screen-map.md) · [התנהגות ובדיקות](shared/pulse-management.md).

הרחבת כרטיס משתמש בפולס: `pulse/src/components/UserInformation.tsx` משויך ל־[ניהול הפולס](shared/pulse-management.md), עם `UserDetailScreen` הקיים. אין מסך או נתיב נוסף. שירותי `userDetails.ts` ו־`userAuth.ts` מתועדים באותו זוג מסמכים.

### לוח משימות מאוחד — 18.10.2026

`TasksScreen` הוא מסך העבודה היחיד. `DevInbox` פותח את הלוח ככינוי ישן, ו־`Ideas` פותח את הפתוחות עם מסנן רעיונות. מסכי הרשימות הישנים נשארים בקוד לתאימות אך אינם כניסות בתפריט; `ErrorDetail` ממשיך לשמש פירוט פריט. תיעוד וצילומים: [לוח המשימות](shared/pulse-work-inbox.md).
