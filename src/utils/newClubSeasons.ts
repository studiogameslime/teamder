// The seasons answer a club gives when it is CREATED.
//
// Data, not UI, and kept out of the component for that reason: this is the
// contract `CreateGroupScreen` turns into an `enableClubSeasons` call, and a
// contract that can only be imported by pulling in react-native is a contract
// nothing can test.

export interface NewClubSeasonsValue {
  enabled: boolean;
  /** `rounds` ends the season on an evening count, `date` on a deadline. */
  cadenceType: 'rounds' | 'date';
  targetRounds: number;
  months: number;
}

export const NEW_CLUB_SEASONS_DEFAULT: NewClubSeasonsValue = {
  // OFF, and that is the honest default rather than a shy one: a club that has
  // never played an evening has no idea yet whether it wants a competition
  // with a finish line, and the edit screen is one tap away.
  enabled: false,
  cadenceType: 'rounds',
  targetRounds: 24,
  months: 3,
};

/**
 * The arguments the creation screen sends, or `null` when seasons were left
 * off.
 *
 * ⚠️ NO `historyChoice` and no `season1EndsOn`. Those decide what to do with
 * evenings ALREADY PLAYED, and a club created a second ago has none — sending
 * one would ask the server to seal a history that does not exist. The server
 * reads an absent history as zero and opens season 1 clean, which is the only
 * honest answer at creation.
 */
export function newClubSeasonsArgs(
  v: NewClubSeasonsValue,
  groupId: string,
):
  | { groupId: string; cadenceType: 'rounds'; targetRounds: number }
  | { groupId: string; cadenceType: 'date'; months: number }
  | null {
  if (!v.enabled) return null;
  return v.cadenceType === 'rounds'
    ? { groupId, cadenceType: 'rounds', targetRounds: v.targetRounds }
    : { groupId, cadenceType: 'date', months: v.months };
}
