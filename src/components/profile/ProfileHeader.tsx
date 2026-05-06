// ProfileHeader — compact identity band at the top of the redesigned
// player card. Renders the user's profile photo (or chosen avatar)
// over a brand-blue gradient.

import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { UserAvatar } from '@/components/UserAvatar';
import type { User } from '@/types';
import { spacing } from '@/theme';

interface Props {
  user: Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;
  name: string;
  style?: ViewStyle;
}

export function ProfileHeader({ user, name, style }: Props) {
  return (
    <View style={[styles.wrap, style]}>
      <LinearGradient
        colors={['#1E40AF', '#1E3A8A', '#0F172A']}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.content}>
        <View style={styles.avatarWrap}>
          <UserAvatar user={user} size={92} ring />
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  content: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  avatarWrap: {
    marginBottom: spacing.xs,
  },
  name: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
});
