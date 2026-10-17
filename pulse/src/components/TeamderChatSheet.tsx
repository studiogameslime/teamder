// The "reply as Teamder" sheet.
//
// Opened from a task built out of a report, and from a user's card. Shows the
// whole thread with that person, lets you quote any report they've ever filed,
// and sends as the brand rather than as a personal profile.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, radius } from '../theme';
import {
  listUserReports,
  loadThread,
  quoteReport,
  REPORTS_LIMIT,
  sendTeamderMessage,
  newTeamderMessageId,
  resolveSupportThread,
  reopenSupportThread,
  MAX_TEXT,
  THREAD_WINDOW,
  type TeamderThread,
  type UserReport,
} from '../services/teamderChatService';

const CATEGORY_LABEL: Record<string, string> = {
  bug: 'תקלה',
  ui: 'עיצוב',
  feature: 'רעיון',
};

// Openers worth having on tap: a reply written from scratch every time is the
// reason people stop replying at all.
const TEMPLATES = [
  'קיבלנו, אנחנו בודקים את זה 🙏',
  'תוקן! יצא בגרסה הקרובה 💪',
  'תודה על הדיווח — עוזר לנו מאוד ⚽',
  'אפשר עוד קצת פרטים? מה בדיוק קרה לפני זה?',
];

