import { observeCaughtError } from '../../utils/errorObservation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeModal } from '@/components/SafeModal';
import { UserAvatar } from '@/components/UserAvatar';
import { MatchActionPitch, type PitchParticipant } from './MatchActionPitch';
import { MatchPlayerPicker } from './MatchPlayerPicker';
import {ShootoutScorePanel, ShootoutLogRow, ShootoutNextMatch} from './ShootoutSummaryViews';
import {penaltyOutcomes as outcomes, penaltyOutcomeButtons} from './penaltyOutcomeButtons';
import { TeamShirtIllustration } from './TeamShirt';
import { buildRoster, makeResolver, teamColor, teamTextColor, teamName, type PlayerLite, type RosterMember } from './rotationView';
import { gameService } from '@/services/gameService';
import { roundCommitKey } from '@/services/rotationEngine';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { RTL_LABEL_ALIGN } from '@/theme';
import type { DraftTeamsResult, LiveMatchState, MatchRotation, PenaltyOutcome } from '@/types';

type Kick = NonNullable<LiveMatchState['shootout']>['kicks'][number];
type Screen = 'first' | 'kicker' | 'keeper' | 'result' | 'log' | 'edit' | 'undo' | 'finish';
type CompletedKick = { id: string; team: 'A' | 'B'; outcome: PenaltyOutcome; kicker: RosterMember; keeper: RosterMember };
const outcomeText = (kick: Kick) => kick.outcome ? outcomes.find(o => o.key === kick.outcome)!.title : kick.scored ? 'גול' : 'לא הובקע';

const layout = StyleSheet.create({
  content: { flex: 1, minHeight: 0 },
  inner: { flexGrow: 1 },
  centered: { justifyContent: 'center' },
  roleStage: { flexGrow: 1, flexShrink: 0, justifyContent: 'center', gap: 9 },
  editPerson: { flex: 0 },
  footerItem: { flex: 1, minWidth: 0 },
  firstStage: { gap: 12, flexGrow: 1, justifyContent: 'center' },
  firstHeading: { gap: 2 },
  firstTeams: { flexDirection: 'row', gap: 10 },
  firstTeam: { flex: 1, minWidth: 0, minHeight: 138, borderWidth: 1, borderRadius: 18, padding: 10, alignItems: 'center', justifyContent: 'center', gap: 7 },
  firstTeamName: { fontSize: 21, fontWeight: '800', textAlign: 'center' },
  firstRoster: { flexDirection: 'row', alignSelf: 'stretch', gap: 6 },
  firstPlayer: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4 },
  firstPlayerName: { fontSize: 12, lineHeight: 16, minHeight: 32, color: '#12234D', textAlign: 'center', alignSelf: 'stretch' },
  firstRemaining: { fontSize: 11, lineHeight: 16, color: '#64748B', textAlign: 'center' },
  firstDraw: { flexDirection: 'row', gap: 9, minHeight: 48 },
});

