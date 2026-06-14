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
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/ScreenHeader';
import { UserAvatar } from '@/components/UserAvatar';
import { chatService, MAX_MESSAGE_LEN } from '@/services/chatService';
import { appAlert } from '@/components/AppDialog';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import type { ChatMessage, ChatScope } from '@/types';

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
  const listRef = useRef<FlatList<ChatMessage>>(null);

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

  const onLongPress = (m: ChatMessage) => {
    const mine = m.senderId === me?.id;
    if (!mine && !canModerate) return; // nothing this user can do yet
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

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={title} />
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
            <Ionicons name="chatbubbles-outline" size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>{he.chatEmpty}</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <MessageRow
                message={item}
                mine={item.senderId === me?.id}
                onLongPress={() => onLongPress(item)}
              />
            )}
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
              <Ionicons name="send" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageRow({
  message,
  mine,
  onLongPress,
}: {
  message: ChatMessage;
  mine: boolean;
  onLongPress: () => void;
}) {
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
      {!mine ? (
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
      ) : null}
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={350}
        style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}
      >
        {!mine ? <Text style={styles.senderName}>{message.senderName}</Text> : null}
        <Text style={[styles.messageText, mine && styles.messageTextMine]}>
          {message.text}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  listContent: { padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, maxWidth: '88%' },
  rowMine: { alignSelf: 'flex-end' },
  rowOther: { alignSelf: 'flex-start' },
  avatar: { marginBottom: 2 },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  senderName: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
    marginBottom: 2,
    textAlign: RTL_LABEL_ALIGN,
  },
  messageText: { ...typography.body, color: colors.text, textAlign: RTL_LABEL_ALIGN },
  messageTextMine: { color: '#FFFFFF' },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
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
    textAlign: RTL_LABEL_ALIGN,
    ...typography.body,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
