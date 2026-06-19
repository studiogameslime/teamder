// RequestsBell — a self-contained header button (bell + pending-count badge)
// that opens the unified Requests inbox. Drop it into any main screen's header;
// it fetches the cheap count on focus and navigates to the 'Requests' route in
// the current stack (each main stack registers that route).

import React, { useEffect, useState } from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useUserStore } from '@/store/userStore';
import { getInboxCount } from '@/services/requestsService';
import { colors } from '@/theme';
import { he } from '@/i18n/he';

export function RequestsBell({
  color = '#1E40AF',
  bg = '#EFF3FF',
}: {
  color?: string;
  bg?: string;
}) {
  const nav = useNavigation<any>();
  const user = useUserStore((s) => s.currentUser);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetchCount = () => {
      if (user) getInboxCount(user.id).then(setCount).catch(() => {});
    };
    fetchCount();
    return nav.addListener('focus', fetchCount);
  }, [nav, user]);

  if (!user) return null;

  return (
    <Pressable
      onPress={() => nav.navigate('Requests')}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg }, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={he.requestsTitle}
      hitSlop={8}
    >
      <Ionicons name="notifications-outline" size={20} color={color} />
      {count > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF3FF',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
});
