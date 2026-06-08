// InfoTip — a small ⓘ icon that opens a brief explanation in a popover
// ANCHORED to the icon (a speech-bubble with a caret pointing at it),
// not a centred modal. Drop it next to any label that needs a "what is
// this / why" hint.
//
//   <InfoTip title="אורך המשחק" text="משך הזמן הכולל של המשחק…" />

import React, { useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
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
const EST_H = 170; // rough card height for the above/below decision

interface Anchor {
  top: number;
  left: number;
  caretLeft: number;
  above: boolean;
}

export function InfoTip({ title, text, size = 18, color = colors.textMuted }: Props) {
  const ref = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const open = () => {
    const node = ref.current;
    if (!node) return;
    node.measureInWindow((x, y, w, h) => {
      const screen = Dimensions.get('window');
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
              style={[styles.card, { width: CARD_W, top: anchor.top, left: anchor.left }]}
              onPress={(e) => e.stopPropagation()}
            >
              {/* caret — a real triangle pointing at the icon */}
              <View
                style={[
                  styles.caret,
                  { left: anchor.caretLeft - 8 },
                  anchor.above ? styles.caretDown : styles.caretUp,
                ]}
              />
              {title ? <Text style={styles.title}>{title}</Text> : null}
              <Text style={styles.body}>{text}</Text>
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
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.25)',
  },
  card: {
    position: 'absolute',
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
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
    lineHeight: 21,
  },
  gotItWrap: {
    alignSelf: 'flex-start',
    paddingTop: spacing.xs,
  },
  gotIt: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '800',
  },
});
