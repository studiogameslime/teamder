// QARouteLauncher — a dev-only way to open any screen directly.
//
// WHY THIS EXISTS. The visual census could not reach most of the product: the
// tab bar does not respond to `adb input` synthetic taps (the coordinates are
// right — verified against `uiautomator dump` — and the press simply never
// becomes a navigation). Scrolling works, in-content links sometimes work, the
// tabs never do. So a census driven through the real UI stalls at whatever is
// reachable from the first screen, which is roughly a third of the app.
//
// This floats a small button over the app that lists every registered route and
// navigates straight to it through `navigationRef`. The real navigator stays
// mounted underneath, so every screen renders exactly as it does in the product
// — this is not a preview harness, it is a shortcut to a real screen.
//
// ─── Production safety ────────────────────────────────────────────────────
//
// Two independent gates, both of which must be true:
//
//   1. `__DEV__` — false in every release build, so the import is dropped.
//   2. `EXPO_PUBLIC_QA_ROUTES === '1'` — absent from `.env.local` by default,
//      so even a dev build does not show it unless somebody asks for it.
//
// ─── Two ways in ──────────────────────────────────────────────────────────
//
// The floating button is the one a person uses. It turned out not to be
// drivable by a script: `uiautomator` reports the button and its bounds, a
// synthetic press lands on those coordinates, and the press never becomes an
// onPress — the same Android z-order/hit-test problem that makes the tab bar
// untappable. Neighbouring content on the same screen taps fine, so it is the
// overlay that is unreachable, not the input.
//
// So the launcher also answers a deep link: `footy://qa/<RouteName>`, fired
// with `adb shell am start -a android.intent.action.VIEW -d …`. No touch, no
// hit-testing, no scrolling a list to find a row. Same `navigate` call, same
// params table, and dead behind the same two gates.
//
// The scheme host `qa` is not a product link shape: `parseInviteUrl` and
// `parseAppLink` both return null for it, so nothing in the product reacts.
//
// It never writes, never reads business data, and never changes navigation
// semantics: it calls the same `navigate` the product calls. Nothing here is
// reachable from, or referenced by, any production path.

import React, { useEffect, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeModal as Modal } from '@/components/SafeModal';

import { mockGamesV2, mockRoundHistory } from '@/data/mockData';
import { IntentScreen } from '@/screens/entry/IntentScreen';
import { useEntryStore } from '@/store/entryStore';
import { MotionPreview } from './MotionPreview';
import { CommunityStatsWelcome } from '@/components/community/CommunityStatsWelcome';
import { appAlert } from '@/components/AppDialog';
import {
  ContextualAuthSheet,
  type AuthPromptReason,
} from '@/components/auth/ContextualAuthSheet';
import { navigationRef } from '@/navigation/navigationRef';

/** Both gates. Exported so the call site reads as one condition. */
export const QA_ROUTES_ENABLED =
  __DEV__ && process.env.EXPO_PUBLIC_QA_ROUTES === '1';

/**
 * Every route worth opening: its owning TAB, and the params it needs.
 *
 * The tab is not decoration. `navigate('CommunitiesCreate')` from the Home tab
 * is a silent no-op — the route lives in CommunitiesStack, and a stack that
 * does not register a name simply ignores it. That is what made two thirds of
 * the first census read as "screen did not render": the navigation never
 * happened and nothing said so. Every entry therefore names the tab that
 * actually owns the screen, and navigation goes through it:
 *
 *   navigate(tab, { screen: route, initial: false, params })
 *
 * Where a route is registered in several stacks the first one wins; the census
 * only needs one working way in.
 *
 * Params point at mock fixtures — `g1` is the mock club, `gv2-live` a mock game,
 * `p1`/`p7` mock players. In mock mode these resolve; in real mode the screen
 * shows its own not-found state, which is itself worth seeing.
 */
const ROUTES: Array<
  [label: string, route: string, tab: string, params?: object]
