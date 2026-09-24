import React, { useEffect } from 'react';
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
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { AnimatedTabIcon } from '@/components/anim/AnimatedTabIcon';
import { chatService } from '@/services/chatService';
import { useChatStore, totalUnread } from '@/store/chatStore';
import { useUserStore } from '@/store/userStore';
import { colors } from '@/theme';
import { he } from '@/i18n/he';
import { maybeInterceptTabLeave } from '@/navigation/tabLeaveGuard';
import {
  planTabPress,
  inFlightSettled,
  type InFlight,
} from '@/navigation/tabTransition';

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
  // App-wide unread subscriber: keeps the chat store fresh so the tab
  // badge + chats-list previews update no matter which tab is open.
  const uid = useUserStore((s) => s.currentUser?.id);
  const isGuest = useUserStore((s) => s.currentUser?.isGuest === true);
  useEffect(() => {
    if (!uid) {
      useChatStore.getState().clear();
      return;
    }
    const unsub = chatService.subscribeUnread(uid, (list) =>
      useChatStore.getState().setEntries(list),
    );
    return unsub;
  }, [uid]);
  const chatBadge = useChatStore((s) => totalUnread(s.entries));

  return (
    <Tab.Navigator
      // Land on the Home tab (the player-card-turned-dashboard): greeting,
      // next game, pending requests, setup checklist, tips + quick actions.
      // It's the leading (right under RTL) tab, where "home" conventionally sits.
      //
      // EXCEPT for a guest, who has no greeting to read, no next game and no
      // checklist — their home tab is an empty profile belonging to a person
      // who does not exist, which is the worst possible first screen for
      // somebody deciding whether this app is for them. They land on the
      // games feed instead: it already carries a discovery list and already
      // handles "you are in no clubs" with a one-line note rather than a
      // wall, so it shows real games with no changes at all.
      //
      // Not a redesign — a different existing screen, chosen because it is
      // the one that works. The organic entry experience proper is its own
      // round.
      initialRouteName={isGuest ? 'GameTab' : 'ProfileTab'}
      tabBar={(props) => <TabBarWithBanner {...props} />}
      screenOptions={({ route }) => ({
        headerShown: false,
        // Slide the whole bottom bar (banner + tabs) away when the keyboard
        // opens — so a chat input sits flush on the keyboard instead of
        // floating above the bar / an empty banner strip.
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
        },
        tabBarIcon: ({ color, size, focused }) => {
          const icon: keyof typeof Ionicons.glyphMap = (() => {
            switch (route.name) {
              case 'ProfileTab':      return 'home-outline';
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
      {/* Home — the leading (right under RTL) tab + the app's landing screen. */}
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStack}
        options={{ title: he.tabHome }}
        listeners={({ navigation, route }) => ({
          tabPress: (e) => resetTabToRoot(e, navigation, route.name),
        })}
      />
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
        options={{
          title: he.tabChat,
          tabBarBadge: chatBadge > 0 ? (chatBadge > 99 ? '99+' : chatBadge) : undefined,
        }}
        listeners={({ navigation, route }) => ({
          tabPress: (e) => {
            logEvent(AnalyticsEvent.ChatTabPressed, { badge: chatBadge });
            resetTabToRoot(e, navigation, route.name);
          },
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
// The dispatch we have issued and not yet seen land. Module-level rather than
// component state on purpose: it must be readable SYNCHRONOUSLY inside the
// tabPress handler, before any re-render, which is the whole window a second
// rapid tap arrives in.
let inFlight: InFlight | null = null;

function resetTabToRoot(
  e: { defaultPrevented: boolean; preventDefault: () => void },
  navigation: { isFocused: () => boolean; getState: () => unknown; dispatch: (a: unknown) => void },
  tabName: string,
) {
  const state = navigation.getState() as {
    index?: number;
    routes: Array<{
      name: string;
      state?: { index?: number; routes: Array<{ name: string }> };
    }>;
  };
  const tabRoute = state.routes.find((r) => r.name === tabName);
  const stack = tabRoute?.state;
  // Prefer the CONFIGURED root; fall back to the live first route only for
  // tabs not in the map (defensive — all four are mapped).
  const rootName = TAB_ROOT[tabName] ?? stack?.routes?.[0]?.name;
  if (!rootName) return;

  const now = Date.now();
  // Retire a landed (or timed-out) in-flight record before deciding, so the
  // guard reflects where navigation actually is rather than where it was.
  const focusedTab = state.routes[state.index ?? 0]?.name;
  if (
    inFlightSettled(
      inFlight,
      {
        tabName: focusedTab ?? '',
        stack: state.routes.find((r) => r.name === focusedTab)?.state,
        isFocused: true,
      },
      now,
    )
  ) {
    inFlight = null;
  }

  const plan = planTabPress({
    tabName,
    rootName,
    stack,
    isFocused: navigation.isFocused(),
    inFlight,
    now,
  });

  if (plan.action === 'none') {
    // A duplicate of a transition already in flight must still be SWALLOWED —
    // letting the default tab-press behaviour run would issue the very second
    // navigation the guard exists to prevent.
    if (plan.reason === 'duplicate-in-flight') e.preventDefault();
    return;
  }

  const perform = () => {
    inFlight = { tabName, rootName, at: Date.now() };
    navigation.dispatch(
      plan.action === 'reset'
        ? CommonActions.navigate({
            name: tabName,
            params: {
              // Force the nested stack to exactly `[root]` — drops any
              // deep route the tab had been on (MatchDetails, etc.).
              state: { routes: [{ name: rootName }] },
            },
          })
        : // The tab is already at its root; only focus has to move. Carrying a
          // nested-state payload here would re-create the stack for no reason,
          // and it is that needless re-creation that overlaps under fast taps
          // and crashes the native view manager.
          CommonActions.navigate({ name: tabName }),
    );
  };
  // A focused edit screen with unsaved changes gets to confirm first —
  // `beforeRemove` doesn't fire on tab switches, so this is the only hook
  // that catches "tapped another tab mid-edit". The guard defers `perform`
  // until the user picks discard / finishes saving.
  if (maybeInterceptTabLeave(perform)) {
    e.preventDefault();
    return;
  }
  e.preventDefault();
  perform();
}
