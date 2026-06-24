// AvailabilityNudgeModal — a friendly popup nudging the user to mark which
// weekdays they're free to play, so the app can suggest matching games.
// Shown on the Matches tab to users who haven't set `availability.preferredDays`.

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { SpringSheet } from '@/components/anim/SpringSheet';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  visible: boolean;
  /** "אחר כך" / backdrop — snooze. */
  onClose: () => void;
  /** "סמן את הימים שלי" — go to the availability editor. */
  onConfirm: () => void;
}

const PERKS = [
  { icon: 'calendar' as const, text: he.availNudgePerk1 },
  { icon: 'megaphone' as const, text: he.availNudgePerk2 },
  { icon: 'football' as const, text: he.availNudgePerk3 },
];

export function AvailabilityNudgeModal({ visible, onClose, onConfirm }: Props) {
  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <SpringSheet visible={visible} onBackdropPress={onClose} position="center">
        <View style={styles.card}>
          {/* Gradient header with a calendar + football motif */}
          <LinearGradient
            colors={['#1E40AF', '#3B82F6']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.header}
          >
            <View style={styles.headerBalls}>
              <Ionicons name="football-outline" size={18} color="rgba(255,255,255,0.5)" />
              <Ionicons name="football-outline" size={13} color="rgba(255,255,255,0.35)" />
            </View>
            <View style={styles.badge}>
              <Ionicons name="calendar" size={34} color="#FFFFFF" />
            </View>
          </LinearGradient>

          <View style={styles.body}>
            <Text style={styles.title}>{he.availNudgeTitle} 📅</Text>
            <Text style={styles.sub}>{he.availNudgeBody}</Text>

            <View style={styles.perks}>
              {PERKS.map((p) => (
                <View key={p.text} style={styles.perkRow}>
                  <View style={styles.perkIcon}>
                    <Ionicons name={p.icon} size={15} color={colors.primary} />
                  </View>
                  <Text style={styles.perkText}>{p.text}</Text>
                </View>
              ))}
            </View>

            <Button
              title={he.availNudgeCta}
              onPress={onConfirm}
              fullWidth
              size="lg"
            />
            <Pressable onPress={onClose} style={styles.later} hitSlop={8}>
              <Text style={styles.laterText}>{he.availNudgeLater}</Text>
            </Pressable>
          </View>
        </View>
      </SpringSheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  header: {
    height: 118,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBalls: {
    position: 'absolute',
    top: 12,
    right: 16,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  badge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.20)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    fontWeight: '900',
    textAlign: 'center',
  },
  sub: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: spacing.xs,
  },
  perks: {
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  perkIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  later: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    marginTop: 2,
  },
  laterText: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '700',
  },
});
