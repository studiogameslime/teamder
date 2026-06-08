// FriendsScreen — manage mutual friendships.
//
//   ① Incoming requests (accept / decline) — shown only when present.
//   ② My friends — tap to open the player card; long-press affordance to
//      remove. Friends power the "הזמן חברים" picker in game creation.
//
// All data flows through friendsService (mock-complete). Accepting goes
// through the trusted callable in Firebase mode; mock mode is fully
// functional for offline UX work.

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { deepLinkService } from '@/services/deepLinkService';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { Avatar } from '@/components/Avatar';
import { toast } from '@/components/Toast';
import { successHaptic } from '@/utils/haptics';
import { friendsService, type FriendRequestWithUser } from '@/services/friendsService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import type { User } from '@/types';

export function FriendsScreen() {
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const me = useUserStore((s) => s.currentUser);
  const [friends, setFriends] = useState<User[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestWithUser[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { pull?: boolean } = {}) => {
      if (!me) return;
      if (opts.pull) setRefreshing(true);
      else setLoading(true);
      try {
        const [f, inc, out] = await Promise.all([
          friendsService.listFriends(me.id),
          friendsService.listIncomingRequests(me.id),
          friendsService.listOutgoingRequests(me.id),
        ]);
        setFriends(f);
        setIncoming(inc);
        setOutgoing(out);
      } catch (err) {
        // The list-load has no per-call logging in friendsService (the
        // mutations do, but the read fan-out does not), so a failed
        // query here would otherwise vanish — the screen just stays on
        // whatever it last rendered. Record it.
        logError('loadFriends', err, { screen: 'FriendsScreen', userId: me.id });
        if (__DEV__) console.warn('[friends] load failed', err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [me],
  );

  useFocusEffect(
    useCallback(() => {
      logEvent(AnalyticsEvent.FriendsScreenOpened);
      load();
    }, [load]),
  );

  const handleAccept = async (fromUserId: string) => {
    if (!me) return;
    setBusyId(fromUserId);
    try {
      await friendsService.acceptRequest(fromUserId, me.id);
      successHaptic();
      toast.success(he.friendsAccepted);
      await load();
    } catch (e) {
      if (__DEV__) console.warn('[friends] accept failed', e);
      appAlert(he.error, he.friendsActionFailed);
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (fromUserId: string) => {
    if (!me) return;
    setBusyId(fromUserId);
    try {
      await friendsService.declineRequest(fromUserId, me.id);
      await load();
    } catch (e) {
      if (__DEV__) console.warn('[friends] decline failed', e);
      appAlert(he.error, he.friendsActionFailed);
    } finally {
      setBusyId(null);
    }
  };

  // Withdraw a friend request I sent but that hasn't been answered yet.
  const handleCancelOutgoing = async (toUserId: string) => {
    if (!me) return;
    setBusyId(toUserId);
    try {
      await friendsService.cancelRequest(me.id, toUserId);
      // Optimistically drop it so the row disappears even before the
      // re-fetch settles (read-after-write latency on the request docs).
      setOutgoing((prev) => prev.filter((o) => o.request.toUserId !== toUserId));
      await load();
    } catch (e) {
      if (__DEV__) console.warn('[friends] cancel request failed', e);
      appAlert(he.error, he.friendsActionFailed);
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = (friend: User) => {
    if (!me) return;
    appAlert(he.friendsRemoveTitle, he.friendsRemoveBody(friend.name), [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.friendsRemove,
        style: 'destructive',
        onPress: async () => {
          setBusyId(friend.id);
          try {
            await friendsService.removeFriend(me.id, friend.id);
            // Optimistically drop the friend from the local list. The
            // trusted callable mutates /users docs, but a re-fetch right
            // after can still read the stale friends array (read-after-
            // write latency), leaving the removed friend visible until the
            // next focus. Update local state now so the UI is correct.
            setFriends((prev) => prev.filter((f) => f.id !== friend.id));
            await load();
          } catch (e) {
            if (__DEV__) console.warn('[friends] remove failed', e);
            appAlert(he.error, he.friendsActionFailed);
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const openCard = (userId: string) => nav.navigate('PlayerCard', { userId });

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.friendsTitle} />
      {loading ? (
        <View style={styles.center}>
          <SoccerBallLoader size={40} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load({ pull: true })}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {/* ① Incoming requests */}
          {incoming.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{he.friendsRequestsTitle}</Text>
              {incoming.map(({ request, user }) => (
                <View key={request.id} style={styles.row}>
                  <Pressable
                    style={styles.rowMain}
                    onPress={() => openCard(request.fromUserId)}
                  >
                    <Avatar
                      avatarId={user?.avatarId}
                      uri={user?.photoUrl}
                      name={user?.name ?? '?'}
                      size={44}
                    />
                    <Text style={styles.name} numberOfLines={1}>
                      {user?.name ?? he.friendsUnknownUser}
                    </Text>
                  </Pressable>
                  {busyId === request.fromUserId ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <View style={styles.actions}>
                      <Pressable
                        onPress={() => handleAccept(request.fromUserId)}
                        style={({ pressed }) => [styles.iconBtn, styles.acceptBtn, pressed && { opacity: 0.7 }]}
                        hitSlop={8}
                        accessibilityLabel={he.friendsAccept}
                      >
                        <Ionicons name="checkmark" size={20} color="#FFFFFF" />
                      </Pressable>
                      <Pressable
                        onPress={() => handleDecline(request.fromUserId)}
                        style={({ pressed }) => [styles.iconBtn, styles.declineBtn, pressed && { opacity: 0.7 }]}
                        hitSlop={8}
                        accessibilityLabel={he.friendsDecline}
                      >
                        <Ionicons name="close" size={20} color={colors.textMuted} />
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}
            </View>
          ) : null}

          {/* ② Outgoing requests — pending requests I sent, with a way
              to withdraw them (previously these were invisible). */}
          {outgoing.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{he.friendsSentTitle}</Text>
              {outgoing.map(({ request, user }) => (
                <View key={request.id} style={styles.row}>
                  <Pressable
                    style={styles.rowMain}
                    onPress={() => openCard(request.toUserId)}
                  >
                    <Avatar
                      avatarId={user?.avatarId}
                      uri={user?.photoUrl}
                      name={user?.name ?? '?'}
                      size={44}
                    />
                    <Text style={styles.name} numberOfLines={1}>
                      {user?.name ?? he.friendsUnknownUser}
                    </Text>
                  </Pressable>
                  {busyId === request.toUserId ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Pressable
                      onPress={() => handleCancelOutgoing(request.toUserId)}
                      hitSlop={8}
                      style={styles.cancelOutgoingBtn}
                      accessibilityLabel={he.friendsCancelRequest}
                    >
                      <Text style={styles.cancelOutgoingText}>
                        {he.friendsCancelRequest}
                      </Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          ) : null}

          {/* ③ Friends */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {he.friendsMineTitle(friends.length)}
            </Text>
            {friends.length === 0 ? (
              // Empty state was just text + icon — felt unfinished.
              // Card with title + body + invite CTA gives the screen
              // a real "do something" affordance.
              <View style={styles.emptyCard}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons
                    name="people-outline"
                    size={28}
                    color={colors.primary}
                  />
                </View>
                <Text style={styles.emptyCardTitle}>
                  {he.friendsEmptyCtaTitle}
                </Text>
                <Text style={styles.emptyCardBody}>
                  {he.friendsEmptyCtaBody}
                </Text>
                <Pressable
                  onPress={async () => {
                    try {
                      // Device-correct store link — the old
                      // https://teamder.app domain isn't connected, so it
                      // was a dead link on every platform.
                      const link =
                        Platform.OS === 'ios'
                          ? 'https://apps.apple.com/app/id6775178022'
                          : 'https://play.google.com/store/apps/details?id=com.studiogameslime.soccerapp';
                      await Share.share({
                        title: he.inviteShareSubject,
                        message: he.profileInviteShareBody(link),
                      });
                    } catch {
                      /* user dismissed share sheet */
                    }
                  }}
                  style={({ pressed }) => [
                    styles.emptyCtaBtn,
                    pressed && { opacity: 0.9 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={he.friendsEmptyCtaButton}
                >
                  <Ionicons
                    name="person-add-outline"
                    size={18}
                    color="#FFFFFF"
                  />
                  <Text style={styles.emptyCtaBtnText}>
                    {he.friendsEmptyCtaButton}
                  </Text>
                </Pressable>
              </View>
            ) : (
              friends.map((friend) => (
                <View key={friend.id} style={styles.row}>
                  <Pressable
                    style={styles.rowMain}
                    onPress={() => openCard(friend.id)}
                  >
                    <Avatar
                      avatarId={friend.avatarId}
                      uri={friend.photoUrl}
                      name={friend.name}
                      size={44}
                    />
                    <Text style={styles.name} numberOfLines={1}>
                      {friend.name}
                    </Text>
                  </Pressable>
                  {busyId === friend.id ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Pressable
                      onPress={() => handleRemove(friend)}
                      hitSlop={8}
                      style={styles.removeBtn}
                      accessibilityLabel={he.friendsRemove}
                    >
                      <Ionicons
                        name="person-remove-outline"
                        size={20}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  )}
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xl },
  section: { marginBottom: spacing.xl },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  name: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: { backgroundColor: colors.primary },
  declineBtn: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  removeBtn: { padding: spacing.sm },
  cancelOutgoingBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelOutgoingText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  empty: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  // Empty-state CTA card — replaces the bare icon+text empty state
  // so the screen has a clear next action when no friends are yet
  // attached. Mirrors the "outline-card + filled-button" pattern used
  // on the games tab's empty state.
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(59,130,246,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  emptyCardBody: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyCtaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    marginTop: spacing.sm,
    alignSelf: 'stretch',
  },
  emptyCtaBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
