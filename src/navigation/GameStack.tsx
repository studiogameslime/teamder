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
import { PlayerCardScreen } from '@/screens/players/PlayerCardScreen';
import { CommunityDetailsScreen } from '@/screens/communities/CommunityDetailsScreen';
import { HistoryScreen } from '@/screens/tabs/HistoryScreen';

export type GameStackParamList = {
  GamesList: undefined;
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
  PlayerCard: { userId: string; groupId?: string };
  /** Reachable from MatchDetails' community-link icon. Same component
   *  as in CommunitiesStack — instances are per-stack. */
  CommunityDetails: { groupId: string };
  /** Reachable from MatchDetails' overflow menu. Pushed in-stack so
   *  back returns to the match. */
  History: undefined;
};

const Stack = createNativeStackNavigator<GameStackParamList>();

export function GameStack() {
  return (
    <Stack.Navigator
      initialRouteName="GamesList"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="GamesList" component={GamesListScreen} />
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
      <Stack.Screen name="PlayerCard" component={PlayerCardScreen} />
      <Stack.Screen name="CommunityDetails" component={CommunityDetailsScreen} />
      <Stack.Screen name="History" component={HistoryScreen} />
    </Stack.Navigator>
  );
}
