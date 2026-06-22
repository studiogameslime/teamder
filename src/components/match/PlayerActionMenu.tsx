// PlayerActionMenu — a small popover menu ANCHORED to a tapped player (a
// speech-bubble with a caret pointing at their avatar), not a centred modal.
// The header makes it obvious WHO was tapped (avatar + name), then a short
// list of actions ("כרטיס שחקן", "הלך הביתה" / "החזר למשחק").
//
// Used on the live-match surface: tap any player avatar → this menu opens
// right next to them. The owner of the tappable row reports the avatar's
// on-screen rect (via MeasurablePressable) so the menu lands beside it.

import React, { useRef } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import { colors, radius, spacing, typography } from '@/theme';

export interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlayerMenuTarget {
  player: { id: string; name: string; avatarId?: string; photoUrl?: string };
  anchor: MenuAnchor;
}

export interface PlayerMenuItem {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Optional muted second line (e.g. why an item is disabled). */
  sublabel?: string;
  /** Tint for the icon + label (defaults to the primary blue). */
  color?: string;
  disabled?: boolean;
  onPress: () => void;
}

/** A Pressable that reports its own on-screen rect when tapped — so a parent
 *  can anchor a popover to it. Wrap a player avatar with this. */
export function MeasurablePressable({
  onMeasured,
  children,
  style,
  hitSlop,
  accessibilityLabel,
}: {
  onMeasured: (rect: MenuAnchor) => void;
  children: React.ReactNode;
  style?: object;
  hitSlop?: number;
  accessibilityLabel?: string;
}) {
  const ref = useRef<View>(null);
  const handle = () => {
    const node = ref.current;
    if (!node) return;
    node.measureInWindow((x, y, w, h) => onMeasured({ x, y, width: w, height: h }));
  };
  return (
    <Pressable
      ref={ref}
      onPress={handle}
      hitSlop={hitSlop}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Pressable>
  );
}

const CARD_W = 230;
const MARGIN = 12;

export function PlayerActionMenu({
  target,
  items,
  onClose,
}: {
  target: PlayerMenuTarget | null;
  items: PlayerMenuItem[];
  onClose: () => void;
}) {
  if (!target) return null;

  const screen = Dimensions.get('window');
  // Rough card height: header (~58) + each item (~50). Used only for the
  // above/below flip decision.
  const estH = 64 + items.length * 52;
  const a = target.anchor;
  const centerX = a.x + a.width / 2;
  let left = centerX - CARD_W / 2;
  left = Math.max(MARGIN, Math.min(left, screen.width - CARD_W - MARGIN));
  const caretLeft = Math.max(18, Math.min(centerX - left, CARD_W - 18));
  // Prefer below the avatar; flip above if there isn't room.
  const below = a.y + a.height + 10 + estH < screen.height - MARGIN;
  const top = below ? a.y + a.height + 10 : a.y - 10 - estH;

  const stop = (e: GestureResponderEvent) => e.stopPropagation();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.card, { width: CARD_W, top, left }]} onPress={stop}>
          {/* caret pointing at the avatar */}
          <View
            style={[
              styles.caret,
              { left: caretLeft - 8 },
              below ? styles.caretUp : styles.caretDown,
            ]}
          />
          {/* Header — WHO was tapped. Avatar leads on the visual right. */}
          <View style={styles.header}>
            <UserAvatar
              user={{
                id: target.player.id,
                name: target.player.name,
                avatarId: target.player.avatarId,
                photoUrl: target.player.photoUrl,
              }}
              size={36}
            />
            <Text style={styles.headerName} numberOfLines={1}>
              {target.player.name}
            </Text>
          </View>

          <View style={styles.divider} />

          {items.map((it) => {
            const tint = it.disabled ? colors.textMuted : it.color ?? colors.primary;
            return (
              <Pressable
                key={it.key}
                style={({ pressed }) => [
                  styles.item,
                  pressed && !it.disabled && styles.itemPressed,
                ]}
                onPress={() => {
                  if (it.disabled) return;
                  onClose();
                  it.onPress();
                }}
                disabled={it.disabled}
              >
                <Ionicons name={it.icon} size={20} color={tint} />
                <View style={styles.itemTextWrap}>
                  <Text style={[styles.itemLabel, { color: it.disabled ? colors.textMuted : colors.text }]}>
                    {it.label}
                  </Text>
                  {it.sublabel ? (
                    <Text style={styles.itemSub}>{it.sublabel}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Whole overlay laid out LTR so every absolute `left` (card position + caret)
  // lives in ONE physical coordinate frame — the same trick InfoTip uses to
  // keep anchoring correct under Android forceRTL. Text stays Hebrew-right via
  // explicit alignment below.
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.18)', direction: 'ltr' },
  card: {
    position: 'absolute',
    direction: 'ltr',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
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
  caretUp: { top: -8, borderBottomWidth: 8, borderBottomColor: colors.surface },
  caretDown: { bottom: -8, borderTopWidth: 8, borderTopColor: colors.surface },
  header: {
    // direction:'ltr' card → row-reverse puts the avatar on the visual RIGHT.
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  headerName: {
    flex: 1,
    minWidth: 0,
    ...typography.bodyBold,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  item: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 11,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
  },
  itemPressed: { backgroundColor: colors.surfaceMuted },
  itemTextWrap: { flex: 1, minWidth: 0 },
  itemLabel: {
    ...typography.body,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  itemSub: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 1,
  },
});
