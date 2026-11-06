import React from 'react';

// Run the real form and leave guard with deterministic hooks. Native controls,
// navigation and persistence are substitutes; no club or account is written.
jest.mock('react', () => {
  let slots: any[] = [], index = 0, pending: Array<() => void> = [];
  const same = (a?: any[], b?: any[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks: any = {
    ...jest.requireActual('react'),
    __runtime: {
      begin: () => { index = 0; },
      effects: () => { const current = pending; pending = []; current.forEach(effect => effect()); },
      reset: () => { slots.forEach(slot => slot?.cleanup?.()); slots = []; index = 0; pending = []; },
    },
    useState: (initial: any) => {
      const slot = index++;
      if (!slots[slot]) slots[slot] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[slot].value, (next: any) => { slots[slot].value = typeof next === 'function' ? next(slots[slot].value) : next; }];
    },
    useRef: (initial: any) => { const slot = index++; return slots[slot] ?? (slots[slot] = { current: initial }); },
    useMemo: (callback: any, deps: any[]) => { const slot = index++; if (!same(slots[slot]?.deps, deps)) slots[slot] = { deps, value: callback() }; return slots[slot].value; },
    useCallback: (callback: any, deps: any[]) => hooks.useMemo(() => callback, deps),
    useEffect: (effect: any, deps: any[]) => {
      const slot = index++;
      if (!same(slots[slot]?.deps, deps)) {
        const previous = slots[slot]; slots[slot] = { deps };
        pending.push(() => { previous?.cleanup?.(); slots[slot].cleanup = effect(); });
      }
    },
  };
  return hooks;
});
const mockBeforeRemove = new Map<string, (event: any) => void>();
const mockNavigation = {
  addListener: jest.fn((event: string, handler: (event: any) => void) => { mockBeforeRemove.set(event, handler); return () => mockBeforeRemove.delete(event); }),
  dispatch: jest.fn(),
};
let mockTabGuard: any;
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('@/navigation/tabLeaveGuard', () => ({ registerTabLeaveGuard: (guard: any) => { mockTabGuard = guard; return () => { mockTabGuard = undefined; }; } }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' }, Linking: {}, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: (value: any) => value }, Animated: { View: 'AnimatedView', Value: class { setValue = jest.fn(); }, timing: () => ({ start: jest.fn() }) } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('@/components/SafeKeyboardAvoidingView', () => ({ SafeKeyboardAvoidingView: 'KeyboardAvoidingView' }));
jest.mock('@/components/anim/BallSwitch', () => ({ BallSwitch: 'BallSwitch' }));
jest.mock('@/components/AppDialog', () => ({ appAlert: jest.fn() }));
jest.mock('@/components/ScreenHeader', () => ({ ScreenHeader: 'Header' }));
jest.mock('@/components/Button', () => ({ Button: 'Button' }));
jest.mock('@/components/InputField', () => ({ InputField: 'Input' }));
jest.mock('@/components/FormSectionHeader', () => ({ FormSectionHeader: 'SectionHeader' }));
jest.mock('@/components/AutocompleteInput', () => ({ AutocompleteInput: 'Autocomplete' }));
jest.mock('@/components/InfoTip', () => ({ InfoTip: 'InfoTip' }));
jest.mock('@/components/forms/FormDesign', () => ({ FormDesignContext: { Provider: 'FormProvider' }, FormIntro: 'FormIntro', FormProgress: 'Progress', FormSections: 'Sections', FormStandalone: 'Standalone', FORM_BG: '#fff', FORM_BLUE: '#143f80' }));
jest.mock('@/components/community/RichRulesInput', () => ({ RichRulesInput: 'RulesInput' }));
jest.mock('@/components/community/NewClubSeasons', () => ({ NewClubSeasons: 'Seasons', NEW_CLUB_SEASONS_DEFAULT: {} }));
jest.mock('@/components/SafeModal', () => ({ SafeModal: 'Modal' }));
jest.mock('@/components/anim/SpringSheet', () => ({ SpringSheet: 'Sheet' }));
jest.mock('@/components/RuleTagsInput', () => ({ RuleTagsInput: 'RuleTags' }));
jest.mock('@/components/DateTimeFields', () => ({ AppDateTimeField: 'DateTimeField' }));
jest.mock('@/components/ConfirmDialog', () => ({ ConfirmDialog: 'ConfirmDialog' }));
jest.mock('@/components/games/RoundReviewSheet', () => ({ RoundReviewSheet: 'RoundReview' }));
jest.mock('@/components/games/FriendsInvitePicker', () => ({ FriendsInvitePicker: 'FriendPicker' }));
jest.mock('@/components/games/LocationSearchSheet', () => ({ LocationSearchSheet: 'LocationPicker' }));
jest.mock('@/components/games/FormatStepper', () => ({ FormatStepper: 'FormatStepper' }));
jest.mock('@/services/geocodeService', () => ({ reverseGeocodeCity: jest.fn() }));
jest.mock('@/utils/haptics', () => ({ lightHaptic: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/hooks/useSupportStep', () => ({ useSupportStep: jest.fn() }));
jest.mock('@/services/analyticsService', () => ({ AnalyticsEvent: {}, logEvent: jest.fn() }));
jest.mock('@/services/israelLocationService', () => ({ searchCities: jest.fn() }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));
jest.mock('@/theme', () => ({ colors: {}, radius: {}, spacing: {}, typography: {}, shadows: {}, RTL_LABEL_ALIGN: 'left' }));

import { GroupWizardForm, EMPTY_GROUP_FORM_VALUES, type GroupFormValues } from '@/screens/groups/GroupWizardForm';
import { GameWizardForm, type GameFormValues } from '@/screens/games/GameWizardForm';
import { appAlert } from '@/components/AppDialog';
import { he } from '@/i18n/he';
const runtime = (require('react') as any).__runtime;
const alert = appAlert as jest.Mock;
const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
const control = (tree: any, type: string, label: string) => nodes(tree).find(node => node.type === type && (node.props.label === label || node.props.title === label));

function fixture() {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  const initial: GroupFormValues = { ...EMPTY_GROUP_FORM_VALUES, name: 'מועדון חמישי', city: 'חיפה', description: 'טיוטה מקורית' };
  const render = () => {
    runtime.begin();
    const tree = GroupWizardForm({ headerTitle: 'עריכת מועדון', submitLabel: 'שמירת מועדון', initial, onSubmit, enableUnsavedGuard: true });
    runtime.effects();
    return tree;
  };
  const change = (field: 'name' | 'city' | 'contactPhone' | 'description', value: string) => {
    const labels = { name: he.groupCreateName, city: he.createGroupCity, contactPhone: he.createGroupContactPhone, description: he.createGroupDescription };
    const input = control(render(), field === 'city' ? 'Autocomplete' : 'Input', labels[field]);
    if (!input) throw new Error(`Missing field ${field}`);
    (field === 'city' ? input.props.onChange : input.props.onChangeText)(value);
    return render();
  };
  const leaveAndSave = async (kind: 'back' | 'tab' = 'back') => {
    if (kind === 'back') mockBeforeRemove.get('beforeRemove')!({ preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } });
    else mockTabGuard.confirmLeave(mockNavigation.dispatch);
    const options = alert.mock.calls[alert.mock.calls.length - 1][2];
    await options.find((option: any) => option.text === he.profileEditUnsavedSave).onPress();
  };
  return { onSubmit, initial, render, change, leaveAndSave };
}
beforeEach(() => { runtime.reset(); mockBeforeRemove.clear(); jest.clearAllMocks(); jest.useFakeTimers(); (globalThis as any).__DEV__ = false; });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test.each([
  ['name', '  '],
  ['city', '  '],
  ['contactPhone', '12'],
] as const)('save from back warning validates the current %s and keeps the invalid draft', async (field, value) => {
  const f = fixture(); f.render(); f.change(field, value);
  await f.leaveAndSave();
  expect(f.onSubmit).not.toHaveBeenCalled();
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  expect(mockTabGuard.isDirty()).toBe(true);
  const tree = f.render();
  expect(control(tree, 'Button', he.wizardStepNext).props.disabled).toBe(true);
  const labels = { name: he.groupCreateName, city: he.createGroupCity, contactPhone: he.createGroupContactPhone };
  expect(control(tree, field === 'city' ? 'Autocomplete' : 'Input', labels[field]).props.value).toBe(value);
  expect(nodes(tree).find(node => node.type === 'Progress').props.current).toBe(1);
});

test('the tab-leave warning applies the same validation and keeps the draft dirty', async () => {
  const f = fixture(); f.render(); f.change('name', '');
  await f.leaveAndSave('tab');
  expect(f.onSubmit).not.toHaveBeenCalled();
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  expect(mockTabGuard.isDirty()).toBe(true);
});

test('save from a warning submits the current valid edits rather than the initial values', async () => {
  const f = fixture(); f.render(); f.change('name', 'מועדון מעודכן'); f.change('city', 'תל אביב');
  await f.leaveAndSave();
  expect(f.onSubmit).toHaveBeenCalledTimes(1);
  expect(f.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'מועדון מעודכן', city: 'תל אביב' }));
});

test.each(['', '   ', '050-1234567', '+972501234567'])('an optional or valid phone %s remains saveable from the warning', async phone => {
  const f = fixture(); f.render(); f.change('description', 'טיוטה חדשה'); f.change('contactPhone', phone);
  await f.leaveAndSave();
  expect(f.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ description: 'טיוטה חדשה', contactPhone: phone }));
});

test('the regular wizard button still saves the current valid draft with the same path', async () => {
  const f = fixture(); f.render(); f.change('description', 'טיוטה חדשה');
  control(f.render(), 'Button', he.wizardStepNext).props.onPress();
  await control(f.render(), 'Button', 'שמירת מועדון').props.onPress();
  expect(f.onSubmit).toHaveBeenCalledTimes(1);
  expect(f.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ description: 'טיוטה חדשה' }));
  // A parent may decline saving (for example, dirty independent season
  // settings) and resolve without navigating. The local draft must stay guarded.
  expect(mockTabGuard.isDirty()).toBe(true);
});

