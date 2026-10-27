import { observeCaughtError } from '../../utils/errorObservation';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeModal } from '@/components/SafeModal';
import { RTL_LABEL_ALIGN } from '@/theme';
import { TeamShirtIllustration } from './TeamShirt';
import { MatchActionPitch } from './MatchActionPitch';
import { MatchPlayerPicker } from './MatchPlayerPicker';
import type { RosterMember } from './rotationView';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';

export interface GoalEntry {
  id: string; team: 'A' | 'B'; scorerId: string | null;
  assisterId?: string | null; assistStatus?: 'player' | 'none' | 'unknown'; ownGoal?: boolean;
}

type GoalStep = 'scorer' | 'assist' | 'own';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function GoalEntryModal({ gameId, side, teamLabel, teamColor, teamInk, otherTeamLabel, otherTeamColor = '#64748B', otherTeamInk = '#334155', roster, ownGoalRoster, minute, roundNumber, onSave, onClose }: {
  gameId: string; side: 'A' | 'B' | null; teamLabel: string; teamColor: string; teamInk: string; otherTeamLabel: string;
  otherTeamColor?: string; otherTeamInk?: string;
  roster: RosterMember[]; ownGoalRoster: RosterMember[]; minute: number; roundNumber: number;
  onSave: (entry: GoalEntry) => Promise<void>; onClose: (saved?: boolean) => void;
}) {
  const { height, width, fontScale } = useWindowDimensions();
  const compact = height < 700 || width < 350 || fontScale > 1.3;
  const pitchHeight = compact ? (height < 650 ? 150 : 170) : Math.min(252, Math.max(170, height * 0.29));
  // Leave room for one complete avatar row, two name lines and the heading.
  // Only the picker scrolls; the footer cannot cover its last visible line.
  const compactPickerMinimum = Math.ceil(100 + 52 * Math.min(fontScale, 1.6));
  const [step, setStep] = useState<GoalStep>('scorer');
  const [scorerId, setScorerId] = useState<string | null>(null);
  const [assisterId, setAssisterId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [reselectAllowed, setReselectAllowed] = useState(false);
  const selection = useRef<{ step: GoalStep; scorerId: string | null }>({ step: 'scorer', scorerId: null });
  const writing = useRef(false);
  const closed = useRef(false);
  const saved = useRef(false);
  const attempt = useRef<GoalEntry | null>(null);
  const attemptPeople = useRef<{ id: string; scorer?: RosterMember; assister?: RosterMember } | null>(null);
  const generation = useRef(0);
  const contextKey = JSON.stringify([gameId, side, roundNumber]);
  const currentContext = useRef(contextKey);

  // Invalidate late acknowledgements whenever this is no longer the same
  // open round. A previous request must never close a newly opened picker.
  useEffect(() => {
    generation.current += 1;
    currentContext.current = contextKey;
    selection.current = { step: 'scorer', scorerId: null };
    writing.current = false; closed.current = false; saved.current = false; attempt.current = null; attemptPeople.current = null;
    setReselectAllowed(false);
    setStep('scorer'); setScorerId(null); setAssisterId(null); setStatus('idle');
    return () => { generation.current += 1; currentContext.current = ''; };
  }, [gameId, side, roundNumber]);

  const rosterKey = JSON.stringify(roster.map(member => member.id));
  useEffect(() => {
    if (status !== 'idle' || writing.current || attempt.current || !scorerId || step === 'own' || roster.some(member => member.id === scorerId)) return;
    // A live lineup change can remove the scorer while the assist picker is
    // open. Do not let a seemingly valid next tap submit that departed player.
    selection.current = { step: 'scorer', scorerId: null };
    setScorerId(null); setAssisterId(null); setStep('scorer');
  }, [rosterKey, scorerId, step, status]);

  const shownAttempt = attempt.current;
  const finishSaved = () => {
    if (!side || !saved.current || closed.current || currentContext.current !== contextKey || !shownAttempt || shownAttempt.id !== attempt.current?.id) return;
    closed.current = true;
    onClose(true);
  };
  const close = () => {
    if (writing.current || closed.current || currentContext.current !== contextKey) return;
    closed.current = true;
    onClose(saved.current ? true : undefined);
  };
  const save = async (data?: Omit<GoalEntry, 'id' | 'team'>) => {
    if (!side || writing.current || saved.current || closed.current || currentContext.current !== contextKey) return;
    const entry = attempt.current ?? (data ? { ...data, team: side, id: `g_${Date.now()}_${Math.random().toString(36).slice(2)}` } : null);
    if (!entry) return;
    // Preserve the same event and selections when acknowledgement fails,
    // including when the server wrote it but the response was lost.
    attempt.current = entry;
    if (attemptPeople.current?.id !== entry.id) attemptPeople.current = {
      id: entry.id,
      scorer: (entry.ownGoal ? ownGoalRoster : roster).find(member => member.id === entry.scorerId),
      assister: roster.find(member => member.id === entry.assisterId),
    };
    const epoch = generation.current;
    writing.current = true; setReselectAllowed(false); setStatus('saving');
    try {
      await onSave(entry);
      if (epoch === generation.current) {
        saved.current = true;
        setStatus('saved');
      }
    } catch (error) {
    observeCaughtError(error, {"source":"src/components/match/GoalEntryModal.tsx","handler":"save","site":"GoalEntryModal:d466f0647a"});
      if (epoch === generation.current) {
        setReselectAllowed((error as {code?:string})?.code === 'LIVE_ROSTER_CHANGED');
        setStatus('error');
      }
    } finally {
      if (epoch === generation.current) writing.current = false;
    }
  };
  const blocked = status !== 'idle';
  const restartSelection = () => {
    if (!reselectAllowed || writing.current || saved.current || closed.current || currentContext.current !== contextKey) return;
    // This code is returned only by an authoritative validation rejection,
    // after the service checked the same id for an already-written event.
    attempt.current = null; attemptPeople.current = null;
    selection.current = { step: 'scorer', scorerId: null };
    setScorerId(null); setAssisterId(null); setStep('scorer'); setReselectAllowed(false); setStatus('idle');
  };
  const canChoose = () => currentContext.current === contextKey && !writing.current && !saved.current && !closed.current && !attempt.current;
  const editScorer = () => {
    if (!canChoose()) return;
    selection.current.step = 'scorer';
    setStep('scorer'); setAssisterId(null);
  };
  const editAssister = () => {
    if (!canChoose() || !selection.current.scorerId) return;
    selection.current.step = 'assist'; setStep('assist');
  };
  const choosePlayer = (id: string) => {
    if (!canChoose()) return;
    const current = selection.current;
    const eligible = current.step === 'own' ? ownGoalRoster : roster;
    if (!eligible.some(member => member.id === id)) return;
    if (current.step === 'scorer') {
      selection.current = { step: 'assist', scorerId: id };
      setScorerId(id); setAssisterId(null); setStep('assist');
    } else if (current.step === 'own') {
      selection.current.scorerId = id;
      setScorerId(id); setAssisterId(null);
      void save({ scorerId: id, ownGoal: true });
    } else if (current.scorerId && current.scorerId !== id) {
      setAssisterId(id);
      void save({ scorerId: current.scorerId, assisterId: id, assistStatus: 'player' });
    }
  };
  const ownGoal = step === 'own' || attempt.current?.ownGoal === true;
  const selectedScorer = attemptPeople.current?.scorer ?? (ownGoal ? ownGoalRoster : roster).find(member => member.id === scorerId);
  const selectedAssister = attemptPeople.current?.assister ?? roster.find(member => member.id === assisterId);
  const players = step === 'own' ? ownGoalRoster : roster;
  const pickerColor = step === 'own' ? otherTeamColor : teamColor;
  const pickerInk = step === 'own' ? otherTeamInk : teamInk;
  const scorerFallback = attempt.current && !attempt.current.scorerId ? 'מבקיע לא ידוע' : undefined;
  const assistFallback = attempt.current?.assistStatus === 'none' ? 'ללא בישול'
    : attempt.current?.assistStatus === 'unknown' ? 'בישול לא ידוע' : ownGoal ? 'ללא בישול' : undefined;
  // Failed saves need more footer space than the normal two-tap flow. Bound
  // that state explicitly and let the pitch/roster scroll above the fixed
  // error and retry action, rather than allowing their minimums to clip it.
  const failed = status === 'error';
  const pitchAndPicker = <>
    <MatchActionPitch mode="goal" visible={side !== null} height={pitchHeight}
      primary={{ player: selectedScorer, label: ownGoal ? 'שער עצמי' : 'כובש', teamLabel: ownGoal ? otherTeamLabel : teamLabel, color: ownGoal ? otherTeamColor : teamColor, ink: ownGoal ? otherTeamInk : teamInk, fallback: scorerFallback, onEdit: editScorer }}
      secondary={{ player: selectedAssister, label: 'מבשל', color: teamColor, ink: teamInk, fallback: assistFallback, onEdit: editAssister }}
      activeRole={blocked ? null : step === 'assist' ? 'secondary' : 'primary'}
      status={status} outcome="goal" celebrationColor={teamInk} disabled={blocked} animationKey={attempt.current?.id} onAnimationComplete={finishSaved}/>
    <View style={[s.selectionArea, compact && { minHeight: compactPickerMinimum, maxHeight: Math.max(compactPickerMinimum, height * 0.35), paddingTop: 8 }]}>
      <MatchPlayerPicker players={players} onSelect={choosePlayer}
        selectedId={assisterId ?? scorerId}
        disabledIds={step === 'assist' && scorerId ? [scorerId] : []}
        disabled={blocked} color={pickerColor} ink={pickerInk}
        title={step === 'scorer' ? 'מי כבש?' : step === 'assist' ? 'מי בישל?' : 'מי כבש לשער שלו?'}
        teamLabel={step === 'own' ? otherTeamLabel : undefined}/>
    </View>
  </>;

  return <SafeModal visible={side !== null} transparent animationType="slide" onRequestClose={close}>
    <View style={s.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="סגירת חלון הגול"/>
      <View style={[s.sheet, { maxHeight: height * 0.92 }, failed && { height: height * 0.92 }]}>
        <View style={[s.header, compact && s.compactHeader]}>
          <TeamShirtIllustration color={teamColor} width={compact ? 42 : 49}/>
          <View style={s.flex}>
            <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[s.title, compact && s.compactTitle, { color: teamInk }]}>{`גול ל${teamLabel.slice(1)}`}</Text>
            <Text style={s.small} numberOfLines={1} maxFontSizeMultiplier={1.15}>{`משחק ${roundNumber} · דקה ${minute}`}</Text>
          </View>
          <Pressable onPress={close} disabled={status === 'saving'} style={s.close} accessibilityRole="button" accessibilityLabel="סגירה" accessibilityState={{ disabled: status === 'saving' }}>
            <Ionicons name="close" size={23} color="#172554"/>
          </Pressable>
        </View>
        {failed ? <ScrollView testID="goal-error-body" style={s.errorBody} contentContainerStyle={s.errorBodyContent} nestedScrollEnabled bounces={false}>
          {pitchAndPicker}
        </ScrollView> : pitchAndPicker}
        <View testID="goal-entry-footer" style={[s.footer, compact && s.compactFooter]}>
          {status === 'error' ? <View key="goal-error-actions" style={s.errorBox}>
            <Text accessibilityRole="alert" style={s.error}>{reselectAllowed ? 'ההרכב השתנה והגול לא נשמר. בחרו שוב את השחקנים.' : 'לא התקבל אישור לשמירת הגול. הבחירה נשמרה.'}</Text>
            <Pressable onPress={reselectAllowed ? restartSelection : () => void save()} style={[s.primary, { backgroundColor: teamInk }]} accessibilityRole="button" accessibilityLabel={reselectAllowed ? 'בחירת שחקנים מחדש' : 'ניסיון חוזר לשמירת הגול'}><Text style={s.primaryText}>{reselectAllowed ? 'בחירת שחקנים מחדש' : 'ניסיון חוזר'}</Text></Pressable>
          </View> : status === 'saving' ? <View style={[s.statusRow, compact && s.compactAction]} accessibilityLiveRegion="polite"><ActivityIndicator color={teamInk}/><Text style={s.statusText}>שומרים את הגול…</Text></View>
            : status === 'saved' ? <View style={[s.statusRow, compact && s.compactAction]} accessibilityLiveRegion="polite"><Ionicons name="checkmark-circle" size={23} color={teamInk}/><Text style={s.statusText}>הגול נשמר</Text></View>
              : step === 'assist' ? <View key="goal-assist-actions" style={[s.actions, compact && s.compactAction]}>
                <Pressable style={[s.secondary, compact && s.compactSecondary]} accessibilityRole="button" accessibilityLabel="ללא בישול" onPress={() => { if (canChoose()) void save({ scorerId: selection.current.scorerId, assisterId: null, assistStatus: 'none' }); }}><Text style={[s.link, compact && s.compactLink]}>ללא בישול</Text></Pressable>
              </View> : step === 'scorer' ? <View key="goal-scorer-actions" style={[s.actions, compact && s.compactAction]}>
                <Pressable style={[s.secondary, compact && s.compactSecondary]} accessibilityRole="button" accessibilityLabel="מבקיע לא ידוע" onPress={() => { if (canChoose()) { setScorerId(null); setAssisterId(null); void save({ scorerId: null }); } }}><Text style={[s.link, compact && s.compactLink]}>מבקיע לא ידוע</Text></Pressable>
                <Pressable style={[s.secondary, compact && s.compactSecondary]} accessibilityRole="button" accessibilityLabel="שער עצמי" onPress={() => {
                  if (!canChoose()) return;
                  logEvent(AnalyticsEvent.OwnGoalPickerOpened, { gameId, team: side ?? '' });
                  selection.current = { step: 'own', scorerId: null };
                  setScorerId(null); setAssisterId(null); setStep('own');
                }}><Text style={[s.link, compact && s.compactLink]}>שער עצמי</Text></Pressable>
              </View> : <Text style={[s.ownHint, compact && s.compactAction]}>{`הגול יתווסף ל${teamLabel.slice(1)}`}</Text>}
          {!compact && <View style={s.change}>{step !== 'scorer' && status === 'idle' && <Pressable style={s.change} onPress={editScorer} accessibilityRole="button" accessibilityLabel="שינוי הכובש"><Text style={s.link}>שינוי הכובש</Text></Pressable>}</View>}
        </View>
      </View>
    </View>
  </SafeModal>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0B122080', justifyContent: 'flex-end' },
  sheet: { width: '100%', backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden', flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 15, paddingVertical: 12 },
  compactHeader: { paddingVertical: 8, paddingHorizontal: 12, gap: 8 },
  flex: { flex: 1 },
  title: { fontSize: 25, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  compactTitle: { fontSize: 21 },
  small: { color: '#64748B', fontSize: 13, textAlign: RTL_LABEL_ALIGN, lineHeight: 20 },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  selectionArea: { paddingHorizontal: 12, paddingTop: 10, flexShrink: 1, minHeight: 130, overflow: 'hidden' },
  footer: { paddingHorizontal: 14, paddingBottom: 12, gap: 3, flexShrink: 0 },
  compactFooter: { paddingBottom: 10, paddingTop: 5 },
  change: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  link: { color: '#2563EB', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 8 },
  secondary: { flex: 1, borderWidth: 1, borderColor: '#D7DFEB', borderRadius: 12, padding: 10, minHeight: 48, justifyContent: 'center' },
  compactAction: { minHeight: 64 },
  compactSecondary: { minHeight: 64, paddingVertical: 6, paddingHorizontal: 8 },
  compactLink: { fontSize: 13 },
  ownHint: { color: '#64748B', fontSize: 14, lineHeight: 21, textAlign: RTL_LABEL_ALIGN, minHeight: 48, paddingVertical: 8 },
  errorBox: { gap: 8, paddingTop: 4 },
  errorBody: { flex: 1, minHeight: 0 },
  errorBodyContent: { paddingBottom: 8 },
  error: { color: '#B91C1C', fontSize: 14, lineHeight: 20, textAlign: RTL_LABEL_ALIGN },
  primary: { borderRadius: 12, minHeight: 48, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  statusRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  statusText: { color: '#334155', fontSize: 15, fontWeight: '600', textAlign: RTL_LABEL_ALIGN },
});
