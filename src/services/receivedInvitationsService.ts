import { collection, getDocs, query, where } from 'firebase/firestore';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { useUserStore } from '@/store/userStore';
import { StaleSessionError } from './staleSession';
import { notificationsService } from './notificationsService';
import { receivedInvitations } from '@/utils/receivedInvitations';
import { httpsCallable } from 'firebase/functions';
import { groupService } from './groupService';
import { gameService } from './gameService';
import { useGroupStore } from '@/store/groupStore';
import type { ReceivedInvitation } from '@/utils/receivedInvitations';
import { activeGuestCount } from '@/types';

/** Public club projections and invitation-readable rounds; never private player reads. */
async function withPreviews(items: ReceivedInvitation[], uid: string): Promise<ReceivedInvitation[]> {
  if (!items.length) return items;
  const clubs = new Map<string, ReturnType<typeof groupService.getPublic>>();
  const club = (id: string) => {
    if (!clubs.has(id)) clubs.set(id, groupService.getPublic(id).catch(() => null));
    return clubs.get(id)!;
  };
  const inviterIds = [...new Set(items.map(item => item.payload.inviterId).filter((id): id is string => typeof id === 'string' && !!id))];
  const people = await groupService.hydratePublicUsers(inviterIds).catch(() => []);
  const rows = await Promise.all(items.map(async item => {
    const person = people.find(p => p.id === item.payload.inviterId);
    const identity = { inviterPhotoUrl: person?.photoUrl, inviterAvatarId: person?.avatarId };
    if (item.type === 'groupInvitation') {
      const target = await club(item.targetId);
      const member = useGroupStore.getState().groups.some(g => g.id === item.targetId && [...g.playerIds, ...g.adminIds].includes(uid));
      return { ...item, ...(member ? { status: 'joined' as const } : {}),
        ...(target ? { title: target.name, preview: { ...identity, coverPhotoUrl: target.coverPhotoUrl, coverImageId: target.coverImageId, city: target.city, isOpen: target.isOpen } } : { preview: identity }) };
    }
    const game = await gameService.getGameById(item.targetId).catch(() => null);
    if (!game) return { ...item, preview: identity };
    const target = game.groupId && !game.isOrphanContext ? await club(game.groupId) : null;
    const joined = [...game.players, ...game.waitlist].includes(uid);
    const occupied = game.players.length + activeGuestCount(game.guests) + (game.pendingPromotion?.uid ? 1 : 0);
    const unavailable = !['open', 'scheduled'].includes(game.status) || game.liveMatch?.phase === 'live' || game.startsAt + 3600000 < Date.now();
    return { ...item, title: game.title || item.title, startsAt: game.startsAt,
      status: joined ? 'joined' as const : unavailable ? 'unavailable' as const : game.status === 'scheduled' ? 'scheduled' as const : game.pending?.includes(uid) ? 'pending' as const : item.status,
      preview: { ...identity, groupId: game.groupId, groupName: target?.name, coverPhotoUrl: target?.coverPhotoUrl, coverImageId: target?.coverImageId,
        city: game.city, fieldName: game.fieldName, fieldType: game.fieldType, format: game.format, isOrphanContext: game.isOrphanContext,
        isFull: !!game.maxPlayers && occupied >= game.maxPlayers } };
  }));
  return rows.filter(item => item.status !== 'joined');
}

export const receivedInvitationsService = {
  async listInbox(uid:string) {
    const current=()=>useUserStore.getState().currentUser;
    const assertOwner=()=>{
      const owner=current();
      const session=USE_MOCK_DATA?owner?.id:getFirebase().auth.currentUser?.uid;
      if (owner?.id!==uid || session!==uid || owner?.isGuest) throw new StaleSessionError(uid,session??'');
    };
    assertOwner();
    const finish = async (rows: {id:string;data:Record<string,any>}[]) => {
      const items = receivedInvitations(rows, uid);
      assertOwner();
      return items;
    };
    if (USE_MOCK_DATA) return finish(notificationsService.__getMockDispatches().map(n=>({id:n.id,data:n})));
    try {
      const result=await httpsCallable(getFirebase().functions,'getReceivedInvitations')({});
      assertOwner();
      return finish(result.data as {id:string;data:Record<string,any>}[]);
    } catch(error) {
      assertOwner();
      // Older deployed servers have no endpoint yet. Preserve the existing
      // recipient-bound inbox until the coordinated release, never on denial.
      if (!['functions/not-found','functions/unimplemented'].includes((error as {code?:string}).code??'')) throw error;
    }
    // Recipient equality is both the rule proof and a single-field index.
    // Do not limit before filtering: other notification types must not hide invites.
    const snap=await getDocs(query(collection(getFirebase().db,'notifications'),where('recipientId','==',uid)));
    assertOwner();
    return finish(snap.docs.map(d=>({id:d.id,data:d.data()})));
  },
  /** Decisions and badges do not wait for cover photos or inviter identities. */
  async list(uid:string):Promise<ReceivedInvitation[]> {
    const items=await this.listInbox(uid);
    const result=await withPreviews(items,uid);
    const owner=useUserStore.getState().currentUser;
    if(owner?.id!==uid||owner.isGuest)throw new StaleSessionError(uid,owner?.id??'');
    return result;
  },
};
