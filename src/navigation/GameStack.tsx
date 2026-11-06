// Games tab navigation:
//   GamesList → MatchDetails → LiveMatch
//                            → AvailablePlayers
//                            → PlayerCard
//                            → CommunityDetails (community-link icon)
//
// The pre-v2 flow (GameRegistration → GameDetails → TeamSetup →
// GoalkeeperOrder) was retired with the matches-list redesign. The
// MatchDetails screen now hosts every read action (roster, sticky CTA,
// admin tools); LiveMatch is the on-pitch surface.
//
// CommunityDetails is registered here (in addition to CommunitiesStack)
// so that tapping the community-link icon inside MatchDetails pushes
// the community page onto the SAME stack — back returns to the match,
// not to the Communities tab.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { MapScreenParams } from '@/screens/map/MapScreen';

export type GameStackParamList = {
  /** `openCreate` (from the home quick-action) pops the create-game chooser. */
  GamesList: undefined | { openCreate?: boolean };
  Requests: { groupId?: string } | undefined;
  /** Full-screen map of open public games (mode: 'games'). */
  GamesMap: MapScreenParams;
  GameCreate:
    | undefined
    | {
        groupId?: string;
        startsAt?: number;
        format?: import('@/types').GameFormat;
        numberOfTeams?: number;
        /** When true the wizard opens in "recurring" mode — adds the
         *  required `registrationOpensAt` field at step 3. Triggered
         *  from CommunityDetails' "צור משחק קבוע" entry. */
        recurring?: boolean;
        /** When true, skip the community picker and start a quick
         *  (no-community) game — the screen auto-provisions the hidden
         *  personal group. Triggered from the "+" quick-game choice. */
        quick?: boolean;
        /** From the home availability calendar: start-of-day + window to
         *  pre-fill the kickoff, and a flag to force acceptsFillers on. */
        prefillDateMs?: number;
        prefillWindow?: import('@/types').TimeBucket;
        /** Viewer's city — seeds the quick game so the pulse engine has a
         *  location to match nearby players against. */
        prefillCity?: string;
        inviteAvailable?: boolean;
      };
  /** Edit metadata of an existing game. Only the organizer should reach this. */
  GameEdit: {
    gameId: string;
    /** Save should ALSO overwrite the weekly series template, so every future
     *  occurrence is built from what's being saved now. */
    applyToSeries?: boolean;
  };
  /** Read-mostly view of one match. */
  // `initialTab` names which of the four tabs opens first. It exists because the
  // statistics tab IS the evening's summary now — the standalone RoundSummary
  // screen was removed — so anything that used to send a person to that summary
  // sends them here instead. Absent → "מידע", which is what every existing
  // caller passes and expects.
  MatchDetails: { gameId: string; initialTab?: 'info' | 'games' | 'stats' | 'players' };
  /** Shareable personal "סיכום הערב" for a finished game. Registered in
   *  GameStack + ProfileStack + CommunitiesStack (shared screen). */
  EveningSummary: { gameId: string };
  MyActivity: undefined;
  /** `seasonId` omitted = the season currently running. */
  SeasonSummary: { groupId: string; seasonId?: string };
  /** Per-game history of a finished round ("היסטוריית המשחקים"). Shared
   *  screen — registered in GameStack + ProfileStack + CommunitiesStack. */
  // `live` is set when the screen is opened from the live screen mid-evening.
  // It changes the title and the empty-state copy and adds a refresh on
  // focus; the list itself is the same committed round history either way.
  MatchRounds: { gameId: string; live?: boolean };
  /** v2 — live-match screen takes the gameId of the game it manages. */
  LiveMatch: { gameId: string };
  /** Phase 9 — find invitable players for a specific game. */
  AvailablePlayers: { gameId: string };
  AddMembers: { gameId: string; reserve?: boolean };
  /** Full roster for one match — pulled out of MatchDetails. */
  MatchPlayers: { gameId: string };
  /** Admin-only "ניהול משחק" surface. */
  /** Draft Teams (חלוקת כוחות) — step 1: pick captains + draft order. */
  DraftSetup: { gameId: string; returnRouteKey?: string; resumeManual?: boolean; editExisting?: boolean };
  /** Draft Teams — step 2: the live draft board + summary. */
  DraftBoard: {
    gameId: string;
    returnRouteKey?: string;
    captainIds: string[];
    method: 'snake' | 'regular';
    /** Reconstruct picks from the game's saved draftTeams → opens on the
     *  summary (editable). */
    resume?: boolean;
    /** The acknowledged generated draft; older reads must not display it. */
    expectedDraftCreatedAt?: number;
    /** View-only (non-managers): summary without edit/finish actions. */
    readOnly?: boolean;
  };
  Statistics: { userId?: string } | undefined;
  Feedback: { type?: 'bug' | 'suggestion'; playerId?: string; playerName?: string } | undefined;
  PlayerCard: { userId: string; groupId?: string };
  Achievements: undefined;
  PlayerCompare: { groupId: string; otherUid: string; otherName?: string };
  /** Admin-only per-community player timeline — reachable from
   *  CommunityPlayers (opened via the community-link icon). */
  PlayerTimeline: { userId: string; groupId: string; name?: string };
  /** Reachable from MatchDetails' community-link icon. Same component
   *  as in CommunitiesStack — instances are per-stack. The full set of
   *  screens CommunityDetails links to is duplicated below so that drilling
   *  from a community opened in THIS stack stays in-stack (a route missing
   *  here makes navigate() silently no-op — that's the bug where "רשימת
   *  השחקנים" did nothing when the club was opened from the Games tab). */
  CommunityDetails: { groupId: string };
  /** Public preview of a club the viewer is NOT a member of — reached from the
   *  "מועדונים באזור שלך" section on the games list. Registered here (as well
   *  as in CommunitiesStack) so back returns to the matches tab; without the
   *  registration navigate() would silently no-op. */
  CommunityDetailsPublic: { groupId: string; fromInvitation?: boolean };
  /** Reached from the "ביקוש באזור שלך" card ("גם אני פנוי" / "הגדר אזור"),
   *  so declaring availability doesn't bounce the user out to the profile tab. */
  AvailabilityEdit: undefined;
  CommunityEdit: { groupId: string };
  CommunityPlayers: { groupId: string };
  ManagerDashboard: { groupId: string; initialTab?: 'overview' | 'club' | 'ratings' | 'equipment'; initialFilter?: 'all' | 'up' | 'down' };
  CommunityStats: { groupId: string };
  CommunityHistory: { groupId: string };
  /**
   * The contextual auth sheet's «המשך עם מייל» pushes this.
   *
   * It lives in AuthStack, which is only mounted when there is NO user — and
   * the sheet is only ever shown to a guest, who has one. So the navigate
   * resolved to nothing and the option was dead: "The action 'NAVIGATE' with
   * payload {name:'EmailAuth'} was not handled". Same component, one instance
   * per stack, exactly like MatchDetails and CommunityDetails above.
   */
  EmailAuth: undefined;
  AdminApproval: { groupId?: string } | undefined;
  /** Reachable from MatchDetails' overflow menu. Pushed in-stack so
   *  back returns to the match. */
  History: undefined;
  /** Post-orphan-game "צור קבוצה" prompt — opens with the personal
   *  group + game preselected. Reachable from the `promotePrompt`
   *  notification tap and from a CTA on the finished orphan game's
   *  details screen. */
  PromoteOrphan: { groupId: string; gameId: string };
  /** Rate the registered players you played with — reached from the
   *  "דרג את חבריך מהמשחק" banner on a finished match. */
};

