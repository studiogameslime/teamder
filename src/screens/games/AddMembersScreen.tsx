// AddMembersScreen — admin-only "register members from the community" picker.
// Lists the game's community members who AREN'T already in the roster and lets
// the admin register several at once straight into the game (server-side
// adminAddPlayers → players, overflowing to waitlist). Each gets a push.

import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { UserAvatar } from '@/components/UserAvatar';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { userService } from '@/services';
import { gameService } from '@/services/gameService';
import { logError } from '@/services/errorLog';
import { toast } from '@/components/Toast';
import type { Game, User } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { selectionHaptic } from '@/utils/haptics';

type RouteParams = { AddMembers: { gameId: string } };

export function AddMembersScreen() {
  const route = useRoute<RouteProp<RouteParams, 'AddMembers'>>();
  const nav = useNavigation<any>();
  const { gameId } = route.params;
  const me = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);

  const [game, setGame] = useState<Game | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!gameId || !me) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const g = await gameService.getGameById(gameId).catch(() => null);
        if (!alive) return;
        setGame(g);
        if (!g) {
          setMembers([]);
          return;
        }
        const grp = myCommunities.find((c) => c.id === g.groupId);
        const memberIds = Array.from(
          new Set([...(grp?.playerIds ?? []), ...(grp?.adminIds ?? [])]),
        );
        // Exclude anyone already in the roster (players/waitlist/pending) AND
        // the current user — the admin shouldn't see themselves in the
        // "add members" picker ("למה אני מופיע פה?").
        const inRoster = new Set([
          ...(g.players ?? []),
          ...(g.waitlist ?? []),
          ...(g.pending ?? []),
        ]);
        const toLoad = memberIds.filter(
          (id) => !inRoster.has(id) && id !== me?.id,
        );
        const profiles = await Promise.all(
          toLoad.map((id) => userService.getUserById(id).catch(() => null)),
        );
        if (!alive) return;
        setMembers(
          profiles.filter((u): u is User => !!u).sort((a, b) => a.name.localeCompare(b.name, 'he')),
        );
      } catch (err) {
        logError('AddMembersScreen.load', err, { gameId });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId, me, myCommunities]);

  const toggle = (id: string) => {
    selectionHaptic();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const spotsLeft = useMemo(() => {
    if (!game || !game.maxPlayers) return Infinity;
    return Math.max(0, game.maxPlayers - (game.players?.length ?? 0));
  }, [game]);

  const onSubmit = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const res = await gameService.adminAddMembers(gameId, ids);
      const total = res.addedToPlayers + res.addedToWaitlist;
      if (total === 0) {
        toast.info(he.addMembersNoneAdded);
      } else if (res.addedToWaitlist > 0) {
        toast.success(he.addMembersDoneWaitlist(res.addedToPlayers, res.addedToWaitlist));
      } else {
        toast.success(he.addMembersDone(res.addedToPlayers));
      }
      if (nav.canGoBack()) nav.goBack();
    } catch (err) {
      logError('AddMembersScreen.submit', err, { gameId });
      toast.error(he.addMembersError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.addMembersTitle} />
      {loading ? (
        <View style={styles.center}>
          <SoccerBallLoader />
        </View>
      ) : members.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={46} color={colors.textMuted} />
          <Text style={styles.emptyText}>{he.addMembersEmpty}</Text>
        </View>
      ) : (
        <>
          <Text style={styles.hint}>
            {Number.isFinite(spotsLeft)
              ? he.addMembersHintSpots(spotsLeft)
              : he.addMembersHint}
          </Text>
          <FlatList
            data={members}
            keyExtractor={(u) => u.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              const on = selected.has(item.id);
              return (
                <Pressable
                  style={[styles.row, on && styles.rowOn]}
                  onPress={() => toggle(item.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                >
                  <View style={[styles.check, on && styles.checkOn]}>
                    {on ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}
                  </View>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <UserAvatar user={item} size={38} />
                </Pressable>
              );
            }}
          />
          <View style={styles.footer}>
            <Button
              title={
                selected.size > 0
                  ? he.addMembersSubmit(selected.size)
                  : he.addMembersSubmitEmpty
              }
              variant="primary"
              size="lg"
              fullWidth
              disabled={selected.size === 0 || submitting}
              loading={submitting}
              onPress={onSubmit}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  list: { padding: spacing.lg, gap: spacing.sm },
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowOn: { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
  name: { ...typography.bodyBold, color: colors.text, flex: 1, textAlign: RTL_LABEL_ALIGN },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  footer: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
