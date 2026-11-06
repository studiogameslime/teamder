import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

function hookRuntime() {
  const slots: any[] = [];
  let cursor = 0, updates = 0;
  const effects: Array<() => void> = [];
  const hooks = {
    useRef(initial: any) { return slots[cursor++] ??= { current: initial }; },
    useState(initial: any) {
      const index = cursor++, slot = slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slot.value, (value: any) => { ++updates; slot.value = typeof value === 'function' ? value(slot.value) : value; }];
    },
    useEffect(effect: () => any, deps: any[]) {
      const index = cursor++, previous = slots[index];
      if (previous && deps.every((v, i) => Object.is(v, previous.deps[i]))) return;
      const slot: any = { deps }; slots[index] = slot;
      effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect(); });
    },
  };
  return { hooks, begin() { cursor = 0; }, commit() { effects.splice(0).forEach(run => run()); }, updates: () => updates,
    unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(10000); });
afterEach(() => { jest.useRealTimers(); });

test('a hidden running match makes zero local timer updates, then resumes from the server anchor', () => {
  const rt = hookRuntime(), syncServerClock = jest.fn().mockResolvedValue(undefined), module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/useSyncedTimer.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module, exports: module.exports, setInterval, clearInterval,
    require: (name: string) => name === 'react' ? rt.hooks : { serverNow: () => Date.now(), syncServerClock },
  });
  const live = { timerRunning: true, timerLastStartedAt: 9000, timerAccumulatedMs: 500 };
  const draw = (active: boolean) => { rt.begin(); const view = module.exports.useSyncedTimer(live, active); rt.commit(); return view; };
  draw(true); jest.advanceTimersByTime(1000); expect(draw(true).displayMs).toBe(2500);
  draw(false); const updates = rt.updates(), syncs = syncServerClock.mock.calls.length;
  expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(180000);
  expect(rt.updates()).toBe(updates); expect(syncServerClock).toHaveBeenCalledTimes(syncs);
  draw(true); expect(draw(true).displayMs).toBe(182500);
  expect(syncServerClock).toHaveBeenCalledTimes(syncs + 1);
  rt.unmount(); expect(jest.getTimerCount()).toBe(0);
});

test('a paused visible match does not allocate display ticks and a hidden match does not resync', () => {
  const rt = hookRuntime(), syncServerClock = jest.fn(), module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/useSyncedTimer.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module, exports: module.exports, setInterval, clearInterval,
    require: (name: string) => name === 'react' ? rt.hooks : { serverNow: () => Date.now(), syncServerClock },
  });
  const live = { timerRunning: false, timerAccumulatedMs: 7500 };
  rt.begin(); expect(module.exports.useSyncedTimer(live, false)).toMatchObject({ displayMs: 7500, running: false, started: true }); rt.commit();
  expect(jest.getTimerCount()).toBe(0); expect(syncServerClock).not.toHaveBeenCalled();
  rt.begin(); module.exports.useSyncedTimer(live, true); rt.commit(); const before = rt.updates();
  jest.advanceTimersByTime(60000); expect(rt.updates()).toBe(before);
  rt.unmount();
});

test.each(['LiveMatchScreen', 'AdvancedLiveMatchScreen'])('%s stops the supplementary stoppage ticker on blur', screen => {
  const file = `src/screens/${screen}.tsx`, source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = '';
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0].getText(source).includes('setNowTick(serverNow())')) expression = node.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const module = { exports: null as any }, scope = { module, timerFocused: false, serverNow: () => Date.now(), setNowTick: jest.fn(), setInterval, clearInterval };
  const code = ts.transpileModule('module.exports = ' + expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, scope); expect(module.exports()).toBeUndefined();
  jest.advanceTimersByTime(60000); expect(scope.setNowTick).not.toHaveBeenCalled();
  scope.timerFocused = true; const stop = module.exports();
  expect(scope.setNowTick).toHaveBeenLastCalledWith(70000);
  jest.advanceTimersByTime(1000); expect(scope.setNowTick).toHaveBeenLastCalledWith(71000);
  stop(); const count = scope.setNowTick.mock.calls.length; jest.advanceTimersByTime(60000);
  expect(scope.setNowTick).toHaveBeenCalledTimes(count); expect(jest.getTimerCount()).toBe(0);
});
