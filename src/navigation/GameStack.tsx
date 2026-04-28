// Games tab navigation:
//   GamesList (new — Phase 2 skeleton, sectioned feed)
//     → GameRegistration → GameDetails → TeamSetup → GoalkeeperOrder → LiveMatch
//
// The pre-v2 flow used to land directly on GameRegistration. Now the tab
// opens GamesList; tapping a game pushes the registration screen.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GamesListScreen } from '@/screens/games/GamesListScreen';
import { GameCreateScreen } from '@/screens/games/GameCreateScreen';
import { GameRegistrationScreen } from '@/screens/GameRegistrationScreen';
import { GameDetailsScreen } from '@/screens/GameDetailsScreen';
import { TeamSetupScreen } from '@/screens/TeamSetupScreen';
import { GoalkeeperOrderScreen } from '@/screens/GoalkeeperOrderScreen';
import { LiveMatchScreen } from '@/screens/LiveMatchScreen';
import { AvailablePlayersScreen } from '@/screens/games/AvailablePlayersScreen';
import { TeamColor } from '@/types';

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
  GameRegistration: undefined;
  GameDetails: undefined;
  TeamSetup: undefined;
  GoalkeeperOrder: { teamColor: TeamColor };
  /** v2 — live-match screen takes the gameId of the game it manages. */
  LiveMatch: { gameId: string };
  /** Phase 9 — find invitable players for a specific game. */
  AvailablePlayers: { gameId: string };
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
      <Stack.Screen name="GameRegistration" component={GameRegistrationScreen} />
      <Stack.Screen name="GameDetails" component={GameDetailsScreen} />
      <Stack.Screen name="TeamSetup" component={TeamSetupScreen} />
      <Stack.Screen name="GoalkeeperOrder" component={GoalkeeperOrderScreen} />
      <Stack.Screen name="LiveMatch" component={LiveMatchScreen} />
      <Stack.Screen
        name="AvailablePlayers"
        component={AvailablePlayersScreen}
      />
    </Stack.Navigator>
  );
}
