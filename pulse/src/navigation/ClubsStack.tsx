import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ClubsScreen } from '../screens/ClubsScreen';
import { ClubDetailScreen } from '../screens/ClubDetailScreen';
export type ClubsStackParams={ClubsList:undefined;ClubDetail:{groupId:string}};
const Stack=createNativeStackNavigator<ClubsStackParams>();
export function ClubsStack(){return <Stack.Navigator screenOptions={{headerShown:false}}><Stack.Screen name="ClubsList" component={ClubsScreen}/><Stack.Screen name="ClubDetail" component={ClubDetailScreen}/></Stack.Navigator>}
