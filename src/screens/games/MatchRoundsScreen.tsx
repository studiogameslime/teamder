// MatchRoundsScreen — "היסטוריית המשחקים" for a finished game.
//
// Reached from the finished-game MatchDetails ("היסטוריית המשחקים" CTA).
// Renders one card per committed mini-game (games/{id}/roundHistory):
// the two teams, the score, the winner, the goal log (scorer + assister +
// own-goal) and — when the mini-game was decided on penalties — the shootout
// kicks (kicker → keeper, scored/missed). Pure read/display: all the data is
// already persisted by commitRoundStats. Access is gated to game participants
// (same rule as the evening summary); a denied read degrades to the empty
// state, never a crash.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { ScrollSurface } from '@/components/ScrollSurface';
import { TabScroll } from '@/components/match/tabs/MatchTabShell';
import { UserAvatar } from '@/components/UserAvatar';
import { gameService } from '@/services/gameService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { teamName, type TeamLike } from '@/utils/draft';
import { teamColor } from '@/components/match/rotationView';
import { useGameStore } from '@/store/gameStore';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import {
  isGuestId,
  parseGuestRosterId,
  type DraftTeam,
  type Game,
  type GameGuest,
} from '@/types';
import type {
  RoundHistoryDoc,
  RoundGoalRec,
  RoundPenaltyRec,
} from '@/utils/eveningStats';
import type { GameStackParamList } from '@/navigation/GameStack';

type Params = RouteProp<GameStackParamList, 'MatchRounds'>;

// Colour + name come from the shared team identity, so the recap honours the
// admin's chosen bib colours ("הצהובים נגד הלבנים") instead of always saying
// אדומה/כחולה/ירוקה. Old games (no index, −1) fall back to neutral
// orange/blue + "קבוצה א׳/ב׳".
function teamStyle(
  index: number | undefined,
  side: 'A' | 'B',
  teams?: readonly TeamLike[],
): { color: string; name: string; plural: boolean } {
  if (typeof index === 'number' && index >= 0) {
    // Real team names are a definite plural ("האדומים") — verbs agree.
    return { color: teamColor(index, teams), name: teamName(index, teams), plural: true };
  }
  // Legacy fallback: "קבוצה א׳" is feminine singular, so it needs its own verb.
  return side === 'A'
    ? { color: '#F97316', name: he.matchRoundsTeamA, plural: false }
    : { color: colors.primary, name: he.matchRoundsTeamB, plural: false };
}

/** Old roundHistory docs (pre-teamAIndex) don't record which bib colour each
 *  side was. Reconstruct it by matching the round's roster to the draft split:
 *  the draft team whose players overlap this side the most IS this side's real
 *  team. Returns −1 when there's no split to match against (→ "קבוצה א/ב"). */
function resolveTeamIndex(
  roster: readonly string[] | undefined,
  teams: readonly DraftTeam[] | undefined,
): number {
  if (!teams?.length || !roster?.length) return -1;
  let best = -1;
  let bestOverlap = 0;
  for (const t of teams) {
    const ids = new Set(t.playerIds);
    let overlap = 0;
    for (const id of roster) if (ids.has(id)) overlap++;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = t.index;
    }
  }
  return bestOverlap > 0 ? best : -1;
}

interface Resolved {
  id: string;
  name: string;
  avatarId?: string;
  photoUrl?: string;
}

export interface MatchRoundsScreenProps {
  /**
   * Rendered inside the match screen's "משחקים" tab instead of as a route.
   *
   * Embedded it drops its own SafeAreaView and ScreenHeader — the tab already
   * sits under the match header — and takes the game id from a prop rather
   * than from route params, which do not exist there. Everything else, and in
   * particular `RoundCard` with all of its edge cases, is the same code.
   */
  gameId?: string;
  embedded?: boolean;
  /** Clears the sticky CTA when embedded. */
  bottomInset?: number;
  /** Colour filter chips above the list (the four-tab design). */
  showFilter?: boolean;
  /** Did the evening actually happen? Only used to pick the empty-state copy —
   *  see the comment at `empty`. Undefined behaves as "not played". */
  hasPlayed?: boolean;
  /**
   * Opened from the LIVE screen, while the evening is still running.
   *
   * Changes two things and nothing else: the title and the empty-state copy
   * (an empty list mid-evening is a normal moment, not a missing record), and
   * a refresh on focus so a mini-game committed while this screen sat in the
   * back stack is there when the user returns to it.
   *
   * The LIST itself needs no filtering for this. `roundHistory` is written by
   * `commitRoundStats` and by nothing else, so a round reaches it only when
   * the admin ends it — the running mini-game is not in there, and neither is
   * a future one.
   */
  live?: boolean;
  /** Embedded only: the match screen's hero and tab bar. They ride inside THIS
   *  list's scroll so the hero can leave the screen and the bar can stick —
   *  the same arrangement the other three panes use. */
  header?: React.ReactNode;
  stickyHeader?: React.ReactNode;
}

