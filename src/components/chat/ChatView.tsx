// ChatView — the shared chat surface for BOTH scopes (game + community).
// The two screen wrappers resolve a title + moderator flag and hand the
// scope + parentId here; everything else (listen, render, send, delete)
// lives in this one component so the two chats stay identical.
//
// Access is members-only and enforced by firestore.rules. If the live
// listener is denied (e.g. the user lost membership mid-session) we fall
// to a "no access" state rather than showing a broken empty list.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { setActiveChat } from '@/services/activeChat';

import { ScreenHeader } from '@/components/ScreenHeader';
import { UserAvatar } from '@/components/UserAvatar';
import {
  chatService,
  MAX_MESSAGE_LEN,
  type ChatReader,
  type ChatTyper,
} from '@/services/chatService';
import { appAlert } from '@/components/AppDialog';
import { toast } from '@/components/Toast';
import { logError } from '@/services/errorLog';
import {
  ChatTermsModal,
  useChatTermsAccepted,
} from '@/components/chat/ChatTermsModal';
import { containsProfanity } from '@/data/profanity';
import { PitchLinesBackdrop, EmptyPitch, RedCardGlyph } from '@/components/chat/ChatPitch';
import { formatTime } from '@/utils/format';
import { colors, spacing, typography, radius, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGameStore } from '@/store/gameStore';
import type { ChatStackParamList } from '@/navigation/ChatStack';
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
  /** Member user-ids for the "who's in this chat" sheet. The header
   *  members button is hidden when empty/undefined. */
  memberIds?: string[];
  /** Subset of `memberIds` who are admins/organisers — flagged in the
   *  members sheet. */
  adminIds?: string[];
}

