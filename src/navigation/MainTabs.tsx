import React from 'react';
import { View } from 'react-native';
import {
  BottomTabBar,
  BottomTabBarProps,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import { GameStack } from './GameStack';
import { ProfileStack } from './ProfileStack';
import { CommunitiesStack } from './CommunitiesStack';
import { BannerAd } from '@/services/adsService';
import { colors } from '@/theme';
import { he } from '@/i18n/he';

// 3-tab layout. RTL flips flexDirection automatically, so array index 0 →
// rightmost on screen, last index → leftmost. v2 order:
//   right: Communities → center: Games (primary) → left: Profile
export type MainTabsParamList = {
  CommunitiesTab: undefined;
  GameTab: undefined;
  ProfileTab: undefined;
};

const Tab = createBottomTabNavigator<MainTabsParamList>();

// Walks the (possibly nested) navigation state down to the leaf so we can
// suppress ads on routes that need a clean screen (e.g., the live match
// timer). Tab navigators return a state with nested stack states inside
// each tab, hence the recursion.
function leafRouteName(state: BottomTabBarProps['state']): string | undefined {
  let cur: { index: number; routes: { name: string; state?: unknown }[] } = state;
  while (cur && cur.routes && cur.routes[cur.index]?.state) {
    cur = cur.routes[cur.index].state as typeof cur;
  }
  return cur?.routes?.[cur.index]?.name;
}

const NO_ADS_ROUTES = new Set<string>(['LiveMatch']);

function TabBarWithBanner(props: BottomTabBarProps) {
  const showBanner = !NO_ADS_ROUTES.has(leafRouteName(props.state) ?? '');
  // `width: '100%'` is load-bearing — `ANCHORED_ADAPTIVE_BANNER` (and
  // even some fixed sizes) need a measurable width on the parent or
  // the native ad request never fires. Without it the banner mounts
  // into a 0-width View and AdMob shows 0 requests in the console.
  return (
    <View style={{ width: '100%' }}>
      {showBanner ? <BannerAd /> : null}
      <BottomTabBar {...props} />
    </View>
  );
}

export function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <TabBarWithBanner {...props} />}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
        },
        tabBarIcon: ({ color, size }) => {
          const icon: keyof typeof Ionicons.glyphMap = (() => {
            switch (route.name) {
              case 'ProfileTab':      return 'person-outline';
              case 'CommunitiesTab':  return 'globe-outline';
              case 'GameTab':         return 'football-outline';
            }
          })();
          return <Ionicons name={icon} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name="CommunitiesTab"
        component={CommunitiesStack}
        options={{ title: he.tabCommunities }}
        listeners={({ navigation, route }) => ({
          // Tapping a tab from inside a deep route (e.g. CommunityDetails
          // → MatchDetails) used to leave the user on that nested
          // screen. The intuitive behaviour is "tap tab = go home" —
          // pop the nested stack to its root when the user re-presses
          // the already-focused tab.
          tabPress: (e) => resetTabToRoot(e, navigation, route.name),
        })}
      />
      <Tab.Screen
        name="GameTab"
        component={GameStack}
        options={{ title: he.tabGame }}
        listeners={({ navigation, route }) => ({
          tabPress: (e) => resetTabToRoot(e, navigation, route.name),
        })}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStack}
        options={{ title: he.tabProfile }}
        listeners={({ navigation, route }) => ({
          tabPress: (e) => resetTabToRoot(e, navigation, route.name),
        })}
      />
    </Tab.Navigator>
  );
}

// When the focused tab is tapped again, pop the inner stack back to
// its root screen instead of being a no-op (RN Navigation default).
// Other tab presses (focus change) keep the default — preserving the
// nested route the user was on. If the user is already on the root
// of the focused tab we DO NOTHING — re-navigating triggers an
// extra render + a brief flicker for no UX gain.
function resetTabToRoot(
  e: { defaultPrevented: boolean; preventDefault: () => void },
  navigation: { isFocused: () => boolean; getState: () => unknown; dispatch: (a: unknown) => void },
  tabName: string,
) {
  if (!navigation.isFocused()) return; // first tap → just focus
  const state = navigation.getState() as {
    routes: Array<{
      name: string;
      state?: { index?: number; routes: Array<{ name: string }> };
    }>;
  };
  const tabRoute = state.routes.find((r) => r.name === tabName);
  const stackRoutes = tabRoute?.state?.routes;
  const rootName = stackRoutes?.[0]?.name;
  if (!rootName) return;
  // Already at the root of this tab? Suppress the navigate to avoid
  // re-mount / flicker. `index` is the focused route index in the
  // nested stack; 0 means "on root, no children pushed".
  const stackIndex = tabRoute?.state?.index ?? 0;
  if (stackIndex === 0 && stackRoutes && stackRoutes.length === 1) {
    return;
  }
  e.preventDefault();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (navigation as any).navigate(tabName, { screen: rootName });
}
