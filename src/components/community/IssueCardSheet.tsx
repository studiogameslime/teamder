// IssueCardSheet — a small bottom sheet an admin uses to give a player a
// yellow/red card in the community, with an optional free-text detail that
// shows on the player's timeline.
//
// Built on SpringSheet + the shared Button (matching DeleteAccountSheet and
// the app's other bottom sheets) instead of a raw slide Modal with bespoke
// Pressable buttons — one consistent sheet animation + button language.

import React, { useEffect, useState } from 'react';
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
import { SpringSheet } from '@/components/anim/SpringSheet';
import { Button } from '@/components/Button';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export function IssueCardSheet({
  visible,
  playerName,
  cardType,
  saving,
  onSave,
  onClose,
}: {
  visible: boolean;
  playerName: string;
  cardType: 'yellow' | 'red' | null;
  saving: boolean;
  onSave: (detail: string) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState('');
  useEffect(() => {
    if (visible) setDetail('');
  }, [visible, cardType]);

  const isRed = cardType === 'red';
  const cardLabel = isRed ? he.cardRed : he.cardYellow;
  const accent = isRed ? colors.danger : colors.warning;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <SpringSheet visible={visible} onBackdropPress={saving ? undefined : onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.grip} />
            <View style={styles.titleRow}>
              <View style={[styles.chip, { backgroundColor: accent }]}>
                <Ionicons name="card" size={16} color="#FFF" />
              </View>
              <Text style={styles.title} numberOfLines={2}>
                {he.issueCardTitle(playerName, cardLabel)}
              </Text>
            </View>

            <Text style={styles.label}>{he.cardDetailLabel}</Text>
            <TextInput
              style={styles.input}
              value={detail}
              onChangeText={setDetail}
              placeholder={he.cardDetailPlaceholder}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={200}
              textAlign={RTL_LABEL_ALIGN === 'left' ? 'right' : 'left'}
            />

            <View style={styles.actions}>
              <Button
                title={he.cancel}
                variant="outline"
                size="lg"
                style={styles.actionBtn}
                disabled={saving}
                onPress={onClose}
              />
              <Button
                title={he.save}
                variant={isRed ? 'danger' : 'primary'}
                size="lg"
                style={styles.actionBtn}
                loading={saving}
                onPress={() => onSave(detail)}
              />
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </SpringSheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kav: { marginTop: 'auto' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  grip: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: spacing.sm },
  titleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm },
  chip: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, ...typography.h3, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  label: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, marginTop: spacing.xs },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row-reverse', gap: spacing.sm, marginTop: spacing.sm },
  actionBtn: { flex: 1 },
});
