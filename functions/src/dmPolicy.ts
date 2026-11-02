/** Private request state must never be returned to the initiator. */
export type DmRequest = { from: string; to: string; status: 'pending'|'declined'|'cancelled'; text: string; messageId: string; createdAt: number };
export type DmStatus = 'open'|'compose'|'incoming'|'declined'|'waiting'|'cancelled'|'unavailable';
export function dmDay(now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function dmStatus(uid: string, options: { blocked: boolean; friends: boolean; approved: boolean; accepts: boolean; request?: DmRequest }): DmStatus {
  if (options.blocked) return 'unavailable';
  if (options.friends || options.approved) return 'open';
  const r = options.request;
  if (r?.from === uid) return r.status === 'cancelled' ? 'cancelled' : 'waiting';
  if (r?.to === uid && r.status !== 'cancelled') return r.status === 'declined' ? 'declined' : 'incoming';
  return options.accepts ? 'compose' : 'unavailable';
}
export function validateDmText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1000 || !value.trim()) throw new Error('INVALID_DM_TEXT');
  return value.trim();
}
