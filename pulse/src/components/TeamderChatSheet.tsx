// The "reply as Teamder" sheet.
//
// Opened from a task built out of a report, and from a user's card. Shows the
// whole thread with that person, lets you quote any report they've ever filed,
// and sends as the brand rather than as a personal profile.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
}: {
  visible: boolean;
  userId: string;
  userName: string;
  onClose: () => void;
}) {
  const [thread, setThread] = useState<TeamderThread | null>(null);
  const [reports, setReports] = useState<UserReport[]>([]);
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [pickingQuote, setPickingQuote] = useState(false);

  const load = useCallback(
    async (force = false) => {
      if (!userId) return;
      setLoading(true);
      try {
        const [t, r] = await Promise.all([
          loadThread(userId, userName, force),
          listUserReports(userId),
        ]);
        setThread(t);
        setReports(r);
      } catch {
        /* leave whatever's on screen */
      } finally {
        setLoading(false);
      }
    },
    [userId, userName],
  );

  useEffect(() => {
    if (visible) {
      setText('');
      setPickingQuote(false);
      void load();
    }
  }, [visible, load]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const ok = await sendTeamderMessage(userId, body, Date.now());
      if (!ok) throw new Error('send failed');
      setText('');
      await load(true);
    } catch {
      Alert.alert('השליחה נכשלה', 'נסה שוב');
    } finally {
      setSending(false);
    }
  };

  const applyQuote = (r: UserReport) => {
    // Prepend, so a template already typed stays underneath the quote.
    setText((prev) => quoteReport(r, userName) + prev);
    setPickingQuote(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* The composer is the bottom-most thing in the sheet, so it needs BOTH
          the keyboard out of its way and the system nav bar out from under it.
          It had neither: the send button sat behind the gesture bar. */}
      <KeyboardAvoidingView
        style={st.wrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[st.sheet, { paddingBottom: 14 + insets.bottom }]}>
          <View style={st.head}>
            <View style={st.headText}>
              <Text style={font.h2}>{userName || 'שיחה'}</Text>
              <Text style={st.sub}>נשלח בשם Teamder</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textSoft} />
            </Pressable>
          </View>

          <ScrollView style={st.thread} contentContainerStyle={st.threadBody}>
            {loading && !thread ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
            ) : thread && thread.messages.length > 0 ? (
              thread.messages.map((m) => (
                <View
                  key={m.id}
                  style={[st.bubble, m.fromTeamder ? st.mine : st.theirs]}
                >
                  <Text style={st.bubbleText}>{m.text}</Text>
                </View>
              ))
            ) : (
              <Text style={st.empty}>עוד לא דיברתם. זו תהיה ההודעה הראשונה.</Text>
            )}
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
              <Pressable onPress={() => setPickingQuote(true)} style={[st.chip, st.chipAccent]}>
                <Ionicons name="chatbox-ellipses-outline" size={14} color="#fff" />
                <Text style={[st.chipTxt, { color: '#fff' }]}>צטט דיווח</Text>
              </Pressable>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.chips}>
                {TEMPLATES.map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setText((prev) => (prev ? `${prev}\n${t}` : t))}
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
              onChangeText={setText}
              placeholder="כתוב הודעה…"
              placeholderTextColor={colors.textMuted}
              style={st.input}
              multiline
              textAlign="right"
            />
            <Pressable
              onPress={send}
              disabled={!text.trim() || sending}
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
    // maxHeight, not height. At a fixed 86% the sheet always left a 14% band at
    // the top, and the screen underneath showed ITS header through it — which
    // read as the same name appearing twice, one greyed out above the other.
    // Now a short thread makes a short sheet.
    maxHeight: '86%',
  },
  head: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headText: { alignItems: 'flex-end' },
  sub: { ...font.small, color: colors.textMuted, textAlign: 'right' },
  thread: { flex: 1 },
  threadBody: { gap: 8, paddingBottom: 8 },
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
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginVertical: 8,
  },
  chips: { flexGrow: 0, flexShrink: 1 },
  chip: {
    flexDirection: 'row-reverse',
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
  quoteMeta: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginTop: 3 },
  quoteMetaTxt: { ...font.small, color: colors.textMuted, textAlign: 'right' },
  paneClose: { alignItems: 'center', paddingTop: 8 },
  composer: { flexDirection: 'row-reverse', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    maxHeight: 120,
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
});
