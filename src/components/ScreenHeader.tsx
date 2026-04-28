import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography } from '@/theme';

interface Props {
  title: string;
  subtitle?: string;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightPress?: () => void;
  showBack?: boolean;
}

export function ScreenHeader({
  title,
  subtitle,
  rightIcon,
  onRightPress,
  showBack = true,
}: Props) {
  const navigation = useNavigation<any>();
  const canGoBack = showBack && navigation.canGoBack();

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
      <View style={styles.side}>
        {rightIcon && (
          <Pressable onPress={onRightPress} hitSlop={12}>
            <Ionicons name={rightIcon} size={24} color={colors.text} />
          </Pressable>
        )}
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
  center: {
    flex: 1,
    alignItems: 'center',
  },
  title: { ...typography.h3, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
});
