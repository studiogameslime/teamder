// ChatView — the shared chat surface for BOTH scopes (game + community).
// The two screen wrappers resolve a title + moderator flag and hand the
// scope + parentId here; everything else (listen, render, send, delete)
// lives in this one component so the two chats stay identical.
//
// Access is members-only and enforced by firestore.rules. If the live
// listener is denied (e.g. the user lost membership mid-session) we fall
// to a "no access" state rather than showing a broken empty list.

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/ScreenHeader';
import { UserAvatar } from '@/components/UserAvatar';
import { chatService, MAX_MESSAGE_LEN, type ChatReader } from '@/services/chatService';
import { appAlert } from '@/components/AppDialog';
import { toast } from '@/components/Toast';
import {
  ChatTermsModal,
  useChatTermsAccepted,
} from '@/components/chat/ChatTermsModal';
import { containsProfanity } from '@/data/profanity';
import { PitchLinesBackdrop, EmptyPitch, RedCardGlyph } from '@/components/chat/ChatPitch';
import { formatTime } from '@/utils/format';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import type { ChatMessage, ChatScope } from '@/types';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const MENU_W = 200;

interface Props {
  scope: ChatScope;
  parentId: string;
  /** Header title — the game title or community name. */
  title: string;
  /** True when the current user can delete anyone's message here
   *  (game organiser / community admin). */
  canModerate: boolean;
}

