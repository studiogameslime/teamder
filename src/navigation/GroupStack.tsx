import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GroupChooseScreen } from '@/screens/groups/GroupChooseScreen';
import { CreateGroupScreen } from '@/screens/groups/CreateGroupScreen';
import { JoinGroupScreen } from '@/screens/groups/JoinGroupScreen';
import { GroupSearchScreen } from '@/screens/groups/GroupSearchScreen';

export type GroupStackParamList = {
  GroupChoose: undefined;
  GroupCreate: undefined;
  GroupJoin: undefined;
  GroupSearch: undefined;
};

const Stack = createNativeStackNavigator<GroupStackParamList>();

export function GroupStack() {
  return (
    <Stack.Navigator
      initialRouteName="GroupChoose"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="GroupChoose" component={GroupChooseScreen} />
      <Stack.Screen name="GroupCreate" component={CreateGroupScreen} />
      <Stack.Screen name="GroupJoin" component={JoinGroupScreen} />
      <Stack.Screen name="GroupSearch" component={GroupSearchScreen} />
    </Stack.Navigator>
  );
}
