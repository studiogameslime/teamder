// PinnedAdminMessageCard — admin-pinned announcement at the top of
// MatchDetails. Three render states:
//
//   1. Admin, no message  → faded "+ הוסף הודעה לשחקנים" tile. Only
//                            the admin sees this; non-admins see
//                            nothing (returns null).
//   2. Admin, has message → solid card with the message + a small
//                            pencil/trash hint, tappable to edit.
//   3. Non-admin, has msg → solid card, read-only.
//
// Editing happens in a centred modal with a multiline TextInput,
// "מחק הודעה" / "שמור" / "ביטול" actions. Save calls the parent's
// `onSave(text)` with the trimmed value (empty string clears).

import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

// One-shot attention animation: card slides up + fades in on first
// appearance, then does a single soft pulse so a returning user can't
// miss that an announcement was added. We key off the trimmed message
// so a NEW message (admin posted a fresh announcement) replays it.
function useAttentionAnimation(trigger: string) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(8);
  const pulse = useSharedValue(1);
  const lastRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastRef.current === trigger) return;
    lastRef.current = trigger;
    opacity.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) });
    // Pulse fires AFTER the entrance so the user's eye has time to
    // land on the card before it draws further attention.
    pulse.value = withDelay(
      280,
      withSequence(
        withTiming(1.04, { duration: 220, easing: Easing.out(Easing.quad) }),
        withTiming(1.0, { duration: 220, easing: Easing.inOut(Easing.quad) }),
      ),
    );
  }, [trigger, opacity, translateY, pulse]);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: pulse.value }],
  }));
}

interface Props {
  message: string | undefined;
  isAdmin: boolean;
  /** Called with the trimmed text. Empty string means "clear". */
  onSave: (text: string) => Promise<void> | void;
}

const MAX_LEN = 280;

export function PinnedAdminMessageCard({ message, isAdmin, onSave }: Props) {
  const trimmed = (message ?? '').trim();
  const hasMessage = trimmed.length > 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(trimmed);
  const [saving, setSaving] = useState(false);

  // Reset draft whenever the modal opens or the upstream message changes.
  useEffect(() => {
    if (editing) setDraft(trimmed);
  }, [editing, trimmed]);

  // Wired up only for the "has message" branch — the empty admin
  // tile is a stable affordance that doesn't need extra fanfare.
  const attentionStyle = useAttentionAnimation(trimmed);

  if (!hasMessage && !isAdmin) return null;

  const openEdit = () => {
    if (!isAdmin) return;
    setDraft(trimmed);
    setEditing(true);
  };

  const handleSave = async (text: string) => {
    setSaving(true);
    try {
      await onSave(text);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {hasMessage ? (
        <Animated.View style={attentionStyle}>
          <Pressable
            onPress={openEdit}
            disabled={!isAdmin}
            style={({ pressed }) => [
              styles.card,
              pressed && isAdmin && { opacity: 0.92 },
            ]}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardHeaderText}>
                {he.pinnedMessageHeader}
              </Text>
              <Ionicons
                name="megaphone"
                size={16}
                color="#1D4ED8"
              />
            </View>
            <Text style={styles.cardBody}>{trimmed}</Text>
            {isAdmin ? (
              <View style={styles.editHint}>
                <Ionicons name="create-outline" size={14} color="#475569" />
              </View>
            ) : null}
          </Pressable>
        </Animated.View>
      ) : (
        <Pressable
          onPress={openEdit}
          style={({ pressed }) => [
            styles.emptyCard,
            pressed && { opacity: 0.85 },
          ]}
        >
          <View style={styles.plusCircle}>
            <Ionicons name="add" size={26} color="#1D4ED8" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.emptyTitle}>
              {he.pinnedMessageEmptyAdminCta}
            </Text>
            <Text style={styles.emptyHint}>
              {he.pinnedMessageEmptyAdminHint}
            </Text>
          </View>
        </Pressable>
      )}

      <Modal
        transparent
        visible={editing}
        animationType="fade"
        onRequestClose={() => setEditing(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{he.pinnedMessageEditTitle}</Text>
            <TextInput
              value={draft}
              onChangeText={(t) => setDraft(t.slice(0, MAX_LEN))}
              placeholder={he.pinnedMessageEditPlaceholder}
              placeholderTextColor="#94A3B8"
              multiline
              autoFocus
              style={styles.modalInput}
              maxLength={MAX_LEN}
            />
            <Text style={styles.counter}>
              {draft.length}/{MAX_LEN}
            </Text>

            <View style={styles.modalActionsRow}>
              {hasMessage ? (
                <Pressable
                  onPress={() => handleSave('')}
                  disabled={saving}
                  style={({ pressed }) => [
                    styles.modalBtnGhost,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={styles.modalBtnGhostText}>
                    {he.pinnedMessageEditClear}
                  </Text>
                </Pressable>
              ) : (
                <View style={{ flex: 1 }} />
              )}

              <Pressable
                onPress={() => setEditing(false)}
                disabled={saving}
                style={({ pressed }) => [
                  styles.modalBtnGhost,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.modalBtnGhostText}>
                  {he.pinnedMessageEditCancel}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => handleSave(draft.trim())}
                disabled={saving || draft.trim() === trimmed}
                style={({ pressed }) => [
                  styles.modalBtnPrimary,
                  (saving || draft.trim() === trimmed) && { opacity: 0.5 },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.modalBtnPrimaryText}>
                  {he.pinnedMessageEditSave}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#EFF6FF',
    borderRadius: 16,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginTop: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  cardHeaderText: {
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    textAlign: RTL_LABEL_ALIGN,
  },
  // Slightly larger + medium weight so the announcement reads
  // differently from regular field text below it. Italic feels right
  // for a "quoted-from-the-admin" voice.
  cardBody: {
    ...typography.body,
    color: '#0F172A',
    fontStyle: 'italic',
    fontWeight: '500',
    fontSize: 15,
    textAlign: RTL_LABEL_ALIGN,
    lineHeight: 23,
  },
  editHint: {
    position: 'absolute',
    top: 10,
    // RTL: with `I18nManager.isRTL=true`, RN remaps `left` to the
    // logical-start (= visual RIGHT) edge. The pencil hint should
    // sit on the visual-LEFT edge so it doesn't crowd the megaphone
    // icon over by the title — use `right` to land there in RTL.
    right: 12,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#BFDBFE',
    marginTop: spacing.md,
  },
  plusCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    ...typography.body,
    color: '#0F172A',
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  emptyHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 2,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    paddingHorizontal: spacing.lg,
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  modalTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  modalInput: {
    minHeight: 120,
    maxHeight: 220,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlignVertical: 'top',
    textAlign: RTL_LABEL_ALIGN,
    // Force RTL base direction so the placeholder + caret sit on the RIGHT for
    // an empty multiline input (RN otherwise defaults an empty field to LTR,
    // dropping the placeholder on the left — user report).
    writingDirection: 'rtl',
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  counter: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  modalActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  modalBtnGhost: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  modalBtnGhostText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  modalBtnPrimary: {
    backgroundColor: '#1D4ED8',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    marginStart: 'auto',
  },
  modalBtnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
