// Mirrored in src/utils/sharedEveningScore.ts; the parity tests protect both bundles.
export const SHARED_SCORE_VERSION = 'shared-v1' as const;
export const SHARED_SCORE_STARTER = 1.4;
// A delayed historical finish must never opt in by its processing date.
export const SHARED_SCORE_ACTIVATION_AT = Date.UTC(2026, 10, 6, 16, 7, 40);
export interface SharedScoreCalibration {
  version: typeof SHARED_SCORE_VERSION;
  threshold: number;
  frozenAt: number;
  previousThreshold: number;
  target: number | null;
  sourceGameIds: string[];
  selected: { gameId: string; userId: string; index: number }[];
}
export interface SharedScoreInput {
  gamesPlayed: number; wins: number; ties: number; goals: number; assists: number;
  cleanSheets: number; shootoutScored: number; saved: number; missed: number;
}
export function sharedInputFromStats(s: Record<string, unknown>): SharedScoreInput {
  const number = (key:string) => s[key] === undefined ? 0 : typeof s[key] === 'number' ? s[key] as number : NaN;
  return {gamesPlayed:number('rounds'),wins:number('wins'),ties:number('ties'),goals:number('goals'),assists:number('assists'),
    cleanSheets:number('cleanSheets'),shootoutScored:number('penScored')-number('penInPlayScored'),saved:number('penSaved'),missed:number('penMissed')};
}
const count = (n: number) => Number.isSafeInteger(n) && n >= 0;
export function sharedRegularIndex(p: SharedScoreInput): number | null {
  if (![p.gamesPlayed,p.wins,p.ties,p.goals,p.assists,p.cleanSheets].every(count) ||
    p.gamesPlayed === 0 || p.wins + p.ties > p.gamesPlayed || p.cleanSheets > p.gamesPlayed) return null;
  return (40*p.wins + 20*p.ties + 20*p.goals + 16*p.assists + 4*p.cleanSheets) / (40*p.gamesPlayed);
}
export function sharedEveningScore(p: SharedScoreInput, threshold: number): number | null {
  const regular = sharedRegularIndex(p);
  if (regular === null || ![p.shootoutScored,p.saved,p.missed].every(count) || !Number.isFinite(threshold) || threshold <= 0) return null;
  // Integer fortieths avoid intermediate rounding and decimal weight drift.
  const penalties = Math.max(-28,Math.min(28,14*(p.shootoutScored+p.saved)-7*p.missed));
  const units = 40*p.wins + 20*p.ties + 20*p.goals + 16*p.assists + 4*p.cleanSheets + penalties;
  const score = Math.max(6,Math.min(10,6 + units/(10*p.gamesPlayed*threshold)));
  return Math.floor(score*10 + 0.5 + 1e-12)/10;
}
export function readSharedCalibration(value: unknown): SharedScoreCalibration | null {
  const v = value as Partial<SharedScoreCalibration> | null;
  if (!v || v.version !== SHARED_SCORE_VERSION || typeof v.threshold !== 'number' || !Number.isFinite(v.threshold) || v.threshold <= 0) return null;
  return v as SharedScoreCalibration;
}
export function calibrateSharedScore(
  records: {gameId:string;userId:string;index:number}[], previousThreshold = SHARED_SCORE_STARTER,
): Pick<SharedScoreCalibration,'threshold'|'previousThreshold'|'target'|'selected'> {
  if (!Number.isFinite(previousThreshold) || previousThreshold <= 0) throw Error('SCORE_CALIBRATION_INVALID');
  const counts = new Map<string,number>();
  const selected = [...records].filter(r=>Number.isFinite(r.index)&&r.index>=0)
    .sort((a,b)=>b.index-a.index || a.gameId.localeCompare(b.gameId) || a.userId.localeCompare(b.userId))
    .filter(r=>{const n=counts.get(r.gameId)??0;if(n>=2)return false;counts.set(r.gameId,n+1);return true;}).slice(0,10);
  const target = selected.length===10 ? 1.15*(selected[4].index+selected[5].index)/2 : null;
  const threshold = target !== null && target > 0
    ? Math.max(previousThreshold*.97,Math.min(previousThreshold*1.03,target)) : previousThreshold;
  return {threshold,previousThreshold,target,selected};
}
export function sharedAwardMinimum(maxPlayed:number):number { return Math.max(Math.min(3,maxPlayed),Math.ceil(maxPlayed/2)); }
