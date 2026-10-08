// InfoTip — a small ⓘ icon that opens a brief explanation in a popover
// ANCHORED to the icon (a speech-bubble with a caret pointing at it),
// not a centred modal. Drop it next to any label that needs a "what is
// this / why" hint.
//
//   <InfoTip title="אורך המשחק" text="משך הזמן הכולל של המשחק…" />

import React, { useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeModal as Modal } from '@/components/SafeModal';
import { useSafeAreaFrame } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  /** Bold heading inside the popover. */
  title?: string;
  /** The explanation body. */
  text: string;
  /** Icon size — defaults to 18 so it reads as a real, tappable affordance. */
  size?: number;
  /** Override the muted icon tint (e.g. on a coloured header). */
  color?: string;
}

const CARD_W = 280;
const MARGIN = 12;
/**
 * First-paint guess for the above/below decision only.
 *
 * It is a guess, and for a long explanation it is wildly wrong — the seasons
 * text is nearer 400pt, so a card placed "below" on the strength of 170 ran
 * off the bottom of the screen and took its own title with it. The real
 * height arrives from `onLayout` a frame later and re-clamps (see `onCard`),
 * so this only has to be close enough for the first frame.
 */
const EST_H = 170;

interface Anchor {
  top: number;
  left: number;
  caretLeft: number;
  above: boolean;
}

export function InfoTip({ title, text, size = 18, color = colors.textMuted }: Props) {
  const screen = useSafeAreaFrame();
  const ref = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  /**
   * Re-place the card once its real height is known.
   *
   * Keeps the side it was given (above / below the icon) and only pulls it
   * back inside the screen, so a long card grows upward instead of off the
   * bottom edge. Guarded on an actual change, or the layout pass and the
   * state update chase each other.
   */
  const onCard = (h: number) => {
    setAnchor((a) => {
      if (!a || h <= 0) return a;
      const maxTop = screen.height - MARGIN - h;
      const next = Math.max(MARGIN, Math.min(a.top, maxTop));
      return next === a.top ? a : { ...a, top: next };
    });
  };

  const open = () => {
    const node = ref.current;
    if (!node) return;
    node.measureInWindow((windowX, windowY, w, h) => {
      const x = windowX - screen.x;
      const y = windowY - screen.y;
      const iconCenterX = x + w / 2;
      let left = iconCenterX - CARD_W / 2;
      left = Math.max(MARGIN, Math.min(left, screen.width - CARD_W - MARGIN));
      const caretLeft = Math.max(16, Math.min(iconCenterX - left, CARD_W - 16));
      // Prefer below the icon; flip above if there isn't room.
      const above = y + h + 8 + EST_H > screen.height - MARGIN;
      const top = above ? y - 8 - EST_H : y + h + 8;
      setAnchor({ top, left, caretLeft, above });
    });
  };

  return (
    <>
      <Pressable
        ref={ref}
        onPress={open}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={he.infoTipA11y}
        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="information-circle-outline" size={size} color={color} />
      </Pressable>

      <Modal
        visible={!!anchor}
        transparent
        animationType="fade"
        onRequestClose={() => setAnchor(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setAnchor(null)}>
          {anchor ? (
            <Pressable
              // direction:'ltr' (in styles.card) makes the caret child's
              // absolute `left` resolve to PHYSICAL left — under Android
              // forceRTL an inherited-RTL parent mirrored it, throwing the
              // caret to the wrong side of the card. The card's OWN position
              // (`left: anchor.left`) is resolved in the backdrop's frame and
              // is unaffected by this.
              style={[styles.card, { width: CARD_W, top: anchor.top, left: anchor.left }]}
              onPress={(e) => e.stopPropagation()}
              onLayout={(e) => onCard(e.nativeEvent.layout.height)}
            >
              {/* caret — a real triangle pointing at the icon */}
              <View
                style={[
                  styles.caret,
                  { left: anchor.caretLeft - 8 },
                  anchor.above ? styles.caretDown : styles.caretUp,
                ]}
              />
              {/* The card is laid out LTR so the caret's absolute `left` is
                  physical. Hebrew inside it therefore needs its OWN direction
                  rather than a textAlign override per <Text> — with only the
                  override, a long line started outside the card's padding and
                  the first character was clipped. One RTL block, and the text
                  lays out in the frame it is actually written in. */}
              <View style={styles.textBlock}>
                {title ? <Text style={styles.title}>{title}</Text> : null}
                <Text style={styles.body}>{text}</Text>
              </View>
              <Pressable onPress={() => setAnchor(null)} style={styles.gotItWrap} hitSlop={6}>
                <Text style={styles.gotIt}>{he.infoTipGotIt}</Text>
              </Pressable>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  textBlock: { direction: 'rtl', alignSelf: 'stretch' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.25)',
    // The whole overlay is laid out LTR so every absolute `left` here —
    // the card's position, the caret, and the icon's measureInWindow x —
    // lives in ONE consistent physical coordinate frame. Under Android
    // forceRTL an inherited-RTL overlay mirrored `left`, pinning the card
    // (and caret) to the wrong side. Text stays Hebrew-right via explicit
    // textAlign:'right' + writingDirection:'rtl'.
    direction: 'ltr',
  },
  card: {
    position: 'absolute',
    // LTR so the absolutely-positioned caret child uses physical `left`
    // (see render comment). Text inside stays Hebrew-right via explicit
    // textAlign:'right' + writingDirection:'rtl' on the title/body.
    direction: 'ltr',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  caret: {
    position: 'absolute',
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  // Card is BELOW the icon → caret on the top edge pointing UP.
  caretUp: {
    top: -8,
    borderBottomWidth: 8,
    borderBottomColor: colors.surface,
  },
  // Card is ABOVE the icon → caret on the bottom edge pointing DOWN.
  caretDown: {
    bottom: -8,
    borderTopWidth: 8,
    borderTopColor: colors.surface,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    // Card is direction:'ltr', so PHYSICAL 'right' = visual right for Hebrew.
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'right',
    writingDirection: 'rtl',
    lineHeight: 21,
  },
  gotItWrap: {
    // Card is direction:'ltr'; flex-end keeps "הבנתי" on the visual right
    // (the natural end for Hebrew), where it sat under the old RTL card.
    alignSelf: 'flex-end',
    paddingTop: spacing.xs,
  },
  gotIt: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '800',
  },
});
