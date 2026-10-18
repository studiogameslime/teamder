import { createOnboardingActivityLoader } from '../../pulse/src/services/onboardingActivityLoader';

function deferred() {
  let resolve!: (rows: string[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string[]>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const old = deferred(), current = deferred();
  const rows = jest.fn(), error = jest.fn(), loading = jest.fn();
  const query = jest.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  return { old, current, rows, error, loading, loader: createOnboardingActivityLoader<string>({ query, rows, error, loading }) };
}

it('keeps the chosen visit when an older all-visits response arrives later', async () => {
  const f = fixture();
  const first = f.loader.load(null), second = f.loader.load('chosen');
  f.current.resolve(['chosen']); await second;
  f.old.resolve(['all']); await first;
  expect(f.rows.mock.calls).toEqual([[['chosen']]]);
});

it('ignores an old failure and keeps the new request loading', async () => {
  const f = fixture();
  const first = f.loader.load('old'), second = f.loader.load(null);
  f.old.reject(new Error('offline')); await first;
  expect(f.error.mock.calls).toEqual([[''], ['']]);
  expect(f.loading.mock.calls).toEqual([[true], [true]]);
  f.current.resolve(['new']); await second;
  expect(f.loading).toHaveBeenLastCalledWith(false);
});

it('does not update an unmounted screen', async () => {
  const f = fixture();
  const pending = f.loader.load(null);
  f.loader.cancel();
  f.old.resolve(['stale']); await pending;
  expect(f.rows).not.toHaveBeenCalled();
  expect(f.loading.mock.calls).toEqual([[true]]);
});

it('shows current failures and permits a successful retry', async () => {
  const f = fixture();
  const first = f.loader.load(null);
  f.old.reject(new Error('offline')); await first;
  expect(f.error).toHaveBeenLastCalledWith('לא ניתן לטעון את הפעולות. נסו שוב.');
  const retry = f.loader.load(null);
  f.current.resolve(['recovered']); await retry;
  expect(f.error).toHaveBeenLastCalledWith('');
  expect(f.rows).toHaveBeenLastCalledWith(['recovered']);
});
