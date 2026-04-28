import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { TeamCard } from '@/components/TeamCard';
import { Button } from '@/components/Button';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useGameStore } from '@/store/gameStore';
import { useUserStore } from '@/store/userStore';
import { useIsAdmin } from '@/store/groupStore';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'TeamSetup'>;

export function TeamSetupScreen() {
  const nav = useNavigation<Nav>();
  const game = useGameStore((s) => s.game);
  const players = useGameStore((s) => s.players);
  const generateTeams = useGameStore((s) => s.generateTeams);
  const shuffleTeams = useGameStore((s) => s.shuffleTeams);
  const lockAndStart = useGameStore((s) => s.lockAndStart);

  // Admin gating: only admins can lock the night and start matches.
  // Defense-in-depth: rules also reject non-admin writes — this is the UX.
  const user = useUserStore((s) => s.currentUser);
  const isAdmin = useIsAdmin(user?.id);

  useEffect(() => {
    if (!game.teams) generateTeams();
  }, [game.teams, generateTeams]);

  const teams = game.teams ?? [];
  const totalPlayers = teams.reduce((acc, t) => acc + t.playerIds.length, 0);

  const handleStart = () => {
    if (!isAdmin) return; // double-guard: button is disabled but be safe
    lockAndStart();
    nav.replace('LiveMatch', { gameId: game.id });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader
        title={he.teamOrder}
        subtitle={he.playersTotal(totalPlayers)}
        rightIcon="shuffle-outline"
        onRightPress={shuffleTeams}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {teams.map((t) => (
          <TeamCard
            key={t.color}
            color={t.color}
            isWaiting={t.isWaiting}
            players={t.playerIds.map((id) => players[id]).filter(Boolean)}
            onConfigureGoalkeepers={() =>
              nav.navigate('GoalkeeperOrder', { teamColor: t.color })
            }
          />
        ))}

        <View style={styles.footer}>
          <Button
            title={he.shuffleTeams}
            variant="outline"
            iconLeft="shuffle-outline"
            onPress={shuffleTeams}
            style={{ flex: 1 }}
          />
          <Button
            title={he.startEvening}
            variant="primary"
            onPress={handleStart}
            disabled={!isAdmin}
            style={{ flex: 1 }}
          />
        </View>
        {!isAdmin && (
          <Text style={styles.adminGate}>{he.startEveningAdminOnly}</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  adminGate: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
