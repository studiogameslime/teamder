import type { MatchRotation } from '@/types';

/** A draw with two/three teams. No side is suggested implicitly. */
export function drawRotationPreview(rotation: MatchRotation, staySide: 'A' | 'B' | null) {
  const [a, b] = rotation.playing;
  if (rotation.waiting.length === 0) return { playing: [a, b] as [number, number], staying: null, outgoing: null, incoming: null };
  if (rotation.waiting.length !== 1 || !staySide) return null;
  const incoming = rotation.waiting[0];
  return {
    playing: (staySide === 'A' ? [a, incoming] : [incoming, b]) as [number, number],
    staying: staySide === 'A' ? a : b,
    outgoing: staySide === 'A' ? b : a,
    incoming,
  };
}
