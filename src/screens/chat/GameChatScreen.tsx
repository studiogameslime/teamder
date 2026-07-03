// GameChatScreen — resolves the game (title + moderator) and renders the
// shared ChatView in game scope. Reached from the chats list AND from the
// match-details screen.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View, StyleSheet } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';

import { ChatView } from '@/components/chat/ChatView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { gameService } from '@/services/gameService';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
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
    // Keep a header (with back button) while the game resolves, so the user
    // is never stranded on a bare spinner with no way back.
    return (
      <View style={styles.flex}>
        <ScreenHeader title={he.chatLoadingTitle} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  // Moderator = the organiser OR an admin of the game's community.
  const grp = game ? groups.find((g) => g.id === game.groupId) : undefined;
  const canModerate =
    !!me &&
    !!game &&
    (me.id === game.createdBy || (grp?.adminIds.includes(me.id) ?? false));

  // Chat members = the registered roster. Organiser + community admins
  // are flagged as admins in the members sheet.
  const memberIds = game?.players ?? [];
  const adminIds = [
    ...(game?.createdBy ? [game.createdBy] : []),
    ...(grp?.adminIds ?? []),
  ];

  // Game couldn't be resolved (deleted, or no read access) — show a friendly
  // fallback with a way back instead of an empty-titled chat that can't load.
  if (!game) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title={he.chatOpenGame} />
        <View style={styles.center}>
          <Text style={styles.emptyText}>{he.chatGameUnavailable}</Text>
        </View>
      </View>
    );
  }

  return (
    <ChatView
      scope="game"
      parentId={gameId}
      title={game?.title ?? ''}
      canModerate={canModerate}
      memberIds={memberIds}
      adminIds={adminIds}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.xl },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});