test('repeated save callbacks cannot begin a second submission while one is pending', async () => {
  const f = fixture(); f.render(); f.change('description', 'טיוטה חדשה');
  let resolve!: () => void;
  f.onSubmit.mockReturnValue(new Promise<void>(done => { resolve = done; }));
  const first = f.leaveAndSave();
  const second = f.leaveAndSave();
  expect(f.onSubmit).toHaveBeenCalledTimes(1);
  resolve(); await Promise.all([first, second]);
  expect(mockTabGuard.isDirty()).toBe(true);
});

test('a failed save from the warning keeps the latest edits guarded and reports the regular form error', async () => {
  const f = fixture(); f.render(); f.change('name', 'מועדון מעודכן');
  f.onSubmit.mockRejectedValue(new Error('local persistence substitute failed'));
  await f.leaveAndSave();
  expect(f.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'מועדון מעודכן' }));
  expect(mockTabGuard.isDirty()).toBe(true);
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  expect(alert).toHaveBeenLastCalledWith(he.error, he.groupWizardSubmitFailed);
  expect(control(f.render(), 'Input', he.groupCreateName).props.value).toBe('מועדון מעודכן');
});

function gameFixture(overrides: Partial<GameFormValues> = {}) {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  const initial = {
    title: 'מחזור חמישי', startsAt: Date.now() + 24 * 60 * 60 * 1000,
    fieldName: 'מגרש הדגמה', city: 'חיפה', cityFromList: true, fieldAddress: '',
    format: '5v5', numberOfTeams: 2, matchDurationMinutes: '10', advancedMode: true,
    advancedFillMode: 'permanent', advancedTieMode: 'bothOut', ruleTags: [], visibility: 'community',
    requiresApproval: false, waitlistApprovalRequired: true, waitlistApprovalTimeout: '30',
    recurringGameEnabled: false, scheduledRegEnabled: false, registrationOpensAt: 0,
    publicOpenAt: 0, guestsOpenAt: 0, autoTeamsAt: 0, acceptsFillers: false,
    fillerMinTrust: 0, notes: '', bringBall: false, bringShirts: false, ...overrides,
  } as GameFormValues;
  const render = () => {
    runtime.begin();
    const tree = GameWizardForm({ headerTitle: 'עריכת מחזור', submitLabel: 'שמירת מחזור', initial, onSubmit, isEdit: true, enableUnsavedGuard: true, internalRating: true });
    runtime.effects(); return tree;
  };
  const change = (key: keyof GameFormValues, value: any) => {
    // Call the actual step's form adapter. This is a component test, not
    // a claim of typing or opening a native date picker.
    const step = nodes(render()).find(node => typeof node.type === 'function' && typeof node.props.set === 'function');
    step.props.set(key, value); return render();
  };
  const leaveAndSave = async () => {
    mockBeforeRemove.get('beforeRemove')!({ preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } });
    const options = alert.mock.calls[alert.mock.calls.length - 1][2];
    await options.find((option: any) => option.text === he.profileEditUnsavedSave).onPress();
  };
  return { onSubmit, initial, render, change, leaveAndSave };
}

