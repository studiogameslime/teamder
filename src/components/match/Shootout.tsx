// Penalty shootout (שובר שוויון) — the tiebreaker for a drawn mini-game.
//
// Flow (each screen has a "חזור" back button; no undo-kick for now):
//   TieDecisionModal → admin picks ✋ manual (WinnerPickerModal) or 🥅 penalties.
//   Shootout screen 0 (first)  — who kicks first (team A / team B / random).
//   Shootout screen 1 (board)  — per-team tally + turn + split kick log + add/finish.
//   Shootout screen 2 (entry)  — pick keeper (sticky) + kicker (radio); המשך gated.
//   Shootout screen 3 (result) — נכנס / הוחמץ → records the kick → back to board.
//
// State lives on `liveMatch.shootout` (gameService.startShootout / setShootoutKeeper /
// recordShootoutKick). The winner (more scored) flows out via `onDecided(side)`, a
// penalty tie via `onTie()` — both handled by the screen like a manual pick, so the
// kicks credit penalty stats through the round-end commit.

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  buildRoster,
  firstName,
  makeResolver,
  teamColor,
  teamName,
  type PlayerLite,
} from '@/components/match/rotationView';
import { gameService } from '@/services/gameService';
import { appAlert } from '@/components/AppDialog';
import type { DraftTeamsResult, LiveMatchState, MatchRotation } from '@/types';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

