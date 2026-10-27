import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function service() {
  const rows = new Map<string, string>();
  let user: any = { id: 'owner', isGuest: false };
  const storage = { getItem: jest.fn(async (key: string) => rows.get(key) ?? null), setItem: jest.fn(async (key: string, value: string) => { rows.set(key, value); }) };
  const submit = jest.fn(async (..._args: any[]) => {});
  const deps: any = {
    '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
    './feedbackService': { captureFeedbackDiagnostics: () => ({ journal: 'frozen', trail: 'home', screen: 'FeedbackPrompt' }), submitFeedback: submit },
    '@/store/userStore': { useUserStore: { getState: () => ({ currentUser: user }) } },
  };
  const module = { exports: {} as any };
  const js = ts.transpileModule(fs.readFileSync('src/services/feedbackPromptService.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require: (name: string) => deps[name], Set, Error });
  return { api: module.exports, rows, storage, submit, setUser: (value: any) => { user = value; } };
}

test('frequency is isolated by account and retained by the installation receipt', async () => {
  const s = service();
  expect(await s.api.shouldShowFeedbackPrompt('owner')).toBe(true);
  await s.api.markFeedbackPromptHandled('owner');
  expect(await s.api.shouldShowFeedbackPrompt('owner')).toBe(false);
  expect(await s.api.shouldShowFeedbackPrompt('other')).toBe(true);
  expect([...s.rows.keys()][0]).toBe('feedbackPrompt:football-feedback-v1:owner');
});
test('failed receipt write still suppresses this process, failed reads do not mean unseen', async () => {
  const s = service(); s.storage.setItem.mockRejectedValueOnce(new Error('disk'));
  await expect(s.api.markFeedbackPromptHandled('owner')).rejects.toThrow('disk');
  expect(await s.api.shouldShowFeedbackPrompt('owner')).toBe(false);
  s.storage.getItem.mockRejectedValueOnce(new Error('disk'));
  await expect(s.api.shouldShowFeedbackPrompt('other')).rejects.toThrow('disk');
});
test('sends a feature suggestion into the existing Pulse feedback contract', async () => {
  const s = service(), context = s.api.feedbackPromptContext('owner');
  await s.api.submitFeedbackPrompt('owner', '  חסר לי משהו  ', context);
  expect(s.submit).toHaveBeenCalledWith('suggestion', 'חסר לי משהו', 'FeedbackPrompt', undefined, 'feature', { owner: 'owner', journal: 'frozen', trail: 'home', screen: 'FeedbackPrompt' });
});
test.each([null, { id: 'other' }, { id: 'owner', isGuest: true }])('rejects changed or guest identity before a write: %j', async user => {
  const s = service(); s.setUser(user);
  await expect(s.api.submitFeedbackPrompt('owner', 'רעיון', { owner: 'owner' })).rejects.toThrow('session changed');
  expect(s.submit).not.toHaveBeenCalled();
});
test.each([' ', 'א'.repeat(301)])('rejects blank or overlong messages', async message => {
  const s = service();
  await expect(s.api.submitFeedbackPrompt('owner', message, { owner: 'owner' })).rejects.toThrow('invalid message');
  expect(s.submit).not.toHaveBeenCalled();
});
test('a write failure is returned to the form and never marks the prompt handled', async () => {
  const s = service(); s.submit.mockRejectedValueOnce(new Error('offline'));
  await expect(s.api.submitFeedbackPrompt('owner', 'רעיון', { owner: 'owner' })).rejects.toThrow('offline');
  expect(s.storage.setItem).not.toHaveBeenCalled();
});
