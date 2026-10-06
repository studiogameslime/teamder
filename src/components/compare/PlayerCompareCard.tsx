// The shareable pair card — the screen, flattened into one image.
//
// A share is a promise: whoever opens the PNG should recognise the screen it
// came from. This card used to break that promise. It was written before the
// unified pair screen and kept its own look — a flat navy header, pale rings,
// "אתה"/"יריב" chips, a green tick on the winner, and a metrics table whose
// label sat BETWEEN the two values instead of above the bar. Side by side with
// the screen it read as a different product.
//
// So it now borrows the screen's vocabulary rather than inventing its own:
// the same stadium photograph and scrims, the same ring treatment, the same
// VS disc, the same rank row with no bar, the same comparison rows with the
// value outweighing its label, and the same rule that a winner is marked by
// WEIGHT, never by recolouring a value out of its owner's colour.
//
// It also takes the screen's own model now. The adapter that used to sit
// between them existed only to reshape this card's older type, and every
// field it had to invent — a null turned into a zero, a club name it could
// not carry — was a chance for the card and the screen to disagree. One
// model, one answer.
//
// forwardRef so the screen can captureRef → PNG → share, the same flow the
// evening summary uses.

import React, { forwardRef } from 'react';
import {
  Image,
  ImageBackground,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { UserAvatar } from '@/components/UserAvatar';
import { iso } from '@/i18n/he';
import { he } from '@/i18n/he';
import type { CompareRow, PairCompareModel } from '@/services/pairCompareService';

/** The screen's own stadium. The same file, so the two cannot drift apart. */
const STADIUM_BG: ImageSourcePropType = require('../../assets/images/pair-stadium-bg.png');

// The screen's palette, copied by value rather than imported from it: a
// component must not depend on a screen. The comment is the contract — if one
// of these changes there, it changes here.
const BLUE = '#2563EB';
const RED = '#DC2626';
const RED_SOFT = '#FEE2E2';

const C = {
  bg: '#F4F6F9',
  card: '#FFFFFF',
  ink: '#101828',
  muted: '#667085',
  track: '#EDF1F7',
  tint: '#F6F8FC',
};

function fmt(v: number | null, format: CompareRow['format']): string {
  if (v === null) return '—';
  if (format === 'pct') return `${v}%`;
  if (format === 'avg1') return v.toFixed(1);
  return String(v);
}

/**
 * One comparison row, laid out exactly as the screen lays it out.
 *
 * The other player is written FIRST so that under `forceRTL` he lands on the
 * visual RIGHT — the same inversion the screen documents at the top of its
 * file, and the reason the source reads backwards.
 */
function CompareBar({ row }: { row: CompareRow }) {
  const av = row.a ?? 0;
  const bv = row.b ?? 0;
  const total = av + bv;
  const aShare = total > 0 ? av / total : 0;
  const known = row.a !== null && row.b !== null;
  const aWins = known && av > bv && total > 0;
  const bWins = known && bv > av && total > 0;

  return (
    <View style={s.cmpRow}>
      <Text style={[s.cmpValue, s.cmpValueB, bWins && s.cmpWin]}>
        {fmt(row.b, row.format)}
      </Text>
      <View style={s.cmpMid}>
        <Text style={s.cmpLabel} numberOfLines={1}>
          {row.label}
        </Text>
        <View style={s.cmpTrack}>
          {total > 0 ? (
            <>
              <View
                style={[
                  s.cmpFill,
                  { width: `${(1 - aShare) * 100}%`, backgroundColor: RED_SOFT },
                ]}
              />
              <View
                style={[s.cmpFill, { width: `${aShare * 100}%`, backgroundColor: BLUE }]}
              />
            </>
          ) : null}
        </View>
      </View>
      <Text style={[s.cmpValue, s.cmpValueA, aWins && s.cmpWin]}>
        {fmt(row.a, row.format)}
      </Text>
    </View>
  );
}

function HeroSide({
  side,
  tint,
}: {
  side: PairCompareModel['a'];
  tint: string;
}) {
  return (
    <View style={s.heroSide}>
      <View style={[s.heroRing, { borderColor: tint }]}>
        <UserAvatar
          user={{
            id: side.uid,
            name: side.name,
            avatarId: side.avatarId,
            photoUrl: side.photoUrl,
          }}
          size={68}
        />
      </View>
      <Text style={s.heroName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {side.name}
      </Text>
    </View>
  );
}

export const PlayerCompareCard = forwardRef<
  View,
  {
    model: PairCompareModel;
    /**
     * Which slice the numbers are from, in the season bar's own words.
     *
     * A shared image outlives the screen it came from, and "23 גולים" means
     * nothing without the window it was counted in. Absent for the 210 clubs
     * that run no seasons, where there is only one window and naming it would
     * be noise.
     */
    scopeLabel?: string;
  }
>(function PlayerCompareCard({ model, scopeLabel }, ref) {
  const { a, b, verdict, rankA, rankB, rankTotal } = model;
  // A row neither player has a value for says nothing on an image with no
  // room to explain itself. (The screen can say "did not play"; a PNG can't.)
  const rows = model.comparison.filter((r) => r.a !== null || r.b !== null);

  const tie = verdict.leader === 'tie';
  const youLead = verdict.leader === 'a';
  const leadCount = youLead ? verdict.aLeads : verdict.bLeads;

  return (
    <View ref={ref} collapsable={false} style={s.card}>
      {/* ── hero: the screen's, verbatim ── */}
      <ImageBackground source={STADIUM_BG} style={s.hero} resizeMode="cover">
        <LinearGradient
          colors={['rgba(5,16,40,0.58)', 'rgba(5,16,40,0.12)', 'rgba(5,16,40,0.00)']}
          locations={[0, 0.45, 1]}
          style={s.scrimTop}
          pointerEvents="none"
        />
        <LinearGradient
          colors={['rgba(5,16,40,0.00)', 'rgba(5,16,40,0.52)']}
          style={s.scrimBottom}
          pointerEvents="none"
        />

        <View style={s.heroBar}>
          {/* Club first → visual RIGHT, where the screen's title sits. The
              brand closes the row on the left, as a mark rather than a title. */}
          <Text style={s.heroClub} numberOfLines={1}>
            {model.club.name}
          </Text>
          <Text style={s.brand}>Teamder</Text>
        </View>

        <View style={s.heroPair}>
          {/* OTHER player first → visual RIGHT, red. */}
          <HeroSide side={b} tint={RED} />
          <View style={s.vsWrap}>
            <View style={s.vsDisc} />
            <Text style={s.vs}>VS</Text>
          </View>
          <HeroSide side={a} tint={BLUE} />
        </View>

        {scopeLabel ? (
          <View style={s.scopeWrap}>
            <Text style={s.scope}>{scopeLabel}</Text>
          </View>
        ) : null}
      </ImageBackground>

      {/* ── the headline ── */}
      <View style={s.verdict}>
        <Text style={s.verdictTop}>
          {/* `iso` keeps a Latin name from dragging the crown to the far side
              of the line — the one place on this card a mixed-name pair
              showed it. */}
          {tie ? 'שקול 🤝' : youLead ? 'אתה מוביל 👑' : `${iso(b.name)} מוביל 👑`}
        </Text>
        <Text style={s.verdictSub}>
          {tie
            ? `כל אחד מוביל ב-${verdict.aLeads} מתוך ${verdict.total} קטגוריות`
            : `ב-${leadCount} מתוך ${verdict.total} קטגוריות במועדון`}
        </Text>
      </View>

      {/* ── the comparison, as the screen draws it ── */}
      <View style={s.panel}>
        <View style={s.sectionHead}>
          <Ionicons name="bar-chart" size={17} color={BLUE} />
          <Text style={s.sectionTitle}>{he.pairCompareTitle}</Text>
        </View>

        {/* Rank leads and carries NO bar: a position is not a quantity, and a
            proportional bar would draw #1 with the shorter stripe. */}
        {rankA != null && rankB != null ? (
          <View style={s.rankRow}>
            <View style={s.rankSide}>
              <Text
                style={[s.rankValue, { color: RED }, rankB < rankA && s.cmpWin]}
              >{`#${rankB}`}</Text>
            </View>
            <View style={s.rankMid}>
              <Ionicons name="trophy" size={14} color={C.muted} />
              <Text style={s.rankLabel}>{he.pairRankLabelShort}</Text>
              <Text style={s.rankOf}>{he.pairRankOf(rankTotal)}</Text>
            </View>
            <View style={s.rankSide}>
              <Text
                style={[s.rankValue, { color: BLUE }, rankA < rankB && s.cmpWin]}
              >{`#${rankA}`}</Text>
            </View>
          </View>
        ) : null}

        {rows.map((r) => (
          <CompareBar key={r.key} row={r} />
        ))}
      </View>
    </View>
  );
});

const s = StyleSheet.create({
  card: { backgroundColor: C.bg, borderRadius: 22, overflow: 'hidden' },

  // ── hero ──
  hero: { backgroundColor: '#0B1B3A', paddingBottom: 12 },
  scrimTop: { position: 'absolute', left: 0, right: 0, top: 0, height: 110 },
  scrimBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 96 },
  heroBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 8,
  },
  heroClub: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'right',
    textShadowColor: 'rgba(5,16,40,0.55)',
    textShadowRadius: 6,
  },
  brand: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
    backgroundColor: 'rgba(10,22,48,0.34)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 99,
    overflow: 'hidden',
  },
  heroPair: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  heroSide: { alignItems: 'center', gap: 7, width: 104 },
  heroRing: {
    borderWidth: 3,
    borderRadius: 999,
    padding: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  heroName: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    textShadowColor: 'rgba(5,16,40,0.6)',
    textShadowRadius: 6,
  },
  vsWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  vsDisc: {
    ...StyleSheet.absoluteFillObject,
    margin: -9,
    borderRadius: 999,
    backgroundColor: 'rgba(37,99,235,0.30)',
  },
  vs: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1.4,
    textShadowColor: 'rgba(5,16,40,0.7)',
    textShadowRadius: 8,
  },
  scopeWrap: { alignItems: 'center' },
  scope: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#FFFFFF',
    backgroundColor: 'rgba(10,22,48,0.42)',
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 99,
    overflow: 'hidden',
  },

  // ── headline ──
  verdict: { alignItems: 'center', paddingTop: 14, paddingBottom: 4, gap: 2 },
  verdictTop: { fontSize: 22, fontWeight: '900', color: C.ink, textAlign: 'center' },
  verdictSub: { fontSize: 12.5, fontWeight: '600', color: C.muted },

  // ── comparison panel ──
  panel: {
    backgroundColor: C.card,
    borderRadius: 20,
    margin: 12,
    padding: 14,
    gap: 12,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { flex: 1, fontSize: 16.5, fontWeight: '800', color: C.ink, textAlign: 'left' },

  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.tint,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rankSide: { flex: 1, alignItems: 'center', gap: 1 },
  rankValue: { fontSize: 23, fontWeight: '900', fontVariant: ['tabular-nums'] },
  rankMid: { alignItems: 'center', gap: 1, paddingHorizontal: 8 },
  rankLabel: { fontSize: 12.5, fontWeight: '700', color: C.muted },
  rankOf: { fontSize: 11.5, color: C.muted },

  cmpRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  cmpMid: { flex: 1, minWidth: 0, gap: 5, alignItems: 'center' },
  cmpLabel: { fontSize: 12.5, color: C.muted, fontWeight: '600' },
  cmpTrack: {
    width: '100%',
    height: 5,
    borderRadius: 3,
    backgroundColor: C.track,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  cmpFill: { height: 5 },
  // The values outweigh the label beside them, and a winner is marked by
  // WEIGHT — recolouring it green would take the value out of its owner's
  // colour, which is the one thing that stays constant across the card.
  cmpValue: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 48 },
  cmpValueA: { color: BLUE, textAlign: 'right' },
  cmpValueB: { color: RED, textAlign: 'left' },
  cmpWin: { fontWeight: '900' },
});
