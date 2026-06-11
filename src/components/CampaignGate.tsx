// Global popup-campaign host. Mounted once near the app root; when the
// signed-in user matches an active popup campaign (authored in Pulse), it
// renders a one-shot modal. The button routes via navigateCampaign; both
// the button tap and a dismiss count as an impression (frequency-capped in
// campaignService). Fails silent — never blocks the app.

import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { useUserStore } from '@/store/userStore';
import {
  getEligiblePopup,
  markPopupSeen,
  trackCampaignEvent,
  type PopupCampaign,
} from '@/services/campaignService';
import { navigateCampaign } from '@/navigation/navigationRef';

interface Props {
  // Gate the lookup until the app is past splash + on a real screen, so a
  // popup never races the cold-start navigation.
  active: boolean;
}

export function CampaignGate({ active }: Props) {
  const currentUser = useUserStore((s) => s.currentUser);
  const [popup, setPopup] = useState<PopupCampaign | null>(null);
  // Only ever auto-show one popup per app session — avoids a second popup
  // appearing after the user navigates back to home.
  const shownThisSession = useRef(false);

  useEffect(() => {
    if (!active || !currentUser || shownThisSession.current) return;
    let cancelled = false;
    // Small delay so the home screen settles before we overlay anything.
    const t = setTimeout(async () => {
      const p = await getEligiblePopup(currentUser);
      if (!cancelled && p) {
        shownThisSession.current = true;
        setPopup(p);
        // Record the impression in the LOCAL cap ledger at show-time, not on
        // close — otherwise a force-kill while the modal is open leaves the
        // cap un-incremented and the "once" popup re-shows every launch.
        void markPopupSeen(p.id);
        void trackCampaignEvent(p.id, 'impression');
      }
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [active, currentUser]);

  if (!popup) return null;

  const close = () => {
    // Seen already recorded at show-time; here we only log the engagement.
    void trackCampaignEvent(popup.id, 'dismiss');
    setPopup(null);
  };

  const onAction = () => {
    void trackCampaignEvent(popup.id, 'click');
    if (popup.action.type !== 'dismiss') navigateCampaign(popup.action);
    setPopup(null);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Pressable style={styles.x} onPress={close} hitSlop={10}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
          {popup.popupTitle ? <Text style={styles.title}>{popup.popupTitle}</Text> : null}
          {popup.popupBody ? <Text style={styles.body}>{popup.popupBody}</Text> : null}
          <Button
            title={popup.buttonText || 'הבנתי'}
            variant="primary"
            size="lg"
            fullWidth
            onPress={onAction}
            style={{ backgroundColor: '#3B82F6', borderColor: '#3B82F6' }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  // RTL swaps left/right, so `right` lands the ✕ on the visual LEFT.
  x: { position: 'absolute', top: spacing.md, right: spacing.md, padding: 4, zIndex: 2 },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 22,
    marginBottom: spacing.sm,
    textAlign: RTL_LABEL_ALIGN,
  },
});
