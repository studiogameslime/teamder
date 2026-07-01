// HomeGreetingHeader — the compact top bar of the home screen. Replaces the
// big stadium hero: a time-of-day greeting ("בוקר טוב, מתן 👋") with the user's
// avatar on the leading (right) edge, and the menu + edit buttons trailing.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import type { User } from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

function greetingWord(hour: number): string {
  if (hour >= 5 && hour < 12) return he.greetingMorning;
  if (hour >= 12 && hour < 17) return he.greetingNoon;
  if (hour >= 17 && hour < 22) return he.greetingEvening;
  return he.greetingNight;
}

export function HomeGreetingHeader({
  user,
  onMenu,
  onEdit,
}: {
  user: Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;
  onMenu: () => void;
  onEdit: () => void;
}) {
  const firstName = (user.name ?? '').trim().split(/\s+/)[0] || '';
  const greeting = firstName
    ? he.greetingWithName(greetingWord(new Date().getHours()), firstName)
    : greetingWord(new Date().getHours());
  return (
    <View style={styles.row}>
      {/* Leading (right under RTL): greeting + avatar. */}
      <View style={styles.greetWrap}>
        <Pressable onPress={onEdit} hitSlop={6}>
          <UserAvatar user={user} size={48} ring />
        </Pressable>
        {/* Wrap to a 2nd line instead of truncating to "…, מ…" on long
            greeting+name combos (e.g. "צהריים טובים, מתן"). */}
        <Text style={styles.greeting} numberOfLines={2}>
          {greeting} <Text>👋</Text>
        </Text>
      </View>
      {/* Trailing (left): menu + edit. */}
      <View style={styles.actions}>
        <Pressable style={styles.iconBtn} onPress={onMenu} hitSlop={6}>
          <Ionicons name="menu" size={22} color={colors.text} />
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={onEdit} hitSlop={6}>
          <Ionicons name="create-outline" size={20} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  greetWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  greeting: {
    ...typography.h2,
    color: colors.text,
    fontWeight: '900',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
});
