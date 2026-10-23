export type LeaderMetric = 'goals' | 'assists' | 'wins' | 'cleanSheets' | 'games' | 'penScored' | 'penSaved' | 'ownGoals';
export type LeaderHistoryRow = { gameId: string; at: number; uid: string; values: Partial<Record<LeaderMetric | 'rounds', number>> };

/** Unknown/incomplete history never proves which player got there first. */
export function earliestCountLeaders(ids: string[], metric: LeaderMetric, target: number, history: LeaderHistoryRow[]): string[] | null {
  const reached = new Map<string, number>();
  for (const uid of ids) {
    const rows = history.filter(r => r.uid === uid).sort((a, b) => a.at - b.at || a.gameId.localeCompare(b.gameId));
    let total = 0, at: number | undefined;
    for (const row of rows) {
      const value = row.values[metric] ?? 0;
      if (!Number.isFinite(value) || value < 0 || !Number.isFinite(row.at) || row.at <= 0) return null;
      total += value;
      if (at === undefined && total >= target) at = row.at;
    }
    if (total !== target || at === undefined) return null;
    reached.set(uid, at);
  }
  const earliest = Math.min(...reached.values());
  return ids.filter(uid => reached.get(uid) === earliest);
}

/** A session-stable random representative for players reaching a value together. */
export function randomLeader(ids: string[], random = Math.random): string | undefined {
  const sorted = [...new Set(ids)].sort();
  if (!sorted.length) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(random() * sorted.length)))];
}

/** Win-percentage cards keep their existing attendance eligibility gate. */
export function earliestWinRateLeaders(ids: string[], target: number, minimumEvenings: number, history: LeaderHistoryRow[], expected: Record<string, { wins: number; rounds: number; games: number }>): string[] | null {
  const dates = new Map<string, number>();
  for (const uid of ids) {
    let wins = 0, rounds = 0, games = 0, reached: number | undefined;
    const rows = history.filter(r => r.uid === uid).sort((a, b) => a.at - b.at || a.gameId.localeCompare(b.gameId));
    for (const row of rows) {
      const w = row.values.wins ?? 0, r = row.values.rounds ?? 0, g = row.values.games ?? 0;
      if (![w, r, g, row.at].every(Number.isFinite) || w < 0 || r < w || g < 0 || row.at <= 0) return null;
      wins += w; rounds += r; games += g;
      if (reached === undefined && games >= minimumEvenings && rounds > 0 && Math.round((wins / rounds + Number.EPSILON) * 10000) / 100 === target) reached = row.at;
    }
    const totals = expected[uid];
    if (!totals || totals.wins !== wins || totals.rounds !== rounds || totals.games !== games ||
        !rounds || reached === undefined || Math.round((wins / rounds + Number.EPSILON) * 10000) / 100 !== target) return null;
    dates.set(uid, reached);
  }
  const first = Math.min(...dates.values());
  return ids.filter(uid => dates.get(uid) === first);
}
