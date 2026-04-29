import React, { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { GuestModal } from '@/components/GuestModal';
import { gameService } from '@/services/gameService';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import type { GameGuest } from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import {
  selectBallCarrier,
  selectJerseyCarrier,
  selectRegisteredPlayers,
  selectWaitingPlayers,
  useGameStore,
} from '@/store/gameStore';

export function GameDetailsScreen() {
  const game = useGameStore((s) => s.game);
  const registered = useGameStore(selectRegisteredPlayers);
  const waiting = useGameStore(selectWaitingPlayers);
  const ball = useGameStore(selectBallCarrier);
  const jersey = useGameStore(selectJerseyCarrier);
  const me = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);
  const [guestModal, setGuestModal] = useState<{
    open: boolean;
    editing?: GameGuest | null;
  }>({ open: false, editing: null });
  // Refresh tick — gameStore.game isn't reactive to direct Firestore writes
  // we make from this screen, so we bump a counter after add/edit/remove
  // and re-read the doc to refresh the local guest list.
  const [refreshTick, setRefreshTick] = useState(0);
  const [guests, setGuests] = useState<GameGuest[]>(game.guests ?? []);

  React.useEffect(() => {
    if (!game.id) {
      setGuests(game.guests ?? []);
      return;
    }
    let alive = true;
    gameService.getGameById(game.id).then((g) => {
      if (alive) setGuests(g?.guests ?? game.guests ?? []);
    });
    return () => {
      alive = false;
    };
  }, [game.id, refreshTick]);

  const isCoach = !!me && (
    game.createdBy === me.id ||
    !!myCommunities.find((g) => g.id === game.groupId)?.adminIds.includes(me.id)
  );

  const attendancePct = Math.round(
    (registered.reduce((acc, p) => acc + (p.stats?.attendancePct ?? 100), 0) /
      Math.max(1, registered.length))
  );

  const openMaps = () => {
    if (game.fieldLat == null || game.fieldLng == null) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${game.fieldLat},${game.fieldLng}`;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.eveningDetails} rightIcon="ellipsis-horizontal" />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Weather */}
        <Card style={styles.weatherCard}>
          <View style={styles.weatherRow}>
            <Ionicons name="partly-sunny-outline" size={36} color={colors.warning} />
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.tempText}>{game.weather?.tempC ?? '--'}°</Text>
              <Text style={styles.weatherLabel}>
                {he.rainProb}: {game.weather?.rainProb ?? 0}%
              </Text>
            </View>
          </View>
        </Card>

        <Row icon="navigate-outline" label={he.navigateToField} onPress={openMaps} />
        <Row
          icon="football-outline"
          label={he.ball}
          value={ball?.displayName ?? he.noBall}
        />
        <Row
          icon="shirt-outline"
          label={he.jerseys}
          value={jersey?.displayName ?? he.noBall}
        />
        <Row
          icon="people-outline"
          label={he.numRegistered}
          value={`${registered.length}/${game.maxPlayers}`}
        />
        <Row
          icon="time-outline"
          label={he.numWaiting}
          value={`${waiting.length}`}
        />

        {/* Attendance bar */}
        <Card style={{ marginTop: spacing.md }}>
          <Text style={styles.attLabel}>
            {he.expectedAttendance}: {attendancePct}%
          </Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${attendancePct}%` }]} />
          </View>
        </Card>

        <Button
          title={he.shareInvite}
          variant="outline"
          iconLeft="link-outline"
          fullWidth
          style={{ marginTop: spacing.lg }}
        />

        {/* Guests — coach-only management surface. The list itself is
            visible to everyone via the registered list with a "אורח"
            badge; the add/edit/remove actions live here. */}
        {isCoach ? (
          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            <View style={styles.guestsHeader}>
              <Text style={styles.guestsTitle}>{he.guestBadge}ים</Text>
              <Button
                title={he.guestAddButton}
                variant="outline"
                size="sm"
                iconLeft="person-add-outline"
                onPress={() =>
                  setGuestModal({ open: true, editing: null })
                }
                disabled={!game.id}
              />
            </View>
            {guests.length === 0 ? (
              <Text style={styles.guestsEmpty}>—</Text>
            ) : (
              guests.map((g) => (
                <Card key={g.id} style={styles.guestRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.guestName}>{g.name}</Text>
                    {g.estimatedRating !== undefined ? (
                      <Text style={styles.guestRating}>
                        ★ {g.estimatedRating.toFixed(1)}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() =>
                      setGuestModal({ open: true, editing: g })
                    }
                    hitSlop={6}
                    style={styles.guestActionBtn}
                  >
                    <Ionicons
                      name="create-outline"
                      size={18}
                      color={colors.text}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (!me?.id || !game.id) return;
                      Alert.alert(he.guestRemoveConfirmTitle, '', [
                        { text: he.cancel, style: 'cancel' },
                        {
                          text: he.guestRemove,
                          style: 'destructive',
                          onPress: async () => {
                            await gameService
                              .removeGuest(game.id, me.id, g.id)
                              .catch((err) => {
                                if (__DEV__)
                                  console.warn('[guests] remove failed', err);
                              });
                            setRefreshTick((t) => t + 1);
                          },
                        },
                      ]);
                    }}
                    hitSlop={6}
                    style={styles.guestActionBtn}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={colors.danger}
                    />
                  </Pressable>
                </Card>
              ))
            )}
          </View>
        ) : null}
      </ScrollView>

      {me && game.id ? (
        <GuestModal
          visible={guestModal.open}
          gameId={game.id}
          callerId={me.id}
          existing={guestModal.editing ?? null}
          onClose={() => setGuestModal({ open: false, editing: null })}
          onChanged={() => setRefreshTick((t) => t + 1)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function Row({
  icon,
  label,
  value,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
}) {
  return (
    <Card style={styles.rowCard} onPress={onPress}>
      <View style={styles.rowInner}>
        <Ionicons name={icon} size={20} color={colors.textMuted} />
        <Text style={styles.rowLabel}>{label}</Text>
        {value !== undefined && <Text style={styles.rowValue}>{value}</Text>}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxxl },
  weatherCard: { marginBottom: spacing.md },
  weatherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tempText: { ...typography.h1, color: colors.text },
  weatherLabel: { ...typography.caption, color: colors.textMuted },
  rowCard: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowLabel: { ...typography.body, color: colors.text, flex: 1 },
  rowValue: { ...typography.bodyBold, color: colors.text },
  attLabel: { ...typography.label, color: colors.text, marginBottom: spacing.sm },
  barTrack: {
    height: 8,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
  },
  guestsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  guestsTitle: { ...typography.h3, color: colors.text, textAlign: 'right' },
  guestsEmpty: { ...typography.caption, color: colors.textMuted, textAlign: 'right' },
  guestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  guestName: { ...typography.body, color: colors.text, textAlign: 'right' },
  guestRating: { ...typography.caption, color: colors.warning, textAlign: 'right' },
  guestActionBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
