// Games tab navigation:
//   GamesList → MatchDetails → LiveMatch
//                            → AvailablePlayers
//                            → PlayerCard
//
// The pre-v2 flow (GameRegistration → GameDetails → TeamSetup →
// GoalkeeperOrder) was retired with the matches-list redesign. The
// MatchDetails screen now hosts every read action (roster, sticky CTA,
// admin tools); LiveMatch is the on-pitch surface.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GamesListScreen } from '@/screens/games/GamesListScreen';
import { GameCreateScreen } from '@/screens/games/GameCreateScreen';
import { MatchDetailsScreen } from '@/screens/games/MatchDetailsScreen';
import { LiveMatchScreen } from '@/screens/LiveMatchScreen';
import { AvailablePlayersScreen } from '@/screens/games/AvailablePlayersScreen';
import { PlayerCardScreen } from '@/screens/players/PlayerCardScreen';

export type GameStackParamList = {
  GamesList: undefined;
  GameCreate:
    | undefined
    | {
        groupId?: string;
        startsAt?: number;
        format?: import('@/types').GameFormat;
        numberOfTeams?: number;
      };
  /** Read-mostly view of one match. */
  MatchDetails: { gameId: string };
  /** v2 — live-match screen takes the gameId of the game it manages. */
  LiveMatch: { gameId: string };
  /** Phase 9 — find invitable players for a specific game. */
  AvailablePlayers: { gameId: string };
  PlayerCard: { userId: string; groupId?: string };
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
      <Stack.Screen name="MatchDetails" component={MatchDetailsScreen} />
      <Stack.Screen name="LiveMatch" component={LiveMatchScreen} />
      <Stack.Screen
        name="AvailablePlayers"
        component={AvailablePlayersScreen}
      />
      <Stack.Screen name="PlayerCard" component={PlayerCardScreen} />
    </Stack.Navigator>
  );
}
