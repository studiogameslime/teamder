## Surface: from a fresh account to registered for a game

Everything below is read from source at `/Users/matan/Projects/soccer`. Every Hebrew string is quoted verbatim with its `src/i18n/he.ts` key and line. Nothing was observed on a device — see Open Questions.

---

### 0. Where a brand-new signed-in user lands

`RootNavigator` is the decider, in this order (`src/navigation/RootNavigator.tsx:251-279`):

1. `if (!userHydrated) return <Splash />` — :251
2. `if (!onboardingDone) return <OnboardingScreen />` — :253
3. `if (!currentUser) return <AuthStack initialRoute="SignIn" />` — :255
4. `const isGuest = currentUser.isGuest === true` — :260
5. `if (!isGuest && currentUser && !hasCompletedOnboarding) return <PostSignInOnboardingScreen />` — :267
6. `if (!isGuest && !profileComplete) return <AuthStack initialRoute="ProfileSetup" />` — :271
7. `if (!groupHydrated) return <Splash />` — :274
8. `return <MainTabs />` — :279

Explicit comment, `src/navigation/RootNavigator.tsx:275-278`: *"No more dedicated full-screen views for 'pending request' or 'new user without community'. Both states fall through to MainTabs and surface their context inline (toasts on submit + a 'pending' tag in the communities feed)."*

**The landing tab is the Profile tab, which is "home".** `initialRouteName="ProfileTab"` at `src/navigation/MainTabs.tsx:110`; `ProfileTab` renders `ProfileStack` whose configured root is `Profile` (`src/navigation/MainTabs.tsx:190`), i.e. `src/screens/tabs/ProfileScreen.tsx`.

Tab registration order (`src/navigation/MainTabs.tsx:140-186`): `ProfileTab`, `CommunitiesTab`, `GameTab`, `ChatTab`. Index 0 is visual RIGHT under forceRTL, so right→left the bar reads **בית · מועדונים · מחזורים · צ'אטים**.

| key | value | line |
|---|---|---|
| `tabHome` | `'בית'` | `src/i18n/he.ts:2887` |
| `tabCommunities` | `'מועדונים'` | `src/i18n/he.ts:1273` |
| `tabGame` | `'מחזורים'` | `src/i18n/he.ts:2885` |
| `tabChat` | `"צ'אטים"` | `src/i18n/he.ts:4049` |

> ⚠️ The file's own header comment (`src/navigation/MainTabs.tsx:27-30`) describes a **different, 3-tab** layout — *"right: Communities → center: Games (primary) → left: Profile"* — which contradicts the code below it. The comment is stale; the code is the truth.

**Branch not checked:** the guest (anonymous) session bypasses steps 5 and 6 entirely (`src/navigation/RootNavigator.tsx:257-271`), and `ProfileScreen` renders a completely different screen for a guest (see §1.9). I did not verify how a guest is created (which button starts an anonymous session) — that is the auth/onboarding surface.

---

### 1. The home screen for a user with NO club and NO games

File: `src/screens/tabs/ProfileScreen.tsx`. This is the single most important screen in the report, so every block is listed in render order with its render condition.

#### 1.1 What data the screen fetches on focus, and what it returns for an empty account

All of these are `useFocusEffect` hooks that **short-circuit to empty when there is no club** — this is what makes the empty home empty:

| state | fetch | empty-account result | line |
|---|---|---|---|
| `nextGame`, `myGames`, `createdGames` | `gameService.getMyLiveOrUpcomingGames(uid)` | `null` / `[]` | `:294-336` |
| `justPlayed` | `gameService.getJustFinishedGame(uid)` | `null` | `:337-344` |
| `openToJoin` | `gameService.getCommunityGames(uid, myCommunities.map(...))` — **guarded by `myCommunities.length === 0` → `setOpenToJoin([])`** | `[]` | `:344-372` |
| `scheduledUpcoming` | `gameService.getMyUpcomingScheduledGames(...)` — **same club guard** | `[]` | `:376-399` |
| `inboxCount` | `getInboxCount(uid)` | `0` | `:402-422` |
| `availData` | `availabilityFeedService.getAvailabilityCounts()` | see §1.6 | `:436-453` |
| `playedThisWeek`, `lastPlayedMs` | `gameService.getPlayedGames(uid, 20)` | `0`, `null` | `:456-486` |
| `playedCount` | `gameService.getPlayedGamesCount(uid)` | `0` | `:489-512` |
| `clubInsight` | `assistantInsightsService.getClubInsight(...)` — guarded by `!groupId` | `null` | `:519-542` |
| `referralCount`, `referrals` | `userService.listInvitedUsers(uid)` | `0`, `[]` | `:260-291` |

Hero selection is a pure helper: `const heroPick = pickHomeHero<Game>([], openToJoin, scheduledUpcoming)` (`src/screens/tabs/ProfileScreen.tsx:167`). With no club both arrays are empty, so `pickHomeHero` returns `{ kind: 'none', game: null }` (`src/utils/homeHero.ts:34-39`).

#### 1.2 ① Top bar — always rendered

`<HomeTopBar />` at `src/screens/tabs/ProfileScreen.tsx:1152-1168`. Component: `src/components/home/HomeDashboardParts.tsx:27-67`.

- Visual RIGHT: the user's avatar + a `chevron-down` (`:43-46`), tap → `nav.navigate('ProfileEdit')` (`ProfileScreen.tsx:1167`).
- Visual LEFT: `menu` icon → opens the hamburger (`:50-52`), and `notifications-outline` with a red dot when `inboxCount > 0` (`:53-56`), tap → `nav.navigate('Requests')` (`ProfileScreen.tsx:1157-1164`).
- Absolutely-centred logo (`src/assets/images/logo.png`, `:23`) + text.
  - `homeBrandName: 'Teamder'` — `src/i18n/he.ts:2019`

For a brand-new user the bell dot is **off** (`inboxCount` is 0).

#### 1.3 ② "הודעה מהמאמן" — the assistant card. THIS IS THE ONLY WELCOME COPY.

`<AssistantCard message={assistantMessage} greeting={coachGreeting} onCta={handleAssistantCta} />` — `src/screens/tabs/ProfileScreen.tsx:1173-1178`. Component `src/components/home/AssistantCard.tsx:27-68`.

Card header: `assistantTitle: 'הודעה מהמאמן'` — `src/i18n/he.ts:3099`.
Line rendered = `` `${he.assistantGreeting(greeting)} ${message.text}` `` (`AssistantCard.tsx:40-42`), where `assistantGreeting: (greeting) => \`${greeting},\`` — `src/i18n/he.ts:3101`.

Greeting word by device clock (`ProfileScreen.tsx:769-775`):
- `greetingMorning: 'בוקר טוב'` (05:00–11:59) — `src/i18n/he.ts:3073`
- `greetingNoon: 'צהריים טובים'` (12:00–16:59) — `:3074`
- `greetingEvening: 'ערב טוב'` (17:00–21:59) — `:3075`
- `greetingNight: 'לילה טוב'` (22:00–04:59) — `:3076`

`coachGreeting = firstName ? \`${greetWord} ${firstName}\` : greetWord` — `ProfileScreen.tsx:784`.

**Which rule fires for a brand-new user with no club.** The resolver picks the single lowest-priority-number message (`src/utils/assistant/resolve.ts:68-88`); ties break on registration order in `ASSISTANT_RULES` (`src/utils/assistant/rules.ts:769-779`). Priority bands: `src/utils/assistant/types.ts:34-51`.

For an account with 0 clubs, 0 games, no availability, no stats:
- `gameDayRule` → null (no `nextGame`) — `rules.ts:115`
- `postGameRule` → null (`lastPlayedMs == null`) — `rules.ts:174`
- `availabilityMatchRule` → null (no `bestEvening`) — `rules.ts:223-224`
- `comebackRule` → null — `rules.ts:247`
- `clubIdleRule` → null (`ctx.communities.length === 0`) — `rules.ts:273`
- `statsRule` → depends on whether the user picked a preferred position during profile setup. `statsCandidates` pushes a `position` candidate whenever `ctx.user?.position` is set (`rules.ts:632-638`). If it is, `statsRule` fires at `STATS: 5` and **outranks the welcome line**, and the coach's first ever sentence becomes `he.assistantPositionLine(POSITION_LABEL[position])` plus a `'לסטטיסטיקה'` CTA (`assistantStatsCta`, `src/i18n/he.ts:3268`) pointing at an empty stats screen. If `position` is unset, `statsCandidates` returns `[]` and `statsRule` returns null (`rules.ts:663-671`).
- `joinClubRule` → fires at `DISCOVERY: 6` — `rules.ts:704-717`.

`joinClubRule` output:
- `assistantJoinClub` (one drawn per screen mount, `rules.ts:710`) — `src/i18n/he.ts:3288-3291`:
  - `'יש כדורגל מסביבך 👀'`
  - `'ברוך הבא ל-Teamder! 👋'`
- sub: `assistantJoinClubSub: 'הגיע הזמן למצוא את החבר׳ה שלך ⚽'` — `src/i18n/he.ts:3292`
- CTA: `assistantJoinClubCta: 'גלה מועדונים'` — `src/i18n/he.ts:3293` → `{ kind: 'discoverClubs' }` → `nav.navigate('CommunitiesTab')` (`ProfileScreen.tsx:924-926`)

So the full first line is one of:
- `בוקר טוב <שם>, יש כדורגל מסביבך 👀`
- `בוקר טוב <שם>, ברוך הבא ל-Teamder! 👋`

The draw is random per mount: `newAssistantNonce()` is `Math.floor(Math.random() * 0xffffffff)` (`src/utils/assistant/resolve.ts:56-58`), minted once per mount (`ProfileScreen.tsx:622`). **The welcome greeting is a coin flip** — half of first-time users never see `'ברוך הבא ל-Teamder! 👋'` at all.