> = [
  ['— CREATION —', '', ''],
  ['CommunitiesCreate', 'CommunitiesCreate', 'ProfileTab'],
  ['GameCreate', 'GameCreate', 'ProfileTab'],
  ['DraftSetup', 'DraftSetup', 'ProfileTab', { gameId: 'gv2-live' }],
  ['DraftBoard', 'DraftBoard', 'ProfileTab', { gameId: 'gv2-live', captainIds: ['p1', 'p7'], method: 'snake', readOnly: false }],
  ['— CLUB —', '', ''],
  ['CommunitiesFeed', 'CommunitiesFeed', 'CommunitiesTab'],
  ['CommunityDetails', 'CommunityDetails', 'ProfileTab', { groupId: 'g1' }],
  ['CommunityDetailsPublic', 'CommunityDetailsPublic', 'ProfileTab', { groupId: 'pub_3' }],
  ['CommunityEdit', 'CommunityEdit', 'ProfileTab', { groupId: 'g1' }],
  ['CommunityPlayers', 'CommunityPlayers', 'ProfileTab', { groupId: 'g1' }],
  ['ManagerDashboard', 'ManagerDashboard', 'CommunitiesTab', { groupId: 'g1' }],
  ['ManagerRatings', 'ManagerDashboard', 'CommunitiesTab', { groupId: 'g1', initialTab: 'ratings', initialFilter: 'up' }],
  ['ManagerAllRatings', 'ManagerDashboard', 'CommunitiesTab', { groupId: 'g1', initialTab: 'ratings', initialFilter: 'all' }],
  ['ManagerRatingsDown', 'ManagerDashboard', 'CommunitiesTab', { groupId: 'g1', initialTab: 'ratings', initialFilter: 'down' }],
  ['ManagerEquipment', 'ManagerDashboard', 'CommunitiesTab', { groupId: 'g1', initialTab: 'equipment' }],
  ['ManagerClubInsights', 'ManagerDashboard', 'CommunitiesTab', { groupId: 'g1', initialTab: 'club' }],
  ['CommunityStats', 'CommunityStats', 'ProfileTab', { groupId: 'g1' }],
  ['CommunityHistory', 'CommunityHistory', 'ProfileTab', { groupId: 'g1' }],
  ['CommunitiesMap', 'CommunitiesMap', 'CommunitiesTab'],
  ['AddMembers', 'AddMembers', 'ProfileTab', { groupId: 'g1' }],
  ['AdminApproval', 'AdminApproval', 'ProfileTab', { groupId: 'g1' }],
  ['AvailablePlayers', 'AvailablePlayers', 'ProfileTab', { groupId: 'g1' }],
  ['PromoteOrphan', 'PromoteOrphan', 'GameTab', { gameId: 'gv2-live' }],
  ['— GAME —', '', ''],
  ['GamesList', 'GamesList', 'GameTab'],
  ['GamesMap', 'GamesMap', 'GameTab', { mode: 'games', items: mockGamesV2.filter(g => g.fieldLat && g.fieldLng).slice(0, 2).map((g, i) => ({ id: g.id, lat: g.fieldLat! + i * 0.025, lng: g.fieldLng! + i * 0.025, title: g.title, subtitle: g.fieldName, kind: 'game', dateBucket: 'today', timeLabel: 'היום · 20:00' })) }],
  ['MatchDetails', 'MatchDetails', 'ProfileTab', { gameId: 'gv2-live' }],
  ['FinishedMatchStats', 'MatchDetails', 'ProfileTab', { gameId: 'gv2-7', initialTab: 'stats' }],
  ['FinishedMatchGamesLong', 'MatchDetails', 'ProfileTab', { gameId: 'gv2-7', initialTab: 'games' }],
  ['MatchPlayers', 'MatchPlayers', 'ProfileTab', { gameId: 'gv2-live' }],
  ['MatchRounds', 'MatchRounds', 'ProfileTab', { gameId: 'gv2-live' }],
  ['GameEdit', 'GameEdit', 'ProfileTab', { gameId: 'gv2-live' }],
  ['LiveMatch', 'LiveMatch', 'ProfileTab', { gameId: 'gv2-live' }],
  // The evening's summary is the statistics TAB of the match screen now; the
  // standalone RoundSummary screen is gone. Same destination, new address.
  ['RoundSummary', 'MatchDetails', 'ProfileTab', { gameId: 'gv2-live', initialTab: 'stats' }],
  ['EveningSummary', 'EveningSummary', 'ProfileTab', { gameId: 'gv2-live' }],
  ['EveningSummaryQuiet', 'EveningSummary', 'ProfileTab', { gameId: 'qa-summary-quiet' }],
  ['EveningSummaryTop', 'EveningSummary', 'ProfileTab', { gameId: 'qa-summary-top' }],
  ['History', 'History', 'ProfileTab', { groupId: 'g1' }],
  ['— PROFILE / STATS —', '', ''],
  ['Profile', 'Profile', 'ProfileTab'],
  ['ProfileEdit', 'ProfileEdit', 'ProfileTab'],
  ['Statistics', 'Statistics', 'ProfileTab'],
  ['StatisticsPopulated', 'Statistics', 'ProfileTab', { qaStatisticsPreview: 'full' }],
  ['StatisticsEmpty', 'Statistics', 'ProfileTab', { qaStatisticsPreview: 'empty' }],
  ['Achievements', 'Achievements', 'ProfileTab'],
  ['SeasonTitles', 'SeasonTitles', 'ProfileTab'],
  ['SeasonSummary', 'SeasonSummary', 'ProfileTab', { groupId: 'g1' }],
  ['PlayerCard', 'PlayerCard', 'ProfileTab', { userId: 'p1' }],
  ['PlayerCompare', 'PlayerCompare', 'ProfileTab', { groupId: 'g1', otherUid: 'p1' }],
  ['PlayerTimeline', 'PlayerTimeline', 'ProfileTab', { userId: 'p1' }],
  ['AvailabilityEdit', 'AvailabilityEdit', 'ProfileTab'],
  ['AvailabilityWeek', 'AvailabilityWeek', 'ProfileTab'],
  ['— CHAT —', '', ''],
  ['ChatsList', 'ChatsList', 'ChatTab'],
  ['CommunityChat', 'CommunityChat', 'ChatTab', { groupId: 'g1' }],
  ['GameChat', 'GameChat', 'ChatTab', { gameId: 'gv2-live' }],
  ['DirectChat', 'DirectChat', 'ChatTab', { convId: 'c1' }],
  ['— SOCIAL / SETTINGS —', '', ''],
  ['Friends', 'Friends', 'ProfileTab'],
  ['Requests', 'Requests', 'ProfileTab'],
  ['Referrals', 'Referrals', 'ProfileTab'],
  ['BlockedUsers', 'BlockedUsers', 'ProfileTab'],
  ['NotificationsSettings', 'NotificationsSettings', 'ProfileTab'],
  ['Feedback', 'Feedback', 'ProfileTab'],
  ['PersonalInvite', 'PersonalInvite', 'ProfileTab', { invitedBy: 'p1' }],
  ['GuestHome', 'GuestHome', 'ProfileTab'],
  ['EmailAuth', 'EmailAuth', 'ProfileTab'],
];

