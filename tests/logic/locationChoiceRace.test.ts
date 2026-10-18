import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

const source = ts.createSourceFile('LocationSearchSheet.tsx', fs.readFileSync('src/components/games/LocationSearchSheet.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name: string) {
  let body = '';
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === name) body = n.initializer!.getText(source);
    ts.forEachChild(n, visit);
  }; visit(source);
  if (!body) throw Error(name);
  return ts.transpileModule(`module.exports=${body}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function harness() {
  const state: any = { picked: null, resolving: false, locating: false, error: '' };
  const context: any = {
    module: { exports: {} }, choiceRevision: { current: 0 }, Keyboard: { dismiss: jest.fn() },
    setPicked: (v: any) => state.picked = v, setResolving: (v: boolean) => state.resolving = v,
    setLocating: (v: boolean) => state.locating = v, setLocationError: (v: string) => state.error = v,
    setSearchOpen: jest.fn(), setResults: jest.fn(), setFly: jest.fn(), he: { locationOnMap: 'נקודה במפה' },
    reverseGeocode: jest.fn(), Location: { requestForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), Accuracy: { Balanced: 3 } },
    setTimeout, clearTimeout,
  };
  const run = (name: string) => { vm.runInNewContext(handler(name), context); return context.module.exports; };
  context.pickFromMap = run('pickFromMap');
  return { state, context, run };
}
const flush = () => new Promise<void>(done => setImmediate(done));

test('a late reverse geocode cannot overwrite a newer map choice', async () => {
  const { state, context } = harness();
  let first: (v: any) => void = () => {};
  context.reverseGeocode.mockReturnValueOnce(new Promise(done => first = done)).mockResolvedValueOnce({ label: 'חדש' });
  context.pickFromMap(32, 34.8); context.pickFromMap(32.1, 34.9); await flush();
  first({ label: 'ישן' }); await flush();
  expect(state.picked).toEqual({ label: 'חדש', lat: 32.1, lng: 34.9 });
  expect(state.resolving).toBe(false);
});

test('choosing a search result invalidates an outstanding map lookup', async () => {
  const { state, context, run } = harness();
  let finish: (v: any) => void = () => {};
  context.reverseGeocode.mockReturnValue(new Promise(done => finish = done));
  context.pickFromMap(32, 34.8);
  run('pickResult')({ label: 'בחירה', lat: 32.2, lng: 34.9 });
  finish({ label: 'ישן' }); await flush();
  expect(state.picked.label).toBe('בחירה'); expect(state.resolving).toBe(false);
});

test('denied location permission leaves the staged choice intact and does not request GPS', async () => {
  const { state, context, run } = harness();
  state.picked = { label: 'קיים', lat: 32, lng: 34.8 };
  context.Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
  await run('useCurrentLocation')();
  expect(context.Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(state.picked.label).toBe('קיים'); expect(state.error).toContain('לאפשר גישה'); expect(state.locating).toBe(false);
});

test('a valid GPS fix stages a resolved map point without automatically confirming it', async () => {
  const { state, context, run } = harness();
  context.Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  context.Location.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 32.0853, longitude: 34.7818 } });
  context.reverseGeocode.mockResolvedValue({ label: 'תל אביב' });
  context.onSelect = jest.fn();
  await run('useCurrentLocation')(); await flush();
  expect(state.picked).toEqual({ label: 'תל אביב', lat: 32.0853, lng: 34.7818 });
  expect(context.setFly).toHaveBeenCalledWith({ lat: 32.0853, lng: 34.7818, zoom: 16 });
  expect(context.onSelect).not.toHaveBeenCalled();
  expect(state.resolving).toBe(false); expect(state.locating).toBe(false);
});

test('closing or changing the choice while GPS is pending invalidates its response', async () => {
  const { state, context, run } = harness();
  let finish: (v: any) => void = () => {};
  context.Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  context.Location.getCurrentPositionAsync.mockReturnValue(new Promise(done => finish = done));
  const operation = run('useCurrentLocation')(); await flush();
  context.choiceRevision.current += 1;
  finish({ coords: { latitude: 32, longitude: 34.8 } }); await operation;
  expect(state.picked).toBeNull(); expect(context.reverseGeocode).not.toHaveBeenCalled();
});
