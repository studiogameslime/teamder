import type { PlayerStatsSummary } from '@/services/playerStatsService';

export type HomeStatsSlide = 'overview' | 'scores' | 'partner' | 'milestone';
export function nextPersonalMilestone(goals: number) {
  if (!Number.isFinite(goals) || goals <= 0) return null;
  const target = [10, 25, 50, 75, 100, 150, 200].find(n => n > goals);
  if (!target || target - goals > Math.max(3, Math.ceil(target * 0.1))) return null;
  return { target, remaining: target - goals };
}
export function homeStatsSlides(stats: PlayerStatsSummary): HomeStatsSlide[] {
  if (!(stats.attendedGames > 0 || stats.goals > 0 || stats.assists > 0)) return ['overview'];
  return ['overview', ...(stats.highlights?.points.length ? ['scores' as const] : []),
    ...(stats.mostPlayedWith?.count ? ['partner' as const] : []),
    ...(nextPersonalMilestone(stats.goals) ? ['milestone' as const] : [])];
}

export type HomeProfileInsight = {
  kind: 'streak' | 'attendance' | 'community' | 'welcome' | 'form' | 'impact' | 'playstyle' | 'connection' | 'results' | 'journey';
  title: string;
  detail: string;
  progress?: { current: number; target: number };
};
const validCount = (value: number) => Number.isSafeInteger(value) && value >= 0;
const DAY = 24 * 60 * 60 * 1000;
const decimal = (value: number) => Number(value.toFixed(1)).toLocaleString('he-IL');

