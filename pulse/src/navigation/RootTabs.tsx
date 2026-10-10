import React, { useEffect, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { colors } from '../theme';
import { OverviewScreen } from '../screens/OverviewScreen';
import { UsersStack } from './UsersStack';
import { ReviewsScreen } from '../screens/ReviewsScreen';
import { RevenueScreen } from '../screens/RevenueScreen';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
import { MapScreen } from '../screens/MapScreen';
import { SegmentScreen } from '../screens/SegmentScreen';
import { CampaignsScreen } from '../screens/CampaignsScreen';
import { SourcesScreen } from '../screens/SourcesScreen';
import { DevInboxStack } from './ErrorsStack';
import { TasksScreen } from '../screens/TasksScreen';
import { listWork } from '../services/workItems';
import { QuotaScreen } from '../screens/QuotaScreen';
import { VersionsScreen } from '../screens/VersionsScreen';
import { NotificationsLogScreen } from '../screens/NotificationsLogScreen';
import { PushScreen } from '../screens/PushScreen';
import { TokenHealthScreen } from '../screens/TokenHealthScreen';
import { AdsScreen } from '../screens/AdsScreen';
import { ChatsScreen } from '../screens/ChatsScreen';
import { MessagesScreen } from '../screens/MessagesScreen';
import { IdeasScreen } from '../screens/IdeasScreen';
import { StickersScreen } from '../screens/StickersScreen';
import { GamesScreen } from '../screens/GamesScreen';
import { AvailabilityScreen } from '../screens/AvailabilityScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { OnboardingActivityScreen } from '../screens/OnboardingActivityScreen';
import { AppMenu } from '../components/AppMenu';

const Tab = createBottomTabNavigator();
const Empty = () => null;

// The four primary destinations on the bar (left → right):
// משימות · דשבורד · גרסאות · תפריט.
//
// Tasks sits FIRST because it's the launch screen: the dashboard used to hold
// that slot and opened on four heavy network calls, so the app started on a
// spinner. Tasks reads one collection and paints from disk, so it's up
// immediately — the dashboard is still one tap away when its numbers are
// actually wanted.
const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Tasks: 'checkbox',
  Overview: 'stats-chart',
  Versions: 'rocket',
  DevInbox: 'construct',
};

const HIDDEN: { name: string; title: string; component: React.ComponentType<any> }[] = [
  { name: 'OnboardingActivity', title: 'מסלול ההצטרפות', component: OnboardingActivityScreen },
  // Off the bar since the tasks screen took over: the raw streams (errors,
  // QA) are still reachable here for digging into a specific report.
  { name: 'DevInbox', title: 'תיבת פיתוח', component: DevInboxStack },
  { name: 'Segment', title: 'סגמנטים', component: SegmentScreen },
  { name: 'Campaigns', title: 'קמפיינים', component: CampaignsScreen },
  { name: 'Stickers', title: 'מדבקות', component: StickersScreen },
  { name: 'Sources', title: 'קישורים', component: SourcesScreen },
  { name: 'Users', title: 'משתמשים', component: UsersStack },
  { name: 'Games', title: 'משחקים', component: GamesScreen },
  { name: 'Availability', title: 'זמינות', component: AvailabilityScreen },
  { name: 'Analytics', title: 'אנליטיקה', component: AnalyticsScreen },
  { name: 'Map', title: 'מפה', component: MapScreen },
  { name: 'Reviews', title: 'ביקורות', component: ReviewsScreen },
  { name: 'Revenue', title: 'הכנסות', component: RevenueScreen },
  { name: 'Quota', title: 'מכסות', component: QuotaScreen },
  { name: 'NotificationsLog', title: 'התראות אחרונות', component: NotificationsLogScreen },
  { name: 'Push', title: 'פושים', component: PushScreen },
  { name: 'TokenHealth', title: 'בריאות טוקנים', component: TokenHealthScreen },
  { name: 'Ads', title: 'מודעות', component: AdsScreen },
  { name: 'Messages', title: 'הודעות', component: MessagesScreen },
  { name: 'Chats', title: "צ'אטים", component: ChatsScreen },
  { name: 'Ideas', title: 'רעיונות', component: IdeasScreen },
  { name: 'Settings', title: 'הגדרות', component: SettingsScreen },
];

function MoreButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={st.menuBtn} onPress={onPress}>
      <Ionicons name="ellipsis-horizontal" size={24} color={colors.textMuted} />
      <Text style={st.menuLbl}>עוד</Text>
    </Pressable>
  );
}

export function RootTabs() {
  const [menuOpen, setMenuOpen] = useState(false);
  // Open work — the bubble on the משימות tab. Counts EVERY stream now that the
  // screen shows every stream; a bubble that only knew about `tasks` under-
  // reported the moment errors and reports moved onto the same list. Items
  // Claude has finished still count: they are waiting for the owner's review,
  // which is exactly the thing the bubble should keep nagging about.
  // Shares the same caches as the screen, so this costs no extra read while
  // they are warm.
  const [openCount, setOpenCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      listWork()
        .then((w) => alive && setOpenCount(w.filter((i) => i.state !== 'done').length))
        .catch(() => {});
    refresh();
    // 5-min cadence: within the cache TTL this is free, and a task count that
    // lags a few minutes behind costs nothing.
    const id = setInterval(refresh, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
          tabBarLabelStyle: { fontSize: 11 },
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={ICONS[route.name] ?? 'ellipse'} size={size} color={color} />
          ),
        })}
      >
        <Tab.Screen
          name="Tasks"
          component={TasksScreen}
          options={{
            title: 'משימות',
            tabBarBadge: openCount > 0 ? openCount : undefined,
            tabBarBadgeStyle: { backgroundColor: colors.red, color: '#fff', fontSize: 11 },
          }}
        />
        <Tab.Screen name="Overview" component={OverviewScreen} options={{ title: 'דשבורד' }} />
        <Tab.Screen name="Versions" component={VersionsScreen} options={{ title: 'גרסאות' }} />
        <Tab.Screen
          name="Menu"
          component={Empty}
          options={{ title: 'עוד', tabBarButton: () => <MoreButton onPress={() => setMenuOpen(true)} /> }}
        />
        {HIDDEN.map((h) => (
          <Tab.Screen
            key={h.name}
            name={h.name}
            component={h.component}
            options={{ title: h.title, tabBarItemStyle: { display: 'none' }, tabBarButton: () => null }}
          />
        ))}
      </Tab.Navigator>
      <AppMenu visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

const st = StyleSheet.create({
  menuBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, gap: 2 },
  menuLbl: { color: colors.textMuted, fontSize: 11 },
});
