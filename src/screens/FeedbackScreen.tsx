// Both menu entries open this form on their own tab; the draft survives tab changes.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { SafeKeyboardAvoidingView } from '@/components/SafeKeyboardAvoidingView';
import { ScreenshotAnnotator } from '@/components/ScreenshotAnnotator';
import { SeasonSummaryIcon } from '@/components/summary/SeasonSummaryIcon';
import { toast } from '@/components/Toast';
import { submitFeedback, captureFeedbackDiagnostics, type FeedbackType } from '@/services/feedbackService';
import { FEEDBACK_IMAGE_LIMIT, pickFeedbackImage, prepareFeedbackImage } from '@/services/feedbackImage';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { he } from '@/i18n/he';
import { colors, RTL_LABEL_ALIGN } from '@/theme';

const MAX_LEN = 2000;
const BLUE = '#2462F6';
type FeedbackParams = { type?: FeedbackType; playerId?: string; playerName?: string };
const screenNames: Record<string, string> = {
  Profile: 'מסך הבית', Home: 'מסך הבית', CommunityDetails: 'פרטי מועדון', CommunityStats: 'סטטיסטיקת המועדון',
  MatchDetails: 'פרטי מחזור', GameDetails: 'פרטי מחזור', LiveMatch: 'המחזור החי', GameLive: 'המחזור החי',
  Communities: 'המועדונים', History: 'היסטוריית המחזורים', Statistics: 'סטטיסטיקה', SeasonSummary: 'סיכום העונה',
  Achievements: 'ארון התארים', SeasonTitles: 'ארון התארים', Requests: 'בקשות הצטרפות', Friends: 'החברים שלי',
  PlayerCard: 'כרטיס שחקן', PlayerTimeline: 'ציר הזמן', Chat: 'השיחה',
};
export function FeedbackScreen() {
  const route = useRoute();
  const params = route.params as FeedbackParams | undefined;
  // Reused navigation entries get a fresh draft/context. In-form tab changes
  // do not change this key or re-capture the diagnostic source.
  return <FeedbackForm key={`${route.key}:${params?.type ?? 'bug'}:${params?.playerId ?? ''}`} params={params} routeName={route.name} />;
}
function FeedbackForm({ params, routeName }: { params?: FeedbackParams; routeName: string }) {
  const nav = useNavigation<NavigationProp<ParamListBase>>();
  const [diagnostics] = useState(() => captureFeedbackDiagnostics(routeName));
  const [type, setType] = useState<FeedbackType>(params?.playerId || params?.type !== 'suggestion' ? 'bug' : 'suggestion');
  const [message, setMessage] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const pickingRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const context = params?.playerId ? `דיווח על השחקן ⁨${params.playerName ?? ''}⁩ (⁦${params.playerId}⁩)\n` : '';
  const limit = Math.max(0, MAX_LEN - context.length);
  const trimmed = message.trim();
  const canSubmit = trimmed.length > 0 && !sending && !picking && !annotating;
  const sourceName = params?.playerId ? 'כרטיס שחקן' : screenNames[diagnostics.screen ?? ''] ?? 'האפליקציה';
  const chooseImage = async () => {
    if (pickingRef.current || inFlight.current) return;
    Keyboard.dismiss(); pickingRef.current = true; setPicking(true);
    try { const selected = await pickFeedbackImage(); if (selected && alive.current) setImage(selected); }
    catch { if (alive.current) toast.error('לא הצלחנו לצרף תמונה. אפשר לנסות שוב ולבדוק את הגישה לתמונות.'); }
    finally { pickingRef.current = false; if (alive.current) setPicking(false); }
  };
  const onAnnotated = async (base64: string) => {
    setAnnotating(false); setPicking(true); pickingRef.current = true;
    try { const result = base64.length < FEEDBACK_IMAGE_LIMIT ? base64 : await prepareFeedbackImage({ uri: `data:image/jpeg;base64,${base64}` }); if (alive.current) setImage(result); }
    catch { if (alive.current) toast.error('לא הצלחנו לשמור את הסימון. התמונה המקורית נשמרה.'); }
    finally { pickingRef.current = false; if (alive.current) setPicking(false); }
  };
  const onSubmit = async () => {
    if (!canSubmit || inFlight.current || pickingRef.current) return;
    inFlight.current = true; setSending(true); Keyboard.dismiss();
    try {
      await submitFeedback(type, context + trimmed, diagnostics.screen ?? routeName, image ?? undefined, type === 'bug' ? 'bug' : 'feature', diagnostics);
      logEvent(AnalyticsEvent.FeedbackSubmitted, { type, length: trimmed.length, fromScreen: routeName });
      if (alive.current) { toast.success(he.feedbackSuccess); if (nav.isFocused()) nav.goBack(); }
    } catch { if (alive.current) toast.error(he.feedbackError); }
    finally { inFlight.current = false; if (alive.current) setSending(false); }
  };
  return <SafeAreaView style={s.root} edges={['top']}>
    <View style={s.brandRow}>
      <Pressable onPress={() => nav.goBack()} disabled={sending} accessibilityRole="button" accessibilityLabel="חזרה" hitSlop={10}><Ionicons name="chevron-forward" size={25} color="#16284E" /></Pressable>
      <View style={s.brand}><View><Text style={s.brandName}>Teamder</Text><Text style={s.brandTagline}>כדורגל מחבר אנשים</Text></View><SeasonSummaryIcon name="ball" size={28} /></View>
    </View>
    <SafeKeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <View style={s.hero}>
          <View pointerEvents="none" style={s.pitch}><Svg width="105" height="82" viewBox="0 0 105 82"><Rect x="2" y="2" width="101" height="78" stroke="#C9D9EC" fill="none" /><Line x1="52" x2="52" y1="2" y2="80" stroke="#C9D9EC" /><Circle cx="52" cy="41" r="13" stroke="#C9D9EC" fill="none" /></Svg></View>
          <Image source={require('../../assets/feedback/bubble-football.png')} style={s.heroImage} resizeMode="contain" accessible={false} />
          <View style={{ flex: 1, gap: 4 }}><Text style={s.heroTitle}>עוזרים לטימדר להשתפר</Text><Text style={s.heroSubtitle}>משהו לא עבד? יש רעיון טוב? אנחנו כאן</Text></View>
        </View>
        <View style={s.tabs} accessibilityRole="tablist">
          {([['bug', 'דיווח על תקלה', 'bug-outline'], ['suggestion', 'הצעה לשיפור', 'bulb-outline']] as const).map(([key, label, icon]) => <Pressable key={key} onPress={() => setType(key)} disabled={sending || (!!params?.playerId && key === 'suggestion')} accessibilityRole="tab" accessibilityState={{ selected: type === key, disabled: sending || (!!params?.playerId && key === 'suggestion') }} style={[s.tab, type === key && s.activeTab]}>
            <Text style={[s.tabLabel, type === key && s.activeLabel]}>{label}</Text><Ionicons name={icon} size={19} color={type === key ? '#FFF' : '#62738F'} />
          </Pressable>)}
        </View>
        <View style={s.card}>
          <View style={s.heading}><Text style={s.headingText}>{type === 'bug' ? 'מה קרה?' : 'מה הרעיון שלך?'}</Text><Ionicons name="document-text-outline" size={21} color="#61769B" /></View>
          {params?.playerId ? <Text style={s.caption}>דיווח על {params.playerName ?? 'השחקן'}</Text> : null}
          <TextInput accessibilityLabel={type === 'bug' ? 'תיאור התקלה' : 'תיאור ההצעה'} value={message} onChangeText={setMessage} editable={!sending} placeholder={type === 'bug' ? 'ספרו לנו מה קרה ומה ניסיתם לעשות…' : 'איזה שיפור הייתם רוצים לראות באפליקציה?'} placeholderTextColor="#9AA8BB" multiline maxLength={limit} textAlignVertical="top" style={s.input} />
          <View style={s.fieldFooter}><View style={s.source}><Text style={s.sourceText}>נשלח מתוך: {sourceName}</Text><Ionicons name="folder-open-outline" size={14} color="#7183A0" /></View><Text style={s.counter}>{`⁦${message.length} / ${limit}⁩`}</Text></View>
        </View>
        <View style={s.card}>
          <View style={s.attachmentRow}>
            <View style={{ flex: 1, gap: 8 }}>
              <View style={s.heading}><Text style={s.headingText}>צילום מסך <Text style={s.optional}>(לא חובה)</Text></Text><Ionicons name="image-outline" size={21} color="#61769B" /></View>
              <Text style={s.caption}>{image ? 'לחצו על התמונה כדי לסמן עליה' : 'אפשר גם לסמן על התמונה'}</Text>
              <Pressable onPress={chooseImage} disabled={sending || picking} accessibilityRole="button" style={s.attachButton}>
                {picking ? <ActivityIndicator size="small" color={BLUE} /> : <><Text style={s.attachText}>{image ? 'החלף צילום מסך' : 'צרף צילום מסך'}</Text><Ionicons name="image-outline" size={19} color={BLUE} /></>}
              </Pressable>
              {image ? <Pressable onPress={() => setImage(null)} disabled={sending || picking} accessibilityRole="button"><Text style={s.removeText}>הסר תמונה</Text></Pressable> : null}
            </View>
            {image ? <Pressable onPress={() => { Keyboard.dismiss(); setAnnotating(true); }} disabled={sending || picking} accessibilityRole="button" accessibilityLabel="סימון על צילום המסך"><Image source={{ uri: `data:image/jpeg;base64,${image}` }} style={s.thumbnail} resizeMode="contain" /></Pressable> : <View style={s.emptyImage}><Ionicons name="images-outline" size={30} color="#B1C7E6" /></View>}
          </View>
          <View style={s.info}><Text style={s.infoText}>פרטי התקלה הטכניים מצורפים אוטומטית</Text><Ionicons name="information-circle-outline" size={17} color="#7183A0" /></View>
        </View>
        <Pressable onPress={onSubmit} disabled={!canSubmit} accessibilityRole="button" accessibilityLabel={type === 'bug' ? 'שלח דיווח' : 'שלח הצעה'} accessibilityState={{ disabled: !canSubmit, busy: sending }} style={[s.submit, !canSubmit && s.submitDisabled]}>
          <Text style={s.submitText}>{sending ? 'שולחים…' : type === 'bug' ? 'שלח דיווח' : 'שלח הצעה'}</Text>{sending ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="paper-plane-outline" size={20} color="#FFF" />}
        </Pressable>
        <View style={s.thanks}><Text style={s.caption}>תודה שעוזרים לנו להשתפר</Text><Ionicons name="heart-outline" size={16} color="#8895AB" /></View>
      </ScrollView>
    </SafeKeyboardAvoidingView>
    <ScreenshotAnnotator visible={annotating} image={image} onCancel={() => setAnnotating(false)} onDone={onAnnotated} />
  </SafeAreaView>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F7FD' },
  brandRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 8 },
  brand: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 },
  brandName: { fontSize: 19, lineHeight: 23, fontWeight: '900', color: '#172A50' },
  brandTagline: { fontSize: 8, lineHeight: 11, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  content: { paddingHorizontal: 16, paddingBottom: 22, gap: 12 },
  hero: { flexDirection: 'row', alignItems: 'center', minHeight: 103, gap: 9 },
  pitch: { position: 'absolute', right: -23, top: 0, opacity: 0.22, transform: [{ rotate: '17deg' }] },
  heroImage: { width: 83, height: 93 },
  heroTitle: { fontSize: 21, lineHeight: 27, fontWeight: '900', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  heroSubtitle: { fontSize: 11, lineHeight: 16, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  tabs: { flexDirection: 'row', backgroundColor: colors.surface, padding: 4, borderRadius: 20, gap: 4 },
  tab: { flex: 1, flexDirection: 'row', minHeight: 40, alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 16, backgroundColor: '#F4F7FB' },
  activeTab: { backgroundColor: BLUE },
  tabLabel: { fontSize: 12, lineHeight: 17, fontWeight: '700', color: '#576A89' },
  activeLabel: { color: '#FFF' },
  card: { backgroundColor: colors.surface, borderRadius: 18, padding: 12, gap: 10 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headingText: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  optional: { fontSize: 10, fontWeight: '400', color: colors.textMuted },
  input: { minHeight: 115, fontSize: 13, lineHeight: 20, color: colors.text, textAlign: 'right', borderWidth: 1, borderColor: '#E1E6EF', borderRadius: 11, padding: 11, backgroundColor: '#FDFEFF' },
  fieldFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  source: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 9, backgroundColor: '#F1F6FD', padding: 6 },
  sourceText: { flexShrink: 1, fontSize: 9, lineHeight: 13, color: '#657996', textAlign: RTL_LABEL_ALIGN },
  counter: { fontSize: 9, color: '#91A0B7' },
  attachmentRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  caption: { fontSize: 11, lineHeight: 16, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  attachButton: { minHeight: 36, padding: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: '#5485F8', borderRadius: 10 },
  attachText: { color: BLUE, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  thumbnail: { width: 83, height: 107, borderRadius: 10, backgroundColor: '#F5F8FD', borderWidth: 1, borderColor: '#E8EFF9' },
  emptyImage: { width: 83, height: 107, borderRadius: 10, backgroundColor: '#F5F8FD', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E8EFF9' },
  removeText: { color: colors.textMuted, fontSize: 10, lineHeight: 14, textAlign: RTL_LABEL_ALIGN },
  info: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EEF4FD', borderRadius: 11, padding: 8 },
  infoText: { flex: 1, fontSize: 10, lineHeight: 15, color: '#697E9D', textAlign: RTL_LABEL_ALIGN },
  submit: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BLUE, borderRadius: 13 },
  submitDisabled: { opacity: 0.48 },
  submitText: { color: '#FFF', fontSize: 15, lineHeight: 21, fontWeight: '700' },
  thanks: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
});