`markAvailabilityRule` (`rules.ts:722-737`) also sits at `DISCOVERY: 6` but is registered *after* `joinClubRule`, and it self-suppresses anyway because `ctx.shown.availabilityPrompt` is true for this user (`rules.ts:725`; the flag is computed at `ProfileScreen.tsx:875-876`).

If `message` is null the card renders nothing at all (`AssistantCard.tsx:38`).

#### 1.4 The "just played" card — not shown

`justPlayed ? ... : null` at `ProfileScreen.tsx:1185-1215`. Never fires for a new account. Strings (unreachable here, listed for completeness):
- `homeJustPlayedTitle: 'המחזור האחרון'` — `src/i18n/he.ts:718`
- `homeJustPlayedBody: 'המחזור הסתיים — הציון, הגולים והדירוג שלך מחכים בפנים.'` — `:719`
- `homeJustPlayedCta: 'לפרטי המחזור'` — `:722`

#### 1.5 ③ The hero slot — RENDERS NOTHING

`{nextGame ? <HomeNextGameCard .../> : heroGame ? <UpcomingScheduledGameCard .../> : null}` — `src/screens/tabs/ProfileScreen.tsx:1228-1259`.

For a new user both are null, so **the hero slot renders literally nothing**. The screen jumps from the coach's line straight to the three action tiles.

> ⚠️ **Dead empty state.** `HomeNextGameCard` contains a fully-built empty state (`src/components/home/HomeNextGameCard.tsx:42-61`) with `homeNoGameTitle: 'אין לך מחזור קרוב'` (`src/i18n/he.ts:2026`), `homeNoGameBody: 'מצא מחזור פתוח או פתח מחזור חדש'` (`:2027`) and a button `homeNoGameCta: 'מצא מחזור'` (`:2028`). It is **unreachable**: the only caller in the app is `ProfileScreen.tsx:1230`, and it is inside a `nextGame ? ...` guard, so `game` is never null when the component mounts (`grep -rn "HomeNextGameCard" src` returns only that one call site plus two unrelated comments). The "no upcoming game" copy that was written for this screen never renders.

#### 1.6 ④ Recommended-day banner — hidden for a new user

`{availCardEnabled && recommended ? <HomeRecommendedDay .../> : null}` — `ProfileScreen.tsx:1267-1294`.

`recommended` requires `availReady` = `!!availData && !availData.error && availData.hasLocation && availData.days.length > 0` (`ProfileScreen.tsx:803-807`), and then at least one evening with `count > 0` (`:816-818`). `availData` comes from the `availabilityCounts` callable (`src/services/availabilityFeedService.ts:100-110`); on any error it returns `{ radiusKm: 0, hasLocation: false, days: [], error: true }` (`:124`). A brand-new account has no saved home city, so `hasLocation` is expected false → banner hidden.

Strings (not shown for a new user): `homeRecommendedTitle: 'היום המומלץ לפתיחת מחזור'` (`src/i18n/he.ts:2046`), `homeRecommendedLine: (day, n) => \`יום ${day}׳ • ${n} פנויים\`` (`:2047`).

`availCardEnabled` is a Pulse/server master switch read on focus, defaulting `true` (`ProfileScreen.tsx:176-177`, `:425-434`).

#### 1.7 ⑤ Three action tiles — ALWAYS rendered, unconditional

`<HomeActionTiles onOpen onAvailability onJoin />` — `ProfileScreen.tsx:1297-1324`. Component: `src/components/home/HomeDashboardParts.tsx:127-143`. Rendered right-to-left in that array order.

| tile | label | he.ts | destination |
|---|---|---|---|
| 1 (right) | `homeActionOpenTitle: 'פתח מחזור'` | `:2049` | `nav.navigate('GameTab', { screen: 'GamesList', params: { openCreate: true } })` — `ProfileScreen.tsx:1303-1306` |
| 2 | `homeActionAvailTitle: 'סמן זמינות'` | `:2050` | `nav.navigate('AvailabilityEdit')` — `:1313` |
| 3 (left) | `homeActionJoinTitle: 'הצטרף למחזור'` | `:2051` | `nav.navigate('GameTab')` — `:1321` |

There are no subtitles; the comment at `src/components/home/HomeDashboardParts.tsx:145-148` says they were removed because `"הצטרף למחזור"` was clipping in a ~110pt column.

#### 1.8 ⑥ Availability podium **or** the availability prompt card

`{availCardEnabled && podium.length > 0 ? <HomeAvailabilityWindows/> : !markedAvailability ? <AvailabilityPromptCard/> : null}` — `ProfileScreen.tsx:1326-1366`.

New user → `podium` empty (§1.6) and `markedAvailability` false (`ProfileScreen.tsx:798-799`), so the **prompt card renders**. Component `src/components/home/AvailabilityPromptCard.tsx:13-34`:

- `availFeedPromptTitle: 'רוצה לראות מי פנוי לשחק לידך?'` — `src/i18n/he.ts:2749`
- `availFeedPromptBody: 'הגדר את האזור והזמנים שנוח לך — ונראה לך כמה שחקנים פנויים בכל חלון, כדי לפתוח מחזור בקלות.'` — `:2750-2751`
- `availFeedPromptCta: 'הגדר זמינות'` — `:2752` → `nav.navigate('AvailabilityEdit')` (`ProfileScreen.tsx:1358-1362`)

Podium strings (not shown here): `homeWindowsTitle: 'פנויים לידך'` (`:2053`), `homeWindowsPlayersUnit: 'שחקנים'` (`:2054`), `homeWindowsShowWeek: 'הצג שבוע מלא'` (`:2055`), `homeDayLabel: (l) => \`יום ${l}׳\`` (`:2057`).

#### 1.9 ⑦ The activation checklist — "בוא נתחיל"

`{homeDataReady && !checklistComplete ? <OnboardingChecklist items={checklistItems} /> : null}` — `ProfileScreen.tsx:1370-1372`.

`homeDataReady = groupsHydrated && playedCount !== null && (localUser?.isGuest || referralCount !== null)` (`ProfileScreen.tsx:719-722`) — deliberately delays the card past first paint so it doesn't flash.

Card chrome (`src/components/home/OnboardingChecklist.tsx:74-77`), with a green done/total progress ring (`:62`):
- `homeChecklistTitle: 'בוא נתחיל'` rendered as `` `${he.homeChecklistTitle} ⚡` `` — `src/i18n/he.ts:1990`
- `homeChecklistSubtitle: 'כמה צעדים קטנים כדי להפיק את המקסימום'` — `:1991`

The five steps (`ProfileScreen.tsx:635-710`), in render order, all **undone** for a new user:

| # | label | he.ts | `done` condition | tap → |
|---|---|---|---|---|
| 1 | `homeStepPhoto: 'הוספת תמונת פרופיל'` | `:1992` | `!!user.photoUrl` | `ProfileEdit` (`:646`) |
| 2 | `homeStepAvailability: 'סמן מתי אתה פנוי'` | `:1993` | `preferredDays.length > 0` | `AvailabilityEdit` (`:660`) |
| 3 | `homeStepCommunity: 'הצטרף או פתח מועדון'` | `:1994` | `myCommunities.length > 0` | `CommunitiesTab` (`:673`) |
| 4 | `homeStepGame: 'הצטרף או צור מחזור ראשון'` | `:1995` | `totalGames > 0 \|\| myGames.length > 0` | `GameTab` (`:687`) |
| 5 | `homeStepInvite: 'הבא חבר למגרש'` | `:1996` | `(referralCount ?? 0) > 0` — i.e. someone actually signed up through the link, not merely that share was tapped (`:701-703`) | fires the share sheet (`:709`) |

A `done` row is rendered `disabled` (`src/components/home/OnboardingChecklist.tsx:85`) with a green `checkmark-circle`; an undone row shows an empty checkbox (`:106-110`).

Note the **ordering conflict**: the checklist is positioned *below* the hero and the action tiles by deliberate choice (comment at `ProfileScreen.tsx:1367-1369`: *"ALWAYS shown while incomplete … but positioned low"*). For a user with an empty hero slot (§1.5), the single most onboarding-relevant card on the screen sits fifth.

#### 1.10 ⑧ Rotating "ידעת ש..." tips — always rendered

`<DidYouKnowCard tips={homeTips} />` — `ProfileScreen.tsx:1376`. Component `src/components/home/DidYouKnowCard.tsx:19-60`; auto-advances every `ROTATE_MS = 6000` (`:17`, `:24-30`) with a dot indicator (`:48-58`).

Header: `homeDidYouKnowTitle: 'ידעת ש...'` — `src/i18n/he.ts:2004`.
The five tips (`ProfileScreen.tsx:723-729`):
1. `homeTipAutoTeams: 'אפשר ליצור כוחות מאוזנים אוטומטית לפי דירוג השחקנים'` — `:2005` → `CommunitiesTab`
2. `homeTipInternalRating: 'דירוג פנימי של שחקנים עוזר לאזן קבוצות הוגנות'` — `:2006` → `CommunitiesTab`
3. `homeTipAvailability: 'סמן מתי אתה פנוי — ומנהלים יזמינו אותך למחזורים'` — `:2007` → `AvailabilityEdit`
4. `homeTipScheduled: 'אפשר לתזמן מראש מתי נפתחת ההרשמה למחזור'` — `:2008` → `GameTab/GameCreate`
5. `homeTipCommunity: 'פתח מועדון כדי לנהל קבוצה קבועה עם דירוגים וכוחות'` — `:2009` → `CommunitiesTab`

All five describe **admin** features. None of them is actionable by a user who is not in a club.

#### 1.11 ⑨ Invite-friends CTA — always rendered, last block

