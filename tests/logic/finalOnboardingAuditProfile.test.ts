import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function source(fileName: string) {
  return ts.createSourceFile(fileName, fs.readFileSync(fileName, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function expression(file: ts.SourceFile, name: string, context: object) {
  let value = '';
  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) value = node.initializer!.getText(file);
    ts.forEachChild(node, walk);
  };
  walk(file); if (!value) throw Error(`Missing actual handler ${name}`);
  return vm.runInNewContext(ts.transpileModule(`(${value})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}
const profile = source('src/screens/onboarding/PostSignInOnboardingScreen.tsx');
function setup() {
  const user = { id: 'owner', photoUrl: 'previous.jpg', name: 'שחקן' };
  let current: typeof user | null = user;
  const context: any = { user, canSave: true, busy: false, uploading: false, name: ' שם נבחר ', city: '', photoUrl: undefined, avatarId: 'a06',
    inFlight: { current: false }, mounted: { current: true }, prefilledRef: { current: true }, pendingKind: 'join_game',
    setBusy: jest.fn(), setUploading: jest.fn(), setPhotoUrl: jest.fn(), setAvatarId: jest.fn(),
    pickAndUploadAvatar: jest.fn(), deleteUserPhoto: jest.fn().mockResolvedValue(undefined),
    complete: jest.fn().mockResolvedValue(undefined), geocodeCity: jest.fn().mockResolvedValue(null),
    useUserStore: { getState: () => ({ currentUser: current }) },
    logEvent: jest.fn(), AnalyticsEvent: {}, appAlert: jest.fn(), he: {}, __DEV__: false, console,
  };
  context.isCurrentOwner = () => context.mounted.current && current?.id === user.id;
  return { c: context, run: (name: string) => expression(profile, name, context), switch: () => { current = { id: 'other', name: 'אחר', photoUrl: 'other.jpg' }; } };
}

test('choosing an avatar changes a draft without deleting the previously saved photo', () => {
  const { c, run } = setup(); run('handlePickAvatar')('a22');
  expect(c.setPhotoUrl).toHaveBeenCalledWith(undefined); expect(c.setAvatarId).toHaveBeenCalledWith('a22');
  expect(c.deleteUserPhoto).not.toHaveBeenCalled(); expect(c.complete).not.toHaveBeenCalled();
});
test('rapid save presses send one profile write and clean an old image only after success', async () => {
  const { c, run } = setup(); const save = run('handleSave');
  await Promise.all([save(), save()]);
  expect(c.complete).toHaveBeenCalledTimes(1);
  expect(c.complete).toHaveBeenCalledWith({ name: 'שם נבחר', avatarId: 'a06', photoUrl: undefined });
  expect(c.deleteUserPhoto).toHaveBeenCalledWith('owner');
  expect(c.complete.mock.invocationCallOrder[0]).toBeLessThan(c.deleteUserPhoto.mock.invocationCallOrder[0]);
});
test('a failed profile write leaves the image intact and unlocks retry without losing chosen values', async () => {
  const { c, run } = setup(); c.complete.mockRejectedValueOnce(Error('offline')); const save = run('handleSave');
  await save(); expect(c.deleteUserPhoto).not.toHaveBeenCalled(); expect(c.appAlert).toHaveBeenCalledTimes(1);
  expect(c.inFlight.current).toBe(false); await save(); expect(c.complete).toHaveBeenCalledTimes(2);
});
test('switching identity during city lookup never submits the old form to the next user', async () => {
  const s = setup(); s.c.city = 'עיר'; s.c.geocodeCity.mockImplementationOnce(async () => { s.switch(); return { lat: 1, lng: 2 }; });
  await s.run('handleSave')(); expect(s.c.complete).not.toHaveBeenCalled(); expect(s.c.deleteUserPhoto).not.toHaveBeenCalled();
});
test('switching identity while a save settles never deletes another session image or celebrates it', async () => {
  const s = setup(); s.c.complete.mockImplementationOnce(async () => { s.switch(); });
  await s.run('handleSave')(); expect(s.c.deleteUserPhoto).not.toHaveBeenCalled();
});
test('photo upload is locked before rerender and a result for a previous identity is ignored', async () => {
  const s = setup(); let finish!: (value: unknown) => void;
  s.c.pickAndUploadAvatar.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const upload = s.run('handlePickPhoto'); const pending = upload(); await upload();
  expect(s.c.pickAndUploadAvatar).toHaveBeenCalledTimes(1); s.switch(); finish({ ok: true, url: 'old-upload.jpg' }); await pending;
  expect(s.c.setPhotoUrl).not.toHaveBeenCalled(); expect(s.c.setAvatarId).not.toHaveBeenCalled();
});
test.each(['cancelled', 'permission'])('photo %s keeps the current picture and never saves', async reason => {
  const s = setup(); s.c.pickAndUploadAvatar.mockResolvedValue({ ok: false, reason }); await s.run('handlePickPhoto')();
  expect(s.c.setPhotoUrl).not.toHaveBeenCalled(); expect(s.c.deleteUserPhoto).not.toHaveBeenCalled(); expect(s.c.complete).not.toHaveBeenCalled();
});
test('upload rejecting after unmount cannot show an alert on the next screen', async () => {
  const s = setup(); s.c.pickAndUploadAvatar.mockImplementation(async () => { s.c.mounted.current = false; throw Error('native'); });
  await s.run('handlePickPhoto')(); expect(s.c.appAlert).not.toHaveBeenCalled();
});

test.each(['unknown', 'network', 'unavailable'])('photo failure %s surfaces a local actionable error without changing the draft', async reason => {
  const s = setup(); s.c.he = { error: 'שגיאה', profilePhotoUploadFailed: 'ההעלאה נכשלה', profilePhotoUnavailable: 'הגלריה אינה זמינה' };
  s.c.pickAndUploadAvatar.mockResolvedValue({ ok: false, reason }); await s.run('handlePickPhoto')();
  expect(s.c.appAlert).toHaveBeenCalledWith('שגיאה', reason === 'unavailable' ? 'הגלריה אינה זמינה' : 'ההעלאה נכשלה');
  expect(s.c.setPhotoUrl).not.toHaveBeenCalled(); expect(s.c.complete).not.toHaveBeenCalled();
});
test.each([['RESERVED_NAME', 'שם שמור'], ['EMAIL_NAME', 'כתובת אינה שם'], ['offline', 'שמירת הפרופיל נכשלה']])('profile validation %s explains the actual correction', async (message, expected) => {
  const s = setup(); s.c.he = { error: 'שגיאה', officialNameTaken: 'שם שמור', emailNameNotAllowed: 'כתובת אינה שם', profileSaveError: 'שמירת הפרופיל נכשלה' };
  s.c.complete.mockRejectedValue(Error(message)); await s.run('handleSave')();
  expect(s.c.appAlert).toHaveBeenCalledWith('שגיאה', expected); expect(s.c.deleteUserPhoto).not.toHaveBeenCalled();
});

const serviceFile = source('src/services/userService.ts');
function serviceContext() {
  let method = '';
  const walk = (node: ts.Node) => { if (ts.isMethodDeclaration(node) && node.name.getText(serviceFile) === 'completeOnboarding') method = node.getText(serviceFile); ts.forEachChild(node, walk); };
  walk(serviceFile); if (!method) throw Error('Missing actual service method');
  const auth = { currentUser: { uid: 'owner', isAnonymous: false } };
  const old = { id: 'owner', name: 'קודם', photoUrl: 'previous.jpg', onboardingCompleted: false };
  const context = { auth, USE_MOCK_DATA: false, sanitizeDisplayString: (value: string) => value.trim(), isReservedName: () => false, isEmailLikeName: () => false,
    getFirebase: () => ({ auth }), docs: { user: (id: string) => id }, updateDoc: jest.fn().mockResolvedValue(undefined),
    deleteField: () => 'DELETE_FIELD', cacheAuthUser: jest.fn().mockResolvedValue(undefined), logError: jest.fn(), mergeHomeCity: jest.fn(),
    StaleSessionError: class extends Error { constructor() { super('stale session'); this.name = 'StaleSessionError'; } },
  };
  const service = vm.runInNewContext(ts.transpileModule(`({ ${method} })`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  service.getCurrentUser = jest.fn().mockResolvedValue(old);
  return { service, c: context, old };
}
test('profile completion explicitly clears an omitted image value from both database and returned user', async () => {
  const { service, c, old } = serviceContext(); const next = await service.completeOnboarding({ name: 'חדש', avatarId: 'a22', photoUrl: undefined });
  expect(c.updateDoc).toHaveBeenCalledWith('owner', expect.objectContaining({ avatarId: 'a22', photoUrl: 'DELETE_FIELD', onboardingCompleted: true }));
  expect(next.photoUrl).toBeUndefined(); expect(c.cacheAuthUser).toHaveBeenCalledWith(next); expect(old.photoUrl).toBe('previous.jpg');
});
test('omitting the photo property altogether retains its saved value', async () => {
  const { service, c } = serviceContext(); const next = await service.completeOnboarding({ name: 'חדש' });
  expect(next.photoUrl).toBe('previous.jpg'); expect(c.updateDoc.mock.calls[0][1]).not.toHaveProperty('photoUrl');
});
test('profile save failure cannot cache a success or mutate the saved snapshot', async () => {
  const { service, c, old } = serviceContext(); c.updateDoc.mockRejectedValueOnce(Error('offline'));
  await expect(service.completeOnboarding({ name: 'חדש', photoUrl: undefined })).rejects.toThrow('offline');
  expect(c.cacheAuthUser).not.toHaveBeenCalled(); expect(old.photoUrl).toBe('previous.jpg');
});
test('an identity switch during profile read prevents a write on either account', async () => {
  const { service, c } = serviceContext(); service.getCurrentUser.mockImplementation(async () => { c.auth.currentUser = { uid: 'other', isAnonymous: false }; return { id: 'other' }; });
  await expect(service.completeOnboarding({ name: 'שם מהחשבון הקודם' })).rejects.toMatchObject({ name: 'StaleSessionError' });
  expect(c.updateDoc).not.toHaveBeenCalled(); expect(c.cacheAuthUser).not.toHaveBeenCalled();
});
test('an old write acknowledgement after identity switch is not cached as the current account', async () => {
  const { service, c } = serviceContext(); c.updateDoc.mockImplementation(async () => { c.auth.currentUser = { uid: 'other', isAnonymous: false }; });
  await expect(service.completeOnboarding({ name: 'חדש' })).rejects.toMatchObject({ name: 'StaleSessionError' });
  expect(c.cacheAuthUser).not.toHaveBeenCalled();
});

test('an already changed native identity is rejected against the form/store owner before reading', async () => {
  const { service, c } = serviceContext(); c.auth.currentUser = { uid: 'other', isAnonymous: false };
  await expect(service.completeOnboarding({ name: 'מהטופס הקודם' }, 'owner')).rejects.toMatchObject({ name: 'StaleSessionError' });
  expect(service.getCurrentUser).not.toHaveBeenCalled(); expect(c.updateDoc).not.toHaveBeenCalled();
});

test.each(['owner', 'different'])('the actual store method applies a completed profile only to its matching owner: %s', async finalOwner => {
  const storeFile = source('src/store/userStore.ts');
  let method = '';
  const walk = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(storeFile) === 'completePostSignInOnboarding') method = node.initializer.getText(storeFile);
    ts.forEachChild(node, walk);
  };
  walk(storeFile); if (!method) throw Error('Missing actual store handler');
  let current = { id: 'owner' }; const set = jest.fn(), completeOnboarding = jest.fn(async () => { current = { id: finalOwner }; return { id: 'owner', onboardingCompleted: true }; });
  const context = { get: () => ({ currentUser: current }), set, userService: { completeOnboarding }, logEvent: jest.fn(), AnalyticsEvent: {},
    StaleSessionError: class extends Error { constructor() { super('stale'); this.name = 'StaleSessionError'; } } };
  const handler = vm.runInNewContext(ts.transpileModule(`(${method})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  if (finalOwner === 'owner') { await handler({ name: 'שחקן' }); expect(set).toHaveBeenCalledWith({ currentUser: { id: 'owner', onboardingCompleted: true } }); }
  else { await expect(handler({ name: 'שחקן' })).rejects.toMatchObject({ name: 'StaleSessionError' }); expect(set).not.toHaveBeenCalled(); }
  expect(completeOnboarding).toHaveBeenCalledWith({ name: 'שחקן' }, 'owner');
});

test.each([false, true])('email sign-in resumes only after profile completion: %s', async complete => {
  const emailFile = source('src/screens/auth/EmailAuthScreen.tsx');
  const signInWithEmail = jest.fn().mockResolvedValue(undefined), signUpWithEmail = jest.fn(), finishParkedAction = jest.fn();
  const handler = expression(emailFile, 'submit', { canSubmit: true, inFlight: { current: false }, mode: 'signIn', email: 'account@example.test', password: 'password',
    signInWithEmail, signUpWithEmail, finishParkedAction, setBusy: jest.fn(), handleAuthError: jest.fn(), logEvent: jest.fn(), AnalyticsEvent: {},
    useUserStore: { getState: () => ({ hasCompletedOnboarding: () => complete }) } });
  await handler(); expect(signInWithEmail).toHaveBeenCalledTimes(1); expect(signUpWithEmail).not.toHaveBeenCalled();
  expect(finishParkedAction).toHaveBeenCalledTimes(complete ? 1 : 0);
});