/** Derived stories only: no extra reads, invented records or comparisons between different scopes. */
export function homeProfileInsights(stats: PlayerStatsSummary, now = Date.now()): HomeProfileInsight[] {
  const insights: HomeProfileInsight[] = [];
  const streak = stats.attendanceStreak;
  if (streak && Number.isSafeInteger(streak.current) && streak.current >= 2 &&
      Number.isSafeInteger(streak.best) && streak.best >= streak.current) {
    const gap = streak.best - streak.current;
    insights.push({ kind: 'streak', title: `${streak.current} הגעות ברצף!`,
      detail: gap === 0 ? 'זה רצף ההגעות הארוך ביותר שלך במחזורים שאליהם נרשמת.' :
        gap === 1 ? 'עוד מחזור אחד להשוואת שיא ההגעה שלך.' : `עוד ${gap} מחזורים להשוואת שיא ההגעה שלך.`,
      ...(gap > 0 ? { progress: { current: streak.current, target: streak.best } } : {}) });
  } else if (validCount(stats.totalRegistered) && stats.totalRegistered >= 3 && Number.isFinite(stats.attendanceRate) && stats.attendanceRate >= 80 && stats.attendanceRate <= 100) {
    insights.push({ kind: 'attendance', title: 'מגיע לך קרדיט על ההתמדה', detail: `${stats.attendanceRate}% הגעה למחזורים שאליהם נרשמת.` });
  }

  const highlights = stats.highlights;
  // Five complete, unique, recent scores are required. Missing points are not zeroes.
  const points = [...(highlights?.points ?? [])].sort((a, b) => a.at - b.at || a.gameId.localeCompare(b.gameId));
  if (highlights && !highlights.incomplete && highlights.recentCount === 5 && points.length === 5 &&
      new Set(points.map(p => p.gameId)).size === 5 && points.every(p => p.gameId && Number.isFinite(p.at) &&
        p.at > 0 && p.at <= now && now - p.at <= 90 * DAY && Number.isFinite(p.score) && p.score >= 0 && p.score <= 10)) {
    const earlier = points.slice(0, 3).reduce((sum, p) => sum + p.score, 0) / 3;
    const latest = (points[3].score + points[4].score) / 2;
    const mean = points.reduce((sum, p) => sum + p.score, 0) / 5;
    const previous = points.slice(0, 4).reduce((sum, p) => sum + p.score, 0) / 4;
    if (points[4].score >= 8.5 && points[4].score - previous >= 0.5) {
      insights.push({ kind: 'form', title: 'המחזור האחרון שלך בלט', detail: `ציון ${decimal(points[4].score)} במחזור האחרון עם ציון, לעומת ממוצע ${decimal(previous)} בארבעת קודמיו.` });
    } else if (latest - earlier >= 0.5) {
      insights.push({ kind: 'form', title: 'המשחק שלך עולה מדרגה', detail: `ממוצע ${decimal(latest)} בשני המחזורים האחרונים עם ציון, לעומת ${decimal(earlier)} בשלושת קודמיהם.` });
    } else if (mean >= 7 && Math.max(...points.map(p => p.score)) - Math.min(...points.map(p => p.score)) <= 0.75) {
      insights.push({ kind: 'form', title: 'אפשר לסמוך על היציבות שלך', detail: `חמישה מחזורים עם ציונים קרובים וממוצע ${decimal(mean)}. זו עקביות על המגרש.` });
    }
  }

  const roundsValid = validCount(stats.attendedGames);
  if (roundsValid && validCount(stats.goals) && validCount(stats.assists)) {
    const involvements = stats.goals + stats.assists;
    if (Number.isSafeInteger(involvements) && involvements >= 5) {
      if (stats.attendedGames >= 5 && involvements / stats.attendedGames >= 1) {
        const average = involvements / stats.attendedGames;
        insights.push({ kind: 'impact', title: 'יש לך חלק בשערים', detail: Number(average.toFixed(1)) === 1 ?
          'בערך שער או בישול אחד למחזור ששיחקת, לפי הנתונים המצטברים.' :
          `ממוצע של ${decimal(average)} שערים ובישולים למחזור ששיחקת, לפי הנתונים המצטברים.` });
      }
      const assistShare = Math.round(stats.assists / involvements * 100);
      if (stats.assists >= 3 && assistShare >= 60) {
        insights.push({ kind: 'playstyle', title: 'אתה יודע לסדר לאחרים שער', detail: `${assistShare}% מהשערים והבישולים שלך הם בישולים. המסירה היא חלק בולט במשחק שלך.` });
      } else if (stats.goals >= 3 && 100 - assistShare >= 70) {
        insights.push({ kind: 'playstyle', title: 'כשאתה מעורב, אתה לרוב הכובש', detail: `${100 - assistShare}% מהשערים והבישולים שלך הם שערים שכבשת בעצמך.` });
      } else if (stats.goals >= 5 && stats.assists >= 5 && assistShare >= 40 && assistShare <= 60) {
        insights.push({ kind: 'playstyle', title: 'גם מסיים וגם מפרגן', detail: 'לפחות חמישה שערים וחמישה בישולים, עם חלוקה מאוזנת ביניהם. אתה תורם בשתי הדרכים.' });
      }
    }
    const recipient = stats.mostAssistedTo;
    const provider = stats.mostAssistedBy;
    if (recipient?.uid && validCount(recipient.count) && recipient.count >= 3 && stats.assists >= 5 && recipient.count <= stats.assists && recipient.count / stats.assists >= 0.3) {
      insights.push({ kind: 'connection', title: 'יש לך כתובת למסירה', detail: `${recipient.count} בישולים שלך הגיעו לאותו שחקן. זה ${Math.round(recipient.count / stats.assists * 100)}% מכל הבישולים שלך.` });
    } else if (provider?.uid && validCount(provider.count) && provider.count >= 3 && stats.goals >= 5 && provider.count <= stats.goals && provider.count / stats.goals >= 0.3) {
      insights.push({ kind: 'connection', title: 'יש מי שמוצא אותך ליד השער', detail: `${provider.count} שערים שלך הגיעו מבישולים של אותו שחקן. זה ${Math.round(provider.count / stats.goals * 100)}% מהשערים שלך.` });
    }
  }

  const results = highlights?.results;
  if (highlights && !highlights.incomplete && results && roundsValid &&
      [results.wins, results.losses, results.ties, results.games, results.rounds].every(validCount) &&
      results.rounds >= 3 && results.rounds <= stats.attendedGames && results.games >= 10 &&
      results.games >= results.rounds && results.wins + results.losses + results.ties === results.games && results.wins / results.games >= 0.6) {
    insights.push({ kind: 'results', title: 'יש לך לא מעט סיבות לחייך', detail: `${Math.round(results.wins / results.games * 100)}% ניצחונות מתוך ${results.games} משחקים, בתוצאות שתועדו עבורך לאורך ${results.rounds} מחזורים.` });
  }
  if (roundsValid && stats.attendedGames >= 7) {
    const target = [10, 25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000].find(n => n > stats.attendedGames);
    if (target && target - stats.attendedGames <= 3) {
      const gap = target - stats.attendedGames;
      insights.push({ kind: 'journey', title: 'עוד מעט ציון דרך על המגרש', detail: gap === 1 ?
        `עוד מחזור אחד, ויש לך ${target} מחזורים ששיחקת.` : `עוד ${gap} מחזורים, ויש לך ${target} מחזורים ששיחקת.` });
    }
  }
  if (Number.isSafeInteger(stats.distinctPlayers) && stats.distinctPlayers > 0) {
    insights.push({ kind: 'community', title: 'החיבורים שלך על המגרש', detail: stats.distinctPlayers === 1 ?
      'כבר שיחקת עם שחקן נוסף. הכדורגל מחבר ביניכם.' : `כבר שיחקת עם ${stats.distinctPlayers} שחקנים שונים.` });
  }
  return insights.length ? insights : [{ kind: 'welcome', title: stats.attendedGames > 0 ? 'הסיפור שלך על המגרש כבר התחיל' : 'הכדורגל שלך מתחיל כאן',
    detail: stats.attendedGames > 0 ? 'כל מחזור מוסיף רגעים חדשים לכרטיס השחקן שלך.' : 'אחרי המחזור הראשון יתחילו להצטבר הנתונים והתובנות שלך.' }];
}

/** Stable for a player and local calendar day; no timer rotates text while it is being read. */
export function homeProfileInsight(stats: PlayerStatsSummary, options?: { playerId: string; now?: number }): HomeProfileInsight {
  const now = options?.now ?? Date.now();
  const insights = homeProfileInsights(stats, now);
  if (!options?.playerId || !Number.isFinite(now)) return insights[0];
  let seed = 2166136261;
  for (const char of options.playerId) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return insights[0];
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
  return insights[((seed + day) % insights.length + insights.length) % insights.length];
}
