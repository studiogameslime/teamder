// Stack inside the Profile tab. The Profile screen is the landing; Stats,
// History, Edit, Availability, Admin Approval, and PlayerCard are all
// pushable from there.
//
// The match-detail chain (MatchDetails + LiveMatch + MatchPlayers +
// MatchManage + AvailablePlayers + GameEdit) is also registered here
// so that drilling from History → MatchDetails keeps navigation INSIDE
// ProfileStack — back returns to History rather than dumping the user
// on GamesList. Same trick we use in CommunitiesStack. CommunityDetails
// is registered for the same reason: MatchDetails-from-Profile has a
// community-link icon, and the user expects back to return to the
// match, not to the Communities tab.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ProfileScreen } from '@/screens/tabs/ProfileScreen';
import { ProfileEditScreen } from '@/screens/tabs/ProfileEditScreen';
import { AvailabilityEditScreen } from '@/screens/profile/AvailabilityEditScreen';
import { JerseyPickerScreen } from '@/screens/profile/JerseyPickerScreen';
import { NotificationsSettingsScreen } from '@/screens/profile/NotificationsSettingsScreen';
import { AchievementsScreen } from '@/screens/profile/AchievementsScreen';
import { PlayerCardScreen } from '@/screens/players/PlayerCardScreen';
import { AdminApprovalScreen } from '@/screens/groups/AdminApprovalScreen';
import { StatsScreen } from '@/screens/tabs/StatsScreen';
import { HistoryScreen } from '@/screens/tabs/HistoryScreen';
import { MatchDetailsScreen } from '@/screens/games/MatchDetailsScreen';
import { MatchPlayersScreen } from '@/screens/games/MatchPlayersScreen';
import { MatchManageScreen } from '@/screens/games/MatchManageScreen';
import { AvailablePlayersScreen } from '@/screens/games/AvailablePlayersScreen';
import { GameEditScreen } from '@/screens/games/GameEditScreen';
import { LiveMatchScreen } from '@/screens/LiveMatchScreen';
import { CommunityDetailsScreen } from '@/screens/communities/CommunityDetailsScreen';

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
  Achievements: undefined;
  // Match-detail chain — same routes as GameStack/CommunitiesStack,
  // duplicated so back returns to the screen the user came from
  // (typically History).
  MatchDetails: { gameId: string };
  MatchPlayers: { gameId: string };
  MatchManage: { gameId: string };
  AvailablePlayers: { gameId: string };
  GameEdit: { gameId: string };
  LiveMatch: { gameId: string };
  // Reachable from MatchDetails' community-link icon.
  CommunityDetails: { groupId: string };
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
      <Stack.Screen name="Achievements" component={AchievementsScreen} />
      <Stack.Screen name="MatchDetails" component={MatchDetailsScreen} />
      <Stack.Screen name="MatchPlayers" component={MatchPlayersScreen} />
      <Stack.Screen name="MatchManage" component={MatchManageScreen} />
      <Stack.Screen name="AvailablePlayers" component={AvailablePlayersScreen} />
      <Stack.Screen name="GameEdit" component={GameEditScreen} />
      <Stack.Screen name="LiveMatch" component={LiveMatchScreen} />
      <Stack.Screen name="CommunityDetails" component={CommunityDetailsScreen} />
    </Stack.Navigator>
  );
}
