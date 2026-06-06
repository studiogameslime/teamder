// InfoTip — a small ⓘ icon that opens a brief explanation in a centred
// modal. The app had no reusable way to explain a feature inline; drop this
// next to any label/header that needs a "what is this / why" hint.
//
//   <InfoTip title="מד אמינות" text="מד שמשקף עד כמה אפשר לסמוך עליך…" />

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  /** Bold heading inside the popover. */
  title?: string;
  /** The explanation body. */
  text: string;
  /** Icon size — match the label it sits next to. */
  size?: number;
  /** Override the muted icon tint (e.g. on a coloured header). */
  color?: string;
}

export function InfoTip({ title, text, size = 18, color = colors.textMuted }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={he.infoTipA11y}
        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="information-circle-outline" size={size} color={color} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <View style={styles.iconCircle}>
              <Ionicons name="information-circle" size={28} color={colors.primary} />
            </View>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            <Text style={styles.body}>{text}</Text>
            <Button
              title={he.infoTipGotIt}
              variant="primary"
              size="md"
              fullWidth
              onPress={() => setOpen(false)}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
    alignItems: 'center',
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary + '1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
});
