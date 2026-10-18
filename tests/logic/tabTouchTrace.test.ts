import { createTabTouchTrace, touchPoint } from '@/utils/tabTouchTrace';
import { diagnosticSnapshot, recordDiagnostic, resetDiagnosticJournal } from '@/services/diagnosticJournal';

it('bounds diagnostics even for hundreds of movement frames and press re-entry', () => {
  const emit = jest.fn();
  const trace = createTabTouchTrace('players', emit);
  const measure = jest.fn(done => done({ x: 200, y: 250, width: 100, height: 52 }));
  trace.pressIn({ x: 250, y: 280 }, measure);
  for (let i = 0; i < 500; i++) trace.move({ x: 250 + i / 100, y: 280 + i / 100 });
  trace.pressOut();
  trace.pressIn({ x: 255, y: 285 }, measure);
  trace.pressOut();
  trace.finish('touch_end', { x: 251, y: 281 });
  trace.finish('touch_cancel', { x: 251, y: 281 });
  expect(emit.mock.calls.map(([name]) => name)).toEqual([
    'club_tab_press_in', 'club_tab_measure', 'club_tab_touch_move', 'club_tab_press_out', 'club_tab_touch_end',
  ]);
  expect(measure).toHaveBeenCalledTimes(1);
  expect(emit.mock.calls.at(-1)?.[1].dx).toBeCloseTo(4.99);
  expect(emit.mock.calls.at(-1)?.[1].dy).toBeCloseTo(4.99);
});

it('records native geometry that disagrees with the touch without invoking an action', () => {
  const emit = jest.fn();
  const trace = createTabTouchTrace('players', emit);
  trace.pressIn({ x: 250, y: 280 }, done => done({ x: 200, y: 560, width: 100, height: 52 }));
  expect(emit).toHaveBeenLastCalledWith('club_tab_measure', {
    tab: 'players', index: 1, x: 200, y: 560, width: 100, height: 52, phase: 'outside',
  });
  trace.finish('touch_cancel', { x: 250, y: 280 });
  expect(emit.mock.calls.some(([name]) => name === 'club_tab_selected')).toBe(false);
});

it.each([false, true])('does not turn local-coordinate cancellation into finger motion (observed move: %s)', moved => {
  const emit = jest.fn();
  const trace = createTabTouchTrace('players', emit);
  trace.pressIn({ x: 250, y: 331.29 }, done => done({ x: 200, y: 310, width: 100, height: 52 }));
  if (moved) trace.move({ x: 252, y: 334.29 });
  // Native CANCEL may be local to an ancestor offset by 50.29pt. No MOVE
  // reported such travel; the diagnostic must not manufacture a long drag.
  trace.finish('touch_cancel', { x: 150, y: 281 });
  trace.pressOut();
  expect(emit.mock.calls.find(([name]) => name === 'club_tab_touch_cancel')?.[1]).toEqual({
    tab: 'players', index: 1, dx: moved ? 2 : 0, dy: moved ? 3 : 0,
  });
  expect(emit.mock.calls.find(([name]) => name === 'club_tab_press_out')?.[1]).toEqual({ tab: 'players', index: 1 });
});

it('ignores measurements from an earlier gesture or an unmounted tab', () => {
  const emit = jest.fn();
  const trace = createTabTouchTrace('stats', emit);
  const pending: Array<(rect: { x: number; y: number; width: number; height: number }) => void> = [];
  trace.pressIn({ x: 10, y: 10 }, done => pending.push(done));
  trace.finish('touch_end', { x: 10, y: 10 });
  trace.pressIn({ x: 10, y: 300 }, done => pending.push(done));
  pending[0]({ x: 0, y: 0, width: 100, height: 52 });
  expect(emit.mock.calls.filter(([name]) => name === 'club_tab_measure')).toHaveLength(0);
  trace.dispose();
  pending[1]({ x: 0, y: 280, width: 100, height: 52 });
  expect(emit.mock.calls.filter(([name]) => name === 'club_tab_measure')).toHaveLength(0);
});

it('observes only allowlisted geometry and codes, even if the event includes private text', () => {
  resetDiagnosticJournal();
  const trace = createTabTouchTrace('info', (name, data) => recordDiagnostic('tap', name, data));
  const event = { nativeEvent: { pageX: 12.345, pageY: 60, text: 'private text', url: 'https://private', token: 'private-token' } };
  trace.pressIn(touchPoint(event), done => done({ x: 0, y: 40, width: 100, height: 52 }));
  trace.finish('touch_end', touchPoint(event));
  const entries = diagnosticSnapshot().entries.filter(entry => entry.kind === 'tap');
  expect(entries[0].data).toEqual({ tab: 'info', index: 1, x: 12.35, y: 60 });
  expect(entries[1].data).toEqual({ tab: 'info', index: 1, x: 0, y: 40, width: 100, height: 52, phase: 'inside' });
  expect(JSON.stringify(entries)).not.toContain('private');
  expect(touchPoint({ nativeEvent: { pageX: NaN, pageY: Infinity } })).toBeUndefined();
});

it('does not fail a press when the native measurement is unavailable or invalid', () => {
  const emit = jest.fn();
  const trace = createTabTouchTrace('info', emit);
  expect(() => trace.pressIn({ x: 1, y: 2 }, () => { throw new Error('native node detached'); })).not.toThrow();
  trace.finish('touch_end', { x: 1, y: 2 });
  trace.pressIn({ x: 1, y: 2 }, done => done({ x: NaN, y: 2, width: 100, height: 52 }));
  expect(emit.mock.calls.filter(([name]) => name === 'club_tab_measure')).toHaveLength(0);
});
