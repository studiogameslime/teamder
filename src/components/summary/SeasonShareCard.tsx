// The season, on one card, small enough to send to somebody.
//
// The screen it lives on scrolls for a page and a half — twelve stat tiles, six
// people, a champions list — and none of that survives being sent to a WhatsApp
// group. A share card is a different job from a summary screen: pick the four
// numbers a person would actually say out loud, put the titles they won beside
// them, and stop.
//
// Rendered off-screen at a fixed width so the capture is the same on every
// phone. Nothing here is interactive; it exists to be turned into a PNG.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { SeasonSummaryModel } from '@/services/seasonSummaryService';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

/** Fixed, so the image is identical from a small phone and a large one. */
export const SHARE_CARD_WIDTH = 340;

function Big({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.big}>
      <Text style={styles.bigValue}>{value}</Text>
      <Text style={styles.bigLabel}>{label}</Text>
    </View>
  );
}

export function SeasonShareCard({
  model,
  playerName,
}: {
  model: SeasonSummaryModel;
  /** Whose season this is. A card with no name is a card nobody can place. */
  playerName?: string;
}) {
  const { me } = model;
  const pct = (v: number | null) =>
    v === null ? '—' : `${Math.round(v * 100)}%`;
  /** The best of the three placings, and what it was in. Nothing is more
   *  shareable than a podium finish, and none of it reached the card. */
  const bestRank: { rank: number; what: string } | undefined = (
    [
      { rank: me.ranks.goals, what: he.statGoals as string },
      { rank: me.ranks.assists, what: he.statAssists as string },
      { rank: me.ranks.wins, what: he.seasonStatWins as string },
    ] as Array<{ rank: number | null; what: string }>
  )
    .filter(
      (r): r is { rank: number; what: string } => typeof r.rank === 'number',
    )
    .sort((a, b) => a.rank - b.rank)[0];

  return (
    <View style={styles.card}>
      <Text style={styles.club} numberOfLines={1}>
        {playerName ? `${playerName} · ${model.groupName}` : model.groupName}
      </Text>
      <Text style={styles.season}>{he.seasonNumberLabel(model.seasonNo)}</Text>

      <View style={styles.row}>
        <Big value={String(me.goals)} label={he.statGoals} />
        <Big value={String(me.assists)} label={he.statAssists} />
        {/* MINI-GAMES, not evenings: the win percentage beside it is wins over
            mini-games, so showing evenings put a rate on the card next to a
            denominator that did not produce it. */}
        <Big value={String(me.rounds)} label={he.seasonStatRounds} />
        <Big value={pct(me.winPct)} label={he.seasonStatWinPct} />
      </View>

      <View style={styles.row}>
        <Big value={String(me.wins)} label={he.seasonStatWins} />
        <Big value={String(me.losses)} label={he.seasonStatLosses} />
        <Big value={String(me.ties)} label={he.seasonStatTies} />
        <Big value={String(me.cleanSheets)} label={he.seasonStatCleanSheets} />
      </View>

      {bestRank ? (
        <Text style={styles.rank} numberOfLines={1}>
          {he.seasonShareRank(bestRank.rank, me.ranks.of, bestRank.what)}
        </Text>
      ) : null}

      {/* Titles only when there are any. An empty trophy row on a card someone
          is about to send is worse than a shorter card. */}
      {model.myTitles.length > 0 ? (
        <View style={styles.titles}>
          {model.myTitles.map((t) => (
            <Text key={t.key} style={styles.title} numberOfLines={1}>
              🏆 {he.seasonTitleNames[t.key]} ·{' '}
              {he.seasonTitleValue(t.key, t.value)}
            </Text>
          ))}
        </View>
      ) : null}

      {/* The people of the season — the half of this screen a person actually
          talks about, and none of it used to leave the app. */}
      {model.me.partner ? (
        <Text style={styles.peer} numberOfLines={1}>
          {he.seasonSharePartner(
            model.names[model.me.partner.userId] ?? '—',
            model.me.partner.count,
          )}
        </Text>
      ) : null}
      {model.me.nemesis ? (
        <Text style={styles.peer} numberOfLines={1}>
          {he.seasonShareNemesis(
            model.names[model.me.nemesis.userId] ?? '—',
            model.me.nemesis.count,
          )}
        </Text>
      ) : null}

      <Text style={styles.brand}>Teamder</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: SHARE_CARD_WIDTH,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  club: {
    ...typography.h3,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  season: {
    ...typography.caption,
    color: colors.primary,
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  big: { flex: 1, gap: 2 },
  bigValue: {
    ...typography.h2,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    fontVariant: ['tabular-nums'],
  },
  bigLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    fontSize: 11,
  },
  rank: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.sm,
  },
  peer: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  titles: { gap: 2, marginTop: spacing.sm },
  title: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  brand: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.sm,
    fontSize: 10,
  },
});
