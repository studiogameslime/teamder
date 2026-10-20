import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GamesScreen } from '../screens/GamesScreen';
import { GameDetailScreen } from '../screens/GameDetailScreen';
export type GamesStackParams={GamesList:undefined;GameDetail:{gameId:string}};
const Stack=createNativeStackNavigator<GamesStackParams>();
export function GamesStack(){return <Stack.Navigator screenOptions={{headerShown:false}}><Stack.Screen name="GamesList" component={GamesScreen}/><Stack.Screen name="GameDetail" component={GameDetailScreen}/></Stack.Navigator>}