`ProfileScreen.tsx:1379-1393`. `profileInviteFriendsCta: 'הזמן חברים לאפליקציה'` — `src/i18n/he.ts:3020`. Handler `handleShareInvite` (`ProfileScreen.tsx:948-971`) builds a short link via `createShortInviteUrl({ type: 'app', invitedBy: user.id, ... })` and shares:
- `profileInviteShareBody: (link) => \`אני משחק כדורגל בעזרת אפליקציית Teamder ⚽\\nתוריד גם אתה ובוא לשחק:\\n${link}\`` — `src/i18n/he.ts:3021-3022`

#### 1.12 The ☰ hamburger — the whole rest of the app

`<HamburgerMenu visible={menuOpen} sections={sections} />` — `ProfileScreen.tsx:1398-1401`; sections built at `ProfileScreen.tsx:975-1104`. Nothing here is on the home body. Sections and items:
- `profileMenuSectionProfile` — `profileSectionMyAchievements`, `statsMenuLabel`, `profileEdit`, `friendsTitle` (behind `rcBool('feature_friends')`, `:1013`), `referralsScreenTitle` (behind `rcBool('feature_referrals')`, `:1023`)
- `profileMenuSectionGames` — `profileSectionAvailability`, `profileSectionHistory`
- admin-only approvals section, only `if (isAdmin && pendingApprovals > 0)` (`:1050-1068`)
- `profileMenuSectionSystem` — notifications, blocked users
- `profileMenuSectionSupport` — report bug / suggest feature (behind `rcBool('feature_feedback')`), rate app
- `profileMenuSectionAccount` — sign out, delete account

#### 1.13 The GUEST branch of the same screen

`if (localUser?.isGuest) { ... }` returns a completely different screen and **none of the above renders** — `ProfileScreen.tsx:1109-1133`:
- `guestProfileTitle: 'הפרופיל שלך מחכה'` — `src/i18n/he.ts:1809`
- `guestProfileBody: 'אתה גולש כאורח. הירשם כדי לשמור מחזורים, להצטרף למועדונים ולבנות פרופיל שחקן.'` — `:1810-1811`
- Button `guestRegisterCta: 'הרשמה'` — `:1808` → **calls `signOut()`** (`ProfileScreen.tsx:1126`), which drops the guest back to the auth stack.

---

### 2. Every path onward from home, tap by tap

Six exits exist from the empty home screen. There are no others.

**A. Coach CTA → discover clubs.** Tap `'גלה מועדונים'` (`ProfileScreen.tsx:1177` → `handleAssistantCta` → `case 'discoverClubs': nav.navigate('CommunitiesTab')`, `:924-926`). **1 tap.**

**B. Tile "פתח מחזור" → create-game chooser.** `nav.navigate('GameTab', { screen: 'GamesList', params: { openCreate: true } })` (`ProfileScreen.tsx:1303-1306`). `GamesListScreen` consumes `openCreate` in an effect and calls `handleCreate()` (`src/screens/games/GamesListScreen.tsx:325-334`), which opens the chooser modal. **1 tap to the chooser.**

**C. Tile "סמן זמינות" → `AvailabilityEdit`** (`ProfileScreen.tsx:1313`). Also reachable from the availability prompt card (`:1358`) and checklist step 2 (`:660`).

**D. Tile "הצטרף למחזור" → `GameTab`** (`ProfileScreen.tsx:1321`), landing on `GamesList`.

**E. Checklist step 3 "הצטרף או פתח מועדון" → `CommunitiesTab`** (`ProfileScreen.tsx:673`).

**F. Bell → `Requests`** (`ProfileScreen.tsx:1164`). See §6 for why this is a dead end for a new user.

#### 2.1 Path: create a club

`CommunitiesTab` → `PublicGroupsFeedScreen`. Create is reachable three ways, all calling `handleCreate(source)` → `nav.navigate('CommunitiesCreate')` (`src/screens/communities/PublicGroupsFeedScreen.tsx:428-433`):
1. the floating `+` FAB, bottom-LEFT under RTL (`:866-884`), label `communitiesCreateGroup: 'צור מועדון חדש'` (`src/i18n/he.ts:1276`);
2. the `'המועדונים שלי'` empty-hint card's button (`:810-818`);
3. the whole-screen empty state's button (`:761-769`).
Buttons 2 and 3 read `communitiesCreateFirst: 'צור מועדון ראשון'` — `src/i18n/he.ts:1280`.

`CreateGroupScreen` (`src/screens/groups/CreateGroupScreen.tsx`) is a thin shell over `GroupWizardForm`, header `createGroupTitle: 'יצירת מועדון חדש'` (`src/i18n/he.ts:1296`), submit `createGroupSubmit: 'צור והיכנס'` (`:1401`).

**Two steps** (`src/screens/groups/GroupWizardForm.tsx:144`, indicator at `:263-267`):
- Step 1 `groupFormTabDetails: 'פרטים'` (`src/i18n/he.ts:542`)
  - section `groupSectionIdentity: 'פרטי המועדון'` (`:955`): `groupCreateName: 'שם המועדון'` (`:2866`, **required**, placeholder `'לדוגמה: חמישי כדורגל'` hardcoded at `GroupWizardForm.tsx:286`); `createGroupDescription: 'תיאור המועדון (לא חובה)'` (`:1304`); `communityDetailsRules: 'חוקי המועדון'` (`:1461`, placeholder hardcoded `'לדוגמה:\n- מגיעים בזמן\n- **אסור** לעשן במגרש'` at `GroupWizardForm.tsx:307`)
  - section `groupSectionLocation: 'מיקום ויצירת קשר'` (`:956`): `createGroupCity: 'עיר'` (`:1297`, **required**, placeholder `createGroupCityPlaceholder: 'התחל להקליד שם עיר'` `:1298`); `createGroupContactPhone: 'טלפון איש קשר'` (`:1390`, placeholder `'050-1234567'` `:1391`, hint `'יוצג כפתור "פתח ב־WhatsApp" במועדון'` `:1392`)
  - gate: `step1Valid` = name and city non-empty (`GroupWizardForm.tsx:212`); when blocked the disabled `'המשך'` is explained by `gameWizardMissingFields: (fields) => \`יש למלא: ${fields}\`` (`src/i18n/he.ts:857`, rendered `GroupWizardForm.tsx:432-436`)
- Step 2 `groupFormTabAdvanced: 'מתקדם'` (`src/i18n/he.ts:543`)
  - `groupSectionAccess: 'הצטרפות והרשאות'` (`:957`) with the single most consequential switch in the whole funnel: `createGroupIsOpen: 'מועדון פתוח'` (`:1307`), hint `createGroupIsOpenHint: 'כשמופעל — שחקנים חדשים מצטרפים אוטומטית. כבוי = דורש אישור מנהל.'` (`:1308`). Default is `false` — `EMPTY_GROUP_FORM_VALUES` feeds the create screen (`CreateGroupScreen.tsx:140`) and `submitJoinByPublic` reads `!!pub.isOpen` (`src/services/groupService.ts:2030`).
  - `groupSectionRating: 'דירוג וכרטיסים'` (`:958`) — internal rating, hide-rating, cards toggles.
- Footer buttons: `wizardStepBack: 'חזרה'` (`:1123`), `wizardStepNext: 'המשך'` (`:1124`).

On success it does `nav.replace('CommunityDetails', { groupId, celebrate: true })` (`CreateGroupScreen.tsx:92-95`).

**Tap count: `+` (1) → type name → type city → `המשך` (2) → `צור והיכנס` (3).** Three taps plus two text fields. Creating a club does **not** create a game and does **not** register the user for anything.

#### 2.2 Path: join a club

`PublicGroupsFeedScreen` (`src/screens/communities/PublicGroupsFeedScreen.tsx`). Layout per its own header comment (`:1-12`): hero, search+filter row, `המועדונים שלי`, `ממתינים לאישור`, `מועדונים פתוחים`, FAB.

Hero (`src/components/community/CommunitiesHero.tsx:63-66`): `communitiesTitle: 'מועדונים'` (`src/i18n/he.ts:1274`) + `communitiesHeroSubtitle: 'כל המועדונים במקום אחד'` (`:1408`).
Search placeholder: `communitiesCardSearchPlaceholder: 'חיפוש מועדון או עיר'` (`:1414`, used `:556`).
Controls row also carries a map button (`mapButtonLabel: 'תצוגת מפה'`, `:73`), a filter button (`gameFiltersButton: 'סינון'`, `:103`) and a `RequestsBell` (`:752`).

**Whole-screen empty state** when `totalKnown === 0 && !isSearching` (`:753-770`; `totalKnown = (items ?? []).length`, `:537`) — i.e. the public club directory is genuinely empty:
- `communitiesEmptyAll: 'אין עדיין מועדונים'` — `src/i18n/he.ts:1278`
- `communitiesEmptyAllSub: 'תהיה הראשון להקים מועדון כדורגל באזור שלך'` — `:1279`
- button `communitiesCreateFirst: 'צור מועדון ראשון'` — `:1280`
- the FAB is hidden in this state (`:870`)

**Normal state.** Section `communitiesSectionMember: 'המועדונים שלי'` (`:1405`) is **always rendered**, and for a new user shows an empty-hint card (`:795-820`):
- `communitiesEmptyMember: 'עדיין לא הצטרפת לאף מועדון'` — `:1416`
- `communitiesEmptyMemberSub: 'הצטרף למועדון מהרשימה למטה כדי לראות מחזורים, או פתח מועדון משלך.'` — `:1417-1418`

Section `communitiesSectionPending: 'ממתינים לאישור'` (`:1406`) renders only when `pendingItems.length > 0` (`:823`).

Section `communitiesSectionOpen: 'מועדונים פתוחים'` (`:1407`) is the discovery list. Empty → `communitiesEmptyOpenSection: 'אין מועדונים פתוחים נוספים'` (`:1419`). Windowed to `DISCOVERY_PAGE = 8` (`:74`) with `communitiesShowMore: (n) => \`הצג עוד מועדונים (${n})\`` (`:1422`, rendered `:844`).

