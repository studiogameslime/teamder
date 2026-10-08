// BlockedUsersScreen — everyone the user has blocked in chat, with a tap to
// unblock. Reached from the profile menu ("חסומים"). Blocks live at
// /users/{uid}/blocked/{blockedId}; unblocking deletes that doc, after which
// the person's messages reappear in chats again.

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/Button';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { appAlert } from '@/components/AppDialog';
import { toast } from '@/components/Toast';
import { chatService } from '@/services/chatService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { useUserStore } from '@/store/userStore';
import { useGameStore } from '@/store/gameStore';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export function BlockedUsersScreen() {
  const me = useUserStore((s) => s.currentUser);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  const playersMap = useGameStore((s) => s.players);

  const [ids, setIds] = useState<string[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // The list is live, so the subscription fires on every change — only the
  // first emission is the "screen opened" event.
  const loggedOpenRef = useRef(false);

  useEffect(() => {
    setIds(null);
    loggedOpenRef.current = false;
  }, [me?.id]);

  // Live block list — so unblocking elsewhere (or here) reflects instantly.
  useEffect(() => {
    if (!me) return;
    setLoadFailed(false);
    let received = false;
    const unsub = chatService.subscribeBlocked(me.id, (set) => {
      received = true;
      const list = Array.from(set);
      setIds(list);
      setLoadFailed(false);
      if (!loggedOpenRef.current) {
        loggedOpenRef.current = true;
        logEvent(AnalyticsEvent.ChatBlockedListOpened, { count: list.length });
      }
      if (list.length > 0) hydratePlayers(list);
    }, () => setLoadFailed(true));
    // A silent connection must show a retryable error, never an empty list.
    const t = setTimeout(
      () => { if (!received) setLoadFailed(true); },
      6000,
    );
    return () => {
      unsub();
      clearTimeout(t);
    };
  }, [me?.id, hydratePlayers, retryTick]);

  const onUnblock = (uid: string, name: string) => {
    if (!me) return;
    appAlert(he.blockedUnblockTitle, he.blockedUnblockBody(name), [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.blockedUnblockCta,
        onPress: async () => {
          setBusy((s) => ({ ...s, [uid]: true }));
          try {
            await chatService.unblockUser(me.id, uid);
            logEvent(AnalyticsEvent.UserUnblocked, { targetUserId: uid });
            logEvent(AnalyticsEvent.ChatUserUnblocked, { source: 'blocked_screen' });
            toast.success(he.blockedUnblockDone);
            // The live listener will drop the row.
          } catch (err) {
            logError('unblockUser', err, { screen: 'BlockedUsersScreen', targetUserId: uid });
            logEvent(AnalyticsEvent.ChatActionFailed, { action: 'unblock' });
            toast.error(String((err as Error)?.message ?? err));
          } finally {
            setBusy((s) => ({ ...s, [uid]: false }));
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.blockedTitle} />
      {loadFailed && <Pressable accessibilityRole="button" onPress={() => setRetryTick((n) => n + 1)}><Text style={styles.intro}>לא ניתן לטעון את החסימות. {he.retry}</Text></Pressable>}
      {ids === null ? (
        <View style={styles.center}>
          {!loadFailed && <SoccerBallLoader size={40} />}
        </View>
      ) : ids.length === 0 ? (
        <EmptyState
          icon="happy-outline"
          title={he.blockedEmptyTitle}
          hint={he.blockedEmptyHint}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.intro}>{he.blockedIntro}</Text>
          <Card style={styles.listCard}>
            {ids.map((uid, i) => {
              const p = playersMap[uid];
              // Neutral placeholder while resolving (never feed '...' into the
              // avatar/name or the unblock confirm dialog).
              const name = p?.displayName ?? he.genericUserName;
              return (
                <View key={uid} style={[styles.row, i > 0 && styles.rowDivider]}>
                  <UserAvatar
                    user={{ id: uid, name, avatarId: p?.avatarId, photoUrl: p?.photoUrl }}
                    size={40}
                  />
                  <Text style={styles.name} numberOfLines={1}>
                    {name}
                  </Text>
                  <Button
                    title={he.blockedUnblockCta}
                    variant="outline"
                    size="sm"
                    loading={!!busy[uid]}
                    onPress={() => onUnblock(uid, name)}
                  />
                </View>
              );
            })}
          </Card>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  intro: { ...typography.body, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  listCard: { padding: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  name: { ...typography.body, color: colors.text, fontWeight: '700', flex: 1, textAlign: RTL_LABEL_ALIGN },
});
