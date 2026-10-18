import type { RoundHistoryDoc } from './eveningStats';

/** Mirror the server's first-write-wins round history in the local demo. */
export function saveMockRoundHistory(
  history: Record<string, RoundHistoryDoc[]>,
  gameId: string,
  round: RoundHistoryDoc,
): RoundHistoryDoc {
  const rounds = history[gameId] ?? (history[gameId] = []);
  const existing = rounds.find((entry) => entry.roundId === round.roundId);
  if (existing) return existing;
  const snapshot = JSON.parse(JSON.stringify(round)) as RoundHistoryDoc;
  rounds.push(snapshot);
  return snapshot;
}
