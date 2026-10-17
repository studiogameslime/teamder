import type { Game, Group } from '@/types';
import type { RoundHistoryDoc } from './eveningStats';

export const LOCAL_DEMO_KEY = 'teamder.demo.live-round.v1';

export interface LocalDemoSnapshot {
  version: 1;
  game: Game;
  group: Pick<Group, 'id' | 'internalRating' | 'adminRatings'>;
  history: RoundHistoryDoc[];
}

/** Only the explicitly prepared local fixture can replace bundled demo data. */
export function parseLocalDemoSnapshot(raw: string | null): LocalDemoSnapshot | null {
  if (raw === null || raw === 'null') return null;
  const value = JSON.parse(raw) as LocalDemoSnapshot;
  const game = value?.game;
  if (value?.version !== 1 || game?.id !== 'gv2-live' || game.groupId !== 'g1' ||
      game.createdBy !== 'p7' || value.group?.id !== game.groupId ||
      typeof game.title !== 'string' || typeof game.fieldName !== 'string' ||
      !Number.isFinite(game.startsAt) || game.startsAt <= 0 ||
      !Array.isArray(game.players) || !game.players.every(id => typeof id === 'string' && id.length > 0) ||
      game.players.length !== 15 || new Set(game.players).size !== game.players.length ||
      !Array.isArray(game.waitlist) || !Array.isArray(value.history) ||
      !['scheduled', 'open', 'locked', 'active', 'finished', 'cancelled'].includes(game.status) ||
      !/^(4|5|6|7|8|9|10|11)v\1$/.test(game.format ?? '') ||
      !Number.isInteger(game.numberOfTeams) || game.numberOfTeams! < 2 || game.numberOfTeams! > 7) {
    throw new Error('LOCAL_DEMO_INVALID');
  }
  const ratings = value.group.adminRatings;
  if (ratings !== undefined && (!ratings || typeof ratings !== 'object' || Array.isArray(ratings) ||
      Object.values(ratings).some(rating => !Number.isFinite(rating) || rating <= 0 || rating > 5))) {
    throw new Error('LOCAL_DEMO_INVALID_RATINGS');
  }
  return value;
}

/** Persist configuration only: every app boot is a new allocation/live test. */
export function freshLocalDemoSnapshot(snapshot: LocalDemoSnapshot, now: number): LocalDemoSnapshot {
  const source = snapshot.game;
  const players = [...source.players];
  return {
    version: 1,
    group: { ...snapshot.group, adminRatings: { ...snapshot.group.adminRatings } },
    history: [],
    game: {
      id: source.id, groupId: source.groupId, title: source.title,
      startsAt: now + 20 * 60000,
      fieldName: source.fieldName, fieldLat: source.fieldLat, fieldLng: source.fieldLng,
      fieldAddress: source.fieldAddress, city: source.city, fieldType: source.fieldType,
      maxPlayers: 15, minPlayers: 10, format: '5v5', numberOfTeams: 3,
      players, participantIds: [...players], waitlist: [], pending: [], guests: [],
      status: 'open', locked: false, currentMatchIndex: 0, matches: [],
      createdBy: 'p7', createdAt: source.createdAt, updatedAt: now,
      visibility: 'community', requiresApproval: false,
      advancedMode: true, advancedFillMode: 'temporary', matchDurationMinutes: 15,
      bringBall: source.bringBall, bringShirts: source.bringShirts,
      ballHolderUserId: source.ballHolderUserId, jerseysHolderUserId: source.jerseysHolderUserId,
      notes: source.notes,
    },
  };
}
