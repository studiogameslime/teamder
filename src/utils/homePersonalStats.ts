import type { PlayerStatsSummary } from '@/services/playerStatsService';

export type HomeStatsSlide = 'numbers' | 'scores' | 'partner' | 'milestone';
export function nextPersonalMilestone(goals: number) {
  if (!Number.isFinite(goals) || goals <= 0) return null;
  const target = [10, 25, 50, 75, 100, 150, 200].find(n => n > goals);
  if (!target || target - goals > Math.max(3, Math.ceil(target * 0.1))) return null;
  return { target, remaining: target - goals };
}
export function homeStatsSlides(stats: PlayerStatsSummary): HomeStatsSlide[] {
  if (!(stats.attendedGames > 0 || stats.goals > 0 || stats.assists > 0)) return [];
  return [...(stats.highlights?.points.length ? ['scores' as const] : []), 'numbers',
    ...(stats.mostPlayedWith?.count ? ['partner' as const] : []),
    ...(nextPersonalMilestone(stats.goals) ? ['milestone' as const] : [])];
}
