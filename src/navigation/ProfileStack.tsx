// Stack inside the Profile tab. The Profile screen is the landing; Stats,
// History, Edit, Availability, Admin Approval, and PlayerCard are all
// pushable from there.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ProfileScreen } from '@/screens/tabs/ProfileScreen';
import { ProfileEditScreen } from '@/screens/tabs/ProfileEditScreen';
import { AvailabilityEditScreen } from '@/screens/profile/AvailabilityEditScreen';
import { JerseyPickerScreen } from '@/screens/profile/JerseyPickerScreen';
import { NotificationsSettingsScreen } from '@/screens/profile/NotificationsSettingsScreen';
import { PlayerCardScreen } from '@/screens/players/PlayerCardScreen';
import { AdminApprovalScreen } from '@/screens/groups/AdminApprovalScreen';
import { StatsScreen } from '@/screens/tabs/StatsScreen';
import { HistoryScreen } from '@/screens/tabs/HistoryScreen';

export type ProfileStackParamList = {
  Profile: undefined;
  ProfileEdit: undefined;
  AvailabilityEdit: undefined;
  JerseyPicker: undefined;
  NotificationsSettings: undefined;
  PlayerCard: { userId: string; groupId?: string };
  AdminApproval: undefined;
  Stats: undefined;
  History: undefined;
};

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function ProfileStack() {
  return (
    <Stack.Navigator
      initialRouteName="Profile"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="ProfileEdit" component={ProfileEditScreen} />
      <Stack.Screen
        name="AvailabilityEdit"
        component={AvailabilityEditScreen}
      />
      <Stack.Screen name="JerseyPicker" component={JerseyPickerScreen} />
      <Stack.Screen
        name="NotificationsSettings"
        component={NotificationsSettingsScreen}
      />
      <Stack.Screen name="PlayerCard" component={PlayerCardScreen} />
      <Stack.Screen name="AdminApproval" component={AdminApprovalScreen} />
      <Stack.Screen name="Stats" component={StatsScreen} />
      <Stack.Screen name="History" component={HistoryScreen} />
    </Stack.Navigator>
  );
}
