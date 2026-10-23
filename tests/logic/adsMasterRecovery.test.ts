import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

function fixture() {
  const ast = ts.createSourceFile('ads.ts', fs.readFileSync('src/services/adsService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set(['refreshAdsMaster', 'ensureAdsMaster']);
  const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.has(n.name!.text)).map(n => n.getText(ast)).join('\n');
  let show = '', initialize = '';
  function walk(n: ts.Node) {
    if (ts.isMethodDeclaration(n) && n.name.getText(ast) === 'showAppOpenAdIfAvailable') show = n.getText(ast);
    if (ts.isMethodDeclaration(n) && n.name.getText(ast) === 'initializeAds') initialize = n.getText(ast);
    ts.forEachChild(n, walk);
  }
  walk(ast);
  expect(show).not.toBe('');
  const getDoc = jest.fn(), observe = jest.fn(), loadAdsMod = jest.fn();
  let listener!: (state: string) => void;
  const addEventListener = jest.fn((_: string, cb: (state: string) => void) => { listener = cb; });
  const context = {
    getDoc, observeCaughtError: observe, USE_MOCK_DATA: false, __DEV__: false,
    getFirebase: () => ({ db: {} }), doc: () => ({}), notifyBannerMaster: jest.fn(),
    HIDE_ADS: false, ADS_ENABLED: true, appOpenShownThisSession: false,
    setTimeout: () => 0, loadAdsMod,
    AppState: { addEventListener }, initResolve: () => undefined,
  };
  const js = ts.transpileModule(`
    let appOpenMasterEnabled=true, appOpenMasterLoaded=false, appOpenMasterPromise=null, bannerMasterEnabled=true, initialized=false;
    ${functions}
    ({ ensureAdsMaster, show: ({${show}}).showAppOpenAdIfAvailable, initialize: ({${initialize}}).initializeAds, state: () => ({ loaded:appOpenMasterLoaded, enabled:appOpenMasterEnabled, pending:appOpenMasterPromise !== null }) });
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const api = vm.runInNewContext(js, context);
  return { ...api, getDoc, observe, loadAdsMod, addEventListener, change: (s: string) => listener(s) };
}

test('offline startup leaves the switch unknown; a later read recovers the disabled setting', async () => {
  const f = fixture(), error = Object.assign(new Error('client is offline'), { code: 'unavailable' });
  f.getDoc.mockRejectedValueOnce(error).mockResolvedValueOnce({ exists: () => true, data: () => ({ appOpenEnabled: false }) });
  await f.ensureAdsMaster();
  expect(f.state()).toEqual({ loaded: false, enabled: true, pending: false });
  expect(f.observe).toHaveBeenCalledWith(error, expect.anything());
  await f.ensureAdsMaster();
  expect(f.state()).toEqual({ loaded: true, enabled: false, pending: false });
  expect(f.getDoc).toHaveBeenCalledTimes(2);
});

test('concurrent callers share the same pending attempt', async () => {
  const f = fixture();
  let resolve!: (value: unknown) => void;
  f.getDoc.mockReturnValue(new Promise(r => { resolve = r; }));
  const first = f.ensureAdsMaster(), second = f.ensureAdsMaster();
  expect(first).toBe(second);
  expect(f.getDoc).toHaveBeenCalledTimes(1);
  resolve({ exists: () => false }); await first;
  expect(f.state()).toEqual({ loaded: true, enabled: true, pending: false });
});

test('show recovers after offline startup and never loads an ad under an unknown or disabled switch', async () => {
  const f = fixture();
  f.getDoc.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ exists: () => true, data: () => ({ appOpenEnabled: false }) });
  await f.show();
  expect(f.state().loaded).toBe(false);
  expect(f.loadAdsMod).not.toHaveBeenCalled();
  await f.show();
  expect(f.state()).toMatchObject({ loaded: true, enabled: false });
  expect(f.getDoc).toHaveBeenCalledTimes(2);
  expect(f.loadAdsMod).not.toHaveBeenCalled();
});

test('resume retries failed startup configuration once and does not show an ad', async () => {
  const f = fixture();
  f.getDoc.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ exists: () => true, data: () => ({ appOpenEnabled: false }) });
  await f.initialize(); await f.ensureAdsMaster();
  await f.initialize();
  expect(f.addEventListener).toHaveBeenCalledTimes(1);
  expect(f.state().loaded).toBe(false);
  f.loadAdsMod.mockClear();
  f.change('background'); expect(f.getDoc).toHaveBeenCalledTimes(1);
  f.change('active'); await f.ensureAdsMaster();
  expect(f.state()).toMatchObject({ loaded: true, enabled: false });
  expect(f.loadAdsMod).not.toHaveBeenCalled();
  f.change('active'); expect(f.getDoc).toHaveBeenCalledTimes(2);
});
