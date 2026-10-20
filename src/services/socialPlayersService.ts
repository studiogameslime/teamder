import { httpsCallable } from 'firebase/functions';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { withAuthRaceRetry } from '@/firebase/authRace';
import { StaleSessionError } from './staleSession';
import type { PlayerSearch, PlayerSearchPage, SocialPrivacy, SocialProfile } from '@/types/social';
import { useUserStore } from '@/store/userStore';
import { playerDiscoveryMatches } from '@/utils/socialPlayers';

async function call<T>(name: string, data: unknown, expectedOwner = useUserStore.getState().currentUser?.id): Promise<T> {
  const { auth, functions } = getFirebase();
  const owner = auth.currentUser?.uid;
  if (!owner || auth.currentUser?.isAnonymous) throw new Error('social: full account required');
  if (!expectedOwner || owner !== expectedOwner) throw new StaleSessionError(expectedOwner ?? '', owner);
  const result = await withAuthRaceRetry(() => {
    if(auth.currentUser?.uid !== owner || useUserStore.getState().currentUser?.id !== expectedOwner) throw new StaleSessionError(owner,auth.currentUser?.uid ?? '');
    return httpsCallable(functions, name)(data);
  });
  if (auth.currentUser?.uid !== owner || useUserStore.getState().currentUser?.id !== expectedOwner) throw new StaleSessionError(owner, auth.currentUser?.uid ?? '');
  return result.data as T;
}
export const socialPlayersService = {
  async checkMessaging(userId: string): Promise<void> { if (!USE_MOCK_DATA) await call('checkSocialMessaging', { userId }); },
  async search(opts: PlayerSearch): Promise<PlayerSearchPage> {
    if (USE_MOCK_DATA) {
      const { socialDemoPlayers } = require('@/dev/socialPlayersFixture') as typeof import('@/dev/socialPlayersFixture');
      const { playerSearchMatches } = require('@/utils/socialPlayers') as typeof import('@/utils/socialPlayers');
      const { friendsService } = require('./friendsService') as typeof import('./friendsService');
      const me = useUserStore.getState().currentUser;
      const friends = new Set(me ? await friendsService.listFriendIds(me.id) : []);
      const pool=socialDemoPlayers.map(p => ({ ...p, friend: friends.has(p.id) })).filter(p => playerDiscoveryMatches(p, opts));
      const after=opts.cursor?pool.findIndex(p=>p.id===opts.cursor)+1:0;
      const players=pool.slice(after,after+20);
      return {players,cursor:after+20<pool.length?players[players.length-1].id:null};
    }
    // Keep compatibility with the deployed single-day/time endpoint.
    // A multi-selection broadens the server page and filters its public
    // availability locally, preserving the server cursor and privacy checks.
    const { days, times, day, time, ...single } = opts;
    const serverDay = days?.length ? (days.length === 1 ? days[0] : undefined) : day;
    const serverTime = times?.length ? (times.length === 1 ? times[0] : undefined) : time;
    const page = await call<PlayerSearchPage>('searchSocialPlayers', {
      ...single,
      ...(serverDay !== undefined ? { day: serverDay } : {}),
      ...(serverTime ? { time: serverTime } : {}),
    });
    if (opts.cursor && page.cursor === opts.cursor) throw new Error('SOCIAL_SEARCH_CURSOR_STALLED');
    return { ...page, players: page.players.filter(player => playerDiscoveryMatches(player, opts)) };
  },
  async profile(userId: string): Promise<SocialProfile> {
    if (USE_MOCK_DATA) {
      const { socialDemoProfile } = require('@/dev/socialPlayersFixture') as typeof import('@/dev/socialPlayersFixture');
      const { friendsService } = require('./friendsService') as typeof import('./friendsService');
      const me=useUserStore.getState().currentUser;
      return socialDemoProfile(userId, !!me && await friendsService.getRelationship(me.id,userId)==='friends');
    }
    return call('getSocialPlayerProfile', { userId });
  },
  async savePrivacy(privacy: SocialPrivacy, expectedOwner: string): Promise<void> {
    const owner = useUserStore.getState().currentUser?.id;
    if (!owner || useUserStore.getState().currentUser?.isGuest) throw new Error('social: full account required');
    if(owner !== expectedOwner) throw new StaleSessionError(expectedOwner,owner);
    if (!USE_MOCK_DATA) await call('setSocialPrivacy', privacy, owner);
    if (useUserStore.getState().currentUser?.id !== owner) throw new StaleSessionError(owner, useUserStore.getState().currentUser?.id ?? '');
    useUserStore.setState(s => ({ currentUser: s.currentUser ? { ...s.currentUser, socialPrivacy: privacy, dmFriendsOnly: true } : null }));
  },
  async inviteToClub(groupId: string, userId: string): Promise<{ invited: boolean; reason?: 'already_member'|'pending'|'rejected'|'already_invited' }> {
    if (USE_MOCK_DATA) return { invited: true };
    return call('inviteSocialPlayerToClub', { groupId, userId });
  },
};
