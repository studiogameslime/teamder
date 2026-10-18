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

import { mockGame, mockGamesV2, mockRoundHistory } from '@/data/mockData';
import { ProfileSetupScreen } from '@/screens/auth/ProfileSetupScreen';
import { IntentScreen } from '@/screens/entry/IntentScreen';
import { useEntryStore } from '@/store/entryStore';
import { SeasonsSettings } from '@/components/community/SeasonsSettings';
import { he } from '@/i18n/he';
import { UpcomingRoundCard } from '@/components/home/HomeRoundCards';
import { MatchListCard } from '@/components/match/MatchListCard';
import { MatchStadiumHero } from '@/components/match/MatchStadiumHero';
import { deriveRoundState } from '@/utils/homeRoundState';
import { GuestModal } from '@/components/GuestModal';
import { AdminRatingSheet } from '@/components/AdminRatingSheet';
import { MotionPreview } from './MotionPreview';
import { OverlayAuditPreview } from './OverlayAuditPreview';
import { CommunityStatsWelcome } from '@/components/community/CommunityStatsWelcome';
import { appAlert } from '@/components/AppDialog';
import { toast } from '@/components/Toast';
import { banner } from '@/components/Banner';
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
  ['GameCreateQuick', 'GameCreate', 'ProfileTab', { quick: true }],
  ['DraftSetup', 'DraftSetup', 'ProfileTab', { gameId: 'gv2-live' }],
  ['ManualAllocationThree', 'DraftSetup', 'ProfileTab', { gameId: 'gv2-live', manualPreview:3 }],
  ['ManualAllocationFour', 'DraftSetup', 'ProfileTab', { gameId: 'gv2-live', manualPreview:4 }],
  ['DraftBoard', 'DraftBoard', 'ProfileTab', { gameId: 'gv2-live', captainIds: ['p1', 'p7'], method: 'snake', readOnly: false }],
  ['SavedDraftBoard', 'DraftBoard', 'ProfileTab', { gameId: 'gv2-live', captainIds: ['p1', 'p6'], method: 'snake', resume: true }],
  ['RoundAddMembers', 'AddMembers', 'ProfileTab', { gameId: 'gv2-live' }],
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
  ['AvailablePlayers', 'AvailablePlayers', 'ProfileTab', { gameId: 'gv2-live' }],
  ['AvailablePlayersPreview', 'AvailablePlayers', 'ProfileTab', { gameId: 'gv2-live', previewCandidates: true }],
  ['PromoteOrphan', 'PromoteOrphan', 'GameTab', { groupId: 'g1', gameId: 'gv2-live' }],
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
  ['ProfileStatisticsFull', 'Profile', 'ProfileTab', { qaHomeStats: 'full' }],
  ['ProfileStatisticsEmpty', 'Profile', 'ProfileTab', { qaHomeStats: 'empty' }],
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
  const m = /^[a-z.]+:\/\/qa\/([A-Za-z_0-9]+)/i.exec(url.trim());
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
  const [profileSetupPreview, setProfileSetupPreview] = useState(false);
  const [seasonsPreview, setSeasonsPreview] = useState(false);
  const [scheduledPreview, setScheduledPreview] = useState(false);
  const [registeredPreview, setRegisteredPreview] = useState(false);
  const [roundCoverPreview, setRoundCoverPreview] = useState(false);
  const [roundJoinCardPreview, setRoundJoinCardPreview] = useState(false);
  const [roundCoverLibraryPreview, setRoundCoverLibraryPreview] = useState(false);
  const [guestRatingPreview, setGuestRatingPreview] = useState(false);
  const [adminRatingPreview, setAdminRatingPreview] = useState(false);
  const [overlayAudit, setOverlayAudit] = useState<string | null>(null);
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
      if (target === '_live_mode_no_teams' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const {mockGamesV2}=require('@/data/mockData') as typeof import('@/data/mockData');
        const source=mockGamesV2.find(g=>g.id==='gv2-live');
        if(!source)return;
        const id='qa-live-mode-no-teams';
        const fixture={...source,id,title:'בדיקת לייב — ללא כוחות',status:'active' as const,startsAt:Date.now()-5*3600000,
          advancedMode:true,draftTeams:undefined,rotation:undefined,updatedAt:Date.now()};
        const index=mockGamesV2.findIndex(g=>g.id===id);
        if(index<0)mockGamesV2.push(fixture);else mockGamesV2[index]=fixture;
        (navigationRef as unknown as {navigate:(r:string,p:object)=>void}).navigate('ProfileTab',{screen:'MatchDetails',initial:false,params:{gameId:id}});
        return;
      }
      if (target === '_live_mode_read_failure' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const {gameService}=require('@/services/gameService') as typeof import('@/services/gameService');
        const original=gameService.getGameById;
        gameService.getGameById=async()=>{gameService.getGameById=original;throw new Error('QA_LIVE_MODE_LOAD_FAILURE');};
        (navigationRef as unknown as {navigate:(r:string,p:object)=>void}).navigate('ProfileTab',{screen:'LiveMatch',initial:false,params:{gameId:'gv2-live'}});
        return;
      }
      if (target === 'ProfileSetup' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') { setProfileSetupPreview(true); return; }
      if (target === '_entry_invite' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') { setEntryPreview(true); return; }
      if (target === '_friends_load_failure' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const { friendsService } = require('@/services/friendsService') as typeof import('@/services/friendsService');
        const original = friendsService.listFriends;
        friendsService.listFriends = async () => {
          friendsService.listFriends = original;
          throw new Error('QA_FRIENDS_LOAD_FAILURE');
        };
        (navigationRef as unknown as {navigate:(r:string,p?:object)=>void}).navigate('ChatTab',{screen:'Friends',initial:false});
        return;
      }
      if (['_invitation_cards', '_invitation_cards_full'].includes(target) && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const {useUserStore}=require('@/store/userStore') as typeof import('@/store/userStore');
        const {useGroupStore}=require('@/store/groupStore') as typeof import('@/store/groupStore');
        const {groupService}=require('@/services/groupService') as typeof import('@/services/groupService');
        const {notificationsService}=require('@/services/notificationsService') as typeof import('@/services/notificationsService');
        const {mockGamesV2,mockPlayers}=require('@/data/mockData') as typeof import('@/data/mockData');
        const {mockPublicGroups}=require('@/data/mockUsers') as typeof import('@/data/mockUsers');
        const me=useUserStore.getState().currentUser;
        if (!me || me.isGuest) return;
        void (async()=>{
          const club=await groupService.get('g2');
          if (!club) return;
          const inviter=mockPlayers[0];
          Object.assign(club,{name:'חמישי כדורגל',isOpen:false,adminIds:[inviter.id],playerIds:club.playerIds.filter(id=>id!==me.id),coverImageId:'c12'});
          const pub=mockPublicGroups.find(g=>g.id===club.id);
          if(pub)Object.assign(pub,{name:club.name,isOpen:false,city:'תל אביב',coverImageId:'c12'});
          useGroupStore.setState(s=>({groups:s.groups.filter(g=>g.id!==club.id)}));
          const id='qa-invitation-round',startsAt=Date.now()+7*86400000;
          const template=mockGamesV2.find(g=>g.id==='gv2-3')!;
          const game={...template,id,title:'הכדורגל של יום רביעי',groupId:'g1',startsAt,city:'אור יהודה',format:'5v5' as const,fieldType:'synthetic' as const,maxPlayers:10,players:target.endsWith('_full')?mockPlayers.filter(p=>p.id!==me.id).slice(0,10).map(p=>p.id):[],waitlist:[],pending:[],participantIds:[],guests:[],pendingPromotion:undefined,approvedInvites:{[me.id]:{inviterId:template.createdBy ?? inviter.id,expiresAt:Date.now()+86400000}}};
          const old=mockGamesV2.findIndex(g=>g.id===id);if(old>=0)mockGamesV2.splice(old,1);mockGamesV2.push(game);
          await notificationsService.dispatch({type:'inviteToGame',recipientId:me.id,payload:{gameId:id,gameTitle:game.title,inviterId:inviter.id,inviterName:inviter.displayName,managerApproved:true,startsAt,expiresAt:Date.now()+86400000}});
          await notificationsService.dispatch({type:'groupInvitation',recipientId:me.id,payload:{groupId:club.id,groupName:club.name,inviterId:inviter.id,inviterName:inviter.displayName,managerApproved:true,expiresAt:Date.now()+86400000}});
          (navigationRef as unknown as {navigate:(r:string,p?:object)=>void}).navigate('ChatTab',{screen:'Friends',initial:false});
        })();
        return;
      }
      if (target === '_club_invitation' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const {useUserStore}=require('@/store/userStore') as typeof import('@/store/userStore');
        const {notificationsService}=require('@/services/notificationsService') as typeof import('@/services/notificationsService');
        const me=useUserStore.getState().currentUser;
        if (!me || me.isGuest) return;
        void notificationsService.dispatch({type:'groupInvitation',recipientId:me.id,payload:{groupId:'g2',groupName:'מועדון לדוגמה',inviterName:'מנהל לדוגמה',managerApproved:true,expiresAt:Date.now()+86400000}}).then(()=>{
          // Deliberately omit fromInvitation: equivalent to entering from the feed.
          (navigationRef as unknown as {navigate:(r:string,p?:object)=>void}).navigate('CommunitiesTab',{screen:'CommunityDetailsPublic',initial:false,params:{groupId:'g2'}});
        });
        return;
      }
      if (target === '_round_join_loading' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const {gameService}=require('@/services/gameService') as typeof import('@/services/gameService');
        const originalGet=gameService.getGameById;
        gameService.getGameById=async id=>{
          if (id!=='qa-local-join-loading') return originalGet.call(gameService,id);
          const demo=await originalGet.call(gameService,'gv2-3');
          return demo ? {...demo,id,groupId:'g1',acceptsFillers:false,requiresApproval:false} : null;
        };
        const original=gameService.requestJoinGame;
        gameService.requestJoinGame=async (...args:Parameters<typeof original>)=>{
          gameService.requestJoinGame=original;
          await new Promise(resolve=>setTimeout(resolve,7000));
          if (args[0]==='qa-local-join-loading') return {bucket:'players'} as Awaited<ReturnType<typeof original>>;
          return original.apply(gameService,args);
        };
        (navigationRef as unknown as {navigate:(r:string,p?:object)=>void}).navigate('GameTab',{screen:'MatchDetails',initial:false,params:{gameId:'qa-local-join-loading'}});
        return;
      }
      if (target === '_round_join_card_loading' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        setRoundJoinCardPreview(true); return;
      }
      if (target === '_received_invites_filtered' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const {useUserStore}=require('@/store/userStore') as typeof import('@/store/userStore');
        const {receivedInvitationsService}=require('@/services/receivedInvitationsService') as typeof import('@/services/receivedInvitationsService');
        const {receivedInvitations}=require('@/utils/receivedInvitations') as typeof import('@/utils/receivedInvitations');
        const me=useUserStore.getState().currentUser;
        if (!me || me.isGuest) return;
        const original=receivedInvitationsService.list;
        receivedInvitationsService.list=async uid=>{
          receivedInvitationsService.list=original;
          return receivedInvitations([
            {id:'qa-open-club',data:{type:'groupInvitation',recipientId:uid,payload:{groupId:'g2',groupName:'מועדון לדוגמה',inviterName:'מנהל לדוגמה'},createdAt:Date.now()}},
            {id:'qa-accepted-round',data:{type:'inviteToGame',recipientId:uid,payload:{gameId:'qa-accepted',gameTitle:'מחזור שכבר הצטרפתי אליו'},invitationStatus:'joined',createdAt:Date.now()}},
          ],uid);
        };
        (navigationRef as unknown as {navigate:(r:string,p?:object)=>void}).navigate('ChatTab',{screen:'Friends',initial:false});
        return;
      }
      if (target === '_received_invites' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const {useUserStore}=require('@/store/userStore') as typeof import('@/store/userStore');
        const {notificationsService}=require('@/services/notificationsService') as typeof import('@/services/notificationsService');
        const me=useUserStore.getState().currentUser;
        if(!me||me.isGuest)return;
        void (async()=>{
          await notificationsService.dispatch({type:'groupInvitation',recipientId:me.id,payload:{groupId:'g1',groupName:'כדורגל אנשים טובים',inviterName:'איתי לוי',invitationOnly:true}});
          await notificationsService.dispatch({type:'inviteToGame',recipientId:me.id,payload:{gameId:'game-1',gameTitle:'חמישי כדורגל',inviterName:'דניאל כהן',startsAt:Date.now()+86400000}});
          const demoInvites=notificationsService.__getMockDispatches().filter(n=>n.recipientId===me.id&&n.type==='inviteToGame');
          demoInvites.forEach(n=>Object.assign(n,{invitationStatus:'scheduled'}));
          (navigationRef as unknown as {navigate:(r:string,p?:object)=>void}).navigate('ChatTab',{screen:'Friends',initial:false});
        })();
        return;
      }
      if (target === '_pulse_discovery' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        (navigationRef as unknown as {navigate:(r:string,p?:object)=>void}).navigate('ChatTab',{screen:'ChatsList',initial:false,params:{qaSocialPreview:false,qaChatPreview:false}});return;
      }
      if (target === '_pulse_invite_loading' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const {socialPlayersService}=require('@/services/socialPlayersService') as typeof import('@/services/socialPlayersService');
        const original=socialPlayersService.inviteToClub;
        const {notificationsService}=require('@/services/notificationsService') as typeof import('@/services/notificationsService');
        const originalGameInvite=notificationsService.inviteToGame;
        notificationsService.inviteToGame=async()=>{notificationsService.inviteToGame=originalGameInvite;await new Promise(r=>setTimeout(r,8000));return {invited:true};};
        const originalProfile=socialPlayersService.profile;
        socialPlayersService.profile=async id=>{socialPlayersService.profile=originalProfile;const p=await originalProfile(id);return {...p,clubs:p.clubs.filter(c=>c.id!=='g1')};};
        socialPlayersService.inviteToClub=async()=>{socialPlayersService.inviteToClub=original;await new Promise(r=>setTimeout(r,8000));return {invited:true};};
        (navigationRef as unknown as {navigate:(r:string,p?:object)=>void}).navigate('ChatTab',{screen:'PlayerCard',initial:false,params:{userId:'qa-noam'}});
        return;
      }
      if (target === '_support_timeline' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const {useUserStore}=require('@/store/userStore') as typeof import('@/store/userStore');
        const {useSupportChat}=require('@/services/supportChat') as typeof import('@/services/supportChat');
        const {chatService}=require('@/services/chatService') as typeof import('@/services/chatService');
        const {captureFullScreenBase64}=require('@/native/screenCapture') as typeof import('@/native/screenCapture');
        const uid=useUserStore.getState().currentUser?.id;
        if(uid) void captureFullScreenBase64({quality:0.35,maxWidth:540}).then(image=>{
          if(!image)return;
          const original=chatService.subscribeMessages;
          chatService.subscribeMessages=(scope,parentId,receive,onError)=>{
            chatService.subscribeMessages=original;
            const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);yesterday.setHours(20,27,0,0);
            receive([{id:'qa-team',senderId:'teamder',senderName:'Teamder',text:'היי, הסתדרת עם המועדון?',createdAt:yesterday.getTime()},
              {id:'qa-reply',senderId:uid,senderName:'בדיקה',text:'עובד!',createdAt:yesterday.getTime()+60000},
              {id:'qa-photo',senderId:uid,senderName:'בדיקה',text:'דוגמה',supportImage:image,createdAt:Date.now()}]);
            return ()=>{};
          };
          useSupportChat.getState().open(uid);
        });
        return;
      }
      if (target === '_support_open' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const {useUserStore}=require('@/store/userStore') as typeof import('@/store/userStore');
        const {useSupportChat}=require('@/services/supportChat') as typeof import('@/services/supportChat');
        const uid=useUserStore.getState().currentUser?.id;
        if(uid)useSupportChat.getState().open(uid);
        return;
      }
      if (target === '_support_draft' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const {useUserStore}=require('@/store/userStore') as typeof import('@/store/userStore');
        const {useSupportChat}=require('@/services/supportChat') as typeof import('@/services/supportChat');
        const uid=useUserStore.getState().currentUser?.id;
        if(uid){const {captureSupportContext}=require('@/services/supportChat') as typeof import('@/services/supportChat');if(!useSupportChat.getState().drafts[uid])useSupportChat.getState().open(uid);useSupportChat.getState().patch(uid,{text:'היי, אני מנסה ליצור מועדון ולא בטוח איך ממשיכים.\nצירפתי צילום של המסך.',context:captureSupportContext(),attemptId:undefined});}
        return;
      }
      if (target === '_chat_sender' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const {useChatStore}=require('@/store/chatStore') as typeof import('@/store/chatStore');
        const {useGroupStore}=require('@/store/groupStore') as typeof import('@/store/groupStore');
        const {mockPlayers}=require('@/data/mockData') as typeof import('@/data/mockData');
        const group=useGroupStore.getState().groups.find(g=>!g.isPersonal&&!g.hidden);
        if(!group)return;
        const sender=mockPlayers[0];
        useChatStore.getState().setEntries([{id:`community__${group.id}`,scope:'community',parentId:group.id,title:group.name,count:1,lastMessageAt:Date.now(),lastText:'להביא מצב רוח',lastSenderId:sender.id,lastSenderName:'שחקן'}]);
        (navigationRef as unknown as {navigate:(r:string,p?:object)=>void}).navigate('ChatTab',{screen:'ChatsList',initial:false,params:{qaChatPreview:false}});
        return;
      }
      if (target === '_chat_inbox' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const nav=navigationRef as unknown as {navigate:(r:string,p?:object)=>void};
        nav.navigate('ChatTab',{screen:'ChatsList',initial:false,params:{qaChatPreview:true}});return;
      }
      if (['_chat_closing','_chat_closed'].includes(target) && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const nav=navigationRef as unknown as {navigate:(r:string,p?:object)=>void};
        nav.navigate('ChatTab',{screen:'GameChat',initial:false,params:{gameId:'gv2-live',qaChatState:target}});return;
      }
      if (['_social_search','_social_friend','_social_stranger','_social_privacy'].includes(target) && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const nav=navigationRef as unknown as {navigate:(r:string,p?:object)=>void};
        const screen=target==='_social_search'?'ChatsList':target==='_social_privacy'?'SocialPrivacy':'PlayerCard';
        const params=screen==='ChatsList'?{qaSocialPreview:true}:screen==='PlayerCard'?{userId:'qa-itay',qaSocialPreview:target==='_social_friend'?'friend':'stranger'}:undefined;
        if(focusedTab()==='ChatTab')nav.navigate(screen,params);else nav.navigate('ChatTab',{screen,initial:false,params});
        return;
      }
      if (target.startsWith('_notice_')) {
        const kind = target.slice(8);
        if (kind === 'success') toast.success('נרשמת למחזור!\nנתראה על המגרש', 15000);
        else if (kind === 'error') toast.error('השינויים לא נשמרו\nאפשר לנסות שוב בעוד רגע', 15000);
        else if (kind === 'banner') banner.show('הכוחות מוכנים! אפשר לצאת למגרש.', { duration: 15000 });
        else toast.info('ההרשמה עדיין לא נפתחה\nיום שלישי · 13.10 · 10:00', 15000);
        return;
      }
      if (target === '_round_cover' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') { setRoundCoverPreview(true); return; }
      if (target === '_round_cover_library' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') { setRoundCoverLibraryPreview(true); return; }
      if (target === '_guest_rating_decimal' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') { setGuestRatingPreview(true); return; }
      if (target === '_admin_rating_decimal' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') { setAdminRatingPreview(true); return; }
      if (['_forces_audit_recovery','_forces_audit_recovery_legacy','_forces_audit_live'].includes(target) && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        // In-memory only: reproduce a banked result whose next lineup was interrupted.
        const game=mockGamesV2.find(g=>g.id==='gv2-live3');
        if(!game?.draftTeams || !game.rotation || !game.liveMatch)return;
        const ids=mockGame.players.concat(mockGamesV2.find(g=>g.id==='gv2-live4')?.players??[]).filter((id,i,all)=>all.indexOf(id)===i).slice(0,13);
        game.players=ids;game.numberOfTeams=3;game.format='5v5';
        game.draftTeams={...game.draftTeams,completionMode:target==='_forces_audit_recovery_legacy'?undefined:'balanced',fillMode:'temporary',teams:[ids.slice(0,4),ids.slice(4,9),ids.slice(9,13)].map((playerIds,index)=>({index,captainId:playerIds[0],playerIds}))};
        game.rotation={...game.rotation,playing:[0,1],waiting:[2],round:1,roundInstanceId:'qa-recovery-1',roundInstanceRound:1,loans:[{playerId:ids[9],homeTeam:2,filledTeam:0}]};
        game.lastCommittedRoundId=target==='_forces_audit_live'?undefined:'qa-recovery-1';
        const goals=[0,1].map(index=>({id:'qa-goal-'+index,scorerId:ids[0],assisterId:ids[1],ownGoal:false,minute:1,team:'A' as const,at:Date.now()+index}));
        game.liveMatch={...game.liveMatch,scoreA:target==='_forces_audit_live'?2:0,scoreB:0,goals:target==='_forces_audit_live'?goals:[],timerRunning:false,timerAccumulatedMs:120000,timerLastStartedAt:null,goalTally:{[ids[0]]:2}};
        game.updatedAt=Date.now();
        mockRoundHistory[game.id]=[{roundId:'qa-recovery-1',teamA:[...ids.slice(0,4),ids[9]],teamB:ids.slice(4,9),teamAIndex:0,teamBIndex:1,scoreA:2,scoreB:1,winnerSide:'A',goals,at:Date.now()}];
        if(target==='_forces_audit_live')mockRoundHistory[game.id]=[];
        (navigationRef as unknown as {navigate:(route:string,params:object)=>void}).navigate('ProfileTab',{screen:'LiveMatch',initial:false,params:{gameId:game.id}});
        return;
      }
      if (target.startsWith('_overlay_audit_') && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') { setOverlayAudit(target.slice('_overlay_audit_'.length)); return; }
      if (target.startsWith('_live_design_') && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') {
        const { useUserStore } = require('@/store/userStore') as typeof import('@/store/userStore');
        const { liveGameFixture } = require('./liveGameFixture') as typeof import('./liveGameFixture');
        const me = useUserStore.getState().currentUser;
        if (!me) return;
        const preview = liveGameFixture(target.slice('_live_design_'.length), me.id);
        (navigationRef as unknown as {navigate:(route:string,params:object)=>void}).navigate('ProfileTab',{screen:'LiveMatch',initial:false,params:{gameId:preview.id}});
        return;
      }
      if (target === '_home_registered' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') { setRegisteredPreview(true); return; }
      if (target === '_home_scheduled' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') { setScheduledPreview(true); return; }
      if (target === '_seasons_live' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') { setSeasonsPreview(true); return; }
      if (target === '_seasons_short' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1') { setSeasonsPreview(false); appAlert('כיבוי עונות', he.seasonsDisableBodyOf(2, 1), [{ text: 'הבנתי' }]); return; }
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
        {roundJoinCardPreview && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1' ? <Modal visible onRequestClose={()=>setRoundJoinCardPreview(false)}>
          <View style={{flex:1,backgroundColor:'#F4F7FC',padding:16,paddingTop:60}}>
            <MatchListCard game={{...mockGame,id:'qa-card-loading',players:[],waitlist:[],pending:[],startsAt:Date.now()+86400000}} userId="qa-viewer" cover={null} busy onPrimary={()=>{}} />
          </View>
        </Modal> : null}
      {process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1' ? <>
        {overlayAudit ? <OverlayAuditPreview key={overlayAudit} kind={overlayAudit} onClose={() => setOverlayAudit(null)} /> : null}
        <GuestModal visible={guestRatingPreview} gameId="qa-local-guest-rating" callerId="qa-owner" isAdmin
          existing={{ id: 'qa-guest', name: 'אורח לדוגמה', addedBy: 'qa-owner', createdAt: 1, estimatedRating: 4.5 }}
          onClose={() => setGuestRatingPreview(false)} />
        <AdminRatingSheet target={adminRatingPreview ? { id: 'qa-player', name: 'שחקן לדוגמה' } : null} current={4.5}
          saving={false} onClose={() => setAdminRatingPreview(false)} onSave={() => setAdminRatingPreview(false)} />
      </> : null}
      {roundCoverLibraryPreview && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1' ? <Modal visible onRequestClose={() => setRoundCoverLibraryPreview(false)}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 32, backgroundColor: '#F4F7FC' }}>
          <Text style={{ textAlign: 'right', color: '#334155', marginBottom: 16 }}>מאגר התמונות — דמו מנותק, פעולות מנוטרלות</Text>
          {(['grass', 'synthetic', 'asphalt'] as const).flatMap(fieldType => (['day', 'night'] as const).map(period => {
            const game = { ...mockGamesV2[0], id: 'qa-cover-comparison', groupId: 'g1', title: `${{ grass: 'דשא', synthetic: 'סינטטי', asphalt: 'אספלט' }[fieldType]} · ${period === 'day' ? 'יום' : 'לילה'}`, status: 'open' as const, players: [], waitlist: [], pending: [], liveMatch: undefined, fieldType, startsAt: Date.parse(period === 'day' ? '2026-07-15T12:00:00+03:00' : '2026-07-15T21:00:00+03:00') };
            return <View key={`${fieldType}-${period}`} pointerEvents="none" style={{ marginBottom: 20 }}>
              <MatchListCard game={game} userId="qa-viewer" cover={null} onPrimary={() => {}} />
            </View>;
          }))}
        </ScrollView>
      </Modal> : null}
      {roundCoverPreview && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1' ? <Modal visible onRequestClose={() => setRoundCoverPreview(false)}>
        <ScrollView contentContainerStyle={{ paddingTop: 24, backgroundColor: '#F4F7FC', flexGrow: 1 }}>
          <Text style={{ textAlign: 'center', color: '#334155', marginBottom: 16 }}>אותו מחזור בבית, ברשימה ובפרטים — המחשה מנותקת</Text>
          {(() => {
            const game = { ...mockGamesV2[0], id: 'qa-cover-comparison', groupId: 'g1', title: 'רביעי כדורגל בנחלים', status: 'open' as const, players: [], waitlist: [], pending: [], liveMatch: undefined, fieldType: 'synthetic' as const, startsAt: new Date(2026, 9, 14, 20).getTime() };
            return <View pointerEvents="none">
              <Text style={{ textAlign: 'right', padding: 16, fontWeight: '700' }}>מסך הבית והמחזורים</Text>
              <View style={{ paddingHorizontal: 16, marginBottom: 16 }}><UpcomingRoundCard game={game} cover={{ coverImageId: 'c12' }} clubName={game.title} state={deriveRoundState(game, 'qa-viewer', Date.now())} now={Date.now()} actions={{ onDetails: () => {}, onJoin: () => {}, onSummary: () => {}, onCreate: () => {}, onFind: () => {} }} /></View>
              <View style={{ paddingHorizontal: 16 }}><MatchListCard game={game} userId="qa-viewer" cover={{ coverImageId: 'c12' }} onPrimary={() => {}} /></View>
              <Text style={{ textAlign: 'right', padding: 16, fontWeight: '700', marginTop: 16 }}>פרטי המחזור</Text>
              <MatchStadiumHero roundId={game.id} fieldType={game.fieldType} groupId={game.groupId} title={game.title} startsAt={game.startsAt} coverImageId="c12" onBackPress={() => {}} countdownHidden compact />
            </View>;
          })()}
        </ScrollView>
      </Modal> : null}
      {scheduledPreview && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1' ? <Modal visible onRequestClose={() => setScheduledPreview(false)}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 48, backgroundColor: '#F4F7FC', flexGrow: 1 }}>
          <Text style={{ textAlign: 'center', color: '#334155', marginBottom: 20 }}>תצוגת המחשה בלבד — הפעולות מנוטרלות</Text>
          {(() => {
            const now = Date.now();
            const game = { ...mockGamesV2[0], id: 'qa-scheduled-colour', title: 'כדורגל אנשים טובים', status: 'scheduled' as const, players: [], waitlist: [], pending: [], liveMatch: undefined, startsAt: now + 3 * 86400000, registrationOpensAt: now + 46 * 3600000, fieldName: 'מגרש קהילתי', city: 'אור יהודה' };
            return <View pointerEvents="none"><UpcomingRoundCard game={game} clubName={game.title} state={deriveRoundState(game, 'qa-viewer', now)} now={now} actions={{ onDetails: () => {}, onJoin: () => {}, onSummary: () => {}, onCreate: () => {}, onFind: () => {} }} /></View>;
          })()}
        </ScrollView>
      </Modal> : null}
      {registeredPreview && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1' ? <Modal visible onRequestClose={() => setRegisteredPreview(false)}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 48, backgroundColor: '#F4F7FC', flexGrow: 1 }}>
          <Text style={{ textAlign: 'center', color: '#334155', marginBottom: 20 }}>תצוגת המחשה בלבד — הפעולות מנוטרלות</Text>
          {(() => {
            const now = Date.now();
            const game = { ...mockGamesV2[0], id: 'qa-registered-colour', title: 'כדורגל אנשים טובים', status: 'open' as const, players: ['qa-viewer', ...Array.from({length:9},(_,i)=>`qa-player-${i}`)], waitlist: [], pending: [], liveMatch: undefined, startsAt: now + 15 * 60000, registrationOpensAt: undefined, maxPlayers: 10, fieldName: 'מגרש קהילתי', city: 'אור יהודה' };
            return <View pointerEvents="none"><UpcomingRoundCard game={game} clubName={game.title} state={deriveRoundState(game, 'qa-viewer', now)} now={now} actions={{ onDetails: () => {}, onJoin: () => {}, onSummary: () => {}, onCreate: () => {}, onFind: () => {} }} /></View>;
          })()}
        </ScrollView>
      </Modal> : null}
      {seasonsPreview && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1' ? <Modal visible onRequestClose={() => setSeasonsPreview(false)}>
        <ScrollView style={{ flex: 1, backgroundColor: '#f5f7fc' }} contentContainerStyle={{ padding: 20, paddingTop: 50 }}>
          <Text style={{ textAlign: 'center', color: '#2645b5', marginBottom: 15 }}>תצוגת בדיקה מנותקת — נתוני המחשה בלבד</Text>
          <View pointerEvents="none"><SeasonsSettings groupId="qa-preview-only" seasons={{ enabled: true, currentId: 's2', currentNo: 2, count: 1, startedAt: 1790000000000, playedRounds: 7, roundsAtStart: 20, cadence: { type: 'rounds', targetRounds: 24 } }} /></View>
        </ScrollView>
      </Modal> : null}
      {statsWelcomePreview ? <Modal visible onRequestClose={() => setStatsWelcomePreview(false)}>
        <ScrollView style={{ backgroundColor: '#F4F7FB' }} contentContainerStyle={{ padding: 16, paddingTop: 48 }}>
          <CommunityStatsWelcome onCreate={() => setStatsWelcomePreview(false)} />
        </ScrollView>
      </Modal> : null}
      {profileSetupPreview && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1' ? <Modal visible onRequestClose={() => setProfileSetupPreview(false)}><ProfileSetupScreen onClose={() => setProfileSetupPreview(false)} /></Modal> : null}
      {entryPreview ? <Modal visible onRequestClose={() => setEntryPreview(false)}><EntryInvitePreview /></Modal> : null}
      {motionPreview ? <MotionPreview onClose={() => setMotionPreview(false)} /> : null}
      {/* Keep the statistics proof unobstructed; deep links remain available. */}
      {here !== 'Statistics' && here !== 'LiveMatch' && process.env.EXPO_PUBLIC_SCREENSHOT_MODE !== '1' ? <Pressable style={s.fab} onPress={() => setOpen(true)} testID="qa-fab">
        <Text style={s.fabTxt}>QA</Text>
      </Pressable> : null}
      {/* `pointerEvents: none` — a census must never have its own badge
          swallow a press meant for the screen underneath it. */}
      {here !== 'Statistics' && process.env.EXPO_PUBLIC_SCREENSHOT_MODE !== '1' ? <View style={s.badge} pointerEvents="none">
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