test.each([
  ['missing registration time', { scheduledRegEnabled: true, registrationOpensAt: 0 }, he.wizardRegOpensRequired],
  ['registration after kickoff', { scheduledRegEnabled: true, registrationOpensAt: Date.now() + 48 * 60 * 60 * 1000 }, he.wizardRegOpensMustBeBeforeKickoff],
  ['auto teams after kickoff', { autoTeamsAt: Date.now() + 48 * 60 * 60 * 1000 }, he.wizardAutoTeamsBeforeKickoff],
])('game warning blocks %s with the regular schedule validator', async (_label, overrides, errorText) => {
  const f = gameFixture(overrides as Partial<GameFormValues>); f.render(); f.change('notes', 'טיוטה חדשה');
  await f.leaveAndSave();
  expect(f.onSubmit).not.toHaveBeenCalled(); expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  expect(alert).toHaveBeenLastCalledWith(he.error, errorText);
  const tree = f.render();
  expect(nodes(tree).find(node => node.type === 'Progress').props.current).toBe(3);
  expect(mockTabGuard.isDirty()).toBe(true);
});

test('game warning blocks a newly moved auto-team time in the past', async () => {
  const f = gameFixture(); f.render(); f.change('autoTeamsAt', Date.now() - 1000);
  await f.leaveAndSave();
  expect(f.onSubmit).not.toHaveBeenCalled(); expect(alert).toHaveBeenLastCalledWith(he.error, he.wizardAutoTeamsInPast);
});

