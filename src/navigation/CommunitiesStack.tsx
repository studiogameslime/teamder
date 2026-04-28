// Stack inside the Communities tab. The feed is the landing screen; from
// there the user can:
//   • create a community (CommunitiesCreate)
//   • open a community they're a member of (CommunityDetails — full view,
//     reads /groups/{id})
//   • preview a community they're not yet in (CommunityDetailsPublic —
//     public view, reads /groupsPublic/{id})

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PublicGroupsFeedScreen } from '@/screens/communities/PublicGroupsFeedScreen';
import { CreateGroupScreen } from '@/screens/groups/CreateGroupScreen';
import { CommunityDetailsScreen } from '@/screens/communities/CommunityDetailsScreen';
import { CommunityDetailsPublicScreen } from '@/screens/communities/CommunityDetailsPublicScreen';
import { CommunityEditScreen } from '@/screens/communities/CommunityEditScreen';
import { PlayerCardScreen } from '@/screens/players/PlayerCardScreen';

export type CommunitiesStackParamList = {
  CommunitiesFeed: undefined;
  CommunitiesCreate: undefined;
  CommunityDetails: { groupId: string };
  CommunityDetailsPublic: { groupId: string };
  CommunityEdit: { groupId: string };
  PlayerCard: { userId: string; groupId?: string };
};

const Stack = createNativeStackNavigator<CommunitiesStackParamList>();

export function CommunitiesStack() {
  return (
    <Stack.Navigator
      initialRouteName="CommunitiesFeed"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="CommunitiesFeed" component={PublicGroupsFeedScreen} />
      <Stack.Screen name="CommunitiesCreate" component={CreateGroupScreen} />
      <Stack.Screen name="CommunityDetails" component={CommunityDetailsScreen} />
      <Stack.Screen
        name="CommunityDetailsPublic"
        component={CommunityDetailsPublicScreen}
      />
      <Stack.Screen name="CommunityEdit" component={CommunityEditScreen} />
      <Stack.Screen name="PlayerCard" component={PlayerCardScreen} />
    </Stack.Navigator>
  );
}