**Search-mode**: no-match copy is `communitiesEmpty: 'לא מצאנו מועדון בשם זה. נסה לחפש לפי עיר או שם אחר.'` (`:1277`, rendered `:788`).

**The discovery query** is `groupService.listPublicGroups()` — an *unfiltered* `getDocs(col.groupsPublic())` with no `where` at all (`src/services/groupService.ts:634-647`). Filtering, windowing and sorting are all client-side:
- exclude clubs with an empty name (comment: partial `/groupsPublic` docs from hidden personal groups) — `PublicGroupsFeedScreen.tsx:304-308`
- exclude member / admin / pending — `:309-311`
- apply the user's filters (`passesDiscoveryFilters`) — `:312`
- sort: `gamesLast30` desc, then `gamesLast60` desc, then `memberCount` desc, then Hebrew name — `:329-335`. The long comment at `:317-328` explains this was changed away from member-count sorting because *"of 53 real clubs only 15 have ever opened a round, and the ones that never did are not the small ones — the biggest club in the app has 40 members and no fixture."*

**The card** is `src/components/community/ClubCard.tsx`, its state machine is the pure `resolveClubCard` (`src/utils/clubCard.ts:108-152`). CTA resolution (`src/utils/clubCard.ts:122-128`):

| relation | CTA value | label | he.ts |
|---|---|---|---|
| admin or member | `member` | `clubCardMember: 'חבר במועדון'` | `:3351` |
| pending | `requested` | `clubCardRequested: 'בקשה נשלחה'` | `:3354` |
| none + `isOpen` | `join` | `clubCardJoin: 'הצטרף'` | `:3352` |
| none + closed | `request` | `clubCardRequest: 'בקש להצטרף'` | `:3353` |

Only `join` and `request` are tappable (`ctxActs`, `ClubCard.tsx:95`, `:154`). Badges: `clubCardManager: 'מנהל'` (`:3355`), `clubCardRecommended: 'מתאים לך'` (`:3356`, = within 10 km **and** ≥10 members, `src/utils/clubCard.ts:64-65`, `:133-136`), and activity `clubCardVeryActive: 'פעיל מאוד'` / `clubCardActive: 'פעיל'` / `clubCardInactive: 'לא פעיל'` (`:3357-3359`) from `clubActivity` thresholds `VERY_ACTIVE_MIN = 4`, `ACTIVE_MIN = 2` over 30 days (`src/utils/clubCard.ts:83-98`). A club whose counters are null gets **no** badge (`:93`).
Member count line: `clubCardPlayers: (n) => \`${n} שחקנים\`` (`:3360`).

**Tapping the CTA** runs `handleRequest` (`PublicGroupsFeedScreen.tsx:345-424`):
- guest gate first: `ensureNotGuest(he.guestRegisterJoinCommunity, { type: 'team', id: item.id })` (`:347`) — `guestRegisterJoinCommunity: 'כדי להצטרף למועדון צריך חשבון. רוצה להירשם עכשיו?'` (`:1804`)
- `requestJoinById` → `submitJoinByPublic` (`src/services/groupService.ts:2024-2074`): reads `/groupsPublic/{id}`, branches on `isOpen`, enforces a capacity gate on `memberCount >= maxMembers` throwing `GROUP_FULL` (`:2033-2043`), then `writeJoin(groupId, userId, isOpen)` (`:2047`) and returns `status: isOpen ? 'joined' : 'pending'` (`:2072`)
- toasts (`PublicGroupsFeedScreen.tsx:376-423`):
  - pending → `toastJoinRequestSent: 'הבקשה נשלחה'` (`:228`)
  - joined → `toastJoinedGroup: 'ברוך הבא למועדון'` (`:229`)
  - already member → `groupAlreadyMember: 'אתה כבר במועדון הזה'` (`:2878`)
  - rejected → `toastJoinRejected: 'בקשתך למועדון זה נדחתה ולא ניתן לשלוח שוב.'` (`:242`)
  - `GROUP_FULL` → `toastGroupFull: 'המועדון מלא. לא ניתן לשלוח בקשה כרגע.'` (`:241`)
  - anything else → `toastRequestFailed: 'שליחת הבקשה נכשלה. נסה שוב.'` (`:237`)

**Tapping the card body** (not the CTA) for a non-member routes to `CommunityDetailsPublic` — the read-only preview, `src/screens/communities/CommunityDetailsPublicScreen.tsx`. It shows description + `communityDetailsAbout: 'תיאור המועדון'` (`:1452`), `communityDetailsCity: 'עיר'` (`:1454`), `communityDetailsField: 'מגרש'` (`:1453`), `communityDetailsPreferredDays: 'ימי מחזור'` (`:1455`), `communityDetailsPreferredHour: 'שעת מחזור'` (`:1456`), `communityDetailsMembers: 'שחקנים'` (`:1468`). Optional WhatsApp button `communityDetailsContactAdmin: 'צור קשר עם המנהל'` (`:1544`, shown only when `phoneValid`, `:341`). Primary button copy is `group.isOpen ? he.communityJoinAuto : he.communityRequestToJoin` (`:295`):
- `communityJoinAuto: 'הצטרף למועדון'` — `:1445`
- `communityRequestToJoin: 'בקש להצטרף'` — `:1446`
Once pending the button becomes `groupsActionPending: 'הבקשה נשלחה'` and is `disabled` (`:361-366`), with a secondary `communityCancelJoinRequest: 'בטל בקשת הצטרפות'` (`:1447`, rendered `:371`) whose success toast is `toastJoinRequestCancelled: 'בקשת ההצטרפות בוטלה'` (`:1448`).

**The public preview shows the club's upcoming games nowhere.** Nothing in `CommunityDetailsPublicScreen.tsx` renders a game list — a prospective member cannot see whether the club has a fixture this week before committing to a join request.

**Tap count (open club):** `CommunitiesTab` (1) → `הצטרף` on a card (2) = **2 taps, instant membership.**
**Tap count (closed club, the default):** same 2 taps, then an unbounded wait for an admin.

#### 2.3 Path: find an open game

`GameTab` → `GamesListScreen` (`src/screens/games/GamesListScreen.tsx`). Full breakdown in §3.

#### 2.4 Path: accept an invite

Two link shapes, both handled by the single consumer in `RootNavigator` (`src/navigation/RootNavigator.tsx:62-166`). Readiness gate: `if (!currentUser || !profileComplete || !hasCompletedOnboarding) return` (`:65`) — an invite therefore does **not** fire until the user has finished signup and post-signin onboarding, and `consumedRef` fires it at most once per launch (`:62`, `:66`).

- `pending.type === 'app'` — a generic app invite. It **clears the stash and does nothing else** (`:77-80`): *"Attribution already landed at signup … nothing to navigate to, so just clear the stash and leave the user on home."* A user who followed a friend's `profileInviteShareBody` link lands on the empty home screen with no acknowledgement.
- `pending.type === 'session'` → pre-flight `gameService.getGameById` (`:98`) → `navigateInvite(...)` → MatchDetails.
- `pending.type === 'team'` → pre-flight `groupService.getPublic` (`:100`) → CommunityDetails (member) or CommunityDetailsPublic (non-member), chosen by `cachedGroups.some(...)` (`:134-138`).
- Deleted target → `toast.error('הקישור לא תקין או שהפריט כבר לא קיים')` — **hardcoded Hebrew, not in he.ts**, `src/navigation/RootNavigator.tsx:124`.
- `ACCESS_BLOCKED` is treated as `exists = true` so the target screen can render its own blocked UI (`:107-110`).

The same stash is reused as the post-signup return target by the guest gate (`src/utils/guestGate.ts:39-63`): choosing `'הרשמה'` stashes the target and calls `signOut()` (`:51-58`).

---

### 3. The open-games feed: what a stranger sees

#### 3.1 The queries

`GamesListScreen.reload()` runs four in parallel (`src/screens/games/GamesListScreen.tsx:246-254`):

```
gameService.getMyLiveOrUpcomingGames(user.id)
gameService.getCommunityGames(user.id, myCommunityIds)
gameService.getOpenGames(user.id, myCommunityIds)
gameService.getMyUpcomingScheduledGames(user.id, myCommunityIds)
```

**`getOpenGames` is the only one that can return anything for a user with no club** (`src/services/gameService.ts:2517-2570`). The server-side query, verbatim (`:2547-2554`):

```js
query(
  col.games(),
  where('visibility', '==', 'public'),
  where('status',     '==', 'open'),
  where('startsAt',   '>',  now),
)
```

Then client-side (`:2561-2570`): re-check `status === 'open'`, `startsAt > now`, `!isStaleAfterStart(g)`, `!excludeCommunityIds.includes(g.groupId)`, and drop games where the user is already in `players` / `waitlist` / `pending`. Sorted `startsAt` ascending.

**So the answer to "what determines which games a stranger sees" is: `visibility === 'public'` AND `status === 'open'` AND `startsAt > now`, and nothing else.**

