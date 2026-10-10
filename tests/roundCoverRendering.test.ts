let mockFailed: string | null = null;
const mockActivePhoto: { current?: string } = {};
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: () => [mockFailed, (value: string) => { mockFailed = value; }],
  useRef: () => mockActivePhoto,
}));
jest.mock('react-native', () => ({
  ImageBackground: 'ImageBackground', Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: { create: (value: unknown) => value },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('@/theme', () => ({ RTL_LABEL_ALIGN: 'left' }));
jest.mock('@/components/PressableScale', () => ({ PressableScale: 'PressableScale' }));
jest.mock('@/data/coverImages', () => ({ getCoverSource: (id?: string) => id ? `cover:${id}` : null }));
jest.mock('../src/assets/images/groupImages/park-aerial.jpg', () => 'default-cover');
jest.mock('@/utils/format', () => ({ dayDiff: () => 0, formatTime: () => '20:00',
  formatDateShort: () => '9.10', gameFormatLabel: () => '5 על 5' }));

import { MatchListCard } from '@/components/match/MatchListCard';
import { clubDefaultCoverId } from '@/utils/clubDefaultCoverId';
import type { Game } from '@/types';

const game = { id: 'round-a', groupId: 'club-a', title: 'מחזור', players: [], waitlist: [],
  maxPlayers: 10, status: 'open', visibility: 'public', fieldType: 'synthetic', startsAt: 1 } as unknown as Game;
function image(node: any): any {
  if (!node || typeof node !== 'object') return undefined;
  if (node.type === 'ImageBackground') return node.props;
  const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children];
  return children.map(image).find(Boolean);
}
function render(cover?: { coverPhotoUrl?: string; coverImageId?: string } | null, groupId = 'club-a') {
  return image(MatchListCard({ game: { ...game, groupId }, userId: 'u1', onPrimary: () => {}, cover,
    coverLoading: !!groupId && cover === undefined }));
}

beforeEach(() => { mockFailed = null; mockActivePhoto.current = undefined; });
it('does not show a default photo before the club lookup resolves', () => {
  expect(render().source).toBeUndefined();
  expect(render({ coverImageId: 'c12' }).source).toBe('cover:c12');
});
it('shows a default only for a standalone round or a resolved coverless club', () => {
  expect(render(undefined, '').source).toBe('default-cover');
  expect(render(null).source).toBe(`cover:${clubDefaultCoverId('club-a')}`);
  expect(render({}).source).toBe(`cover:${clubDefaultCoverId('club-a')}`);
});
it('preserves fallback behavior for existing callers that do not load club covers', () => {
  expect(image(MatchListCard({ game, userId: 'u1', onPrimary: () => {} })).source).toBe(`cover:${clubDefaultCoverId('club-a')}`);
});
it('ignores a late error from a photo that has been replaced', () => {
  const old = render({ coverPhotoUrl: 'old' });
  render({ coverPhotoUrl: 'new' }); old.onError();
  expect(mockFailed).toBeNull();
  expect(render({ coverPhotoUrl: 'new' }).source).toEqual({ uri: 'new' });
});
it('falls back on upload failure and immediately accepts a different uploaded photo', () => {
  render({ coverPhotoUrl: 'broken', coverImageId: 'c12' }).onError();
  expect(render({ coverPhotoUrl: 'broken', coverImageId: 'c12' }).source).toBe('cover:c12');
  expect(render({ coverPhotoUrl: 'new', coverImageId: 'c12' }).source).toEqual({ uri: 'new' });
});

function strings(node: any): string[] {
  if (typeof node === 'string') return [node];
  if (!node || typeof node !== 'object') return [];
  return (Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]).flatMap(strings);
}
it('shows visibility once, while preserving the personal registration badge', () => {
  const tree = MatchListCard({ game, userId: 'u1', onPrimary: () => {} });
  expect(strings(tree).filter(x => x === 'פתוח לכולם')).toHaveLength(1);
  expect(strings(MatchListCard({ game: {...game, players:['u1']}, userId:'u1', onPrimary:()=>{} })))
    .toContain('אתה רשום');
});
it('does not label an orphan with a legacy group id as closed to a club', () => {
  const tree=MatchListCard({ game:{...game,visibility:'community',isOrphanContext:true},userId:'u1',onPrimary:()=>{} });
  expect(strings(tree)).toContain('מחזור סגור');
  expect(strings(tree)).not.toContain('סגור למועדון');
  expect(image(tree).source).toBe('default-cover');
});
it('keeps the fresh default stable and distributes clubs across the ten new photos', () => {
  const ids=Array.from({length:100},(_,i)=>clubDefaultCoverId('club-'+i));
  expect(new Set(ids).size).toBe(10);
  expect(ids.every(id=>/^c(0[1-9]|10)$/.test(id))).toBe(true);
  expect(clubDefaultCoverId('club-a')).toBe(clubDefaultCoverId('club-a'));
  expect(clubDefaultCoverId()).toBe('c01');
});
