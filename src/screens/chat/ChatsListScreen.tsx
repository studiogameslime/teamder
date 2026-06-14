// ChatsListScreen — the "צ'אטים" tab home. Lists every chat the user has
// access to: their communities + the games they're registered in. Tapping
// a row opens that chat.
//
// Phase 1: sorted communities-then-games. Recency sorting + unread badges
// arrive in phase 2 once the per-user chat index exists.

import React, { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  useFocusEffect,
  useNavigation,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { gameService } from '@/services/gameService';
import { chatKeyFor } from '@/services/chatService';
import { useChatStore } from '@/store/chatStore';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { Game } from '@/types';
import type { ChatStackParamList } from '@/navigation/ChatStack';

type Nav = NativeStackNavigationProp<ChatStackParamList, 'ChatsList'>;

type Row = {
  kind: 'community' | 'game';
  id: string;
  title: string;
  preview: string;
  unread: number;
  sortAt: number;
};

export function ChatsListScreen() {
  const nav = useNavigation<Nav>();
  const me = useUserStore((s) => s.currentUser);
  const groups = useGroupStore((s) => s.groups);
  const unreadEntries = useChatStore((s) => s.entries);
  const [myGames, setMyGames] = useState<Game[]>([]);

  // Refetch the user's live/upcoming games each time the tab gains focus
  // so a newly-joined game's chat shows up without an app restart.
  useFocusEffect(
    useCallback(() => {
      if (!me) return;
      let alive = true;
      gameService
        .getMyLiveOrUpcomingGames(me.id)
        .then((games) => {
          if (alive) setMyGames(games);
        })
        .catch(() => {
          /* keep last list on transient failure */
        });
      return () => {
        alive = false;
      };
    }, [me?.id]),
  );

  const toRow = (kind: 'community' | 'game', id: string, title: string): Row => {
    const entry = unreadEntries[chatKeyFor(kind, id)];
    return {
      kind,
      id,
      title,
      preview: entry?.lastText ?? '',
      unread: entry?.count ?? 0,
      sortAt: entry?.lastMessageAt ?? 0,
    };
  };
  const rows: Row[] = [
    ...groups.map((g) => toRow('community', g.id, g.name)),
    ...myGames.map((g) => toRow('game', g.id, g.title)),
  ].sort((a, b) => b.sortAt - a.sortAt); // most-recently-active first

  const open = (row: Row) => {
    if (row.kind === 'community') {
      nav.navigate('CommunityChat', { groupId: row.id });
    } else {
      nav.navigate('GameChat', { gameId: row.id });
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.chatsListTitle} />
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="chatbubbles-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>{he.chatsListEmpty}</Text>
          <Text style={styles.emptyHint}>{he.chatsListEmptyHint}</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => `${r.kind}:${r.id}`}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => open(item)}>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: item.kind === 'community' ? '#DBEAFE' : '#DCFCE7' },
                ]}
              >
                <Ionicons
                  name={item.kind === 'community' ? 'globe-outline' : 'football-outline'}
                  size={22}
                  color={item.kind === 'community' ? colors.primary : '#16A34A'}
                />
              </View>
              <View style={styles.rowBody}>
                <Text
                  style={[styles.rowTitle, item.unread > 0 && styles.rowTitleUnread]}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {item.preview ||
                    (item.kind === 'community' ? he.chatCommunitySubtitle : he.chatGameSubtitle)}
                </Text>
              </View>
              {item.unread > 0 ? (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>
                    {item.unread > 99 ? '99+' : item.unread}
                  </Text>
                </View>
              ) : (
                <Ionicons name="chevron-back" size={20} color={colors.textMuted} />
              )}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyTitle: { ...typography.h3, color: colors.text, fontWeight: '800', textAlign: 'center' },
  emptyHint: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  listContent: { padding: spacing.md, gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 14,
  },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.body, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  rowTitleUnread: { fontWeight: '900' },
  rowSub: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
});
