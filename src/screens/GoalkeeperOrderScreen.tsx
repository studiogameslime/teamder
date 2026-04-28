import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Card } from '@/components/Card';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useGameStore } from '@/store/gameStore';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type R = RouteProp<RootStackParamList, 'GoalkeeperOrder'>;

const TEAM_NUMBER = { team1: 1, team2: 2, team3: 3 } as const;

export function GoalkeeperOrderScreen() {
  const route = useRoute<R>();
  const nav = useNavigation<any>();
  const teamColor = route.params.teamColor;
  const team = useGameStore((s) => s.game.teams?.find((t) => t.color === teamColor));
  const players = useGameStore((s) => s.players);
  const reorder = useGameStore((s) => s.reorderGoalkeepers);

  if (!team) {
    return (
      <SafeAreaView style={styles.root}>
        <ScreenHeader title={he.goalkeeperOrder} />
        <Text style={styles.empty}>אין נתונים</Text>
      </SafeAreaView>
    );
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= team.goalkeeperOrder.length) return;
    const next = [...team.goalkeeperOrder];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    reorder(teamColor, next);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.goalkeeperOrderTeam(TEAM_NUMBER[teamColor])} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={{ padding: spacing.sm }}>
          {team.goalkeeperOrder.map((pid, i) => {
            const p = players[pid];
            if (!p) return null;
            const tag =
              i === 0 ? he.current : i === 1 ? he.next : null;
            return (
              <View key={pid} style={styles.row}>
                <Text style={styles.idx}>{i + 1}</Text>
                <PlayerIdentity
                  user={{ id: pid, name: p.displayName, jersey: p.jersey }}
                  size="sm"
                  onPress={() => nav.navigate('PlayerCard', { userId: pid })}
                />
                <Text style={styles.name} numberOfLines={1}>
                  {p.displayName}
                </Text>
                {tag && (
                  <View
                    style={[
                      styles.tag,
                      { backgroundColor: i === 0 ? colors.primaryLight : colors.team1Bg },
                    ]}
                  >
                    <Text
                      style={[
                        styles.tagText,
                        { color: i === 0 ? colors.primary : colors.team1 },
                      ]}
                    >
                      {tag}
                    </Text>
                  </View>
                )}
                <Text style={styles.glove}>🧤</Text>
                <View style={styles.arrowCol}>
                  <Pressable onPress={() => move(i, i - 1)} hitSlop={8}>
                    <Ionicons name="chevron-up" size={20} color={colors.textMuted} />
                  </Pressable>
                  <Pressable onPress={() => move(i, i + 1)} hitSlop={8}>
                    <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </Card>
        <Text style={styles.hint}>↕ {he.dragToReorder}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  empty: { ...typography.body, textAlign: 'center', marginTop: spacing.xl, color: colors.textMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  idx: { ...typography.bodyBold, color: colors.textMuted, width: 22, textAlign: 'center' },
  name: { ...typography.body, color: colors.text, flex: 1 },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  tagText: { ...typography.caption, fontWeight: '600' },
  glove: { fontSize: 18 },
  arrowCol: { gap: 2 },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});