/** Each tab stack's own `initialRouteName` — the screen you land on by
 *  focusing the tab and nothing more. */
const TAB_ROOT: Record<string, string> = {
  ProfileTab: 'Profile',
  CommunitiesTab: 'CommunitiesFeed',
  GameTab: 'GamesList',
  ChatTab: 'ChatsList',
};

/**
 * Navigate through the route's owning tab, in exactly ONE dispatch — the same
 * nested form `navigateCampaign` uses for push taps and campaign popups.
 *
 * Two things were learned the hard way here.
 *
 * `navigate(tab, { screen, initial: false })` does nothing when the screen IS
 * that stack's `initialRouteName`. CommunitiesFeed and GamesList both stayed
 * put; ChatsList worked, because it is not its stack's initial route. For a
 * root, focusing the tab is the whole navigation.
 *
 * And the obvious workaround — focus the tab, then navigate inside it a moment
 * later — reproduces the P0-3 crash `tabTransition.ts` exists to prevent:
 *
 *   java.lang.IllegalStateException: addViewAt: failed to insert view …
 *   Caused by: The specified child already has a parent.
 *
 * white screen, ReactHost torn down. The guard in `tabTransition.ts` covers the
 * tabPress path; a tab jump followed by a second dispatch before navigation
 * state has settled is outside it. So: never two dispatches.
 */