export function MatchRoundsScreen(props: MatchRoundsScreenProps = {}) {
  const route = useRoute<Params>();
  const gameId = props.gameId ?? route.params?.gameId ?? '';
  const embedded = props.embedded === true;
  const live = props.live ?? route.params?.live === true;
  const players = useGameStore((s) => s.players);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);

  const [game, setGame] = useState<Game | null>(null);
  const [rounds, setRounds] = useState<RoundHistoryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /**
   * Show only the mini-games one team played, or all of them.
   *
   * Filters on the ROUND's own colour indices, which is the only place the
   * pairing is recorded. A round from before `teamAIndex` existed carries -1
   * and belongs to no colour — it stays visible under "הכל" and disappears
   * under any specific filter, which is the honest answer for a round whose
   * teams were never written down.
   */
  const [colourFilter, setColourFilter] = useState<number | null>(null);

  /** Bumped to re-run the loader. Live only — see `live`. */
  const [reloadKey, setReloadKey] = useState(0);
  useFocusEffect(
    React.useCallback(() => {
      // Skip the first focus: the mount effect below is already loading.
      if (!live) return;
      setReloadKey((k) => k + 1);
    }, [live]),
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const [g, rs] = await Promise.all([
        gameService.getGameById(gameId).catch(() => null),
        gameService.getRoundHistory(gameId).catch(() => []),
      ]);
      if (!alive) return;
      setGame(g);
      setRounds(rs);
      logEvent(AnalyticsEvent.MatchRoundsOpened, {
        gameId,
        rounds: rs.length,
        goals: rs.reduce((n, r) => n + (r.goals?.length ?? 0), 0),
      });
      // Hydrate every REAL player id referenced across the rounds so names +
      // avatars resolve (guests come from the game doc, not /users).
      // Round history stores a guest as the PREFIXED roster id (`guest:<id>`).
      // Filter on the PREFIX, not on membership of `game.guests`: a guest who
      // was removed from the roster after the round still leaves their token
      // in the history, and matching by membership sent it to /users as if it
      // were a real uid — a lookup that can only ever miss.
      const ids = new Set<string>();
      for (const r of rs) {
        [...r.teamA, ...r.teamB].forEach((id) => id && ids.add(id));
        for (const gl of r.goals) {
          if (gl.scorerId) ids.add(gl.scorerId);
          if (gl.assisterId) ids.add(gl.assisterId);
        }
        for (const p of r.penalties ?? []) {
          if (p.kickerId) ids.add(p.kickerId);
          if (p.keeperId) ids.add(p.keeperId);
        }
      }
      const realIds = [...ids].filter((id) => !isGuestId(id));
      if (realIds.length) hydratePlayers(realIds);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [gameId, hydratePlayers, reloadKey]);

  const guestsById = useMemo(() => {
    const m = new Map<string, GameGuest>();
    (game?.guests ?? []).forEach((g) => m.set(g.id, g));
    return m;
  }, [game?.guests]);

  const resolve = useMemo(() => {
    return (id: string | null | undefined): Resolved => {
      if (!id) return { id: '', name: he.matchRoundsUnknownPlayer };
      // A guest appears in the round history under the PREFIXED roster id
      // (`guest:<id>`) — the same token draft/teams/live use — while
      // `game.guests` is keyed by the bare id. Strip before looking up.
      // Without this every guest rendered as the "שחקן" placeholder in both
      // the line-ups and the goal rows, which is what 1.0.89 surfaced when
      // guests first started appearing in the recap at all.
      const guest = guestsById.get(parseGuestRosterId(id) ?? id);
      if (guest) return { id, name: guest.name || he.matchRoundsGuest };
      const p = players[id];
      const name = (p?.displayName ?? '').trim();
      return {
        id,
        name: name || he.matchRoundsUnknownPlayer,
        avatarId: p?.avatarId,
        photoUrl: p?.photoUrl,
      };
    };
  }, [players, guestsById]);

  // Distinct teams that took part this cycle — for the legend row under the
  // count. Prefer the authoritative draft split; fall back to whatever indices
  // the rounds recorded (old games with a real index but no draftTeams). −1
  // (index-less legacy rounds) is dropped: there's no colour to show.
  // Same array the rounds below are coloured from — the admin's chosen bibs.
  const splitForColors =
    game?.draftTeams?.originalTeams ?? game?.draftTeams?.teams;
  const cycleTeams = useMemo<number[]>(() => {
    const fromDraft = (game?.draftTeams?.teams ?? [])
      .map((t) => t.index)
      .filter((i) => typeof i === 'number' && i >= 0);
    if (fromDraft.length) return [...new Set(fromDraft)].sort((a, b) => a - b);
    const fromRounds = new Set<number>();
    for (const r of rounds) {
      if (typeof r.teamAIndex === 'number' && r.teamAIndex >= 0) fromRounds.add(r.teamAIndex);
      if (typeof r.teamBIndex === 'number' && r.teamBIndex >= 0) fromRounds.add(r.teamBIndex);
    }
    return [...fromRounds].sort((a, b) => a - b);
  }, [game?.draftTeams?.teams, rounds]);

  const visible =
    colourFilter === null
      ? rounds
      : rounds.filter(
          (r) => r.teamAIndex === colourFilter || r.teamBIndex === colourFilter,
        );

  if (loading) {
    const spinner = (
      <View style={styles.center}>
        <SoccerBallLoader />
      </View>
    );
    return embedded ? (
      <TabScroll header={props.header} stickyHeader={props.stickyHeader} bottomInset={props.bottomInset}>
        <View style={{ minHeight: 160, alignItems: 'center', justifyContent: 'center' }}>
          <SoccerBallLoader />
        </View>
      </TabScroll>
    ) : (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={live ? he.matchRoundsLiveTitle : he.matchRoundsTitle} />
        {spinner}
      </SafeAreaView>
    );
  }

  // No rounds has two completely different causes, and the difference matters
  // to the reader: an evening that has not been played yet WILL fill this list,
  // while a finished evening with nothing recorded never will. Telling the
  // second one "המחזור עוד לא שוחק" is simply false — it was played, the
  // mini-games just were not logged; telling the first one "לא נשמרו פרטים"
  // is equally false, since there is nothing to have saved yet.
  //
  // The list cannot tell them apart — it sees an empty query either way — so
  // the caller says which, and `undefined` (the standalone route, which asks
  // nothing) keeps the neutral wording that route has always shown.
  const empty = live
    ? {
        icon: 'football-outline' as const,
        title: he.matchRoundsLiveEmptyTitle,
        body: he.matchRoundsLiveEmptySub,
      }
    : props.hasPlayed === true
      ? {
          icon: 'document-text-outline' as const,
          title: he.gdGamesNoCoverageTitle,
          body: he.gdGamesNoCoverageBody,
        }
      : props.hasPlayed === false
        ? {
            icon: 'football-outline' as const,
            title: he.gdGamesEmptyTitle,
            body: he.gdGamesEmptyBody,
          }
        : {
            icon: 'football-outline' as const,
            title: he.matchRoundsEmptyTitle,
            body: he.matchRoundsEmptySub,
          };
  const pinned = props.header != null && props.stickyHeader != null;
  const body =
    rounds.length === 0 ? (
      // Scrollable even with nothing in it: the header rides inside this view,
      // and a plain <View> would leave the tab bar with nothing to stick to.
      <ScrollSurface
        style={styles.flex}
        stickyHeaderIndices={pinned ? [1] : undefined}
        showsVerticalScrollIndicator={false}
      >
        {/* Separate <View> wrappers, not a fragment — `stickyHeaderIndices`
            counts the ScrollView's direct children. */}
        <View>{props.header}</View>
        <View>{props.stickyHeader}</View>
        <View style={styles.center}>
          <Ionicons name={empty.icon} size={46} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>{empty.title}</Text>
          <Text style={styles.emptySub}>{empty.body}</Text>
        </View>
      </ScrollSurface>
    ) : (
      <ScrollSurface
        style={pinned ? styles.flex : undefined}
        contentContainerStyle={
          pinned
            ? undefined
            : [
                styles.scroll,
                props.bottomInset ? { paddingBottom: props.bottomInset + 16 } : null,
              ]
        }
        stickyHeaderIndices={pinned ? [1] : undefined}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View>{props.header}</View>
        <View>{props.stickyHeader}</View>
        {/* The list's own padding moves inside when the header is present, so
            the hero and the bar stay flush with the screen edges. */}
        <View
          style={
            pinned
              ? [
                  styles.scroll,
                  props.bottomInset ? { paddingBottom: props.bottomInset + 16 } : null,
                ]
              : undefined
          }
        >
        <View style={styles.summaryPill}>
          <Ionicons name="list" size={15} color={colors.primary} />
          <Text style={styles.summaryPillTx}>
            {colourFilter === null
              ? he.matchRoundsCount(rounds.length)
              : he.matchRoundsCountFiltered(visible.length, rounds.length)}
          </Text>
        </View>
        {/* Colour filter. The legend it replaces named the teams; this names
            them AND narrows the list, which is what the four-tab design asks
            for. Shown only where there is something to choose between. */}
        {props.showFilter && cycleTeams.length > 1 ? (
          <View style={styles.filterRow}>
            <Pressable
              onPress={() => setColourFilter(null)}
              style={[styles.filterChip, colourFilter === null && styles.filterChipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: colourFilter === null }}
            >
              <Text
                style={[
                  styles.filterChipTx,
                  colourFilter === null && styles.filterChipTxOn,
                ]}
              >
                {he.gdGamesFilterAll}
              </Text>
            </Pressable>
            {cycleTeams.map((idx) => {
              const on = colourFilter === idx;
              return (
                <Pressable
                  key={idx}
                  onPress={() => setColourFilter(on ? null : idx)}
                  style={[styles.filterChip, on && styles.filterChipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  {/* Dot first → rightmost under forceRTL, exactly as the
                      legend drew it. */}
                  <View
                    style={[
                      styles.teamsLegendDot,
                      { backgroundColor: teamColor(idx, splitForColors) },
                    ]}
                  />
                  <Text style={[styles.filterChipTx, on && styles.filterChipTxOn]}>
                    {teamName(idx, splitForColors)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : cycleTeams.length > 0 ? (
          <View style={styles.teamsLegend}>
            {cycleTeams.map((idx) => (
              <View key={idx} style={styles.teamsLegendChip}>
                <View
                  style={[
                    styles.teamsLegendDot,
                    { backgroundColor: teamColor(idx, splitForColors) },
                  ]}
                />
                <Text style={styles.teamsLegendName}>
                  {teamName(idx, splitForColors)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {visible.map((r, idx) => (
          <RoundCard
            key={r.roundId || String(idx)}
            round={r}
            index={rounds.indexOf(r)}
            resolve={resolve}
            teams={game?.draftTeams?.originalTeams ?? game?.draftTeams?.teams}
            expanded={!!expanded[r.roundId || String(idx)]}
            onToggle={() =>
              setExpanded((s) => ({
                ...s,
                [r.roundId || String(idx)]: !s[r.roundId || String(idx)],
              }))
            }
          />
        ))}
        </View>
      </ScrollSurface>
    );

  return embedded ? (
    body
  ) : (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={live ? he.matchRoundsLiveTitle : he.matchRoundsTitle} />
      {body}
    </SafeAreaView>
  );
}

function RoundCard({
  round,
  index,
  resolve,
  teams,
  expanded,
  onToggle,
}: {
  round: RoundHistoryDoc;
  index: number;
  resolve: (id: string | null | undefined) => Resolved;
  teams?: readonly DraftTeam[];
  expanded: boolean;
  onToggle: () => void;
}) {
  // Prefer the stored bib index; for old rounds that lack it, reconstruct the
  // real colour by matching the round's roster to the draft split — so the
  // matchup reads "אדומה נגד כחולה" and the goal balls take the scorer's team
  // colour, instead of the neutral "קבוצה א/ב" + orange/blue fallback.
  const aIdx =
    typeof round.teamAIndex === 'number' && round.teamAIndex >= 0
      ? round.teamAIndex
      : resolveTeamIndex(round.teamA, teams);
  const bIdx =
    typeof round.teamBIndex === 'number' && round.teamBIndex >= 0
      ? round.teamBIndex
      : resolveTeamIndex(round.teamB, teams);
  const A = teamStyle(aIdx, 'A', teams);
  const B = teamStyle(bIdx, 'B', teams);
  const pens = round.penalties ?? [];
  const penA = pens.filter((p) => p.team === 'A' && p.scored).length;
  const penB = pens.filter((p) => p.team === 'B' && p.scored).length;

  // Winner: a shootout resolves a tie → the side with more converted kicks;
  // otherwise the mini-game's recorded winnerSide.
  const shootoutWinner =
    pens.length > 0 ? (penA === penB ? null : penA > penB ? 'A' : 'B') : null;
  const winnerSide = shootoutWinner ?? round.winnerSide;
  const winTeam = winnerSide === 'A' ? A : winnerSide === 'B' ? B : null;
  const winner = winTeam
    ? {
        label: shootoutWinner
          ? he.matchRoundsWonPens(winTeam.name)
          : winTeam.plural
            ? he.matchRoundsWon(winTeam.name)
            : he.matchRoundsWonLegacy(winTeam.name),
        color: winTeam.color,
        icon: shootoutWinner ? ('hand-left' as const) : ('trophy' as const),
      }
    : { label: he.matchRoundsTie, color: colors.textMuted, icon: 'remove' as const };

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardIdx}>{he.matchRoundsRoundN(index + 1)}</Text>
        <View style={[styles.winBadge, { backgroundColor: winner.color + '22' }]}>
          <Ionicons name={winner.icon} size={13} color={winner.color} />
          <Text style={[styles.winBadgeTx, { color: winner.color }]}>
            {winner.label}
          </Text>
        </View>
      </View>

      {/* Score row */}
      <View style={styles.scoreRow}>
        <View style={styles.scoreTeam}>
          <View style={styles.teamName}>
            <View style={[styles.swatch, { backgroundColor: A.color }]} />
            <Text style={styles.teamNameTx}>{A.name}</Text>
          </View>
        </View>
        <Text style={styles.scoreNum}>{round.scoreA}</Text>
        <Text style={styles.scoreSep}>:</Text>
        <Text style={styles.scoreNum}>{round.scoreB}</Text>
        {/* Mirrored, not repeated.
            Both halves used to be written `[swatch][name]`, and under forceRTL
            that put A's swatch against the OUTER edge and B's against the
            score — the two sides of one scoreboard leaning opposite ways.
            B carries its swatch AFTER the name, so the row reads
            🟦 name · score · name 🟩 whatever each half is aligned to. */}
        <View style={styles.scoreTeam}>
          <View style={styles.teamName}>
            <Text style={styles.teamNameTx}>{B.name}</Text>
            <View style={[styles.swatch, { backgroundColor: B.color }]} />
          </View>
        </View>
      </View>

      {/* Goals — ONE chronological list (order of entry), the ball coloured by
          the scoring team, and the minute on the visual-left. No team headers. */}
      {round.goals.length > 0 ? (
        <View style={styles.goalsList}>
          {round.goals.map((g, i) => {
            const t = g.team === 'A' ? A : B;
            const scorer = resolve(g.scorerId);
            const assist = g.assisterId ? resolve(g.assisterId) : null;
            return (
              <View key={i} style={styles.goalRow}>
                <View style={styles.goalMain}>
                  <Ionicons
                    name="football"
                    size={15}
                    color={g.ownGoal ? colors.textMuted : t.color}
                  />
                  <Text style={styles.goalScorer} numberOfLines={1}>
                    {scorer.name}
                  </Text>
                  {g.ownGoal ? (
                    <Text style={styles.goalOwn}>{he.matchRoundsOwnGoal}</Text>
                  ) : assist ? (
                    <Text style={styles.goalAssist} numberOfLines={1}>
                      {he.matchRoundsAssist(assist.name)}
                    </Text>
                  ) : null}
                </View>
                {g.minute ? (
                  <Text style={styles.goalMinute}>{g.minute}׳</Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={styles.noGoals}>{he.matchRoundsNoGoals}</Text>
      )}

      {/* Penalty shootout */}
      {pens.length > 0 ? (
        <View style={styles.pens}>
          <View style={styles.pensHead}>
            <View style={styles.teamName}>
              <Ionicons name="hand-left" size={14} color={colors.text} />
              <Text style={styles.pensHeadTx}>{he.matchRoundsShootout}</Text>
            </View>
            <Text style={styles.pensScore}>
              {penA} : {penB}
            </Text>
          </View>
          {pens.map((p, i) => {
            const kicker = resolve(p.kickerId);
            const keeper = resolve(p.keeperId);
            return (
              <View key={i} style={styles.penRow}>
                <Ionicons
                  name={p.scored ? 'checkmark-circle' : 'close-circle'}
                  size={15}
                  color={p.scored ? colors.success : colors.danger}
                />
                <View
                  style={[
                    styles.swatchSm,
                    { backgroundColor: p.team === 'A' ? A.color : B.color },
                  ]}
                />
                <Text style={styles.penKicker}>{kicker.name}</Text>
                {keeper.id ? (
                  <Text style={styles.penKeeper}>
                    {he.matchRoundsVsKeeper(keeper.name)}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {/* Rosters (collapsible) */}
      <Pressable style={styles.rosterToggle} onPress={onToggle}>
        <Ionicons name="people-outline" size={15} color={colors.textMuted} />
        <Text style={styles.rosterToggleTx}>{he.matchRoundsWhoPlayed}</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={15}
          color={colors.textMuted}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.rosterBody}>
          <RosterRow
            color={A.color}
            title={A.name}
            ids={round.teamA}
            resolve={resolve}
          />
          <RosterRow
            color={B.color}
            title={B.name}
            ids={round.teamB}
            resolve={resolve}
          />
        </View>
      ) : null}
    </View>
  );
}

function RosterRow({
  title,
  color,
  ids,
  resolve,
}: {
  title: string;
  color: string;
  ids: string[];
  resolve: (id: string | null | undefined) => Resolved;
}) {
  return (
    <View style={styles.rosterTeam}>
      <View style={styles.teamName}>
        <View style={[styles.swatch, { backgroundColor: color }]} />
        <Text style={styles.rosterTeamTitle}>{title}</Text>
      </View>
      <View style={styles.rosterChips}>
        {ids.map((id) => {
          const p = resolve(id);
          return (
            <View key={id} style={styles.rosterChip}>
              <UserAvatar
                user={{
                  id: p.id,
                  name: p.name,
                  avatarId: p.avatarId,
                  photoUrl: p.photoUrl,
                }}
                size={22}
              />
              <Text style={styles.rosterChipTx} numberOfLines={1}>
                {p.name}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  emptySub: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  summaryPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  summaryPillTx: { ...typography.caption, color: colors.text, fontWeight: '700' },
  // The chips sat almost against the count pill above them and the two rows
  // read as one crowded block (owner report). They are separate controls —
  // one states the total, the other narrows it — so they get real air.
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipTx: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  filterChipTxOn: { color: '#fff' },
  teamsLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  teamsLegendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  teamsLegendDot: { width: 11, height: 11, borderRadius: 6 },
  teamsLegendName: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '800',
    writingDirection: 'rtl',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendTx: { ...typography.caption, color: colors.textMuted },
  swatch: { width: 11, height: 11, borderRadius: 3 },
  swatchSm: { width: 9, height: 9, borderRadius: 2 },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 18,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bg,
  },
  cardIdx: { ...typography.body, fontWeight: '800', color: colors.text },
  winBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  winBadgeTx: { fontSize: 11.5, fontWeight: '800' },

  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  // Centred inside its own half, so each name sits midway between the score
  // and the page edge instead of hugging the edge (reported). The mirroring
  // still comes from the child ORDER, not from the alignment.
  scoreTeam: { flex: 1, alignItems: 'center' },
  teamName: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  teamNameTx: { ...typography.caption, fontWeight: '800', color: colors.text },
  scoreNum: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.text,
    minWidth: 30,
    textAlign: 'center',
  },
  scoreSep: { fontSize: 20, color: colors.textMuted, fontWeight: '700' },

  goalsList: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  goalMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
  },
  goalMinute: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginStart: spacing.sm,
  },
  goalScorer: { ...typography.body, fontWeight: '700', color: colors.text },
  goalAssist: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },
  goalOwn: { ...typography.caption, color: colors.textMuted, fontStyle: 'italic' },
  noGoals: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    paddingBottom: spacing.md,
  },

  pens: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 12,
    padding: spacing.md,
  },
  pensHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  pensHeadTx: { ...typography.body, fontWeight: '800', color: colors.text },
  pensScore: { ...typography.body, fontWeight: '900', color: colors.text },
  penRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 3 },
  penKicker: { ...typography.caption, fontWeight: '700', color: colors.text },
  penKeeper: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },

  rosterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rosterToggleTx: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  rosterBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  rosterTeam: { gap: 6 },
  rosterTeamTitle: { ...typography.caption, fontWeight: '800', color: colors.text },
  rosterChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rosterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bg,
    borderRadius: 999,
    paddingVertical: 3,
    paddingEnd: 10,
    paddingStart: 3,
  },
  rosterChipTx: { ...typography.caption, color: colors.text, maxWidth: 110 },
});