// Screen modules are evaluated only when their route renders. Keep all route
// registrations local so shared destinations preserve their back stack.
const Stack = createNativeStackNavigator<GameStackParamList>();

export function GameStack() {
  return (
    <Stack.Navigator
      initialRouteName="GamesList"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="GamesList" getComponent={() => require('@/screens/games/GamesListScreen').GamesListScreen as typeof import('@/screens/games/GamesListScreen').GamesListScreen} />
      <Stack.Screen name="Requests" getComponent={() => require('@/screens/RequestsScreen').RequestsScreen as typeof import('@/screens/RequestsScreen').RequestsScreen} />
      <Stack.Screen name="GamesMap" getComponent={() => require('@/screens/map/MapScreen').MapScreen as typeof import('@/screens/map/MapScreen').MapScreen} />
      <Stack.Screen name="GameCreate" getComponent={() => require('@/screens/games/GameCreateScreen').GameCreateScreen as typeof import('@/screens/games/GameCreateScreen').GameCreateScreen} />
      <Stack.Screen name="GameEdit" getComponent={() => require('@/screens/games/GameEditScreen').GameEditScreen as typeof import('@/screens/games/GameEditScreen').GameEditScreen} />
      <Stack.Screen name="MatchDetails" getComponent={() => require('@/screens/games/MatchDetailsScreen').MatchDetailsScreen as typeof import('@/screens/games/MatchDetailsScreen').MatchDetailsScreen} />
      <Stack.Screen name="EveningSummary" getComponent={() => require('@/screens/games/EveningSummaryScreen').EveningSummaryScreen as typeof import('@/screens/games/EveningSummaryScreen').EveningSummaryScreen} />
      <Stack.Screen name="MyActivity" getComponent={() => require('@/screens/profile/MyActivityScreen').MyActivityScreen as typeof import('@/screens/profile/MyActivityScreen').MyActivityScreen} />
      <Stack.Screen name="SeasonSummary" getComponent={() => require('@/screens/profile/SeasonSummaryScreen').SeasonSummaryScreen as typeof import('@/screens/profile/SeasonSummaryScreen').SeasonSummaryScreen} />
      <Stack.Screen name="MatchRounds" getComponent={() => require('@/screens/games/MatchRoundsScreen').MatchRoundsScreen as typeof import('@/screens/games/MatchRoundsScreen').MatchRoundsScreen} />
      <Stack.Screen name="LiveMatch" getComponent={() => require('@/screens/LiveMatchScreen').LiveMatchScreen as typeof import('@/screens/LiveMatchScreen').LiveMatchScreen} />
      <Stack.Screen
        name="AvailablePlayers"
        getComponent={() => require('@/screens/games/AvailablePlayersScreen').AvailablePlayersScreen as typeof import('@/screens/games/AvailablePlayersScreen').AvailablePlayersScreen}
      />
      <Stack.Screen name="AddMembers" getComponent={() => require('@/screens/games/AddMembersScreen').AddMembersScreen as typeof import('@/screens/games/AddMembersScreen').AddMembersScreen} />
      <Stack.Screen name="MatchPlayers" getComponent={() => require('@/screens/games/MatchPlayersScreen').MatchPlayersScreen as typeof import('@/screens/games/MatchPlayersScreen').MatchPlayersScreen} />
      <Stack.Screen name="DraftSetup" getComponent={() => require('@/screens/games/DraftSetupScreen').DraftSetupScreen as typeof import('@/screens/games/DraftSetupScreen').DraftSetupScreen} />
      <Stack.Screen name="DraftBoard" getComponent={() => require('@/screens/games/DraftBoardScreen').DraftBoardScreen as typeof import('@/screens/games/DraftBoardScreen').DraftBoardScreen} />
      <Stack.Screen name="PlayerCard" getComponent={() => require('@/screens/players/PlayerCardScreen').PlayerCardScreen as typeof import('@/screens/players/PlayerCardScreen').PlayerCardScreen} />
      <Stack.Screen name="Achievements" getComponent={() => require('@/screens/profile/AchievementsScreen').AchievementsScreen as typeof import('@/screens/profile/AchievementsScreen').AchievementsScreen} />
      <Stack.Screen name="Statistics" getComponent={() => require('@/screens/profile/StatisticsScreen').StatisticsScreen as typeof import('@/screens/profile/StatisticsScreen').StatisticsScreen} />
      <Stack.Screen name="Feedback" getComponent={() => require('@/screens/FeedbackScreen').FeedbackScreen as typeof import('@/screens/FeedbackScreen').FeedbackScreen} />
      <Stack.Screen name="PlayerCompare" getComponent={() => require('@/screens/players/PlayerCompareScreen').PlayerCompareScreen as typeof import('@/screens/players/PlayerCompareScreen').PlayerCompareScreen} />
      <Stack.Screen name="PlayerTimeline" getComponent={() => require('@/screens/players/PlayerTimelineScreen').PlayerTimelineScreen as typeof import('@/screens/players/PlayerTimelineScreen').PlayerTimelineScreen} />
      <Stack.Screen name="CommunityDetails" getComponent={() => require('@/screens/communities/CommunityDetailsScreen').CommunityDetailsScreen as typeof import('@/screens/communities/CommunityDetailsScreen').CommunityDetailsScreen} />
      <Stack.Screen
        name="CommunityDetailsPublic"
        getComponent={() => require('@/screens/communities/CommunityDetailsPublicScreen').CommunityDetailsPublicScreen as typeof import('@/screens/communities/CommunityDetailsPublicScreen').CommunityDetailsPublicScreen}
      />
      <Stack.Screen name="AvailabilityEdit" getComponent={() => require('@/screens/profile/AvailabilityEditScreen').AvailabilityEditScreen as typeof import('@/screens/profile/AvailabilityEditScreen').AvailabilityEditScreen} />
      <Stack.Screen name="CommunityEdit" getComponent={() => require('@/screens/communities/CommunityEditScreen').CommunityEditScreen as typeof import('@/screens/communities/CommunityEditScreen').CommunityEditScreen} />
      <Stack.Screen name="CommunityPlayers" getComponent={() => require('@/screens/communities/CommunityPlayersScreen').CommunityPlayersScreen as typeof import('@/screens/communities/CommunityPlayersScreen').CommunityPlayersScreen} />
      <Stack.Screen name="ManagerDashboard" getComponent={() => require('@/screens/communities/ManagerDashboardScreen').ManagerDashboardScreen as typeof import('@/screens/communities/ManagerDashboardScreen').ManagerDashboardScreen} />
      <Stack.Screen name="CommunityStats" getComponent={() => require('@/screens/communities/CommunityStatsScreen').CommunityStatsScreen as typeof import('@/screens/communities/CommunityStatsScreen').CommunityStatsScreen} />
      <Stack.Screen name="CommunityHistory" getComponent={() => require('@/screens/communities/CommunityHistoryScreen').CommunityHistoryScreen as typeof import('@/screens/communities/CommunityHistoryScreen').CommunityHistoryScreen} />
      <Stack.Screen name="AdminApproval" getComponent={() => require('@/screens/groups/AdminApprovalScreen').AdminApprovalScreen as typeof import('@/screens/groups/AdminApprovalScreen').AdminApprovalScreen} />
      <Stack.Screen name="EmailAuth" getComponent={() => require('@/screens/auth/EmailAuthScreen').EmailAuthScreen as typeof import('@/screens/auth/EmailAuthScreen').EmailAuthScreen} />
      <Stack.Screen name="History" getComponent={() => require('@/screens/tabs/HistoryScreen').HistoryScreen as typeof import('@/screens/tabs/HistoryScreen').HistoryScreen} />
      <Stack.Screen name="PromoteOrphan" getComponent={() => require('@/screens/games/PromoteOrphanScreen').PromoteOrphanScreen as typeof import('@/screens/games/PromoteOrphanScreen').PromoteOrphanScreen} />
    </Stack.Navigator>
  );
}
