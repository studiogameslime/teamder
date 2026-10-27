import * as providers from '../../src/utils/activityProviders';
import React from 'react';
import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

const nodes = (n: any): any[] => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
const copy = (n: any): string => n == null || n === false ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(copy).join(' ') : copy(n.props?.children);
function screen(selectedSourceId: string | null = 'hc', sources?: any[]) {
  const state = { status: 'available', metrics: { steps: 0 }, sourceLabel: 'מקור נבחר', periodLabel: 'היום', refreshing: false,
    lastUpdatedLabel: null, error: null, selectedSourceId, selectedDay: '2026-10-26', canPreviousDay: true, canNextDay: false, previousDay: jest.fn(), nextDay: jest.fn(),
    sources: sources ?? [{ id: 'hc', sourceId: 'com.google.android.apps.fitness', kind: 'health-connect', label: 'בריאות הטלפון', detail: 'מקור א' }, { id: 'wear', sourceId: 'watch', kind: 'wear-health-services', label: 'השעון שלי', detail: 'מקור ב' }],
    refresh: jest.fn(), connect: jest.fn(), selectSource: jest.fn(), disconnect: jest.fn() };
  const exports: any = {}; const slots: any[] = []; let slot = 0;
  const fakeReact = { ...React, useState: (initial: any) => { const i = slot++; if (!(i in slots)) slots[i] = initial; return [slots[i], (v: any) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; }, useEffect: () => {} };
  const imports: any = { '@/config/sportsActivity': { SPORTS_ACTIVITY_ENABLED: true }, '@/components/SafeModal': { SafeModal: 'Modal' }, '@/utils/errorObservation': { observeCaughtError: jest.fn() }, '@/utils/activityProviders': providers, '@/components/activity/ActivityProviderIcon': { ActivityProviderIcon: 'Brand' }, react: fakeReact, 'react-native': { Modal: 'Modal', ActivityIndicator: 'Spinner', Linking: { openURL: jest.fn() }, View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: (v: any) => v } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '@expo/vector-icons': { Ionicons: 'Icon' },
    '@/components/ScreenHeader': { ScreenHeader: 'Header' }, '@/components/ScrollSurface': { ScrollSurface: 'Scroll' },
    '@/components/activity/MyActivityDashboard': { MyActivityDashboard: 'Dashboard', activityIsolate: (s: string) => s },
    '@/components/activity/PhoneActivityTest': { PhoneActivityTest: 'PhoneTest' },
    '@/services/phoneActivity': { phoneMeasurementAvailable: true },
    '@/theme/rtl': { RTL_LABEL_ALIGN: 'left' }, '@/services/useMyActivity': { useMyActivity: () => state } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/screens/profile/MyActivityScreen.tsx', 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, require: (id: string) => { if (!(id in imports)) throw Error(id); return imports[id]; } });
  return { state, render: () => { slot = 0; return exports.EnabledMyActivityScreen(); } };
}

test.each(['ProfileStack', 'GameStack', 'CommunitiesStack', 'ChatStack'])('activity is registered in every summary host: %s', name => {
  const source = fs.readFileSync(`src/navigation/${name}.tsx`, 'utf8');
  expect(source).toMatch(/name="EveningSummary"/);
  expect(source).toMatch(/name="MyActivity" component=\{MyActivityScreen\}/);
  expect(source).toContain("import { MyActivityScreen } from '@/screens/profile/MyActivityScreen'");
  if (name !== 'ChatStack') expect(source).toContain('MyActivity: undefined;');
  else expect(source).toContain('ChatStackParamList = CommunitiesStackParamList');
});

test('home menu navigates to activity and Android gates the menu entry', () => {
  const source = fs.readFileSync('src/screens/tabs/ProfileScreen.tsx', 'utf8');
  expect(source).toMatch(/Platform.OS === 'android' \? \[\{ id: 'my-activity'.*nav.navigate\('MyActivity'\)/);
});


test('dashboard shows the named source without identifiers and opens explicit app selection', () => {
  const f = screen(); let tree = f.render();
  expect(copy(tree)).toContain('גוגל פיט'); expect(copy(tree)).not.toContain('com.google');
  const dashboard = nodes(tree).find(n => n.type === 'Dashboard');
  expect(dashboard.props.metrics).toBe(f.state.metrics); expect(dashboard.props.scope).toBe('day');
  nodes(tree).find(n => n.props.accessibilityLabel === 'ניהול החיבור אל גוגל פיט').props.onPress();
  tree = f.render(); expect(nodes(tree).some(n => n.type === 'Modal' && n.props.visible)).toBe(true);
  expect(f.state.connect).not.toHaveBeenCalled(); expect(f.state.selectSource).not.toHaveBeenCalled();
});
test('choosing an app opens its detail; only approval invokes that app connection', () => {
  const f = screen(null, []); let tree = f.render();
  nodes(tree).find(n => n.props.accessibilityLabel === 'בחירת אפליקציה לסנכרון').props.onPress(); tree = f.render();
  nodes(tree).find(n => n.type === 'Pressable' && copy(n).includes('גוגל פיט')).props.onPress(); tree = f.render();
  expect(copy(tree)).toContain('הנתונים נשמרים בחשבון הפרטי שלך'); expect(f.state.connect).not.toHaveBeenCalled();
  nodes(tree).find(n => n.type === 'Pressable' && copy(n) === 'אישור וחיבור').props.onPress();
  expect(f.state.connect).toHaveBeenCalledWith('com.google.android.apps.fitness', true);
});
test('day controls retain allowed calendar navigation', () => {
  const f = screen(), tree = f.render();
  const previous = nodes(tree).find(n => n.props.accessibilityLabel === 'היום הקודם');
  expect(previous.props.disabled).toBe(false); previous.props.onPress(); expect(f.state.previousDay).toHaveBeenCalledTimes(1);
  expect(nodes(tree).find(n => n.props.accessibilityLabel === 'היום הבא').props.disabled).toBe(true);
});

test('phone test opens separately and does not change the daily source', () => {
  const f = screen(); let tree = f.render();
  nodes(tree).find(n => n.type === 'Pressable' && copy(n).includes('בדיקת מדידה בטלפון')).props.onPress();
  tree = f.render(); const test = nodes(tree).find(n => n.type === 'PhoneTest');
  expect(test).toBeDefined(); expect(f.state.connect).not.toHaveBeenCalled(); expect(f.state.selectSource).not.toHaveBeenCalled();
  test.props.onClose(); expect(nodes(f.render()).some(n => n.type === 'PhoneTest')).toBe(false);
});