/** The bottom tab currently focused, or '' if that cannot be read. */
function focusedTab(): string {
  try {
    const st = navigationRef.getRootState() as
      | { index?: number; routes?: { name: string; state?: unknown }[] }
      | undefined;
    // The tab navigator sits under whatever RootNavigator has mounted, so walk
    // down until a route name matches one of the four tabs.
    let node = st;
    for (let i = 0; i < 6 && node?.routes; i += 1) {
      const cur = node.routes[node.index ?? 0];
      if (cur && TAB_ROOT[cur.name]) return cur.name;
      node = cur?.state as typeof node;
    }
  } catch {
    /* dev tool */
  }
  return '';
}

function navigateTo(route: string) {
  if (route === 'FinishedMatchGamesLong' && QA_ROUTES_ENABLED && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
    const sample = mockRoundHistory['gv2-7'].slice(0,3);
    mockRoundHistory['gv2-7'] = Array.from({length:12},(_,i)=>({...sample[i%3],roundId:String(i+1),at:(i+1)*1000}));
  }
  const hit = ROUTES.find(([label, r]) => r === route || label === route);
  route = hit?.[1] || route;
  try {
    const nav = navigationRef as unknown as {
      navigate: (r: string, p?: object) => void;
    };
    const tab = hit?.[2];
    if (tab && focusedTab() === tab) {
      // Already inside the owning stack, so the bare name is both correct and
      // what the product itself uses. The nested form is WRONG here: asking
      // for a tab that is already focused is treated as "nothing to do" and
      // the inner screen is never forwarded — CommunitiesCreate and GameCreate
      // both stayed on Profile.
      nav.navigate(route, hit?.[3]);
    } else if (!tab) {
      // No owning tab known — try it bare, so an unregistered name produces
      // the product's real behaviour (a silent no-op) rather than being
      // papered over by the tool.
      nav.navigate(route, hit?.[3]);
    } else if (TAB_ROOT[tab] === route) {
      // `initial` is omitted on purpose. `navigate(tab)` alone only focuses the
      // tab — if its stack is already deeper it stays there, so asking for
      // ChatsList while sitting on DirectChat did nothing. Naming the screen
      // without `initial: false` pops back to the root, in one dispatch.
      nav.navigate(tab, { screen: route });
    } else {
      nav.navigate(tab, { screen: route, initial: false, params: hit?.[3] });
    }
  } catch {
    /* dev tool — never throw into the app */
  }
}

/** `footy://qa/MatchDetails` → `MatchDetails`. Also carries the overlay
 *  pseudo-targets `_auth_<kind>` and `_alert_<variant>`, which are not routes.
 *  Anything else → null. */
function routeFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = /^[a-z.]+:\/\/qa\/([A-Za-z_]+)/i.exec(url.trim());
  return m ? m[1] : null;
}

/**
 * The overlay families, which are not routes and so cannot be navigated to.
 *
 * Every one of these renders the REAL component with the REAL copy — the same
 * `appAlert` the product calls and the same `ContextualAuthSheet` the auth
 * walls mount. None of them performs the action behind it: an alert's buttons
 * only close, and the auth sheet's `onAuthenticated` only closes. There is no
 * write and no navigation.
 */
const AUTH_KINDS: AuthPromptReason[] = [
  'account_upgrade',
  'join_game',
  'join_club',
  'apply_filler',
  'create_club',
  'create_game',
  'save_availability',
];

/** Each alert shape the product actually produces: one tone per row, plus the
 *  three button arrangements (single acknowledge, two-button choice,
 *  destructive confirmation). */
