import React from 'react';
import { View } from 'react-native';
import {
  BottomTabBar,
  BottomTabBarProps,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { GameStack } from './GameStack';
import { ProfileStack } from './ProfileStack';
import { CommunitiesStack } from './CommunitiesStack';
import { ChatStack } from './ChatStack';
import { BannerAd } from '@/services/adsService';
import { AnimatedTabIcon } from '@/components/anim/AnimatedTabIcon';
import { colors } from '@/theme';
import { he } from '@/i18n/he';

// 3-tab layout. RTL flips flexDirection automatically, so array index 0 →
// rightmost on screen, last index → leftmost. v2 order:
//   right: Communities → center: Games (primary) → left: Profile
export type MainTabsParamList = {
  CommunitiesTab: undefined;
  GameTab: undefined;
  ChatTab: undefined;
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
      // Land on Games (the core "what's happening / join a game" surface)
      // instead of the Communities list, which read as a directory rather
      // than a home. Tab order in the bar is unchanged.
      initialRouteName="GameTab"
      tabBar={(props) => <TabBarWithBanner {...props} />}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
        },
        tabBarIcon: ({ color, size, focused }) => {
          const icon: keyof typeof Ionicons.glyphMap = (() => {
            switch (route.name) {
              case 'ProfileTab':      return 'person-outline';
              case 'CommunitiesTab':  return 'globe-outline';
              case 'GameTab':         return 'football-outline';
              case 'ChatTab':         return 'chatbubble-outline';
            }
          })();
          return (
            <AnimatedTabIcon
              name={icon}
              focused={focused}
              color={color}
              size={size}
            />
          );
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
        name="ChatTab"
        component={ChatStack}
        options={{ title: he.tabChat }}
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

// The CONFIGURED root screen for each tab's nested stack — must match
// the `initialRouteName` of GameStack / CommunitiesStack / ProfileStack.
// We reset to THIS, never to `stackRoutes[0]`, because a deep-link that
// navigated into a tab without `initial: false` can leave a non-root
// screen as the stack's first/only route (e.g. Friends becoming the
// ProfileTab root after a friend push). That bad state also gets
// PERSISTED, so reading the live first route would make "tap tab → root"
// keep landing on the wrong screen forever. Resetting to the known root
// self-heals any such corrupted/persisted stack on the next tab tap.
const TAB_ROOT: Record<string, string> = {
  GameTab: 'GamesList',
  CommunitiesTab: 'CommunitiesFeed',
  ChatTab: 'ChatsList',
  ProfileTab: 'Profile',
};

// Every tab press — whether the tab is currently focused or not —
// resets the nested stack so the user lands on that tab's root
// screen ("the feed"). Previously we used `navigate(tabName, {
// screen: rootName })`, which navigates-or-pushes inside the stack
// but doesn't guarantee the stack ends up as exactly `[root]` — when
// a stack arrives via a deep-linked notification with `initial: false`
// or via a multi-screen drill-down, the nested screens can survive
// the tab tap. The explicit `state: { routes: [{ name: root }] }`
// payload replaces the nested state outright, so taps on the
// Communities / Games tabs land on the feed every time, never on
// MatchDetails or CommunityDetails.
function resetTabToRoot(
  e: { defaultPrevented: boolean; preventDefault: () => void },
  navigation: { isFocused: () => boolean; getState: () => unknown; dispatch: (a: unknown) => void },
  tabName: string,
) {
  const state = navigation.getState() as {
    routes: Array<{
      name: string;
      state?: { index?: number; routes: Array<{ name: string }> };
    }>;
  };
  const tabRoute = state.routes.find((r) => r.name === tabName);
  const stackRoutes = tabRoute?.state?.routes;
  // Prefer the CONFIGURED root; fall back to the live first route only for
  // tabs not in the map (defensive — all three are mapped).
  const rootName = TAB_ROOT[tabName] ?? stackRoutes?.[0]?.name;
  if (!rootName) return;
  // Already at the root of this tab AND it's the focused tab → no-op.
  // (If the user is on tab A's root and taps tab A again, nothing to
  // do.) When switching FROM a different tab we let the navigate fire
  // even if the destination was already at root, because we still
  // need to actually focus the tab.
  // "Already at root" means the stack is EXACTLY [configured-root] — not
  // merely length 1. A persisted [Friends]-only stack is length 1 but its
  // sole route is NOT the root, so we must still reset (self-heal) instead
  // of no-op'ing and leaving the user stuck on the wrong screen.
  const stackIndex = tabRoute?.state?.index ?? 0;
  const alreadyAtRoot =
    stackIndex === 0 &&
    stackRoutes?.length === 1 &&
    stackRoutes[0]?.name === rootName;
  if (alreadyAtRoot && navigation.isFocused()) return;
  e.preventDefault();
  navigation.dispatch(
    CommonActions.navigate({
      name: tabName,
      params: {
        // Force the nested stack to exactly `[root]` — drops any
        // deep route the tab had been on (MatchDetails, etc.).
        state: { routes: [{ name: rootName }] },
      },
    }),
  );
}
