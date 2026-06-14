// GameChatScreen — resolves the game (title + moderator) and renders the
// shared ChatView in game scope. Reached from the chats list AND from the
// match-details screen.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';

import { ChatView } from '@/components/chat/ChatView';
import { gameService } from '@/services/gameService';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { colors } from '@/theme';
import type { Game } from '@/types';
import type { ChatStackParamList } from '@/navigation/ChatStack';

export function GameChatScreen() {
  const route = useRoute<RouteProp<ChatStackParamList, 'GameChat'>>();
  const { gameId } = route.params;
  const me = useUserStore((s) => s.currentUser);
  const groups = useGroupStore((s) => s.groups);
  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    gameService
      .getGameById(gameId)
      .then((g) => {
        if (alive) {
          setGame(g);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [gameId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // Moderator = the organiser OR an admin of the game's community.
  const grp = game ? groups.find((g) => g.id === game.groupId) : undefined;
  const canModerate =
    !!me &&
    !!game &&
    (me.id === game.createdBy || (grp?.adminIds.includes(me.id) ?? false));

  return (
    <ChatView
      scope="game"
      parentId={gameId}
      title={game?.title ?? ''}
      canModerate={canModerate}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
