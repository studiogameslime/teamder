interface Guest { id?: string; name?: string; addedBy?: string; waitlisted?: boolean }
export interface GuestJoinNotice { id: string; name: string; addedBy: string; waitlisted: boolean; action: 'added' | 'promoted' }

/** Compare identities, never array length: rating/name edits are not admissions. */
export function guestJoinNotices(before: unknown[] = [], after: unknown[] = []): GuestJoinNotice[] {
  const old = new Map(before.filter(Boolean).map(value => {
    const guest = value as Guest;
    return [guest.id, guest] as const;
  }));
  const seen = new Set<string>();
  return after.filter(Boolean).flatMap(value => {
    const guest = value as Guest;
    if (typeof guest.id !== 'string' || !guest.id || seen.has(guest.id)) return [];
    seen.add(guest.id);
    const previous = old.get(guest.id);
    const action = !previous ? 'added' : previous.waitlisted === true && guest.waitlisted !== true ? 'promoted' : null;
    if (!action) return [];
    return [{ id:guest.id, name:typeof guest.name === 'string' ? guest.name.trim() : '',
      addedBy:typeof guest.addedBy === 'string' ? guest.addedBy : '', waitlisted:guest.waitlisted === true, action }];
  });
}

export function guestJoinMessage(payload: Record<string, unknown>, gameTitle: string): {title: string; body: string} | null {
  if (typeof payload.guestId !== 'string' || !payload.guestId) return null;
  const guest = `⁨${typeof payload.guestName === 'string' && payload.guestName.trim() ? payload.guestName.trim() : 'אורח'}⁩`;
  const adder = `⁨${typeof payload.addedByName === 'string' && payload.addedByName.trim() ? payload.addedByName.trim() : 'שחקן'}⁩`;
  return payload.guestAction === 'promoted'
    ? {title:`${guest} עבר מרשימת ההמתנה להרכב`,body:`האורח של ${adder} צורף להרכב · ${gameTitle}`}
    : {title:`${adder} צירף אורח: ${guest}`,body:`${payload.guestWaitlisted === true ? 'נוסף לרשימת ההמתנה' : 'הצטרף להרכב'} · ${gameTitle}`};
}

export function joinNoticeRecipients(adminIds: string[] = [], creatorId = '', excludedIds: string[] = []): string[] {
  const excluded = new Set(excludedIds);
  return [...new Set([...adminIds, creatorId])].filter(id => !!id && !excluded.has(id));
}
