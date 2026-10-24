import type { ComparisonActivityPage, ComparisonRange } from '@/types/comparisonActivity';

/** Local mock data only, never sent or written to a server. */
export function comparisonActivityFixture(range: ComparisonRange): ComparisonActivityPage {
  const names = ['מתן לוי', 'איתי כהן', 'נועם ישראלי', 'רועי דוד', 'אור לוי', 'אורי כהן', 'עידו ישראלי'];
  const counts = [3, 2, 1, 4, 2, 2, 5];
  const rows = names.slice(0, range === 'month' ? 6 : 7).map((name, index) => ({
    id: `comparison-demo-${index}`, name, avatarId: ['a05', 'a07', 'a09', 'a11', 'a13', 'a15', 'a17'][index],
    count: counts[index], lastAt: Date.now() - (index === 6 ? 45 : index) * 86400000 - 3600000,
    groupId: index === 1 ? 'demo-club-b' : 'g1', groupName: index === 1 ? 'כדורגל בשכונה' : 'חמישי כדורגל',
    scopeLabel: index === 1 ? 'כל הזמנים' : 'העונה הנוכחית',
  }));
  return { players: rows.length, comparisons: rows.reduce((sum, row) => sum + row.count, 0), rows, cursor: null };
}