- **No city filter.** None.
- **No distance filter.** `EMPTY_GAME_FILTERS` has `nearby: false` (`src/utils/gameFilters.ts:25-33`); `DEFAULT_GAME_NEARBY_RADIUS_KM = 25` (`:23`) only applies once the user opts in through the filter sheet. Default feed shows a game in Eilat to a user in Haifa.
- **`acceptsFillers` plays no part in the feed.** `grep -rn "acceptsFillers" src` returns only the type (`src/types/index.ts:1549`, `:2028`), the create/edit wizard (`GameCreateScreen.tsx:134`, `:503-504`; `GameEditScreen.tsx:110`, `:340-341`; `GameWizardForm.tsx:195`, `:774`), the series scheduler (`src/utils/seriesSchedule.ts:201`, `:284`) and the admin review section (`src/components/match/FillerInterestsSection.tsx:10`). It is **not** in any feed query. Its only client-side consumer is the filler-candidate banner on MatchDetails (`src/screens/games/MatchDetailsScreen.tsx:810`) — i.e. it changes what you can do once you are *on* a game, not whether you can *see* it.
- `getCommunityGames` (`src/services/gameService.ts:2239-2313`) is `where('groupId','in',chunk) + where('status','==','open')`, chunked at 30, fail-soft per chunk, and drops games the user is already in (`:2304-2309`). `communityIds.length === 0 → return []` (`:2243`). Useless for a new user.
- `getMyUpcomingScheduledGames` (`:2328-2389`) is `where('groupId','in',chunk) + where('status','==','scheduled')`, same empty-club guard (`:2332`), sorted by `registrationOpensAt ?? startsAt` (`:2338`).

Render-layer visibility: `isVisibleInOpenGames(g)` = `isOpen(g) && (!hasStarted(g) || canJoinGame(g))` (`src/services/gameLifecycle.ts:310-315`) — a game stays in discovery for the 1h late-registration grace after kickoff.

#### 3.2 What the screen renders

Hero `MatchesHero` (`src/components/match/MatchesHero.tsx:38-81`), pinned outside the scroll:
- `gamesListTitle: 'מחזורים'` (`src/i18n/he.ts:793`) — the comment at `MatchesHero.tsx:39-41` notes the greeting was deliberately moved to Home
- `matchesHeroSubtitle: 'הצטרף למחזורים או צור מחזור חדש'` (`:3071`)

Floating controls row (`GamesListScreen.tsx:653-855`): map button, filter button with a count badge, requests bell with a count badge.

The list is **one sectioned scroll, no tabs** (comment `:654-655`), with three possible bodies:

**(a) `filteredToNothing`** — `isEmpty && filterCount > 0` (`GamesListScreen.tsx:578`) → `FullEmptyState` with `hasActiveFilters` (`:891-899`, component `:1324-1390`):
- `emptyHomeFilteredBody: 'אין מחזורים שתואמים לסינון'` — `:2853`
- button `emptyHomeClearFilters: 'נקה סינון'` — `:2854`
- the FAB is **hidden** in this state only (`:975`)
- (unreachable branches of the same component: `emptyHomeBody: 'צור מחזור חדש או הצטרף למחזור קיים'` `:2844`, `emptyHomeNoGamesAnywhere: 'אין מחזורים פתוחים כרגע — היה הראשון לפתוח מחזור למועדון שלך'` `:2850`, `emptyHomePrimary: 'צור מחזור'` `:2845`, `emptyHomeSecondary: 'מצא מחזורים'` `:2846` — `FullEmptyState` is now only ever called with `hasActiveFilters`, `GamesListScreen.tsx:891-899`)

**(b) `isEmpty` with no filters — THE NEW-USER CASE** (`GamesListScreen.tsx:900-912`):
- `gamesNoOpenTitle: 'אין כרגע מחזורים פתוחים שמתאימים לך'` — `src/i18n/he.ts:3371`
- `gamesNoOpenBody: 'אבל יש אנשים שרוצים לשחק — הנה איפה להתחיל'` — `:3372`
- then `upcomingSection` (empty for a new user), then `MatchEmptyHintCard`, then `discovery`

**(c) Non-empty** (`:913-965`) — `matchesSectionMine: 'המחזורים שלי'` (`:3365`), `homeUpcomingSectionTitle: 'בקרוב במועדונים שלך'` (`:2030`), `matchesSectionOpen: 'מחזורים פתוחים'` (`:3364`), then discovery below every real match.

`MatchEmptyHintCard` (`src/components/match/MatchEmptyHintCard.tsx:25-48`):
- `matchesEmptyCardTitle: 'לא מצאת מחזור מתאים?'` — `:3399`
- `matchesEmptyCardSub: 'צור מחזור חדש ותן לאחרים להצטרף'` — `:3400`

**The FAB** (`GamesListScreen.tsx:976-999`): pinned bottom-LEFT under RTL, `Breathing` pulse, accessibility label `matchesCreateFab: 'יצירת מחזור חדש'` (`:139`). A one-time device hint bubble points at it: `hintCreateGame: 'כאן יוצרים מחזור חדש'` (`:2857`), shown when `storage.getHintCreateGameSeen()` is false (`:225-232`).

**A first-visit modal also fires here.** `AvailabilityNudgeModal` (`GamesListScreen.tsx:1101-1115`) is armed when the user has no `preferredDays` and hasn't been shown it in 3 days (`:121-132`) — so a brand-new user's very first visit to the Games tab is interrupted by a popup before they see the list.

#### 3.3 The discovery blocks beneath the list

Shown when `!filteredToNothing && density !== 'many'` (`GamesListScreen.tsx:582`). Density from `feedDensity(visibleGamesCount, richMin)` (`src/utils/feedDensity.ts:38-41`): `0 → 'none'`, `>= richMin → 'many'`, else `'few'`. Defaults `richMin: 5`, `demandMin: 3`, `clubsMax: 3`, `clubsRadiusKm: 30`, `clubsMinMembers: 10` (`src/utils/feedDensity.ts:12-27`), each overridable by Remote Config (`src/config/gamesFeedDiscovery.ts:42-56`).

`AreaDemandCard` (`src/components/games/AreaDemandCard.tsx`) — without a saved home area it shows the prompt variant (`:114-126`):
- `gamesDemandPromptTitle: 'רוצה לדעת מי מחפש משחק לידך?'` — `src/i18n/he.ts:3391`
- `gamesDemandPromptBody: 'הגדר את אזור הבית והימים שנוח לך, ונראה לך כמה שחקנים פנויים בכל חלון — כדי לפתוח מחזור בדיוק מתי שיש ביקוש.'` — `:3392-3393`
- `gamesDemandPromptCta: 'הגדר אזור וזמינות'` — `:3394`
With data (`:150-216`): `gamesDemandTitle: 'ביקוש לכדורגל באזור שלך'` (`:3373`), `gamesDemandFreeHeadline: (n, day, window) => \`${n} שחקנים פנויים ${day} ${window} באזור שלך\`` (`:3383-3384`), `gamesDemandHeroSub: 'נראה שיש פה מחזור שמחכה לקרות'` (`:3385`), `gamesDemandOpenCta: (day) => \`פתח מחזור ל${day}\`` (`:3386`), `gamesDemandLookingHeadline` (`:3387-3388`), `gamesDemandImFreeCta: 'גם אני פנוי'` (`:3389`), `gamesDemandFoot: 'הספירה מבוססת על שחקנים שסימנו זמינות'` (`:3390`).

`NearbyClubsSection` (`src/components/games/NearbyClubsSection.tsx:186-194`):
- with location: `gamesClubsNearbyTitle: 'מועדונים באזור שלך'` (`:3395`) / `gamesClubsNearbySub: 'קהילות כדורגל שמשחקות בקביעות לידך — הצטרף ותשחק איתן'` (`:3396`)
- without: `gamesClubsAnyTitle: 'מועדונים שאפשר להצטרף אליהם'` (`:3397`) / `gamesClubsAnySub: 'הקהילות הפעילות באפליקציה — הגדר אזור בית כדי לראות את אלו שלידך'` (`:3398`)
It carries its own inline join with the identical toast set as the communities feed (`NearbyClubsSection.tsx:126-173`), so a club can be joined **without ever opening the Communities tab**.

#### 3.4 The card and its button, state by state

`MatchListCard` (`src/components/match/MatchListCard.tsx`). Occupancy counts registered players **plus active guests plus a held promotion reservation** (`:103-106`):
```js
occupancy = game.players.length + activeGuestCount(game.guests) + (game.pendingPromotion?.uid ? 1 : 0)
```
`ctaForGame` (`:63-86`), in order:
1. `status === 'joined'` → `cancel`
2. `status === 'waitlist'` → `leaveWaitlist`
3. `status === 'pending'` → `pending`
4. `g.status === 'scheduled'` → `none`
5. `occupancy >= g.maxPlayers` → `waitlist` — **occupancy is checked before `requiresApproval`**, with a long comment at `:71-78` explaining the production case: *"The one public game in the country is sitting at exactly 21/21 (1 player + 20 active guests) and has collected 7 such requests over 17 days, aged up to 18."*
6. `g.requiresApproval` → `requestJoin`
7. else → `join`

Only `join`/`requestJoin`/`waitlist` render a button (`showCta`, `:135-136`). The label is deliberately only two possibilities (`:139-140`):
- `gameCardRequestJoin: 'בקש להצטרף'` — `src/i18n/he.ts:808` (approval required)
- `matchCardJoinShort: 'הצטרף'` — `:3033` (everything else, **including a full game** — comment at `MatchListCard.tsx:137-138`: *"Even a full game's CTA just says 'הצטרף' … tappers land on the waitlist and then see the 'ברשימת המתנה' badge."*)

Otherwise a non-interactive status badge replaces the button (`:145-152`):
- joined → `matchStatusJoined: 'בהרכב'` (`:3048`), green
- waitlist → `matchCardInWaitlist: 'ברשימת המתנה'` (`:3034`), amber
- pending → `matchStatusPending: 'ממתין לאישור'` (`:3050`), grey

Other card copy: occupancy `matchCardOccupancy: (n, max) => \`${n}/${max}\`` (`:3041`); when-line `matchCardWhenToday: (t) => \`היום ב-${t}\`` (`:3037`), `matchCardWhenTomorrow: (t) => \`מחר ב-${t}\`` (`:3038`), `matchCardWhenDate: (d, t) => \`${d} · ${t}\`` (`:3039`); visibility chip `matchTagOpenToAll: 'פתוח לכולם'` (`:3052`) / `matchTagCommunityOnly: 'סגור למועדון'` (`:3053`) / `matchTagQuickClosed: 'מחזור מהיר'` (`:3054`) (`MatchListCard.tsx:159-167`).

