// InviteMembersSheet — the beat straight after a club is created.
//
// WHY IT EXISTS. 29 of the 53 real clubs in production have exactly ONE member:
// someone created a club and never got anyone into it. The create flow ended by
// landing on the club page with confetti — celebrating an empty room and
// leaving the invite as a button further down that the creator has to go and
// find. This asks once, in the one moment the intent is highest, and takes no
// for an answer.
//
// Not a gate. "אחר כך" closes it and nothing is blocked; the CTA lower on the
// screen stays exactly where it was.

import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SpringSheet } from '@/components/anim/SpringSheet';
import { PressableScale } from '@/components/PressableScale';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { motion } from '@/theme/motion';
import { he } from '@/i18n/he';

interface Props {
  visible: boolean;
  /** The club's name, so the sheet is about THEIR club and not about clubs. */
  clubName: string;
  /** Runs the existing share flow — short link + invitedBy attribution. */
  onShare: () => void;
  onDismiss: () => void;
}

export function InviteMembersSheet({ visible, clubName, onShare, onDismiss }: Props) {
  if (!visible) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onDismiss}>
      <SpringSheet visible onBackdropPress={onDismiss}>
        <View style={styles.sheet}>
          <View style={styles.iconWrap}>
            <Ionicons name="people" size={26} color={colors.primary} />
          </View>

          <Text style={styles.title}>{he.inviteSheetTitle(clubName)}</Text>
          <Text style={styles.body}>{he.inviteSheetBody}</Text>

          <PressableScale
            onPress={onShare}
            pressedScale={motion.press.controlScale}
            haptic={false}
            style={styles.cta}
            accessibilityRole="button"
            accessibilityLabel={he.inviteSheetCta}
          >
            {/* Row on the inner View — see HomeRoundCards. */}
            <View style={styles.ctaRow}>
              <Text style={styles.ctaText}>{he.inviteSheetCta}</Text>
              <Ionicons name="share-social" size={18} color="#FFFFFF" />
            </View>
          </PressableScale>

          <PressableScale
            onPress={onDismiss}
            pressedScale={motion.press.controlScale}
            haptic={false}
            style={styles.later}
            accessibilityRole="button"
            accessibilityLabel={he.inviteSheetLater}
          >
            <Text style={styles.laterText}>{he.inviteSheetLater}</Text>
          </PressableScale>
        </View>
      </SpringSheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.xs,
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
    marginBottom: spacing.sm,
  },
  cta: {
    justifyContent: 'center',
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  later: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A real, reachable way out — not a greyed-out afterthought. The sheet is a
  // suggestion, and a suggestion the user cannot comfortably decline is a gate.
  laterText: { ...typography.label, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
});
