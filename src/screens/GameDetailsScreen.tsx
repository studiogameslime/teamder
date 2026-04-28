import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
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
      </ScrollView>
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
});
