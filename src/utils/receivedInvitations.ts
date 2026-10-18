export type InvitationPreview = {
  coverPhotoUrl?: string; coverImageId?: string; groupId?: string;
  groupName?: string; city?: string; fieldName?: string; fieldType?: string;
  format?: string; isOpen?: boolean; isFull?: boolean; isOrphanContext?: boolean;
  inviterPhotoUrl?: string; inviterAvatarId?: string;
};
export type ReceivedInvitation = {
  id: string; type: 'groupInvitation' | 'inviteToGame'; targetId: string;
  title: string; inviterName: string; createdAt: number; startsAt?: number;
  read: boolean; payload: Record<string, unknown>;
  preview?: InvitationPreview;
  status?: 'available'|'joined'|'pending'|'unavailable'|'expired'|'full'|'scheduled';
};
function milliseconds(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  return 0;
}
/** Never infer invitations from friendship or from membership requests. */
export function receivedInvitations(rows: {id:string; data:Record<string, any>}[], uid:string): ReceivedInvitation[] {
  const latest = new Map<string, ReceivedInvitation>();
  for (const {id,data} of rows) {
    if (data.recipientId !== uid || !['groupInvitation','inviteToGame'].includes(data.type)) continue;
    const p=data.payload ?? {}, club=data.type==='groupInvitation';
    const targetId=club?p.groupId:p.gameId;
    if (typeof targetId!=='string'||!targetId) continue;
    const item:ReceivedInvitation={id,type:data.type,targetId,payload:p,
      title:typeof (club?p.groupName:p.gameTitle)==='string'?(club?p.groupName:p.gameTitle):'',
      inviterName:typeof p.inviterName==='string'?p.inviterName:'מנהל',
      createdAt:milliseconds(data.createdAtMs)||milliseconds(data.createdAt),
      startsAt:milliseconds(p.startsAt)||undefined,read:data.read===true,status:data.invitationStatus};
    const key=`${item.type}:${targetId}`, old=latest.get(key);
    if (!old || old.createdAt < item.createdAt) latest.set(key,item);
  }
  // Filter after deduplication so an older pending invitation cannot reappear
  // when the latest invitation for the same target has already been accepted.
  return [...latest.values()].filter(item=>item.status!=='joined').sort((a,b)=>b.createdAt-a.createdAt);
}

/** Route hints are not invitation evidence. Resolve the recipient's inbox. */
export function hasClubInvitation(items: ReceivedInvitation[], groupId: string, now = Date.now()): boolean {
  return items.some(item => item.type === 'groupInvitation' && item.targetId === groupId &&
    !['joined', 'expired', 'unavailable'].includes(item.status ?? '') &&
    item.payload.managerApproved !== false &&
    !(typeof item.payload.expiresAt === 'number' && item.payload.expiresAt > 0 && item.payload.expiresAt <= now));
}
