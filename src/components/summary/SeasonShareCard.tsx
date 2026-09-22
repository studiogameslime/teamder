// The season, on one card, small enough to send to somebody.
//
// The screen it lives on scrolls for a page and a half — twelve stat tiles, six
// people, a champions list — and none of that survives being sent to a WhatsApp
// group. A share card is a different job from a summary screen: pick the
// numbers a person would actually say out loud, put the titles they won beside
// them, and stop.
//
// Which numbers those are depends on the club. Everything except ערבי משחק is
// counted inside the advanced live screen's משחקונים, and a club that runs on
// the plain timer never opens it: 23 of the 87 stat rows in production have
// evenings and not one mini-game. Printing the mini-game set regardless gave
// those players a card of eight zeros and a dash to send to their group, while
// the screen behind it said they turned up fourteen times.
//
// Rendered off-screen at a fixed width so the capture is the same on every
// phone. Nothing here is interactive; it exists to be turned into a PNG.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import type { SeasonSummaryModel } from '@/services/seasonSummaryService';
import { seasonTitleIcon, seasonTitleTint } from '@/utils/seasonTitleIcon';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

/** Fixed, so the image is identical from a small phone and a large one. */
export const SHARE_CARD_WIDTH = 340;

/** Three to a row. At four the tiles were 72pt wide, which is where a 100% and
 *  a two-word label started colliding; three leaves ~98pt and lets the
 *  timer-only club's short row fill the card instead of trailing off. */
const PER_ROW = 3;

/** Below this a "top three" says more about the club than about the player. */
const MIN_CLUB_FOR_PODIUM = 8;

