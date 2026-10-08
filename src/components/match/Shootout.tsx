// Penalty shootout (שובר שוויון) — the tiebreaker for a drawn mini-game.
//
// Flow (each screen has a "חזור" back button; the board can undo the last kick):
//   TieDecisionModal → admin picks ✋ manual (WinnerPickerModal) or 🥅 penalties.
//   Shootout screen 0 (first)  — who kicks first (team A / team B / random).
//   Shootout screen 1 (board)  — per-team tally + turn + split kick log + add/finish.
//   Shootout screen 2 (entry)  — the penalty box itself: two slots (keeper in
//                                 the goal, kicker on the spot). Tapping a slot
//                                 opens the same roster list as before; the
//                                 pitch stays on screen for נכנס / הוחמץ, and
//                                 the ball is kicked before the kick is
//                                 recorded — see takeKick().
//
// State lives on `liveMatch.shootout` (gameService.startShootout / setShootoutKeeper /
// recordShootoutKick). The winner (more scored) flows out via `onDecided(side)`, a
// penalty tie via `onTie()` — both handled by the screen like a manual pick, so the
// kicks credit penalty stats through the round-end commit.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Rect, Path, Circle } from 'react-native-svg';
import {
  buildRoster,
  firstName,
  makeResolver,
  teamColor,
  teamName,
  type PlayerLite,
  type RosterMember,
} from '@/components/match/rotationView';
import { gameService } from '@/services/gameService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import type { DraftTeamsResult, LiveMatchState, MatchRotation } from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { PenaltyPitch } from '@/components/match/PenaltyPitch';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';