Progress-bar urgency: red when full, amber at ≤3 spots, green otherwise (`:113`). Side stripe: green if joined, amber if waitlisted, blue otherwise (`:128-129`).

#### 3.5 Joining from the card

`handleCardPrimary` (`GamesListScreen.tsx:337-473`):
- `cancel` past the deadline → `ConfirmDestructiveModal` with `lateCancelTitle: 'ביטול קרוב מאוד למחזור'` (`:251`) / `lateCancelConfirm: 'אישור ביטול'` (`:254`)
- `cancel` otherwise → `appAlert(he.leaveGameConfirmTitle, he.leaveGameConfirmBody, ...)` (`:352-362`) — `leaveGameConfirmTitle: 'לבטל את ההרשמה?'` (`:3802`), `leaveGameConfirmBody: 'ההרשמה שלך למחזור תבוטל. תמיד אפשר להירשם שוב כל עוד יש מקום.'` (`:3803`), destructive label `matchMenuLeave: 'יציאה מהמחזור'` (`:3801`)
- `join | requestJoin | waitlist` → `gameService.requestJoinGame(game.id, user.id, 'games_list')` and then a toast keyed on the **returned bucket** (`:372-380`):
  - `toastGameJoinedWaitlist: 'נוספת לרשימת המתנה'` — `:234`
  - `toastGameJoinedPending: 'בקשת ההצטרפות נשלחה'` — `:235`
  - `toastGameJoined: 'הצטרפת למחזור'` — `:231`
- the card is then patched optimistically in place and reconciled after 2500 ms (`:381-419`), because the fair-queue seating is an async Cloud Function
- error branches (`:420-470`): `REGISTRATION_CONFLICT` → the conflict modal, fallback toast `registrationConflictTitle: 'אתה כבר רשום למחזור בזמן חופף'` (`:3816`); `GAME_JOIN_REJECTED` → `matchDetailsJoinRejected: 'בקשתך למחזור זה נדחתה ולא ניתן להירשם שוב.'` (`:3422`); `GAME_NOT_OPEN | GAME_STARTED | GAME_LIVE` → `gameNotJoinableToast: 'המחזור כבר לא פתוח להרשמה'` (`:3815`)

There is **no guest gate on the card join** — `ensureNotGuest` appears in `handleCreate` (`:315`) and `openCreateForSlot` (`:591`) but not in `handleCardPrimary`. A guest tapping `הצטרף` on a card goes straight into `requestJoinGame`.

---

### 4. Joining a game: every gate, with the button label in each state

#### 4.1 The lifecycle gate (shared contract)

`src/services/gameLifecycle.ts` is the single source, explicitly framed as *"the contract"* (`:1-5`).

`canJoinGame(game)` (`:150-157`) returns false unless all three hold:
1. `isOpen(game)` — `effectiveStatus === 'open'`; `status === 'open' && liveMatch.phase === 'live'` is normalised to `'active'` (`:43-48`, `:65-67`)
2. `!isPastLateRegistrationCutoff(game)` — `LATE_REG_GRACE_MS = 60 * 60 * 1000`, i.e. joining stays open **1 hour past kickoff** (`:120`, `:135-138`)
3. `!isRoundRunning(game)` — phases `'live'` and `'roundRunning'` (`:50-58`)

Capacity is explicitly **not** considered (comment `:147-148`): *"a full game still allows joining the waitlist."*

`canCancelRegistration(game)` = `isOpen(game) || isLocked(game)` (`:167-169`).
`isStaleAfterStart` = kickoff + 6 h (`:121`, `:129-132`).

#### 4.2 The write path

`requestJoinGame` (`src/services/gameService.ts:5136-5285`), fair-queue registration:
- `tappedAt = serverNow()` captured **before any await** (`:5141`) so latency can't reorder the queue
- Firestore pre-checks (`:5233-5265`), in order, each a thrown code:
  - doc missing → `'requestJoinGame: game not found'`
  - `data.status !== 'open'` → **`GAME_NOT_OPEN`** (`:5236`)
  - `data.startsAt + LATE_REG_GRACE_MS < Date.now()` → **`GAME_STARTED`** (`:5240`)
  - `data.liveMatch?.phase === 'live'` → **`GAME_LIVE`** (`:5242`)
  - `(data.rejectedPlayerIds ?? []).includes(userId)` → **`GAME_JOIN_REJECTED`** (`:5243-5247`)
  - already in `players`/`waitlist`/`pending` → returns that bucket, idempotent (`:5248-5258`)
  - `findRegistrationConflict` → **`REGISTRATION_CONFLICT`** with the clashing game attached (`:5259-5265`)
- then a contention-free per-user write to `games/{id}/joinRequests/{uid}` with `state: 'queued'` (`:5276-5281`), preceded by a `deleteDoc` so a re-join is always a fresh CREATE (rules forbid updating the doc — comment `:5268-5274`)
- returns an **optimistic** bucket from `predictBucket` / `assignJoins` (`:5145-5170`, `:5284`); the server reconciler is authoritative

Bucket prediction inputs (`:5159-5168`) include the key carve-out: `requiresApproval: g.requiresApproval === true && g.createdBy !== userId` — **the creator never has to approve themselves** — and `pendingOfferReservation: !!g.pendingPromotion?.uid`.

#### 4.3 The MatchDetails screen's button, every state

`src/screens/games/MatchDetailsScreen.tsx`.

`statusForUser` (`:154-159`): `joined` → `waitlist` → `pending` → `none`.
`wasRejected = (game.rejectedPlayerIds ?? []).includes(user.id)` (`:1375-1376`).
`isFull = totalParticipants + (pendingPromotion ? 1 : 0) >= maxPlayers` (`:1394-1395`) — includes guests (`:1378-1379`).
`needsApproval = game.requiresApproval === true && !isAdmin && !isInvitedToGame` (`:1445`), where `isInvitedToGame = (game.invitedUserIds ?? []).includes(user.id)` (`:1443-1444`) — comment at `:1439-1442`: *"the creator + an invited player both saw 'בקש להצטרף' on a game they were invited to."*

`primaryLabel` (`:1446-1451`), in order:

| condition | label | he.ts |
|---|---|---|
| `primaryDestructive` (joined / waitlist / pending) | `matchDetailsCancel: 'בטל הרשמה'` | `:3414` |
| `isFull && !needsApproval` | `gameStatusWaitlist: 'הצטרף לרשימת המתנה'` | `:821` |
| `needsApproval` | `gameCardRequestJoin: 'בקש להצטרף'` | `:808` |
| else | `matchDetailsJoin: 'הצטרף למחזור'` | `:3415` |

**But `primaryLabel` is not always what renders.** The `primary` builder (`:1912-2022`) can return `null` or override it:
1. `isTerminalGame(game)` → `null` (`:1913`)
2. `game.pendingPromotion?.uid === user.id` → `matchDetailsAcceptOffer: 'נפתח לך מקום — אשר הגעה'` (`:3416`), wins over everything (`:1916-1922`)
3. admin branches (`:1923-1981`): `sessionActionInvitePlayers: 'הזמן שחקנים'` (`:292`) or `sessionActionGoLive: 'עבור ללייב'` (`:295`)
4. registered participant + game active → `sessionActionGoLive` (`:1994-2005`)
5. `if (primaryDestructive) return null` (`:2008`) — **a registered, waitlisted or pending user gets NO button at all on this screen**
6. `if (wasRejected) return null` (`:2011`) — rejected users see no join CTA
7. `if (isFillerCandidate) return null` (`:2016`) — the filler banner owns that flow instead
8. else `{ title: primaryLabel, onPress: handlePrimary }` (`:2017-2021`)

`blockedByConflict = !!preCheckConflict && !!primary && status === 'none'` (`:2025-2026`). When true the sticky bar shows a locked, shake-on-tap button (`:2612-2622`) labelled `matchPrimaryConflict: 'יש לך מחזור אחר בזמן הזה'` (`:3784`).

**Cancelling is menu-only.** Comment at `:2641-2643`: *"the giant red 'בטל הרשמה' is gone; the only exit is the ☰ menu's 'יציאה מהמשחק'"*, gated on `primaryDestructive && canCancelRegistration(game)` (`:2245`), item label `matchMenuLeave: 'יציאה מהמחזור'` (`:3801`), and the confirm lives inside `handlePrimary` so every entry point gets it (`:1414-1434`).

#### 4.4 Pre-tap toasts when `canJoinGame` is false

`performPrimary` (`:901-1000`), branch order at `:917-932`:

| condition | toast | he.ts |
|---|---|---|
| `isFinished(game)` | `matchDetailsAlreadyFinished: 'המחזור הסתיים'` | `:3423` |
| `isCancelled(game)` | `matchDetailsAlreadyCancelled: 'המחזור בוטל'` | `:3424` |
| `isRoundRunning(game)` | `matchDetailsAlreadyLive: 'המחזור כבר במצב לייב'` | `:3421` |
| `startsAt < now` | `matchDetailsAlreadyStarted: 'המחזור כבר התחיל'` | `:3420` |
| `isScheduled(game)` + `registrationOpensAt` | `matchDetailsRegistrationOpensAt: (when) => \`ההרשמה עדיין לא נפתחה — היא תיפתח ב-${when}\`` | `:3418-3419` |
| `isScheduled(game)` without it | `communityNextGameLocked: 'ההרשמה תיפתח בקרוב'` | `:1589` |
| anything else | `matchDetailsClosedForRegistration: 'ההרשמה נסגרה'` | `:3417` |

Then the red-card gate (`:936-965`): `redBlocked` is re-verified against the server at tap time because the mount-time flag doesn't live-update, and on failure shows `redCardBlockToast: 'יש לך כרטיס אדום פעיל במועדון — לא ניתן להירשם'` (`:550`) as an **error** toast, not info.

