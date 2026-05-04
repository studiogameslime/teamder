// HamburgerMenu — bottom sheet that holds everything that USED to live
// inline on the profile tab (settings, navigation rows, support, sign
// out, delete account). Pulled out so the profile screen itself can
// stay focused on the player card content.
//
// The sheet is purely presentational: each section + item is provided
// by the caller. We render with the platform Modal + a slide
// animation, plus a backdrop tap to dismiss. RTL is honoured by the
// app-wide forceRTL setting; styles use logical alignment via the
// RTL_LABEL_ALIGN helper where needed.
//
// Why bottom sheet (not Drawer): the app already uses bottom-tabs +
// stacks; introducing a Drawer navigator would force a navigator
// reshuffle for one screen. Modal is good enough at the size we need.

import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

export interface HamburgerItem {
  /** Stable id for keys + a11y labels. */
  id: string;
  /** Visible label. */
  label: string;
  /** Ionicons name. */
  icon: keyof typeof Ionicons.glyphMap;
  /** Handler. For regular rows the menu closes before invoking;
   *  toggle rows fire `onPress` AS WELL AS `toggle.onChange` and
   *  the menu STAYS OPEN so the user can flip the value without
   *  losing context. Optional when `toggle` is provided. */
  onPress?: () => void;
  /** Optional badge count rendered to the leading edge of the icon. */
  badge?: number;
  /** Tone — danger renders in red so destructive items don't blend in. */
  tone?: 'default' | 'danger';
  /** Optional subtitle rendered under the label (small, muted). */
  subtitle?: string;
  /**
   * When provided, the row renders a Switch on the trailing edge
   * instead of a chevron. Tapping anywhere on the row flips the
   * value via `onChange`. The menu stays open — toggles are
   * instantaneous controls, not navigation.
   */
  toggle?: {
    value: boolean;
    onChange: (next: boolean) => void;
    /** When true, the row renders disabled (Switch + Pressable). */
    disabled?: boolean;
  };
}

export interface HamburgerSection {
  id: string;
  title?: string;
  items: HamburgerItem[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
  sections: HamburgerSection[];
}

export function HamburgerMenu({ visible, onClose, sections }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* The sheet itself swallows taps so a press inside the
            sheet doesn't close it (React Native bubbles by default). */}
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <SafeAreaView edges={['bottom']} style={styles.safe}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                style={({ pressed }) => [
                  styles.closeBtn,
                  pressed && { opacity: 0.6 },
                ]}
                accessibilityLabel="סגור תפריט"
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.scroll}
              showsVerticalScrollIndicator={false}
            >
              {sections.map((section, idx) => (
                <View key={section.id} style={styles.section}>
                  {section.title ? (
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                  ) : null}
                  <View
                    style={[
                      styles.sectionCard,
                      idx > 0 && { marginTop: spacing.sm },
                    ]}
                  >
                    {section.items.map((item, i) => (
                      <MenuRow
                        key={item.id}
                        item={item}
                        showDivider={i > 0}
                        onClose={onClose}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MenuRow({
  item,
  showDivider,
  onClose,
}: {
  item: HamburgerItem;
  showDivider: boolean;
  onClose: () => void;
}) {
  const isDanger = item.tone === 'danger';
  const isToggle = !!item.toggle;
  const handlePress = () => {
    if (isToggle) {
      if (item.toggle?.disabled) return;
      item.toggle?.onChange(!item.toggle.value);
      // Toggles are instantaneous controls — don't unmount the menu.
      // The user typically wants to see the switch state update
      // before they decide to navigate elsewhere.
      item.onPress?.();
      return;
    }
    // Regular nav row — close the menu, then invoke. Defer one tick
    // so the close animation isn't blocked by a synchronous navigate.
    onClose();
    setTimeout(() => item.onPress?.(), 0);
  };
  return (
    <Pressable
      onPress={handlePress}
      disabled={isToggle && item.toggle?.disabled}
      style={({ pressed }) => [
        styles.row,
        showDivider && styles.rowDivider,
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
      accessibilityRole={isToggle ? 'switch' : 'button'}
      accessibilityLabel={item.label}
      accessibilityState={
        isToggle ? { checked: !!item.toggle?.value } : undefined
      }
    >
      <View
        style={[
          styles.iconWrap,
          isDanger ? styles.iconWrapDanger : styles.iconWrapDefault,
        ]}
      >
        <Ionicons
          name={item.icon}
          size={18}
          color={isDanger ? colors.danger : colors.primary}
        />
      </View>
      <View style={styles.rowBody}>
        <Text
          style={[
            styles.rowLabel,
            isDanger ? { color: colors.danger } : null,
          ]}
          numberOfLines={1}
        >
          {item.label}
        </Text>
        {item.subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {item.subtitle}
          </Text>
        ) : null}
      </View>
      {item.badge && item.badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{item.badge}</Text>
        </View>
      ) : null}
      {isToggle ? (
        <Switch
          value={!!item.toggle?.value}
          disabled={item.toggle?.disabled}
          onValueChange={(v) => item.toggle?.onChange(v)}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#fff"
        />
      ) : (
        <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  safe: {
    paddingTop: spacing.xs,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  section: {
    gap: 6,
  },
  sectionTitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.xs,
    marginHorizontal: spacing.sm,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapDefault: {
    backgroundColor: colors.primaryLight,
  },
  iconWrapDanger: {
    backgroundColor: '#FEE2E2',
  },
  rowBody: {
    flex: 1,
  },
  rowLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
  },
  rowSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 2,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginEnd: spacing.xs,
  },
  badgeText: {
    ...typography.caption,
    color: colors.textOnPrimary,
    fontWeight: '700',
    fontSize: 11,
  },
});

// kept exported so screens can compose without importing the file twice
export type { Props as HamburgerMenuProps };
