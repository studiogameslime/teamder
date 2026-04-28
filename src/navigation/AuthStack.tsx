import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SignInScreen } from '@/screens/auth/SignInScreen';
import { ProfileSetupScreen } from '@/screens/auth/ProfileSetupScreen';

export type AuthStackParamList = {
  SignIn: undefined;
  ProfileSetup: undefined;
};

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
      <Stack.Screen name="SignIn" component={SignInScreen} />
      <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
    </Stack.Navigator>
  );
}
