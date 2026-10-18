import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';

/** Callers supply only actions the viewer may perform in this game state. */
export function PlayerRecruitmentActions({ onAddMembers, onInviteAvailable, onAddGuest }: {
  onAddMembers?: () => void;
  onInviteAvailable?: () => void;
  onAddGuest?: () => void;
}) {
  const actions: { key: string; label: string; accessibilityLabel: string; icon: keyof typeof Ionicons.glyphMap; onPress?: () => void }[] = [
    { key: 'members', label: 'צרף מהמועדון', accessibilityLabel: 'צרף חברים מהמועדון', icon: 'people-outline' as const, onPress: onAddMembers },
    { key: 'available', label: 'הזמן פנויים', accessibilityLabel: 'הזמן שחקנים זמינים מהאפליקציה', icon: 'search-outline' as const, onPress: onInviteAvailable },
    { key: 'guest', label: 'הוסף אורח', accessibilityLabel: 'הוסף אורח', icon: 'person-add-outline' as const, onPress: onAddGuest },
  ].filter(action => action.onPress);
  if (!actions.length) return null;
  return <View style={styles.bar}>
    {actions.map((action, index) => <Pressable
      key={action.key}
      onPress={action.onPress}
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel}
      style={({ pressed }) => [styles.action, index > 0 && styles.divider, pressed && styles.pressed]}
    >
      <Ionicons name={action.icon} size={25} color={colors.primary} />
      <Text style={styles.label}>{action.label}</Text>
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CDDDFF', borderRadius: 18, paddingVertical: 10 },
  action: { flex: 1, minWidth: 0, minHeight: 54, paddingHorizontal: 5, gap: 6, alignItems: 'center', justifyContent: 'center' },
  divider: { borderStartWidth: 1, borderStartColor: '#E0E9FB' },
  pressed: { opacity: 0.65 },
  label: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#12234D', textAlign: 'center' },
});
