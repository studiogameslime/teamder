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
import { GameCreateScreen } from '@/screens/games/GameCreateScreen';
import { GameEditScreen } from '@/screens/games/GameEditScreen';
import { MatchDetailsScreen } from '@/screens/games/MatchDetailsScreen';
import { LiveMatchScreen } from '@/screens/LiveMatchScreen';
import { AvailablePlayersScreen } from '@/screens/games/AvailablePlayersScreen';
import { MatchPlayersScreen } from '@/screens/games/MatchPlayersScreen';
import { MatchManageScreen } from '@/screens/games/MatchManageScreen';
import { DraftSetupScreen } from '@/screens/games/DraftSetupScreen';
import { DraftBoardScreen } from '@/screens/games/DraftBoardScreen';
import { PlayerCardScreen } from '@/screens/players/PlayerCardScreen';
import { CommunityDetailsScreen } from '@/screens/communities/CommunityDetailsScreen';
import { HistoryScreen } from '@/screens/tabs/HistoryScreen';
import { PromoteOrphanScreen } from '@/screens/games/PromoteOrphanScreen';
import { RatePlayersScreen } from '@/screens/games/RatePlayersScreen';
import { MapScreen, type MapScreenParams } from '@/screens/map/MapScreen';

export type GameStackParamList = {
  GamesList: undefined;
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
      };
  /** Edit metadata of an existing game. Only the organizer should reach this. */
  GameEdit: { gameId: string };
  /** Read-mostly view of one match. */
  MatchDetails: { gameId: string };
  /** v2 — live-match screen takes the gameId of the game it manages. */
  LiveMatch: { gameId: string };
  /** Phase 9 — find invitable players for a specific game. */
  AvailablePlayers: { gameId: string };
  /** Full roster for one match — pulled out of MatchDetails. */
  MatchPlayers: { gameId: string };
  /** Admin-only "ניהול משחק" surface. */
  MatchManage: { gameId: string };
  /** Draft Teams (חלוקת כוחות) — step 1: pick captains + draft order. */
  DraftSetup: { gameId: string };
  /** Draft Teams — step 2: the live draft board + summary. */
  DraftBoard: {
    gameId: string;
    captainIds: string[];
    method: 'snake' | 'regular';
    /** Live-rotation fill behaviour chosen on the setup screen. */
    fillMode?: import('@/types').FillMode;
    /** Reconstruct picks from the game's saved draftTeams → opens on the
     *  summary (editable). */
    resume?: boolean;
    /** View-only (non-managers): summary without edit/finish actions. */
    readOnly?: boolean;
  };
  PlayerCard: { userId: string; groupId?: string };
  /** Reachable from MatchDetails' community-link icon. Same component
   *  as in CommunitiesStack — instances are per-stack. */
  CommunityDetails: { groupId: string };
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
  RatePlayers: { gameId: string };
};

const Stack = createNativeStackNavigator<GameStackParamList>();

export function GameStack() {
  return (
    <Stack.Navigator
      initialRouteName="GamesList"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="GamesList" component={GamesListScreen} />
      <Stack.Screen name="GamesMap" component={MapScreen} />
      <Stack.Screen name="GameCreate" component={GameCreateScreen} />
      <Stack.Screen name="GameEdit" component={GameEditScreen} />
      <Stack.Screen name="MatchDetails" component={MatchDetailsScreen} />
      <Stack.Screen name="LiveMatch" component={LiveMatchScreen} />
      <Stack.Screen
        name="AvailablePlayers"
        component={AvailablePlayersScreen}
      />
      <Stack.Screen name="MatchPlayers" component={MatchPlayersScreen} />
      <Stack.Screen name="MatchManage" component={MatchManageScreen} />
      <Stack.Screen name="DraftSetup" component={DraftSetupScreen} />
      <Stack.Screen name="DraftBoard" component={DraftBoardScreen} />
      <Stack.Screen name="PlayerCard" component={PlayerCardScreen} />
      <Stack.Screen name="CommunityDetails" component={CommunityDetailsScreen} />
      <Stack.Screen name="History" component={HistoryScreen} />
      <Stack.Screen name="PromoteOrphan" component={PromoteOrphanScreen} />
      <Stack.Screen name="RatePlayers" component={RatePlayersScreen} />
    </Stack.Navigator>
  );
}
