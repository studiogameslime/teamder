import { upsertSavedGuest } from '@/utils/savedGuest';
import type { GameGuest } from '@/types';
import fs from 'fs';
import path from 'path';

const guest: GameGuest = { id: 'g1', name: 'אורח', addedBy: 'admin', createdAt: 1 };
test('saved guest appears without a reload and retains server waitlist placement', () => {
  const saved = { ...guest, waitlisted: true };
  expect(upsertSavedGuest(undefined, saved)).toEqual([saved]);
});
test('snapshot arriving before save callback does not duplicate the guest or count', () => {
  const before = [guest];
  const rated = { ...guest, estimatedRating: 4 };
  expect(upsertSavedGuest(before, rated)).toEqual([rated]);
  expect(before).toEqual([guest]);
});
test('details and embedded roster share committed game state', () => {
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), 'src/screens/games', file), 'utf8');
  expect(read('MatchDetailsScreen.tsx')).toContain('gameState={{ game, setGame }}');
  const roster = read('MatchPlayersScreen.tsx');
  expect(roster).toContain('props.gameState?.game ?? localGame');
  expect(roster).toContain('props.gameState?.setGame ?? setLocalGame');
  expect(roster).toContain('useGameEvents(controlled ? undefined : gameId');
});
