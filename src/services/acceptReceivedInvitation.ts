import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { gameService } from './gameService';
import { StaleSessionError } from './staleSession';
import type { ReceivedInvitation } from '@/utils/receivedInvitations';

/** Use the existing authorised joins; notification payloads never grant membership. */
export async function acceptReceivedInvitation(item: ReceivedInvitation, uid: string) {
  const assertOwner = () => {
    const user = useUserStore.getState().currentUser;
    if (user?.id !== uid || user.isGuest) throw new StaleSessionError(uid, user?.id ?? '');
  };
  assertOwner();
  if (['unavailable', 'expired', 'full', 'scheduled'].includes(item.status ?? '')) {
    throw new Error('INVITATION_UNAVAILABLE');
  }
  if (item.type === 'groupInvitation') {
    const status = await useGroupStore.getState().requestJoinById(item.targetId, uid);
    assertOwner();
    if (status === 'not_found') throw new Error('INVITATION_UNAVAILABLE');
    return { type: 'team' as const, id: item.targetId, isMember: status !== 'pending', status };
  }
  const { bucket } = await gameService.requestJoinGame(item.targetId, uid, 'notification');
  assertOwner();
  return { type: 'session' as const, id: item.targetId, isMember: bucket !== 'pending', status: bucket };
}
