import React from 'react';
jest.mock('react-native', () => ({ Pressable: 'Pressable', View: 'View', Text: 'Text', StyleSheet: { create: (v: unknown) => v } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/theme', () => ({ colors: { primary: '#2563EB' } }));
import { PlayerRecruitmentActions } from '@/components/match/PlayerRecruitmentActions';

const nodes = (n: any): any[] => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
test('only granted actions render and each invokes the matching existing flow', () => {
  const members = jest.fn(), available = jest.fn(), guest = jest.fn();
  const buttons = nodes(PlayerRecruitmentActions({ onAddMembers: members, onInviteAvailable: available, onAddGuest: guest })).filter(n => n.type === 'Pressable');
  expect(buttons.map(n => n.props.accessibilityLabel)).toEqual(['צרף חברים מהמועדון', 'הזמן שחקנים זמינים מהאפליקציה', 'הוסף אורח']);
  buttons[1].props.onPress(); expect(available).toHaveBeenCalledTimes(1); expect(members).not.toHaveBeenCalled(); expect(guest).not.toHaveBeenCalled();
  buttons[0].props.onPress(); buttons[2].props.onPress(); expect(members).toHaveBeenCalledTimes(1); expect(guest).toHaveBeenCalledTimes(1);
});
test('a guest-only permission exposes no admin action or empty separators', () => {
  const buttons = nodes(PlayerRecruitmentActions({ onAddGuest: jest.fn() })).filter(n => n.type === 'Pressable');
  expect(buttons).toHaveLength(1); expect(buttons[0].props.accessibilityLabel).toBe('הוסף אורח');
  expect(buttons[0].props.style({ pressed: false }).filter(Boolean)).toHaveLength(1);
});
test('a read-only viewer has no empty toolbar', () => { expect(PlayerRecruitmentActions({})).toBeNull(); });
