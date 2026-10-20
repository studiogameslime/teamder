import { collection, getDocs } from 'firebase/firestore';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { SEASON_TITLE_KEYS, type SeasonTitleKey } from '@/utils/seasonAwards';

export interface HeldSeasonTitle {
  id: string; groupId?: string; groupName: string; seasonId?: string;
  seasonNo: number; titleKey: SeasonTitleKey; value?: number; valueUnit?: 'percent'; at: number;
}
const keys = new Set<string>(SEASON_TITLE_KEYS);
/** Read the frozen award, including the value already written by closeSeason. */
export function readHeldSeasonTitle(id: string, row: Record<string, unknown>): HeldSeasonTitle | null {
  if (typeof row.titleKey !== 'string' || !keys.has(row.titleKey)) return null;
  return {
    id, titleKey: row.titleKey as SeasonTitleKey,
    groupId: typeof row.groupId === 'string' ? row.groupId : undefined,
    groupName: typeof row.groupName === 'string' ? row.groupName : '',
    seasonId: typeof row.seasonId === 'string' ? row.seasonId : undefined,
    seasonNo: typeof row.seasonNo === 'number' && Number.isFinite(row.seasonNo) ? row.seasonNo : 0,
    value: typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : undefined,
    ...(row.valueUnit === 'percent' ? { valueUnit: 'percent' as const } : {}),
    at: typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : 0,
  };
}
export function groupHeldSeasonTitles(titles: HeldSeasonTitle[]) {
  const groups = new Map<string, { key: string; groupName: string; seasonNo: number; at: number; titles: HeldSeasonTitle[] }>();
  for (const title of [...titles].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))) {
    const key = JSON.stringify([title.groupId ?? title.groupName, title.seasonId ?? title.seasonNo, title.groupName]);
    const group = groups.get(key) ?? { key, groupName: title.groupName, seasonNo: title.seasonNo, at: title.at, titles: [] };
    group.titles.push(title); groups.set(key, group);
  }
  return [...groups.values()];
}
export const seasonTitlesService = {
  async list(userId: string): Promise<HeldSeasonTitle[]> {
    if (!userId) throw new Error('Season title owner required');
    if (USE_MOCK_DATA) return [
      { id: 'm1', groupId: 'g1', groupName: 'חמישי כדורגל', seasonId: 's1', seasonNo: 1, titleKey: 'topAssister', value: 9, at: 2 },
      { id: 'm2', groupId: 'g1', groupName: 'חמישי כדורגל', seasonId: 's1', seasonNo: 1, titleKey: 'mostLoyal', value: 9, at: 1 },
    ];
    const { db } = getFirebase();
    const snap = await getDocs(collection(db, 'users', userId, 'seasonTitles'));
    return snap.docs.map(doc => readHeldSeasonTitle(doc.id, doc.data())).filter((title): title is HeldSeasonTitle => !!title).sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  },
};
