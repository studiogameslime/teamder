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
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Avatar } from '@/components/Avatar';
import { toast } from '@/components/Toast';
import { friendsService, type FriendRequestWithUser } from '@/services/friendsService';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import type { User } from '@/types';

export function FriendsScreen() {
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const me = useUserStore((s) => s.currentUser);
  const [friends, setFriends] = useState<User[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { pull?: boolean } = {}) => {
      if (!me) return;
      if (opts.pull) setRefreshing(true);
      else setLoading(true);
      try {
        const [f, inc] = await Promise.all([
          friendsService.listFriends(me.id),
          friendsService.listIncomingRequests(me.id),
        ]);
        setFriends(f);
        setIncoming(inc);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [me],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleAccept = async (fromUserId: string) => {
    if (!me) return;
    setBusyId(fromUserId);
    try {
      await friendsService.acceptRequest(fromUserId, me.id);
      toast.success(he.friendsAccepted);
      await load();
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
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
      Alert.alert(he.error, String((e as Error).message ?? e));
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = (friend: User) => {
    if (!me) return;
    Alert.alert(he.friendsRemoveTitle, he.friendsRemoveBody(friend.name), [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.friendsRemove,
        style: 'destructive',
        onPress: async () => {
          setBusyId(friend.id);
          try {
            await friendsService.removeFriend(me.id, friend.id);
            await load();
          } catch (e) {
            Alert.alert(he.error, String((e as Error).message ?? e));
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
          <ActivityIndicator color={colors.primary} />
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
                        style={[styles.iconBtn, styles.acceptBtn]}
                        accessibilityLabel={he.friendsAccept}
                      >
                        <Ionicons name="checkmark" size={20} color="#FFFFFF" />
                      </Pressable>
                      <Pressable
                        onPress={() => handleDecline(request.fromUserId)}
                        style={[styles.iconBtn, styles.declineBtn]}
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

          {/* ② Friends */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {he.friendsMineTitle(friends.length)}
            </Text>
            {friends.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons
                  name="people-outline"
                  size={40}
                  color={colors.textMuted}
                />
                <Text style={styles.emptyText}>{he.friendsEmpty}</Text>
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
  empty: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
