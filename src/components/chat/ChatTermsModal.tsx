// ---------------------------------------------------------------------------
// Chat terms-of-service gate.
//
// Apple App Review Guideline 1.2 and Google Play's UGC policy require that
// users explicitly accept a terms/EULA — stating a ZERO-tolerance stance on
// objectionable content — BEFORE they can post user-generated content. This
// modal is that gate for the in-app chat. Acceptance is persisted locally so
// we only ask once per device/install.
//
// This file is presentational + a small persistence hook. Wiring it into the
// chat send flow is the caller's responsibility (show the modal until
// `accepted` is true; block posting otherwise).
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

// Bump the suffix if the terms change and re-acceptance is required.
const TERMS_KEY = 'chat_terms_accepted_v1';

// --- Hebrew copy (inlined; do not touch he.ts) ---------------------------
const COPY = {
  title: 'כללי השיחה',
  body:
    'אנו מקפידים על סביבה מכבדת. אין שום סובלנות לתוכן פוגעני, הטרדה, איומים או ספאם. ' +
    'ניתן לדווח על כל הודעה ולחסום משתמשים, ומפרי הכללים יוסרו מהשירות. ' +
    'בלחיצה על "אני מסכים/ה" את/ה מאשר/ת שקראת את הכללים ומתחייב/ת לפעול לפיהם.',
  agree: 'אני מסכים/ה',
  cancel: 'ביטול',
} as const;

/**
 * Reads/writes the chat-terms acceptance flag.
 * `accepted` is `null` while the initial AsyncStorage read is in flight,
 * then a boolean.
 */
export function useChatTermsAccepted(): {
  accepted: boolean | null;
  accept: () => Promise<void>;
} {
  const [accepted, setAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const v = await AsyncStorage.getItem(TERMS_KEY);
        if (alive) setAccepted(v === '1');
      } catch {
        if (alive) setAccepted(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const accept = useCallback(async () => {
    try {
      await AsyncStorage.setItem(TERMS_KEY, '1');
    } finally {
      // Optimistically flip even if the write throws — the user did accept,
      // and the next launch will simply re-prompt if persistence failed.
      setAccepted(true);
    }
  }, []);

  return { accepted, accept };
}

interface ChatTermsModalProps {
  visible: boolean;
  onAccept: () => void;
  onClose: () => void;
}

export function ChatTermsModal({
  visible,
  onAccept,
  onClose,
}: ChatTermsModalProps): React.ReactElement {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Ionicons
              name="shield-checkmark-outline"
              size={28}
              color={colors.primary}
            />
            <Text style={styles.title}>{COPY.title}</Text>
          </View>

          <Text style={styles.body}>{COPY.body}</Text>

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && styles.pressed,
            ]}
            onPress={onAccept}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>{COPY.agree}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.secondaryBtn,
              pressed && styles.pressed,
            ]}
            onPress={onClose}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryBtnText}>{COPY.cancel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    flex: 1,
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.xl,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  primaryBtnText: {
    ...typography.button,
    color: '#FFFFFF',
  },
  secondaryBtn: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    ...typography.button,
    color: colors.textMuted,
  },
  pressed: {
    opacity: 0.7,
  },
});
