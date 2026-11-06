import { shouldHideSupportBubble } from '@/utils/supportBubbleVisibility';

test.each([
  'GameCreate',
  'GameEdit',
  'CommunitiesCreate',
  'CommunityEdit',
  'ProfileEdit',
  'ProfileSetup',
  'AvailabilityEdit',
  'Feedback',
  'EmailAuth',
  'DraftSetup',
  'DraftBoard',
  'LiveMatch',
  'CommunityDetails',
  'CommunityDetailsPublic',
  'ManagerDashboard',
  'CommunityPlayers',
  'CommunityStats',
  'CommunityHistory',
  'AddMembers',
  'AvailablePlayers',
  'MatchDetails',
  'MatchPlayers',
  'MatchRounds',
  'PlayerCard',
  'PlayerCompare',
  'PlayerTimeline',
  'Statistics',
  'History',
  'Friends',
  'Requests',
  'AdminApproval',
  'BlockedUsers',
  'NotificationsSettings',
  'SocialPrivacy',
  'Referrals',
  'Achievements',
  'SeasonTitles',
  'SeasonSummary',
  'MyActivity',
  'AvailabilityWeek',
  'EveningSummary',
  'PersonalInvite',
  'PromoteOrphan',
  'GamesMap',
  'CommunitiesMap',
  'GameChat',
  'CommunityChat',
  'DirectChat',
  'SignIn',
  'EntryIntent',
])('the floating support bubble stays clear of the secondary work surface %s', route => {
  expect(shouldHideSupportBubble(route)).toBe(true);
});

test.each([
  'Profile',
  'GuestHome',
  'GamesList',
  'CommunitiesFeed',
  'ChatsList',
])('the floating support entry remains available on the tab root %s', route => {
  expect(shouldHideSupportBubble(route)).toBe(false);
});

test.each([undefined, null, '', 'FutureScreen'])('an absent or unknown route %s hides the bubble until the route settles', route => {
  expect(shouldHideSupportBubble(route)).toBe(true);
});

test('route changes do not leave the bubble hidden on the next home or list screen', () => {
  expect(['GameCreate', 'Profile', 'DraftBoard', 'GamesList', ''].map(shouldHideSupportBubble)).toEqual([true, false, true, false, true]);
});