export function Shootout({ visible, gameId, shootout, draftTeams, rotation, playersMap, guests, onDecided, onExit, onChangeDecision, decisionContent, onDecisionClose }: {
  visible: boolean; gameId: string; shootout?: LiveMatchState['shootout']; draftTeams?: DraftTeamsResult;
  rotation?: MatchRotation; playersMap: Record<string, PlayerLite>; guests?: { id: string; name: string }[];
  onDecided: (side: 'A' | 'B') => void | Promise<void>; onTie?: () => void; onExit: () => void;
  onChangeDecision?: () => void;
  decisionContent?: React.ReactNode;
  onDecisionClose?: () => void;
}) {
  const { height, width, fontScale } = useWindowDimensions();
  const compact = width < 350 || height < 650;
  const largeText = fontScale > 1.3;
  const pickerMinHeight = 64 + Math.ceil(92 * Math.max(1, fontScale));
  const sheetHeight = Math.min(680, Math.floor(height * 0.92));
  const [screen, setScreen] = useState<Screen>('first');
  const [kickerId, setKickerId] = useState<string | null>(null);
  const [selectedKeeperId, setSelectedKeeperId] = useState<string | null>(null);
  const [peekTeam, setPeekTeam] = useState<'A' | 'B' | null>(null);
  const [completed, setCompleted] = useState<CompletedKick | null>(null);
  const [chosenFirst, setChosenFirst] = useState<'A' | 'B'>('A');
  const [firstChoice, setFirstChoice] = useState<{ base: 'A' | 'B' | undefined; side: 'A' | 'B' } | null>(null);
  const [finishChoice, setFinishChoice] = useState<'A' | 'B' | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [reselectAllowed, setReselectAllowed] = useState(false);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [shadow, setShadow] = useState<{ base: string; kicks: Kick[] } | null>(null);
  const [edit, setEdit] = useState<Kick | null>(null);
  const [editRole, setEditRole] = useState<'kicker' | 'keeper' | null>(null);
  const writing = useRef(false);
  const contentScroll = useRef<ScrollView>(null);
  const visibleRef = useRef(visible);
  const uiEpoch = useRef(0);
  if (visibleRef.current !== visible) uiEpoch.current += 1;
  visibleRef.current = visible;
  const attempt = useRef<Parameters<typeof gameService.recordShootoutKick>[1] | null>(null);
  const attemptPeople = useRef<{ id: string; kicker: RosterMember; keeper: RosterMember } | null>(null);
  const setupAttempt = useRef<(() => Promise<void>) | null>(null);
  const resolve = useMemo(() => makeResolver(playersMap, guests), [playersMap, guests]);
  const originalKicks = shootout?.kicks ?? [];
  const signature = JSON.stringify(originalKicks);
  const kicks = shadow?.base === signature ? shadow.kicks : originalKicks;
  // An acknowledged local choice bridges listener latency, but an actual
  // first-side change from the server wins over that old snapshot. Starting
  // an existing series is idempotent and may acknowledge another admin's side.
  const firstTeam: 'A' | 'B' = kicks.length ? shootout?.firstTeam ?? chosenFirst
    : firstChoice && firstChoice.base === shootout?.firstTeam ? firstChoice.side
      : shootout?.firstTeam ?? chosenFirst;
  const kickingTeam: 'A' | 'B' = kicks.length % 2 === 0 ? firstTeam : firstTeam === 'A' ? 'B' : 'A';
  const defendingTeam: 'A' | 'B' = kickingTeam === 'A' ? 'B' : 'A';
  const left = new Set((draftTeams?.leftHome ?? []).map(p => p.playerId));
  const teams = (draftTeams?.teams ?? []).map(t => ({ ...t, playerIds: t.playerIds.filter(id => !left.has(id)) }));
  const [aIdx, bIdx] = rotation?.playing ?? [0, 1];
  const rosterA = rotation ? buildRoster(aIdx, teams, rotation, resolve) : [];
  const rosterB = rotation ? buildRoster(bIdx, teams, rotation, resolve) : [];
  const rosterOf = (side: 'A' | 'B') => side === 'A' ? rosterA : rosterB;
  const kickingRoster = rosterOf(kickingTeam), defendingRoster = rosterOf(defendingTeam);
  const keeper = defendingRoster.find(m => m.id === selectedKeeperId), kicker = kickingRoster.find(m => m.id === kickerId);
  const label = (side: 'A' | 'B') => teamName(side === 'A' ? aIdx : bIdx, teams);
  const tint = (side: 'A' | 'B') => teamTextColor(side === 'A' ? aIdx : bIdx, teams);
  const shirtColor = (side: 'A' | 'B') => teamColor(side === 'A' ? aIdx : bIdx, teams);
  const scoredOf = (side: 'A' | 'B') => kicks.filter(k => k.team === side && k.scored).length;
  const takenOf = (side: 'A' | 'B') => kicks.filter(k => k.team === side).length;
  const last = kicks[kicks.length - 1];
  const roundId = rotation ? roundCommitKey(rotation) : '';
  const selectionSeriesKey = JSON.stringify([roundId, firstTeam, kicks.map(kick => [kick.id, kick.team])]);
  const observedSeries = useRef<string | null>(null);
  useEffect(() => () => { uiEpoch.current += 1; }, []);
  useEffect(() => {setPeekTeam(null);if(decisionContent)setCompleted(null);},[visible,gameId,roundId,!!decisionContent]);
  useEffect(() => { uiEpoch.current += 1; writing.current = false; setBusy(false); setScreen('first'); setFinishChoice(null); setFirstChoice(null); setKickerId(null); setSelectedKeeperId(null); setCompleted(null); setShadow(null); setEdit(null); setSaveError(false); setReselectAllowed(false); setSaveErrorMessage(null); attempt.current = null; attemptPeople.current = null; setupAttempt.current = null; observedSeries.current = null; }, [gameId, roundId]);
  useEffect(() => { if (visible && shootout) { setChosenFirst(shootout.firstTeam); setScreen('kicker'); } }, [visible, gameId, roundId]);
  useEffect(() => {
    if (firstChoice && (kicks.length > 0 || shootout?.firstTeam !== firstChoice.base)) setFirstChoice(null);
  }, [shootout?.firstTeam, kicks.length, firstChoice]);
  useEffect(() => {
    const changed = observedSeries.current !== null && observedSeries.current !== selectionSeriesKey;
    observedSeries.current = selectionSeriesKey;
    // A request with an unknown acknowledgement must keep its exact content.
    // Compare the effective series (including our acknowledged shadow), so a
    // delayed listener for our own kick cannot erase the next player's choice.
    if (!changed || writing.current || attempt.current || setupAttempt.current || completed) return;
    setKickerId(null); setSelectedKeeperId(null); setFinishChoice(null);
    if (screen === 'kicker' || screen === 'keeper' || screen === 'result') setScreen('kicker');
    else if (screen === 'undo' || (screen === 'edit' && edit?.id !== last?.id)) {
      setEdit(null); setEditRole(null); setScreen('log');
    }
  }, [selectionSeriesKey, screen, completed, edit?.id, last?.id]);
  const selectableRosterKey = JSON.stringify([kickingRoster.map(member => member.id), defendingRoster.map(member => member.id)]);
  useEffect(() => {
    if (writing.current || attempt.current || setupAttempt.current || completed) return;
    if (kickerId && !kicker) {
      setKickerId(null); setSelectedKeeperId(null);
      if (screen === 'kicker' || screen === 'keeper' || screen === 'result') setScreen('kicker');
    } else if (selectedKeeperId && !keeper) {
      setSelectedKeeperId(null);
      if (screen === 'result') setScreen('keeper');
    }
  }, [selectableRosterKey, kickerId, selectedKeeperId, screen, completed]);
  useEffect(() => {
    if (!visible) {
      setCompleted(null);
      writing.current = false;
      setBusy(false);
      if (attempt.current || setupAttempt.current) setSaveError(true);
    }
  }, [visible]);

  const saveSetup = async (save: () => Promise<void>) => {
    if (writing.current) return;
    writing.current = true;
    setupAttempt.current = save;
    const epoch = uiEpoch.current;
    const current = () => visibleRef.current && uiEpoch.current === epoch;
    setBusy(true); setSaveError(false); setReselectAllowed(false); setSaveErrorMessage(null);
    try {
      await save();
      if (current()) setupAttempt.current = null;
    } catch (error) {
    observeCaughtError(error, {"source":"src/components/match/ShootoutWizard.tsx","handler":"saveSetup","site":"ShootoutWizard:3e98f418ab"});
      logError('shootoutSaveSetup', error, { gameId, roundId, stage: screen });
      if (current()) {
        setSaveError(true);
        setReselectAllowed((error as {code?:string})?.code === 'LIVE_ROSTER_CHANGED' && screen === 'edit');
        setSaveErrorMessage(String((error as Error)?.message).includes('closedSeasonGame')
          ? 'לא ניתן לשמור: שיוך העונה של המחזור אינו תואם לעונה הפעילה. הבעיטות נשמרו ביומן.'
          : String((error as Error)?.message).includes('season-operation:busy')
            ? 'מתבצע עדכון עונה במועדון. הבעיטות נשמרו; נסו שוב לאחר סיומו.'
            : null);
      }
    } finally {
      if (uiEpoch.current === epoch) writing.current = false;
      if (current()) setBusy(false);
    }
  };
  const startFirst = (side: 'A' | 'B') => {
    const expectedRoundId = rotation ? roundCommitKey(rotation) : undefined;
    const epoch = uiEpoch.current;
    void saveSetup(async () => { await (shootout ? gameService.changeShootoutFirstTeam(gameId, side, expectedRoundId) : gameService.startShootout(gameId, side, expectedRoundId)); if (visibleRef.current && uiEpoch.current === epoch) { setChosenFirst(side); setFirstChoice({base:shootout?.firstTeam,side}); setKickerId(null); setSelectedKeeperId(null); setScreen('kicker'); } logEvent(AnalyticsEvent.ShootoutStarted, { gameId, firstTeam: side, kicks: kicks.length }); });
  };
  const pickKeeper = (uid: string) => {
    if (writing.current || attempt.current || saveError || !kicker || !defendingRoster.some(member => member.id === uid)) return;
    setCompleted(null); setSelectedKeeperId(uid); setScreen('result');
    logEvent(AnalyticsEvent.ShootoutKeeperPicked, { gameId, team: defendingTeam, kickIndex: kicks.length });
  };
  const record = async (outcome?: PenaltyOutcome) => {
    if (writing.current || (!attempt.current && (!kicker || !keeper || !outcome))) return;
    const pending = attempt.current ?? { id: `pk_${Date.now()}_${Math.random().toString(36).slice(2)}`, team: kickingTeam, kickerId: kicker!.id, keeperId: keeper!.id, scored: outcome === 'goal', outcome: outcome!, expectedKickCount: kicks.length, expectedRoundId: roundId };
    attempt.current = pending;
    if (attemptPeople.current?.id !== pending.id && kicker && keeper) attemptPeople.current = {id:pending.id!,kicker,keeper};
    const epoch = uiEpoch.current;
    writing.current = true; setBusy(true); setSaveError(false); setReselectAllowed(false); setSaveErrorMessage(null);
    try {
      await gameService.recordShootoutKick(gameId, pending);
      if (visibleRef.current && uiEpoch.current === epoch) {
        const savedKicker = attemptPeople.current?.kicker ?? rosterOf(pending.team).find(member => member.id === pending.kickerId);
        const savedKeeper = attemptPeople.current?.keeper ?? rosterOf(pending.team === 'A' ? 'B' : 'A').find(member => member.id === pending.keeperId);
        if (savedKicker && savedKeeper && pending.outcome) {
          contentScroll.current?.scrollTo({ y: 0, animated: false });
          setCompleted({ id: pending.id!, team: pending.team, kicker: savedKicker, keeper: savedKeeper, outcome: pending.outcome });
        }
        const acknowledged = { id: pending.id!, kickerId: pending.kickerId, keeperId: pending.keeperId, team: pending.team, scored: pending.scored, outcome: pending.outcome, at: Date.now() };
        setShadow({ base: signature, kicks: kicks.some(kick => kick.id === pending.id) ? kicks : [...kicks, acknowledged] });
        attempt.current = null; attemptPeople.current = null; setKickerId(null); setSelectedKeeperId(null); setScreen('kicker');
      }
      logEvent(AnalyticsEvent.ShootoutKickRecorded, { gameId, team: pending.team, scored: pending.scored, outcome: pending.outcome, kickIndex: pending.expectedKickCount ?? 0 });
    } catch (error) {
    observeCaughtError(error, {"source":"src/components/match/ShootoutWizard.tsx","handler":"record","site":"ShootoutWizard:1ef2574c21"}); logError('shootoutRecordKick', error, { gameId, roundId, kickId: pending.id }); if (visibleRef.current && uiEpoch.current === epoch) {
      const code = (error as {code?:string})?.code;
      setSaveError(true); setReselectAllowed(code === 'LIVE_ROSTER_CHANGED' || code === 'LIVE_KICK_CHANGED');
      if (code === 'LIVE_KICK_CHANGED') setSaveErrorMessage('התור השתנה. בחרו שחקנים לתור העדכני.');
    } }
    finally { if (uiEpoch.current === epoch) writing.current = false; if (visibleRef.current && uiEpoch.current === epoch) setBusy(false); }
  };
  const close = () => { if (!writing.current) { setEdit(null); setEditRole(null); onExit(); } };
  const restartSelection = () => {
    if (!reselectAllowed || writing.current) return;
    attempt.current = null; attemptPeople.current = null; setupAttempt.current = null;
    setSaveError(false); setReselectAllowed(false); setSaveErrorMessage(null); setCompleted(null);
    if (screen === 'edit' && edit) {
      setEditRole(rosterOf(edit.team).some(member => member.id === edit.kickerId) ? 'keeper' : 'kicker');
    } else {setKickerId(null);setSelectedKeeperId(null);setScreen('kicker');}
  };
  const changeScreen = (next: Screen) => { if (!writing.current && !attempt.current) { setupAttempt.current = null; setSaveError(false); setSaveErrorMessage(null); setCompleted(null); contentScroll.current?.scrollTo({y: 0, animated: false}); if (next === 'finish') setFinishChoice(null); setScreen(next); } };
  const chooseKicker = (id: string) => {
    if (writing.current || attempt.current || saveError || !kickingRoster.some(member => member.id === id)) return;
    setCompleted(null); setKickerId(id);
    if (keeper) setScreen('result');
    else { setSelectedKeeperId(null); setScreen('keeper'); }
  };
  const finish = (side: 'A' | 'B') => void saveSetup(async () => {
    await onDecided(side);
    logEvent(AnalyticsEvent.ShootoutFinished, { gameId, kicks: kicks.length, scoredA: scoredOf('A'), scoredB: scoredOf('B'), winner: side });
  });
  const undo = () => { if (!last) return; const epoch = uiEpoch.current; void saveSetup(async () => {
    await gameService.undoLastShootoutKick(gameId, last.id);
    if (visibleRef.current && uiEpoch.current === epoch) { setShadow({ base: signature, kicks: kicks.slice(0, -1) }); setKickerId(null); setScreen('kicker'); }
    logEvent(AnalyticsEvent.ShootoutKickUndone, { gameId, kickIndex: kicks.length - 1, team: last.team });
  }); };
  const saveEdit = () => { if (!edit || !edit.outcome) return; const epoch = uiEpoch.current; void saveSetup(async () => {
    await gameService.updateLastShootoutKick(gameId, edit.id, { kickerId: edit.kickerId, keeperId: edit.keeperId, outcome: edit.outcome! }, roundId);
    if (visibleRef.current && uiEpoch.current === epoch) { setShadow({ base: signature, kicks: kicks.map(k => k.id === edit.id ? { ...edit, scored: edit.outcome === 'goal' } : k) }); setEdit(null); setEditRole(null); setScreen('log'); }
  }); };
  const person = (m: RosterMember | undefined, role: string, side: 'A' | 'B', onChange?: () => void) => <View style={[s.person, screen === 'edit' && layout.editPerson, { borderColor: tint(side) + '60' }]}>{m && <UserAvatar user={m} size={40}/>}<View style={s.flex}><Text style={s.personRole}>{role}</Text><Text style={s.name}>{m?.name ?? 'בחרו שחקן'}</Text><Text style={[s.small, { color: tint(side) }]}>{label(side)}</Text></View>{onChange && <Pressable style={s.linkButton} onPress={onChange} disabled={busy || saveError}><Text style={s.link}>שינוי</Text></Pressable>}</View>;
  const grid = (players: RosterMember[], choose: (id: string) => void) => <View style={s.grid}>{players.map(m => <Pressable key={m.id} style={s.candidate} disabled={busy || saveError} onPress={() => choose(m.id)} accessibilityRole="button" accessibilityLabel={m.name}><UserAvatar user={m} size={42}/><Text style={s.candidateName} numberOfLines={2}>{m.name}</Text></Pressable>)}{players.length === 0 && <Text style={s.error}>אין שחקנים לבחירה בהרכב הזה</Text>}</View>;
  const outcomeButtons = (choose: (key: PenaltyOutcome) => void, selected?: PenaltyOutcome, horizontal = false) => penaltyOutcomeButtons({onSelect:choose,selected,disabled:busy||saveError,horizontal,stacked:horizontal&&compact&&largeText});
  const core = screen === 'kicker' || screen === 'keeper' || screen === 'result';
  const title = screen === 'log' ? 'יומן הפנדלים' : screen === 'edit' ? 'תיקון הבעיטה האחרונה' : screen === 'undo' ? 'ביטול הבעיטה האחרונה' : screen === 'finish' ? 'סיום הפנדלים' : 'פנדלים';
  const summary = screen === 'log' || screen === 'finish';
  const leading: 'A' | 'B' | null = scoredOf('A') === scoredOf('B') ? null : scoredOf('A') > scoredOf('B') ? 'A' : 'B';
  const finishSide = leading ?? finishChoice;
  const finishDisabled = busy || saveError || !kicks.length || !finishSide || !rotation || !draftTeams;
  const editSide = edit?.team ?? 'A', editOther = editSide === 'A' ? 'B' : 'A';
  const pitchTeam = completed?.team ?? attempt.current?.team ?? kickingTeam;
  const pitchOther = pitchTeam === 'A' ? 'B' : 'A';
  const pitchKicker = completed?.kicker ?? attemptPeople.current?.kicker ?? rosterOf(pitchTeam).find(member => member.id === (attempt.current?.kickerId ?? kickerId));
  const pitchKeeper = completed?.keeper ?? attemptPeople.current?.keeper ?? rosterOf(pitchOther).find(member => member.id === (attempt.current?.keeperId ?? selectedKeeperId));
  const primary: PitchParticipant = { player: pitchKicker, label: 'בועט', teamLabel: label(pitchTeam), color: shirtColor(pitchTeam), ink: tint(pitchTeam), onEdit: () => changeScreen('kicker') };
  const secondary: PitchParticipant = { player: pitchKeeper, label: 'שוער', teamLabel: label(pitchOther), color: shirtColor(pitchOther), ink: tint(pitchOther), onEdit: () => changeScreen('keeper') };
  const headerTeam = attempt.current ? pitchTeam : kickingTeam;
  const headerOther = headerTeam === 'A' ? 'B' : 'A';
  const headerContext = completed ? compact ? `הבאים: ${label(kickingTeam)}` : `הבעיטה הבאה: ${label(kickingTeam)} מול ${label(defendingTeam)}` : compact ? `${label(headerTeam)} מול ${label(headerOther)}` : `${label(headerTeam)} בועטים מול ${label(headerOther)}`;
  return <SafeModal visible={visible} transparent animationType="slide" onRequestClose={decisionContent ? onDecisionClose : close}>{decisionContent ?? <View style={s.backdrop}><Pressable style={StyleSheet.absoluteFill} onPress={close}/><View testID="penalty-dialog" style={[s.sheet, compact && s.compactSheet, { height: sheetHeight, maxHeight: sheetHeight }]}>
    <View style={s.header}>{core && <View style={s.headerShirts}><TeamShirtIllustration color={shirtColor(headerTeam)} width={compact ? 24 : 32}/><TeamShirtIllustration color={shirtColor(headerOther)} width={compact ? 24 : 32}/></View>}<View style={s.flex}><Text maxFontSizeMultiplier={compact ? 1.15 : undefined} style={[s.title, compact && s.compactTitle, core && { color: tint(headerTeam) }]}>{title}</Text>{summary && <Text style={s.headerSubtitle}>{`משחק ${rotation?.round ?? 1}`}</Text>}{core && <Text style={[s.headerSubtitle, compact && s.compactSubtitle]} maxFontSizeMultiplier={compact ? 1.15 : 1.2}>{headerContext}</Text>}</View><Pressable style={s.close} onPress={close} disabled={busy} accessibilityRole="button" accessibilityLabel="חזרה למשחק"><Ionicons name="close" size={24} color="#12234D"/></Pressable></View>
    {screen !== 'first' && screen !== 'undo' && !core && !summary && <View style={s.score}><Text style={s.scoreCaption}>תוצאת הפנדלים</Text><View style={s.scoreRow}>{(['A','B'] as const).map(side => <View key={side} style={s.scoreHalf}><Text style={[s.scoreName, { color: tint(side) }]}>{label(side)}</Text><Text style={s.scoreNumber}>{scoredOf(side)}</Text><Text style={s.small}>{takenOf(side) === 1 ? 'בעיטה אחת' : `${takenOf(side)} בעיטות`}</Text></View>)}</View></View>}
    <ScrollView ref={contentScroll} style={[s.content, layout.content]} contentContainerStyle={[s.contentInner, layout.inner, compact && s.compactContent, !core && !summary && layout.centered]}>
      {summary && draftTeams && rotation ? <ShootoutScorePanel draftTeams={draftTeams} rotation={rotation} kicks={kicks} compact showDots={screen === 'log'} caption={screen === 'finish' && leading ? `${label(leading)} מובילים בפנדלים` : undefined}/> : null}
      {screen === 'first' ? <View testID="penalty-first-stage" style={layout.firstStage}>
        <MatchActionPitch mode="penalty" primary={{label:'',color:shirtColor('A')}} secondary={{label:'',color:shirtColor('B')}} teamPreview activeRole={null} status="idle" visible={visible} height={compact ? 100 : Math.min(150, height * 0.20)}/>
        <View style={layout.firstHeading}><Text style={s.question}>מי בועטים ראשונים?</Text><Text style={s.small}>בחרו קבוצה או הגרילו</Text></View>
        <View style={layout.firstTeams}>{(['A','B'] as const).map(side => {
          const roster = rosterOf(side), remaining = Math.max(0, roster.length - 2);
          return <View key={side} style={[layout.firstTeam, compact && {minHeight:110}, {borderColor:shirtColor(side),backgroundColor:shirtColor(side)+'0D'}, (busy || saveError) && s.disabled]}><Pressable disabled={busy || saveError} accessibilityRole="button" accessibilityLabel={`${label(side)} בועטים ראשונים`} accessibilityHint={roster.map(player => player.name).join(', ')} accessibilityState={{disabled:busy || saveError}} style={{alignSelf:'stretch',alignItems:'center',gap:7}} onPress={() => startFirst(side)}>
            <TeamShirtIllustration color={shirtColor(side)} width={compact ? 40 : 48}/><Text numberOfLines={2} style={[layout.firstTeamName,{color:tint(side)}]}>{label(side)}</Text>
            <View style={layout.firstRoster}>{roster.slice(0,2).map(player => <View key={player.id} style={layout.firstPlayer}><UserAvatar user={player} size={compact ? 30 : 38}/><Text numberOfLines={2} ellipsizeMode="tail" style={layout.firstPlayerName}>{player.name}</Text></View>)}</View>
            </Pressable><Pressable disabled={busy || saveError || !roster.length} delayLongPress={350} onLongPress={()=>setPeekTeam(side)} onPressOut={()=>setPeekTeam(null)} onTouchCancel={()=>setPeekTeam(null)} accessibilityRole="button" accessibilityLabel={`הצגת ההרכב של ${label(side)}`} accessibilityHint="החזיקו להצגת כל השחקנים ושחררו להסתרה" style={{alignSelf:'stretch',minHeight:44,justifyContent:'center'}}><Text style={layout.firstRemaining}>{!roster.length ? 'ההרכב לא זמין' : remaining === 1 ? 'ושחקן נוסף' : remaining > 1 ? `ועוד ${remaining} שחקנים` : 'כל ההרכב'}</Text><Text style={[layout.firstRemaining,{fontSize:10}]}>החזיקו להצגת ההרכב</Text></Pressable>
          </View>;
        })}</View>
        <Pressable style={[s.secondary,layout.firstDraw]} disabled={busy || saveError} accessibilityRole="button" accessibilityLabel="הגרלת הבועטים הראשונים" accessibilityState={{disabled:busy || saveError}} onPress={() => startFirst(Math.random() < 0.5 ? 'A' : 'B')}><Text style={s.link}>הגרלת הבועטים הראשונים</Text><Ionicons name="shuffle-outline" size={20} color="#2563EB"/></Pressable>
      </View> : core ? <>
    {core && <View style={[s.seriesScore, compact && { paddingVertical: 2 }]} accessibilityLabel={`תוצאת הפנדלים: ${label('A')} ${scoredOf('A')}, ${label('B')} ${scoredOf('B')}`}>{!compact && <Text style={[s.seriesLabel, s.seriesCaption]} maxFontSizeMultiplier={1.2}>פנדלים</Text>}{(['A','B'] as const).map(side => <View key={side} style={s.seriesTeam}><View style={[s.teamDot, { backgroundColor: shirtColor(side) }]}/><Text style={[s.seriesLabel, { color: tint(side) }]} maxFontSizeMultiplier={1.2}>{label(side)}</Text><Text style={s.seriesNumber} maxFontSizeMultiplier={1.2}>{scoredOf(side)}</Text><Text style={s.small} maxFontSizeMultiplier={1.2}>{`(${takenOf(side)})`}</Text></View>)}</View>}
        <MatchActionPitch mode="penalty" primary={primary} secondary={secondary} activeRole={completed ? null : screen === 'kicker' ? 'primary' : screen === 'keeper' ? 'secondary' : null} status={completed ? 'saved' : attempt.current && busy ? 'saving' : attempt.current && saveError ? 'error' : 'idle'} outcome={completed?.outcome ?? attempt.current?.outcome} animationKey={completed?.id ?? attempt.current?.id} visible={visible} disabled={busy || saveError || !!completed} height={compact ? 140 : Math.min(242, height * 0.3)} onAnimationComplete={() => setCompleted(null)}/>
        <View testID="penalty-role-stage" style={[layout.roleStage, { minHeight: pickerMinHeight }]}>{screen === 'kicker' || screen === 'keeper' ? <View testID="penalty-player-selection" style={[s.pickerSection, { minHeight: pickerMinHeight }]}><MatchPlayerPicker players={screen === 'kicker' ? kickingRoster : defendingRoster} onSelect={screen === 'kicker' ? chooseKicker : pickKeeper} selectedId={screen === 'kicker' ? kickerId : selectedKeeperId} disabled={busy || saveError} color={shirtColor(screen === 'kicker' ? kickingTeam : defendingTeam)} ink={tint(screen === 'kicker' ? kickingTeam : defendingTeam)} title={screen === 'kicker' ? 'מי בועט?' : 'מי בשער?'} teamLabel={label(screen === 'kicker' ? kickingTeam : defendingTeam)}/></View> : <><View style={[s.people, largeText && s.peopleStack]}>{person(pitchKicker, 'הבועט', pitchTeam, () => changeScreen('kicker'))}{person(pitchKeeper, 'השוער', pitchOther, () => changeScreen('keeper'))}</View><Text style={s.question}>תוצאת הבעיטה</Text>{pitchKicker && pitchKeeper && outcomeButtons(key => void record(key), attempt.current?.outcome, true)}</>}</View>
      </> : screen === 'log' ? <>
        <View style={v.sectionHeading}><Text style={v.sectionTitle}>הבעיטות שבוצעו</Text><Text style={v.count}>{kicks.length}</Text></View>
        {!kicks.length && <View style={v.empty}><Ionicons name="football-outline" size={36} color="#2563EB"/><Text style={s.question}>עדיין אין בעיטות</Text><Text style={s.small}>אחרי כל בעיטה, הבועט, השוער והתוצאה יופיעו כאן.</Text></View>}
        {draftTeams && rotation && kicks.map((kick, index) => <ShootoutLogRow key={kick.id} kick={kick} index={index} draftTeams={draftTeams} rotation={rotation} resolve={resolve} compact={compact}/>)}
        {last && <View style={[v.logActions, compact && largeText && v.stacked]}>
          <Pressable style={v.logAction} disabled={busy || saveError} accessibilityRole="button" onPress={() => {setEdit({...last, outcome: last.outcome ?? (last.scored ? 'goal' : undefined)});setEditRole(null);changeScreen('edit');}}><Ionicons name="create-outline" size={19} color="#2563EB"/><Text style={[s.link,v.actionText]}>תיקון הבעיטה האחרונה</Text></Pressable>
          <Pressable style={v.logAction} disabled={busy || saveError} accessibilityRole="button" onPress={() => changeScreen('undo')}><Ionicons name="arrow-undo-outline" size={19} color="#B91C1C"/><Text style={[s.error,v.actionText]}>ביטול הבעיטה האחרונה</Text></Pressable>
        </View>}
      </> : screen === 'edit' && edit ? <>{editRole ? <><Text style={s.question}>{editRole === 'kicker' ? 'בחירת בועט' : 'בחירת שוער'}</Text>{grid(rosterOf(editRole === 'kicker' ? editSide : editOther), id => { setEdit({ ...edit, [editRole === 'kicker' ? 'kickerId' : 'keeperId']: id }); setEditRole(null); })}</> : <>{person(rosterOf(editSide).find(m => m.id === edit.kickerId), 'בועט', editSide, () => setEditRole('kicker'))}{person(rosterOf(editOther).find(m => m.id === edit.keeperId), 'שוער', editOther, () => setEditRole('keeper'))}{outcomeButtons(outcome => setEdit({ ...edit, outcome, scored: outcome === 'goal' }), edit.outcome)}<Pressable style={s.primary} disabled={busy || saveError || !edit.outcome} onPress={saveEdit}><Text style={s.primaryText}>שמור תיקון</Text></Pressable></>}</> : screen === 'undo' && last ? <>
        <View style={s.score}><Text style={s.scoreCaption}>תוצאת הפנדלים</Text><View style={s.scoreRow}>{(['A','B'] as const).map(side=><View key={side} style={s.scoreHalf}><View style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5,flexWrap:'wrap'}}><View style={[s.teamDot,{backgroundColor:shirtColor(side)}]}/><Text style={[s.scoreName,{color:tint(side),textAlign:'center'}]}>{label(side)}</Text></View><Text style={s.scoreNumber}>{scoredOf(side)}</Text></View>)}</View></View>
        <View style={{flexDirection:'row',alignItems:'center',gap:12,padding:14,borderRadius:16,backgroundColor:'#FFF5F5',borderWidth:1,borderColor:'#FECACA'}}>
          <UserAvatar user={{id:last.kickerId,name:resolve(last.kickerId).displayName ?? 'שחקן',...resolve(last.kickerId)}} size={52}/>
          <View style={s.flex}><Text style={s.name}>{resolve(last.kickerId).displayName ?? 'שחקן'}</Text><Text style={s.small}>{`${outcomeText(last)} · ${label(last.team)}`}</Text></View>
          <Ionicons name="arrow-undo-outline" size={26} color="#DC2626"/>
        </View>
        <Text style={s.question}>{`לבטל את הבעיטה של ${resolve(last.kickerId).displayName ?? 'השחקן'}?`}</Text>
        <Text style={s.small}>{`הבעיטה תוסר והתור יחזור ל${label(last.team).slice(1)}`}</Text>
      </> : screen === 'finish' ? <>
        {takenOf('A') !== takenOf('B') && <View style={v.warning} accessibilityRole="alert"><Ionicons name="warning-outline" size={23} color="#B45309"/><View style={s.flex}><Text style={s.warningText}>מספר הבעיטות אינו שווה</Text><Text style={s.small}>{`${label('A')} בעטו ${takenOf('A')}, ${label('B')} בעטו ${takenOf('B')}`}</Text></View></View>}
        {!leading && <><Text style={s.question}>הפנדלים בשוויון</Text><Text style={s.small}>אפשר להמשיך בבעיטות או לבחור מנצחים ולאשר את המעבר.</Text><View style={v.manualTeams}>{(['A','B'] as const).map(side => <Pressable key={side} disabled={busy || saveError || !kicks.length} accessibilityRole="button" accessibilityState={{selected: finishChoice === side, disabled: busy || saveError || !kicks.length}} style={[v.manualTeam, {borderColor: finishChoice === side ? tint(side) : '#E2E8F0', backgroundColor: finishChoice === side ? '#EFF6FF' : '#FFFFFF'}]} onPress={() => setFinishChoice(side)}><TeamShirtIllustration color={shirtColor(side)} width={28}/><Text style={[s.link, {color: tint(side)}]}>{label(side)}</Text></Pressable>)}</View></>}
        {finishSide && draftTeams && rotation ? <ShootoutNextMatch draftTeams={draftTeams} rotation={rotation} winner={finishSide}/> : null}
      </> : null}
    </ScrollView>
    {screen === 'finish' && <View style={v.finishActions} testID="penalty-finish-actions">
      <Pressable style={[s.primary, v.finishPrimary, finishDisabled && s.disabled]} disabled={finishDisabled} accessibilityRole="button" accessibilityLabel="אישור ומעבר למשחק הבא" accessibilityState={{disabled: finishDisabled}} onPress={() => {if (!finishDisabled && finishSide) finish(finishSide);}}><Text style={s.primaryText}>אישור ומעבר למשחק הבא</Text></Pressable>
      <Pressable style={[s.secondary,v.finishSecondary]} disabled={busy || saveError} accessibilityRole="button" onPress={() => changeScreen('kicker')}><Text style={s.link}>המשך בעיטות</Text></Pressable>
    </View>}
    {screen === 'undo' && last && <Pressable testID="penalty-undo-confirm" style={[s.primary,{backgroundColor:'#DC2626',flexShrink:0}]} disabled={busy || saveError} onPress={undo} accessibilityRole="button" accessibilityLabel="בטל בעיטה"><Text style={s.primaryText}>בטל בעיטה</Text></Pressable>}

    {busy && <ActivityIndicator color="#2563EB"/>}
    {saveError && <View style={s.errorBox}><Text style={s.error} accessibilityRole="alert">{saveErrorMessage ?? (reselectAllowed ? 'ההרכב השתנה. בחרו שוב שחקנים לפני השמירה.' : 'לא התקבל אישור לשמירה')}</Text><Pressable style={s.primary} disabled={busy} onPress={reselectAllowed ? restartSelection : () => attempt.current ? void record() : setupAttempt.current ? void saveSetup(setupAttempt.current) : setSaveError(false)}><Text style={s.primaryText}>{reselectAllowed ? 'בחירת שחקנים מחדש' : 'ניסיון חוזר'}</Text></Pressable></View>}
    <View style={[s.footer,screen === 'log' && v.logFooter]}>{screen === 'log' && <Pressable style={[s.primary,layout.footerItem]} disabled={busy || saveError} onPress={() => changeScreen('kicker')} accessibilityRole="button"><Text style={s.primaryText}>חזרה לבעיטות</Text></Pressable>}{onChangeDecision && <Pressable style={[s.linkButton,layout.footerItem]} disabled={busy || saveError || !!attempt.current || !!setupAttempt.current} accessibilityRole="button" accessibilityLabel="חזור לבחירת שיטת ההכרעה" accessibilityState={{disabled:busy || saveError || !!attempt.current || !!setupAttempt.current}} onPress={() => { if (!writing.current && !attempt.current && !setupAttempt.current && !saveError) { if (!kicks.length && screen !== 'first') changeScreen('first'); else onChangeDecision(); } }}><Text style={[s.link,(busy || saveError) && s.muted]}>חזור לבחירה</Text></Pressable>}{core ? <><Pressable disabled={busy || !!attempt.current} style={[s.linkButton,layout.footerItem]} onPress={() => changeScreen('log')}><Text style={s.link}>יומן בעיטות</Text></Pressable><Pressable disabled={busy || !kicks.length || !!attempt.current} style={[s.linkButton,layout.footerItem]} onPress={() => changeScreen('finish')}><Text style={[s.link, !kicks.length && s.muted]}>סיום פנדלים</Text></Pressable></> : screen !== 'first' && screen !== 'finish' && screen !== 'log' ? <Pressable style={[s.linkButton,layout.footerItem]} disabled={busy} onPress={() => { setEdit(null); setEditRole(null); changeScreen('log'); }}><Text style={s.link}>חזרה ליומן</Text></Pressable> : null}</View>
    {peekTeam && <View testID="penalty-roster-peek" pointerEvents="none" accessibilityLiveRegion="polite" style={{position:'absolute',top:65,bottom:76,start:12,end:12,zIndex:10,borderWidth:1,borderColor:shirtColor(peekTeam),borderRadius:18,backgroundColor:'#FFFFFFFA',padding:12,justifyContent:'center',gap:12}}><Text style={[s.question,{color:tint(peekTeam)}]}>{`ההרכב של ${label(peekTeam)}`}</Text><View style={{flexDirection:'row',flexWrap:'wrap',rowGap:9}}>{rosterOf(peekTeam).map(player=><View key={player.id} style={{width:'25%',alignItems:'center',gap:4}}><UserAvatar user={player} size={compact ? 28 : 40}/><Text numberOfLines={2} style={layout.firstPlayerName}>{player.name}</Text></View>)}</View><Text style={layout.firstRemaining}>שחררו להסתרה</Text></View>}
  </View></View>}</SafeModal>;
}
const s = StyleSheet.create({ backdrop: { flex: 1, backgroundColor: '#0B122080', justifyContent: 'flex-end' }, sheet: { width: '100%', backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 16, gap: 9, flexShrink: 1 }, compactSheet: { padding: 8, gap: 4 }, compactTitle: { fontSize: 21 }, compactSubtitle: { fontSize: 11, lineHeight: 15 }, compactContent: { gap: 4, paddingBottom: 0 }, header: { flexDirection: 'row', alignItems: 'center', gap: 8 }, headerShirts: { flexDirection: 'row', gap: 2 }, headerSubtitle: { color: '#64748B', fontSize: 12, textAlign: RTL_LABEL_ALIGN, marginTop: 3 }, flex: { flex: 1 }, title: { fontSize: 23, fontWeight: '800', color: '#12234D', textAlign: RTL_LABEL_ALIGN }, close: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' }, content: { flexShrink: 1 }, contentInner: { gap: 9, paddingBottom: 5 }, pickerSection: { flexShrink: 0 }, score: { backgroundColor: '#EAF3FF', borderRadius: 15, padding: 10, gap: 5 }, scoreCaption: { color: '#12234D', fontSize: 12, fontWeight: '700', textAlign: 'center' }, scoreRow: { flexDirection: 'row' }, scoreHalf: { flex: 1, alignItems: 'center', gap: 3 }, scoreName: { fontSize: 15, fontWeight: '800' }, scoreNumber: { color: '#0F172A', fontSize: 31, fontWeight: '900' }, small: { color: '#64748B', fontSize: 11, textAlign: RTL_LABEL_ALIGN, lineHeight: 17 }, question: { color: '#12234D', fontSize: 19, fontWeight: '800', textAlign: RTL_LABEL_ALIGN, paddingVertical: 5 }, turn: { alignSelf: 'center', padding: 5, fontSize: 13, fontWeight: '800' }, grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }, candidate: { width: '33.333%', minHeight: 78, alignItems: 'center', gap: 5, padding: 4 }, candidateName: { fontSize: 12, color: '#12234D', textAlign: 'center' }, people: { flexDirection: 'row', gap: 7 }, peopleStack: { flexDirection: 'column' }, person: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F8FBFF', borderWidth: 1, borderRadius: 12, padding: 8, minWidth: 0, minHeight: 72 }, personRole: { fontSize: 10, color: '#64748B', textAlign: RTL_LABEL_ALIGN }, name: { fontSize: 13, fontWeight: '700', color: '#12234D', textAlign: RTL_LABEL_ALIGN }, outcomes: { gap: 8 }, outcomesRow: { flexDirection: 'row' }, outcomesStack: { flexDirection: 'column' }, compactOutcome: { flex: 1, minHeight: 52, paddingHorizontal: 5, justifyContent: 'center' }, compactOutcomeText: { fontSize: 18 }, disabled: { opacity: 0.5 }, seriesScore: { borderWidth: 1, borderColor: '#DCE8FA', minHeight: 66, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 7, paddingVertical: 5, paddingHorizontal: 7, backgroundColor: '#F8FAFC', borderRadius: 10 }, seriesLabel: { fontSize: 11, color: '#64748B', fontWeight: '700' }, seriesCaption: { width: '100%' }, seriesTeam: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }, seriesNumber: { fontSize: 25, color: '#12234D', fontWeight: '800' }, teamDot: { width: 7, height: 7, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: '#CBD5E1' }, outcome: { minHeight: 56, borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, outcomeText: { fontSize: 22, fontWeight: '800', flex: 1, textAlign: 'center' }, primary: { minHeight: 52, borderRadius: 12, backgroundColor: '#2563EB', justifyContent: 'center', alignItems: 'center', padding: 10 }, primaryText: { color: '#FFF', fontSize: 16, fontWeight: '800', textAlign: 'center' }, secondary: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#BFDBFE', justifyContent: 'center', alignItems: 'center', padding: 10 }, link: { color: '#2563EB', fontSize: 13, fontWeight: '700', textAlign: 'center' }, linkButton: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }, footer: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#E2E8F0' }, muted: { color: '#94A3B8' }, logRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E2E8F0' }, resultText: { color: '#172554', fontWeight: '700', fontSize: 12 }, warning: { borderWidth: 1, borderColor: '#FDBA74', borderRadius: 12, backgroundColor: '#FFF7ED', padding: 10, gap: 4 }, warningText: { color: '#C2410C', fontWeight: '800', textAlign: RTL_LABEL_ALIGN }, error: { color: '#B91C1C', fontSize: 12, textAlign: RTL_LABEL_ALIGN }, errorBox: { gap: 8 } });

const v = StyleSheet.create({
  sectionHeading:{flexDirection:'row',alignItems:'center',gap:8,marginTop:3},sectionTitle:{fontSize:17,fontWeight:'800',color:'#12234D',textAlign:RTL_LABEL_ALIGN},count:{fontSize:12,fontWeight:'800',color:'#334D7C',backgroundColor:'#EAF3FF',borderRadius:10,paddingHorizontal:8,paddingVertical:3},
  empty:{alignItems:'center',gap:8,padding:16},logActions:{flexDirection:'row',borderRadius:14,backgroundColor:'#F1F5F9',padding:4,gap:4},stacked:{flexDirection:'column'},logAction:{flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5,padding:7,minHeight:48},actionText:{flexShrink:1,textAlign:'center'},
  logFooter:{alignItems:'center',gap:8,paddingTop:9},finishActions:{flexShrink:0,gap:6,paddingTop:4},finishPrimary:{minHeight:48},finishSecondary:{minHeight:44},hint:{fontSize:11,lineHeight:16,color:'#64748B',textAlign:'center'},
  warning:{flexDirection:'row',alignItems:'center',gap:8,padding:10,borderRadius:14,borderWidth:1,borderColor:'#FCD38D',backgroundColor:'#FFF7ED'},manualTeams:{flexDirection:'row',gap:8},manualTeam:{flex:1,minWidth:0,borderWidth:1,borderRadius:12,padding:10,alignItems:'center',gap:5,minHeight:64},
});
