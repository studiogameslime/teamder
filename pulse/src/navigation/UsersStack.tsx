import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { UsersScreen } from '../screens/UsersScreen';
import { UserDetailScreen } from '../screens/UserDetailScreen';
import { NewPeopleScreen } from '../screens/NewPeopleScreen';
import { PersonJourneyScreen } from '../screens/PersonJourneyScreen';

export type UsersStackParams = {
  NewPeople: undefined;
  PersonJourney: { userId: string };
  UsersList: undefined;
  UserDetail: { userId: string };
};

const Stack = createNativeStackNavigator<UsersStackParams>();

export function UsersStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="NewPeople" component={NewPeopleScreen} />
      <Stack.Screen name="PersonJourney" component={PersonJourneyScreen} />
      <Stack.Screen name="UsersList" component={UsersScreen} />
      <Stack.Screen name="UserDetail" component={UserDetailScreen} />
    </Stack.Navigator>
  );
}
