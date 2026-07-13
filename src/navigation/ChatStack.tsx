// ChatStack — the "צ'אטים" tab. A list of my chats, plus the two chat
// screens (game + community). The same chat screens are ALSO reachable
// from inside the game / community details screens, which navigate here
// via the parent tab navigator.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ChatsListScreen } from '@/screens/chat/ChatsListScreen';
import { GameChatScreen } from '@/screens/chat/GameChatScreen';
import { CommunityChatScreen } from '@/screens/chat/CommunityChatScreen';
import { DirectChatScreen } from '@/screens/chat/DirectChatScreen';
import { PlayerCardScreen } from '@/screens/players/PlayerCardScreen';
import { PlayerCompareScreen } from '@/screens/players/PlayerCompareScreen';

export type ChatStackParamList = {
  ChatsList: undefined;
  GameChat: { gameId: string };
  CommunityChat: { groupId: string };
  DirectChat: { convId: string };
  PlayerCard: { userId: string; groupId?: string };
  PlayerCompare: { groupId: string; otherUid: string; otherName?: string };
};

const Stack = createNativeStackNavigator<ChatStackParamList>();

export function ChatStack() {
  return (
    <Stack.Navigator
      initialRouteName="ChatsList"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="ChatsList" component={ChatsListScreen} />
      <Stack.Screen name="GameChat" component={GameChatScreen} />
      <Stack.Screen name="CommunityChat" component={CommunityChatScreen} />
      <Stack.Screen name="DirectChat" component={DirectChatScreen} />
      <Stack.Screen name="PlayerCard" component={PlayerCardScreen} />
      <Stack.Screen name="PlayerCompare" component={PlayerCompareScreen} />
    </Stack.Navigator>
  );
}