// ── Tie decision chooser: manual pick vs penalties ────────────────────────
export function TieDecisionModal({
  visible,
  onManual,
  onPenalties,
  onClose,
}: {
  visible: boolean;
  onManual: () => void;
  onPenalties: () => void;
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

type Screen = 'first' | 'board' | 'entry' | 'result';

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

  // Reset local UI when the modal closes.
  useEffect(() => {
    if (!visible) {
      setScreen('first');
      setKickerId(null);
      setKeeperPicking(false);
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
  };
  const chooseRandom = () => startFirst(Math.random() < 0.5 ? 'A' : 'B');
  const pickKeeper = (uid: string) => {
    void gameService.setShootoutKeeper(gameId, defendingTeam, uid);
    setKeeperPicking(false);
  };
  const proceed = () => {
    if (kickerId && facingKeeperId) setScreen('result');
  };
  const record = (scored: boolean) => {
    if (!kickerId || !facingKeeperId) return;
    void gameService.recordShootoutKick(gameId, {
      team: kickingTeam,
      kickerId,
      keeperId: facingKeeperId,
      scored,
    });
    setKickerId(null);
    setScreen('board');
  };
  const finish = () => {
    const sa = scoredOf('A');
    const sb = scoredOf('B');
    if (sa === sb) {
      onTie();
      return;
    }
    const winner: 'A' | 'B' = sa > sb ? 'A' : 'B';
    // Confirm the outcome before committing — a shootout decides a whole
    // round, so name the winner + the score and require a deliberate tap
    // (user request: "no feedback that the leading team won + add an
    // are-you-sure window").
    appAlert(
      he.shConfirmWinTitle(teamNameOf(winner)),
      he.shConfirmWinBody(teamNameOf(winner), scoredOf(winner), scoredOf(winner === 'A' ? 'B' : 'A')),
      [
        { text: he.cancel, style: 'cancel' },
        { text: he.shConfirmWinCta, onPress: () => onDecided(winner) },
      ],
    );
  };
  const back = () => {
    // Android back / "חזור": step to the PREVIOUS screen, never abandon the
    // whole shootout mid-flow (user report: back kicked me out entirely).
    if (keeperPicking) {
      setKeeperPicking(false);
      return;
    }
    if (screen === 'result') setScreen('entry');
    else if (screen === 'entry') {
      setKickerId(null);
      setScreen('board');
    } else onExit(); // 'first' or 'board' → abandon the shootout
  };

  const canContinue = !!kickerId && !!facingKeeperId;

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

        <Pressable style={styles.kickBtn} onPress={() => setScreen('entry')}>
          <Text style={styles.kickTxt}>{he.shAddKick}</Text>
        </Pressable>
        <Pressable style={styles.finBtn} onPress={finish} disabled={kicks.length === 0}>
          <Text style={[styles.finTxt, kicks.length === 0 && styles.dim]}>{he.shFinish}</Text>
        </Pressable>
        {/* No "back" once the shootout is underway — a kick has been taken. */}
        {kicks.length === 0 ? <BackBtn /> : null}
      </View>
    );
  };

  const renderEntry = () => {
    // Keeper sub-picker: the DEFENDING team's roster.
    if (keeperPicking) {
      return (
        <View>
          <Text style={styles.sTitle}>{he.shPickKeeperTitle}</Text>
          <ScrollView style={[styles.pickList, { marginTop: spacing.sm }]}>
            {defendingRoster.map((p) => (
              <Pressable key={p.id} style={styles.prow} onPress={() => pickKeeper(p.id)}>
                <Avatar id={p.id} tint={colorOf(defendingTeam)} />
                <Text style={styles.pname} numberOfLines={1}>
                  {p.name}
                </Text>
                <View style={styles.prowSpacer} />
                <View style={[styles.radio, facingKeeperId === p.id && styles.radioOn]} />
              </Pressable>
            ))}
          </ScrollView>
          <Pressable style={styles.backRow} onPress={() => setKeeperPicking(false)} hitSlop={8}>
            <Text style={styles.backText}>{he.shBack}</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View>
        <Text style={styles.sTitle}>{he.shKickTitle}</Text>
        <Text style={[styles.turnBig, { backgroundColor: colorOf(kickingTeam) }]}>
          {he.shKicking(teamNameOf(kickingTeam))}
        </Text>

        <Pressable
          style={[
            styles.keeperSel,
            { backgroundColor: colorOf(defendingTeam), borderColor: colorOf(defendingTeam) },
          ]}
          onPress={() => setKeeperPicking(true)}
        >
          <Text style={styles.keeperSelTxt} numberOfLines={1}>
            {he.shVsKeeper(teamNameOf(defendingTeam))}{' '}
            <Text style={styles.keeperName}>{facingKeeperId ? nameOf(facingKeeperId) : '—'}</Text>
          </Text>
          <View style={styles.prowSpacer} />
          <Text style={[styles.pickK, { color: colorOf(defendingTeam) }]}>
            {facingKeeperId ? he.shReplaceKeeper : he.shPickKeeper}
          </Text>
        </Pressable>

        <Text style={styles.qlabel}>{he.shWhoKicks}</Text>
        <ScrollView style={styles.pickList}>
          {kickingRoster.map((p) => (
            <Pressable key={p.id} style={styles.prow} onPress={() => setKickerId(p.id)}>
              <Avatar id={p.id} tint={colorOf(kickingTeam)} />
              <Text style={styles.pname} numberOfLines={1}>
                {p.name}
              </Text>
              <View style={styles.prowSpacer} />
              <Text style={styles.pcnt}>{he.shKickedN(kicksByPlayer[p.id] ?? 0)}</Text>
              <View style={[styles.radio, kickerId === p.id && styles.radioOn]} />
            </Pressable>
          ))}
        </ScrollView>

        <Pressable
          style={[styles.contBtn, !canContinue && styles.contDisabled]}
          onPress={proceed}
          disabled={!canContinue}
        >
          <Text style={styles.contTxt}>{he.shContinue}</Text>
        </Pressable>
        {!canContinue ? <Text style={styles.contHint}>{he.shContinueHint}</Text> : null}
        <BackBtn />
      </View>
    );
  };

  const renderResult = () => (
    <View>
      <Text style={styles.sTitle}>{he.shResultKickBy(nameOf(kickerId))}</Text>
      <Text style={[styles.turnBig, { backgroundColor: colorOf(defendingTeam) }]}>
        {he.shResultVsKeeper(nameOf(facingKeeperId))}
      </Text>
      <Text style={[styles.qlabel, { marginTop: spacing.md }]}>{he.shResultQ}</Text>
      <View style={styles.resRow}>
        {/* icon on the LEFT, text on the RIGHT (user request) */}
        <Pressable style={[styles.rbtn, styles.rOk]} onPress={() => record(true)}>
          <Text style={styles.rOkTxt}>{he.shResultIn}</Text>
          <View style={styles.prowSpacer} />
          <Text style={styles.rIcon}>✅</Text>
        </Pressable>
        <Pressable style={[styles.rbtn, styles.rNo]} onPress={() => record(false)}>
          <Text style={styles.rNoTxt}>{he.shResultMiss}</Text>
          <View style={styles.prowSpacer} />
          <Text style={styles.rIcon}>❌</Text>
        </Pressable>
      </View>
      <BackBtn />
    </View>
  );

  let body: React.ReactNode = null;
  if (screen === 'first') body = renderFirst();
  else if (screen === 'board') body = renderBoard();
  else if (screen === 'entry') body = renderEntry();
  else body = renderResult();

  return (
    <Modal visible={visible && ready} transparent animationType="fade" onRequestClose={back}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>{body}</View>
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
    minHeight: '62%',
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
  decideLabel: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: 'right', writingDirection: 'rtl' },
  decideHint: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted, textAlign: 'right', writingDirection: 'rtl' },
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
  tName: { fontSize: 14, fontWeight: '800', color: '#111827', minWidth: 56, textAlign: 'right', writingDirection: 'rtl' },
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
  logTitle: { fontSize: 11, fontWeight: '800', color: '#6B7280', textAlign: 'right', writingDirection: 'rtl' },
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
  who: { fontWeight: '800', color: '#111827', fontSize: 14, textAlign: 'right', writingDirection: 'rtl' },
  // Result sits right after the name (both packed right by logSpacer), with a
  // clear gap + a thin divider between them.
  res: {
    flexShrink: 1,
    textAlign: 'right',
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
  kickBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  kickTxt: { color: '#fff', fontWeight: '900', fontSize: 14.5, writingDirection: 'rtl' },
  finBtn: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
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
  keeperSel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 11,
    padding: 11,
    marginTop: 10,
    marginBottom: 4,
  },
  keeperSelTxt: { flexShrink: 1, fontSize: 12.5, fontWeight: '700', color: '#FFFFFF', textAlign: 'right', writingDirection: 'rtl' },
  keeperName: { fontWeight: '900', color: '#FFFFFF' },
  pickK: {
    backgroundColor: '#FFFFFF',
    fontWeight: '800',
    paddingVertical: 4,
    paddingHorizontal: 11,
    borderRadius: 8,
    fontSize: 12,
    overflow: 'hidden',
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
  pname: { flexShrink: 1, textAlign: 'right', fontSize: 14, fontWeight: '700', color: '#111827', writingDirection: 'rtl' },
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 22,
    paddingHorizontal: 16,
    borderRadius: 15,
    borderWidth: 2,
  },
  rOk: { backgroundColor: '#ECFDF3', borderColor: '#16A34A' },
  rNo: { backgroundColor: '#FEF2F2', borderColor: '#EF4444' },
  rIcon: { fontSize: 20 },
  rOkTxt: { fontSize: 18, fontWeight: '900', color: '#16A34A', writingDirection: 'rtl' },
  rNoTxt: { fontSize: 18, fontWeight: '900', color: '#EF4444', writingDirection: 'rtl' },
});
