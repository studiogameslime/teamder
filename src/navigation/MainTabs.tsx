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
  return (
    <View>
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
      />
      <Tab.Screen
        name="GameTab"
        component={GameStack}
        options={{ title: he.tabGame }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStack}
        options={{ title: he.tabProfile }}
      />
    </Tab.Navigator>
  );
}
