import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

export interface HeaderAction {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** Tint color override; defaults to colors.text. Use colors.danger for destructive. */
  tint?: string;
  /** Optional accessibility label. */
  label?: string;
  /** Optional unread/pending count — renders a red badge over the icon. */
  badge?: number;
}

interface Props {
  title: string;
  subtitle?: string;
  /**
   * @deprecated Use `actions` instead. `rightIcon` + `onRightPress` are
   * kept for backward compatibility — they render as a single action in
   * the same slot.
   */
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightPress?: () => void;
  /**
   * Action buttons rendered in the slot opposite to "back". In an RTL
   * layout (this app's default) that visually lands on the LEFT side of
   * the header. Pass an array; the first action is closest to the title.
   */
  actions?: HeaderAction[];
  showBack?: boolean;
}

export function ScreenHeader({
  title,
  subtitle,
  rightIcon,
  onRightPress,
  actions,
  showBack = true,
}: Props) {
  const navigation = useNavigation<any>();
  const canGoBack = showBack && navigation.canGoBack();

  // Merge legacy single-icon API into the actions array.
  const resolvedActions: HeaderAction[] =
    actions && actions.length > 0
      ? actions
      : rightIcon && onRightPress
        ? [{ icon: rightIcon, onPress: onRightPress }]
        : [];

  return (
    <View style={styles.root}>
      <View style={styles.side}>
        {canGoBack && (
          <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
            {/* In RTL, "back" is the right-pointing chevron. */}
            <Ionicons name="chevron-forward" size={26} color={colors.text} />
          </Pressable>
        )}
      </View>
      <View style={styles.center}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      <View style={[styles.side, styles.actionsSide]}>
        {resolvedActions.map((a, i) => (
          <Pressable
            key={`${a.icon}-${i}`}
            onPress={a.onPress}
            hitSlop={10}
            accessibilityLabel={a.label}
            style={({ pressed }) => [
              styles.actionBtn,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Ionicons
              name={a.icon}
              size={22}
              color={a.tint ?? colors.text}
            />
            {a.badge && a.badge > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{a.badge > 99 ? '99+' : a.badge}</Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  side: {
    width: 32,
    alignItems: 'center',
  },
  // Override fixed width when there's room for multiple actions; allow
  // the side to grow up to the content size while staying compact.
  actionsSide: {
    width: 'auto',
    minWidth: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  center: {
    flex: 1,
    alignItems: 'flex-start',
    paddingHorizontal: spacing.sm,
  },
  // Titles read from the visual start of an RTL line. Use
  // `RTL_LABEL_ALIGN` (which maps to 'left' on Android because
  // I18nManager.forceRTL flips 'right' to mean paragraph END → visual
  // left, and 'right' on iOS where the flip doesn't happen). Hardcoded
  // 'right' + writingDirection here used to break Android RTL.
  title: {
    ...typography.h3,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
  },
});
