import React, { useState } from 'react';
import { observeCaughtError } from '@/utils/errorObservation';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeModal } from '@/components/SafeModal';
import { DraftMethodCard } from '@/components/draft/DraftMethodCard';
import { DraftPlayerRow } from '@/components/draft/DraftPlayerRow';
import { DraftTeamCard, type DraftUserLite } from '@/components/draft/DraftTeamCard';
import { DraftOrderPath } from '@/components/draft/DraftOrderPath';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { overlayTheme } from '@/theme/overlays';
import { teamSizeFromFormat, TEAM_COUNT_MAX, type Game, type GameFormat, type DraftTeam } from '@/types';
import { generateLiveRoundTeams, hasCurrentMatchData, initialLiveRoundPlan, liveCaptainTurn, liveRoundEditContext, liveRoundTeamSlots, prepareLiveRoundEdit, registeredLiveRoster, type LiveRoundEditPlan, type LiveRoundSplit } from '@/utils/liveRoundEdit';
import { buildPickOrder, type PastSplit } from '@/utils/draft';
import { teamName } from './rotationView';

const METHODS: { id: LiveRoundSplit; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'keep', label: 'שמירת ההרכבים הקיימים', hint: 'מתאים לשינוי משך, כללים או סדר המשחק', icon: 'checkmark-circle-outline' },
  { id: 'rating', label: 'לפי דירוג', hint: 'חלוקה לפי דירוגי המנהל והחלוקות האחרונות', icon: 'sparkles-outline' },
  { id: 'random', label: 'חלוקה אקראית', hint: 'הגרלה לקבוצות בגודל מאוזן', icon: 'shuffle-outline' },
  { id: 'regular', label: 'קפטנים בסדר רגיל', hint: 'בוחרים קפטנים ואחריהם שחקנים לפי התור', icon: 'people-outline' },
  { id: 'snake', label: 'קפטנים בסדר נחש', hint: 'סדר הבחירה מתהפך בכל סבב', icon: 'people-outline' },
  { id: 'manual', label: 'חלוקה ידנית', hint: 'בוחרים קבוצה ומשבצים אליה שחקנים', icon: 'hand-left-outline' },
];
const TITLES = ['עריכת המחזור', 'איך לחלק את הכוחות?', 'הקבוצות להמשך', 'בדיקה לפני שמירה', 'איפוס המשחק הנוכחי'];

