import { observeCaughtError } from '../utils/errorObservation';
import { overlaySurfaces, overlayTheme } from '@/theme/overlays';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeModal as Modal } from '@/components/SafeModal';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { updateTargetKey, type StoreUpdate } from '@/services/updateService';
import { openTrackedUpdate } from '@/services/updateAttributionService';
import { useUserStore } from '@/store/userStore';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  update: StoreUpdate;
  type: 'force' | 'optional';
  onClose?: () => void;
}

export function UpdateModal({ type, onClose, update }: Props) {
  const isForce = type === 'force';
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { logEvent(AnalyticsEvent.UpdatePromptShown, { source: 'force_modal', target: updateTargetKey(update) }); }, [update.targetBuild, update.targetVersion]);
  const open = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setFailed(false);
    try { setFailed(!await openTrackedUpdate(update, useUserStore.getState().currentUser?.id ?? null, 'force_modal')); }
    catch (caughtErrorb51a14975e) {
    observeCaughtError(caughtErrorb51a14975e, {"source":"src/components/UpdateModal.tsx","handler":"open","site":"UpdateModal:b51a14975e"}); setFailed(true); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={isForce ? () => {} : onClose}
    >
      <Pressable
        style={styles.backdrop}
        onPress={isForce ? undefined : onClose}
      >
        <Pressable
          style={styles.card}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.iconWrap}>
            <Ionicons
              name="cloud-download-outline"
              size={28}
              color="#3B82F6"
            />
          </View>
          <Text style={styles.title}>
            {isForce ? he.updateForceTitle : he.updateOptionalTitle}
          </Text>
          <Text style={styles.body}>
            {isForce ? he.updateForceBody : he.updateOptionalBody}
          </Text>
          <View style={styles.actions}>
            {!isForce && onClose ? (
              <View style={{ flex: 1 }}>
                <Button
                  title={he.updateLater}
                  variant="outline"
                  size="lg"
                  fullWidth
                  onPress={onClose}
                />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Button
                title={he.updateNow}
                variant="primary"
                size="lg"
                fullWidth
                onPress={open}
                loading={busy}
                style={{ backgroundColor: '#3B82F6', borderColor: '#3B82F6' }}
              />
            </View>
          </View>
          {failed ? <Text accessibilityRole="alert" style={styles.body}>{he.updateStoreFailed}</Text> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: overlayTheme.backdrop,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: { ...overlaySurfaces.dialog,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    // Soft blue tint to match the new accent on the modal's primary
    // CTA below.
    backgroundColor: 'rgba(59,130,246,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
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
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
