// RequestsScreen — the unified "Requests" inbox reached from the header bell.
// Three sections, each with "approve all": friend requests, community-join
// requests (communities I admin), game-join requests (games I created).

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { Avatar } from '@/components/Avatar';
import { appAlert } from '@/components/AppDialog';
import { toast } from '@/components/Toast';
import { successHaptic } from '@/utils/haptics';
import { useUserStore } from '@/store/userStore';
import { friendsService } from '@/services/friendsService';
import { groupService } from '@/services/groupService';
import { gameService } from '@/services/gameService';
import {
  getInboxRequests,
  approveAllFriends,
  approveAllForGroup,
  approveAllForGame,
  type InboxRequests,
  type BulkResult,
} from '@/services/requestsService';
import { logError } from '@/services/errorLog';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { User } from '@/types';

const EMPTY: InboxRequests = { friends: [], communities: [], games: [], total: 0 };

export function RequestsScreen() {
  const nav = useNavigation<any>();
  const me = useUserStore((s) => s.currentUser);
  const [data, setData] = useState<InboxRequests>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // per-item or per-section key

  const load = useCallback(async () => {
    if (!me) return;
    try {
      setData(await getInboxRequests(me.id));
    } catch (err) {
      logError('RequestsScreen.load', err, { uid: me.id });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [me]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── single-item actions ────────────────────────────────────────────
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      successHaptic();
      await load();
    } catch (err) {
      logError('RequestsScreen.act', err, { key });
      appAlert(he.error, he.requestsActionFailed);
    } finally {
      setBusy(null);
    }
  };

  // ── approve-all ────────────────────────────────────────────────────
  const approveAll = (key: string, count: number, run: () => Promise<BulkResult>) => {
    appAlert(he.requestsApproveAllConfirmTitle, he.requestsApproveAllConfirmBody(count), [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.requestsApproveAll,
        onPress: async () => {
          setBusy(key);
          try {
            const r = await run();
            successHaptic();
            toast.success(
              r.failed > 0 ? he.requestsPartial(r.ok, r.failed) : he.requestsApprovedToast(r.ok),
            );
            await load();
          } catch (err) {
            logError('RequestsScreen.approveAll', err, { key });
            appAlert(he.error, he.requestsActionFailed);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  if (!me) return null;

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={he.requestsTitle} />
        <View style={styles.center}><SoccerBallLoader /></View>
      </SafeAreaView>
    );
  }

  const empty = data.total === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={he.requestsTitle} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.primary}
          />
        }
      >
        {empty ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="checkmark-done-circle-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>{he.requestsEmpty}</Text>
            <Text style={styles.emptyHint}>{he.requestsEmptyHint}</Text>
          </View>
        ) : null}

        {/* ── Friend requests ── */}
        {data.friends.length > 0 ? (
          <Section
            title={he.requestsFriends}
            count={data.friends.length}
            busy={busy === 'friends'}
            onApproveAll={() =>
              approveAll('friends', data.friends.length, () => approveAllFriends(me.id, data.friends))
            }
          >
            {data.friends.map(({ request, user }) => (
              <Row
                key={request.id}
                user={user}
                busy={busy === `f:${request.fromUserId}`}
                onOpenProfile={user ? () => nav.navigate('PlayerCard', { userId: user.id }) : undefined}
                onApprove={() =>
                  act(`f:${request.fromUserId}`, () => friendsService.acceptRequest(request.fromUserId, me.id))
                }
                onDecline={() =>
                  act(`f:${request.fromUserId}`, () => friendsService.declineRequest(request.fromUserId, me.id))
                }
              />
            ))}
          </Section>
        ) : null}

        {/* ── Community join requests ── */}
        {data.communities.map(({ group, pending }) => (
          <Section
            key={`g:${group.id}`}
            title={he.requestsCommunitySection(group.name)}
            count={pending.length}
            busy={busy === `gAll:${group.id}`}
            onApproveAll={() =>
              approveAll(`gAll:${group.id}`, pending.length, () =>
                approveAllForGroup(group.id, pending.map((u) => u.id)),
              )
            }
          >
            {pending.map((u) => (
              <Row
                key={`${group.id}:${u.id}`}
                user={u}
                busy={busy === `g:${group.id}:${u.id}`}
                onOpenProfile={() => nav.navigate('PlayerCard', { userId: u.id })}
                onApprove={() => act(`g:${group.id}:${u.id}`, () => groupService.approveMember(group.id, u.id))}
                onDecline={() => act(`g:${group.id}:${u.id}`, () => groupService.rejectMember(group.id, u.id))}
              />
            ))}
          </Section>
        ))}

        {/* ── Game join requests ── */}
        {data.games.map(({ game, pending }) => (
          <Section
            key={`m:${game.id}`}
            title={he.requestsGameSection(game.title ?? 'משחק')}
            count={pending.length}
            busy={busy === `mAll:${game.id}`}
            onApproveAll={() =>
              approveAll(`mAll:${game.id}`, pending.length, () =>
                approveAllForGame(game.id, pending.map((u) => u.id)),
              )
            }
          >
            {pending.map((u) => (
              <Row
                key={`${game.id}:${u.id}`}
                user={u}
                busy={busy === `m:${game.id}:${u.id}`}
                onOpenProfile={() => nav.navigate('PlayerCard', { userId: u.id })}
                onApprove={() =>
                  act(`m:${game.id}:${u.id}`, async () => {
                    const r = await gameService.approveGameJoin(game.id, u.id);
                    // Full game → the approved player lands on the waitlist;
                    // tell the admin so it's not a silent surprise.
                    if (r?.bucket === 'waitlist') {
                      toast.info(he.requestsApprovedToWaitlist);
                    }
                  })
                }
                onDecline={() => act(`m:${game.id}:${u.id}`, () => gameService.rejectGameJoin(game.id, u.id))}
              />
            ))}
          </Section>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title, count, busy, onApproveAll, children,
}: {
  title: string;
  count: number;
  busy: boolean;
  onApproveAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle} numberOfLines={1}>{title} · {count}</Text>
        {count > 1 ? (
          busy ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Pressable onPress={onApproveAll} hitSlop={8} style={styles.approveAllBtn}>
              <Ionicons name="checkmark-done" size={16} color={colors.primary} />
              <Text style={styles.approveAllTxt}>{he.requestsApproveAll}</Text>
            </Pressable>
          )
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Row({
  user, busy, onApprove, onDecline, onOpenProfile,
}: {
  user: User | null;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
  onOpenProfile?: () => void;
}) {
  return (
    <View style={styles.row}>
      {/* Avatar + name open the player's card (user report: they should be
          tappable). Falls back to a plain View when we have no user id. */}
      <Pressable
        style={styles.rowMain}
        onPress={onOpenProfile}
        disabled={!onOpenProfile}
        hitSlop={6}
      >
        <Avatar avatarId={user?.avatarId} uri={user?.photoUrl} name={user?.name ?? '?'} size={44} />
        <Text style={styles.name} numberOfLines={1}>{user?.name ?? he.friendsUnknownUser}</Text>
      </Pressable>
      {busy ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <View style={styles.actions}>
          <Pressable onPress={onApprove} hitSlop={8} style={[styles.iconBtn, styles.acceptBtn]} accessibilityLabel={he.friendsAccept}>
            <Ionicons name="checkmark" size={20} color="#FFFFFF" />
          </Pressable>
          <Pressable onPress={onDecline} hitSlop={8} style={[styles.iconBtn, styles.declineBtn]} accessibilityLabel={he.friendsDecline}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  emptyWrap: { alignItems: 'center', paddingVertical: spacing.xl * 2, gap: spacing.sm },
  emptyTitle: { ...typography.h3, color: colors.text, textAlign: 'center' },
  emptyHint: { ...typography.body, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.lg },
  section: { marginBottom: spacing.lg },
  sectionHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sectionTitle: { ...typography.h3, color: colors.text, textAlign: RTL_LABEL_ALIGN, flex: 1 },
  approveAllBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8 },
  approveAllTxt: { ...typography.bodyBold, color: colors.primary },
  // `row` (NOT row-reverse): under the app's RTL this lays the avatar+name out
  // from the RIGHT and the approve/decline actions on the LEFT — matching the
  // section title row and the rest of the app (e.g. CommunityPlayers). The old
  // row-reverse + the `flex:1` on rowMain flipped it to avatar-left (the bug).
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  name: { ...typography.bodyBold, color: colors.text, textAlign: RTL_LABEL_ALIGN, flex: 1 },
  actions: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  acceptBtn: { backgroundColor: colors.primary },
  declineBtn: { backgroundColor: colors.surfaceMuted },
});
