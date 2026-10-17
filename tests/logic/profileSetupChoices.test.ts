import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
const src = ts.createSourceFile('ProfileSetupScreen.tsx', fs.readFileSync('src/screens/auth/ProfileSetupScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function runHandler(name: string, ctx: any) {
  let body = '';
  function walk(n: ts.Node) { if (ts.isVariableDeclaration(n) && n.name.getText(src) === name) body = n.initializer!.getText(src); ts.forEachChild(n, walk); }
  walk(src);
  if (!body) throw Error('Handler missing: ' + name);
  return vm.runInNewContext(ts.transpileModule(`(${body})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
}
function context() {
  return { user: { id: 'u1', photoUrl: 'previous.jpg' }, name: '  שם לדוגמה  ', photoUrl: undefined, avatarId: 'a22', canSave: true,
    inFlight: { current: false }, mounted: { current: true }, setBusy: jest.fn(), setUploading: jest.fn(), setPhotoUrl: jest.fn(), setAvatarId: jest.fn(),
    useUserStore: { getState: () => ({ currentUser: { id: 'u1' } }) },
    updateProfile: jest.fn().mockResolvedValue(undefined), deleteUserPhoto: jest.fn().mockResolvedValue(undefined), pickAndUploadAvatar: jest.fn(),
    logEvent: jest.fn(), AnalyticsEvent: {}, appAlert: jest.fn(), he: { error: 'שגיאה', profileSaveError: 'לא נשמר', profilePhotoUploadFailed: 'לא הועלה' }, __DEV__: false, console,
  };
}
test('selecting a built-in avatar edits draft only, without deleting the saved photo', () => {
  const c = context(); runHandler('handlePickAvatar', c)('a06');
  expect(c.setPhotoUrl).toHaveBeenCalledWith(undefined); expect(c.setAvatarId).toHaveBeenCalledWith('a06');
  expect(c.deleteUserPhoto).not.toHaveBeenCalled(); expect(c.updateProfile).not.toHaveBeenCalled();
});
test('avatar save explicitly clears photoUrl, trims name, and cleans photo only after success', async () => {
  const c = context(); const save = runHandler('handleSave', c);
  await Promise.all([save(), save()]);
  expect(c.updateProfile).toHaveBeenCalledTimes(1);
  expect(c.updateProfile).toHaveBeenCalledWith({ name: 'שם לדוגמה', photoUrl: undefined, avatarId: 'a22' });
  expect(c.deleteUserPhoto.mock.invocationCallOrder[0]).toBeGreaterThan(c.updateProfile.mock.invocationCallOrder[0]);
});
test('failed profile save preserves uploaded file and makes retry available', async () => {
  const c = context(); c.updateProfile.mockRejectedValue(Error('offline'));
  await runHandler('handleSave', c)();
  expect(c.deleteUserPhoto).not.toHaveBeenCalled(); expect(c.appAlert).toHaveBeenCalled(); expect(c.inFlight.current).toBe(false);
});
test.each(['cancelled', 'permission', 'network'])('photo %s preserves current draft', async reason => {
  const c = context(); c.pickAndUploadAvatar.mockResolvedValue({ ok: false, reason });
  await runHandler('handlePickPhoto', c)();
  expect(c.setPhotoUrl).not.toHaveBeenCalled(); expect(c.setAvatarId).not.toHaveBeenCalled();
  expect(c.appAlert).toHaveBeenCalledTimes(reason === 'cancelled' ? 0 : 1); expect(c.inFlight.current).toBe(false);
});
test('successful upload sets the returned URL without an early profile write', async () => {
  const c = context(); c.pickAndUploadAvatar.mockResolvedValue({ ok: true, url: 'selected.jpg' });
  await runHandler('handlePickPhoto', c)();
  expect(c.setPhotoUrl).toHaveBeenCalledWith('selected.jpg'); expect(c.updateProfile).not.toHaveBeenCalled();
});
test('upload resolving after unmount cannot replace the next screen state', async () => {
  const c = context(); c.mounted.current = false; c.pickAndUploadAvatar.mockResolvedValue({ ok: true, url: 'selected.jpg' });
  await runHandler('handlePickPhoto', c)();
  expect(c.setPhotoUrl).not.toHaveBeenCalled();
});
