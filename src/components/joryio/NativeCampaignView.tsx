import React from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeModal as Modal } from '@/components/SafeModal';
import { colors, radius, spacing, typography } from '@/theme';
import { overlaySurfaces, overlayTheme } from '@/theme/overlays';

export type Btn = { id: string; text: string; action: 'dismiss' | 'url' | 'deep_link'; url?: string };
export interface NativeMsg {
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

/** Presentation only: no campaign sync, analytics, auth, links or business writes. */
export function NativeCampaignView({ msg, opacity = 1, onClose, onButton }: {
  msg: NativeMsg; opacity?: number | Animated.Value; onClose: () => void; onButton: (button: Btn) => void;
}): React.ReactElement {
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
    <Modal transparent animationType="none" visible onRequestClose={() => onClose()}>
      <Animated.View style={[styles.backdrop, isBanner && styles.backdropBanner, { opacity }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => (msg.backdropDismissible ? onClose() : undefined)}
        />
        <View
          style={[
            styles.card,
            msg.type !== 'fullscreen' && overlaySurfaces.dialog,
            msg.closeButton && msg.type !== 'fullscreen' && styles.cardClosable,
            isBanner && styles.cardBanner,
            msg.type === 'fullscreen' && styles.cardFull,
            { backgroundColor: bg, borderRadius: s.cornerRadius ?? (msg.type === 'fullscreen' ? radius.lg : overlayTheme.dialogRadius) },
          ]}
        >
          {msg.closeButton ? (
            <Pressable onPress={() => onClose()} hitSlop={12} style={styles.close}>
              <Text style={[styles.closeText, { color: fg }]}>✕</Text>
            </Pressable>
          ) : null}

          <ScrollView style={styles.contentScroll} contentContainerStyle={styles.content}>
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
          </ScrollView>

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
    backgroundColor: overlayTheme.backdrop,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  backdropBanner: { justifyContent: 'flex-end' },
  card: { width: '100%', maxWidth: 420, maxHeight: '100%', padding: spacing.lg, gap: spacing.sm },
  contentScroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: spacing.sm },
  cardClosable: { paddingTop: spacing.lg + spacing.sm * 2 },
  cardBanner: { maxWidth: undefined },
  // No padding and no colour: an html message paints its own background right
  // to the edge, and a surface-coloured inset would frame it in the app's
  // theme instead of the author's.
  cardHtml: { padding: 0, gap: 0, overflow: 'hidden', backgroundColor: 'transparent' },
  cardFull: { flex: 1, maxWidth: undefined, justifyContent: 'center' },
  close: { position: 'absolute', top: spacing.sm, left: spacing.sm, zIndex: 2, padding: 4 },
  closeText: { fontSize: 18, fontWeight: '600' },
  // Its own contrast: the document behind it can be any colour, so the glyph
  // rides on a dark disc rather than borrowing a theme token.
  closeTextHtml: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    width: 26,
    height: 26,
    lineHeight: 26,
    textAlign: 'center',
    borderRadius: 13,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
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
