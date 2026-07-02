// IssueCardSheet — a small bottom sheet an admin uses to give a player a
// yellow/red card in the community, with an optional free-text detail that
// shows on the player's timeline.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
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
              <Pressable style={styles.cancelBtn} onPress={onClose} disabled={saving}>
                <Text style={styles.cancelTxt}>{he.cancel}</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, { backgroundColor: accent }, saving && { opacity: 0.6 }]}
                onPress={() => onSave(detail)}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.saveTxt}>{he.save}</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'flex-end' },
  kav: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
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
  saveBtn: { flex: 1, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { ...typography.button, color: '#FFF', fontWeight: '800' },
  cancelBtn: { flex: 1, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  cancelTxt: { ...typography.button, color: colors.text, fontWeight: '700' },
});
