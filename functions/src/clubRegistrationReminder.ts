/** Pure authorization for the dashboard's reminder; never grants game access. */
export type ReminderRecord = { adminIds?:unknown; playerIds?:unknown; status?:unknown; startsAt?:unknown; registrationOpensAt?:unknown; players?:unknown; waitlist?:unknown; pending?:unknown; rejectedPlayerIds?:unknown; cancellations?:unknown; liveMatch?:unknown };
export function clubReminderEligibility(uid:string|undefined, recipientId:unknown, game:ReminderRecord|undefined, group:ReminderRecord|undefined, now:number): 'ok'|'unauthenticated'|'permission-denied'|'failed-precondition' {
 if(!uid) return 'unauthenticated';
 if(typeof recipientId!=='string'||!recipientId||recipientId===uid)return 'failed-precondition';
 const has=(value:unknown,id:string)=>Array.isArray(value)&&value.includes(id);
 if(!game||!group||!has(group.adminIds,uid))return 'permission-denied';
 if(!has(group.playerIds,recipientId)&&!has(group.adminIds,recipientId))return 'permission-denied';
 if(game.status!=='open'||typeof game.startsAt!=='number'||game.startsAt<=now||typeof game.registrationOpensAt==='number'&&game.registrationOpensAt>now)return 'failed-precondition';
 if((['players','waitlist','pending','rejectedPlayerIds'] as const).some(k=>has(game[k],recipientId)))return 'failed-precondition';
 const live=game.liveMatch as {phase?:string}|undefined;
 if(live?.phase&&['live','roundRunning','roundEnded','finished'].includes(live.phase))return 'failed-precondition';
 const cancellations=game.cancellations as Record<string,unknown>|undefined;
 if(cancellations&&typeof cancellations[recipientId]==='number')return 'failed-precondition';
 return 'ok';
}