export function ChatView({ scope, parentId, title, canModerate }: Props) {
  const me = useUserStore((s) => s.currentUser);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [readers, setReaders] = useState<ChatReader[]>([]);
  const [menu, setMenu] = useState<{ message: ChatMessage; x: number; y: number } | null>(null);
  const [showTerms, setShowTerms] = useState(false);
  const { accepted: termsAccepted, accept: acceptTerms } = useChatTermsAccepted();
  const listRef = useRef<FlatList<ChatRow>>(null);

  useEffect(() => {
    setLoading(true);
    const unsub = chatService.subscribeMessages(
      scope,
      parentId,
      (msgs) => {
        setMessages(msgs);
        setLoading(false);
        setDenied(false);
      },
      () => {
        // Permission denied / lost membership.
        setDenied(true);
        setLoading(false);
      },
    );
    return unsub;
  }, [scope, parentId]);

  // Per-chat mute state, my block list, and everyone's read positions.
  useEffect(() => {
    if (!me) return;
    const unsubM = chatService.subscribeMuted(me.id, scope, parentId, setMuted);
    const unsubB = chatService.subscribeBlocked(me.id, setBlocked);
    const unsubR = chatService.subscribeReads(scope, parentId, setReaders);
    return () => {
      unsubM();
      unsubB();
      unsubR();
    };
  }, [me?.id, scope, parentId]);

  // Opening the chat (and reading new messages while open) clears my
  // unread counter for it — which also re-arms the "one push" for the
  // next message — and stamps my read position so others see I'm caught up.
  useEffect(() => {
    if (!me || denied) return;
    chatService.markChatRead(me.id, scope, parentId).catch(() => {});
    chatService.writeReadReceipt(scope, parentId, me).catch(() => {});
  }, [me?.id, scope, parentId, denied, messages.length]);

  const visibleMessages = messages.filter((m) => !blocked.has(m.senderId));

  const toggleMute = () => {
    if (!me) return;
    chatService.setMuted(me.id, scope, parentId, !muted).catch(() => {});
  };

  // Stick to the newest message as they arrive.
  useEffect(() => {
    if (messages.length === 0) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 80);
    return () => clearTimeout(t);
  }, [messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !me || sending) return;
    // Terms gate — must accept the chat rules before posting (store-safety).
    if (termsAccepted === false) {
      setShowTerms(true);
      return;
    }
    // First-line profanity filter (real moderation is report+block+delete).
    if (containsProfanity(text)) {
      toast.error(he.chatProfanityBlocked);
      return;
    }
    setSending(true);
    setDraft('');
    try {
      await chatService.sendMessage(scope, parentId, me, text);
    } catch {
      // Restore the draft so the user doesn't lose what they typed.
      setDraft(text);
      appAlert(he.chatSendFailedTitle, he.chatSendFailedBody);
    } finally {
      setSending(false);
    }
  };

  const deleteMessage = (m: ChatMessage) => {
    const mine = m.senderId === me?.id;
    appAlert(
      he.chatDeleteConfirmTitle,
      mine ? he.chatDeleteConfirmBodyOwn : he.chatDeleteConfirmBodyMod,
      [
        { text: he.cancel, style: 'cancel' },
        {
          text: he.delete,
          style: 'destructive',
          onPress: async () => {
            try {
              await chatService.deleteMessage(scope, parentId, m.id);
            } catch {
              appAlert(he.chatDeleteFailedTitle, he.chatDeleteFailedBody);
            }
          },
        },
      ],
    );
  };

  const reportMessage = (m: ChatMessage) => {
    if (!me) return;
    appAlert(he.chatReportConfirmTitle, he.chatReportConfirmBody, [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.chatReport,
        style: 'destructive',
        onPress: async () => {
          try {
            await chatService.reportMessage(me.id, scope, parentId, m);
            toast.success(he.chatReportThanks);
          } catch {
            appAlert(he.chatSendFailedTitle, he.chatSendFailedBody);
          }
        },
      },
    ]);
  };

  const blockSender = (m: ChatMessage) => {
    if (!me) return;
    appAlert(he.chatBlockConfirmTitle, he.chatBlockConfirmBody(m.senderName), [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.chatBlock,
        style: 'destructive',
        onPress: async () => {
          try {
            await chatService.blockUser(me.id, m.senderId);
            toast.success(he.chatBlockDone);
          } catch {
            appAlert(he.chatSendFailedTitle, he.chatSendFailedBody);
          }
        },
      },
    ]);
  };

  const showReaders = (m: ChatMessage) => {
    // Who has read up to (or past) this message — excluding the sender.
    const seen = readers
      .filter((r) => r.uid !== m.senderId && r.lastReadAt >= m.createdAt)
      .map((r) => (r.uid === me?.id ? he.chatReadByYou : r.name))
      .filter(Boolean);
    appAlert(
      he.chatWhoRead,
      seen.length ? seen.join('\n') : he.chatReadByNobody,
    );
  };

  // Open the small floating action menu anchored at the touch point.
  const openMenu = (m: ChatMessage, e: GestureResponderEvent) => {
    const { pageX, pageY } = e.nativeEvent;
    setMenu({ message: m, x: pageX, y: pageY });
  };

  // The actions available for the menu's target message.
  const menuItems = (m: ChatMessage) => {
    const mine = m.senderId === me?.id;
    const items: {
      label: string;
      icon: keyof typeof Ionicons.glyphMap;
      danger?: boolean;
      redCard?: boolean;
      run: () => void;
    }[] = [{ label: he.chatWhoRead, icon: 'eye-outline', run: () => showReaders(m) }];
    if (mine || canModerate) {
      // Delete = a referee red card (send-off).
      items.push({ label: he.delete, icon: 'trash-outline', danger: true, redCard: true, run: () => deleteMessage(m) });
    }
    if (!mine) {
      // Report = corner flag; block = whistle (closest Ionicon).
      items.push({ label: he.chatReport, icon: 'flag-outline', run: () => reportMessage(m) });
      items.push({ label: he.chatBlock, icon: 'megaphone-outline', danger: true, run: () => blockSender(m) });
    }
    return items;
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <PitchLinesBackdrop />
      <ScreenHeader
        title={title}
        actions={[
          {
            icon: muted ? 'notifications-off-outline' : 'notifications-outline',
            onPress: toggleMute,
            tint: muted ? colors.textMuted : colors.text,
            label: muted ? he.chatUnmute : he.chatMute,
          },
        ]}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : denied ? (
          <View style={styles.center}>
            <Ionicons name="lock-closed-outline" size={36} color={colors.textMuted} />
            <Text style={styles.emptyText}>{he.chatNoAccess}</Text>
          </View>
        ) : visibleMessages.length === 0 ? (
          <View style={styles.center}>
            <EmptyPitch width={200} />
            <Text style={styles.emptyText}>{he.chatEmpty}</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={buildChatRows(visibleMessages)}
            keyExtractor={(row) => row.key}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) =>
              item.kind === 'date' ? (
                <DateDivider label={item.label} />
              ) : (
                <MessageRow
                  message={item.message}
                  mine={item.message.senderId === me?.id}
                  onOpenMenu={(e) => openMenu(item.message, e)}
                />
              )
            }
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        {!denied ? (
          <View style={styles.inputBar}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={he.chatInputPlaceholder}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={MAX_MESSAGE_LEN}
            />
            <Pressable
              style={[styles.sendBtn, !draft.trim() && styles.sendBtnDisabled]}
              onPress={send}
              disabled={!draft.trim() || sending}
            >
              <Ionicons
                name="send"
                size={20}
                color="#FFFFFF"
                style={{ transform: [{ scaleX: -1 }] }}
              />
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <ChatTermsModal
        visible={showTerms}
        onAccept={async () => {
          await acceptTerms();
          setShowTerms(false);
        }}
        onClose={() => setShowTerms(false)}
      />

      {/* Small floating action menu anchored next to the tapped message
          (not a centred dialog). Tap outside to dismiss. */}
      {menu ? (
        <Modal transparent animationType="fade" onRequestClose={() => setMenu(null)}>
          <Pressable style={styles.menuBackdrop} onPress={() => setMenu(null)}>
            <View
              style={[
                styles.actionMenu,
                {
                  width: MENU_W,
                  left: Math.min(Math.max(8, menu.x - MENU_W / 2), SCREEN_W - MENU_W - 8),
                },
                menu.y > SCREEN_H * 0.55
                  ? { bottom: SCREEN_H - menu.y + 8 }
                  : { top: menu.y + 8 },
              ]}
            >
              {menuItems(menu.message).map((it, i) => (
                <Pressable
                  key={it.label}
                  style={[styles.menuItem, i > 0 && styles.menuItemBorder]}
                  onPress={() => {
                    setMenu(null);
                    it.run();
                  }}
                >
                  {it.redCard ? (
                    <RedCardGlyph size={18} />
                  ) : (
                    <Ionicons
                      name={it.icon}
                      size={18}
                      color={it.danger ? colors.danger : colors.text}
                    />
                  )}
                  <Text style={[styles.menuItemText, it.danger && { color: colors.danger }]}>
                    {it.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

function MessageRow({
  message,
  mine,
  onOpenMenu,
}: {
  message: ChatMessage;
  mine: boolean;
  onOpenMenu: (e: GestureResponderEvent) => void;
}) {
  const avatar = (
    <UserAvatar
      user={{
        id: message.senderId,
        name: message.senderName,
        avatarId: message.senderAvatarId,
        photoUrl: message.senderPhotoUrl,
      }}
      size={32}
      style={styles.avatar}
    />
  );
  const bubble = (
    <Pressable
      onLongPress={onOpenMenu}
      delayLongPress={350}
      style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}
    >
      {!mine ? <Text style={styles.senderName}>{message.senderName}</Text> : null}
      <Text style={[styles.messageText, mine && styles.messageTextMine]}>
        {message.text}
      </Text>
    </Pressable>
  );
  // The meta column hugs the bubble's INNER side: a caret (the visible
  // hint that a message has actions — tap it, or long-press the bubble)
  // above the send time. For my own (right-aligned) message the layout is
  // [avatar | bubble | meta]; for others it's [meta | bubble | avatar].
  const meta = (
    <Pressable onPress={onOpenMenu} hitSlop={6} style={styles.meta}>
      <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
      <Text style={styles.time}>{formatTime(message.createdAt)}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
      {mine ? avatar : meta}
      {bubble}
      {mine ? meta : avatar}
    </View>
  );
}

// ── Date dividers ────────────────────────────────────────────────────────
// WhatsApp-style centred date pills between messages of different days.

type ChatRow =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'msg'; key: string; message: ChatMessage };

function startOfDay(ms: number): number {
  return new Date(ms).setHours(0, 0, 0, 0);
}

function dayLabel(ms: number): string {
  const todayStart = startOfDay(Date.now());
  const dayStart = startOfDay(ms);
  const DAY = 86_400_000;
  if (dayStart === todayStart) return he.chatToday;
  if (dayStart === todayStart - DAY) return he.chatYesterday;
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** Interleave the messages with a date divider before each new day. */
function buildChatRows(messages: ChatMessage[]): ChatRow[] {
  const rows: ChatRow[] = [];
  let lastDay: number | null = null;
  for (const m of messages) {
    const day = startOfDay(m.createdAt);
    if (day !== lastDay) {
      rows.push({ kind: 'date', key: `date_${day}`, label: dayLabel(m.createdAt) });
      lastDay = day;
    }
    rows.push({ kind: 'msg', key: m.id, message: m });
  }
  return rows;
}

function DateDivider({ label }: { label: string }) {
  return (
    <View style={styles.dateWrap}>
      <View style={styles.datePill}>
        <Text style={styles.dateText}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  // flexGrow + flex-end keeps a short conversation pinned to the BOTTOM
  // (just above the input), WhatsApp-style, instead of floating at the top.
  listContent: {
    padding: spacing.md,
    gap: spacing.sm,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, maxWidth: '88%' },
  // Under forceRTL, flex-start = visual RIGHT. My own messages sit on the
  // right; everyone else's on the left.
  rowMine: { alignSelf: 'flex-start' },
  rowOther: { alignSelf: 'flex-end' },
  avatar: { marginBottom: 2 },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // Own bubble in pitch green; others in white with a thin field-line edge.
  bubbleMine: { backgroundColor: '#1B8A43', borderBottomRightRadius: 4 },
  bubbleOther: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(27,138,67,0.18)',
  },
  senderName: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
    marginBottom: 2,
    textAlign: RTL_LABEL_ALIGN,
  },
  messageText: { ...typography.body, color: colors.text, textAlign: RTL_LABEL_ALIGN },
  messageTextMine: { color: '#FFFFFF' },
  // Caret hint + timestamp, hugging the inner side of the bubble.
  meta: { alignItems: 'center', gap: 0, marginBottom: 2 },
  time: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
  },
  // Scoreboard-style centred date separator: dark pill, white text, with a
  // thin pitch-line outline.
  dateWrap: { alignItems: 'center', paddingVertical: spacing.sm },
  datePill: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  dateText: {
    ...typography.caption,
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  // Floating context menu next to a message.
  menuBackdrop: { flex: 1, backgroundColor: 'transparent' },
  actionMenu: {
    position: 'absolute',
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  menuItemBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  menuItemText: { ...typography.body, color: colors.text, textAlign: RTL_LABEL_ALIGN },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    // A thin pitch-line accent along the top of the composer.
    borderTopWidth: 2,
    borderTopColor: 'rgba(27,138,67,0.45)',
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 42,
    borderRadius: 21,
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'ios' ? 11 : 8,
    paddingBottom: Platform.OS === 'ios' ? 11 : 8,
    backgroundColor: colors.surface,
    color: colors.text,
    textAlign: 'right',
    ...typography.body,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#1B8A43',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
