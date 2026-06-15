// DeleteAccountSheet — replaces the one-tap "delete account" alert with a
// typed-confirmation sheet. Account deletion is irreversible, so the delete
// button stays disabled until the user types the confirmation word (בטוח).
// Matches the app's other bottom sheets (SpringSheet + Button).

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SpringSheet } from '@/components/anim/SpringSheet';
import { Button } from '@/components/Button';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  visible: boolean;
  loading?: boolean;
  /** Email/password accounts must re-enter their password to confirm
   *  deletion (Firebase requires a fresh login). Shows a password field
   *  and passes it to `onConfirm`. */
  requirePassword?: boolean;
  onCancel: () => void;
  onConfirm: (password?: string) => void;
}

export function DeleteAccountSheet({
  visible,
  loading,
  requirePassword,
  onCancel,
  onConfirm,
}: Props) {
  const [word, setWord] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const wordOk = word.trim() === he.profileDeleteAccountConfirmWord;
  const passwordOk = !requirePassword || password.length > 0;
  const armed = wordOk && passwordOk;

  const close = () => {
    setWord('');
    setPassword('');
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
      <SpringSheet visible={visible} onBackdropPress={close}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <Ionicons name="warning-outline" size={22} color={colors.danger} />
            <Text style={styles.title}>{he.profileDeleteAccountTitle}</Text>
          </View>
          <Text style={styles.message}>{he.profileDeleteAccountMessage}</Text>

          <Text style={styles.prompt}>{he.profileDeleteAccountTypePrompt}</Text>
          <TextInput
            value={word}
            onChangeText={setWord}
            placeholder={he.profileDeleteAccountInputPlaceholder}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, wordOk && styles.inputArmed]}
            textAlign="right"
          />

          {requirePassword ? (
            <>
              <Text style={styles.prompt}>{he.deleteAccountPasswordPrompt}</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder={he.deleteAccountPasswordPlaceholder}
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.input, styles.passwordInput]}
                  textAlign="right"
                />
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={8}
                  style={styles.eyeBtn}
                  accessibilityLabel={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.textMuted}
                  />
                </Pressable>
              </View>
            </>
          ) : null}

          <Button
            title={he.profileDeleteAccountConfirm}
            variant="danger"
            size="lg"
            fullWidth
            disabled={!armed}
            loading={loading}
            onPress={() => onConfirm(requirePassword ? password : undefined)}
          />
          <Pressable onPress={close} hitSlop={8} style={styles.cancel}>
            <Text style={styles.cancelText}>{he.profileDeleteAccountCancel}</Text>
          </Pressable>
        </Pressable>
      </SpringSheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: 8,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginBottom: 6,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  message: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  prompt: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 4,
  },
  input: {
    height: 48,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    color: colors.text,
    ...typography.body,
    marginBottom: 4,
  },
  inputArmed: { borderColor: colors.danger },
  passwordRow: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingLeft: 44, marginBottom: 0 },
  eyeBtn: {
    position: 'absolute',
    left: spacing.md,
    height: 48,
    justifyContent: 'center',
  },
  cancel: { alignSelf: 'center', paddingVertical: spacing.sm },
  cancelText: { ...typography.body, color: colors.textMuted, fontWeight: '700' },
});
