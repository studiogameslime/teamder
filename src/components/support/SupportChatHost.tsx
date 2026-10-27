import { observeCaughtError } from '../../utils/errorObservation';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Image, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureScreen } from 'react-native-view-shot';
import { SafeModal as Modal } from '@/components/SafeModal';
import { SafeKeyboardAvoidingView } from '@/components/SafeKeyboardAvoidingView';
import { ContextualAuthSheet } from '@/components/auth/ContextualAuthSheet';
import { captureFullScreenBase64 } from '@/native/screenCapture';
import { useUserStore } from '@/store/userStore';
import { useSupportChat, sendSupportDraft, supportAttemptId, supportConversationId, captureSupportContext, type SupportDraft } from '@/services/supportChat';
import { chatService } from '@/services/chatService';
import { setActiveChat, getActiveChat } from '@/services/activeChat';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import type { ChatMessage } from '@/types';
import { formatTime } from '@/utils/format';
import { supportDayLabel } from '@/utils/supportTimeline';
import { SupportFootballIcon } from './SupportFootballIcon';

export function SupportChatHost({ active, hideBubble = false }: { active: boolean; hideBubble?: boolean }) {
  const me = useUserStore(s => s.currentUser);
  const state = useSupportChat();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false), [loadFailed, setLoadFailed] = useState(false);
  const [sending, setSending] = useState(false), [error, setError] = useState('');
  const [capturing, setCapturing] = useState(false), [preview, setPreview] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false), [retry, setRetry] = useState(0);
  const list = useRef<FlatList<ChatMessage>>(null);
  const nearBottom = useRef(true), busy = useRef(false), mounted = useRef(true);
  const authDraft = useRef<{ uid: string; draft: SupportDraft } | null>(null);
  const uid = me?.id;
  const draft = uid ? state.drafts[uid] : undefined;
  const visible = active && state.visible && !!uid;
  const convId = uid ? supportConversationId(uid) : '';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const pending = authDraft.current;
    if (!uid) { authDraft.current = null; setAuthOpen(false); }
    state.resetOwner(uid ?? null);
    setMessages([]); setError(''); setPreview(null); setCapturing(false);
    if (uid && !me?.isGuest && pending) {
      authDraft.current = null; state.open(uid); state.patch(uid, { ...pending.draft, attemptId: undefined });
    }
  }, [uid, me?.isGuest]);
  useEffect(() => {
    let away = 0;
    const sub = AppState.addEventListener('change', next => {
      if (next === 'background') away = Date.now();
      if (next === 'active' && away && Date.now() - away > 30 * 60_000) { useSupportChat.setState({ dismissed: false }); }
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!visible || !uid) return;
    nearBottom.current = true; setLoading(true); setLoadFailed(false);
    const previous = getActiveChat(); setActiveChat(`dm__${convId}`);
    const stop = chatService.subscribeMessages('dm', convId, rows => {
      if (useUserStore.getState().currentUser?.id !== uid) return;
      setMessages(rows); setLoading(false); setLoadFailed(false);
      void chatService.markChatRead(uid, 'dm', convId).catch((caughtError1389365cfe: unknown) => {
    observeCaughtError(caughtError1389365cfe, {"source":"src/components/support/SupportChatHost.tsx","handler":"SupportChatHost","site":"SupportChatHost:1389365cfe"});});
    }, () => { setLoading(false); setLoadFailed(true); });
    return () => { stop(); if (getActiveChat() === `dm__${convId}`) setActiveChat(previous); };
  }, [visible, uid, convId, retry]);
  useEffect(() => {
    if (!capturing || !uid || !draft) return;
    let cancelled = false;
    // No modal animation: allow the native window to disappear before capture.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          if (cancelled || !mounted.current || useUserStore.getState().currentUser?.id !== uid) return;
          const sameSource = () => { const source = captureSupportContext(); return source.screen === draft.context.screen && source.step === draft.context.step && source.groupId === draft.context.groupId && source.gameId === draft.context.gameId; };
          if (!sameSource()) { setError('לא הצלחנו לצלם את המסך. אפשר לנסות שוב או לשלוח בלי צילום.'); return; }
          let image = await captureFullScreenBase64({ quality: 0.35, maxWidth: 540 });
          if (!image) image = await captureScreen({ format: 'jpg', quality: 0.35, result: 'base64', width: 540 });
          if (cancelled || useUserStore.getState().currentUser?.id !== uid) return;
          if (!sameSource()) { setError('לא הצלחנו לצלם את המסך. אפשר לנסות שוב או לשלוח בלי צילום.'); return; }
          if (!image || image.length > 180_000) { setError('לא הצלחנו לצלם את המסך. אפשר לנסות שוב או לשלוח בלי צילום.'); return; }
          state.patch(uid, { image, attemptId: undefined });
        } catch (caughtErrore2a6d0817f) {
          if (cancelled || !mounted.current || useUserStore.getState().currentUser?.id !== uid) return;
    observeCaughtError(caughtErrore2a6d0817f, {"source":"src/components/support/SupportChatHost.tsx","handler":"SupportChatHost","site":"SupportChatHost:e2a6d0817f"}); if (!cancelled) setError('לא הצלחנו לצלם את המסך. אפשר לנסות שוב או לשלוח בלי צילום.'); }
        finally { if (!cancelled && mounted.current) setCapturing(false); }
      })();
    }, Platform.OS === 'ios' ? 700 : 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [capturing, uid]);
  const patch = (change: Partial<SupportDraft>) => { if (uid && !busy.current) { state.patch(uid, { ...change, attemptId: undefined }); setError(''); } };
  const close = () => { if (!capturing) { Keyboard.dismiss(); state.close(); } };
  const send = async () => {
    if (!uid || !draft || busy.current || (!draft.text.trim() && !draft.image)) return;
    if (me?.isGuest) { authDraft.current = { uid, draft: { ...draft } }; setAuthOpen(true); return; }
    const attempt = { ...draft, attemptId: draft.attemptId ?? supportAttemptId() };
    state.patch(uid, { attemptId: attempt.attemptId }); busy.current = true; setSending(true); setError('');
    try {
      await sendSupportDraft(uid, attempt);
      if (useUserStore.getState().currentUser?.id !== uid) return;
      state.patch(uid, { text: '', image: undefined, attemptId: undefined });
      await chatService.touchMyDmEntry(uid, convId, { name: 'Teamder' });
    } catch (caughtError6b3c8ee2f6) {
    observeCaughtError(caughtError6b3c8ee2f6, {"source":"src/components/support/SupportChatHost.tsx","handler":"send","site":"SupportChatHost:6b3c8ee2f6"}); if (useUserStore.getState().currentUser?.id === uid) setError('השליחה נכשלה. ההודעה והצילום נשמרו — נסו שוב.'); }
    finally { busy.current = false; if (mounted.current) setSending(false); }
  };
  return <>
    {active && !hideBubble && uid && !state.dismissed && !visible && !capturing && !authOpen ? <View pointerEvents="box-none" style={[s.launcher, { bottom: 100 + insets.bottom }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="פתיחת עזרה מצוות Teamder" onPress={() => state.open(uid)} style={s.bubble}><SupportFootballIcon /></Pressable>
      <Text style={{fontSize:11,textAlign:'center',color:colors.primary,backgroundColor:colors.surface,borderRadius:7,marginTop:3}}>עזרה</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="הסתרת העזרה לביקור הנוכחי" onPress={state.dismiss} hitSlop={10} style={s.dismiss}><Ionicons name="close" size={13} color={colors.textMuted} /></Pressable>
    </View> : null}
    <Modal visible={visible && !capturing && !authOpen} transparent animationType="none" onRequestClose={close}>
      <SafeKeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityLabel="סגירת התמיכה" style={s.backdrop} onPress={close} />
        <View style={[s.sheet, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <View style={s.handle} />
          <View style={s.head}><Pressable accessibilityLabel="חזרה למסך המקורי" onPress={close} hitSlop={8}><Ionicons name="chevron-forward" size={23} color={colors.text} /></Pressable><View style={s.avatar}><Ionicons name="headset-outline" size={23} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={s.title}>⁦Teamder⁩</Text><Text style={s.sub}>תמיכה ועזרה · שיחה עם הצוות</Text></View></View>
          {draft ? <Text style={s.context}>מתוך: {draft.context.screenLabel}{draft.context.step ? ` · שלב ${draft.context.step}` : ''}</Text> : null}
          {loadFailed ? <Pressable onPress={() => setRetry(v => v + 1)}><Text style={s.error}>טעינת השיחה נכשלה. לחצו לניסיון נוסף.</Text></Pressable> : null}
          {loading ? <ActivityIndicator color={colors.primary} /> : null}
          <FlatList ref={list} data={messages} keyExtractor={m => m.id} style={{ flex: 1 }} contentContainerStyle={s.thread} keyboardShouldPersistTaps="handled"
            ListHeaderComponent={messages.length>=100?<Text style={s.sub}>מוצגות 100 ההודעות האחרונות</Text>:null}
            onScroll={e => { const n = e.nativeEvent; nearBottom.current = n.contentSize.height - n.layoutMeasurement.height - n.contentOffset.y < 90; }} scrollEventThrottle={100}
            onContentSizeChange={() => { if (nearBottom.current) list.current?.scrollToEnd({ animated: true }); }}
            ListEmptyComponent={!loading && !loadFailed ? <Text style={s.welcome}>נתקעתם או משהו לא ברור? כתבו לנו ונחזור אליכם בהקדם.{`\n`}אפשר לצרף צילום של המסך שממנו הגעתם.</Text> : null}
            renderItem={({ item, index }) => <>
              {supportDayLabel(item.createdAt, messages[index - 1]?.createdAt) ? <Text style={s.day}>{supportDayLabel(item.createdAt, messages[index - 1]?.createdAt)}</Text> : null}
              <View style={[s.message, item.senderId === uid ? s.mine : s.theirs]}>
              {item.senderId === 'teamder' ? <Text style={s.sender}>צוות ⁦Teamder⁩</Text> : null}
              {item.supportImage ? <Pressable onPress={() => setPreview(item.supportImage!)} accessibilityLabel="הגדלת צילום המסך"><Image source={{ uri: `data:image/jpeg;base64,${item.supportImage}` }} style={s.messageImage} resizeMode="contain" /></Pressable> : null}
              <Text style={s.text}>{item.text}</Text><Text style={s.time}>{formatTime(item.createdAt)}</Text>
            </View></>} />
          <View style={s.composer}>
            {draft?.image ? <View style={s.attachment}><Pressable onPress={() => setPreview(draft.image!)} accessibilityLabel="תצוגה מקדימה של הצילום"><Image source={{ uri: `data:image/jpeg;base64,${draft.image}` }} style={s.thumb} /></Pressable><Text style={[s.sub, { flex: 1 }]}>צילום של מסך המקור מצורף</Text><Pressable disabled={sending} accessibilityLabel="הסרת הצילום" onPress={() => patch({ image: undefined })}><Ionicons name="close" size={20} color={colors.textMuted} /></Pressable></View> : <Pressable disabled={sending} style={s.attach} onPress={() => { Keyboard.dismiss(); setError(''); setCapturing(true); }}><Ionicons name="camera-outline" size={18} color={colors.primary} /><Text style={s.attachText}>צרפו צילום של מסך המקור</Text></Pressable>}
            <View style={s.inputRow}><TextInput value={draft?.text ?? ''} onChangeText={text => patch({ text })} editable={!sending} multiline maxLength={1000} placeholder="כתבו לנו…" placeholderTextColor={colors.textMuted} style={s.input} accessibilityLabel="כתיבת הודעה לצוות" /><Pressable accessibilityLabel="שליחת הודעה לצוות" onPress={send} disabled={sending || (!draft?.text.trim() && !draft?.image)} style={[s.send, (!draft?.text.trim() && !draft?.image) && { opacity: 0.4 }]}>{sending ? <ActivityIndicator color={colors.textOnPrimary} /> : <Ionicons name="send" style={{ transform: [{ scaleX: -1 }] }} size={19} color={colors.textOnPrimary} />}</Pressable></View>
            {error ? <Text style={s.error}>{error}</Text> : null}
          </View>
        </View>
      </SafeKeyboardAvoidingView>
    </Modal>
    <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}><View style={s.preview}><Pressable onPress={() => setPreview(null)} style={s.previewClose} accessibilityLabel="סגירת צילום"><Ionicons name="close" size={28} color="white" /></Pressable>{preview ? <Image source={{ uri: `data:image/jpeg;base64,${preview}` }} style={{ flex: 1, width: '100%' }} resizeMode="contain" /> : null}</View></Modal>
    <ContextualAuthSheet visible={authOpen} kind="account_upgrade" hasDraft copy={{ title: 'מתחברים כדי לדבר עם הצוות', body: 'ההודעה והצילום נשמרו. לאחר ההתחברות אפשר לחזור ולשלוח.' }} onCancel={() => { setAuthOpen(false); authDraft.current = null; }} onEmailTransition={() => { setAuthOpen(false); state.close(); }} onAuthenticated={async ({ uid: nextUid }) => { setAuthOpen(false); try { await useUserStore.getState().refreshFromSession(nextUid); } catch (caughtError4dc4d473d8) {
    observeCaughtError(caughtError4dc4d473d8, {"source":"src/components/support/SupportChatHost.tsx","handler":"SupportChatHost","site":"SupportChatHost:4dc4d473d8"}); setError('לא הצלחנו לחדש את ההתחברות. ההודעה נשמרה.'); } }} />
  </>;
}
const s = StyleSheet.create({
  day: { alignSelf: 'center', color: colors.textMuted, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5, fontSize: 12, marginVertical: 6 },
  launcher: { position: 'absolute', left: 8, zIndex: 20 }, bubble: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface, elevation: 5 }, dismiss: { position: 'absolute', right: -7, top: -10, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  overlay: { flex: 1, justifyContent: 'flex-end' }, backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.32)' }, sheet: { height: '88%', backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' }, handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 10 }, head: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }, title: { fontSize: 19, fontWeight: '700', color: colors.text, textAlign: RTL_LABEL_ALIGN }, sub: { fontSize: 12, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN }, context: { fontSize: 12, color: colors.textMuted, padding: 12, textAlign: RTL_LABEL_ALIGN, borderBottomWidth: 1, borderColor: colors.border }, thread: { padding: 14, gap: 12, flexGrow: 1 }, welcome: { color: colors.textMuted, fontSize: 14, lineHeight: 23, textAlign: 'center', padding: 22 }, message: { maxWidth: '88%', padding: 12, borderRadius: 16 }, mine: { alignSelf: 'flex-start', backgroundColor: colors.primaryLight, borderBottomRightRadius: 4 }, theirs: { alignSelf: 'flex-end', backgroundColor: colors.surface, borderBottomLeftRadius: 4 }, sender: { color: colors.primary, fontSize: 12, marginBottom: 4, textAlign: RTL_LABEL_ALIGN }, text: { fontSize: 15, color: colors.text, lineHeight: 23, textAlign: RTL_LABEL_ALIGN }, time: { fontSize: 11, color: colors.textMuted, marginTop: 5 }, messageImage: { width: 180, height: 220, marginBottom: 8, borderRadius: 10 }, composer: { padding: 12, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border }, inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 9 }, input: { flex: 1, minHeight: 64, maxHeight: 135, fontSize: 16, writingDirection: 'rtl', textAlign: 'right', textAlignVertical: 'top', color: colors.text, backgroundColor: colors.bg, padding: 13, borderRadius: 18, borderWidth: 1, borderColor: colors.border }, send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, attach: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9 }, attachText: { color: colors.primary, fontSize: 12 }, attachment: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, backgroundColor: colors.primaryLight, borderRadius: 12, marginBottom: 10 }, thumb: { width: 40, height: 65, borderRadius: 5 }, error: { color: colors.danger, fontSize: 12, lineHeight: 18, padding: 8, textAlign: RTL_LABEL_ALIGN }, preview: { flex: 1, backgroundColor: '#000', padding: 16 }, previewClose: { padding: 12, alignSelf: 'flex-end' },
});
