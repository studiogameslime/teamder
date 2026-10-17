import React from 'react';

jest.mock('react-native', () => ({ I18nManager: { isRTL: true }, Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (value: unknown) => value } }));
jest.mock('@/components/draft/DraftScalePop', () => ({ GrowIn: 'GrowIn', ShrinkOut: 'ShrinkOut' }));
jest.mock('@/components/UserAvatar', () => ({ UserAvatar: 'Avatar' }));
jest.mock('@/components/match/TeamShirt',()=>({TeamShirtIllustration:'Shirt'}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/utils/draft', () => jest.requireActual('@/utils/teamIdentity'));
jest.mock('@/components/match/rotationView', () => ({
  ...jest.requireActual('@/utils/teamIdentity'),
  teamColor: (index: number, teams: any) => {
    const identity = jest.requireActual('@/utils/teamIdentity');
    return (identity.chosenFor(index, teams) ?? identity.TEAM_PALETTE[index])?.hex;
  },
}));
jest.mock('@/theme', () => ({ colors: { primary: '#2563EB', text: '#12234D', border: '#CBD5E1', surface: '#FFF' }, radius: { lg: 16 }, spacing: { sm: 8, md: 12, xs: 4 }, typography: { caption: {} }, shadows: { card: {} }, RTL_LABEL_ALIGN: 'left' }));

import { DraftTeamCard } from '@/components/draft/DraftTeamCard';

const children = (node: any) => React.Children.toArray(node.props?.children);
const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(children(node))];
const flat = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : style ?? {};
const expand = (node: any): any => {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(expand);
  if (typeof node.type === 'function') return expand(node.type(node.props));
  return { ...node, props: { ...node.props, children: children(node).map(expand) } };
};
const copy = (node: any): string => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(copy).join(' ') : node && typeof node === 'object' ? copy(children(node)) : '';
const user = (index: number) => ({ id: `p${index}`, name: `שחקן ${index}`, avatarId: `a${index}` });

test.each([4,5,7,11])('round-details presentation keeps the full %i-player roster, uses existing images and opens the right player',size=>{
 const users=Array.from({length:size},(_,i)=>({...user(i),photoUrl:`https://example.test/${i}.jpg`})),press=jest.fn();
 const tree=expand(DraftTeamCard({summary:true,index:1,colorKey:'green',captain:users[0],members:users.slice(1),teamRating:3.7,onPressUser:press}));
 expect(nodes(tree).filter(n=>n.type==='Avatar').map(n=>n.props.user)).toEqual(users);
 expect(nodes(tree).filter(n=>n.type==='Avatar').every(n=>n.props.size===40)).toBe(true);
 expect(copy(tree)).toContain('הירוקים');expect(copy(tree)).toContain('3.7');expect(nodes(tree).filter(n=>n.type==='Shirt')).toHaveLength(1);
 const buttons=nodes(tree).filter(n=>n.type==='Pressable'&&users.some(p=>p.name===n.props.accessibilityLabel));expect(buttons).toHaveLength(size);
 buttons.forEach(n=>n.props.onPress());expect(press.mock.calls.map(call=>call[0])).toEqual(users.map(p=>p.id));
 expect(nodes(tree).every(n=>flat(n.props.style).flexDirection!=='row-reverse')).toBe(true);
});

test('round-details presentation preserves completion context and does not disclose an absent rating',()=>{
 const tree=expand(DraftTeamCard({summary:true,index:2,colorKey:'white',captain:user(0),members:[user(1)],completionCapacity:5}));
 expect(copy(tree)).toContain('הלבנים');expect(copy(tree)).toContain('2 מתוך 5 · השלמה לפני המשחק');
 expect(nodes(tree).filter(n=>n.type==='Avatar')).toHaveLength(2);expect(nodes(tree).some(n=>n.props.accessibilityLabel?.startsWith('ממוצע דירוג'))).toBe(false);
});

test.each([4, 5, 7, 11])('a %i-player card keeps source roster order and starts each row from the RTL leading edge', size => {
  const users = Array.from({ length: size }, (_, index) => user(index));
  const members = users.slice(1), before = JSON.stringify(members);
  const tree = DraftTeamCard({ index: 0, captain: users[0], members, teamRating: 3.4 });
  const [heading, roster] = children(tree) as any[];
  expect(copy(heading)).toContain('האדומים');
  expect(flat(tree.props.style)).toMatchObject({flexDirection:'column',alignItems:'stretch'});
  expect(flat(heading.props.style).flexDirection).toBe('row');
  expect(flat(roster.props.style)).toMatchObject({ flexDirection: 'row', justifyContent: 'flex-start', flexWrap: 'wrap' });
  const chips = nodes(roster).filter(node => typeof node.type === 'function' && node.type.name === 'Chip');
  expect(chips.map(node => node.props.user.id)).toEqual(users.map(item => item.id));
  expect(chips[0].props.captain).toBe(true);
  expect(chips.slice(1).every(node => !node.props.captain)).toBe(true);
  expect(nodes(expand(tree)).filter(node => node.type === 'Avatar').map(node => node.props.user.id)).toEqual(users.map(item => item.id));
  expect(nodes(expand(tree)).every(node => flat(node.props.style).flexDirection !== 'row-reverse')).toBe(true);
  expect(JSON.stringify(members)).toBe(before);
});

test('two long names with the same first token remain distinct full two-line labels and accessible tap targets', () => {
  const onPress = jest.fn();
  const captain = { id: 'one', name: 'אלכסנדר אחד עשר כ' };
  const member = { id: 'two', name: 'אלכסנדר הארוך עשר לב' };
  const tree = expand(DraftTeamCard({ index: 0, captain, members: [member], onPressUser: onPress }));
  const labels = nodes(tree).filter(node => node.type === 'Text' && [captain.name, member.name].includes(copy(node)));
  expect(labels.map(node => copy(node))).toEqual([captain.name, member.name]);
  for (const label of labels) {
    expect(label.props).toMatchObject({ numberOfLines: 2, ellipsizeMode: 'tail', adjustsFontSizeToFit: true, minimumFontScale: 0.85 });
    expect(flat(label.props.style)).toMatchObject({ width: '100%', minHeight: 30, lineHeight: 15 });
  }
  const buttons = nodes(tree).filter(node => node.type === 'Pressable' && [captain.name, member.name].includes(node.props.accessibilityLabel));
  expect(buttons).toHaveLength(2); expect(buttons.every(node => flat(node.props.style).width >= 60)).toBe(true);
  buttons.forEach(node => node.props.onPress()); expect(onPress.mock.calls).toEqual([['one'], ['two']]);
});

test('growing members and a shrinking ghost retain order, identity and callback ownership', () => {
  const done = jest.fn();
  const tree = DraftTeamCard({ index: 1, captain: user(0), members: [user(1), user(2)], growMembers: true, ghostMember: user(3), onGhostDone: done });
  const roster = children(tree)[1] as any;
  expect(nodes(roster).filter(node => typeof node.type === 'function' && node.type.name === 'Chip').map(node => node.props.user.id)).toEqual(['p0', 'p1', 'p2', 'p3']);
  expect(nodes(roster).filter(node => node.type === 'GrowIn')).toHaveLength(2);
  const ghost = nodes(roster).find(node => node.type === 'ShrinkOut'); expect(ghost.props.onDone).toBe(done);
  expect(done).not.toHaveBeenCalled(); ghost.props.onDone(); expect(done).toHaveBeenCalledTimes(1);
});

test('the completion card remains a normal RTL row and preserves empty slots and chosen white identity', () => {
  const pick = jest.fn(), press = jest.fn();
  const tree = DraftTeamCard({ index: 2, colorKey: 'white', captain: user(0), members: [user(1)], completionCapacity: 4, onPickColor: pick, onPressUser: press });
  const all = nodes(tree);
  expect(copy(tree)).toContain('הלבנים'); expect(copy(tree)).toContain('2 מתוך 4');
  expect(all.filter(node => node.type === 'Avatar').map(node => node.props.user.id)).toEqual(['p0', 'p1']);
  expect(all.filter(node => node.type === 'Icon' && node.props.name === 'add-circle-outline')).toHaveLength(2);
  expect(all.every(node => flat(node.props.style).flexDirection !== 'row-reverse')).toBe(true);
  all.find(node => node.props.accessibilityLabel === 'בחר צבע קבוצה').props.onPress(); expect(pick).toHaveBeenCalledTimes(1);
  all.filter(node => node.type === 'Pressable' && node.props.disabled === false && !node.props.accessibilityLabel).forEach(node => node.props.onPress());
  expect(press.mock.calls).toEqual([['p0'], ['p1']]);
});
