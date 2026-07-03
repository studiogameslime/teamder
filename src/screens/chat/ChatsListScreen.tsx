// ChatsListScreen — the "צ'אטים" tab home. Lists every chat the user has
// access to: their communities + the games they're registered in. Tapping
// a row opens that chat.
//
// Phase 1: sorted communities-then-games. Recency sorting + unread badges
// arrive in phase 2 once the per-user chat index exists.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  useFocusEffect,
  useNavigation,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { UserAvatar } from '@/components/UserAvatar';
import { gameService } from '@/services/gameService';
import { userService } from '@/services/userService';
import { chatKeyFor } from '@/services/chatService';
import { useChatStore } from '@/store/chatStore';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { getCoverSource } from '@/data/coverImages';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { Game, User } from '@/types';
import type { ChatStackParamList } from '@/navigation/ChatStack';

type Nav = NativeStackNavigationProp<ChatStackParamList, 'ChatsList'>;

/** Last-activity time for a chat row: today → HH:MM, yesterday → אתמול,
 *  otherwise DD.MM. */
function relativeChatTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();
  if (sameDay(d, now)) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'אתמול';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

type Row = {
  kind: 'community' | 'game' | 'dm';
  id: string;
  title: string;
  preview: string;
  unread: number;
  sortAt: number;
  /** Community cover (uploaded URL or built-in preset) shown in the
   *  avatar circle. Undefined for games (they have no cover). */
  image?: ImageSourcePropType;
  /** DM rows only: the other participant, used to render their avatar. */
  dmUser?: { id: string; name: string; avatarId?: string; photoUrl?: string };
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

  // Live profiles for the people I have DMs with — keyed by user id. We
  // resolve them fresh (rather than trust the denormalised entry) so the row
  // always shows the person's CURRENT photo/avatar, including DMs created
  // before avatars were denormalised onto the entry.
  const [dmProfiles, setDmProfiles] = useState<Record<string, User>>({});
  const dmOtherIds = useMemo(
    () =>
      me
        ? Array.from(
            new Set(
              Object.values(unreadEntries)
                .filter((e) => e.scope === 'dm' && !!e.parentId)
                .map((e) => e.parentId.split('__').find((u) => u !== me.id) ?? '')
                .filter(Boolean),
            ),
          )
        : [],
    [unreadEntries, me?.id],
  );
  useEffect(() => {
    let alive = true;
    const missing = dmOtherIds.filter((id) => !dmProfiles[id]);
    if (missing.length === 0) return;
    Promise.all(
      missing.map((id) =>
        userService
          .getUserById(id)
          .then((u) => [id, u] as const)
          .catch(() => [id, null] as const),
      ),
    ).then((pairs) => {
      if (!alive) return;
      const next: Record<string, User> = {};
      for (const [id, u] of pairs) if (u) next[id] = u;
      if (Object.keys(next).length) setDmProfiles((prev) => ({ ...prev, ...next }));
    });
    return () => {
      alive = false;
    };
  }, [dmOtherIds, dmProfiles]);

  const toRow = (
    kind: 'community' | 'game',
    id: string,
    title: string,
    image?: ImageSourcePropType,
  ): Row => {
    const entry = unreadEntries[chatKeyFor(kind, id)];
    return {
      kind,
      id,
      title,
      preview: entry?.lastText ?? '',
      unread: entry?.count ?? 0,
      sortAt: entry?.lastMessageAt ?? 0,
      image,
    };
  };
  // Resolve each community's cover for its chat avatar — uploaded photo
  // wins, else the built-in gallery preset chosen at creation.
  const coverFor = (
    coverPhotoUrl?: string,
    coverImageId?: string,
  ): ImageSourcePropType | undefined =>
    coverPhotoUrl
      ? { uri: coverPhotoUrl }
      : getCoverSource(coverImageId) ?? undefined;
  // DM rows have no membership list — they live only in the unread index.
  const dmRows: Row[] = Object.values(unreadEntries)
    .filter((e) => e.scope === 'dm' && !!e.parentId)
    .map((e) => {
      // The other participant's id = the half of the convId that isn't me.
      const otherId = me
        ? e.parentId.split('__').find((u) => u !== me.id) ?? ''
        : '';
      // Prefer the freshly-resolved profile; fall back to the denormalised
      // entry fields until it loads (or if the fetch failed).
      const profile = dmProfiles[otherId];
      return {
        kind: 'dm' as const,
        id: e.parentId,
        title: profile?.name || e.title || '',
        preview: e.lastText ?? '',
        unread: e.count ?? 0,
        sortAt: e.lastMessageAt ?? 0,
        dmUser: {
          id: otherId,
          name: profile?.name || e.title || '',
          avatarId: profile?.avatarId ?? e.avatarId,
          photoUrl: profile?.photoUrl ?? e.photoUrl,
        },
      };
    });
  const rows: Row[] = [
    ...groups.map((g) =>
      toRow('community', g.id, g.name, coverFor(g.coverPhotoUrl, g.coverImageId)),
    ),
    ...myGames.map((g) => toRow('game', g.id, g.title)),
    ...dmRows,
  ].sort((a, b) => {
    // Group order (communities → games → DMs) so a freshly-joined community
    // with no messages isn't buried under stale/old DMs; recency sorts WITHIN
    // each group, unread rises to the top of its group.
    const rank = (k: Row['kind']) => (k === 'community' ? 0 : k === 'game' ? 1 : 2);
    if (rank(a.kind) !== rank(b.kind)) return rank(a.kind) - rank(b.kind);
    if ((b.unread > 0 ? 1 : 0) !== (a.unread > 0 ? 1 : 0)) {
      return (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0);
    }
    return b.sortAt - a.sortAt;
  });

  const open = (row: Row) => {
    if (row.kind === 'community') {
      nav.navigate('CommunityChat', { groupId: row.id });
    } else if (row.kind === 'dm') {
      nav.navigate('DirectChat', { convId: row.id });
    } else {
      nav.navigate('GameChat', { gameId: row.id });
    }
  };

  // NOTE: the "friends-only DMs" privacy toggle is intentionally hidden for
  // now — at this stage anyone can always message anyone. The data model
  // (User.dmFriendsOnly + rules + userService.setDmFriendsOnly) stays in
  // place, so re-surfacing the toggle later is a UI-only change.

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.chatsListTitle} />
      {rows.length === 0 ? (
        <EmptyState
          icon="chatbubbles-outline"
          title={he.chatsListEmpty}
          hint={he.chatsListEmptyHint}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => `${r.kind}:${r.id}`}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => open(item)}>
              {item.kind === 'dm' ? (
                <UserAvatar user={item.dmUser} size={46} style={styles.iconCircle} />
              ) : item.image ? (
                <Image source={item.image} style={styles.iconCircle} />
              ) : (
                <View
                  style={[
                    styles.iconCircle,
                    styles.iconCircleFallback,
                    {
                      backgroundColor:
                        item.kind === 'community' ? '#DBEAFE' : '#DCFCE7',
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      item.kind === 'community'
                        ? 'globe-outline'
                        : 'football-outline'
                    }
                    size={22}
                    color={item.kind === 'community' ? colors.primary : '#16A34A'}
                  />
                </View>
              )}
              <View style={styles.rowBody}>
                <View style={styles.rowTitleLine}>
                  <Text
                    style={[styles.rowTitle, item.unread > 0 && styles.rowTitleUnread]}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  {item.sortAt > 0 ? (
                    <Text style={styles.rowTime}>{relativeChatTime(item.sortAt)}</Text>
                  ) : null}
                </View>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {item.preview ||
                    (item.kind === 'community'
                      ? he.chatCommunitySubtitle
                      : item.kind === 'dm'
                        ? he.dmSubtitle
                        : he.chatGameSubtitle)}
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
  listContent: { padding: spacing.md, gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 14,
    // Thin pitch-green accent on the card's leading edge.
    borderStartWidth: 3,
    borderStartColor: '#1B8A43',
  },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.surfaceMuted,
  },
  iconCircleFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTime: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  rowTitle: { ...typography.body, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN, flex: 1 },
  rowTitleUnread: { fontWeight: '900' },
  rowSub: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: '#1B8A43',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
});
