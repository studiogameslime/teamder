import type { NarrativeStats } from './eveningNarrative';

export interface PersonalEveningRecord {
  metric: 'goals' | 'assists' | 'wins';
  value: number;
  previous: number;
  kind: 'new' | 'equal';
}

/** All prior evenings in this club must be known. A first appearance is not a record. */
export function personalEveningRecords(
  current: Pick<NarrativeStats, 'goals' | 'assists' | 'wins'>,
  history: Array<Pick<NarrativeStats, 'goals' | 'assists' | 'wins'>>,
  complete: boolean,
): PersonalEveningRecord[] {
  if (!complete || history.length === 0) return [];
  return (['goals', 'assists', 'wins'] as const).flatMap((metric) => {
    if (!history.every((r) => Number.isFinite(r[metric]) && r[metric] >= 0)) return [];
    const previous = Math.max(...history.map((r) => r[metric]));
    const value = current[metric];
    if (!Number.isFinite(value) || value <= 0 || value < previous) return [];
    return [{ metric, value, previous, kind: value > previous ? 'new' as const : 'equal' as const }];
  });
}

export interface EveningHighlight {
  id: string;
  icon: 'star-outline' | 'trophy-outline' | 'flame-outline' | 'hand-left-outline' | 'football-outline';
  title: string;
  detail: string;
  tone: 'blue' | 'gold' | 'purple';
}

export const eveningCount = (n: number, singular: string, plural: string) => n === 1 ? `${singular} אחד` : `${n} ${plural}`;
const count = eveningCount;

/** No generic participation/effort filler. Detailed facts require complete round history. */
export function eveningHighlights(s: NarrativeStats, historyComplete: boolean): EveningHighlight[] {
  const out: EveningHighlight[] = [];
  if (historyComplete && s.bestMiniGame && s.bestMiniGame.goals + s.bestMiniGame.assists >= 3) {
    out.push({ id: 'best', icon: 'star-outline', title: 'המשחק הבולט שלך',
      detail: [s.bestMiniGame.goals > 0 ? count(s.bestMiniGame.goals, 'שער', 'שערים') : '',
        s.bestMiniGame.assists > 0 ? count(s.bestMiniGame.assists, 'בישול', 'בישולים') : '']
        .filter(Boolean).join(' ו־') + ' במשחק אחד', tone: 'blue' });
  }
  if (s.gamesPlayed >= 2 && s.wins === s.gamesPlayed) {
    out.push({ id: 'perfect', icon: 'trophy-outline', title: 'מחזור מושלם',
      detail: `ניצחת בכל ${s.gamesPlayed} המשחקים ששיחקת`, tone: 'gold' });
  } else if (historyComplete && s.heldPitch >= 2) {
    out.push({ id: 'held', icon: 'trophy-outline', title: 'החזקת את המגרש',
      detail: `${s.heldPitch} ניצחונות ברצף`, tone: 'gold' });
  }
  if (historyComplete && s.scoringStreak >= 2) {
    out.push({ id: 'streak', icon: 'flame-outline', title: 'רצף כיבושים',
      detail: `כבשת ב־${s.scoringStreak} משחקים רצופים`, tone: 'gold' });
  }
  if (historyComplete && s.pen.saved > 0) {
    out.push({ id: 'saved', icon: 'hand-left-outline', title: 'הידיים שלך עשו את ההבדל',
      detail: `עצרת ${count(s.pen.saved, 'פנדל', 'פנדלים')}`, tone: 'blue' });
  }
  if (historyComplete && s.pen.scored > 0) {
    out.push({ id: 'penalty', icon: 'football-outline', title: 'מדויק מהנקודה',
      detail: `הבקעת ${count(s.pen.scored, 'פנדל', 'פנדלים')} בשובר שוויון`, tone: 'blue' });
  }
  return out;
}