const ALERTS: Record<string, () => void> = {
  info: () =>
    appAlert('מה זה מחזור?', 'מחזור הוא ערב משחק אחד. בתוכו יש כמה משחקים.'),
  warning: () =>
    appAlert('הרישום נסגר בעוד שעה', 'אחרי זה אפשר להצטרף רק לרשימת המתנה.', [
      { text: 'הבנתי', style: 'cancel' },
      { text: 'הירשם עכשיו' },
    ]),
  danger: () =>
    appAlert('לבטל את ההרשמה?', 'המקום שלך יעבור לראשון בתור ואי אפשר לבטל.', [
      { text: 'לא, השאר אותי', style: 'cancel' },
      { text: 'בטל הרשמה', style: 'destructive' },
    ]),
  longBody: () =>
    appAlert(
      'תנאי השימוש התעדכנו',
      'עדכנו את תנאי השימוש ומדיניות הפרטיות. השינויים המרכזיים: הבהרנו אילו נתונים נשמרים על משחקים שהשתתפת בהם, כמה זמן הם נשמרים, ומי במועדון יכול לראות אותם. בנוסף, הוספנו הסבר על הדירוג הפנימי — מי מזין אותו ומי רואה אותו. אפשר לעיין בגרסה המלאה בכל רגע מתוך ההגדרות.',
      [{ text: 'קראתי ואני מאשר' }],
    ),
};

