export type PersonalPartnerResults = { games: number; wins: number; losses: number; ties: number; winRate: number };
/** Same-team mini-games only. Missing historical fields are unknown, never zero. */
export function personalPartnerResults(row: { sameTeam?: unknown; winsTogether?: unknown; lossesTogether?: unknown }): PersonalPartnerResults | null {
  const { sameTeam, winsTogether, lossesTogether } = row;
  const valid = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (!valid(sameTeam) || sameTeam === 0 || !valid(winsTogether) || !valid(lossesTogether) || winsTogether + lossesTogether > sameTeam) return null;
  return { games: sameTeam, wins: winsTogether, losses: lossesTogether, ties: sameTeam - winsTogether - lossesTogether, winRate: Math.round(winsTogether / sameTeam * 100) };
}
