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
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { GameChampionship } from '@/components/match/GameChampionship';
import { TabScroll, TabSectionTitle, TabEmpty } from '@/components/match/tabs/MatchTabShell';
import { summaryLines } from '@/utils/roundSummaryLines';
import { teamName, teamNameAfterPreposition } from '@/components/match/rotationView';
import type { RoundSummary, Leader } from '@/utils/roundSummary';
import type { Game } from '@/types';
import { clubAccent, clubCardTint } from '@/theme/clubAccents';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he, iso } from '@/i18n/he';

export interface MatchStatsTabProps {
  game: Game;
  summary: RoundSummary | null;
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
        {hasPlayed ? (
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
    unit: (n: number) => string,
    leader: Leader | null,
    icon: keyof typeof Ionicons.glyphMap,
    tint: string,
  ) => {
    if (!leader || leader.value <= 0) return null;
    const named = leader.userIds.filter((u) => nameOf(u));
    if (named.length === 0) return null;
    return { label, unit: unit(leader.value), value: leader.value, ids: named, icon, tint };
  };

  const stars = [
    star(he.roundSummaryKingGoals, (n) => `${n}`, summary.leaders.topScorers, 'football', clubAccent.blue),
    star(he.roundSummaryKingAssists, (n) => `${n}`, summary.leaders.topAssisters, 'git-network', clubAccent.purple),
    star(he.roundSummaryKingInvolvement, (n) => `${n}`, summary.leaders.topGoalInvolvement, 'flash', clubAccent.green),
    star(he.roundSummaryKingWins, (n) => `${n}`, summary.leaders.topWinners, 'trophy', clubAccent.gold),
  ].filter(Boolean) as NonNullable<ReturnType<typeof star>>[];

  const best = (summary.teamHighlights?.best ?? [])[0] ?? null;
  const worst = (summary.teamHighlights?.worst ?? [])[0] ?? null;
  const pair = summary.pairHighlight;
  const pairNamed = pair ? pair.userIds.every((u) => nameOf(u)) : false;

  return (
    <TabScroll bottomInset={bottomInset} header={header} stickyHeader={stickyHeader}>
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
      <View style={styles.numbers}>
        <NumberTile icon="football" tint={clubAccent.green} value={s.rounds} label={he.gdStatsNumGames} />
        <NumberTile icon="grid" tint={clubAccent.blue} value={s.goals} label={he.gdStatsNumGoals} />
        <NumberTile icon="git-network" tint={clubAccent.purple} value={s.assists} label={he.gdStatsNumAssists} />
        <NumberTile icon="disc" tint={clubAccent.red} value={s.shootouts} label={he.gdStatsNumShootouts} />
      </View>

      {stars.length > 0 ? (
        <>
          <TabSectionTitle icon="star" text={he.gdStatsStarsTitle} tint={clubAccent.gold} />
          <View style={styles.grid}>
            {stars.map((st) => (
              <View key={st.label} style={[styles.starCard, { backgroundColor: clubCardTint(st.tint) }]}>
                <View style={styles.starHead}>
                  <Ionicons name={st.icon} size={14} color={st.tint} />
                  <Text style={[styles.starLabel, { color: st.tint }]} numberOfLines={1}>
                    {st.label}
                  </Text>
                </View>
                <Text style={[styles.starValue, { color: st.tint }]}>{st.unit}</Text>
                <View style={styles.starFaces}>
                  {st.ids.slice(0, 3).map((u) => (
                    <UserAvatar key={u} user={userOf(u)} size={26} ring />
                  ))}
                </View>
                {/* Every name in a bidi isolate, and "+2" behind a LRM.
                    Two different jobs: the isolates stop a Hebrew name caught
                    between two Latin ones from having its words pulled apart
                    (reported 01.10 — "שלומי צדוק" landed on two ends of a
                    line), and the LRM keeps the plus on the left of its digit
                    instead of the far side of the sentence. */}
                <Text style={styles.starNames} numberOfLines={1}>
                  {st.ids.slice(0, 2).map((u) => iso(nameOf(u))).join(' · ')}
                  {st.ids.length > 2 ? `\u200E +${st.ids.length - 2}` : ''}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {best || worst ? (
        <>
          <TabSectionTitle icon="shirt" text={he.gdStatsTeamsTitle} />
          <View style={styles.grid}>
            {best ? (
              <TeamCard
                tint={clubAccent.green}
                icon="trophy"
                label={he.gdTeamMostWins}
                team={teamName(best.colourIndex)}
                detail={he.gdTeamWinsUnit(best.wins)}
              />
            ) : null}
            {worst ? (
              <TeamCard
                tint={clubAccent.red}
                icon="trending-down"
                label={he.gdTeamMostLosses}
                team={teamName(worst.colourIndex)}
                detail={he.gdTeamLossesUnit(worst.losses)}
              />
            ) : null}
          </View>
        </>
      ) : null}

      {pair && pairNamed ? (
        <>
          <TabSectionTitle icon="people" text={he.gdStatsPairTitle} tint={clubAccent.purple} />
          <Card style={{ ...styles.pairCard, backgroundColor: clubCardTint(clubAccent.purple) }}>
            <View style={styles.pairRow}>
              <UserAvatar user={userOf(pair.userIds[0])} size={38} ring />
              <View style={styles.pairMid}>
                <Text style={styles.pairValue}>{pair.goals}</Text>
                <Text style={styles.pairCaption} numberOfLines={2}>
                  {he.roundSummaryPairText(
                    nameOf(pair.userIds[0]),
                    nameOf(pair.userIds[1]),
                    pair.goals,
                  )}
                </Text>
              </View>
              <UserAvatar user={userOf(pair.userIds[1])} size={38} ring />
            </View>
          </Card>
        </>
      ) : null}

      {lines.length > 0 ? (
        <>
          <TabSectionTitle icon="sparkles" text={he.gdStatsEventsTitle} tint={clubAccent.gold} />
          <Card style={styles.eventsCard}>
            {lines.map((l, i) => (
              <View key={`${l.text}-${i}`} style={[styles.eventRow, i > 0 && styles.eventDivider]}>
                <Text style={styles.eventIcon}>{l.icon}</Text>
                <Text style={styles.eventText}>{l.text}</Text>
              </View>
            ))}
          </Card>
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

function NumberTile({
  icon,
  tint,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  value: number;
  label: string;
}) {
  return (
    <View style={styles.numTile}>
      <View style={[styles.numIcon, { backgroundColor: clubCardTint(tint) }]}>
        <Ionicons name={icon} size={17} color={tint} />
      </View>
      <Text style={styles.numValue}>{value}</Text>
      <Text style={styles.numLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function TeamCard({
  tint,
  icon,
  label,
  team,
  detail,
}: {
  tint: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  team: string;
  detail: string;
}) {
  return (
    <View style={[styles.teamCard, { backgroundColor: clubCardTint(tint) }]}>
      <View style={styles.starHead}>
        <Ionicons name={icon} size={14} color={tint} />
        <Text style={[styles.starLabel, { color: tint }]} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={[styles.teamName, { color: tint }]} numberOfLines={1}>{team}</Text>
      <Text style={styles.teamDetail} numberOfLines={1}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  personal: {
    // `row` → first child rightmost under forceRTL: bolt, label, then the
    // chevron closing the row on the left, pointing the way it navigates.
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: clubCardTint(clubAccent.blue),
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
  numbers: { flexDirection: 'row', gap: spacing.sm },
  numTile: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: 4,
    shadowColor: '#1E293B',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 10,
    elevation: 2,
  },
  numIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  numLabel: { ...typography.caption, fontSize: 11, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  starCard: {
    // Two per row, with the gap taken out of the half.
    width: '48.5%',
    flexGrow: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 6,
  },
  starHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  starLabel: { ...typography.caption, fontSize: 12, fontWeight: '800', flexShrink: 1, textAlign: RTL_LABEL_ALIGN },
  starValue: { fontSize: 22, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  starFaces: { flexDirection: 'row', gap: 4 },
  starNames: { ...typography.caption, fontSize: 11, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  teamCard: { width: '48.5%', flexGrow: 1, borderRadius: radius.lg, padding: spacing.md, gap: 6 },
  teamName: { fontSize: 17, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  teamDetail: { ...typography.caption, fontSize: 12, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  pairCard: { padding: spacing.md },
  pairRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pairMid: { flex: 1, alignItems: 'center', gap: 2 },
  pairValue: { fontSize: 22, fontWeight: '800', color: clubAccent.purple },
  pairCaption: { ...typography.caption, fontSize: 11, color: colors.textMuted, textAlign: 'center' },
  eventsCard: { padding: 0, overflow: 'hidden', borderRadius: radius.lg },
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
