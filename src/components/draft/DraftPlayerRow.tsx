import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/PressableScale';
import { UserAvatar } from '@/components/UserAvatar';
import { colors, radius, shadows, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import type { DraftUserLite } from './DraftTeamCard';

/** Shared player identity and selection surface for both draft entry points. */
export function DraftPlayerRow({ user, selected = false, disabled, badge, actionLabel, accessibilityLabel, onPress }: {
  user: DraftUserLite;
  selected?: boolean;
  disabled?: boolean;
  badge?: string;
  actionLabel?: string;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  return <PressableScale onPress={onPress} disabled={disabled}
    accessibilityRole={actionLabel ? 'button' : 'checkbox'}
    accessibilityLabel={accessibilityLabel ?? user.name}
    accessibilityState={{ checked: actionLabel ? undefined : selected, disabled: !!disabled }}
    style={[s.card, selected && s.selected, disabled && s.disabled]}>
    <View style={s.row}>
      <View style={s.identity}>
        <UserAvatar user={user} size={44}/>
        <Text style={s.name} numberOfLines={2}>{user.name}</Text>
        {!!badge && <View style={s.badge}><Ionicons name="shield-checkmark" size={13} color={colors.primary}/><Text style={s.badgeText}>{badge}</Text></View>}
      </View>
      {actionLabel ? <View style={s.action}><Text style={s.actionText}>{actionLabel}</Text></View> :
        <View style={[s.check, selected && s.checkOn]}>{selected && <Ionicons name="checkmark" size={18} color="#FFFFFF"/>}</View>}
    </View>
  </PressableScale>;
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, ...shadows.card },
  selected: { borderColor: colors.primary },
  disabled: { opacity: 0.45 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, minHeight: 48 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1, minWidth: 0 },
  name: { ...typography.body, color: colors.text, fontWeight: '700', flex: 1, minWidth: 0, textAlign: RTL_LABEL_ALIGN },
  badge: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.primaryLight, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { ...typography.caption, color: colors.primary, fontWeight: '800' },
  check: { flexShrink: 0, width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  action: { borderRadius: radius.pill, backgroundColor: colors.primaryLight, paddingVertical: 8, paddingHorizontal: 14 },
  actionText: { ...typography.caption, color: colors.primary, fontWeight: '800' },
});
