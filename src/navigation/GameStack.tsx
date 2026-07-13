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
import { GamesListScreen } from '@/screens/games/GamesListScreen';
import { RequestsScreen } from '@/screens/RequestsScreen';
import { GameCreateScreen } from '@/screens/games/GameCreateScreen';
import { GameEditScreen } from '@/screens/games/GameEditScreen';
import { MatchDetailsScreen } from '@/screens/games/MatchDetailsScreen';
import { EveningSummaryScreen } from '@/screens/games/EveningSummaryScreen';
import { PitchCalibrationScreen } from '@/screens/pitch/PitchCalibrationScreen';
import { LiveMatchScreen } from '@/screens/LiveMatchScreen';
import { AvailablePlayersScreen } from '@/screens/games/AvailablePlayersScreen';
import { AddMembersScreen } from '@/screens/games/AddMembersScreen';
import { MatchPlayersScreen } from '@/screens/games/MatchPlayersScreen';
import { DraftSetupScreen } from '@/screens/games/DraftSetupScreen';
import { DraftBoardScreen } from '@/screens/games/DraftBoardScreen';
import { PlayerCardScreen } from '@/screens/players/PlayerCardScreen';
import { PlayerTimelineScreen } from '@/screens/players/PlayerTimelineScreen';
import { CommunityDetailsScreen } from '@/screens/communities/CommunityDetailsScreen';
import { CommunityEditScreen } from '@/screens/communities/CommunityEditScreen';
import { CommunityPlayersScreen } from '@/screens/communities/CommunityPlayersScreen';
import { CommunityStatsScreen } from '@/screens/communities/CommunityStatsScreen';
import { CommunityHistoryScreen } from '@/screens/communities/CommunityHistoryScreen';
import { AdminApprovalScreen } from '@/screens/groups/AdminApprovalScreen';
import { HistoryScreen } from '@/screens/tabs/HistoryScreen';
import { PromoteOrphanScreen } from '@/screens/games/PromoteOrphanScreen';
import { MapScreen, type MapScreenParams } from '@/screens/map/MapScreen';

export type GameStackParamList = {
  /** `openCreate` (from the home quick-action) pops the create-game chooser. */
  GamesList: undefined | { openCreate?: boolean };
  Requests: undefined;
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
  GameEdit: { gameId: string };
  /** Read-mostly view of one match. */
  MatchDetails: { gameId: string };
  /** Shareable personal "סיכום הערב" for a finished game. Registered in
   *  GameStack + ProfileStack + CommunitiesStack (shared screen). */
  EveningSummary: { gameId: string };
  /** v2 — live-match screen takes the gameId of the game it manages. */
  LiveMatch: { gameId: string };
  /** Phase 9 — find invitable players for a specific game. */
  AvailablePlayers: { gameId: string };
  AddMembers: { gameId: string; reserve?: boolean };
  /** Full roster for one match — pulled out of MatchDetails. */
  MatchPlayers: { gameId: string };
  /** Admin-only "ניהול משחק" surface. */
  /** Draft Teams (חלוקת כוחות) — step 1: pick captains + draft order. */
  DraftSetup: { gameId: string };
  /** Draft Teams — step 2: the live draft board + summary. */
  DraftBoard: {
    gameId: string;
    captainIds: string[];
    method: 'snake' | 'regular';
    /** Reconstruct picks from the game's saved draftTeams → opens on the
     *  summary (editable). */
    resume?: boolean;
    /** View-only (non-managers): summary without edit/finish actions. */
    readOnly?: boolean;
  };
  PlayerCard: { userId: string; groupId?: string };
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
  /** Pitch calibration — reachable from CommunityDetails' admin menu, which is
   *  hosted in this stack too, so it must be registered here (cross-stack
   *  navigate() no-ops otherwise). */
  PitchCalibration: { groupId: string };
  CommunityEdit: { groupId: string };
  CommunityPlayers: { groupId: string };
  CommunityStats: { groupId: string };
  CommunityHistory: { groupId: string };
  AdminApproval: undefined;
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

const Stack = createNativeStackNavigator<GameStackParamList>();

export function GameStack() {
  return (
    <Stack.Navigator
      initialRouteName="GamesList"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="GamesList" component={GamesListScreen} />
      <Stack.Screen name="Requests" component={RequestsScreen} />
      <Stack.Screen name="GamesMap" component={MapScreen} />
      <Stack.Screen name="GameCreate" component={GameCreateScreen} />
      <Stack.Screen name="GameEdit" component={GameEditScreen} />
      <Stack.Screen name="MatchDetails" component={MatchDetailsScreen} />
      <Stack.Screen name="EveningSummary" component={EveningSummaryScreen} />
      <Stack.Screen name="LiveMatch" component={LiveMatchScreen} />
      <Stack.Screen
        name="AvailablePlayers"
        component={AvailablePlayersScreen}
      />
      <Stack.Screen name="AddMembers" component={AddMembersScreen} />
      <Stack.Screen name="MatchPlayers" component={MatchPlayersScreen} />
      <Stack.Screen name="DraftSetup" component={DraftSetupScreen} />
      <Stack.Screen name="DraftBoard" component={DraftBoardScreen} />
      <Stack.Screen name="PlayerCard" component={PlayerCardScreen} />
      <Stack.Screen name="PlayerTimeline" component={PlayerTimelineScreen} />
      <Stack.Screen name="CommunityDetails" component={CommunityDetailsScreen} />
      <Stack.Screen name="PitchCalibration" component={PitchCalibrationScreen} />
      <Stack.Screen name="CommunityEdit" component={CommunityEditScreen} />
      <Stack.Screen name="CommunityPlayers" component={CommunityPlayersScreen} />
      <Stack.Screen name="CommunityStats" component={CommunityStatsScreen} />
      <Stack.Screen name="CommunityHistory" component={CommunityHistoryScreen} />
      <Stack.Screen name="AdminApproval" component={AdminApprovalScreen} />
      <Stack.Screen name="History" component={HistoryScreen} />
      <Stack.Screen name="PromoteOrphan" component={PromoteOrphanScreen} />
    </Stack.Navigator>
  );
}
