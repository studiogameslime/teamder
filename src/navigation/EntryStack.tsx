// EntryStack — the intent question, and nothing else.
//
// It held Welcome → Intent until the launch screen absorbed the welcome: the
// artwork, the wordmark and the slogan now live on the splash, which holds
// for a new person and hands over when they tap "מתחילים". A second
// full-screen pitch carrying the same sentence was one screen too many.
//
// Still its own stack rather than a screen bolted onto AuthStack, because it
// is not authentication: nobody here is being asked to identify themselves,
// and the back button must not be able to reach a sign-in form.
//
// Mounted INSTEAD of MainTabs by the gate in RootNavigator, so the tabs do not
// exist while it is up. That is deliberate — a tab bar under a first-run pitch
// invites a tap that skips the question — and it is also why the intent
// destination is handed back through `entryStore` rather than navigated to
// from IntentScreen.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { IntentScreen } from '@/screens/entry/IntentScreen';

export type EntryStackParamList = {
  EntryIntent: undefined;
};

const Stack = createNativeStackNavigator<EntryStackParamList>();

export function EntryStack() {
  return (
    <Stack.Navigator
      initialRouteName="EntryIntent"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="EntryIntent" component={IntentScreen} />
    </Stack.Navigator>
  );
}
