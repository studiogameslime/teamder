import React from 'react';

// Real source control; callbacks and image sources are local adapters only.
jest.mock('react', () => {
  let slots: any[] = [], cursor = 0;
  return {
    ...jest.requireActual('react'),
    __runtime: { begin: () => { cursor = 0; }, reset: () => { slots = []; cursor = 0; } },
    useState: (initial: any) => { const i = cursor++; if (!slots[i]) slots[i] = { value: initial }; const s = slots[i]; return [s.value, (next: any) => { s.value = typeof next === 'function' ? next(s.value) : next; }]; },
    useRef: (initial: any) => { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
  };
});
jest.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View', ScrollView: 'ScrollView', Image: 'Image', ActivityIndicator: 'Spinner', StyleSheet: { create: (s: any) => s } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeArea' }));
jest.mock('@/components/SafeModal', () => ({ SafeModal: 'Modal' }));
jest.mock('@/components/anim/ChangeMotion', () => ({ ChangeMotion: 'Motion' }));
jest.mock('@/components/Button', () => ({ Button: 'Button' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/theme', () => ({ colors: {}, radius: {}, spacing: {}, typography: {}, RTL_LABEL_ALIGN: 'left' }));
jest.mock('@/data/coverImages', () => ({ COVER_IMAGES: [{ id: 'c01', source: 1 }, { id: 'c02', source: 2 }] }));

import { CoverImagePicker } from '@/components/community/CoverImagePicker';
import { he } from '@/i18n/he';
const runtime = (require('react') as any).__runtime;
const nodes = (tree: any): any[] => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(React.Children.toArray(tree.props?.children))];
const find = (tree: any, type: string) => nodes(tree).filter(node => node.type === type);
const gallery = (tree: any) => find(tree, 'Pressable').filter(n => find(n, 'Image').length > 0);
const upload = (tree: any) => find(tree, 'Pressable').find(n => n.props.accessibilityLabel === he.coverPickerUpload || find(n, 'Text').some(t => t.props.children === he.coverPickerUpload));
const props = () => ({ visible: true, selectedId: 'c01', hasUploadedPhoto: false, uploading: false, onSelectBuiltin: jest.fn(), onUploadFromDevice: jest.fn(), onClose: jest.fn() });
const draw = (p: ReturnType<typeof props>) => { runtime.begin(); return CoverImagePicker(p); };
const dismiss = (tree: any) => { find(tree, 'Modal')[0].props.onRequestClose(); find(tree, 'Pressable')[0].props.onPress(); };
function deferred() { let resolve!: () => void, reject!: (e: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { runtime.reset(); jest.clearAllMocks(); });

test('pending local upload cannot compete with a later builtin selection from the old tree', async () => {
  const p = props(), request = deferred(), events: string[] = [];
  p.onUploadFromDevice.mockImplementation(async () => { events.push('upload started'); await request.promise; events.push('upload finished'); });
  p.onSelectBuiltin.mockImplementation(id => events.push('gallery ' + id));
  const idle = draw(p), pending = upload(idle).props.onPress();
  gallery(idle)[1].props.onPress();
  request.resolve(); await pending;
  expect(events).toEqual(['upload started', 'upload finished']);
  expect(p.onSelectBuiltin).not.toHaveBeenCalled();
});

test('upload starts a synchronous lock for stale close callbacks and a duplicate upload', async () => {
  const p = props(), request = deferred(); p.onUploadFromDevice.mockReturnValueOnce(request.promise);
  const idle = draw(p), pending = upload(idle).props.onPress();
  dismiss(idle); await upload(idle).props.onPress();
  const busy = draw(p);
  expect(p.onClose).not.toHaveBeenCalled(); expect(p.onUploadFromDevice).toHaveBeenCalledTimes(1);
  expect(gallery(busy).every(n => n.props.disabled)).toBe(true);
  expect(find(busy, 'Pressable')[0].props.disabled).toBe(true);
  expect(upload(busy).props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  request.resolve(); await pending; dismiss(draw(p)); expect(p.onClose).toHaveBeenCalledTimes(2);
});

test('external uploading blocks stale gallery, close and upload callbacks until its own flag clears', async () => {
  const p = props(), idle = draw(p); p.uploading = true; draw(p);
  dismiss(idle); gallery(idle)[1].props.onPress(); await upload(idle).props.onPress();
  expect(p.onClose).not.toHaveBeenCalled(); expect(p.onSelectBuiltin).not.toHaveBeenCalled(); expect(p.onUploadFromDevice).not.toHaveBeenCalled();
  p.uploading = false; gallery(draw(p))[1].props.onPress(); expect(p.onSelectBuiltin).toHaveBeenCalledWith('c02');
});

test('a rejected upload preserves the selected builtin and releases retry and dismissal', async () => {
  const p = props(), request = deferred(); p.onUploadFromDevice.mockReturnValueOnce(request.promise);
  const pending = upload(draw(p)).props.onPress(); request.reject(new Error('local upload failed'));
  await expect(pending).rejects.toThrow('local upload failed');
  const released = draw(p);
  expect(gallery(released)[0].props.accessibilityState).toMatchObject({ selected: true, disabled: false });
  await upload(released).props.onPress(); expect(p.onUploadFromDevice).toHaveBeenCalledTimes(2);
  dismiss(draw(p)); expect(p.onClose).toHaveBeenCalledTimes(2);
});

test('a synchronous callback is supported and does not release an independent external upload', async () => {
  const p = props(), request = deferred(); p.onUploadFromDevice.mockReturnValueOnce(request.promise);
  const pending = upload(draw(p)).props.onPress(); p.uploading = true; draw(p); request.resolve(); await pending;
  dismiss(draw(p)); expect(p.onClose).not.toHaveBeenCalled();
  p.uploading = false; await upload(draw(p)).props.onPress();
  expect(p.onUploadFromDevice).toHaveBeenCalledTimes(2); dismiss(draw(p)); expect(p.onClose).toHaveBeenCalledTimes(2);
});

test('gallery options have distinct names, selected state and one accessible target per image', () => {
  const p = props(); let tree = draw(p);
  const options = gallery(tree);
  expect(options.map(n => n.props.accessibilityLabel)).toEqual(['תמונת שער 1', 'תמונת שער 2']);
  expect(options.map(n => n.props.accessibilityRole)).toEqual(['button', 'button']);
  expect(options.map(n => n.props.accessibilityState.selected)).toEqual([true, false]);
  expect(options.every(n => find(n, 'Image')[0].props.accessible === false)).toBe(true);
  p.hasUploadedPhoto = true; tree = draw(p);
  expect(gallery(tree).every(n => !n.props.accessibilityState.selected)).toBe(true);
});