test('game warning preserves the existing allowance for an unchanged past auto-team time', async () => {
  const f = gameFixture({ autoTeamsAt: Date.now() - 1000 }); f.render(); f.change('notes', 'טיוטה חדשה');
  await f.leaveAndSave();
  expect(f.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ notes: 'טיוטה חדשה', autoTeamsAt: f.initial.autoTeamsAt }));
});

test('game warning returns to the required location field without dropping an invalid draft', async () => {
  const f = gameFixture(); f.render(); f.change('fieldName', '  ');
  await f.leaveAndSave();
  expect(f.onSubmit).not.toHaveBeenCalled();
  const tree = f.render();
  expect(nodes(tree).find(node => node.type === 'Progress').props.current).toBe(1);
  expect(control(tree, 'Button', he.wizardStepNext).props.disabled).toBe(true);
  expect(nodes(tree).find(node => typeof node.props.set === 'function').props.values.fieldName).toBe('  ');
});

test('game warning retains the soft short-registration confirmation before submitting current edits', async () => {
  const f = gameFixture({ scheduledRegEnabled: true, registrationOpensAt: Date.now() + 23 * 60 * 60 * 1000 });
  f.render(); f.change('notes', 'טיוטה חדשה'); await f.leaveAndSave();
  expect(f.onSubmit).not.toHaveBeenCalled();
  const warning = nodes(f.render()).find(node => node.type === 'ConfirmDialog');
  expect(warning.props.visible).toBe(true);
  warning.props.onConfirm(); await Promise.resolve();
  expect(f.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ notes: 'טיוטה חדשה' }));
});

test('confirming a soft warning rechecks a newly scheduled auto-team time that expired while the dialog was open', async () => {
  const f = gameFixture({ scheduledRegEnabled: true, registrationOpensAt: Date.now() + 23 * 60 * 60 * 1000 });
  f.render(); f.change('autoTeamsAt', Date.now() + 60 * 1000); await f.leaveAndSave();
  const warning = nodes(f.render()).find(node => node.type === 'ConfirmDialog');
  expect(warning.props.visible).toBe(true);
  jest.advanceTimersByTime(61 * 1000); warning.props.onConfirm(); await Promise.resolve();
  expect(f.onSubmit).not.toHaveBeenCalled();
  expect(alert).toHaveBeenLastCalledWith(he.error, he.wizardAutoTeamsInPast);
});

test.each(['club', 'game'])('%s lets onSubmit navigate through beforeRemove while the intentional save is in progress', async kind => {
  const f: any = kind === 'club' ? fixture() : gameFixture();
  f.render(); f.change(kind === 'club' ? 'description' : 'notes', 'טיוטה חדשה');
  const preventDefault = jest.fn();
  f.onSubmit.mockImplementation(async () => {
    await Promise.resolve();
    // CommunityEdit/GameEdit dispatch their replacement while their submit
    // promise is still active. The real guard must let this event through.
    mockBeforeRemove.get('beforeRemove')!({ preventDefault, data: { action: { type: 'REPLACE' } } });
  });
  await f.leaveAndSave();
  expect(f.onSubmit).toHaveBeenCalledTimes(1);
  expect(preventDefault).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledTimes(1); // the original exit prompt only
});

test.each(['club', 'game'])('%s rearms the guard and allows retry when a parent catches failure and resolves without navigation', async kind => {
  const f: any = kind === 'club' ? fixture() : gameFixture();
  f.render(); f.change(kind === 'club' ? 'description' : 'notes', 'טיוטה חדשה');
  f.onSubmit.mockImplementation(async () => {
    try { await Promise.reject(new Error('parent-handled local failure')); } catch { /* mirrors a host which reports and returns */ }
  });
  await f.leaveAndSave();
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  expect(mockTabGuard.isDirty()).toBe(true);
  await f.leaveAndSave();
  expect(f.onSubmit).toHaveBeenCalledTimes(2);
  expect(mockTabGuard.isDirty()).toBe(true);
});
