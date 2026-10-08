// Dev-Inbox stack: the unified "תיבת פיתוח" list (errors / features / reports)
// → an individual error detail. (Type still named ErrorsStackParams since
// ErrorDetailScreen + ErrorsBody import it from here.)
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DevInboxScreen } from '../screens/DevInboxScreen';
import { ErrorDetailScreen } from '../screens/ErrorDetailScreen';
import { QaUserDetailScreen } from '../screens/QaUserDetailScreen';

export type ErrorsStackParams = {
  DevInbox: undefined;
  ErrorDetail: { id: string };
  QaUser: { userId: string; userName: string };
};

const Stack = createNativeStackNavigator<ErrorsStackParams>();

export function DevInboxStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DevInbox" component={DevInboxScreen} />
      <Stack.Screen name="ErrorDetail" component={ErrorDetailScreen} />
      <Stack.Screen name="QaUser" component={QaUserDetailScreen} />
    </Stack.Navigator>
  );
}
