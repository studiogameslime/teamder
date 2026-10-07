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
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MenuIcon } from '@/components/MenuIcon';
import { UserAvatar } from '@/components/UserAvatar';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

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
  icon?: keyof typeof Ionicons.glyphMap;
  /** Custom leading glyph, rendered instead of `icon` (e.g. a referee-card
   *  rectangle where an Ionicons glyph would read as a credit card). */
  iconNode?: React.ReactNode;
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
  // Hooks BEFORE the early return — a hook below a conditional `return null`
  // runs on the render after the menu opens and not on the one before, which
  // is the count mismatch that tears a tree down.
  const insets = useSafeAreaInsets();
  // The card's REAL height, once it has laid out. The estimate below is a
  // guess (items with a sublabel are taller than 52), and the owner's reports
  // were both of a card whose last rows fell off the bottom — an estimate too
  // small clamps the top too low and the overflow is invisible to the maths.
  // First paint uses the estimate; `onLayout` then corrects it for good.
  const [measuredH, setMeasuredH] = React.useState<number | null>(null);
  const targetId = target?.player.id ?? null;
  React.useEffect(() => {
    // A new player = a new card. Drop the old measurement so the next open
    // does not clamp against the previous menu's height.
    setMeasuredH(null);
  }, [targetId, items.length]);

  if (!target) return null;

  const win = Dimensions.get('window');
  // ⚠️ `window` is the FULL window, and this app is edge-to-edge from API 35 —
  // it INCLUDES the status bar and the gesture/navigation bar. Clamping to it
  // put the bottom of the card underneath the system bar, which is precisely
  // "הכרטיס למטה חתוך!" and "לא רואים את כל התפריט". The usable band is the
  // window minus the insets.
  const topLimit = insets.top + MARGIN;
  const bottomLimit = win.height - insets.bottom - MARGIN;
  const maxH = Math.max(160, bottomLimit - topLimit);
  // Rough card height: header (~64) + each item (~52). Drives the flip
  // decision until the real height arrives. Capped to what the band can show —
  // a tall menu (card/timeline/yellow/red/remove) then scrolls instead of
  // overflowing.
  const estH = Math.min(measuredH ?? 64 + items.length * 52, maxH);
  const a = target.anchor;
  const centerX = a.x + a.width / 2;
  let left = centerX - CARD_W / 2;
  left = Math.max(
    insets.left + MARGIN,
    Math.min(left, win.width - insets.right - CARD_W - MARGIN),
  );
  const caretLeft = Math.max(18, Math.min(centerX - left, CARD_W - 18));
  // Prefer below the anchor, but flip above when there's more room there — a
  // player near the bottom of a long roster otherwise opened a menu that ran
  // off the bottom edge and clipped its last item(s).
  const spaceBelow = bottomLimit - (a.y + a.height + 10);
  const spaceAbove = a.y - 10 - topLimit;
  const below = spaceBelow >= estH || spaceBelow >= spaceAbove;
  let top = below ? a.y + a.height + 10 : a.y - 10 - estH;
  // Final safety clamp: never let the card start off-screen or extend past the
  // bottom margin, regardless of the flip decision or an under-estimated height.
  top = Math.max(topLimit, Math.min(top, bottomLimit - estH));

  const stop = (e: GestureResponderEvent) => e.stopPropagation();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.card, { width: CARD_W, top, left, maxHeight: maxH }]}
          onPress={stop}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            // Only when it actually differs — setting state to the same number
            // on every layout pass would re-render forever.
            if (Math.abs(h - (measuredH ?? -1)) > 1) setMeasuredH(h);
          }}
        >
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

          {/* Items scroll if the menu is taller than the screen allows (small
              devices + a 5-item menu), so the last item is never clipped. */}
          <ScrollView
            style={{ maxHeight: maxH - 76 }}
            // The list is the part that gives: the header names who was
            // tapped and must stay put.
            contentContainerStyle={{ flexGrow: 0 }}
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
            {items.map((it) => {
              const tint = it.disabled ? colors.textMuted : it.color ?? colors.primaryDark;
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
                  {it.iconNode ? (
                    <View style={styles.iconSlot}>{it.iconNode}</View>
                  ) : it.icon ? (
                    <MenuIcon name={it.icon} size={24} color={tint} />
                  ) : null}
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
          </ScrollView>
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
    borderRadius: 18,
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
    direction: 'rtl',
    flexDirection: 'row',
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
    textAlign: RTL_LABEL_ALIGN,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  item: {
    direction: 'rtl',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 13,
    minHeight: 50,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
  },
  itemPressed: { backgroundColor: colors.surfaceMuted },
  // Fixed 20-wide slot so a custom glyph (referee card) lines up with the
  // Ionicons (size 20) used by the other rows.
  iconSlot: { width: 24, alignItems: 'center', justifyContent: 'center' },
  itemTextWrap: { flex: 1, minWidth: 0 },
  itemLabel: {
    ...typography.body,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  itemSub: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 1,
  },
});