export function QARouteLauncher(): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [motionPreview, setMotionPreview] = useState(false);
  const [entryPreview, setEntryPreview] = useState(false);
  const [statsWelcomePreview, setStatsWelcomePreview] = useState(false);
  const [authKind, setAuthKind] = useState<AuthPromptReason | null>(null);
  // Which route is actually on screen, printed so a `uiautomator dump` can
  // read it. Comparing rendered TEXT between two screens was the alternative
  // and it is a guess: two different screens can share a header, and a route
  // that silently failed to navigate looks identical to one that never moved.
  // Asking the navigator is the only answer that cannot be wrong.
  const [here, setHere] = useState('');

  useEffect(() => {
    if (!QA_ROUTES_ENABLED) return;
    const handle = (url: string | null) => {
      const target = routeFromUrl(url);
      if (!target) return;
      setOpen(false);
      if (target === '_entry_invite' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') { setEntryPreview(true); return; }
      if (target === '_motion') { setMotionPreview(true); return; }
      if (target === '_stats_welcome' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') { setStatsWelcomePreview(true); return; }
      if (target.startsWith('_auth_')) {
        setAuthKind(target.slice(6) as AuthPromptReason);
        return;
      }
      if (target.startsWith('_alert_')) {
        ALERTS[target.slice(7)]?.();
        return;
      }
      // Let the container finish mounting on a cold start.
      setTimeout(() => navigateTo(target), 400);
    };
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    void Linking.getInitialURL().then(handle).catch(() => {});
    const tick = setInterval(() => {
      try {
        const r = navigationRef.isReady()
          ? navigationRef.getCurrentRoute()?.name
          : undefined;
        setHere(r ?? '');
      } catch {
        /* dev tool */
      }
    }, 700);
    return () => {
      sub.remove();
      clearInterval(tick);
    };
  }, []);

  if (!QA_ROUTES_ENABLED) return null;

  const go = (route: string) => {
    if (!route) return;
    setOpen(false);
    setTimeout(() => navigateTo(route), 120);
  };

  return (
    <>
      {statsWelcomePreview ? <Modal visible onRequestClose={() => setStatsWelcomePreview(false)}>
        <ScrollView style={{ backgroundColor: '#F4F7FB' }} contentContainerStyle={{ padding: 16, paddingTop: 48 }}>
          <CommunityStatsWelcome onCreate={() => setStatsWelcomePreview(false)} />
        </ScrollView>
      </Modal> : null}
      {entryPreview ? <Modal visible onRequestClose={() => setEntryPreview(false)}><EntryInvitePreview /></Modal> : null}
      {motionPreview ? <MotionPreview onClose={() => setMotionPreview(false)} /> : null}
      {/* Keep the statistics proof unobstructed; deep links remain available. */}
      {here !== 'Statistics' ? <Pressable style={s.fab} onPress={() => setOpen(true)} testID="qa-fab">
        <Text style={s.fabTxt}>QA</Text>
      </Pressable> : null}
      {/* `pointerEvents: none` — a census must never have its own badge
          swallow a press meant for the screen underneath it. */}
      {here !== 'Statistics' ? <View style={s.badge} pointerEvents="none">
        <Text style={s.badgeTxt} testID="qa-here">{`@${here}`}</Text>
      </View> : null}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={s.sheet}>
          <View style={s.head}>
            <Text style={s.title}>QA route launcher</Text>
            <Pressable onPress={() => setOpen(false)} testID="qa-close">
              <Text style={s.close}>close</Text>
            </Pressable>
          </View>
          <ScrollView>
            {ROUTES.map(([label, route, tab], i) =>
              route ? (
                <Pressable
                  key={`${route}-${i}`}
                  style={s.row}
                  testID={`qa-route-${label}`}
                  onPress={() => go(route)}
                >
                  <Text style={s.rowTxt}>{label}</Text>
                  <Text style={s.rowSub}>{tab || 'no owning tab'}</Text>
                </Pressable>
              ) : (
                <Text key={`h-${i}`} style={s.group}>
                  {label}
                </Text>
              ),
            )}
            <Text style={s.group}>— AUTH WALL —</Text>
            {AUTH_KINDS.map((k) => (
              <Pressable
                key={k}
                style={s.row}
                testID={`qa-auth-${k}`}
                onPress={() => {
                  setOpen(false);
                  setTimeout(() => setAuthKind(k), 120);
                }}
              >
                <Text style={s.rowTxt}>{k}</Text>
                <Text style={s.rowSub}>ContextualAuthSheet</Text>
              </Pressable>
            ))}

            <Text style={s.group}>— ALERTS —</Text>
            {Object.keys(ALERTS).map((k) => (
              <Pressable
                key={k}
                style={s.row}
                testID={`qa-alert-${k}`}
                onPress={() => {
                  setOpen(false);
                  setTimeout(() => ALERTS[k](), 120);
                }}
              >
                <Text style={s.rowTxt}>{k}</Text>
                <Text style={s.rowSub}>appAlert</Text>
              </Pressable>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* The real sheet, with both callbacks wired to nothing but a close —
          the census needs to SEE the wall, never to pass through it. */}
      {authKind ? (
        <ContextualAuthSheet
          visible
          kind={authKind}
          hasDraft={
            authKind === 'create_club' ||
            authKind === 'create_game' ||
            authKind === 'save_availability'
          }
          onCancel={() => setAuthKind(null)}
          onAuthenticated={() => setAuthKind(null)}
        />
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  fab: {
    position: 'absolute',
    left: 10,
    bottom: 120,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 12,
  },
  fabTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  badge: {
    position: 'absolute',
    left: 0,
    top: 0,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(17,24,39,0.82)',
    borderBottomRightRadius: 6,
    zIndex: 9999,
    elevation: 12,
  },
  badgeTxt: { color: '#F9FAFB', fontSize: 9, fontWeight: '700' },
  sheet: { flex: 1, backgroundColor: '#fff', paddingTop: 48 },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: { fontSize: 16, fontWeight: '800', color: '#111827' },
  close: { fontSize: 14, color: '#2563EB', fontWeight: '700' },
  group: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    fontSize: 11,
    fontWeight: '800',
    color: '#6B7280',
  },
  row: { paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  rowTxt: { fontSize: 14, fontWeight: '700', color: '#111827' },
  rowSub: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
});

/** Read-only rendering of the real first-entry component, mock data only. */
function EntryInvitePreview() {
  useEffect(() => {
    const invite = useEntryStore.getState().invite;
    useEntryStore.setState({ invite: { kind: 'referral', invitedBy: 'p1' } });
    return () => useEntryStore.setState({ invite });
  }, []);
  return <View style={{ flex: 1 }} pointerEvents="none"><IntentScreen /></View>;
}
