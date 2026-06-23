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
import { RequestsScreen } from '@/screens/RequestsScreen';
import { ProfileEditScreen } from '@/screens/tabs/ProfileEditScreen';
import { AvailabilityEditScreen } from '@/screens/profile/AvailabilityEditScreen';
import { NotificationsSettingsScreen } from '@/screens/profile/NotificationsSettingsScreen';
import { BlockedUsersScreen } from '@/screens/profile/BlockedUsersScreen';
import { AchievementsScreen } from '@/screens/profile/AchievementsScreen';
import { StatisticsScreen } from '@/screens/profile/StatisticsScreen';
import { FriendsScreen } from '@/screens/profile/FriendsScreen';
import { PlayerCardScreen } from '@/screens/players/PlayerCardScreen';
import { AdminApprovalScreen } from '@/screens/groups/AdminApprovalScreen';
import { HistoryScreen } from '@/screens/tabs/HistoryScreen';
import { MatchDetailsScreen } from '@/screens/games/MatchDetailsScreen';
import { MatchPlayersScreen } from '@/screens/games/MatchPlayersScreen';
import { AvailablePlayersScreen } from '@/screens/games/AvailablePlayersScreen';
import { GameEditScreen } from '@/screens/games/GameEditScreen';
import { LiveMatchScreen } from '@/screens/LiveMatchScreen';
import { CommunityDetailsScreen } from '@/screens/communities/CommunityDetailsScreen';
import { CommunityStatsScreen } from '@/screens/communities/CommunityStatsScreen';
import { CommunityHistoryScreen } from '@/screens/communities/CommunityHistoryScreen';
import { ReferralsListScreen } from '@/screens/profile/ReferralsListScreen';
import { FeedbackScreen } from '@/screens/FeedbackScreen';

export type ProfileStackParamList = {
  Profile: undefined;
  Requests: undefined;
  ProfileEdit: undefined;
  AvailabilityEdit: undefined;
  NotificationsSettings: undefined;
  BlockedUsers: undefined;
  PlayerCard: { userId: string; groupId?: string };
  AdminApproval: undefined;
  History: undefined;
  Achievements: undefined;
  Statistics: undefined;
  Friends: undefined;
  Referrals: undefined;
  Feedback: { type?: 'bug' | 'suggestion' } | undefined;
  // Match-detail chain — same routes as GameStack/CommunitiesStack,
  // duplicated so back returns to the screen the user came from
  // (typically History).
  MatchDetails: { gameId: string };
  MatchPlayers: { gameId: string };
  AvailablePlayers: { gameId: string };
  GameEdit: { gameId: string };
  LiveMatch: { gameId: string };
  // Reachable from MatchDetails' community-link icon.
  CommunityDetails: { groupId: string };
  CommunityStats: { groupId: string };
  CommunityHistory: { groupId: string };
};

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function ProfileStack() {
  return (
    <Stack.Navigator
      initialRouteName="Profile"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="Requests" component={RequestsScreen} />
      <Stack.Screen name="ProfileEdit" component={ProfileEditScreen} />
      <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} />
      <Stack.Screen
        name="AvailabilityEdit"
        component={AvailabilityEditScreen}
      />
      <Stack.Screen
        name="NotificationsSettings"
        component={NotificationsSettingsScreen}
      />
      <Stack.Screen name="PlayerCard" component={PlayerCardScreen} />
      <Stack.Screen name="AdminApproval" component={AdminApprovalScreen} />
      <Stack.Screen name="History" component={HistoryScreen} />
      <Stack.Screen name="Achievements" component={AchievementsScreen} />
      <Stack.Screen name="Statistics" component={StatisticsScreen} />
      <Stack.Screen name="Friends" component={FriendsScreen} />
      <Stack.Screen name="Referrals" component={ReferralsListScreen} />
      <Stack.Screen name="Feedback" component={FeedbackScreen} />
      <Stack.Screen name="MatchDetails" component={MatchDetailsScreen} />
      <Stack.Screen name="MatchPlayers" component={MatchPlayersScreen} />
      <Stack.Screen name="AvailablePlayers" component={AvailablePlayersScreen} />
      <Stack.Screen name="GameEdit" component={GameEditScreen} />
      <Stack.Screen name="LiveMatch" component={LiveMatchScreen} />
      <Stack.Screen name="CommunityDetails" component={CommunityDetailsScreen} />
      <Stack.Screen name="CommunityStats" component={CommunityStatsScreen} />
      <Stack.Screen name="CommunityHistory" component={CommunityHistoryScreen} />
    </Stack.Navigator>
  );
}
