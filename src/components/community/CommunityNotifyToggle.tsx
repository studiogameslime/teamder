// CommunityNotifyToggle — single white row with the new-game
// subscription toggle. Layout under forceRTL:
//
//   [Switch] ………………………… "עדכנו אותי על משחקים חדשים בקהילה" [🔔]
//   ↑ leading                                    trailing ↑
//
// The Switch is the LEFT (leading) child so it sits on the visual
// left, the bell icon is the LAST child so it sits on the visual right
// next to the label. Tapping anywhere on the row toggles the switch.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RTL_LABEL_ALIGN, spacing } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  subscribed: boolean;
  onChange: (next: boolean) => void;
}

const ACCENT = '#3B82F6';

export function CommunityNotifyToggle({ subscribed, onChange }: Props) {
  // Local mirror so the Switch animates immediately while the parent
  // persists asynchronously.
  const [on, setOn] = useState(subscribed);

  const flip = (next: boolean) => {
    setOn(next);
    onChange(next);
  };

  return (
    <Pressable
      onPress={() => flip(!on)}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: 'rgba(15,23,42,0.03)' },
      ]}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
    >
      <Switch
        value={on}
        onValueChange={flip}
        trackColor={{ false: '#E2E8F0', true: ACCENT }}
        thumbColor="#FFFFFF"
        ios_backgroundColor="#E2E8F0"
      />
      <Text style={styles.label} numberOfLines={2}>
        {he.communityNotifyDesignTitle}
      </Text>
      <View style={styles.iconDisc}>
        <Ionicons name="notifications" size={18} color={ACCENT} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  label: {
    flex: 1,
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
  },
  iconDisc: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59,130,246,0.12)',
  },
});
