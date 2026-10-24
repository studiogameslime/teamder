import { ActivityWorkspace, GrowthWorkspace, NotificationsWorkspace, workspaceAlias } from '../screens/WorkspacesScreen';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { colors } from '../theme';
import { UsersStack } from './UsersStack';
import { ClubsStack } from './ClubsStack';
import { ReviewsScreen } from '../screens/ReviewsScreen';
import { RevenueScreen } from '../screens/RevenueScreen';
import { DevInboxStack } from './ErrorsStack';
import { TasksScreen } from '../screens/TasksScreen';
import { onWorkSnapshot } from '../services/workItems';
import { QuotaScreen } from '../screens/QuotaScreen';
import { VersionsScreen } from '../screens/VersionsScreen';
import { AdsScreen } from '../screens/AdsScreen';
import { ChatsScreen } from '../screens/ChatsScreen';
import { MessagesScreen } from '../screens/MessagesScreen';
const IdeasScreen = () => <TasksScreen initialFilter="idea"/>;
import { GamesStack } from './GamesStack';
import { AvailabilityScreen } from '../screens/AvailabilityScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { OnboardingActivityScreen } from '../screens/OnboardingActivityScreen';
import { AppMenu } from '../components/AppMenu';

const Tab = createBottomTabNavigator();
const Empty = () => null;

// Primary destinations: משימות · אנשים · מועדונים · גרסאות · עוד.
//
// Tasks sits FIRST because it's the launch screen: the dashboard used to hold
// that slot and opened on four heavy network calls, so the app started on a
// spinner. Tasks reads the work streams and paints cached tasks, so it's up
// immediately — the dashboard is still one tap away when its numbers are
// actually wanted.
const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Tasks: 'list-outline',
  Overview: 'stats-chart',
  Users: 'people',
  Clubs: 'shield-outline',
  Versions: 'layers-outline',
  DevInbox: 'construct',
};

const HIDDEN: { name: string; title: string; component: React.ComponentType<any> }[] = [
  { name: 'OnboardingActivity', title: 'מסלול ההצטרפות', component: OnboardingActivityScreen },
  // Off the bar since the tasks screen took over: the raw streams (errors,
  // QA) are still reachable here for digging into a specific report.
  { name: 'DevInbox', title: 'אבחון ודיווחים', component: DevInboxStack },
  { name: 'Segment', title: 'קהלים', component: workspaceAlias('Campaigns', 'audiences') },
  { name: 'Campaigns', title: 'קמפיינים', component: GrowthWorkspace },
  { name: 'Stickers', title: 'מדבקות', component: workspaceAlias('Campaigns', 'stickers') },
  { name: 'Sources', title: 'קישורים ומקורות', component: workspaceAlias('Campaigns', 'links') },
  { name: 'Overview', title: 'סקירה', component: ActivityWorkspace },
  { name: 'Games', title: 'מחזורים', component: GamesStack },
  { name: 'Availability', title: 'זמינות', component: AvailabilityScreen },
  { name: 'Analytics', title: 'מדדי שימוש', component: workspaceAlias('Overview', 'analytics') },
  { name: 'Map', title: 'מפת פעילות', component: workspaceAlias('Overview', 'map') },
  { name: 'Reviews', title: 'ביקורות', component: ReviewsScreen },
  { name: 'Revenue', title: 'הכנסות', component: RevenueScreen },
  { name: 'Quota', title: 'מכסות', component: QuotaScreen },
  { name: 'NotificationsLog', title: 'יומן התראות', component: workspaceAlias('Push', 'history') },
  { name: 'Push', title: 'תקינות שליחה', component: NotificationsWorkspace },
  { name: 'TokenHealth', title: 'יכולת קבלת התראות', component: workspaceAlias('Push', 'reach') },
  { name: 'Ads', title: 'מודעות', component: AdsScreen },
  { name: 'Messages', title: 'שיחות תמיכה', component: MessagesScreen },
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
  // Badge reflects the last queue load; it never scans collections on its own.
  const [openCount, setOpenCount] = useState(0);
  const [countFailed, setCountFailed] = useState(true);
  useEffect(() => onWorkSnapshot(snapshot => {
    setCountFailed(snapshot.failedStreams.length > 0);
    if (!snapshot.failedStreams.length) setOpenCount(snapshot.items.filter(item => item.state !== 'done').length);
  }), []);

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
          tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
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
            tabBarBadge: countFailed ? '?' : openCount > 0 ? openCount : undefined,
            tabBarBadgeStyle: { backgroundColor: colors.red, color: '#fff', fontSize: 11 },
          }}
        />
        <Tab.Screen name="Users" component={UsersStack} options={{ title: 'אנשים' }} />
        <Tab.Screen name="Clubs" component={ClubsStack} options={{ title: 'מועדונים' }} />
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
