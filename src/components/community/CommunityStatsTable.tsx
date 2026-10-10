import { ReorderMotion } from '@/components/anim/ChangeMotion';
// CommunityStatsTable — the club's cumulative per-player stats table, shown in
// community details. One row per player: גולים · משחקים · ניצחונות · הפסדים ·
// בישולים, accumulated over the player's whole time in the club (never resets).
// Ranked by goals.
//
// There are more columns than fit a phone, so the NAME column is fixed on the
// right and the stat columns scroll horizontally as one unit (header + rows
// together). Avatar + name open the player's card.

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { userService } from '@/services';
import { compareByThen, type ChampionshipRow } from '@/utils/championship';
import { compareEveningScores, formatEveningScore } from '@/utils/eveningScoreColumn';
import {
  toEfficiencyRow,
  sortEfficiency,
  formatPct,
  formatPerGame,
  type EfficiencyRow,
  type EfficiencySortKey,
  minRoundsForRanking,
  eligibleForRanking,
} from '@/utils/efficiencyStats';
import { RTL_LABEL_ALIGN, clubAccent, clubSurface, colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import type { User } from '@/types';

type Resolved = Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;
const MEDALS = ['#F4B73E', '#9AA4B2', '#CD7F32']; // gold / silver / bronze
const ROW_H = 56;
const HEADER_H = 34;
const STAT_W = 66;
// The efficiency labels are whole phrases — "בישולים/משחק" against "גולים" —
// and at 66 they truncate to "בישולים/מ…" and run into the next column. Wider
// only in that mode, so the cumulative table keeps the density it was tuned
// for and fits one more column on screen before scrolling.
const STAT_W_EFF = 104;
// Wide enough for a real first name (e.g. "מקסימיליאן", ~10 chars) to show in
// full next to the 30px avatar without clipping to "מקסימילי…". After the
// avatar (30) + horizontal padding/gap (~30) the name gets the remaining ~140,
// enough for the longest real Hebrew first names. The stat grid to the left
// scrolls, so a wider name column costs nothing but viewport width.
const NAME_W = 172;

function firstName(name: string): string {
  const t = (name || '').trim().split(/\s+/)[0];
  return t || name || '';
}

export function CommunityStatsTable({
  players,
  groupId,
  limit = 30,
  /** Drop the "הופעות" (evenings attended) column — the per-game table reuses
   *  this table but appearances are meaningless for a single game. */
  hideAppearances = false,
  /** Authoritative "הופעות" per uid (finished-nights scan from
   *  getCommunityStats). When given, it OVERRIDES the drift-prone
   *  `communityPlayerStats.games` rollup for the appearances column. */
  attendedByUser,
  /** Guest roster-id → name. Rows whose uid is here resolve to that name (no
   *  /users fetch) and open no player card. Used by the per-game table. */
  guestNames,
  eveningScores,
  /** uid → the name a CLOSED season froze, used only where /users has no
   *  answer. A player who deleted their account or left the club still played
   *  that season and still holds their row in it; without this their name goes
   *  to "—" and the season stops being readable. Unlike `guestNames` this does
   *  not short-circuit the lookup — a player who IS still around keeps their
   *  live name, their avatar and their card. */
  fallbackNames,
  /** The club's own mini-game total, used ONLY by the efficiency tab to drop
   *  players with too small a sample to rate. Omit to rate everyone. */
  clubRounds,
  /** Evenings (מחזורים) the club HELD in the scope these rows belong to — the
   *  denominator of the efficiency tab's attendance column, and nothing else.
   *  It must come from the same scope as the rows: a season's rows over a
   *  lifetime evening count turns every regular into an occasional visitor.
   *  Omit it and the column is not shown at all, rather than shown as a
   *  column of dashes. */
  clubEvenings,
  /** 'cumulative' is the table as it has always been — totals, ranked by wins.
   *  'efficiency' shows per-game rates over the SAME rows and the same
   *  chrome: identical name column, medals, row heights and header-tap
   *  sorting. Deliberately one component, so the two can never drift apart
   *  visually. */
  mode = 'cumulative',
}: {
  players: ChampionshipRow[];
  groupId?: string;
  limit?: number;
  hideAppearances?: boolean;
  attendedByUser?: Record<string, number>;
  guestNames?: Record<string, string>;
  /** Opt-in for the single-evening table only. Missing is not zero. */
  eveningScores?: Record<string, number>;
  fallbackNames?: Record<string, string>;
  clubRounds?: number;
  clubEvenings?: number;
  mode?: 'cumulative' | 'efficiency';
}) {
  const nav = useNavigation<{ navigate: (s: string, p: object) => void }>();
  const [people, setPeople] = useState<Record<string, Resolved>>({});
  // Rows showing a season's frozen name because /users had no answer — most
  // likely a player who has left. Their card would open on nothing.
  const [nameOnly, setNameOnly] = useState<Set<string>>(new Set());
  // A single evening defaults to its rating; ordinary club tables retain wins.
  // Depend on column availability, not the map identity: an async score update
  // must not overwrite a column the viewer has already chosen.
  const defaultSortKey = mode === 'efficiency' ? 'gaPerGame'
    : eveningScores !== undefined ? 'eveningScore' : 'wins';
  const [sortKey, setSortKey] = useState<string>(defaultSortKey);
  // Switching tabs must not carry a column that does not exist on the other
  // side — 'wins' means nothing to the efficiency grid and vice versa.
  useEffect(() => {
    setSortKey(defaultSortKey);
  }, [defaultSortKey]);
  // Replace the rollup `games` with the authoritative scan count when provided.
  const effPlayers = React.useMemo(
    () =>
      attendedByUser
        ? players.map((p) => ({ ...p, games: attendedByUser[p.uid] ?? p.games }))
        : players,
    [players, attendedByUser],
  );
  // Sort by the chosen column (desc), THEN slice — so the top-N reflects the
  // active sort. Ties resolve through the shared club comparator rather than
  // through the incoming order; see the note on the sort itself.
  /** Per-game rates, keyed by uid. Built for both modes so the efficiency
   *  sort can run without re-deriving on every comparison. */
  const efficiency = React.useMemo(() => {
    const map: Record<string, EfficiencyRow> = {};
    for (const p of effPlayers) map[p.uid] = toEfficiencyRow(p, clubEvenings);
    return map;
  }, [effPlayers, clubEvenings]);

  // No evening count for the scope on screen → no attendance column. A column
  // of dashes reads as data the club has lost, which is the opposite of true:
  // it is this screen that has nothing to divide by. Declared up here because
  // the SORT needs it too: the column can vanish under an active sort when the
  // caller changes scope.
  const showAttendance = typeof clubEvenings === 'number' && clubEvenings > 0;

  // The efficiency tab's entry bar — a tenth of the club's mini-games. The
  // reasoning, and the never-empty rule, live with the rates in
  // @/utils/efficiencyStats, where they are unit-tested.
  const minRounds = minRoundsForRanking(clubRounds);
  const ranked = React.useMemo(
    () => (mode === 'efficiency' ? eligibleForRanking(effPlayers, clubRounds) : effPlayers),
    [effPlayers, mode, clubRounds],
  );
  /** True when the bar actually removed somebody, so the note can say so. */
  const hiddenByBar = effPlayers.length - ranked.length;

  const rows = React.useMemo(() => {
    if (mode === 'efficiency') {
      // Sorted on the efficiency rows — which put unrankable players last
      // rather than calling them zero — then mapped back, because the name
      // column still renders from the championship row.
      // Sorting by a column that is no longer rendered orders the table by
      // nothing (every value is null) and leaves no header highlighted. The
      // attendance column is the one that can disappear under an active sort —
      // the caller drops its evening count when the scope changes — so fall
      // back to the tab's default rather than to a silent no-op.
      const key: EfficiencySortKey =
        sortKey === 'attendancePct' && !showAttendance
          ? 'gaPerGame'
          : (sortKey as EfficiencySortKey);
      const order = sortEfficiency(
        ranked.map((p) => efficiency[p.uid]),
        key,
      );
      const byUid: Record<string, ChampionshipRow> = {};
      for (const p of ranked) byUid[p.uid] = p;
      return order.map((e) => byUid[e.uid]).slice(0, limit);
    }
    // Ties fall back to the CLUB ORDER, not to the order the rows arrived in.
    //
    // The old sort relied on V8's stability plus an assumption written in the
    // comment above: that the incoming rows are "itself wins→goals ranked".
    // True for a live slice, which comes straight from `buildChampionshipRows`
    // — and false for an all-time one, which comes from `mergeAllTime` in
    // map-insertion order. Two players level on wins could therefore sit one
    // way round here and the other way round on the two-player screen, each
    // telling the reader a different position for the same person.
    //
    // `compareByThen` keeps the tapped column as the primary key — the ranking
    // METHOD is unchanged — and resolves equal values through the one shared
    // comparator.
    return [...effPlayers]
      .sort(sortKey === 'eveningScore' && eveningScores
        ? compareEveningScores(eveningScores)
        : compareByThen(sortKey as keyof ChampionshipRow))
      .slice(0, limit);
  }, [effPlayers, ranked, efficiency, sortKey, limit, mode, showAttendance, eveningScores]);

  useEffect(() => {
    let alive = true;
    // Guests have no /users doc — resolve their name straight from guestNames
    // and only fetch the real uids from userService.
    Promise.all(
      rows.map((r) =>
        guestNames?.[r.uid]
          ? Promise.resolve(null)
          : userService.getUserById(r.uid).catch(() => null),
      ),
    ).then((fetched) => {
      if (!alive) return;
      const map: Record<string, Resolved> = {};
      const frozen = new Set<string>();
      fetched.forEach((u) => {
        if (u) map[u.id] = u;
      });
      // Synthetic entries for guest rows (name only; UserAvatar falls back to
      // initials, and openCard is disabled for them below).
      for (const r of rows) {
        const gn = guestNames?.[r.uid];
        if (gn) map[r.uid] = { id: r.uid, name: gn, avatarId: '', photoUrl: '' };
        // Only where the live lookup came back with nothing.
        else if (!map[r.uid] && fallbackNames?.[r.uid]) {
          map[r.uid] = {
            id: r.uid,
            name: fallbackNames[r.uid],
            avatarId: '',
            photoUrl: '',
          };
          frozen.add(r.uid);
        }
      }
      setPeople(map);
      setNameOnly(frozen);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, guestNames, fallbackNames]);

  // Hoisted above the guard below. `rows` starts empty and is filled by the
  // effect above, so the FIRST render returns null here and the second one
  // reaches this `useMemo` — a different hook count on consecutive renders,
  // which React answers by tearing the tree down. Same defect as SeasonsCard,
  // same production signature: "Rendered more hooks than during the previous
  // render". Nothing about the memo depends on the guard.
  const anyTies = useMemo(() => players.some((p) => (p.ties ?? 0) > 0), [players]);

  if (rows.length === 0) return null;

  const openCard = (uid: string) => {
    // Guests have no player card — their row is a name label only. Neither
    // does a player /users could not resolve: the card would open on nothing.
    if (guestNames?.[uid]) return;
    if (nameOnly.has(uid)) return;
    nav.navigate('PlayerCard', groupId ? { userId: uid, groupId } : { userId: uid });
  };

  // Goals first (the ranking metric → visible without scrolling), then the
  // rest. Scroll the strip to reveal the others.
  // Mini-games (rounds), NOT evenings, as the "played" count — so it shares a
  // unit with wins/losses (you can't win more rounds than you played). An
  // Column order (RTL, right→left, next to the name column): wins → goals →
  // assists → then the outcomes/counts (losses → appearances → mini-games).
  // Wins lead — it's the headline stat the owner wants read first — followed by
  // the two point sources (goals, assists).
  type Col = {
    key: string;
    label: string;
    cell: (r: ChampionshipRow) => string;
    /** The reference gives each column its own hue; a wall of one blue reads
     *  as one number repeated. Falls back to the primary. */
    tint?: string;
  };
  // One hue per kind of thing counted: goals and wins in the club's blue,
  // assists in the assist purple used by the leaders and the fun bars, the
  // per-game averages in amber. Columns not listed keep the default.
  // Blue for the columns the table is actually about, red for the one negative
  // column, and a neutral dark for the rest. A hue per column made the row a
  // row of unrelated colours; the tint has to mean something or be absent.
  const COL_TINT: Record<string, string> = {
    wins: clubAccent.blue,
    goals: clubAccent.blue,
    assists: clubAccent.blue,
    losses: clubAccent.red,
    ties: '#334155',
    cleanSheets: '#334155',
    games: '#334155',
    rounds: '#334155',
  };
  const cumulativeCols: Col[] = ([
    { key: 'wins', label: he.champColWins, primary: true },
    { key: 'goals', label: he.champColGoals },
    { key: 'assists', label: he.champColAssists },
    // Draws sit between wins and losses — the three outcomes of a mini-game,
    // in the order they rank. Hidden entirely when nobody has one; see below.
    { key: 'ties', label: he.champColTies },
    { key: 'losses', label: he.champColLosses },
    // "שער נקי" — mini-games the player's side finished without conceding.
    // A counter like the rest (no percentage), and it sorts by tapping the
    // header exactly like every other column.
    { key: 'cleanSheets', label: he.champColCleanSheets },
    { key: 'games', label: he.champColAppearances }, // evenings attended
    { key: 'rounds', label: he.champColMiniGames }, // mini-games played
  ] as Array<{ key: keyof ChampionshipRow; label: string }>).map((c) => ({
    key: c.key as string,
    label: c.label,
    cell: (r: ChampionshipRow) => String(r[c.key] ?? 0),
    tint: COL_TINT[c.key as string],
  }));

  // Right-to-left after the name column, in the order asked for. Under
  // forceRTL the first child lands rightmost, so array order IS reading order.
  //
  // Attendance sits second, right after the win rate: the owner asked for the
  // two percentages together ("אחוז נצחונות / אחוז הגעה למחזור"), and it is
  // the only column here counted in EVENINGS rather than mini-games — it
  // belongs next to the other whole-club share, not lost among the per-משחקון
  // averages.
  if (eveningScores) cumulativeCols.unshift({ key: 'eveningScore', label: 'ציון',
    cell: r => formatEveningScore(eveningScores[r.uid]), tint: clubAccent.blue });
  const efficiencyCols: Col[] = [
    { key: 'winPct', label: he.effColWinPct,
      cell: (r) => formatPct(efficiency[r.uid]?.winPct ?? null) },
    // Shown only when the caller could give an evening count for this scope;
    // see `clubEvenings`. Filtered out below rather than rendered as dashes.
    { key: 'attendancePct', label: he.effColAttendancePct,
      cell: (r) => formatPct(efficiency[r.uid]?.attendancePct ?? null) },
    { key: 'goalsPerGame', label: he.effColGoalsPerGame,
      cell: (r) => formatPerGame(efficiency[r.uid]?.goalsPerGame ?? null) },
    { key: 'assistsPerGame', label: he.effColAssistsPerGame,
      cell: (r) => formatPerGame(efficiency[r.uid]?.assistsPerGame ?? null) },
    { key: 'gaPerGame', label: he.effColGaPerGame,
      cell: (r) => formatPerGame(efficiency[r.uid]?.gaPerGame ?? null) },
    { key: 'cleanSheetPct', label: he.effColCleanSheetPct,
      cell: (r) => formatPct(efficiency[r.uid]?.cleanSheetPct ?? null) },
    { key: 'rounds', label: he.effColRounds,
      cell: (r) => String(r.rounds ?? 0) },
  ];
  // A draw is only reachable in a four-team-and-up format: with three teams
  // the loser rotates out and every mini-game has a winner. A club that plays
  // three teams would carry a column of zeros forever, so the column shows
  // itself only once somebody actually has a draw. (The rule is "anyone", not
  // "this player" — a column that appears and disappears as you scroll would
  // be worse than either.)
  const statW = mode === 'efficiency' ? STAT_W_EFF : STAT_W;
  const cols =
    mode === 'efficiency'
      ? efficiencyCols.filter((c) => showAttendance || c.key !== 'attendancePct')
      : cumulativeCols.filter(
          (c) =>
            !(hideAppearances && c.key === 'games') &&
            !(c.key === 'ties' && !anyTies),
        );

  return (
    <Card style={styles.table}>
      <View style={styles.split}>
        {/* Fixed name column (lands on the RIGHT under forceRTL). */}
        <View style={styles.nameCol}>
          <View style={styles.headerCell}>
            <Text style={styles.headerRank}>#</Text>
            <Text style={styles.headerWho}>{he.champColPlayer}</Text>
          </View>
          {rows.map((r, i) => {
            const p = people[r.uid];
            return (
              <ReorderMotion key={r.uid} index={i} rowHeight={ROW_H}>
              <Pressable
                style={styles.nameCell}
                onPress={() => openCard(r.uid)}
                accessibilityRole="button"
                accessibilityLabel={p?.name ?? ''}
              >
                <Text style={styles.rank}>{i + 1}</Text>
                <View
                  style={[
                    styles.avatarWrap,
                    i < 3 && { borderColor: MEDALS[i], borderWidth: 2 },
                  ]}
                >
                  <UserAvatar user={p ?? { id: r.uid, name: '' }} size={30} />
                </View>
                <Text style={styles.name} numberOfLines={1}>
                  {p ? firstName(p.name) : '—'}
                </Text>
              </Pressable>
              </ReorderMotion>
            );
          })}
        </View>

        {/* Scrollable stat grid (header + rows scroll together). */}
        <ScrollView horizontal showsHorizontalScrollIndicator style={styles.scroll}>
          <View>
            <View style={[styles.gridRow, styles.headerGridRow, { height: HEADER_H }]}>
              {cols.map((c) => {
                const active = c.key === sortKey;
                return (
                  <Pressable
                    key={c.key}
                    onPress={() => setSortKey(c.key)}
                    style={[styles.headerHit, { width: statW }]}
                    accessibilityRole="button"
                    accessibilityLabel={c.label}
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.statHeader,
                        { width: statW },
                        active && styles.primaryHeader,
                      ]}
                    >
                      {active ? `${c.label} ▾` : c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {rows.map((r, i) => (
              <ReorderMotion key={r.uid} index={i} rowHeight={ROW_H} style={[styles.gridRow, styles.dataRow]}>
                {cols.map((c) => (
                  <Text
                    key={c.key}
                    style={[
                      styles.statCell,
                      { width: statW, color: c.tint ?? clubAccent.blue },
                      c.key === sortKey && styles.primaryCell,
                    ]}
                  >
                    {c.cell(r)}
                  </Text>
                ))}
              </ReorderMotion>
            ))}
          </View>
        </ScrollView>
      </View>
      {/* Who is missing, and why. Without this a player who came twice looks
          for themselves, does not find themselves, and reads it as the club
          losing their stats. */}
      {mode === 'efficiency' && hiddenByBar > 0 ? (
        <Text style={styles.barNote}>{he.effMinRoundsNote(minRounds, hiddenByBar)}</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  table: { padding: 0, overflow: 'hidden', borderWidth: 1, borderColor: clubSurface.border },
  barNote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    lineHeight: 17,
  },
  split: { flexDirection: 'row' },
  nameCol: {
    width: NAME_W,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
    backgroundColor: colors.surface,
    zIndex: 2,
  },
  scroll: { flex: 1 },
  // A tinted strip, as in the reference — the column labels were hairline-grey
  // on white and read as a first data row.
  headerCell: {
    height: HEADER_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: '#E8EEF8',
  },
  headerRank: {
    width: 18,
    fontSize: 11,
    fontWeight: '800',
    color: '#4B5878',
    textAlign: 'center',
  },
  rank: {
    width: 18,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  headerWho: { flex: 1, ...typography.caption, color: '#4B5878', fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  nameCell: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: clubSurface.divider,
  },
  avatarWrap: { borderRadius: 99, padding: 1.5, borderColor: 'transparent', borderWidth: 2 },
  name: { flex: 1, minWidth: 0, ...typography.body, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  gridRow: { flexDirection: 'row', alignItems: 'center' },
  headerGridRow: { backgroundColor: '#E8EEF8' },
  dataRow: { height: ROW_H, borderTopWidth: 1, borderTopColor: clubSurface.divider },
  headerHit: { width: STAT_W, height: '100%', justifyContent: 'center' },
  statHeader: {
    width: STAT_W,
    ...typography.caption,
    fontSize: 11,
    color: '#4B5878',
    fontWeight: '800',
    textAlign: 'center',
  },
  primaryHeader: { color: colors.primary, fontWeight: '800' },
  statCell: {
    width: STAT_W,
    ...typography.body,
    color: colors.primary,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  // The sorted column keeps its own hue and gains weight — recolouring it to
  // the brand blue erased the per-column tint on whichever column you sorted.
  primaryCell: { fontWeight: '900' },
});