Guest gate first of all (`:906-908`): `ensureNotGuest(he.guestRegisterJoinGame, { type: 'session', id: game.id })` — `guestRegisterJoinGame: 'כדי להירשם למחזור צריך חשבון. רוצה להירשם עכשיו?'` (`:1803`). The `{type:'session'}` stash is what brings the user back to this game after signup.

#### 4.5 Whole-screen blocked states

- **Not found** (`:1251-1280`): `matchDetailsDeletedTitle` / `matchDetailsDeletedBody` + `deletedTargetBackToMain`, resets to `GameTab/GamesList`.
- **Access blocked** — a non-member opened a community-only game and the rules denied the read (`:1282-1308`). Deliberately leaks nothing: header is the generic screen title, no group name, no fields.
  - `communityOnlyGameTitle: 'מחזור לסגל בלבד'` — `:3474`
  - `communityOnlyGameSubtitle: 'המחזור הזה פתוח רק לחברי המועדון'` — `:3475`
  - `communityOnlyGameBack: 'חזור'` — `:3476`
  - **This is a hard dead end.** There is no "request to join the club" affordance on this screen.
- **Load error** (`:1310-1340`): `matchDetailsLoadErrorTitle` / `matchDetailsLoadErrorBody` + `gameRetry`.

#### 4.6 Registration windows

Three independent timestamps on the `Game` doc:

- **`registrationOpensAt`** (`src/types/index.ts:1782`) — until it passes the game's `status` is `'scheduled'`, set at create time: `const isDeferred = typeof input.registrationOpensAt === 'number' && input.registrationOpensAt > now; const initialStatus = isDeferred ? 'scheduled' : 'open'` (`src/services/gameService.ts:2776-2779`). A Cloud Function (`flipScheduledGames`) flips it to `'open'`. While scheduled: the card CTA is `none` (`MatchListCard.tsx:70`), `getOpenGames` and `getCommunityGames` both filter it out (they require `status == 'open'`), and it appears only in the `'בקרוב במועדונים שלך'` teaser section for **members of that club** (`getMyUpcomingScheduledGames`, `src/services/gameService.ts:2328-2389`). A stranger cannot see a scheduled game at all.
- **`publicOpenAt`** (`src/types/index.ts:1830`) — ms-epoch when a CF flips `visibility` from `'community'` to `'public'`. Latch `publicOpenedAt` (`:1832`). Until it fires, non-members simply do not match the `getOpenGames` query. Set in the wizard at `src/screens/games/GameWizardForm.tsx:1109-1130`, summarised as the hardcoded Hebrew `` `המשחק ייפתח לכל האפליקציה ${when(...)}` `` (`GameWizardForm.tsx:1195` — **string not in he.ts**). Toggle label `wizardPublicOpenToggle: 'פתיחה לכלל האפליקציה בזמן מתוזמן'` (`src/i18n/he.ts:1165`).
- **`guestsOpenAt`** (`src/types/index.ts:1840`) — gates only *adding guests*, never joining. `canAddGuest` (`src/services/gameLifecycle.ts:184-201`): open-only, admins always allowed, otherwise the actor must be a participant (players ∪ waitlist) and `Date.now() >= (game.guestsOpenAt ?? 0)`.

**Rejected lists.** `rejectedPlayerIds` (`src/types/index.ts:1626`, doc-comment `:1620-1625`: *"Terminal: only an admin clears it."*) blocks both the client CTA (`MatchDetailsScreen.tsx:2011`) and the write (`gameService.ts:5243-5247`, and `:5181-5185` in mock).

**Waitlist / promotion offers.** `waitlistApprovalRequired` + `waitlistApprovalTimeoutMinutes` (`src/types/index.ts:1543-1544`). `cancelGameV2` sets `pendingPromotion` rather than auto-seating (comment `MatchDetailsScreen.tsx:1000-1010`). The offered user's CTA becomes `matchDetailsAcceptOffer: 'נפתח לך מקום — אשר הגעה'` (`:3416`), handled by `handleConfirmSpotOffer` (`:1518-1530`). The held reservation counts toward occupancy everywhere (`MatchListCard.tsx:106`, `MatchDetailsScreen.tsx:1394-1395`).

---

### 5. What the user sees after requesting, before an admin approves

#### 5.1 Pending on a GAME (`requiresApproval` → `pending[]`)

| surface | what renders | file:line |
|---|---|---|
| toast at the moment of the tap | `toastGameJoinedPending: 'בקשת ההצטרפות נשלחה'` | `src/i18n/he.ts:235`, `GamesListScreen.tsx:376` |
| the feed card's button | replaced by a grey non-interactive badge `matchStatusPending: 'ממתין לאישור'` | `:3050`, `MatchListCard.tsx:150-152` |
| MatchDetails hero badge | `matchStatusPending: 'ממתין לאישור'`, `tone="neutral"` | `MatchDetailsScreen.tsx:3924-3925` |
| MatchDetails status card **title** | `matchStatusCardYouRegistered: 'אתה רשום למחזור'` | `:3523`, chosen at `MatchDetailsScreen.tsx:333-335` via `const userIsIn = status !== 'none'` |
| MatchDetails status card subtitle | `matchStatusCardWaitingHelper: (n) => \`חסרים עוד ${n} שחקנים כדי להתחיל\`` when under `minPlayers` | `:3521-3522`, `MatchDetailsScreen.tsx:322-325` |
| MatchDetails button | **none.** `primary` returns `null` at `if (primaryDestructive) return null`, and `buildStatusCardProps` then returns `kind: 'none'`, which suppresses the whole actions row | `MatchDetailsScreen.tsx:2008`, `:356-362`; `src/components/match/MatchStatusCTACard.tsx:88` |
| the only way out | ☰ → `matchMenuLeave: 'יציאה מהמחזור'`, confirmed by `leaveGameConfirmTitle` / `leaveGameConfirmBody` | `:3801-3803`, `MatchDetailsScreen.tsx:2245-2257` |

> ⚠️ Factual mismatch worth flagging to the consultant: a user whose request is still **pending approval** is told **`'אתה רשום למחזור'`** ("you are registered for the match"), because `userIsIn` is computed as `status !== 'none'` (`MatchDetailsScreen.tsx:333`) and `'pending'` satisfies it. The hero badge one card above simultaneously says `'ממתין לאישור'`. Same screen, two contradictory claims.

There is **no timeline, no ETA, and no notification-status line** anywhere in the pending state. Nothing tells the user how long approval takes or who is deciding.

#### 5.2 Pending on a CLUB

- toast: `toastJoinRequestSent: 'הבקשה נשלחה'` (`:228`, `PublicGroupsFeedScreen.tsx:379`)
- the club moves into its own feed section `communitiesSectionPending: 'ממתינים לאישור'` (`:1406`, rendered only when non-empty, `PublicGroupsFeedScreen.tsx:823-830`)
- its card CTA becomes the non-tappable `clubCardRequested: 'בקשה נשלחה'` (`:3354`, resolved at `src/utils/clubCard.ts:124-125`), amber-tinted (`ClubCard.tsx:183`, `:190`)
- on the public details screen the primary button becomes `groupsActionPending: 'הבקשה נשלחה'` and is disabled, with `communityCancelJoinRequest: 'בטל בקשת הצטרפות'` beneath it (`CommunityDetailsPublicScreen.tsx:361-378`)
- **a pending member sees none of the club's games.** `getCommunityGames` / `getMyUpcomingScheduledGames` are keyed off `useGroupStore.groups` (members only), never `pendingGroups`.

#### 5.3 Pending as a FILLER candidate

`isFillerCandidate` = signed in, `game.acceptsFillers === true`, `game.status === 'open'`, not a member of the game's club, not already in the roster (`MatchDetailsScreen.tsx:808-819`). Banner at `:2724-2754`:
- `fillerApplyTitle: 'המחזור מחפש שחקנים להשלמה'` — `:3771`
- before: `fillerApplySub: 'הגש מועמדות — מנהל המחזור יאשר אותך ידנית.'` (`:3772`) + a full-width button labelled `gameCardRequestJoin: 'בקש להצטרף'` (`:808`)
- after: `fillerApplySentSub: 'הבקשה נשלחה. מנהל המחזור יחליט אם לאשר.'` (`:3775`) + chip `fillerApplySentChip: 'נשלח'` (`:3776`)
- toast on submit: `fillerApplySent: 'הבקשה נשלחה — ממתין לאישור המנהל'` (`:3774`); failure `fillerApplyError: 'לא הצלחנו לשלוח, נסו שוב'` (`:3777`)
- `fillerApplyCta: 'הגש מועמדות'` (`:3773`) exists in he.ts but the banner now renders `gameCardRequestJoin` instead (`MatchDetailsScreen.tsx:2746`) — an **orphaned string**
- the sticky CTA is suppressed for this user so the two request mechanisms don't co-exist (`:2012-2016`)
- `fillerState` is **local component state only** (`:821`). Navigating away and back re-renders `'idle'` and the button says `'בקש להצטרף'` again, with no record that a request is outstanding.

---

### 6. Dead ends where a new user gets stuck

**D1 — The empty home has no hero and no primary action.** With no club, `nextGame`, `openToJoin` and `scheduledUpcoming` are all empty (`ProfileScreen.tsx:344-399`), `pickHomeHero` returns `'none'` (`src/utils/homeHero.ts:38-39`), and the hero slot renders `null` (`ProfileScreen.tsx:1258`). The card written for exactly this moment — `'אין לך מחזור קרוב' / 'מצא מחזור פתוח או פתח מחזור חדש' / 'מצא מחזור'` — is unreachable (§1.5). What remains above the fold is a coach's one-liner and three equal-weight tiles.