export function LiveRoundEditModal({ game, players, ratings, canUseRating, loadHistory, busy, stale, error, onSave, onClose }: {
  game: Game; players: Record<string, DraftUserLite>; ratings: Record<string, number>; canUseRating: boolean;
  loadHistory: () => Promise<PastSplit[]>; busy: boolean; stale: boolean; error?: string;
  onSave: (plan: LiveRoundEditPlan, resetConfirmed: boolean) => void; onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const [plan, setPlan] = useState(() => initialLiveRoundPlan(game));
  const [step, setStep] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [localError, setLocalError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const disabled = busy || stale || generating;
  const pitch = teamSizeFromFormat(plan.format), count = plan.activeIds.length;
  const minSize = Math.floor(count / plan.numberOfTeams), maxSize = Math.ceil(count / plan.numberOfTeams);
  const original = initialLiveRoundPlan(game);
  const canKeep = plan.numberOfTeams === original.numberOfTeams && plan.activeIds.length === original.activeIds.length && plan.activeIds.every(id => original.activeIds.includes(id));
  const reset = hasCurrentMatchData(game.liveMatch), round = game.rotation?.round ?? 1;
  const captainMode = plan.method === 'regular' || plan.method === 'snake';
  const unassigned = plan.activeIds.filter(id => !plan.teams.some(t => t.playerIds.includes(id)));
  const captainSlot = plan.teams.findIndex(t => !t.playerIds.length);
  const turn = captainMode ? (captainSlot >= 0 ? captainSlot : liveCaptainTurn(plan.teams, count, plan.method as 'regular' | 'snake')) : target;
  const resolve = (id: string): DraftUserLite => players[id] ?? { id, name: 'משתתף' };
  const name = (id: string) => resolve(id).name;
  const patch = (value: Partial<LiveRoundEditPlan>) => { setPlan(p => ({ ...p, ...value })); setLocalError(''); };
  const close = () => { if (!busy && !generating) onClose(); };
  const back = () => { if (busy || generating) return; setLocalError(''); if (step === 0) close(); else setStep(step - 1); };
  const setTeams = (teams: DraftTeam[]) => {
    const indices = teams.map(t => t.index);
    const sequence = [...plan.playing, ...plan.waiting].filter(i => indices.includes(i));
    for (const i of indices) if (!sequence.includes(i)) sequence.push(i);
    patch({ teams, playing: [sequence[0], sequence[1]], waiting: sequence.slice(2) });
  };
  const generate = async () => {
    setLocalError(''); setSelected(null); setTarget(0);
    if (plan.method === 'keep') { setTeams(original.teams); setStep(2); return; }
    if (plan.method === 'regular' || plan.method === 'snake' || plan.method === 'manual') {
      setTeams(liveRoundTeamSlots(game, plan.numberOfTeams).map(t => ({ ...t, captainId: '', playerIds: [] })));
      setStep(2); return;
    }
    setGenerating(true);
    try {
      const history = plan.method === 'rating' ? await loadHistory() : [];
      setTeams(generateLiveRoundTeams(game, plan, ratings, history)); setStep(2);
    } catch (error) { observeCaughtError(error, { source: 'src/components/match/LiveRoundEditModal.tsx', handler: 'generate', site: 'liveRoundEdit:generate' }); setLocalError('לא הצלחנו להכין את החלוקה. יש לבדוק את החיבור ולנסות שוב.'); }
    finally { setGenerating(false); }
  };
  const assign = (id: string) => {
    if (disabled || turn === null || turn < 0 || turn >= plan.teams.length) return;
    if (plan.teams[turn].playerIds.length >= maxSize) { setLocalError('הקבוצה מלאה. יש לבחור קבוצה אחרת.'); return; }
    setTeams(plan.teams.map((t, i) => i === turn ? { ...t, captainId: t.captainId || id, playerIds: [...t.playerIds, id] } : t));
  };
  const swap = (id: string) => {
    if (!selected) { setSelected(id); return; }
    if (selected === id) { setSelected(null); return; }
    setTeams(plan.teams.map(t => {
      const playerIds = t.playerIds.map(p => p === selected ? id : p === id ? selected : p);
      const captainId = t.captainId === selected ? id : t.captainId === id ? selected : t.captainId;
      return { ...t, playerIds, captainId };
    })); if (plan.method === 'keep') patch({ method: 'manual' }); setSelected(null);
  };
  const moveTo = (index: number) => {
    if (!selected || plan.teams[index].playerIds.length >= maxSize) return;
    setTeams(plan.teams.map((t, i) => {
      const playerIds = t.playerIds.filter(id => id !== selected);
      if (i === index) playerIds.push(selected);
      return { ...t, playerIds, captainId: playerIds.includes(t.captainId) ? t.captainId : playerIds[0] ?? '' };
    })); if (plan.method === 'keep') patch({ method: 'manual' }); setSelected(null);
  };
  const review = () => {
    try {
      const cleaned = { ...plan, ruleTags: plan.ruleTags.map(tag => tag.trim()).filter(Boolean) };
      prepareLiveRoundEdit(game, { plan: cleaned, expected: liveRoundEditContext(game)!, operationId: 'preview', resetConfirmed: true });
      setPlan(cleaned);
      setLocalError(''); setStep(3);
    } catch (err) { observeCaughtError(err, { source: 'src/components/match/LiveRoundEditModal.tsx', handler: 'review', site: 'liveRoundEdit:review' }); setLocalError((err as Error).message); }
  };
  const reorder = (position: number, delta: number) => {
    const sequence = [...plan.playing, ...plan.waiting], to = position + delta;
    if (to < 0 || to >= sequence.length) return;
    [sequence[position], sequence[to]] = [sequence[to], sequence[position]];
    patch({ playing: [sequence[0], sequence[1]], waiting: sequence.slice(2) });
  };
  const elapsed = (game.liveMatch?.timerAccumulatedMs ?? 0) + (game.liveMatch?.timerRunning && game.liveMatch.timerLastStartedAt ? Math.max(0, Date.now() - game.liveMatch.timerLastStartedAt) : 0);
  const clock = `${Math.floor(elapsed / 60000).toString().padStart(2, '0')}:${Math.floor(elapsed / 1000 % 60).toString().padStart(2, '0')}`;
  const primary = () => {
    if (step === 0) {
      if (count < Math.max(pitch * 2, plan.numberOfTeams)) { setLocalError(`נדרשים לפחות ${Math.max(pitch * 2, plan.numberOfTeams)} שחקנים להמשך במתכונת הזו.`); return; }
      if (!canKeep && plan.method === 'keep') patch({ method: canUseRating ? 'rating' : 'random' });
      setStep(1);
    } else if (step === 1) void generate();
    else if (step === 2) review();
    else if (step === 3 && reset) { setAcknowledged(false); setStep(4); }
    else onSave(plan, reset && acknowledged);
  };
  const button = step === 0 ? 'המשך לחלוקת הכוחות' : step === 1 ? 'הכנת החלוקה' : step === 2 ? 'המשך לבדיקה' : step === 3 ? (reset ? 'המשך לאישור האיפוס' : 'החלה על המשחק הנוכחי') : 'אישור האיפוס והמשך להשלמות';
  return <SafeModal visible animationType="slide" transparent onRequestClose={back}>
    <View style={s.backdrop}><View style={[s.sheet, { maxHeight: height * 0.94 }]} testID="live-round-editor">
      <View style={s.heading}><Text style={s.title}>{TITLES[step]}</Text><Pressable onPress={back} disabled={busy} style={s.icon} accessibilityRole="button" accessibilityLabel={step ? 'חזרה לעריכה' : 'ביטול העריכה'}><Ionicons name={step ? 'arrow-forward' : 'close'} size={24} color={colors.text}/></Pressable></View>
      <ScrollView key={step} style={{ flexShrink: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.formatCard} testID="live-round-format"><Text style={s.formatHint}>המתכונת במגרש{plan.format === game.format ? ' נשארת' : ''}</Text><Text style={s.format}>{pitch} על {pitch}</Text>
          <Text style={s.formatHint}>{plan.numberOfTeams} קבוצות בסיס, {minSize === maxSize ? minSize : `${minSize} עד ${maxSize}`} שחקנים בכל קבוצה</Text>
          <Text style={s.formatHint}>{minSize < pitch ? 'משלימים מהקבוצות שממתינות לפני תחילת המשחק' : 'גודל הקבוצה במגרש נשמר לפי המתכונת שנבחרה'}</Text></View>
        {step === 0 && <>
          <Text style={s.section}>מי נשארים לשחק? {count} משתתפים</Text><Text style={s.hint}>מסירים סימון ממי שהלכו הביתה. הנתונים שכבר צברו נשמרים.</Text>
          <View style={s.playerList}>{registeredLiveRoster(game).map(id => <DraftPlayerRow key={id} user={resolve(id)} selected={plan.activeIds.includes(id)} disabled={disabled} onPress={() => patch({ activeIds: plan.activeIds.includes(id) ? plan.activeIds.filter(p => p !== id) : [...plan.activeIds, id] })}/>)}</View>
          <Text style={s.section}>מספר קבוצות בסיס</Text><View style={s.wrap}>{Array.from({ length: TEAM_COUNT_MAX - 1 }, (_, i) => i + 2).map(n => <Pressable key={n} accessibilityLabel={`${n} קבוצות`} disabled={disabled} style={[s.chip, plan.numberOfTeams === n && s.chosen]} onPress={() => patch({ numberOfTeams: n })}><Text style={s.text}>{n}</Text></Pressable>)}</View>
          <Text style={s.section}>מתכונת במגרש</Text><View style={s.wrap}>{Array.from({ length: 9 }, (_, i) => i + 3).map(n => <Pressable key={n} disabled={disabled} accessibilityLabel={`${n} על ${n}`} style={[s.chip, pitch === n && s.chosen]} onPress={() => patch({ format: `${n}v${n}` as GameFormat })}><Text style={s.text}>{n} על {n}</Text></Pressable>)}</View>
          <Text style={s.section}>משך משחק בדקות</Text><TextInput style={s.input} accessibilityLabel="משך משחק בדקות" keyboardType="number-pad" editable={!disabled} value={String(plan.matchDurationMinutes)} onChangeText={value => patch({ matchDurationMinutes: Number(value.replace(/[^0-9]/g, '')) })}/><Text style={s.hint}>אפס משאיר את השעון ללא מגבלת זמן.</Text>
          <Text style={s.section}>כללים להמשך</Text><TextInput style={[s.input, s.rules]} accessibilityLabel="כללים להמשך" editable={!disabled} multiline placeholder="כל כלל בשורה נפרדת" value={plan.ruleTags.join('\n')} onChangeText={value => patch({ ruleTags: value.split('\n') })}/>
          <Text style={s.hint}>עד שנים עשר כללים, עד שלושים תווים לכל כלל.</Text>
          <Text style={s.notice}>הגדרת המשלים נשמרת: {game.draftTeams?.completionMode === 'balanced' ? 'השלמות מאוזנות' : (game.advancedFillMode ?? game.draftTeams?.fillMode) === 'permanent' ? 'קבוע' : 'זמני'}.</Text>
          <Text style={s.warning}>השינוי חל על המשחק הנוכחי בלבד. אם נצברו בו זמן או נתונים, תידרש הסכמה מפורשת לאיפוס שלו.</Text>
        </>}
        {step === 1 && <View>{METHODS.filter(m => m.id !== 'rating' || canUseRating).map(method => <DraftMethodCard key={method.id} icon={method.icon} title={method.label} subtitle={method.hint} selected={method.id === plan.method} disabled={disabled || (method.id === 'keep' && !canKeep)} accessibilityLabel={method.label} onPress={() => patch({ method: method.id })}/>)}</View>}
        {step === 2 && <>
          <Text style={s.hint}>{unassigned.length ? captainMode ? captainSlot >= 0 ? 'בחרו קפטן לכל קבוצה לפי הסדר.' : `עכשיו בוחרים עבור ${teamName(plan.teams[turn!].index, plan.teams)}.` : 'בחרו קבוצה ואז שחקן מהרשימה.' : 'להחלפה בין קבוצות, לוחצים על שחקן ואז על השחקן שיחליף אותו.'}</Text>
          {captainMode && captainSlot < 0 && !!unassigned.length && <DraftOrderPath order={buildPickOrder(plan.teams.length, count - plan.teams.length, plan.method as 'regular' | 'snake')} activeIndex={count - unassigned.length - plan.teams.length} captains={plan.teams.map(t => resolve(t.captainId))}/>}
          {plan.teams.map((team, i) => <View key={team.index} style={s.teamBlock}>
            <DraftTeamCard summary index={team.index} colorKey={team.colorKey}
              captain={team.playerIds.length ? resolve(team.playerIds[0]) : { id: '', name: '' }} members={team.playerIds.slice(1).map(resolve)} completionCapacity={pitch}
              highlight={turn === i && !!unassigned.length} selectedUserId={selected}
              onPressTeam={disabled || captainMode ? undefined : () => setTarget(i)}
              onPressUser={disabled || !!unassigned.length && captainMode ? undefined : swap}
              userAccessibilityLabel={user => `בחירת ${user.name} להחלפה`}/>
            {selected && !team.playerIds.includes(selected) && team.playerIds.length < maxSize && <Pressable onPress={() => moveTo(i)} disabled={disabled} style={s.chip}><Text style={s.link}>העברת {name(selected)} לכאן</Text></Pressable>}
          </View>)}
          {!!unassigned.length && <View style={s.playerList}><Text style={s.section}>שחקנים לבחירה, {unassigned.length}</Text>{unassigned.map(id => <DraftPlayerRow key={id} user={resolve(id)} disabled={disabled} actionLabel="בחר" onPress={() => assign(id)} accessibilityLabel={`שיבוץ ${name(id)}`}/>)}</View>}
          {!unassigned.length && <><Text style={s.section}>מי משחקות עכשיו?</Text><Text style={s.hint}>שתי הראשונות עולות למגרש. שאר הקבוצות ממתינות לפי הסדר.</Text>{[...plan.playing, ...plan.waiting].map((team, position, all) => <View key={team} style={s.choice}><Text style={[s.text, s.flex]}>{position + 1}. {teamName(team, plan.teams)}{position < 2 ? ' במגרש' : ' בהמתנה'}</Text>{[-1, 1].map(delta => <Pressable key={delta} disabled={disabled || position + delta < 0 || position + delta >= all.length} style={s.icon} onPress={() => reorder(position, delta)} accessibilityLabel={`${delta === -1 ? 'הקדמת' : 'דחיית'} ${teamName(team, plan.teams)}`}><Ionicons name={delta === -1 ? 'chevron-up' : 'chevron-down'} size={22} color={colors.primary}/></Pressable>)}</View>)}</>}
        </>}
        {step === 3 && <>
          <Text style={s.section}>השינוי יוחל על משחק {round}</Text>
          <Text style={s.text}>משתתפים: {original.activeIds.length} לפני, {count} אחרי.</Text><Text style={s.text}>קבוצות: {original.numberOfTeams} לפני, {plan.numberOfTeams} אחרי.</Text>
          <Text style={s.text}>משך משחק: {plan.matchDurationMinutes ? `${plan.matchDurationMinutes} דקות` : 'ללא מגבלת זמן'}.</Text>
          <Text style={s.text}>חלוקה: {METHODS.find(m => m.id === plan.method)?.label}.</Text>
          <Text style={s.text}>כללים: {plan.ruleTags.filter(Boolean).join(', ') || 'ללא כללים נוספים'}.</Text>
          {plan.teams.map(t => <DraftTeamCard summary key={t.index} index={t.index} colorKey={t.colorKey} captain={resolve(t.playerIds[0])} members={t.playerIds.slice(1).map(resolve)} completionCapacity={pitch}/>)}
          <Text style={s.notice}>המשחקים שכבר נשמרו והסטטיסטיקה שלהם נשארים ללא שינוי. חישוב הסטטיסטיקה ממשיך כרגיל.</Text>
          <Text style={reset ? s.warning : s.hint}>{reset ? 'הזמן, התוצאה וכל נתוני המשחק הנוכחי יתאפסו רק לאחר אישור מפורש ושמירת ההשלמות.' : 'המשחק הנוכחי ריק. ההרכבים יישמרו יחד לאחר בחירת המשלימים, והשעון ימתין להתחלה.'}</Text>
        </>}
        {step === 4 && <>
          <Text style={s.section}>לאפס את משחק {round}?</Text>
          <View style={s.resetCard}><Text style={s.text}>המצב כעת: {game.liveMatch?.scoreA ?? 0} מול {game.liveMatch?.scoreB ?? 0}</Text><Text style={s.clock}>{clock}</Text><Text style={s.text}>אחרי השמירה: אפס מול אפס</Text><Text style={s.clock}>00:00</Text></View>
          <Text style={s.warning}>כל הזמן, התוצאה, השערים, הבישולים והפנדלים של המשחק הנוכחי יימחקו. הוא יתחיל מחדש ולא ייספר כמשחק נוסף.</Text>
          <Text style={s.notice}>האיפוס נוגע רק למשחק {round}. משחקים קודמים, תוצאות וסטטיסטיקות שכבר נשמרו אינם משתנים.</Text>
          <Pressable style={s.choice} accessibilityRole="checkbox" accessibilityLabel="אישור איפוס המשחק הנוכחי בלבד" accessibilityState={{ checked: acknowledged }} disabled={disabled} onPress={() => setAcknowledged(!acknowledged)}><Ionicons name={acknowledged ? 'checkbox' : 'square-outline'} size={24} color={colors.primary}/><Text style={[s.text, s.flex]}>ברור לי שהמשחק הנוכחי מתאפס וכל נתוניו נמחקים.</Text></Pressable>
          <Text style={s.hint}>אם נדרשים משלימים, בוחרים אותם לפני השמירה. ביטול בחירת ההשלמות מבטל גם את השינוי והאיפוס.</Text>
        </>}
      </ScrollView>
      {(stale || error || localError) && <Text style={s.error} accessibilityRole="alert">{stale ? 'מצב המשחק השתנה. יש לסגור ולפתוח מחדש את העריכה לפני שמירה.' : error || localError}</Text>}
      <Pressable testID="live-round-next" style={[s.primary, (disabled || step === 4 && !acknowledged || step === 2 && !!unassigned.length) && s.disabled]} disabled={disabled || step === 4 && !acknowledged || step === 2 && !!unassigned.length} onPress={primary} accessibilityRole="button"><Text style={s.primaryText}>{busy ? 'שומרים את השינוי' : generating ? 'מכינים חלוקה' : button}</Text>{(busy || generating) && <ActivityIndicator color={colors.textOnPrimary}/>}</Pressable>
    </View></View>
  </SafeModal>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: overlayTheme.backdrop },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 12, width: '100%', maxWidth: 640, alignSelf: 'center' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { flex: 1, color: colors.text, fontSize: 22, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, content: { gap: 12, paddingBottom: 12 },
  formatCard: { borderRadius: 18, backgroundColor: '#1E40AF', padding: 16, gap: 5 }, format: { color: '#FFFFFF', fontSize: 38, fontWeight: '900', textAlign: 'center' }, formatHint: { color: '#FFFFFF', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  section: { color: colors.text, fontSize: 16, fontWeight: '800', textAlign: RTL_LABEL_ALIGN }, text: { color: colors.text, fontSize: 15, lineHeight: 23, textAlign: RTL_LABEL_ALIGN, flexShrink: 1 }, hint: { color: colors.textMuted, fontSize: 13, lineHeight: 21, textAlign: RTL_LABEL_ALIGN },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, minHeight: 44, maxWidth: '100%' },
  chosen: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.surfaceMuted }, choice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border }, flex: { flex: 1, minWidth: 0 },
  input: { minHeight: 48, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, textAlign: RTL_LABEL_ALIGN, fontSize: 16 }, rules: { minHeight: 84, textAlignVertical: 'top' },
  warning: { color: colors.danger, backgroundColor: colors.surface, borderRadius: 12, padding: 12, fontSize: 14, lineHeight: 23, textAlign: RTL_LABEL_ALIGN }, notice: { color: colors.text, backgroundColor: colors.surfaceMuted, borderRadius: 12, padding: 12, fontSize: 14, lineHeight: 23, textAlign: RTL_LABEL_ALIGN },
  playerList: { gap: 8 }, teamBlock: { gap: 8 }, link: { color: colors.primary, fontSize: 14, textAlign: RTL_LABEL_ALIGN },
  primary: { minHeight: 54, borderRadius: 14, backgroundColor: colors.primary, padding: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, primaryText: { color: colors.textOnPrimary, fontWeight: '800', fontSize: 16, textAlign: 'center', flexShrink: 1 }, disabled: { opacity: 0.4 }, error: { color: colors.danger, fontSize: 14, lineHeight: 22, textAlign: RTL_LABEL_ALIGN },
  resetCard: { borderRadius: 16, padding: 16, backgroundColor: colors.surfaceMuted, alignItems: 'center', gap: 8 }, clock: { color: colors.text, fontSize: 28, fontWeight: '800', textAlign: 'center' },
});
