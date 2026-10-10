import { comparePoints, type ChampionshipRow } from './championship';
export function formatEveningScore(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—';
}
export function compareEveningScores(scores: Record<string, number>) {
  return (a: ChampionshipRow, b: ChampionshipRow) => {
    const av = scores[a.uid], bv = scores[b.uid];
    const aKnown = typeof av === 'number' && Number.isFinite(av);
    const bKnown = typeof bv === 'number' && Number.isFinite(bv);
    return Number(bKnown) - Number(aKnown) || (aKnown && bKnown ? bv - av : 0) || comparePoints(a, b);
  };
}
