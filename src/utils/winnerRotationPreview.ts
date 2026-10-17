import type {MatchRotation} from '@/types';

/** Read-only winner-stays preview; no result, win or player assignment is written. */
export function winnerRotationPreview(rotation: MatchRotation, winner: number) {
  if (!rotation.playing.includes(winner)) return null;
  const outgoing = rotation.playing.find(index => index !== winner)!;
  const incoming = rotation.waiting[0];
  return {
    playing: incoming == null ? rotation.playing : rotation.playing.map(team => team === winner ? team : incoming) as [number, number],
    incoming,
    outgoing: incoming == null ? undefined : outgoing,
    waiting: incoming == null ? rotation.waiting : [...rotation.waiting.slice(1), outgoing],
  };
}
