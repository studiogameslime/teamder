// PairCard — one pair's story, in a few seconds.
//
// Takes a club and two player ids and nothing else about WHERE it was opened
// from. V1 only ever opens it from the six chemistry cards, but a future
// "check any two players" screen should be able to mount the same component
// without a rewrite, so it resolves its own numbers from the club rollup it is
// handed rather than being fed a pre-chosen category.
//
// Deliberately short. No chart, no percentage, no chemistry score — those were
// all considered and left out: the pair either has a story in eight numbers or
// it does not have one at all.
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeModal as Modal } from '@/components/SafeModal';

import { UserAvatar } from '@/components/UserAvatar';
import {
  EMPTY_PAIR,
  pairKey,
  pairMembers,
  titlesOf,
  type ChemistryKind,
  type ChemistryPick,
  type PairTotals,
} from '@/utils/clubChemistry';
import { formatDateShort } from '@/utils/format';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export const CHEMISTRY_LABEL: Record<ChemistryKind, string> = {
  winningDuo: he.chemistryWinningDuo,
  regulars: he.chemistryRegulars,
  deadlyDuo: he.chemistryDeadlyDuo,
  wall: he.chemistryWall,
  rivalry: he.chemistryRivalry,
  balancedRivalry: he.chemistryBalanced,
  bestRatio: he.chemistryBestRatio,
  mostLosses: he.chemistryMostLosses,
};

// Rendered AFTER the label, never before: under forceRTL the first thing in a
// string lands on the visual right, and the emoji reads as an icon — reported
// from the club-stats cards.
export const CHEMISTRY_EMOJI: Record<ChemistryKind, string> = {
  winningDuo: '🏆',
  regulars: '🤝',
  deadlyDuo: '🎯',
  wall: '🧱',
  rivalry: '⚔️',
  balancedRivalry: '⚖️',
  bestRatio: '🎯',
  mostLosses: '📉',
};

export interface PairPerson {
  id: string;
  name: string;
  avatarId?: string;
  photoUrl?: string;
}

export interface PairCardProps {
  visible: boolean;
  onClose: () => void;
  /** The two players, in any order — the card sorts them itself. */
  playerAId: string;
  playerBId: string;
  /** The club's rollup, so opening a card costs no extra read. */
  pairs: Record<string, PairTotals>;
  /** The six winners, for the title tags. */
  picks: ChemistryPick[];
  /** Name/photo lookup, already hydrated by the caller. */
  person: (id: string) => PairPerson | null;
  /** When the numbers start. */
  since: number | null;
}

