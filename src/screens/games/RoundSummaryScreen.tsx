// "סיכום המחזור" — what happened at the club that evening.
//
// NOT a personal card. Nothing here changes with who is looking: the same
// numbers, the same titles, the same story for everyone who was there. The
// personal summary lives one button below and answers a different question.
//
// The screen renders a document it did not compute. Everything interesting was
// decided when the evening was sealed — which records had stood, which
// milestones fell — because those questions stop being answerable once another
// evening is played.
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { UserAvatar } from '@/components/UserAvatar';
import { roundSummaryService } from '@/services/roundSummaryService';
import { summaryLines, type SummaryLine } from '@/utils/roundSummaryLines';
import type { Leader, RoundSummary } from '@/utils/roundSummary';
import { useGameStore } from '@/store/gameStore';
import { teamName } from '@/utils/draft';
import { formatDateShort } from '@/utils/format';
import { logEvent, AnalyticsEvent } from '@/services/analyticsService';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { GameStackParamList } from '@/navigation/GameStack';

const TONE_BG: Record<SummaryLine['tone'], string> = {
  gold: '#FEF3C7',
  blue: '#DBEAFE',
  purple: '#EDE9FE',
  lime: '#DCFCE7',
  rose: '#FFE4E6',
};

export function RoundSummaryScreen() {
  const route = useRoute<RouteProp<GameStackParamList, 'RoundSummary'>>();
  const gameId = route.params?.gameId ?? '';
  const [summary, setSummary] = useState<RoundSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const players = useGameStore((s) => s.players);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);

  useEffect(() => {
    let alive = true;
    roundSummaryService
      .get(gameId)
      .then((s) => {
        if (!alive) return;
        setSummary(s);
        setLoading(false);
        if (s) {
          // Which stories actually reach people is the only way to tell whether
          // the selection rules are picking the right ones.
          logEvent(AnalyticsEvent.ScreenView, {
            screen: 'RoundSummary',
            events: s.events.length,
            mini_games: s.stats.rounds,
          });
          const ids = new Set<string>();
          for (const l of Object.values(s.leaders)) {
            for (const u of (l as Leader | null)?.userIds ?? []) ids.add(u);
          }
          for (const e of s.events) if ('userIds' in e) e.userIds.forEach((u) => ids.add(u));
          if (s.pairHighlight) s.pairHighlight.userIds.forEach((u) => ids.add(u));
          const real = Array.from(ids).filter((u) => !u.startsWith('guest:'));
          if (real.length > 0) hydratePlayers(real);
        }
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [gameId, hydratePlayers]);

  const nameOf = (uid: string) => players[uid]?.displayName ?? null;

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title={he.roundSummaryTitle} />
        <View style={styles.center}>
          <SoccerBallLoader />
        </View>
      </SafeAreaView>
    );
  }

  if (!summary) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title={he.roundSummaryTitle} />
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>{he.roundSummaryUnavailable}</Text>
          <Text style={styles.emptyHint}>{he.roundSummaryUnavailableHint}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const lines = summaryLines(summary.events, nameOf);
  const s = summary.stats;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader title={he.roundSummaryTitle} />
      <ScrollView contentContainerStyle={styles.body}>
        {/* ① The evening in four numbers. Always present — it is the one part
            that is true of every evening ever played. */}
        <Section title={he.roundSummaryNumbers}>
          <View style={styles.numbers}>
            {/* The mini-game count is omitted when the evening has no
                per-mini-game history: they played, we simply do not know how
                many, and printing "0 משחקונים" would be a confident lie about
                a night people remember. Same reason the teams and the pair
                sections disappear — they come from the same source. */}
            {summary.coverage.hasRoundHistory ? (
              <Stat value={s.rounds} label={he.summaryMetricRounds} />
            ) : null}
            <Stat value={s.goals} label={he.summaryMetricGoals} />
            <Stat value={s.assists} label={he.summaryMetricAssists} />
            {s.shootouts > 0 ? (
              <Stat value={s.shootouts} label={he.summaryMetricShootouts} />
            ) : null}
          </View>
          {summary.backfilled ? (
            <Text style={styles.basis}>{he.roundSummaryBackfilled}</Text>
          ) : null}
        </Section>

        {/* ② Titles for the night. A category with no leader is simply absent:
            an evening without a single assist crowns nobody. */}
        <Section title={he.roundSummaryStars}>
          <King emoji="👑" label={he.roundSummaryKingGoals} leader={summary.leaders.topScorers} nameOf={nameOf} players={players} />
          <King emoji="🎯" label={he.roundSummaryKingAssists} leader={summary.leaders.topAssisters} nameOf={nameOf} players={players} />
          <King emoji="⭐" label={he.roundSummaryKingInvolvement} leader={summary.leaders.topGoalInvolvement} nameOf={nameOf} players={players} />
          <King emoji="🧱" label={he.roundSummaryKingCleanSheets} leader={summary.leaders.topCleanSheets} nameOf={nameOf} players={players} />
          <King emoji="🏆" label={he.roundSummaryKingWins} leader={summary.leaders.topWinners} nameOf={nameOf} players={players} />
        </Section>

        {summary.teamHighlights.best.length > 0 ? (
          <Section title={he.roundSummaryTeams}>
            {summary.teamHighlights.best.map((t) => (
              <Line
                key={`b${t.colourIndex}`}
                icon="🏆"
                tone="gold"
                text={he.roundSummaryTeamBest(colourName(t.colourIndex), t.wins)}
              />
            ))}
            {summary.teamHighlights.worst.map((t) => (
              <Line
                key={`w${t.colourIndex}`}
                icon="📉"
                tone="blue"
                text={he.roundSummaryTeamWorst(colourName(t.colourIndex), t.losses)}
              />
            ))}
          </Section>
        ) : null}

        {summary.pairHighlight ? (
          <Section title={he.roundSummaryPair}>
            <Line
              icon="🤝"
              tone="purple"
              text={he.roundSummaryPairText(
                nameOf(summary.pairHighlight.userIds[0]) ?? '',
                nameOf(summary.pairHighlight.userIds[1]) ?? '',
                summary.pairHighlight.goals,
              )}
            />
            {summary.pairHighlight.breakdown.length > 1
              ? summary.pairHighlight.breakdown.map((b) => (
                  <Text key={`${b.assisterId}${b.scorerId}`} style={styles.legText}>
                    {he.roundSummaryPairLeg(
                      nameOf(b.assisterId) ?? '',
                      nameOf(b.scorerId) ?? '',
                      b.goals,
                    )}
                  </Text>
                ))
              : null}
          </Section>
        ) : null}

        {/* ③ Only what actually happened. An ordinary evening ends here. */}
        {lines.length > 0 ? (
          <Section title={he.roundSummaryWhatHappened}>
            {lines.map((l, i) => (
              <Line key={`${l.text}${i}`} icon={l.icon} tone={l.tone} text={l.text} />
            ))}
            {summary.basis.since ? (
              <Text style={styles.basis}>
                {he.roundSummaryBasis(formatDateShort(summary.basis.since))}
              </Text>
            ) : null}
          </Section>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function colourName(index: number): string {
  // teamName gives "קבוצה אדומה"; the sentence supplies its own "קבוצה".
  return teamName(index).replace('קבוצה ', '');
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function King({
  emoji,
  label,
  leader,
  nameOf,
  players,
}: {
  emoji: string;
  label: string;
  leader: Leader | null;
  nameOf: (u: string) => string | null;
  players: Record<string, { displayName: string; avatarId?: string; photoUrl?: string }>;
}) {
  if (!leader) return null;
  const names = leader.userIds.map(nameOf).filter((n): n is string => !!n);
  if (names.length === 0) return null;
  return (
    <View style={styles.kingRow}>
      <View style={styles.kingAvatars}>
        {leader.userIds.slice(0, 3).map((uid) => (
          <UserAvatar
            key={uid}
            user={{
              id: uid,
              name: players[uid]?.displayName ?? '',
              avatarId: players[uid]?.avatarId,
              photoUrl: players[uid]?.photoUrl,
            }}
            size={34}
          />
        ))}
      </View>
      <View style={styles.kingText}>
        <Text style={styles.kingLabel}>{`${emoji} ${label}`}</Text>
        <Text style={styles.kingName}>{`${names.join(' · ')} — ${leader.value}`}</Text>
      </View>
    </View>
  );
}

function Line({ icon, tone, text }: { icon: string; tone: SummaryLine['tone']; text: string }) {
  return (
    <View style={[styles.line, { backgroundColor: TONE_BG[tone] }]}>
      <Text style={styles.lineText}>{text}</Text>
      <Text style={styles.lineIcon}>{icon}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  body: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  emptyTitle: { ...typography.h3, color: colors.text, textAlign: 'center' },
  emptyHint: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.h3,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  numbers: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    flexGrow: 1,
    minWidth: 74,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  statValue: { fontSize: 24, fontWeight: '800', color: colors.primary },
  statLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  // Avatars first: under forceRTL the first child sits on the visual right,
  // which is where a face belongs in a Hebrew row.
  kingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  kingAvatars: { flexDirection: 'row', gap: -8 },
  kingText: { flex: 1, minWidth: 0 },
  kingLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  kingName: { ...typography.body, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  lineText: { flex: 1, minWidth: 0, ...typography.body, fontWeight: '700', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  lineIcon: { fontSize: 18 },
  legText: { fontSize: 12, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  basis: { fontSize: 11, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, marginTop: 2 },
});
