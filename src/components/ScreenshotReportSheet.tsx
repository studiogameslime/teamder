// ScreenshotReportSheet — a global host that watches for the user taking a
// device screenshot and, the moment they do, slides a "report a bug" sheet up
// from the bottom with a CLEAN capture of the current screen already attached
// (iOS never hands us the user's actual screenshot, so we grab our own via
// react-native-view-shot). Mounted once at the navigator level.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ScreenCapture from 'expo-screen-capture';
import { captureScreen } from 'react-native-view-shot';
import { captureFullScreenBase64 } from '@/native/screenCapture';
import { SpringSheet } from '@/components/anim/SpringSheet';
import { ScreenshotAnnotator } from '@/components/ScreenshotAnnotator';
import { Button } from '@/components/Button';
import { toast } from '@/components/Toast';
import { submitFeedback } from '@/services/feedbackService';
import { navigationRef } from '@/navigation/navigationRef';
import { useUserStore } from '@/store/userStore';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

const MAX_LEN = 600;

export function ScreenshotReportSheet() {
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const capturingRef = useRef(false);
  // Tester-only surface: the screenshot→report popup fires only for users
  // we've explicitly marked as QA testers from the Pulse dashboard.
  const isTester = useUserStore((s) => s.currentUser?.qa === true);

  const onShot = useCallback(async () => {
    // Ignore re-entrancy and don't stack a second sheet over an open one.
    if (capturingRef.current || visible) return;
    capturingRef.current = true;
    let shot: string | null = null;
    // Prefer the native PixelCopy capture (real window surface — maps/GL/video
    // come through instead of rendering black). Falls back to view-shot's
    // Canvas capture on iOS / Expo Go / pre-rebuild where the module is absent.
    shot = await captureFullScreenBase64({ quality: 0.4, maxWidth: 600 });
    if (!shot) {
      try {
        shot = await captureScreen({
          format: 'jpg',
          quality: 0.4,
          result: 'base64',
          width: 600,
        });
      } catch {
        // Capture can fail (e.g. a secure view) — still offer the report,
        // just without the attached image.
      }
    }
    capturingRef.current = false;
    setImage(shot);
    setText('');
    setVisible(true);
  }, [visible]);

  useEffect(() => {
    // Only testers get the listener at all — everyone else takes screenshots
    // without ever seeing the report sheet.
    if (!isTester) return;
    let sub: { remove: () => void } | undefined;
    try {
      sub = ScreenCapture.addScreenshotListener(() => {
        void onShot();
      });
    } catch {
      // Native module not linked (Expo Go / pre-rebuild) — no-op.
    }
    return () => sub?.remove?.();
  }, [onShot, isTester]);

  const close = () => {
    setVisible(false);
    setImage(null);
    setText('');
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const screen = navigationRef.isReady()
        ? navigationRef.getCurrentRoute()?.name
        : undefined;
      // The screenshot is the content; text is optional.
      const msg = text.trim() || he.screenshotReportDefaultMsg;
      await submitFeedback('bug', msg, screen, image ?? undefined);
      toast.success(he.screenshotReportSent);
      close();
    } catch {
      toast.error(he.feedbackError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={close}
    >
      <SpringSheet visible={visible} onBackdropPress={close}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <Ionicons name="camera-outline" size={20} color={colors.primary} />
            <Text style={styles.title}>{he.screenshotReportTitle}</Text>
          </View>
          <Text style={styles.subtitle}>{he.screenshotReportSubtitle}</Text>

          {image ? (
            <View style={styles.attachRow}>
              {/* Tap the thumbnail (or the pencil button) to mark up the shot. */}
              <Pressable onPress={() => setAnnotating(true)}>
                <Image
                  source={{ uri: `data:image/jpeg;base64,${image}` }}
                  style={styles.thumb}
                  resizeMode="cover"
                />
              </Pressable>
              <View style={styles.attachCol}>
                <View style={styles.attachBadge}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                  <Text style={styles.attachText}>{he.screenshotReportAttached}</Text>
                </View>
                <Pressable
                  onPress={() => setAnnotating(true)}
                  style={({ pressed }) => [styles.annotateCta, pressed && { opacity: 0.85 }]}
                >
                  <Ionicons name="brush-outline" size={15} color={colors.primary} />
                  <Text style={styles.annotateCtaText}>{he.screenshotAnnotateCta}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <TextInput
            value={text}
            onChangeText={(t) => setText(t.slice(0, MAX_LEN))}
            placeholder={he.screenshotReportPlaceholder}
            placeholderTextColor={colors.textMuted}
            multiline
            style={styles.input}
            textAlign="right"
          />

          <Button
            title={he.screenshotReportSend}
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            onPress={submit}
          />
          <Pressable onPress={close} hitSlop={8} style={styles.cancel}>
            <Text style={styles.cancelText}>{he.cancel}</Text>
          </Pressable>
        </Pressable>
      </SpringSheet>

      {/* Markup overlay — draw on the screenshot to circle what's wrong. */}
      <ScreenshotAnnotator
        visible={annotating}
        image={image}
        onCancel={() => setAnnotating(false)}
        onDone={(annotated) => {
          setImage(annotated);
          setAnnotating(false);
        }}
      />
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  // The attached-screenshot row — thumbnail + a green "attached" badge so
  // the user can SEE the capture rode along.
  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginTop: 4,
  },
  thumb: {
    width: 54,
    height: 96,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  attachCol: {
    flex: 1,
    gap: spacing.sm,
  },
  attachBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  attachText: {
    ...typography.body,
    color: colors.success,
    fontWeight: '700',
  },
  annotateCta: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  annotateCtaText: {
    ...typography.button,
    color: colors.primary,
  },
  input: {
    minHeight: 88,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    color: colors.text,
    ...typography.body,
    textAlignVertical: 'top',
    marginTop: 4,
  },
  cancel: { alignSelf: 'center', paddingVertical: spacing.sm },
  cancelText: { ...typography.body, color: colors.textMuted, fontWeight: '700' },
});
