// NotificationEducationSheet — the sentence before the OS dialog.
//
// A fresh install used to meet "Allow Teamder to send notifications?" before
// it had seen a single match. A dialog asked at the wrong moment is answered
// "no" once, permanently — and on iOS there is no second chance at all. So the
// OS is asked only after somebody has done something a notification is
// obviously about, and only after Teamder has said, in its own words, what
// would arrive.
//
// The copy names what the BACKEND ACTUALLY SENDS. Each line was checked
// against a dispatch in `functions/src/index.ts` — see `notificationOffer.ts`
// for which notification backs which context. Promising a push that never
// comes is worse than not asking.
//
// Built from the same pieces as the contextual auth sheet, including both
// lessons that sheet was fixed for in round 7: `justifyContent:'flex-end'`
// because SpringSheet's bottom panel is a BOX rather than a bottom-anchored
// row, and `RTL_LABEL_ALIGN` because `textAlign:'right'` under forceRTL means
// "end of paragraph", which in Hebrew is the visual left.

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SpringSheet } from '@/components/anim/SpringSheet';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { OfferContext } from '@/services/notificationOffer';

/** Title + body per context. Exhaustive, so a new context is a compile error
 *  here rather than a sheet that says something generic. */
const COPY: Record<OfferContext, { title: string; body: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  join_game: {
    title: he.notifOfferGameTitle,
    body: he.notifOfferGameBody,
    icon: 'football-outline',
  },
  join_club: {
    title: he.notifOfferClubTitle,
    body: he.notifOfferClubBody,
    icon: 'shield-outline',
  },
  availability: {
    title: he.notifOfferAvailabilityTitle,
    body: he.notifOfferAvailabilityBody,
    icon: 'calendar-outline',
  },
};

export type EducationAction = 'allow' | 'not_now' | 'settings' | 'dismiss';

interface Props {
  visible: boolean;
  context: OfferContext;
  /** True when the OS will not show its dialog again — the primary CTA then
   *  points at Settings instead of promising a prompt that cannot appear. */
  blocked?: boolean;
  onAction: (action: EducationAction) => void;
}

export function NotificationEducationSheet({
  visible,
  context,
  blocked,
  onAction,
}: Props) {
  // Android is edge-to-edge, so a Modal draws under the navigation bar.
  const insets = useSafeAreaInsets();
  const copy = COPY[context];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      // Hardware back = "not now". It is a dismissal, not a decision about
      // notifications, and it must never raise the OS dialog.
      onRequestClose={() => onAction('dismiss')}
    >
      <SpringSheet
        visible={visible}
        onBackdropPress={() => onAction('dismiss')}
        panelStyle={{ justifyContent: 'flex-end' }}
      >
        <View style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]}>
          <View style={styles.handle} />

          <View style={styles.badge}>
            <Ionicons name={copy.icon} size={26} color={colors.primary} />
          </View>

          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>
            {blocked ? he.notifOfferBlockedBody : copy.body}
          </Text>

          <Pressable
            onPress={() => onAction(blocked ? 'settings' : 'allow')}
            style={({ pressed }) => [styles.primary, pressed && { opacity: 0.92 }]}
            accessibilityRole="button"
            accessibilityLabel={blocked ? he.notifOfferSettingsCta : he.notifOfferAllowCta}
          >
            <Text style={styles.primaryText}>
              {blocked ? he.notifOfferSettingsCta : he.notifOfferAllowCta}
            </Text>
          </Pressable>

          {/* Closes, and does nothing else. No OS dialog, no navigation, no
              error — the person carries on with whatever they were doing. */}
          <Pressable
            onPress={() => onAction('not_now')}
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel={he.notifOfferLaterCta}
          >
            <Text style={styles.secondaryText}>{he.notifOfferLaterCta}</Text>
          </Pressable>
        </View>
      </SpringSheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h2,
    fontWeight: '900',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.xs,
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  primary: {
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  primaryText: {
    ...typography.body,
    fontWeight: '800',
    color: colors.textOnPrimary,
    textAlign: 'center',
  },
  secondary: { alignSelf: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  secondaryText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});