export function TeamderChatSheet({
  visible,
  userId,
  userName,
  onClose,
  onStatusChanged,
}: {
  visible: boolean;
  userId: string;
  userName: string;
  onClose: () => void;
  onStatusChanged?: () => void;
}) {
  const [thread, setThread] = useState<TeamderThread | null>(null);
  const [reports, setReports] = useState<UserReport[]>([]);
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [pickingQuote, setPickingQuote] = useState(false);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null), nearBottom = useRef(true);
  const drafts = useRef<Record<string, string>>({});
  const updateText = (value: string | ((previous: string) => string)) => setText(previous => {
    const next = typeof value === 'function' ? value(previous) : value;
    drafts.current[userId] = next;
    return next;
  });
  const request = useRef(0), sendingRef = useRef(false);
  const currentTarget = useRef({ userId, visible, userName });
  currentTarget.current = { userId, visible, userName };
  const pending = useRef<Record<string,{ userId: string; body: string; id: string; at: number }>>({});

  const load = useCallback(
    async (force = false, quiet = false) => {
      if (!userId) return;
      const serial = ++request.current;
      if (!quiet) setLoading(true);
      try {
        const [t, r] = await Promise.all([
          loadThread(userId, currentTarget.current.userName, force),
          listUserReports(userId).catch(() => []),
        ]);
        if (request.current !== serial) return;
        setThread(t);
        setReports(r);
        setFailed(false);
      } catch {
        if (request.current === serial) setFailed(true);
      } finally {
        if (request.current === serial) setLoading(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    if (visible) {
      setText(drafts.current[userId] ?? '');
      setPreview(null); nearBottom.current = true;
      setThread(null);
      setReports([]);
      setFailed(false);
      setPickingQuote(false);
      void load(true);
      const timer = setInterval(() => { if (AppState.currentState === 'active' && !sendingRef.current) void load(true, true); }, 15_000);
      return () => { ++request.current; clearInterval(timer); };
    }
  }, [visible, load]);

  const send = async () => {
    const body = text.trim();
    if (!body || sendingRef.current || body.length > MAX_TEXT) return;
    sendingRef.current = true;
    setSending(true);
    if (pending.current[userId]?.body !== body) {
      const at = Date.now();
      pending.current[userId] = { userId, body, at, id: newTeamderMessageId(at) };
    }
    try {
      const attempt = pending.current[userId];
      const ok = await sendTeamderMessage(userId, body, attempt.at, attempt.id);
      if (!ok) throw new Error('send failed');
      delete pending.current[userId];
      drafts.current[userId] = '';
      if (currentTarget.current.userId !== userId || !currentTarget.current.visible) return;
      setText('');
      await load(true);
    } catch {
      if (currentTarget.current.userId === userId && currentTarget.current.visible) Alert.alert('השליחה נכשלה', 'נסה שוב');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const changeResolution = async () => {
    const last = thread?.messages[thread.messages.length - 1];
    if (!last || loading || failed || sendingRef.current) return;
    sendingRef.current = true; setResolving(true);
    try {
      const ok = await (thread?.resolved ? reopenSupportThread(userId) : resolveSupportThread(userId, last.id, last.createdAt));
      if (!ok) throw new Error('RESOLUTION_FAILED');
      onStatusChanged?.();
      if (currentTarget.current.userId === userId && currentTarget.current.visible) await load(true, true);
    } catch {
      if (currentTarget.current.userId === userId && currentTarget.current.visible) Alert.alert('הסימון לא נשמר', 'השיחה נשארה במצבה הקודם. נסו שוב.');
    } finally { sendingRef.current = false; setResolving(false); }
  };

  const applyQuote = (r: UserReport) => {
    // Prepend, so a template already typed stays underneath the quote.
    updateText((prev) => quoteReport(r, userName) + prev);
    setPickingQuote(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* The composer is the bottom-most thing in the sheet, so it needs BOTH
          the keyboard out of its way and the system nav bar out from under it.
          It had neither: the send button sat behind the gesture bar. */}
      <KeyboardAvoidingView
        style={st.wrap}
        behavior="padding"
      >
        <View style={[st.sheet, { paddingBottom: 14 + insets.bottom }]}>
          <View style={st.head}>
            <View style={st.headText}>
              <Text style={font.h2}>{userName || 'שיחה'}</Text>
              <Text style={st.sub}>נשלח בשם ⁦Teamder⁩ · תשובות מתעדכנות אוטומטית</Text>
            </View>
            <Pressable accessibilityLabel="סגירת השיחה" onPress={() => { Keyboard.dismiss(); onClose(); }} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textSoft} />
            </Pressable>
          </View>

          {!loading && !failed && !!thread?.messages.length ? <Pressable
            accessibilityRole="button" accessibilityLabel={thread.resolved ? 'פתיחת השיחה מחדש לטיפול' : 'סמן שיחה כפתורה ללא שליחת הודעה'}
            accessibilityState={{disabled: sending || resolving, busy: resolving}}
            disabled={sending || resolving} onPress={changeResolution}
            style={{flexDirection:'row',direction:'rtl',alignItems:'center',justifyContent:'center',gap:8,padding:12,minHeight:44,borderRadius:radius.md,backgroundColor:colors.primarySoft,marginBottom:10,opacity:sending||resolving?0.6:1}}>
            {resolving ? <ActivityIndicator size="small" color={colors.text}/> : <Ionicons name={thread.resolved ? 'refresh-outline' : 'checkmark-circle-outline'} size={20} color={colors.text}/>}
            <Text style={{...font.body,color:colors.text,fontWeight:'700'}}>{resolving ? 'שומרים…' : thread.resolved ? 'פתורה · פתיחה מחדש' : 'סמן כפתורה ללא תשובה'}</Text>
          </Pressable> : null}

          <ScrollView ref={scroll} style={st.thread} contentContainerStyle={st.threadBody} keyboardShouldPersistTaps="handled" scrollEventThrottle={100}
            onScroll={e => { const n=e.nativeEvent; nearBottom.current=n.contentSize.height-n.layoutMeasurement.height-n.contentOffset.y<90; }}
            onContentSizeChange={() => { if(nearBottom.current) scroll.current?.scrollToEnd({animated:true}); }}>
            {failed ? <Pressable onPress={() => load(true)}><Text style={st.error}>טעינת השיחה נכשלה — לחצו לניסיון חוזר</Text></Pressable> : null}
            {loading && !thread ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
            ) : thread && thread.messages.length > 0 ? (
              thread.messages.map((m) => (
                <View
                  key={m.id}
                  style={[st.bubble, m.fromTeamder ? st.mine : st.theirs]}
                >
                  {m.supportContext ? <View style={st.source}><Text style={st.sourceText}>מתוך: {m.supportContext.screenLabel || m.supportContext.screen}{m.supportContext.step ? ` · שלב ${m.supportContext.step}` : ''}</Text><Text selectable style={st.sourceText}>{[m.supportContext.groupId && `מועדון: ${m.supportContext.groupId}`, m.supportContext.gameId && `מחזור: ${m.supportContext.gameId}`, m.supportContext.appVersion && `גרסה ${m.supportContext.appVersion}`,m.supportContext.platform].filter(Boolean).join(' · ')}</Text></View> : null}
                  {m.supportImage ? <Pressable onPress={() => setPreview(m.supportImage!)} accessibilityLabel="הגדלת צילום המסך"><Image source={{uri:`data:image/jpeg;base64,${m.supportImage}`}} style={st.photo} resizeMode="contain" /></Pressable> : null}
                  <Text selectable style={st.bubbleText}>{m.text}</Text>
                  <Text style={st.time}>{new Date(m.createdAt).toLocaleString('he-IL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})}</Text>
                </View>
              ))
            ) : !failed ? (
              <Text style={st.empty}>עוד לא דיברתם. זו תהיה ההודעה הראשונה.</Text>
            ) : null}
            {thread && thread.messages.length >= THREAD_WINDOW ? <Text style={st.empty}>מוצגות {THREAD_WINDOW} ההודעות האחרונות</Text> : null}
          </ScrollView>

          {pickingQuote ? (
            <View style={st.quotePane}>
              <Text style={st.paneTitle}>
                {reports.length >= REPORTS_LIMIT
                  ? `${REPORTS_LIMIT} הדיווחים האחרונים`
                  : 'איזה דיווח לצטט?'}
              </Text>
              <ScrollView style={st.quoteList}>
                {reports.length === 0 ? (
                  <Text style={st.empty}>למשתמש הזה אין דיווחים</Text>
                ) : (
                  reports.map((r) => (
                    <Pressable key={r.id} onPress={() => applyQuote(r)} style={st.quoteRow}>
                      <Text style={st.quoteText} numberOfLines={2}>
                        {r.message || '(ללא טקסט)'}
                      </Text>
                      <View style={st.quoteMeta}>
                        <Text style={st.quoteMetaTxt}>
                          {CATEGORY_LABEL[r.category] ?? r.category}
                          {r.screen ? ` · ${r.screen}` : ''}
                          {r.createdAt
                            ? ` · ${new Date(r.createdAt).getDate()}.${
                                new Date(r.createdAt).getMonth() + 1
                              }`
                            : ''}
                        </Text>
                        {r.hasImage ? (
                          <Ionicons name="image-outline" size={13} color={colors.textMuted} />
                        ) : null}
                      </View>
                    </Pressable>
                  ))
                )}
              </ScrollView>
              <Pressable onPress={() => setPickingQuote(false)} style={st.paneClose}>
                <Text style={st.chipTxt}>ביטול</Text>
              </Pressable>
            </View>
          ) : (
            <View style={st.chipRow}>
              {/* Pinned, NOT inside the scroller. A horizontal ScrollView
                  starts at x=0 — the LEFT — so in this right-to-left layout
                  the first chip ended up off-screen past the right edge. The
                  primary action can't depend on the user scrolling to find it. */}
              <Pressable disabled={sending || resolving} onPress={() => setPickingQuote(true)} style={[st.chip, st.chipAccent]}>
                <Ionicons name="chatbox-ellipses-outline" size={14} color="#fff" />
                <Text style={[st.chipTxt, { color: '#fff' }]}>צטט דיווח</Text>
              </Pressable>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.chips}>
                {TEMPLATES.map((t) => (
                  <Pressable
                    key={t}
                    disabled={sending || resolving}
                    onPress={() => updateText((prev) => (prev ? `${prev}\n${t}` : t))}
                    style={st.chip}
                  >
                    <Text style={st.chipTxt} numberOfLines={1}>
                      {t}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={st.composer}>
            <TextInput
              value={text}
              onChangeText={updateText}
              maxLength={MAX_TEXT}
              editable={!sending}
              placeholder="כתוב הודעה…"
              placeholderTextColor={colors.textMuted}
              style={st.input}
              multiline
              textAlign="right"
              accessibilityLabel="כתיבת תשובה למשתמש"
            />
            <Pressable
              onPress={send}
              accessibilityLabel="שליחת תשובה למשתמש"
              disabled={!text.trim() || sending || resolving}
              style={[st.send, (!text.trim() || sending) && { opacity: 0.4 }]}
            >
              {sending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="send" size={18} color="#fff" />
              )}
            </Pressable>
          </View>
        </View>
        <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}><View style={{flex:1,backgroundColor:'#000',paddingTop:insets.top+12,paddingBottom:insets.bottom}}><Pressable accessibilityLabel="סגירת צילום" onPress={()=>setPreview(null)} style={{padding:16,alignSelf:'flex-end'}}><Ionicons name="close" size={28} color="#fff"/></Pressable>{preview?<Image source={{uri:`data:image/jpeg;base64,${preview}`}} style={{flex:1,width:'100%'}} resizeMode="contain"/>:null}</View></Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 14,
    height: '90%',
  },
  head: {
    flexDirection: 'row', direction: 'rtl',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headText: { flex: 1 },
  sub: { ...font.small, color: colors.textMuted, textAlign: 'right' },
  thread: { flex: 1 },
  threadBody: { gap: 8, paddingBottom: 8, direction: 'rtl' },
  bubble: { maxWidth: '85%', padding: 10, borderRadius: radius.md },
  mine: { alignSelf: 'flex-start', backgroundColor: colors.primarySoft },
  theirs: { alignSelf: 'flex-end', backgroundColor: colors.surfaceAlt },
  bubbleText: {
    ...font.body,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  empty: { ...font.small, color: colors.textMuted, textAlign: 'center', marginTop: 16 },
  chipRow: {
    flexDirection: 'row', direction: 'rtl',
    alignItems: 'center',
    gap: 6,
    marginVertical: 8,
  },
  chips: { flexGrow: 0, flexShrink: 1 },
  chip: {
    flexDirection: 'row', direction: 'rtl',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginLeft: 6,
    maxWidth: 240,
  },
  chipAccent: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { ...font.small, color: colors.textSoft, fontWeight: '700' },
  quotePane: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    marginVertical: 8,
    maxHeight: 240,
  },
  paneTitle: { ...font.small, color: colors.text, fontWeight: '800', textAlign: 'right' },
  quoteList: { marginTop: 6 },
  quoteRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  quoteText: {
    ...font.small,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  quoteMeta: { flexDirection: 'row', direction: 'rtl', alignItems: 'center', gap: 6, marginTop: 3 },
  quoteMetaTxt: { ...font.small, color: colors.textMuted, textAlign: 'right' },
  paneClose: { alignItems: 'center', paddingTop: 8 },
  composer: { flexDirection: 'row', direction: 'rtl', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    minHeight: 64,
    maxHeight: 140,
    textAlignVertical: 'top',
    writingDirection: 'rtl',
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  source: {paddingBottom:8,marginBottom:8,borderBottomWidth:1,borderBottomColor:colors.border},
  sourceText: {...font.small,color:colors.textMuted,textAlign:'right'},
  photo: {width:190,height:240,borderRadius:10,marginBottom:8},
  time: {...font.small,color:colors.textMuted,fontSize:10,marginTop:6},
  error: { ...font.small, color: colors.amber, padding: 10 },
});
