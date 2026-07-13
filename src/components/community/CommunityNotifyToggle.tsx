// CommunityNotifyToggle — single white row with the new-game
// subscription toggle. Layout under forceRTL:
//
//   [Switch] ………………………… "עדכנו אותי על משחקים חדשים במועדון" [🔔]
//   ↑ trailing                                    leading ↑
//
// Under forceRTL a `flexDirection: 'row'` renders children right-to-left,
// so the FIRST child sits on the visual RIGHT and the LAST on the visual
// LEFT. Per user request we swapped them: the bell (🔔) is now the first
// child → visual RIGHT next to its label; the Switch is the last child →
// visual LEFT. Tapping anywhere on the row toggles the switch.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { BallSwitch } from '@/components/anim/BallSwitch';
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
  // Re-sync if the source-of-truth prop changes (e.g. a failed persist that the
  // store later corrects) — otherwise the switch could display the wrong state.
  useEffect(() => setOn(subscribed), [subscribed]);

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
      <View style={styles.iconDisc}>
        <Ionicons name="notifications" size={18} color={ACCENT} />
      </View>
      <Text style={styles.label} numberOfLines={2}>
        {he.communityNotifyDesignTitle}
      </Text>
      <BallSwitch
        value={on}
        onValueChange={flip}
        trackColor={{ false: '#E2E8F0', true: ACCENT }}
        thumbColor="#FFFFFF"
      />
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
