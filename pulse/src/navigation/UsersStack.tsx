import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { UsersScreen } from '../screens/UsersScreen';
import { UserDetailScreen } from '../screens/UserDetailScreen';

export type UsersStackParams = {
  UsersList: undefined;
  UserDetail: { userId: string };
};

const Stack = createNativeStackNavigator<UsersStackParams>();

export function UsersStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="UsersList" component={UsersScreen} />
      <Stack.Screen name="UserDetail" component={UserDetailScreen} />
    </Stack.Navigator>
  );
}
