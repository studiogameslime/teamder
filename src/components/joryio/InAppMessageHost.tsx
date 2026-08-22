// InAppMessageHost — renders Joryio in-app campaigns.
//
// The SDK delivers a message; drawing it is the app's job. Mount this once,
// high in the tree, and every modal / banner / slide-up campaign has somewhere
// to appear. Without it the SDK still syncs and still reports impressions —
// the message simply never shows, which is a silent failure.
//
// Two message kinds arrive. `native` is structured (title, body, buttons) and
// is rendered here with the app's own look. `html` is a self-contained document
// the campaign author wrote; we deliberately do NOT render it — that needs a
// WebView with its own sandboxing decisions — and log it instead of showing
// something half-right.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { joryio } from '@/services/joryio';
import { colors, radius, spacing, typography } from '@/theme';

type Btn = { id: string; text: string; action: 'dismiss' | 'url' | 'deep_link'; url?: string };
interface NativeMsg {
  id: string;
  name: string;
  type: 'modal' | 'banner' | 'slideup' | 'fullscreen' | 'custom';
  priority: number;
  kind: 'native';
  title?: string;
  body: string;
  imageUrl?: string;
  buttons: Btn[];
  closeButton: boolean;
  backdropDismissible: boolean;
  style?: {
    backgroundColor?: string;
    textColor?: string;
    primaryButtonColor?: string;
    primaryButtonTextColor?: string;
    cornerRadius?: number;
    fontSize?: number;
    titleWeight?: 'regular' | 'medium' | 'semibold' | 'bold';
    textAlign?: 'auto' | 'start' | 'center' | 'end';
    fontFamily?: string;
  };
}

const WEIGHT = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export function InAppMessageHost(): React.ReactElement | null {
  const [msg, setMsg] = useState<NativeMsg | null>(null);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const off = joryio.onInAppMessage((raw) => {
      const m = raw as NativeMsg & { kind: string };
      // An html campaign needs a WebView we have not built. Showing the raw
      // markup would look broken; dropping it silently would hide a campaign
      // someone scheduled. Report it and move on.
      if (m?.kind !== 'native') {
        if (__DEV__) {
          console.warn('[joryio] in-app message kind not renderable:', m?.kind, m?.id);
        }
        return;
      }
      setMsg(m);
    });
    // Pull whatever is eligible now; the listener above catches the rest.
    joryio.syncInAppCampaigns();
    return off;
  }, []);

  useEffect(() => {
    if (!msg) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    joryio.trackInAppImpression(msg.id, 'displayed');
  }, [msg, fade]);

  // The SDK classifies an interaction by SUBSTRING — an action containing
  // 'click' becomes a click, one containing 'dismiss' becomes a dismissal, and
  // anything else falls through to a DISPLAY. So the vocabulary here is wire
  // protocol, not a label: 'impression' and 'button:cta' both read as another
  // display, which is how this campaign showed 3 impressions and 0 clicks while
  // every layer underneath worked. Only 'displayed' | 'clicked' | 'dismissed'
  // may be passed to trackInAppImpression.
  const close = useCallback(
    (reason: 'dismissed' | 'clicked') => {
      if (msg) joryio.trackInAppImpression(msg.id, reason);
      setMsg(null);
    },
    [msg],
  );

  const onButton = useCallback(
    (b: Btn) => {
      if ((b.action === 'url' || b.action === 'deep_link') && b.url) {
        // Both land in the same place: a footy:// deep link and an https invite
        // URL are each handled by the app's existing link routing.
        Linking.openURL(b.url).catch(() => undefined);
      }
      // A button is a click AND a close, and the SDK's own native presenter
      // reports both for the same tap. Report them in that order so CTR counts
      // the tap and the dismissal still closes the delivery.
      if (msg) joryio.trackInAppImpression(msg.id, 'clicked');
      close('dismissed');
    },
    [close, msg],
  );

  if (!msg) return null;

  const s = msg.style ?? {};
  // Absent override = inherit the app's own styling. Never substitute a
  // default of our own for a field the campaign did not set.
  const bg = s.backgroundColor ?? colors.surface;
  const fg = s.textColor ?? colors.text;
  const accent = s.primaryButtonColor ?? colors.primary;
  const accentText = s.primaryButtonTextColor ?? '#fff';
  // typography.body.fontSize is optional in the theme's type, so it cannot be
  // multiplied for the headline without a concrete fallback.
  const bodySize = s.fontSize ?? typography.body.fontSize ?? 15;
  // `auto` aligns by the MESSAGE's language, not the device's — this workspace
  // sends Hebrew and English to the same install, so I18nManager.isRTL is the
  // wrong test. RN's writingDirection:'auto' does it per-string.
  const align =
    s.textAlign === 'center' ? 'center'
      : s.textAlign === 'start' ? 'left'
        : s.textAlign === 'end' ? 'right'
          : 'auto';

  const isBanner = msg.type === 'banner' || msg.type === 'slideup';

  return (
    <Modal transparent animationType="none" visible onRequestClose={() => close('dismissed')}>
      <Animated.View style={[styles.backdrop, isBanner && styles.backdropBanner, { opacity: fade }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => (msg.backdropDismissible ? close('dismissed') : undefined)}
        />
        <View
          style={[
            styles.card,
            isBanner && styles.cardBanner,
            msg.type === 'fullscreen' && styles.cardFull,
            { backgroundColor: bg, borderRadius: s.cornerRadius ?? radius.lg },
          ]}
        >
          {msg.closeButton ? (
            <Pressable onPress={() => close('dismissed')} hitSlop={12} style={styles.close}>
              <Text style={[styles.closeText, { color: fg }]}>✕</Text>
            </Pressable>
          ) : null}

          {msg.title ? (
            <Text
              style={[
                styles.title,
                {
                  color: fg,
                  fontSize: bodySize * 1.35,
                  fontWeight: WEIGHT[s.titleWeight ?? 'bold'],
                  textAlign: align,
                  writingDirection: 'auto',
                  ...(s.fontFamily ? { fontFamily: s.fontFamily } : {}),
                },
              ]}
            >
              {msg.title}
            </Text>
          ) : null}

          <Text
            style={[
              styles.body,
              {
                color: fg,
                fontSize: bodySize,
                textAlign: align,
                writingDirection: 'auto',
                ...(s.fontFamily ? { fontFamily: s.fontFamily } : {}),
              },
            ]}
          >
            {msg.body}
          </Text>

          <View style={styles.buttons}>
            {(msg.buttons ?? []).map((b, i) => (
              <Pressable
                key={b.id}
                onPress={() => onButton(b)}
                style={[
                  styles.btn,
                  i === 0
                    ? { backgroundColor: accent }
                    : { backgroundColor: 'transparent', borderColor: accent, borderWidth: 1 },
                ]}
              >
                <Text
                  style={[
                    styles.btnText,
                    { color: i === 0 ? accentText : accent, writingDirection: 'auto' },
                  ]}
                  numberOfLines={1}
                >
                  {b.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  backdropBanner: { justifyContent: 'flex-end' },
  card: { width: '100%', maxWidth: 420, padding: spacing.lg, gap: spacing.sm },
  cardBanner: { maxWidth: undefined },
  cardFull: { flex: 1, maxWidth: undefined, justifyContent: 'center' },
  close: { position: 'absolute', top: spacing.sm, left: spacing.sm, zIndex: 2, padding: 4 },
  closeText: { fontSize: 18, fontWeight: '600' },
  title: { marginTop: spacing.xs },
  body: { lineHeight: 22 },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { ...typography.label, fontWeight: '700' },
});