**D2 — The outgoing-requests inbox does not exist.** The bell at `ProfileScreen.tsx:1157-1164` and `GamesListScreen.tsx:836-848` opens `RequestsScreen`, whose data is `getInboxCount` / `getInboxRequests` — `friendsService.listIncomingRequests` + `myAdminGroupsWithPending` + `myGamesWithPending` (`src/services/requestsService.ts:59-69`, `:72-97`). All three are **incoming, admin-side**. A new user's own pending club and game requests appear in **no inbox anywhere**. Empty state: `requestsEmpty: 'אין בקשות ממתינות'` (`:1668`), `requestsEmptyHint: 'בקשות חברות, הצטרפות למועדונים ולמחזורים יופיעו כאן.'` (`:1669`) — copy that reads as if it covers outgoing requests, and does not.

**D3 — A closed club with no admin response.** `isOpen` defaults false (§2.2). The user waits with no ETA, no reminder, no channel. The only escape is the `'בטל בקשת הצטרפות'` button on the public details screen (`CommunityDetailsPublicScreen.tsx:371`). WhatsApp contact exists only if the admin filled `contactPhone` (`:341`).

**D4 — Community-only game via an invite link.** The blocked screen (`MatchDetailsScreen.tsx:1282-1308`) shows `'מחזור לסגל בלבד'` / `'המחזור הזה פתוח רק לחברי המועדון'` and one button, `'חזור'`. It cannot name the club (by design, `:1283-1286`), so the user cannot go and request to join it.

**D5 — Rejected from a game.** `wasRejected` hides the CTA permanently (`:2011`), tapping anything that reaches the service yields `matchDetailsJoinRejected: 'בקשתך למחזור זה נדחתה ולא ניתן להירשם שוב.'` (`:3422`), and the field is terminal — *"only an admin clears it"* (`src/types/index.ts:1624`). No appeal path.

**D6 — "פתח מחזור" for a user with no club.** The tile routes to the chooser (`ProfileScreen.tsx:1303-1306`). `canCreateCommunityGame` requires admin of some club (`GamesListScreen.tsx:552-553`), so the `'מחזור למועדון'` card is rendered **locked** with a padlock and:
- `createGameChooseCommunityLocked: 'מחזור למועדון קבוע שלך — אבל עדיין אין לך מועדון. הקם מועדון ראשון כדי לפתוח לו מחזורים.'` — `:1158-1159`
- or, for a member who isn't an admin: `createGameChooseCommunityNotAdmin: 'רק מנהל מועדון יכול לפתוח מחזור למועדון. בקש מהמנהל שלכם לפתוח, או הקם מועדון משלך.'` — `:1160-1161`
A rescue CTA appears below it (`GamesListScreen.tsx:1178-1207`): `createGameCreateCommunityCta: 'הקמת מועדון ראשון'` (`:1162`) or `createGameCreateOwnCommunityCta: 'הקמת מועדון משלי'` (`:1163`). So it is an obstacle, not a true dead end — **provided `rcBool('feature_quick_games')` is on** (`GamesListScreen.tsx:1141`). If that flag is off, the chooser contains only the locked card and the escape button.

**D7 — Reaching `GameCreate` directly with no club.** Three separate full-screen gates (`GameCreateScreen.tsx:362-394`):
- `createGameNoCommunities: 'לפני שתוכל ליצור מחזור, צריך להצטרף למועדון'` (`:1196`) + `OrphanCta`
- `createGameNoAdmin: 'רק מנהלי מועדון יכולים ליצור מחזורים. בקש מהמנהל של המועדון ליצור עבורך מחזור.'` (`:1197-1198`) + `OrphanCta`
`OrphanCta` (`GameCreateScreen.tsx:668-701`) reads `createGameOrphanCta: 'צור מחזור חד־פעמי'` (`:1239`) / `createGameOrphanCtaSub: 'בלי מועדון — מהיר, רק עבור המחזור'` (`:1240`). Note the **contradiction**: `'לפני שתוכל ליצור מחזור, צריך להצטרף למועדון'` sits directly above a button that creates a game without one.

**D8 — Zero public games.** If `getOpenGames` returns nothing, the feed shows `'אין כרגע מחזורים פתוחים שמתאימים לך'` plus discovery blocks. Not a hard stop, but the only two exits are "create a game" and "join a club", and per the sort comment in `PublicGroupsFeedScreen.tsx:317-328`, most clubs in the directory have never opened a round.

**D9 — Generic app invite lands nowhere.** `pending.type === 'app'` clears the stash and returns, leaving the user on the empty home (`RootNavigator.tsx:77-80`). No "X invited you" acknowledgement.

**D10 — The guest cul-de-sac.** A guest browsing games hits `ensureNotGuest` on join (`MatchDetailsScreen.tsx:906`), creating a club (`GamesListScreen.tsx:315`) or joining one (`PublicGroupsFeedScreen.tsx:347`). Choosing `'הרשמה'` calls `signOut()` (`src/utils/guestGate.ts:58`), which unmounts the whole navigator. The return target survives only via the stash (`:51-57`) and only for `session` / `team` types.

---

### 7. Minimum tap count, account created → registered for a game

Counting discrete screen taps, not keystrokes. "Registered" = the user's uid is in `players[]`.

#### Best case — 6 taps (create a quick game; the creator is auto-registered)

The decisive line: `const autoSelfRegister = input.isOrphanContext === true && !isDeferred; const initialPlayers = autoSelfRegister ? [input.createdBy] : []` (`src/services/gameService.ts:2788-2790`), with the reasoning at `:2781-2787`: *"Quick games ('orphan context') are created by a user who wants to PLAY them — the wizard never asks whether to self-register, because it's implicit."*

| # | tap | file:line |
|---|---|---|
| 1 | home tile `'פתח מחזור'` → `GamesList` with `openCreate:true` → chooser opens automatically | `ProfileScreen.tsx:1303-1306`; `GamesListScreen.tsx:325-334` |
| 2 | `'מחזור מהיר'` in the chooser → `GameCreate { quick: true }` | `GamesListScreen.tsx:1155-1157`; label `:1700` |
| — | type a field location (`createGameField: 'מיקום המגרש'`, `:870`) — the only required field, `GameWizardForm.tsx:343` | |
| 3 | `wizardStepNext: 'המשך'` (step 1 → 2) | `:1124`; `GameWizardForm.tsx:554-562` |
| 4 | `'המשך'` (step 2 → 3) | same |
| 5 | `createGameSubmit: 'יצירת מחזור'` → opens the summary sheet | `:961`; `GameWizardForm.tsx:563-571` |
| 6 | `wizardSummaryConfirm: 'אישור ויצירה'` | `:1190`; `GameWizardForm.tsx:635-648` |

Result: `nav.replace('MatchDetails', { gameId, celebrate: true })` (`GameCreateScreen.tsx:545-548`) and the creator is already in `players[]`.

Caveats that can make it more: the quick path first provisions a hidden personal group (`groupService.ensurePersonalGroupId()`, `GameCreateScreen.tsx:192`) behind a spinner, `createGameQuickLoading: 'מכינים מחזור מהיר…'` (`:1242`, `GameCreateScreen.tsx:619-629`); the whole `'מחזור מהיר'` option is behind `rcBool('feature_quick_games')` (`GamesListScreen.tsx:1141`); and the app's own `overrides.quick` blanks the title field (`GameCreateScreen.tsx:62-65`, `:95`) so most users will type a name too.

This is "registered" in the bookkeeping sense only — there is no opponent yet.

#### Best case with another human — 2 taps (join an existing open public game)

| # | tap | file:line |
|---|---|---|
| 1 | home tile `'הצטרף למחזור'` → `GameTab` → `GamesList` | `ProfileScreen.tsx:1321` |
| 2 | `matchCardJoinShort: 'הצטרף'` on a card in `'מחזורים פתוחים'` | `:3033`; `MatchListCard.tsx:139-140`, handler `GamesListScreen.tsx:370-380` |

Requires all of: a public, open, future game exists (`gameService.ts:2547-2554`); it isn't full; `requiresApproval === false`; no schedule conflict; the user isn't in `rejectedPlayerIds`. Success toast `'הצטרפת למחזור'` (`:231`). Going via MatchDetails instead makes it 3 (card body → `'הצטרף למחזור'`, `:3415`).

#### Realistic case — 4 taps of user action plus an unbounded human wait

For a brand-new user the public feed is usually empty (§6 D8), so the real route is through a club:

| # | tap | file:line |
|---|---|---|
| 1 | `'גלה מועדונים'` on the coach card (or the `'מועדונים'` tab) → `CommunitiesFeed` | `ProfileScreen.tsx:924-926`; label `:3293` |
| 2 | `clubCardRequest: 'בקש להצטרף'` on a club card (default, because `isOpen` defaults false) | `:3353`; `src/utils/clubCard.ts:126-128` |
| **wait** | an admin approves. No inbox, no ETA, no reminder for the requester (§6 D2/D3). | |
| 3 | open the club's game — from home's hero if one is open (`UpcomingScheduledGameCard` / `HomeNextGameCard`, `ProfileScreen.tsx:1228-1259`) or from `'מחזורים פתוחים'` in the feed | |
| 4 | `'הצטרף'` / `'הצטרף למחזור'` | `:3033` / `:3415` |

And step 4 may not end it either. If the club's game carries `requiresApproval`, tap 4 produces `'בקשת ההצטרפות נשלחה'` (`:235`) and the user is `pending`, not registered — a **second** unbounded admin wait, during which the app tells them `'אתה רשום למחזור'` (§5.1). If the club's game is `scheduled`, there is no button at all until the CF flips it (`MatchListCard.tsx:70`).

**Summary:** 2 taps in the ideal supply case, 6 self-service taps to a match with nobody in it, and in the realistic case 4 taps spread across up to two open-ended human approvals that the app gives the new user no way to track.