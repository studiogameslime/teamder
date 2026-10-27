export interface InPlayPenalty {
  id: string; team: 'A' | 'B'; kickerId: string; keeperId: string | null;
  outcome: 'goal' | 'save' | 'miss'; minute: number; at: number; clockMs?: number;
}
export function inPlayPenaltyFingerprint(rows: readonly InPlayPenalty[] | undefined): string {
  return JSON.stringify((rows ?? []).map(p => [p.id,p.team,p.kickerId,p.keeperId,p.outcome,p.minute,p.at,...(p.clockMs !== undefined ? [p.clockMs] : [])]));
}
/** Never trust a caller-provided attempt. Both the snapshot and scored goals
 * must agree with the stored event log, under the commit update-time guard. */
export function verifiedInPlayPenalties(live: {inPlayPenalties?: InPlayPenalty[];goals?: {
  penaltyId?: string; team?: string; scorerId?: string | null; ownGoal?: boolean; assisterId?: string | null;
}[]} | undefined, snapshot: unknown): InPlayPenalty[] {
  const rows = live?.inPlayPenalties ?? [];
  if (!Array.isArray(rows) || (rows.length && snapshot !== inPlayPenaltyFingerprint(rows))) throw new Error('in-play penalty snapshot changed');
  const ids = new Set<string>();
  for (const p of rows) {
    if (!p || !p.id || ids.has(p.id) || !['A','B'].includes(p.team) || !p.kickerId ||
      !['goal','save','miss'].includes(p.outcome) || !Number.isFinite(p.minute) || p.minute < 1 || !Number.isFinite(p.at) ||
      (p.clockMs !== undefined && (!Number.isSafeInteger(p.clockMs) || p.clockMs < 0)) ||
      p.kickerId === p.keeperId) throw new Error('invalid in-play penalty');
    ids.add(p.id);
    const goals = (live?.goals ?? []).filter(g => g.penaltyId === p.id);
    if (goals.length !== (p.outcome === 'goal' ? 1 : 0) || goals.some(g => g.team !== p.team ||
      g.scorerId !== p.kickerId || g.ownGoal || g.assisterId)) throw new Error('penalty and goal disagree');
  }
  if ((live?.goals ?? []).some(g => g.penaltyId && !ids.has(g.penaltyId))) throw new Error('orphan penalty goal');
  return rows;
}
/** Event evidence restores substituted kickers AND keepers to participants. */
export function penaltyParticipants(rows: InPlayPenalty[]) {
  return rows.flatMap(p => [{team:p.team,scorerId:p.kickerId},
    ...(p.keeperId ? [{team:p.team === 'A' ? 'B' : 'A',scorerId:p.keeperId}] : [])]);
}
