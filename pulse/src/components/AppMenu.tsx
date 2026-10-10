import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius } from '../theme';
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
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'ראשי',
    items: [
      { route: 'Overview', label: 'סקירה', icon: 'home', tint: colors.primary },
      { route: 'Users', label: 'משתמשים', icon: 'people', tint: '#22C55E', screen: 'UsersList' },
      { route: 'Games', label: 'משחקים', icon: 'football', tint: '#F97316' },
      { route: 'Availability', label: 'זמינות', icon: 'calendar', tint: '#3B82F6' },
      { route: 'Analytics', label: 'אנליטיקה', icon: 'stats-chart', tint: '#06B6D4' },
      { route: 'OnboardingActivity', label: 'מסלול ההצטרפות', icon: 'footsteps', tint: '#3B82F6' },
      { route: 'Map', label: 'מפה', icon: 'map', tint: '#8B5CF6' },
    ],
  },
  {
    title: 'שיווק',
    items: [
      { route: 'Campaigns', label: 'קמפיינים', icon: 'megaphone', tint: '#F59E0B' },
      { route: 'Stickers', label: 'מדבקות', icon: 'location', tint: '#EF4444' },
      { route: 'Segment', label: 'סגמנטים', icon: 'people-circle', tint: '#3B82F6' },
      { route: 'Sources', label: 'מקורות', icon: 'link', tint: '#14B8A6' },
    ],
  },
  {
    title: 'חנות',
    items: [
      { route: 'Reviews', label: 'ביקורות', icon: 'star', tint: colors.star },
      { route: 'Revenue', label: 'הכנסות', icon: 'cash', tint: '#22C55E' },
    ],
  },
  {
    title: 'פיתוח',
    items: [
      { route: 'Messages', label: 'הודעות', icon: 'chatbubble-ellipses', tint: '#0EA5E9' },
      { route: 'DevInbox', label: 'תיבת פיתוח', icon: 'construct', tint: '#A855F7' },
      { route: 'Ideas', label: 'רעיונות', icon: 'bulb', tint: '#FACC15' },
      { route: 'Chats', label: "צ'אטים", icon: 'chatbubbles', tint: '#06B6D4' },
    ],
  },
  {
    title: 'מערכת',
    items: [
      { route: 'Versions', label: 'גרסאות', icon: 'rocket', tint: '#22C55E' },
      { route: 'Push', label: 'פושים', icon: 'paper-plane', tint: '#3B82F6' },
      { route: 'TokenHealth', label: 'בריאות טוקנים', icon: 'wifi', tint: '#EF4444' },
      { route: 'NotificationsLog', label: 'התראות אחרונות', icon: 'notifications', tint: '#F59E0B' },
      { route: 'Ads', label: 'מודעות', icon: 'megaphone', tint: '#EC4899' },
      { route: 'Quota', label: 'מכסות', icon: 'speedometer', tint: '#F59E0B' },
      { route: 'Settings', label: 'הגדרות', icon: 'settings', tint: colors.textSoft },
    ],
  },
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
              <Pressable onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={26} color={colors.textSoft} />
              </Pressable>
              <Text style={s.title}>תפריט</Text>
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
                        {on
                          ? <Text style={[s.activeTag, { color: tint }]}>פעיל</Text>
                          : <Ionicons name="chevron-back" size={18} color={colors.textMuted} />}
                        <Text style={[s.label, on && { color: tint }]}>{it.label}</Text>
                        {it.route === 'Messages' && waiting > 0 ? (
                          <View style={s.count}>
                            <Text style={s.countTxt}>{waiting}</Text>
                          </View>
                        ) : null}
                        <View style={[s.icon, { backgroundColor: tint + (on ? '33' : '22') }]}>
                          <Ionicons name={it.icon} size={20} color={tint} />
                        </View>
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
  head: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
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
  group: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textAlign: 'right', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12 },
  rowOn: { backgroundColor: colors.surfaceAlt },
  bar: { position: 'absolute', right: 0, top: 8, bottom: 8, width: 3, borderTopLeftRadius: 3, borderBottomLeftRadius: 3 },
  activeTag: { fontSize: 12, fontWeight: '800' },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'right' },
});
