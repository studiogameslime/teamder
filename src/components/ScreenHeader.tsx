import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography } from '@/theme';

export interface HeaderAction {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** Tint color override; defaults to colors.text. Use colors.danger for destructive. */
  tint?: string;
  /** Optional accessibility label. */
  label?: string;
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
  center: {
    flex: 1,
    alignItems: 'center',
  },
  // Header titles are visually centered, but the text inside still
  // reads RTL (Hebrew flows right→left within its centered box).
  title: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