export function PairCard({
  visible,
  onClose,
  playerAId,
  playerBId,
  pairs,
  picks,
  person,
  since,
}: PairCardProps) {
  // Sorted, so opening the same pair "the other way round" is the same card
  // with the same numbers — winsA belongs to whoever sorts first, and reading
  // it against the wrong player is how a head-to-head shows up reversed.
  const key = pairKey(playerAId, playerBId);
  const [aId, bId] = pairMembers(key);
  const t = pairs[key] ?? EMPTY_PAIR;
  // Every title the pair holds, not the first two. A pair that is at once the
  // winning duo, the regulars and the deadly duo was showing two of the three,
  // which reads as a bug in the data rather than a cap in the view — and it was
  // reported as one. There are six kinds in total and the row wraps.
  const titles = useMemo(() => titlesOf(picks, key), [picks, key]);

  const a = person(aId);
  const b = person(bId);
  const aName = a?.name ?? '';
  const bName = b?.name ?? '';
  const assists = t.assistsAToB + t.assistsBToA;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grabber} />

          <View style={styles.head}>
            {a ? <UserAvatar user={{ id: aId, name: aName, avatarId: a.avatarId, photoUrl: a.photoUrl }} size={54} /> : null}
            <Text style={styles.times}>×</Text>
            {b ? <UserAvatar user={{ id: bId, name: bName, avatarId: b.avatarId, photoUrl: b.photoUrl }} size={54} /> : null}
          </View>
          <Text style={styles.names}>{`${aName} × ${bName}`}</Text>

          {titles.length > 0 ? (
            <View style={styles.tags}>
              {titles.map((k) => (
                <View key={k} style={styles.tag}>
                  <Text style={styles.tagText}>
                    {`${CHEMISTRY_LABEL[k]} ${CHEMISTRY_EMOJI[k]}`}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* ── ביחד ── */}
          <Text style={styles.block}>{he.pairCardTogether}</Text>
          <View style={styles.stats}>
            <Stat value={t.sameTeam} label={he.pairCardGames} />
            <Stat value={t.winsTogether} label={he.pairCardWins} />
            <Stat value={t.lossesTogether} label={he.pairCardLosses} />
            <Stat value={t.cleanSheetsTogether} label={he.pairCardCleanSheets} />
          </View>

          {/* ── חיבור התקפי ── */}
          <Text style={styles.block}>{he.pairCardAttack}</Text>
          {assists > 0 ? (
            <>
              <Text style={styles.line}>{he.pairCardAssistsTotal(assists)}</Text>
              {/* One row per direction, each carrying its own share of the
                  total as a bar. The bar is what the old arrow was reaching
                  for — "who feeds whom, and by how much" — and it says it
                  without a glyph that can point the wrong way. */}
              {[
                { from: aName, to: bName, n: t.assistsAToB },
                { from: bName, to: aName, n: t.assistsBToA },
              ]
                .filter((leg) => leg.n > 0)
                .map((leg) => (
                  <View key={leg.from} style={styles.leg}>
                    <View style={styles.legHead}>
                      <Text style={styles.legText} numberOfLines={1}>
                        {he.pairCardAssistLeg(leg.from, leg.to)}
                      </Text>
                      <Text style={styles.legCount}>{leg.n}</Text>
                    </View>
                    {/* Filled from the RIGHT: the first child of a flipped row
                        lands rightmost, so the fill grows the way the line is
                        read. */}
                    <View style={styles.legTrack}>
                      <View
                        style={[
                          styles.legFill,
                          { width: `${Math.round((leg.n / assists) * 100)}%` },
                        ]}
                      />
                    </View>
                  </View>
                ))}
            </>
          ) : (
            <Text style={styles.sub}>{he.pairCardNoAssists}</Text>
          )}

          {/* ── אחד נגד השני ── */}
          <Text style={styles.block}>{he.pairCardHeadToHead}</Text>
          <Text style={styles.line}>
            {t.against > 0
              ? he.pairCardHeadToHeadLine(t.against, aName, t.winsA, t.winsB, bName)
              : he.pairCardNoMeetings}
          </Text>

          {since ? (
            <Text style={styles.since}>{he.chemistrySince(formatDateShort(since))}</Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  times: { fontSize: 20, fontWeight: '800', color: colors.textMuted },
  names: { ...typography.h3, fontWeight: '800', color: colors.text, textAlign: 'center' },
  tags: { flexDirection: 'row', gap: spacing.xs, justifyContent: 'center', flexWrap: 'wrap' },
  tag: {
    backgroundColor: colors.primaryLight,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  tagText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  // ── assist legs ──
  leg: { marginTop: spacing.sm, gap: 5 },
  legHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  legText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  legCount: { fontSize: 15, fontWeight: '900', color: colors.primary },
  legTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.primaryLight,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  legFill: { height: 6, borderRadius: 999, backgroundColor: colors.primary },
  block: {
    ...typography.label,
    fontWeight: '800',
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.md,
  },
  stats: { flexDirection: 'row', gap: spacing.xs },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  statValue: { fontSize: 20, fontWeight: '800', color: colors.primary },
  statLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  line: { ...typography.body, fontWeight: '700', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  sub: { fontSize: 13, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  since: { fontSize: 11, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, marginTop: spacing.md },
});