// ── Tie decision chooser: manual pick vs penalties ────────────────────────
export function TieDecisionModal({
  visible,
  onManual,
  onPenalties,
  onBothOut,
  onClose,
}: {
  visible: boolean;
  onManual: () => void;
  onPenalties: () => void;
  /** Send BOTH sides off and bring the next two on. Absent when there is
   *  nothing to bring on — with 3 teams or fewer the pitch would empty. */
  onBothOut?: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{he.shDecideTitle}</Text>
          <Text style={styles.subtitle}>{he.shDecideSubtitle}</Text>

          {/* text (label+hint) on the RIGHT, icon on the LEFT (user request) */}
          <Pressable style={styles.decideOpt} onPress={onManual}>
            <View style={styles.flex1}>
              <Text style={styles.decideLabel}>{he.shDecideManual}</Text>
              <Text style={styles.decideHint}>{he.shDecideManualHint}</Text>
            </View>
            <Text style={styles.decideEmoji}>✋</Text>
          </Pressable>
          <Pressable style={styles.decideOpt} onPress={onPenalties}>
            <View style={styles.flex1}>
              <Text style={styles.decideLabel}>{he.shDecidePenalties}</Text>
              <Text style={styles.decideHint}>{he.shDecidePenaltiesHint}</Text>
            </View>
            <Text style={styles.decideEmoji}>🥅</Text>
          </Pressable>
          {onBothOut ? (
            <Pressable style={styles.decideOpt} onPress={onBothOut}>
              <View style={styles.flex1}>
                <Text style={styles.decideLabel}>{he.shDecideBothOut}</Text>
                <Text style={styles.decideHint}>{he.shDecideBothOutHint}</Text>
              </View>
              <Text style={styles.decideEmoji}>🔄</Text>
            </Pressable>
          ) : null}

          <Pressable style={styles.backRow} onPress={onClose}>
            <Text style={styles.backText}>{he.shBack}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface Props {
  visible: boolean;
  gameId: string;
  shootout?: LiveMatchState['shootout'];
  draftTeams?: DraftTeamsResult;
  rotation?: MatchRotation;
  playersMap: Record<string, PlayerLite>;
  guests?: { id: string; name: string }[];
  /** Winner decided (more penalties scored) — flows into prepareRoundResult. */
  onDecided: (side: 'A' | 'B') => void;
  /** Penalties ended level — fall back to a manual winner pick. */
  onTie: () => void;
  /** Back out of the whole shootout (clears state + closes). */
  onExit: () => void;
}

type Screen = 'first' | 'board' | 'entry';

function KickOutcomeIcon({ scored }: { scored: boolean }) {
  const tint = scored ? '#15803D' : '#B91C1C';
  return (
    <Svg width={44} height={44} viewBox="0 0 48 48" accessible={false}>
      <Rect x={8} y={14} width={31} height={25} rx={2} stroke={tint} strokeWidth={2.5} fill="none" />
      <Path d="M 16 15 V 38 M 24 15 V 38 M 32 15 V 38 M 9 22 H 38 M 9 30 H 38" stroke={tint} strokeWidth={1} opacity={0.35} />
      {!scored && <Path d="M 22 25 L 38 7 M 31 7 H 38 V 14" stroke={tint} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      <Circle cx={scored ? 24 : 39} cy={scored ? 27 : 7} r={7} fill="white" stroke={tint} strokeWidth={2} />
      <Path d={scored ? 'M 24 23 L 28 26 L 26 30 H 22 L 20 26 Z' : 'M 39 3 L 43 6 L 41 10 H 37 L 35 6 Z'} fill={tint} />
    </Svg>
  );
}

export function Shootout({
  visible,
  gameId,
  shootout,
  draftTeams,
  rotation,
  playersMap,
  guests,
  onDecided,
  onTie,
  onExit,
}: Props) {
  const [screen, setScreen] = useState<Screen>('first');
  const [kickerId, setKickerId] = useState<string | null>(null);
  const [keeperPicking, setKeeperPicking] = useState(false);
  const [kickerPicking, setKickerPicking] = useState(false);
  /** Set once the admin has committed to taking the kick — the pitch stays up
   *  and the נכנס / הוחמץ pair replaces the button, so the box never leaves
   *  the screen between choosing the players and saying what happened. */
  const [asking, setAsking] = useState(false);
  const [flying, setFlying] = useState(false);
  const [kickResult, setKickResult] = useState<boolean | null>(null);
  /** A write is in flight (currently only the undo) — blocks a double tap. */
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const writing = useRef(false);
  const visibleRef = useRef(visible);
  const uiEpoch = useRef(0);
  if (visibleRef.current !== visible) uiEpoch.current += 1;
  visibleRef.current = visible;
  const attempt = useRef<Parameters<typeof gameService.recordShootoutKick>[1] | null>(null);
  useEffect(() => () => { uiEpoch.current += 1; }, []);
  /** In-sheet confirmation. It is NOT `appAlert`, and that is the point:
   *  `AppDialogHost` lives at the app root and renders its own <Modal>, so
   *  asking from in here means presenting a modal on top of an already-
   *  presented one. Android stacks those as plain views and it works; iOS
   *  presents them through the view controller, the second present is
   *  refused, and the button appears to do nothing at all — which is exactly
   *  the report ("סיים שובר שיוויון doesn't work on iPhone"). Rendering the
   *  confirmation INSIDE this modal removes the stacking entirely. */
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    cta: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Reset local UI when the modal closes.
  useEffect(() => {
    if (!visible) {
      setScreen('first');
      setKickerId(null);
      setKeeperPicking(false);
      setKickerPicking(false);
      setAsking(false);
      setFlying(false);
      setKickResult(null);
      setBusy(false);
      setConfirm(null);
      attempt.current = null;
      setSaveError(false);
    }
  }, [visible]);

  // Once the shootout is actually started (firstTeam set), leave the opening
  // screen for the board.
  useEffect(() => {
    if (visible && shootout && screen === 'first') setScreen('board');
  }, [visible, shootout, screen]);

  const ready = !!draftTeams && draftTeams.teams.length >= 2 && !!rotation;
  const [aIdx, bIdx] = rotation?.playing ?? [0, 1];
  const teamsLite = (draftTeams?.teams ?? []).map((t) => ({
    index: t.index,
    playerIds: t.playerIds,
  }));
  const resolve = useMemo(() => makeResolver(playersMap, guests), [playersMap, guests]);
  const nameOf = (id?: string | null) => (id ? firstName(resolve(id).displayName ?? '…') : '');

  const rosterA = ready ? buildRoster(aIdx, teamsLite, rotation!, resolve) : [];
  const rosterB = ready ? buildRoster(bIdx, teamsLite, rotation!, resolve) : [];

  const kicks = shootout?.kicks ?? [];
  const firstTeam: 'A' | 'B' = shootout?.firstTeam ?? 'A';
  // Strict alternation A,B,A,B… starting from firstTeam.
  const kickingTeam: 'A' | 'B' =
    kicks.length % 2 === 0 ? firstTeam : firstTeam === 'A' ? 'B' : 'A';
  const defendingTeam: 'A' | 'B' = kickingTeam === 'A' ? 'B' : 'A';
  const kickingRoster = kickingTeam === 'A' ? rosterA : rosterB;
  const defendingRoster = defendingTeam === 'A' ? rosterA : rosterB;
  // The keeper who FACES this kick = the defending team's sticky keeper.
  const facingKeeperId = defendingTeam === 'A' ? shootout?.keeperA : shootout?.keeperB;

  const colA = teamColor(aIdx, draftTeams?.teams);
  const colB = teamColor(bIdx, draftTeams?.teams);
  const nameA = teamName(aIdx, draftTeams?.teams);
  const nameB = teamName(bIdx, draftTeams?.teams);
  const colorOf = (t: 'A' | 'B') => (t === 'A' ? colA : colB);
  const teamNameOf = (t: 'A' | 'B') => (t === 'A' ? nameA : nameB);

  const scoredOf = (t: 'A' | 'B') => kicks.filter((k) => k.team === t && k.scored).length;
  const takenOf = (t: 'A' | 'B') => kicks.filter((k) => k.team === t).length;
  const kicksByPlayer = useMemo(() => {
    const m: Record<string, number> = {};
    for (const k of kicks) m[k.kickerId] = (m[k.kickerId] ?? 0) + 1;
    return m;
  }, [kicks]);

  // ── actions ──
  const startFirst = (side: 'A' | 'B') => {
    void gameService.startShootout(gameId, side);
    logEvent(AnalyticsEvent.ShootoutStarted, { gameId, firstTeam: side, kicks: kicks.length });
  };
  const chooseRandom = () => startFirst(Math.random() < 0.5 ? 'A' : 'B');
  const pickKeeper = (uid: string) => {
    void gameService.setShootoutKeeper(gameId, defendingTeam, uid);
    logEvent(AnalyticsEvent.ShootoutKeeperPicked, {
      gameId,
      team: defendingTeam,
      kickIndex: kicks.length,
    });
    setKeeperPicking(false);
  };
  // ── the kick itself ──────────────────────────────────────────────────────
  //
  // Ball and keeper are shared values driven from here rather than from inside
  // the pitch. Persistence starts immediately; the board waits for the write
  // acknowledgement and the visual interval. Animation completion never writes.
  //
  // Units are pitch-widths, converted to pixels once the sheet has measured —
  // the geometry is proportional, so the same numbers work on any phone.
  const ballX = useSharedValue(0);
  const ballY = useSharedValue(0);
  const ballScale = useSharedValue(1);
  const keeperX = useSharedValue(0);
  const keeperY = useSharedValue(0);
  const keeperScale = useSharedValue(1);
  const pitchW = useRef(320);
  const reduced = useReducedMotion();

  const resetBall = useCallback(() => {
    ballX.value = 0;
    ballY.value = 0;
    ballScale.value = 1;
    keeperX.value = 0;
    keeperY.value = 0;
    keeperScale.value = 1;
  }, [ballX, ballY, ballScale, keeperX, keeperY, keeperScale]);
  useEffect(() => {
    if (!visible) {
      [ballX, ballY, ballScale, keeperX, keeperY, keeperScale].forEach(cancelAnimation);
    }
    return () => { [ballX, ballY, ballScale, keeperX, keeperY, keeperScale].forEach(cancelAnimation); };
  }, [visible, ballX, ballY, ballScale, keeperX, keeperY, keeperScale]);

  const proceed = () => {
    if (kickerId && facingKeeperId) setAsking(true);
  };

  /** Play the kick, then record it. `scored` decides where the ball ends up:
   *  inside the frame, or wide of the post it was aimed at. The keeper always
   *  goes the same way as the ball — a keeper diving away from a save would be
   *  a lie, and a keeper diving away from a goal is the one case where going
   *  the WRONG way is the truth, so that is the only place it is used. */
  const takeKick = (scored: boolean) => {
    if (flying || writing.current) return;
    scored = attempt.current?.scored ?? scored;
    void record(scored);
    if (reduced) {
      return;
    }
    setKickResult(scored);
    setFlying(true);
    const W = pitchW.current;
    // Aim at one post or the other. The goal mouth is 44% of the width, so a
    // corner is ±18% from the centre; wide is beyond the post at ±30%.
    const side = Math.random() < 0.5 ? -1 : 1;
    const targetX = side * W * (scored ? 0.14 : 0.3);
    // The spot sits at 52% of the height and the goal mouth at ~13%, and the
    // pitch is 1.22 tall for every 1 wide.
    const targetY = -W * (scored ? 0.54 : 0.59);
    const t = { duration: 800, easing: Easing.out(Easing.quad) };

    ballX.value = withDelay(180, withTiming(targetX, t));
    ballY.value = withDelay(180, withTiming(targetY, t));
    // Shrinking as it travels is the only depth cue a flat pitch can give.
    ballScale.value = withDelay(180, withTiming(0.72, t));

    // The keeper commits a beat after the ball is struck, as a real one does.
    // He goes the WRONG way on a goal — that is what being beaten looks like —
    // and towards the ball when it does not go in.
    const dive = { duration: 450, easing: Easing.out(Easing.cubic) };
    // 0.2 of the width is exactly the post — the goal mouth is 40% wide, so
    // half of it is 20% either side of centre. Further than that and the
    // keeper ends up diving outside his own goal.
    const diveTo = side * W * (scored ? -0.2 : 0.2);
    keeperX.value = withDelay(350, withTiming(diveTo, dive));
    keeperY.value = withDelay(350, withTiming(W * 0.06, dive));
    keeperScale.value = withDelay(
      350,
      withSequence(
        withTiming(0.88, dive),
        // Held at full stretch, then handed back to JS to write the kick.
        withDelay(
          700,
          withTiming(0.88, { duration: 1 }),
        ),
      ),
    );
  };
  const record = async (scored: boolean) => {
    if (!kickerId || !facingKeeperId || writing.current) return;
    writing.current = true;
    const epoch = uiEpoch.current;
    const isCurrent = () => visibleRef.current && uiEpoch.current === epoch;
    setBusy(true);
    setFlying(true);
    setSaveError(false);
    const pending = attempt.current ?? {
      id: `pk_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      team: kickingTeam,
      kickerId,
      keeperId: facingKeeperId,
      scored,
    };
    attempt.current = pending;
    try {
    await Promise.all([gameService.recordShootoutKick(gameId, pending), new Promise((resolve) => setTimeout(resolve, reduced ? 0 : 1500))]);
    if (isCurrent()) attempt.current = null;
    logEvent(AnalyticsEvent.ShootoutKickRecorded, {
      gameId,
      team: pending.team,
      scored: pending.scored,
      kickIndex: kicks.length,
      scoredA: scoredOf('A'),
      scoredB: scoredOf('B'),
    });
    if (!isCurrent()) return;
    setKickerId(null);
    setAsking(false);
    setFlying(false);
    setKickResult(null);
    resetBall();
    setScreen('board');
    } catch {
      if (isCurrent()) {
        setSaveError(true);
        setFlying(false);
        setKickResult(null);
        resetBall();
      }
    } finally {
      writing.current = false;
      if (isCurrent()) setBusy(false);
    }
  };
  const finish = () => {
    if (writing.current || busy || flying || attempt.current) return;
    const sa = scoredOf('A');
    const sb = scoredOf('B');
    logEvent(AnalyticsEvent.ShootoutFinished, {
      gameId,
      result: sa === sb ? 'tie' : 'decided',
      scoredA: sa,
      scoredB: sb,
      kicks: kicks.length,
    });
    if (sa === sb) {
      onTie();
      return;
    }
    const winner: 'A' | 'B' = sa > sb ? 'A' : 'B';
    // Confirm the outcome before committing — a shootout decides a whole
    // round, so name the winner + the score and require a deliberate tap
    // (user request: "no feedback that the leading team won + add an
    // are-you-sure window").
    setConfirm({
      title: he.shConfirmWinTitle(teamNameOf(winner)),
      body: he.shConfirmWinBody(
        teamNameOf(winner),
        scoredOf(winner),
        scoredOf(winner === 'A' ? 'B' : 'A'),
      ),
      cta: he.shConfirmWinCta,
      onConfirm: () => onDecided(winner),
    });
  };
  // Undo the last kick. Confirmed, because it rewrites the round's evidence and
  // the row it removes is one tap away from the row above it.
  const undoLast = () => {
    if (busy || flying) return;
    const last = kicks[kicks.length - 1];
    if (!last) return;
    setConfirm({
      title: he.shUndoTitle,
      body: he.shUndoBody(nameOf(last.kickerId) || ''),
      cta: he.shUndoCta,
      danger: true,
      onConfirm: () => {
        setBusy(true);
        logEvent(AnalyticsEvent.ShootoutKickUndone, {
          gameId,
          kicks: kicks.length,
          scored: last.scored,
        });
        gameService
          .undoLastShootoutKick(gameId, last.id)
          .catch(() => setSaveError(true))
          .finally(() => setBusy(false));
      },
    });
  };

  const back = () => {
    // Android back / "חזור": step to the PREVIOUS screen, never abandon the
    // whole shootout mid-flow (user report: back kicked me out entirely).
    // A kick in flight owns the screen until it lands; letting back interrupt
    // it would leave the ball mid-air and the kick unrecorded.
    if (flying || writing.current || attempt.current) return;
    if (confirm) {
      setConfirm(null);
      return;
    }
    if (keeperPicking) {
      setKeeperPicking(false);
      return;
    }
    if (kickerPicking) {
      setKickerPicking(false);
      return;
    }
    // "נכנס / הוחמץ" is a step inside the pitch screen now, so back returns to
    // the pitch with both players still standing on it.
    if (asking) {
      setAsking(false);
      return;
    }
    if (screen === 'entry') {
      setKickerId(null);
      setScreen('board');
    } else onExit(); // 'first' or 'board' → abandon the shootout
  };

  const canContinue = !!kickerId && !!facingKeeperId;
  const readyScale = useSharedValue(1);
  useEffect(() => {
    readyScale.value = 1;
    if (canContinue && screen === 'entry' && !reduced) {
      readyScale.value = withSequence(withTiming(1.035, { duration: 180 }), withTiming(1, { duration: 240 }));
    }
  }, [canContinue, screen, reduced, readyScale]);
  const readyStyle = useAnimatedStyle(() => ({ transform: [{ scale: readyScale.value }] }));

  // small building blocks
  const Avatar = ({ id, tint }: { id: string; tint: string }) => (
    <View style={[styles.av, { backgroundColor: tint }]}>
      <Text style={styles.avTxt}>{(nameOf(id) || '?').charAt(0)}</Text>
    </View>
  );
  const BackBtn = () => (
    <Pressable style={styles.backRow} onPress={back} hitSlop={8}>
      <Text style={styles.backText}>{he.shBack}</Text>
    </Pressable>
  );
  const Tag = () => <Text style={styles.tag}>{he.shTag}</Text>;

  const renderFirst = () => (
    <View>
      <Tag />
      <Text style={styles.q}>{he.shFirstTitle}</Text>
      {/* text (team name) on the RIGHT, colour dot / icon on the LEFT */}
      <Pressable style={styles.opt} onPress={() => startFirst('A')}>
        <Text style={styles.optTxt}>{nameA}</Text>
        <View style={styles.prowSpacer} />
        <View style={[styles.ob, { backgroundColor: colA }]} />
      </Pressable>
      <Pressable style={styles.opt} onPress={() => startFirst('B')}>
        <Text style={styles.optTxt}>{nameB}</Text>
        <View style={styles.prowSpacer} />
        <View style={[styles.ob, { backgroundColor: colB }]} />
      </Pressable>
      <Pressable style={styles.opt} onPress={chooseRandom}>
        <Text style={styles.optTxt}>{he.shRandom}</Text>
        <View style={styles.prowSpacer} />
        <Text style={styles.optIcon}>🎲</Text>
      </Pressable>
      <BackBtn />
    </View>
  );

  const TallyRow = ({ t }: { t: 'A' | 'B' }) => {
    const teamKicks = kicks.filter((k) => k.team === t);
    return (
      <View style={styles.tRow}>
        <View style={[styles.bd, { backgroundColor: colorOf(t) }]} />
        <Text style={styles.tName} numberOfLines={1}>
          {teamNameOf(t)}
        </Text>
        <View style={styles.dots}>
          {teamKicks.map((k) => (
            <View
              key={k.id}
              style={[
                styles.dot,
                k.scored
                  ? { backgroundColor: '#16A34A', borderColor: '#16A34A' }
                  : { borderColor: '#EF4444' },
              ]}
            />
          ))}
        </View>
        <Text style={styles.kk}>{he.shKicksCount(takenOf(t))}</Text>
        <Text style={styles.big}>{scoredOf(t)}</Text>
      </View>
    );
  };

  const renderBoard = () => {
    const turnKickNo = takenOf(kickingTeam) + 1;
    return (
      <View>
        <Tag />
        {/* The team that kicks FIRST is listed on top (user request). */}
        <View style={styles.tally}>
          <TallyRow t={firstTeam} />
          <View style={styles.hr} />
          <TallyRow t={firstTeam === 'A' ? 'B' : 'A'} />
        </View>
        <Text style={[styles.turn, { color: colorOf(kickingTeam) }]}>
          {he.shTurn(teamNameOf(kickingTeam), turnKickNo)}
        </Text>

        {/* Row + spacer forces the title to the right via RTL flex ordering
            (textAlign:'right' alone renders left here). */}
        <View style={styles.logTitleRow}>
          <Text style={styles.logTitle}>{he.shLogTitle}</Text>
          <View style={styles.prowSpacer} />
        </View>
        <ScrollView style={styles.log} contentContainerStyle={{ paddingVertical: 2 }}>
          {kicks.length === 0 ? (
            <Text style={styles.logEmpty}>{he.shLogEmpty}</Text>
          ) : (
            kicks.map((k) => (
              <View key={k.id} style={styles.k}>
                <Avatar id={k.kickerId} tint={colorOf(k.team)} />
                <Text style={styles.who} numberOfLines={1}>
                  {nameOf(k.kickerId)}
                </Text>
                <Text
                  style={[styles.res, k.scored ? styles.resScored : styles.resMissed]}
                  numberOfLines={1}
                >
                  {k.scored ? he.shScored(nameOf(k.keeperId)) : he.shMissed(nameOf(k.keeperId))}
                </Text>
                {/* Fills the left side so the name + result stay packed to the
                    right, with a clear gap between them. */}
                <View style={styles.logSpacer} />
              </View>
            ))
          )}
        </ScrollView>

        {/* Undo sits directly under the log it edits, and only when there is
            something to undo. Always the LAST kick — the log is ordered, and
            two kicks can look identical to a reader, so "the one you just
            entered" is the only unambiguous target. */}
        {kicks.length > 0 ? (
          <Pressable
            style={styles.undoRow}
            onPress={undoLast}
            disabled={busy || flying}
            hitSlop={6}
          >
            <Text style={[styles.undoTxt, (busy || flying) && styles.dim]}>
              {he.shUndoLast}
            </Text>
            <Ionicons
              name="arrow-undo-outline"
              size={15}
              color={busy || flying ? '#9CA3AF' : colors.danger}
            />
          </Pressable>
        ) : null}

        <Pressable style={styles.kickBtn} onPress={() => setScreen('entry')}>
          <Text style={styles.kickTxt}>{he.shAddKick}</Text>
          <Ionicons name="add-circle" size={18} color="#fff" />
        </Pressable>
        <Pressable style={styles.finBtn} onPress={finish} disabled={kicks.length === 0}>
          <Text style={[styles.finTxt, kicks.length === 0 && styles.dim]}>{he.shFinish}</Text>
          <Ionicons
            name="checkmark-circle"
            size={18}
            color={kicks.length === 0 ? '#9CA3AF' : '#16A34A'}
          />
        </Pressable>
        {/* No "back" once the shootout is underway — a kick has been taken. */}
        {kicks.length === 0 ? <BackBtn /> : null}
      </View>
    );
  };

  /** One roster as a tappable list — the same list both slots open. It was
   *  already written twice with a radio each; the pitch made the radio
   *  redundant (the chosen player is standing on the grass behind you), so it
   *  is one function now and the selection shows as a highlighted row. */
  const renderRoster = (
    title: string,
    roster: RosterMember[],
    tint: string,
    selectedId: string | null | undefined,
    onPick: (uid: string) => void,
    onBack: () => void,
    showCounts?: boolean,
  ) => (
    <View>
      <Text style={styles.sTitle}>{title}</Text>
      <ScrollView style={[styles.pickList, { marginTop: spacing.sm }]}>
        {roster.map((p) => (
          <Pressable
            key={p.id}
            style={[styles.prow, selectedId === p.id && { backgroundColor: colors.primaryLight }]}
            onPress={() => onPick(p.id)}
          >
            <Avatar id={p.id} tint={tint} />
            <Text style={styles.pname} numberOfLines={1}>
              {p.name}
            </Text>
            <View style={styles.prowSpacer} />
            {showCounts ? (
              <Text style={styles.pcnt}>{he.shKickedN(kicksByPlayer[p.id] ?? 0)}</Text>
            ) : null}
            <View style={[styles.radio, selectedId === p.id && styles.radioOn]} />
          </Pressable>
        ))}
      </ScrollView>
      <Pressable style={styles.backRow} onPress={onBack} hitSlop={8}>
        <Text style={styles.backText}>{he.shBack}</Text>
      </Pressable>
    </View>
  );

  /** An avatar standing on the pitch, with the name under it. */
  /** An avatar standing on the pitch. The name plate hangs under it and is
   *  dropped while the ball is in the air: it rides along with the keeper's
   *  dive, and a dark bar sliding across the six-yard box is not a dive. */
  const OnPitch = ({ id, tint }: { id: string; tint: string }) => (
    <>
      <View style={[styles.pitchAv, { borderColor: tint }]}>
        <Text style={styles.pitchAvTxt}>{(nameOf(id) || '?').charAt(0)}</Text>
      </View>
      {flying ? null : (
        <Text style={styles.pitchName} numberOfLines={1}>
          {nameOf(id)}
        </Text>
      )}
    </>
  );

  const renderEntry = () => {
    if (keeperPicking) {
      return renderRoster(
        he.shPickKeeperTitle,
        defendingRoster,
        colorOf(defendingTeam),
        facingKeeperId,
        (uid) => pickKeeper(uid),
        () => setKeeperPicking(false),
      );
    }
    if (kickerPicking) {
      return renderRoster(
        he.shWhoKicks,
        kickingRoster,
        colorOf(kickingTeam),
        kickerId,
        (uid) => {
          setKickerId(uid);
          setKickerPicking(false);
        },
        () => setKickerPicking(false),
        true,
      );
    }
    return (
      <View onLayout={(e) => (pitchW.current = e.nativeEvent.layout.width)}>
        <Text style={styles.sTitle}>{he.shKickTitle}</Text>
        <Text style={[styles.turnBig, { backgroundColor: colorOf(kickingTeam) }]}>
          {he.shKicking(teamNameOf(kickingTeam))}
        </Text>
        <Text style={styles.qlabel}>{asking ? he.shResultQ : he.shPickBoth}</Text>

        <PenaltyPitch
          keeperId={facingKeeperId}
          kickerId={kickerId}
          flying={flying}
          result={kickResult}
          resultLabel={kickResult === null ? undefined : kickResult ? he.shResultIn : he.shResultMiss}
          keeperLabel={he.shTapKeeper}
          kickerLabel={he.shTapKicker}
          keeperTint={colorOf(defendingTeam)}
          kickerTint={colorOf(kickingTeam)}
          onPressKeeper={() => !flying && setKeeperPicking(true)}
          onPressKicker={() => !flying && setKickerPicking(true)}
          keeperNode={
            facingKeeperId ? (
              <OnPitch id={facingKeeperId} tint={colorOf(defendingTeam)} />
            ) : undefined
          }
          kickerNode={
            kickerId ? <OnPitch id={kickerId} tint={colorOf(kickingTeam)} /> : undefined
          }
          ball={{ x: ballX, y: ballY, scale: ballScale }}
          keeperDive={{ x: keeperX, y: keeperY, scale: keeperScale }}
        />

        {/* Before the kick: one button. After it: the same two answers as
            before, in the same place, with the box still behind them. */}
        {asking ? (
          <View style={styles.resRow}>
            <Pressable
              style={[styles.rbtn, styles.rOk, flying && styles.contDisabled]}
              disabled={flying}
              onPress={() => takeKick(true)}
            >
              <KickOutcomeIcon scored />
              <Text style={styles.rOkTxt}>{he.shResultIn}</Text>
            </Pressable>
            <Pressable
              style={[styles.rbtn, styles.rNo, flying && styles.contDisabled]}
              disabled={flying}
              onPress={() => takeKick(false)}
            >
              <KickOutcomeIcon scored={false} />
              <Text style={styles.rNoTxt}>{he.shResultMiss}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Animated.View style={readyStyle}><Pressable
              style={[styles.contBtn, !canContinue && styles.contDisabled]}
              onPress={proceed}
              disabled={!canContinue}
            >
              <Text style={styles.contTxt}>{he.shTakeKick}</Text>
            </Pressable></Animated.View>
            {!canContinue ? <Text style={styles.contHint}>{he.shContinueHint}</Text> : null}
          </>
        )}
        {!flying ? <BackBtn /> : null}
      </View>
    );
  };

  let body: React.ReactNode = null;
  if (screen === 'first') body = renderFirst();
  else if (screen === 'board') body = renderBoard();
  else body = renderEntry();

  return (
    <Modal visible={visible && ready} transparent animationType="fade" onRequestClose={back}>
      <View style={styles.backdrop}>
        {/* Border in the CURRENTLY-KICKING team's colour (once a team has
            started kicking) so it's obvious whose turn it is. */}
        <View
          style={[
            styles.sheet,
            screen !== 'first' && {
              borderWidth: 3,
              borderColor: colorOf(kickingTeam),
            },
          ]}
        >
          {saveError && <Pressable accessibilityRole="button" disabled={busy} onPress={() => attempt.current ? takeKick(attempt.current.scored) : setSaveError(false)}><Text style={styles.q}>השמירה לא אושרה. {he.retry}</Text></Pressable>}
          {body}
        </View>

        {/* Confirmation, rendered INSIDE this modal — see `confirm` above. */}
        {confirm ? (
          <View style={styles.confirmWrap} pointerEvents="box-none">
            <Pressable
              style={styles.confirmScrim}
              onPress={() => setConfirm(null)}
            />
            <View style={styles.confirmCard}>
              <Text style={styles.confirmTitle}>{confirm.title}</Text>
              <Text style={styles.confirmBody}>{confirm.body}</Text>
              <View style={styles.confirmBtns}>
                <Pressable
                  style={[styles.confirmBtn, styles.confirmCancel]}
                  onPress={() => setConfirm(null)}
                >
                  <Text style={styles.confirmCancelTxt}>{he.cancel}</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.confirmBtn,
                    confirm.danger ? styles.confirmDanger : styles.confirmGo,
                  ]}
                  onPress={() => {
                    const run = confirm.onConfirm;
                    setConfirm(null);
                    run();
                  }}
                >
                  <Text style={styles.confirmGoTxt}>{confirm.cta}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.bg,
    borderRadius: 26,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sheet: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '96%',
    // No minHeight — the sheet hugs its content so there's no dead space at the
    // bottom on the shorter screens (Pulse: "empty space at the bottom").
    backgroundColor: '#F4F6F9',
    borderRadius: 26,
    padding: spacing.md,
  },
  title: { ...typography.h2, color: colors.text, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    writingDirection: 'rtl',
    marginBottom: spacing.sm,
  },
  flex1: { flex: 1, minWidth: 0 },
  // decision chooser
  decideOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  decideEmoji: { fontSize: 26 },
  decideLabel: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN, writingDirection: 'rtl' },
  decideHint: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, writingDirection: 'rtl' },
  // shared
  tag: {
    alignSelf: 'center',
    backgroundColor: '#EAF1FF',
    color: '#2563EB',
    fontWeight: '800',
    fontSize: 12,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
    overflow: 'hidden',
    textAlign: 'center',
    writingDirection: 'rtl',
    marginBottom: spacing.sm,
  },
  q: { textAlign: 'center', fontSize: 19, fontWeight: '900', color: '#111827', writingDirection: 'rtl', marginVertical: 16 },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#fff',
    marginBottom: 11,
  },
  ob: { width: 16, height: 16, borderRadius: 8 },
  optIcon: { fontSize: 17 },
  optTxt: { fontWeight: '800', fontSize: 16, color: '#111827', writingDirection: 'rtl' },
  backRow: { alignItems: 'center', paddingVertical: 10, marginTop: 2 },
  backText: { color: '#2563EB', fontWeight: '800', fontSize: 14, writingDirection: 'rtl' },
  // tally
  tally: {
    backgroundColor: '#fff',
    borderRadius: 15,
    paddingVertical: 4,
    paddingHorizontal: 3,
    marginBottom: 11,
  },
  tRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 12 },
  hr: { height: 1, backgroundColor: '#F1F3F6' },
  bd: { width: 11, height: 11, borderRadius: 6 },
  tName: { fontSize: 14, fontWeight: '800', color: '#111827', minWidth: 56, textAlign: RTL_LABEL_ALIGN, writingDirection: 'rtl' },
  dots: { flex: 1, flexDirection: 'row', gap: 4, alignItems: 'center', flexWrap: 'wrap' },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#CBD5E1' },
  kk: { color: '#9CA3AF', fontSize: 11, fontWeight: '700', minWidth: 52, textAlign: 'left', writingDirection: 'rtl' },
  big: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
    minWidth: 22,
    textAlign: 'center',
  },
  turn: { textAlign: 'center', fontSize: 12, fontWeight: '800', color: '#2563EB', writingDirection: 'rtl', marginBottom: 9 },
  logTitleRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 4, marginBottom: 4 },
  logTitle: { fontSize: 11, fontWeight: '800', color: '#6B7280', textAlign: RTL_LABEL_ALIGN, writingDirection: 'rtl' },
  log: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 3,
    marginBottom: 11,
    maxHeight: 190,
  },
  logEmpty: { textAlign: 'center', writingDirection: 'rtl', color: '#9CA3AF', paddingVertical: 14, fontWeight: '700' },
  k: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10 },
  kb: { width: 8, height: 8, borderRadius: 4 },
  who: { fontWeight: '800', color: '#111827', fontSize: 14, textAlign: RTL_LABEL_ALIGN, writingDirection: 'rtl' },
  // Result sits right after the name (both packed right by logSpacer), with a
  // clear gap + a thin divider between them.
  res: {
    flexShrink: 1,
    textAlign: RTL_LABEL_ALIGN,
    fontSize: 12.5,
    fontWeight: '700',
    writingDirection: 'rtl',
    paddingStart: 10,
    borderStartWidth: 1,
    borderStartColor: '#E5E7EB',
  },
  logSpacer: { flex: 1 },
  resScored: { color: '#16A34A' },
  resMissed: { color: '#EF4444' },
  // in-sheet confirmation
  confirmWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  confirmScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  confirmCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.bg,
    borderRadius: 22,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  confirmBody: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    color: colors.textMuted,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  confirmBtns: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancel: { borderWidth: 1.5, borderColor: colors.primary },
  confirmCancelTxt: { fontSize: 15, fontWeight: '800', color: colors.primary },
  confirmGo: { backgroundColor: colors.primary },
  confirmDanger: { backgroundColor: colors.danger },
  confirmGoTxt: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  undoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    marginBottom: 2,
  },
  undoTxt: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.danger,
  },
  kickBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  kickTxt: { color: '#fff', fontWeight: '900', fontSize: 14.5, writingDirection: 'rtl' },
  finBtn: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#16A34A',
    marginTop: 8,
  },
  finTxt: { color: '#16A34A', fontWeight: '900', fontSize: 12.5, writingDirection: 'rtl' },
  dim: { opacity: 0.4 },
  // kick entry
  sTitle: { fontSize: 17, fontWeight: '900', color: '#111827', textAlign: 'center', writingDirection: 'rtl' },
  turnBig: {
    alignSelf: 'center',
    backgroundColor: '#3B82F6',
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
    paddingVertical: 3,
    paddingHorizontal: 11,
    borderRadius: 999,
    overflow: 'hidden',
    marginVertical: 6,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  hint: { fontSize: 10.5, color: '#9CA3AF', textAlign: 'center', marginVertical: 6, fontWeight: '600', writingDirection: 'rtl' },
  qlabel: { fontSize: 13.5, fontWeight: '800', color: '#111827', textAlign: 'center', marginVertical: 4, writingDirection: 'rtl' },
  pickList: { maxHeight: 240 },
  prow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF0F4',
  },
  radio: { width: 19, height: 19, borderRadius: 10, borderWidth: 2, borderColor: '#CBD5E1' },
  radioOn: { borderColor: '#2563EB', backgroundColor: '#2563EB' },
  av: { width: 29, height: 29, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avTxt: { color: '#fff', fontSize: 13, fontWeight: '800' },
  pname: { flexShrink: 1, textAlign: RTL_LABEL_ALIGN, fontSize: 14, fontWeight: '700', color: '#111827', writingDirection: 'rtl' },
  // Pushes the name+avatar to the right and the radio/count to the left (RTL).
  prowSpacer: { flex: 1 },
  pcnt: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#64748B',
    backgroundColor: '#F1F5F9',
    borderRadius: 7,
    paddingVertical: 2,
    paddingHorizontal: 7,
    overflow: 'hidden',
    writingDirection: 'rtl',
  },
  contBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 11,
  },
  contDisabled: { backgroundColor: '#CBD5E1' },
  contTxt: { color: '#fff', fontWeight: '900', fontSize: 15, writingDirection: 'rtl' },
  contHint: { fontSize: 10, color: '#9CA3AF', textAlign: 'center', marginTop: 4, fontWeight: '600', writingDirection: 'rtl' },
  // result
  resRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  rbtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 4,
    paddingHorizontal: 16,
    borderRadius: 15,
    borderWidth: 2,
  },
  rOk: { backgroundColor: '#ECFDF3', borderColor: '#16A34A' },
  rNo: { backgroundColor: '#FEF2F2', borderColor: '#EF4444' },
  rIcon: { fontSize: 20 },
  rOkTxt: { fontSize: 18, fontWeight: '900', color: '#16A34A', writingDirection: 'rtl' },
  // ── on the pitch ──
  pitchAv: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2.5,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pitchAvTxt: { fontSize: 17, fontWeight: '900', color: colors.text },
  pitchName: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    // No centring margin: the slot centres this already, and the -17 that was
    // here put the name plate visibly left of the avatar. See slotLabel in
    // PenaltyPitch.
    width: 86,
    // A name over grass needs its own ground; the pitch is busy behind it.
    backgroundColor: 'rgba(17,24,39,0.55)',
    borderRadius: 6,
    paddingHorizontal: 3,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  rNoTxt: { fontSize: 18, fontWeight: '900', color: '#EF4444', writingDirection: 'rtl' },
});
