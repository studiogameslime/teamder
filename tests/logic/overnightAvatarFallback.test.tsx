import React from 'react';

// Retain hook state by component identity and React key. The native Image
// adapter exposes onError so real source transitions can be exercised.
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  const instances = new Map<string, { slots: any[]; cursor: number }>();
  let active: { slots: any[]; cursor: number } | null = null;
  let effects: Array<() => void> = [];
  const same = (a?: any[], b?: any[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  return {
    ...actual,
    useState: (initial: any) => {
      const instance = active!, i = instance.cursor++;
      if (!instance.slots[i]) instance.slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = instance.slots[i];
      return [slot.value, (next: any) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useRef: (initial: any) => {
      const instance = active!, i = instance.cursor++;
      return instance.slots[i] ?? (instance.slots[i] = { current: initial });
    },
    useEffect: (effect: any, deps?: any[]) => {
      const instance = active!, i = instance.cursor++;
      if (same(instance.slots[i]?.deps, deps)) return;
      const previous = instance.slots[i], next: any = { deps }; instance.slots[i] = next;
      effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
    },
    __runtime: {
      reset: () => { instances.forEach(instance => instance.slots.forEach(slot => slot?.cleanup?.())); instances.clear(); effects = []; active = null; },
      render: (root: any) => {
        const seen = new Set<string>();
        const expand = (node: any, path: string): any => {
          if (Array.isArray(node)) return node.map((child, i) => expand(child, `${path}/${i}`));
          if (!node || typeof node !== 'object') return node;
          if (typeof node.type === 'function') {
            const id = `${path}/${node.type.name}:${node.key ?? ''}`;
            seen.add(id);
            let instance = instances.get(id);
            if (!instance) { instance = { slots: [], cursor: 0 }; instances.set(id, instance); }
            instance.cursor = 0; const previous = active; active = instance;
            const result = node.type(node.props); active = previous;
            return expand(result, id);
          }
          return { ...node, props: { ...node.props, children: expand(node.props?.children, `${path}/children`) } };
        };
        const tree = expand(root, 'root');
        for (const [id, instance] of instances) if (!seen.has(id)) {
          instance.slots.forEach(slot => slot?.cleanup?.()); instances.delete(id);
        }
        const pending = effects; effects = []; pending.forEach(effect => effect());
        return tree;
      },
    },
  };
});
jest.mock('react-native', () => ({ Image: 'Image', View: 'View', Text: 'Text', StyleSheet: { create: (styles: any) => styles } }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: 'AnimatedView' },
  useSharedValue: (value: any) => require('react').useRef({ value }).current,
  useAnimatedStyle: (fn: any) => fn(),
  cancelAnimation: jest.fn(), Easing: { inOut: (value: any) => value, quad: 1 },
  withRepeat: jest.fn(), withSequence: jest.fn(), withTiming: jest.fn(),
}));
jest.mock('@/theme', () => ({ colors: { primary: '#1E40AF', primaryLight: '#DBEAFE' }, radius: { pill: 999 } }));
jest.mock('@/data/avatars', () => ({ getAvatarById: (id: string) => id === 'built' ? { id, source: 'bundled-image' } : undefined }));

import { Avatar } from '@/components/Avatar';

const runtime = (require('react') as any).__runtime;
const draw = (props: React.ComponentProps<typeof Avatar>) => runtime.render(React.createElement(Avatar, props));
const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const images = (tree: any) => nodes(tree).filter(node => node.type === 'Image');
const initials = (tree: any) => nodes(tree).filter(node => node.type === 'Text').map(node => node.props.children).join('');
const style = (value: any): any => Array.isArray(value) ? Object.assign({}, ...value.map(style)) : value ?? {};

beforeEach(() => { runtime.reset(); jest.clearAllMocks(); });
afterEach(() => runtime.reset());

test('a failed network image becomes the existing name fallback without changing ring or inner dimensions', () => {
  const p = { name: 'רועי', uri: 'https://example.test/a.jpg', size: 64, showRing: true };
  let tree = draw(p); expect(images(tree)[0].props.source).toEqual({ uri: p.uri });
  expect(images(tree)[0].props.resizeMethod).toBe('resize');
  images(tree)[0].props.onError(); tree = draw(p);
  expect(images(tree)).toHaveLength(0); expect(initials(tree)).toBe('ר');
  expect(style(tree.props.style)).toMatchObject({ width: 64, height: 64, padding: 2 });
  expect(style(nodes(tree).find(node => node.type === 'View').props.style)).toMatchObject({ width: 60, height: 60, backgroundColor: '#DBEAFE' });
});

test('changing a failed URI starts a fresh request, and its own failure is handled independently', () => {
  const p = { name: 'רועי', uri: 'https://example.test/a.jpg' };
  images(draw(p))[0].props.onError(); expect(initials(draw(p))).toBe('ר');
  p.uri = 'https://example.test/b.jpg'; let tree = draw(p);
  expect(images(tree)).toHaveLength(1); expect(images(tree)[0].props.source).toEqual({ uri: p.uri }); expect(initials(tree)).toBe('');
  images(tree)[0].props.onError(); tree = draw(p); expect(images(tree)).toHaveLength(0); expect(initials(tree)).toBe('ר');
});

test('a late error from an old image cannot fail a newer URI or a later attempt using the original URI', () => {
  const p = { name: 'רועי', uri: 'https://example.test/a.jpg' };
  const oldError = images(draw(p))[0].props.onError;
  p.uri = 'https://example.test/b.jpg'; draw(p); oldError();
  expect(images(draw(p))[0].props.source).toEqual({ uri: p.uri });
  p.uri = 'https://example.test/a.jpg'; draw(p); oldError();
  expect(images(draw(p))[0].props.source).toEqual({ uri: p.uri }); expect(initials(draw(p))).toBe('');
});

test('a bundled avatar retains precedence over any URI, including after the URI failed', () => {
  const p: React.ComponentProps<typeof Avatar> = { name: 'רועי', uri: 'https://example.test/a.jpg' };
  images(draw(p))[0].props.onError(); expect(initials(draw(p))).toBe('ר');
  p.avatarId = 'built'; const tree = draw(p);
  expect(images(tree)).toHaveLength(1); expect(images(tree)[0].props.source).toBe('bundled-image');
  expect(images(tree)[0].props.onError).toBeUndefined(); expect(initials(tree)).toBe('');
});

test('same-URI rerenders retain the fallback and update its name without retrying a broken image', () => {
  const p = { name: 'רועי', uri: 'https://example.test/a.jpg' };
  images(draw(p))[0].props.onError(); p.name = 'דני';
  for (let i = 0; i < 3; i++) { const tree = draw(p); expect(images(tree)).toHaveLength(0); expect(initials(tree)).toBe('ד'); }
});

test('missing/unknown bundled choices still use a supplied URI, and a removed URI uses the name fallback', () => {
  const p: React.ComponentProps<typeof Avatar> = { name: '🦊דני', avatarId: 'unknown', uri: 'https://example.test/a.jpg' };
  expect(images(draw(p))[0].props.source).toEqual({ uri: p.uri });
  p.uri = undefined; const tree = draw(p); expect(images(tree)).toHaveLength(0); expect(initials(tree)).toBe('🦊');
});
