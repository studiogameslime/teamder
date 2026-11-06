import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

export type AuthStackParamList = {
  SignIn: undefined;
  ProfileSetup: undefined;
  EmailAuth: undefined;
};

// Screen modules are evaluated only when their route renders. Keep all route
// registrations local so shared destinations preserve their back stack.
const Stack = createNativeStackNavigator<AuthStackParamList>();

interface Props {
  initialRoute: keyof AuthStackParamList;
}

export function AuthStack({ initialRoute }: Props) {
  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="SignIn" getComponent={() => require('@/screens/auth/SignInScreen').SignInScreen as typeof import('@/screens/auth/SignInScreen').SignInScreen} />
      <Stack.Screen name="ProfileSetup" getComponent={() => require('@/screens/auth/ProfileSetupScreen').ProfileSetupScreen as typeof import('@/screens/auth/ProfileSetupScreen').ProfileSetupScreen} />
      <Stack.Screen name="EmailAuth" getComponent={() => require('@/screens/auth/EmailAuthScreen').EmailAuthScreen as typeof import('@/screens/auth/EmailAuthScreen').EmailAuthScreen} />
    </Stack.Navigator>
  );
}
