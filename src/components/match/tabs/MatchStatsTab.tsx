// "סטטיסטיקות" — the evening's own numbers.
//
// Every figure here comes from ONE authoritative document: `roundSummaries/
// {gameId}`, sealed once by the Cloud Function that closes the evening. The
// tab computes nothing. That is deliberate — the same numbers are quoted in
// the personal summary and in the club's records, and a second derivation on
// the phone is how two screens end up disagreeing about the same night.
//
// Reference layout, top to bottom:
//   סיכום מחזור אישי  (a link, not a section)
//   המחזור במספרים    stats.rounds / goals / assists / shootouts
//   כוכבי המחזור      leaders.*
//   הקבוצות במחזור    teamHighlights.best / worst
//   הצמד של הערב      pairHighlight
//   מה קרה הערב       events[]
//   טבלת המחזור       GameChampionship  ← last, per the brief

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { UserAvatar } from '@/components/UserAvatar';
import { GameChampionship } from '@/components/match/GameChampionship';
import { TabScroll, TabSectionTitle, TabEmpty } from '@/components/match/tabs/MatchTabShell';
import { summaryLines } from '@/utils/roundSummaryLines';
import { teamName } from '@/components/match/rotationView';
import type { RoundSummary, Leader } from '@/utils/roundSummary';
import type { Game } from '@/types';
import { clubAccent } from '@/theme/clubAccents';
import { ClubStatsSummary, ClubStatsAwards, clubStatsPalette } from '@/components/community/ClubStatsDashboard';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export interface MatchStatsTabProps {
  game: Game;
  summary: RoundSummary | null;
  /** Only a completed successful read may claim that no summary exists. */
  readStatus?: 'loading' | 'ready' | 'error';
  onRetry?: () => void;
  /** Resolves a uid to a display name. Empty string when unknown. */
  nameOf: (uid: string) => string;
  /** Minimal user shape for the avatars, by uid. */
  userOf: (uid: string) => { id: string; name: string; avatarId?: string; photoUrl?: string };
  /** `true` once the evening has actually produced mini-games. */
  hasPlayed: boolean;
  onOpenPersonalSummary: () => void;
  /** Whether to render the personal-summary link at all. */
  showPersonalSummary: boolean;
  /** Bumped by the retro-goal sheet so the table re-reads its rows. */
  championshipRefreshKey?: number;
  /** Rendered directly BELOW the scorers table. The admin's "השלם גולים" entry
   *  point belongs beside the table it corrects; it sat above it at first, but
   *  the owner wants the table to be the first thing read and the correction
   *  offered after it. Passed in rather than built here so this component stays
   *  free of admin logic and of the retro-goal sheet's state. */
  adminExtras?: React.ReactNode;
  bottomInset?: number;
  /** Hero + tab bar, carried inside this pane's scroll. */
  header?: React.ReactNode;
  stickyHeader?: React.ReactNode;
}

