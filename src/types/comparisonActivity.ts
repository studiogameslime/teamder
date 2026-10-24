export type ComparisonRange = 'month' | 'all';
export type ComparisonActivityRow = {
  id: string;
  name: string;
  avatarId?: string;
  photoUrl?: string;
  count: number;
  lastAt: number;
  groupId: string;
  groupName: string;
  scopeLabel: string;
};
export type ComparisonActivityPage = {
  players: number;
  comparisons: number;
  rows: ComparisonActivityRow[];
  cursor: string | null;
};
