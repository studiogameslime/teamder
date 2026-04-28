import React, { useEffect } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { PlayerRow } from '@/components/PlayerRow';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import {
  selectBallCarrier,
  selectJerseyCarrier,
  selectRegisteredPlayers,
  selectWaitingPlayers,
  useGameStore,
} from '@/store/gameStore';
import { useUserStore } from '@/store/userStore';
import { useCurrentGroup, useIsAdmin } from '@/store/groupStore';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'GameRegistration'>;

export function GameRegistrationScreen() {
  const nav = useNavigation<Nav>();

  const user = useUserStore((s) => s.currentUser);
  const group = useCurrentGroup();
  const isAdmin = useIsAdmin(user?.id);

  const loadState = useGameStore((s) => s.loadState);
  const loadActiveGame = useGameStore((s) => s.loadActiveGame);
  const createGame = useGameStore((s) => s.createGame);

  // Kick off the load whenever the active group changes (or first mount).
  // In mock mode this is a no-op (loadState stays 'ready').
  useEffect(() => {
    if (!group) return;
    loadActiveGame(group.id);
  }, [group?.id, loadActiveGame]);

  // Branch on load state BEFORE accessing store.game, since in non-ready
  // states the game may be a stale placeholder we don't want to render.
  if (loadState === 'loading' || loadState === 'idle') {
    return <CenteredState icon="time-outline" title={he.gameLoading} loading />;
  }
  if (loadState === 'permission_denied') {
    return (
      <CenteredState
        icon="lock-closed-outline"
        title={he.gamePermissionDenied}
        tone="warning"
      />
    );
  }
  if (loadState === 'error') {
    return (
      <CenteredState
        icon="cloud-offline-outline"
        title={he.gameLoadError}
        action={{
          label: he.gameRetry,
          onPress: () => group && loadActiveGame(group.id),
        }}
        tone="warning"
      />
    );
  }
  if (loadState === 'no_game') {
    return (
      <CenteredState
        icon={isAdmin ? 'add-circle-outline' : 'time-outline'}
        title={isAdmin ? he.gameNoActiveAdmin : he.gameNoActivePlayer}
        action={
          isAdmin && group
            ? { label: he.gameCreate, onPress: () => createGame(group.id) }
            : undefined
        }
      />
    );
  }

  // loadState === 'ready' — render the original UI.
  return <ReadyContent nav={nav} />;
}

// ─── Ready content (original screen body, unchanged behavior) ───────────────

function ReadyContent({ nav }: { nav: Nav }) {
  const game = useGameStore((s) => s.game);
  const currentUserId = useGameStore((s) => s.currentUserId);
  const registered = useGameStore(selectRegisteredPlayers);
  const waiting = useGameStore(selectWaitingPlayers);
  const ballCarrier = useGameStore(selectBallCarrier);
  const jerseyCarrier = useGameStore(selectJerseyCarrier);
  const registerSelf = useGameStore((s) => s.registerSelf);
  const cancelSelf = useGameStore((s) => s.cancelSelf);

  // "Am I in?" — registered or on the waitlist.
  const isIn =
    !!currentUserId &&
    (game.players.includes(currentUserId) ||
      game.waitlist.includes(currentUserId));

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader
        title={he.eveningList}
        rightIcon="settings-outline"
        onRightPress={() => nav.navigate('GameDetails')}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.metaCard}>
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
            <Text style={styles.metaText}>{formatGameDate(game.startsAt)}</Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={18} color={colors.textMuted} />
            <Text style={styles.metaText}>{game.fieldName}</Text>
          </View>
        </Card>

        <View style={styles.sectionHeader}>
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
          <Text style={styles.sectionTitle}>
            {he.registered} ({he.playersCount(registered.length, game.maxPlayers)})
          </Text>
        </View>
        <Card style={styles.listCard}>
          {registered.slice(0, 7).map((p) => (
            <PlayerRow key={p.id} player={p} rightIcon="check" />
          ))}
          {registered.length > 7 && (
            <Text style={styles.moreText}>+{registered.length - 7} נוספים</Text>
          )}
        </Card>

        {waiting.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Ionicons name="time-outline" size={18} color={colors.warning} />
              <Text style={styles.sectionTitle}>
                {he.waiting} ({waiting.length})
              </Text>
            </View>
            <Card style={styles.listCard}>
              {waiting.map((p) => (
                <PlayerRow key={p.id} player={p} rightIcon="clock" />
              ))}
            </Card>
          </>
        )}

        <View style={styles.gearRow}>
          <View style={styles.gearItem}>
            <Ionicons name="shirt-outline" size={20} color={colors.text} />
            <Text style={styles.gearLabel}>{he.jerseys}</Text>
            <Text style={styles.gearName}>
              {jerseyCarrier ? jerseyCarrier.displayName : he.noBall}
            </Text>
          </View>
          <View style={styles.gearItem}>
            <Ionicons name="football-outline" size={20} color={colors.text} />
            <Text style={styles.gearLabel}>{he.ball}</Text>
            <Text style={styles.gearName}>
              {ballCarrier ? ballCarrier.displayName : he.noBall}
            </Text>
          </View>
        </View>

        <Button
          title={isIn ? he.imOut : he.imIn}
          variant={isIn ? 'secondary' : 'primary'}
          size="lg"
          fullWidth
          onPress={isIn ? cancelSelf : registerSelf}
          style={{ marginTop: spacing.lg }}
        />

        <Button
          title="⚽ עבור לסידור קבוצות"
          variant="outline"
          size="md"
          fullWidth
          onPress={() => nav.navigate('TeamSetup')}
          style={{ marginTop: spacing.md }}
        />

        <View style={{ marginTop: spacing.lg }}>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Centered state (loading / waiting / permission / error) ──────────────

function CenteredState({
  icon,
  title,
  loading,
  action,
  tone = 'neutral',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  loading?: boolean;
  action?: { label: string; onPress: () => void };
  tone?: 'neutral' | 'warning';
}) {
  const iconColor = tone === 'warning' ? colors.warning : colors.primary;
  const bg = tone === 'warning' ? colors.surfaceMuted : colors.primaryLight;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.eveningList} showBack={false} />
      <View style={styles.centerWrap}>
        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: spacing.lg }} />
        ) : (
          <View style={[styles.iconCircle, { backgroundColor: bg }]}>
            <Ionicons name={icon} size={56} color={iconColor} />
          </View>
        )}
        <Text style={styles.centerTitle}>{title}</Text>
        {action && (
          <Button
            title={action.label}
            variant="primary"
            size="lg"
            onPress={action.onPress}
            style={{ marginTop: spacing.xl, alignSelf: 'stretch' }}
            fullWidth
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function formatGameDate(ms: number): string {
  const d = new Date(ms);
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const dayName = days[d.getDay()];
  const dd = d.getDate();
  const mm = d.getMonth() + 1;
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${dayName}, ${dd}.${mm}, ${hh}:${mn}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  metaCard: { marginBottom: spacing.lg, gap: spacing.sm },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metaText: { ...typography.body, color: colors.text },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: { ...typography.bodyBold, color: colors.text },
  listCard: { padding: spacing.sm },
  moreText: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  gearRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  gearItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    gap: 2,
  },
  gearLabel: { ...typography.caption, color: colors.textMuted },
  gearName: { ...typography.label, color: colors.text },

  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  centerTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
  },
});