function Big({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.big}>
      {/* allowFontScaling off, everywhere on this card.
          The card is a fixed 340pt rendered OFF-SCREEN and turned straight into
          a PNG, so the phone's font setting changes the capture and nobody can
          see the result before it is sent: at Android "Largest" a 100% grew out
          of its tile and a 30-character name clipped mid-word. The image is the
          same size on every phone; so is the type on it. */}
      <Text style={styles.bigValue} allowFontScaling={false}>
        {value}
      </Text>
      <Text style={styles.bigLabel} allowFontScaling={false} numberOfLines={2}>
        {label}
      </Text>
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
  /** A placing is only worth sending if it IS one.
   *
   *  bestRank took the numerically lowest of three ranks with no threshold at
   *  all, so a player ranked 27th of 30 in everything had "מקום 27 מתוך 30"
   *  printed in bold on a card they were about to send to the group. Top three,
   *  or the top third of a club big enough for that to mean something.
   *
   *  And the top-three arm needs a club to be top three OF: with `of` at 3 it
   *  put "מקום 3 מתוך 3" in bold — last place, on a card, in the group chat.
   *  Below eight players a podium is not a podium, and the top-third arm still
   *  passes anyone who is genuinely at the front of a small club (1 of 5 is
   *  20%). */
  const worthShowing =
    !!bestRank &&
    me.ranks.of > 1 &&
    ((bestRank.rank <= 3 && me.ranks.of >= MIN_CLUB_FOR_PODIUM) ||
      bestRank.rank / me.ranks.of <= 0.34);

  // ערבי משחק first of the mini-game counters and never conditional: it is the
  // one number every club records, the one the screen behind this card shows,
  // and the unit every season title is judged in. The rest describe משחקונים
  // and are printed only by a club that has any — including אחוז ניצחון, whose
  // denominator is mini-games, which is why it cannot simply be re-pointed at
  // evenings.
  const mini = me.rounds > 0;
  const tiles: Array<{ value: string; label: string }> = [
    { value: String(me.goals), label: he.statGoals },
    { value: String(me.assists), label: he.statAssists },
    { value: String(me.evenings), label: he.seasonStatEvenings },
    ...(mini
      ? [
          { value: String(me.rounds), label: he.seasonStatRounds },
          { value: pct(me.winPct), label: he.seasonStatWinPct },
          { value: String(me.cleanSheets), label: he.seasonStatCleanSheets },
          { value: String(me.wins), label: he.seasonStatWins },
          { value: String(me.losses), label: he.seasonStatLosses },
          { value: String(me.ties), label: he.seasonStatTies },
        ]
      : []),
  ];
  const rows: Array<Array<{ value: string; label: string }>> = [];
  for (let i = 0; i < tiles.length; i += PER_ROW) {
    rows.push(tiles.slice(i, i + PER_ROW));
  }

  return (
    <View style={styles.card}>
      {/* A brand row, like both sibling share cards. This card is the one
          artefact of the feature that leaves the app and is seen by people who
          are not users, and its only branding was a 10px muted wordmark at the
          bottom. */}
      <View style={styles.brandRow}>
        <View style={styles.mark}>
          <Ionicons name="football" size={13} color="#FFFFFF" />
        </View>
        <Text style={styles.brandName} allowFontScaling={false}>
          Teamder
        </Text>
        <Text style={styles.seasonPill} allowFontScaling={false}>
          {he.seasonNumberLabel(model.seasonNo)}
        </Text>
      </View>

      {/* Two lines, not one. A normal Hebrew name plus a club name did not fit
          308pt at 18px, so one of the two was always cut — the same bug already
          fixed on EveningSummaryCard. */}
      {playerName ? (
        <Text style={styles.club} numberOfLines={1} allowFontScaling={false}>
          {playerName}
        </Text>
      ) : null}
      <Text style={styles.season} numberOfLines={1} allowFontScaling={false}>
        {model.groupName}
      </Text>

      {rows.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((t) => (
            <Big key={t.label} value={t.value} label={t.label} />
          ))}
          {/* Keep a short last row on the same grid as the ones above it. */}
          {Array.from({ length: PER_ROW - row.length }, (_, j) => (
            <View key={`pad${j}`} style={styles.big} />
          ))}
        </View>
      ))}

      {worthShowing && bestRank ? (
        <Text style={styles.rank} numberOfLines={1} allowFontScaling={false}>
          {he.seasonShareRank(bestRank.rank, me.ranks.of, bestRank.what)}
        </Text>
      ) : null}

      {/* Titles only when there are any. An empty trophy row on a card someone
          is about to send is worse than a shorter card. */}
      {model.myTitles.length > 0 ? (
        <View style={styles.titles}>
          {model.myTitles.map((t) => (
            <View key={t.key} style={styles.titleRow}>
              {/* Its own mark, the same one every in-app surface draws for this
                  title — and an icon rather than an emoji, because this image
                  lands on strangers' phones where 🏆 is a different shape. */}
              <View
                style={[
                  styles.titleDisc,
                  { backgroundColor: seasonTitleTint(t.key) + '22' },
                ]}
              >
                <Ionicons
                  name={seasonTitleIcon(t.key)}
                  size={12}
                  color={seasonTitleTint(t.key)}
                />
              </View>
              {/* Ties are shared and never broken, and `sharedWith` has been
                  computed all along and thrown away here — so all seven holders
                  of one מלך העונה sent the same exclusive-looking claim into
                  the same group chat within a minute of each other. If the
                  title is shared, the card says so. */}
              <Text
                style={styles.title}
                numberOfLines={2}
                allowFontScaling={false}
              >
                {he.seasonTitleNames[t.key]} ·{' '}
                {he.seasonTitleValue(t.key, t.value)}
                {t.sharedWith > 0
                  ? ` · ${he.seasonTitleSharedWith(t.sharedWith)}`
                  : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* The people of the season — the half of this screen a person actually
          talks about, and none of it used to leave the app. */}
      {model.me.partner ? (
        <Text style={styles.peer} numberOfLines={1} allowFontScaling={false}>
          {he.seasonSharePartner(
            model.names[model.me.partner.userId] ?? '—',
            model.me.partner.count,
          )}
        </Text>
      ) : null}
      {model.me.nemesis ? (
        <Text style={styles.peer} numberOfLines={1} allowFontScaling={false}>
          {he.seasonShareNemesis(
            model.names[model.me.nemesis.userId] ?? '—',
            model.me.nemesis.count,
          )}
        </Text>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: SHARE_CARD_WIDTH,
    backgroundColor: colors.surface,
    borderRadius: 20,
    // An edge. Both sibling share cards have one, and a borderless white
    // rectangle on a white chat background has no shape at all.
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.xs,
  },
  mark: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '800',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  seasonPill: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
    backgroundColor: colors.primary + '14',
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  titleDisc: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
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
    flex: 1,
  },
  brand: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.sm,
    fontSize: 10,
  },
});
