// Read-only projection. Never return the private standing document itself.
// Audience mirrors firestore.rules canReadGame; ordinary standings stay self-only.
type Data = Record<string, unknown>;
export class EveningScoresAccessError extends Error {
  constructor(readonly code: 'unauthenticated' | 'invalid-argument' | 'not-found' | 'permission-denied') {
    super(code);
  }
}
export async function readGameEveningScores(uid: string | undefined, gameId: unknown, reads: {
  game: (id: string) => Promise<Data | undefined>;
  group: (id: string) => Promise<Data | undefined>;
  scores: (id: string) => Promise<Data[]>;
}): Promise<{ scores: Record<string, number> }> {
  if (!uid) throw new EveningScoresAccessError('unauthenticated');
  if (typeof gameId !== 'string' || !gameId || gameId.includes('/') || gameId.length > 1500)
    throw new EveningScoresAccessError('invalid-argument');
  const game = await reads.game(gameId);
  if (!game) throw new EveningScoresAccessError('not-found');
  const contains = (v: unknown) => Array.isArray(v) && v.includes(uid);
  let allowed = game.visibility === 'public' || game.createdBy === uid ||
    contains(game.participantIds) || contains(game.players);
  if (!allowed && typeof game.groupId === 'string' && game.groupId && !game.groupId.includes('/')) {
    const group = await reads.group(game.groupId);
    allowed = !!group && (contains(group.playerIds) || contains(group.adminIds));
  }
  if (!allowed) throw new EveningScoresAccessError('permission-denied');
  const scores: Record<string, number> = Object.create(null);
  for (const row of await reads.scores(gameId)) {
    if (typeof row.userId === 'string' && row.userId && typeof row.score === 'number' &&
      Number.isFinite(row.score) && row.score >= 0 && row.score <= 10) scores[row.userId] = row.score;
  }
  return { scores };
}
