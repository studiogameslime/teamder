// CommunityChatScreen — resolves the community (name + moderator) from
// the member store and renders the shared ChatView in community scope.
// Reached from the chats list AND from the community-details screen.

import React from 'react';
import { useRoute, type RouteProp } from '@react-navigation/native';

import { ChatView } from '@/components/chat/ChatView';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import type { ChatStackParamList } from '@/navigation/ChatStack';

export function CommunityChatScreen() {
  const route = useRoute<RouteProp<ChatStackParamList, 'CommunityChat'>>();
  const { groupId } = route.params;
  const me = useUserStore((s) => s.currentUser);
  const groups = useGroupStore((s) => s.groups);

  const grp = groups.find((g) => g.id === groupId);
  // Moderator = a community admin (creator is always an admin). If the
  // group isn't in the member store the ChatView listener will be denied
  // and show a "no access" state.
  const canModerate = !!me && (grp?.adminIds.includes(me.id) ?? false);

  return (
    <ChatView
      scope="community"
      parentId={groupId}
      title={grp?.name ?? ''}
      canModerate={canModerate}
    />
  );
}