export function MatchStatsTab({
  game,
  summary,
  readStatus = 'ready',
  onRetry,
  nameOf,
  userOf,
  hasPlayed,
  onOpenPersonalSummary,
  showPersonalSummary,
  championshipRefreshKey,
  adminExtras,
  bottomInset,
  header,
  stickyHeader,
}: MatchStatsTabProps) {
  // ── Which kind of empty is this? ────────────────────────────────────────
  //
  // Three states that look alike and are not: an evening that has not been
  // played, an evening that WAS played before the app recorded any of it, and
  // an evening with data. Telling a two-year-old match "המחזור עוד לא שוחק"
  // is simply false, so the distinction is made from the game's own history
  // rather than from the absence of a summary.
  if (!summary) {
    return (
      <TabScroll bottomInset={bottomInset} header={header} stickyHeader={stickyHeader}>
        {game.status !== 'finished' ? (
          <StatsPreview />
        ) : readStatus !== 'ready' ? (
          <SummaryReadNotice status={readStatus} onRetry={onRetry} />
        ) : hasPlayed ? (
          <TabEmpty
            icon="document-text-outline"
            title={he.gdStatsNoCoverageTitle}
            body={he.gdStatsNoCoverageBody}
          />
        ) : (
          <TabEmpty
            icon="stats-chart-outline"
            title={he.gdStatsEmptyTitle}
            body={he.gdStatsEmptyBody}
          />
        )}
      </TabScroll>
    );
  }

  const s = summary.stats;
  const lines = summaryLines(summary.events, (uid) => nameOf(uid) || null);

  // A category with no leader, or one whose people we cannot name, is not
  // rendered as a card with a blank face — it is not rendered. See §12 of the
  // brief: never invent a winner to fill a slot.
  const star = (
    label: string,
    unit: string,
    leader: Leader | null,
  ) => {
    if (!leader || leader.value <= 0) return null;
    const named = leader.userIds.filter((u) => nameOf(u));
    if (named.length === 0) return null;
    return { label, unit, value: leader.value, ids: named };
  };

  const stars = [
    star(he.roundSummaryKingGoals, 'שערים', summary.leaders.topScorers),
    star(he.roundSummaryKingAssists, 'בישולים', summary.leaders.topAssisters),
    star(he.roundSummaryKingInvolvement, 'מעורבויות', summary.leaders.topGoalInvolvement),
    star(he.roundSummaryKingWins, 'ניצחונות', summary.leaders.topWinners),
  ].filter(Boolean) as NonNullable<ReturnType<typeof star>>[];

  const best = (summary.teamHighlights?.best ?? [])[0] ?? null;
  const worst = (summary.teamHighlights?.worst ?? [])[0] ?? null;
  const pair = summary.pairHighlight;
  const pairNamed = pair ? pair.userIds.every((u) => nameOf(u)) : false;

  return (
    <TabScroll bottomInset={bottomInset} header={header} stickyHeader={stickyHeader}>
      {game.status !== 'finished' ? (
          <StatsPreview />
        ) : readStatus !== 'ready' ? (
        <SummaryReadNotice status={readStatus} refreshing onRetry={onRetry} />
      ) : null}
      {/* A link, not a banner: it leads somewhere rather than saying something,
          and the numbers below are what the tab is for. */}
      {showPersonalSummary ? (
        <Pressable
          onPress={onOpenPersonalSummary}
          style={({ pressed }) => [styles.personal, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={he.gdStatsPersonalCta}
        >
          <Ionicons name="flash" size={17} color={clubAccent.blue} />
          <Text style={styles.personalText}>{he.gdStatsPersonalCta}</Text>
          <Ionicons name="chevron-back" size={17} color={clubAccent.blue} />
        </Pressable>
      ) : null}

      <TabSectionTitle icon="grid" text={he.gdStatsNumbersTitle} />
      <ClubStatsSummary games={s.rounds} goals={s.goals} assists={s.assists} shootouts={s.shootouts} />

      {stars.length > 0 ? <>
        <TabSectionTitle icon="trophy-outline" text={he.gdStatsStarsTitle} />
        <ClubStatsAwards leaders={stars.map(st => ({
          title: st.label, value: st.value, unit: st.unit,
          user: userOf(st.ids[0]), tiedUsers: st.ids.slice(1).map(userOf),
        }))} />
      </> : null}

      {best || worst ? (
        <>
          <TabSectionTitle icon="shirt" text={he.gdStatsTeamsTitle} />
          <View style={styles.grid}>
            {best ? (
              <TeamCard
                icon="trophy"
                label={he.gdTeamMostWins}
                team={teamName(best.colourIndex, game.draftTeams?.teams)}
                detail={he.gdTeamWinsUnit(best.wins)}
              />
            ) : null}
            {worst ? (
              <TeamCard
                icon="trending-down"
                label={he.gdTeamMostLosses}
                team={teamName(worst.colourIndex, game.draftTeams?.teams)}
                detail={he.gdTeamLossesUnit(worst.losses)}
              />
            ) : null}
          </View>
        </>
      ) : null}

      {pair && pairNamed ? (
        <>
          <TabSectionTitle icon="people" text={he.gdStatsPairTitle} tint={clubStatsPalette.teal} />
          <View style={styles.pairCard}>
            <View style={styles.pairRow}>
              <View style={styles.pairPlayer}>
                <UserAvatar user={userOf(pair.userIds[0])} size={72} />
                <Text style={styles.pairName} numberOfLines={2}>{nameOf(pair.userIds[0])}</Text>
              </View>
              <View style={styles.pairLink}><Ionicons name="trophy-outline" size={24} color={clubStatsPalette.teal} /></View>
              <View style={styles.pairPlayer}>
                <UserAvatar user={userOf(pair.userIds[1])} size={72} />
                <Text style={styles.pairName} numberOfLines={2}>{nameOf(pair.userIds[1])}</Text>
              </View>
            </View>
            <Text style={styles.pairCaption}>{he.roundSummaryPairText(nameOf(pair.userIds[0]), nameOf(pair.userIds[1]), pair.goals)}</Text>
          </View>
        </>
      ) : null}

      {lines.length > 0 ? (
        <>
          <TabSectionTitle icon="sparkles" text={he.gdStatsEventsTitle} tint={clubStatsPalette.teal} />
          <View style={styles.eventsCard}>
            {lines.map((l, i) => (
              <View key={`${l.text}-${i}`} style={[styles.eventRow, i > 0 && styles.eventDivider]}>
                <Text style={styles.eventIcon}>{l.icon}</Text>
                <Text style={styles.eventText}>{l.text}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {/* The table, then the admin's correction for it (owner report). The
          component is unchanged — same
          columns, same sorting, same zero-row merge for attendees, same guest
          handling. It only moved. */}
      <GameChampionship
        gameId={game.id}
        groupId={game.groupId}
        refreshKey={championshipRefreshKey}
        // UNCHANGED from the old layout: everyone who showed up is listed even
        // with no stats (report [cetR]), and active guests are full players in
        // the cycle. Losing either would be a regression, not a simplification.
        attendedUids={[
          ...(game.players ?? []).filter((uid) => game.arrivals?.[uid] !== 'no_show'),
          ...(game.guests ?? []).filter((g) => !g.waitlisted).map((g) => `guest:${g.id}`),
        ]}
        guests={(game.guests ?? []).filter((g) => !g.waitlisted)}
      />

      {adminExtras}
    </TabScroll>
  );
}

function SummaryReadNotice({ status, refreshing = false, onRetry }: {
  status: 'loading' | 'error';
  refreshing?: boolean;
  onRetry?: () => void;
}) {
  const loading = status === 'loading';
  return (
    <View style={styles.readNotice} testID="match-stats-read-notice" accessibilityLiveRegion="polite">
      {loading ? <ActivityIndicator color={colors.primary} /> : (
        <Ionicons name="cloud-offline-outline" size={25} color={colors.textMuted} />
      )}
      <Text style={styles.readTitle}>
        {loading
          ? refreshing ? 'מעדכנים את נתוני המחזור…' : 'טוענים את נתוני המחזור…'
          : refreshing ? 'לא הצלחנו לעדכן את נתוני המחזור' : 'לא הצלחנו לטעון את נתוני המחזור'}
      </Text>
      {!loading ? <>
        <Text style={styles.readBody}>
          {refreshing ? 'הנתונים שכבר נטענו נשארו מוצגים.' : 'בדקו את החיבור ונסו שוב.'}
        </Text>
        {onRetry ? <Pressable
          accessibilityRole="button"
          accessibilityLabel="ניסיון חוזר"
          testID="match-stats-retry"
          onPress={onRetry}
          style={styles.retry}
        ><Text style={styles.retryText}>ניסיון חוזר</Text></Pressable> : null}
      </> : null}
    </View>
  );
}

/** A preview of the sections, never fabricated results or player rankings. */
function StatsPreview() {
  return <View style={{gap:spacing.md}}>
    <View style={[styles.readNotice,{backgroundColor:'#EFF5FF',gap:8}]}>
      <Ionicons name="stats-chart-outline" size={28} color={colors.primary} />
      <Text style={[styles.readBody,{color:colors.primary,fontWeight:'700'}]}>תצוגה מקדימה</Text>
      <Text style={styles.readTitle}>הסטטיסטיקה תופיע בסיום המחזור</Text>
      <Text style={styles.readBody}>אחרי סיום המחזור נציג כאן את התוצאות והביצועים של השחקנים.</Text>
    </View>
    <TabSectionTitle icon="grid" text={he.gdStatsNumbersTitle} />
    <ClubStatsSummary games="—" goals="—" assists="—" shootouts="—" />
    <TabSectionTitle icon="trophy-outline" text={he.gdStatsStarsTitle} />
    <ClubStatsAwards leaders={[
      { title: he.roundSummaryKingGoals, value: '—', unit: 'שערים' },
      { title: he.roundSummaryKingAssists, value: '—', unit: 'בישולים' },
      { title: he.roundSummaryKingInvolvement, value: '—', unit: 'מעורבויות' },
      { title: he.roundSummaryKingWins, value: '—', unit: 'ניצחונות' },
    ]} />
  </View>;
}

function TeamCard({
  icon,
  label,
  team,
  detail,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  team: string;
  detail: string;
}) {
  return (
    <View style={styles.teamCard}>
      <View style={styles.starHead}>
        <Ionicons name={icon} size={14} color={clubStatsPalette.teal} />
        <Text style={styles.starLabel} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={styles.teamName} numberOfLines={1}>{team}</Text>
      <Text style={styles.teamDetail} numberOfLines={1}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  readNotice: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  readTitle: { ...typography.bodyBold, color: colors.text, textAlign: 'center' },
  readBody: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  retry: { minHeight: 48, minWidth: 140, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.md, borderRadius: radius.lg, backgroundColor: colors.primary },
  retryText: { ...typography.bodyBold, color: '#FFFFFF' },
  personal: {
    // `row` → first child rightmost under forceRTL: bolt, label, then the
    // chevron closing the row on the left, pointing the way it navigates.
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#EFF5FF',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    height: 48,
  },
  personalText: {
    flex: 1,
    ...typography.bodyBold,
    fontSize: 15,
    color: clubAccent.blue,
    textAlign: RTL_LABEL_ALIGN,
  },
  grid: { gap: spacing.sm },
  starHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  starLabel: { fontSize: 12, color: clubStatsPalette.muted, textAlign: RTL_LABEL_ALIGN },
  teamCard: { borderWidth: 1, borderColor: clubStatsPalette.border, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, gap: 6 },
  teamName: { fontSize: 17, fontWeight: '800', color: clubStatsPalette.ink, textAlign: RTL_LABEL_ALIGN },
  teamDetail: { fontSize: 12, color: clubStatsPalette.muted, textAlign: RTL_LABEL_ALIGN },
  pairCard: { padding: spacing.md, borderWidth: 1, borderColor: clubStatsPalette.border, borderRadius: 12, backgroundColor: '#FFFFFF' },
  pairRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pairPlayer: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6 },
  pairName: { color: clubStatsPalette.ink, fontWeight: '800', fontSize: 14, textAlign: 'center', alignSelf: 'stretch' },
  pairLink: { width: 44, height: 72, alignItems: 'center', justifyContent: 'center' },
  pairCaption: { fontSize: 14, fontWeight: '600', color: clubStatsPalette.ink, textAlign: 'center', borderTopWidth: 1, borderTopColor: '#EAF0F5', paddingTop: 9, marginTop: 12 },
  eventsCard: { backgroundColor: '#FFFFFF', padding: 0, overflow: 'hidden', borderRadius: 12, borderWidth: 1, borderColor: clubStatsPalette.border },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
  },
  eventDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  eventIcon: { fontSize: 15 },
  // `minWidth: 0` beside `flex: 1` — without it a long unbroken run pushes the
  // row wider than its card instead of wrapping. Same pair the standalone
  // summary screen uses on the identical line. No `writingDirection`: the
  // alignment token already places the text, and setting both double-applies.
  eventText: {
    flex: 1,
    minWidth: 0,
    ...typography.caption,
    fontSize: 12.5,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
});
