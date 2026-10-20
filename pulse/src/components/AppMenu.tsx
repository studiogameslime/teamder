import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RTL_LABEL_ALIGN, colors, radius  } from '../theme';
import { go, navRef } from '../navigation/navRef';
import { listAwaitingReply } from '../services/teamderChatService';

// Name of the currently-focused top-level tab, so the menu can mark it.
function currentRoute(): string | undefined {
  if (!navRef.isReady()) return undefined;
  try {
    const st: any = navRef.getRootState();
    return st?.routes?.[st.index]?.name as string | undefined;
  } catch {
    return undefined;
  }
}

interface Item {
  route: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint?: string;
  // For stack-tabs: the child screen to land on, so the tab always opens at
  // its root (list) instead of restoring a previously-pushed detail screen.
  screen?: string;
}

// Grouped destinations — everything the app can reach lives here.
export const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'תמיכה ועבודה', items: [
    { route: 'Tasks', label: 'משימות', icon: 'checkbox' },
    { route: 'Users', label: 'משתמשים', icon: 'people', screen: 'UsersList' },
    { route: 'Messages', label: 'שיחות תמיכה', icon: 'chatbubble-ellipses' },
    { route: 'Chats', label: 'פיקוח על שיחות', icon: 'shield-checkmark' },
  ] },
  { title: 'פעילות ומדדים', items: [
    { route: 'Overview', label: 'סקירה, מדדים ומפה', icon: 'home' },
    { route: 'Games', label: 'מחזורים', icon: 'football', screen: 'GamesList' },
    { route: 'Availability', label: 'זמינות שחקנים', icon: 'calendar' },
    { route: 'OnboardingActivity', label: 'מסלול ההצטרפות', icon: 'footsteps' },
  ] },
  { title: 'גיוס וקשר עם משתמשים', items: [
    { route: 'Campaigns', label: 'קמפיינים, קהלים וקישורים', icon: 'megaphone' },
  ] },
  { title: 'התראות', items: [
    { route: 'Push', label: 'מרכז ההתראות', icon: 'paper-plane' },
  ] },
  { title: 'גרסאות וחנויות', items: [
    { route: 'Versions', label: 'גרסאות', icon: 'rocket' },
    { route: 'Reviews', label: 'ביקורות בחנויות', icon: 'star' },
    { route: 'Revenue', label: 'הכנסות', icon: 'cash' },
  ] },
  { title: 'מערכת', items: [
    { route: 'Ads', label: 'מודעות', icon: 'megaphone' },
    { route: 'Quota', label: 'מכסות', icon: 'speedometer' },
    { route: 'Settings', label: 'הגדרות', icon: 'settings' },
  ] },
];

export function AppMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const open = (it: Item) => { go(it.route, it.screen); onClose(); };
  const active = visible ? currentRoute() : undefined;
  // Users waiting on a reply. Fetched when the menu opens (it's cached, so a
  // reopen inside the TTL is free) — a count on the row is the only thing that
  // makes an unanswered person visible without opening the screen.
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    listAwaitingReply()
      .then((w) => alive && setWaiting(w.length))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        {/* Panel slides from the right (RTL). stopPropagation keeps taps inside. */}
        <Pressable style={s.panel} onPress={(e) => e.stopPropagation()}>
          <SafeAreaView edges={['top']} style={{ flex: 1 }}>
            <View style={s.head}>
              <Text style={s.title}>תפריט</Text>
              <Pressable accessibilityLabel="סגירת התפריט" onPress={onClose} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="close" size={24} color={colors.textSoft} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
              {GROUPS.map((g) => (
                <View key={g.title}>
                  <Text style={s.group}>{g.title}</Text>
                  {g.items.map((it) => {
                    const on = it.route === active;
                    const tint = it.tint ?? colors.primary;
                    return (
                      <Pressable key={it.route} style={[s.row, on && s.rowOn]} onPress={() => open(it)}>
                        {on ? <View style={[s.bar, { backgroundColor: tint }]} /> : null}
                        <View style={[s.icon, { backgroundColor: on ? colors.primarySoft : colors.surfaceAlt }]}>
                          <Ionicons name={it.icon} size={20} color={on ? tint : colors.textSoft} />
                        </View>
                        <Text style={[s.label, on && { color: tint }]}>{it.label}</Text>
                        {it.route === 'Messages' && waiting > 0 ? <View style={s.count}><Text style={s.countTxt}>{waiting}</Text></View> : null}
                        <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', flexDirection: 'row' },
  panel: { width: '82%', maxWidth: 360, marginLeft: 'auto', backgroundColor: colors.surface, borderLeftWidth: 1, borderLeftColor: colors.border },
  head: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  count: {
    minWidth: 20,
    paddingHorizontal: 6,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
  group: { direction: 'rtl' as const, color: colors.textMuted, fontSize: 12, fontWeight: '700', textAlign: RTL_LABEL_ALIGN, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12 },
  rowOn: { backgroundColor: colors.surfaceAlt },
  bar: { position: 'absolute', right: 0, top: 8, bottom: 8, width: 3, borderTopLeftRadius: 3, borderBottomLeftRadius: 3 },
  activeTag: { fontSize: 12, fontWeight: '800' },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { direction: 'rtl' as const, flex: 1, color: colors.text, fontSize: 16, fontWeight: '600', textAlign: RTL_LABEL_ALIGN },
});