export function ChatView({
  scope,
  parentId,
  title,
  canModerate,
  memberIds = [],
  adminIds = [],
}: Props) {
  const me = useUserStore((s) => s.currentUser);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  const playersMap = useGameStore((s) => s.players);
  const [membersOpen, setMembersOpen] = useState(false);
  const nav = useNavigation<NativeStackNavigationProp<ChatStackParamList>>();
  const openProfile = (senderId: string) => {
    nav.navigate('PlayerCard', {
      userId: senderId,
      groupId: scope === 'community' ? parentId : undefined,
    });
  };
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [readers, setReaders] = useState<ChatReader[]>([]);
  const [typers, setTypers] = useState<ChatTyper[]>([]);
  const [, setTick] = useState(0); // forces typing freshness re-eval
  // Memoize the row model so the 2.5s typing-freshness tick (and any other
  // re-render) does NOT rebuild the whole message list array — that gave the
  // FlatList a fresh `data` reference every render and re-rendered the list.
  const chatRows = useMemo(() => buildChatRows(messages), [messages]);
  const lastTypingWriteRef = useRef(0);
  const [menu, setMenu] = useState<{ message: ChatMessage; x: number; y: number } | null>(null);
  const [showTerms, setShowTerms] = useState(false);
  // Bumped to re-subscribe after a TRANSIENT listener error (network /
  // 'unavailable'), so a connectivity blip doesn't strand the chat forever.
  const [retryTick, setRetryTick] = useState(0);
  const { accepted: termsAccepted, accept: acceptTerms } = useChatTermsAccepted();
  const listRef = useRef<FlatList<ChatRow>>(null);
  // True while the user is scrolled to (near) the bottom — gates auto-scroll so
  // a new message doesn't yank them away while they read older messages.
  const nearBottomRef = useRef(true);
  // Synchronous double-send guard. `sending` state can't block a same-frame
  // double-tap (both onPress closures read the same pre-clear `draft`), so a
  // ref debounces it. Reset shortly after — NOT tied to the server ack, which
  // never resolves offline (that was the composer-freeze bug we fixed).
  const sendGuardRef = useRef(false);

  // Fresh chat → reset to the initial loading state (spinner shows once).
  useEffect(() => {
    setLoading(true);
    setDenied(false);
    setRetryTick(0);
  }, [scope, parentId]);

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = chatService.subscribeMessages(
      scope,
      parentId,
      (msgs) => {
        setMessages(msgs);
        setLoading(false);
        setDenied(false);
      },
      (err) => {
        // Only a genuine PERMISSION error means "no access". Everything else
        // (offline / 'unavailable' / transport errored — common on flaky
        // networks) is TRANSIENT: don't show the lock, retry a FEW times.
        const code = (err as { code?: string } | undefined)?.code;
        if (code === 'permission-denied') {
          setDenied(true);
          setLoading(false);
          return;
        }
        logError('ChatView.subscribe', err, { scope, parentId });
        setLoading(false);
        // Cap retries so a persistent error doesn't loop forever — which felt
        // like the chat was "constantly refreshing". (We DON'T flip loading
        // back to true on retry, so the list doesn't flicker.)
        if (retryTick < 4) {
          retryTimer = setTimeout(() => setRetryTick((n) => n + 1), 3000);
        }
      },
    );
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      unsub();
    };
  }, [scope, parentId, retryTick]);

  // Per-chat mute state, my block list, read positions, and who's typing.
  useEffect(() => {
    if (!me) return;
    const unsubM = chatService.subscribeMuted(me.id, scope, parentId, setMuted);
    const unsubB = chatService.subscribeBlocked(me.id, setBlocked);
    const unsubR = chatService.subscribeReads(scope, parentId, setReaders);
    const unsubT = chatService.subscribeTyping(scope, parentId, setTypers);
    // Re-evaluate typing freshness every couple of seconds so a stale
    // flag (someone stopped typing without sending) disappears on its own.
    const tickId = setInterval(() => setTick((t) => t + 1), 2500);
    return () => {
      unsubM();
      unsubB();
      unsubR();
      unsubT();
      clearInterval(tickId);
      // Make sure I'm not left showing as "typing" after I leave.
      chatService.setTyping(scope, parentId, { id: me.id, name: me.name }, false).catch(() => {});
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

  // Mark this chat as the foreground-active one while it's focused, so an
  // incoming push for THIS chat is suppressed (no banner for the conversation
  // you're already reading). Cleared on blur/unmount.
  useFocusEffect(
    useCallback(() => {
      setActiveChat(`${scope}__${parentId}`);
      return () => setActiveChat(null);
    }, [scope, parentId]),
  );

  const toggleMute = () => {
    if (!me) return;
    chatService.setMuted(me.id, scope, parentId, !muted).catch(() => {});
  };

  // Stick to the newest message as they arrive — but only if the user is
  // already at the bottom, so an incoming message doesn't interrupt reading.
  useEffect(() => {
    if (messages.length === 0 || !nearBottomRef.current) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 80);
    return () => clearTimeout(t);
  }, [messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !me || sending || sendGuardRef.current) return;
    // Terms gate — must accept the chat rules before posting (store-safety).
    // Guard on `!== true` (not `=== false`): while the accepted flag is still
    // loading it is `null`, and `=== false` let a never-accepted user post in
    // that window. Anything but a definite `true` shows the terms first.
    if (termsAccepted !== true) {
      setShowTerms(true);
      return;
    }
    // First-line profanity filter (real moderation is report+block+delete).
    if (containsProfanity(text)) {
      toast.error(he.chatProfanityBlocked);
      return;
    }
    sendGuardRef.current = true;
    setTimeout(() => {
      sendGuardRef.current = false;
    }, 400);
    setSending(true);
    setDraft('');
    // Sending your own message always jumps you to the newest — even if you'd
    // scrolled up to read history. Without this, the auto-scroll (gated on
    // nearBottomRef) skips your just-sent message and it lands off-screen,
    // looking like the send failed.
    nearBottomRef.current = true;
    listRef.current?.scrollToEnd({ animated: true });
    lastTypingWriteRef.current = 0;
    chatService.setTyping(scope, parentId, { id: me.id, name: me.name }, false).catch(() => {});
    // Fire-and-forget — do NOT await the server ack. Firestore durably queues
    // the write and the onSnapshot local echo renders the message instantly,
    // so the composer is free again immediately. Awaiting would freeze it
    // while OFFLINE: addDoc's promise stays pending until reconnect, leaving
    // `sending` stuck true so no further message could be sent. Only a genuine
    // server REJECTION restores the draft + alerts.
    chatService.sendMessage(scope, parentId, me, text).catch(() => {
      // Restore only if the box is still empty (user hasn't started a new one).
      setDraft((cur) => cur || text);
      appAlert(he.chatSendFailedTitle, he.chatSendFailedBody);
    });
    setSending(false);
  };

  // Signal "typing" as the user edits — throttled to a write every ~2.5s.
  const onDraftChange = (text: string) => {
    setDraft(text);
    if (!me) return;
    const now = Date.now();
    if (text.trim() && now - lastTypingWriteRef.current > 2500) {
      lastTypingWriteRef.current = now;
      chatService
        .setTyping(scope, parentId, { id: me.id, name: me.name }, true)
        .catch(() => {});
    }
  };

  // Who's typing right now (fresh + not me).
  const typingNow = typers.filter((t) => t.uid !== me?.id && Date.now() - t.at < 6000);
  const typingLabel =
    typingNow.length === 0
      ? null
      : typingNow.length === 1
        ? he.chatTypingOne(typingNow[0].name)
        : he.chatTypingMany;

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
      // Report = corner flag; block = whistle (closest Ionicon). Block keeps
      // the policy-required ability to block abusive users — its messages then
      // render as a collapsed placeholder rather than vanishing.
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
          ...(memberIds.length > 0
            ? [
                {
                  icon: 'people-outline' as const,
                  onPress: () => {
                    hydratePlayers(memberIds);
                    setMembersOpen(true);
                  },
                  tint: colors.text,
                  label: he.chatMembersTitle,
                },
              ]
            : []),
          {
            icon: muted ? 'notifications-off-outline' : 'notifications-outline',
            onPress: toggleMute,
            tint: muted ? colors.textMuted : colors.text,
            label: muted ? he.chatUnmute : he.chatMute,
          },
        ]}
      />
      <ChatMembersSheet
        visible={membersOpen}
        onClose={() => setMembersOpen(false)}
        memberIds={memberIds}
        adminIds={adminIds}
        playersMap={playersMap}
        onPressMember={(uid) => {
          setMembersOpen(false);
          openProfile(uid);
        }}
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
        ) : messages.length === 0 ? (
          <View style={styles.center}>
            <EmptyPitch width={200} />
            <Text style={styles.emptyText}>{he.chatEmpty}</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={chatRows}
            keyExtractor={(row) => row.key}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) =>
              item.kind === 'date' ? (
                <DateDivider label={item.label} />
              ) : blocked.has(item.message.senderId) ? (
                // Blocked sender: keep a collapsed placeholder in place (instead
                // of vanishing the message) so replies around it still have
                // context — no more "ghost" threads.
                <BlockedRow name={item.message.senderName} />
              ) : (
                <MessageRow
                  message={item.message}
                  mine={item.message.senderId === me?.id}
                  onOpenMenu={(e) => openMenu(item.message, e)}
                  onOpenProfile={() => openProfile(item.message.senderId)}
                />
              )
            }
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } =
                e.nativeEvent;
              // Distance from the bottom; treat within ~80px as "at bottom".
              const fromBottom =
                contentSize.height -
                (contentOffset.y + layoutMeasurement.height);
              nearBottomRef.current = fromBottom < 80;
            }}
            scrollEventThrottle={64}
            onContentSizeChange={() => {
              // Only auto-scroll to the newest message when the user is already
              // at the bottom — otherwise a new message would yank them away
              // from the history they're reading. Initial mount starts at bottom.
              if (nearBottomRef.current) {
                listRef.current?.scrollToEnd({ animated: false });
              }
            }}
          />
        )}

        {!denied && typingLabel ? (
          <View style={styles.typingWrap}>
            <Text style={styles.typingText}>{typingLabel}</Text>
          </View>
        ) : null}

        {!denied ? (
          <View style={styles.inputBar}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={onDraftChange}
              placeholder={he.chatInputPlaceholder}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={MAX_MESSAGE_LEN}
            />
            <Pressable
              style={[styles.sendBtn, !draft.trim() && styles.sendBtnDisabled]}
              onPress={send}
              disabled={!draft.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel={he.chatSendA11y}
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

// A collapsed stand-in for a message whose sender the viewer has blocked. Keeps
// a marker in the timeline so surrounding replies still make sense, without
// showing the blocked content.
function BlockedRow({ name }: { name: string }) {
  return (
    <View style={styles.blockedRow}>
      <Ionicons name="eye-off-outline" size={14} color={colors.textMuted} />
      <Text style={styles.blockedText}>{he.chatBlockedHidden(name || 'משתמש')}</Text>
    </View>
  );
}

function MessageRow({
  message,
  mine,
  onOpenMenu,
  onOpenProfile,
}: {
  message: ChatMessage;
  mine: boolean;
  onOpenMenu: (e: GestureResponderEvent) => void;
  onOpenProfile: () => void;
}) {
  // First name only — keeps the header above the bubble tidy.
  const firstName = (message.senderName || '').trim().split(/\s+/)[0] || message.senderName;
  const avatar = (
    <Pressable onPress={onOpenProfile} hitSlop={6}>
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
    </Pressable>
  );
  const bubble = (
    <Pressable
      onLongPress={onOpenMenu}
      delayLongPress={350}
      style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}
    >
      {!mine ? (
        <Text style={styles.senderName} onPress={onOpenProfile}>
          {firstName}
        </Text>
      ) : null}
      <Text style={[styles.messageText, mine && styles.messageTextMine]}>
        {message.text}
      </Text>
    </Pressable>
  );
  // The meta column hugs the bubble's INNER side: a caret (the visible
  // hint that a message has actions — tap it, or long-press the bubble)
  // above the send time. My own (right-aligned) messages DON'T show my avatar
  // (like every mainstream chat — it just wastes bubble width): [bubble | meta].
  // Others' messages keep the sender avatar: [meta | bubble | avatar].
  const meta = (
    <Pressable onPress={onOpenMenu} hitSlop={6} style={styles.meta}>
      <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
      <Text style={styles.time}>{formatTime(message.createdAt)}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
      {mine ? null : meta}
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

// Bottom sheet listing everyone with access to this chat (community
// members / game roster). Admins/organisers are flagged. Tapping a row
// opens that player's card. (Feedback: "כפתור שפותח חלון של חברי השיחה".)
function ChatMembersSheet({
  visible,
  onClose,
  memberIds,
  adminIds,
  playersMap,
  onPressMember,
}: {
  visible: boolean;
  onClose: () => void;
  memberIds: string[];
  adminIds: string[];
  playersMap: Record<string, { displayName?: string; avatarId?: string; photoUrl?: string }>;
  onPressMember: (uid: string) => void;
}) {
  const adminSet = new Set(adminIds);
  // Admins first, then everyone else — both alphabetical-ish by load order.
  const ordered = [...memberIds].sort(
    (a, b) => Number(adminSet.has(b)) - Number(adminSet.has(a)),
  );
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.membersBackdrop} onPress={onClose} />
      <View style={styles.membersSheet}>
        <View style={styles.membersHandle} />
        <Text style={styles.membersTitle}>
          {he.chatMembersTitle}
          <Text style={styles.membersCount}>
            {'  '}
            {he.chatMembersCount(memberIds.length)}
          </Text>
        </Text>
        {ordered.length === 0 ? (
          <Text style={styles.membersEmpty}>{he.chatMembersEmpty}</Text>
        ) : (
          <FlatList
            data={ordered}
            keyExtractor={(uid) => uid}
            contentContainerStyle={{ paddingBottom: spacing.lg }}
            renderItem={({ item: uid }) => {
              const p = playersMap[uid];
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.memberRow,
                    pressed && { opacity: 0.6 },
                  ]}
                  onPress={() => onPressMember(uid)}
                >
                  <UserAvatar
                    user={{
                      id: uid,
                      name: p?.displayName ?? '...',
                      avatarId: p?.avatarId,
                      photoUrl: p?.photoUrl,
                    }}
                    size={40}
                  />
                  <Text style={styles.memberName} numberOfLines={1}>
                    {p?.displayName ?? '...'}
                  </Text>
                  {adminSet.has(uid) ? (
                    <View style={styles.memberAdminTag}>
                      <Text style={styles.memberAdminTagText}>
                        {he.chatMembersAdminTag}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  membersBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  membersSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '70%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  membersHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  membersTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.sm,
  },
  membersCount: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '500',
  },
  membersEmpty: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  memberName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  memberAdminTag: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  memberAdminTagText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    fontSize: 11,
  },
  blockedRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginVertical: 4,
  },
  blockedText: { ...typography.caption, color: colors.textMuted },
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
    // Give way to the timestamp column instead of squeezing it off-screen.
    flexShrink: 1,
  },
  // Own bubble in pitch green; others in white with a thin field-line edge.
  // The squared "tail" corner faces the avatar (own = right under RTL →
  // bottom-start; others = left → bottom-end).
  bubbleMine: { backgroundColor: '#1B8A43', borderBottomStartRadius: 4 },
  bubbleOther: {
    backgroundColor: colors.surface,
    borderBottomEndRadius: 4,
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
  // Caret hint + timestamp, hugging the inner side of the bubble. flexShrink:0
  // so a long message can't squeeze the time off-screen (was getting cut off).
  meta: { alignItems: 'center', gap: 0, marginBottom: 2, flexShrink: 0 },
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
  // "… מקליד" line just above the composer.
  typingWrap: { paddingHorizontal: spacing.md, paddingBottom: 2 },
  typingText: {
    ...typography.caption,
    color: '#1B8A43',
    fontStyle: 'italic',
    textAlign: RTL_LABEL_ALIGN,
  },
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
