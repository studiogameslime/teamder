import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
import { mergeSupportMessages, supportDayLabel } from '@/utils/supportTimeline';
import type { ChatMessage } from '@/types';

test('the actual message converter preserves attached photos and context for timestamp and numeric dates', () => {
  const source = ts.createSourceFile('firestore.ts', fs.readFileSync('src/firebase/firestore.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations]).find(d => d.name.getText(source) === 'chatMessageConverter')!;
  const context: any = {};
  vm.runInNewContext(ts.transpileModule(`result = ${declaration.initializer!.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  for (const createdAt of [123, { toMillis: () => 123 }]) {
    const value = context.result.fromFirestore({ id: 'photo', data: () => ({ text: 'דוגמה', senderId: 'alice', createdAt, supportImage: '/9j/AAAA', supportContext: { screen: 'CommunitiesFeed', screenLabel: 'מועדונים' } }) });
    expect(value).toMatchObject({ createdAt: 123, supportImage: '/9j/AAAA', supportContext: { screen: 'CommunitiesFeed' } });
  }
});

test('merged bounded windows retain recent numeric messages after many older timestamp messages', () => {
  const message = (id: string, createdAt: number) => ({ id, createdAt } as ChatMessage);
  const rows = mergeSupportMessages([Array.from({ length: 100 }, (_, i) => message(`old-${i}`, i)), [message('new', 500), message('latest', 600), message('new', 500)]]);
  expect(rows).toHaveLength(100); expect(rows[0].createdAt).toBe(2);
  expect(rows.slice(-2).map(m => m.id)).toEqual(['new', 'latest']);
});

test('day separators use local calendar days including midnight and year changes', () => {
  const now = new Date(2026, 0, 1, 0, 10).getTime();
  expect(supportDayLabel(now, undefined, now)).toBe('היום');
  expect(supportDayLabel(now, now - 5 * 60000, now)).toBeNull();
  expect(supportDayLabel(new Date(2025, 11, 31, 23, 59).getTime(), undefined, now)).toBe('אתמול');
  expect(supportDayLabel(new Date(2025, 11, 30).getTime(), undefined, now)).toContain('2025');
});

test('support listener waits for both typed windows, merges and cancels both subscriptions', () => {
  const callbacks: any[] = [], stops = [jest.fn(), jest.fn()], seen = jest.fn(), failed = jest.fn();
  const deps: Record<string, any> = {
    '@/utils/officialAccount': { TEAMDER_UID: 'teamder' }, '@/utils/supportTimeline': { mergeSupportMessages },
    '@/firebase/config': { USE_MOCK_DATA: false, getFirebase: () => ({ auth: { currentUser: { uid: 'alice' } } }) },
    '@/firebase/firestore': { col: { dmMessages: () => ({}) } },
    'firebase/firestore': { query: (...args: any[]) => args, where: (...args: any[]) => args, orderBy: () => ({}), limit: () => ({}), Timestamp: { fromMillis: (ms: number) => ({ ms }) }, onSnapshot: (_q: any, next: any, error: any) => { callbacks.push({ next, error }); return stops[callbacks.length - 1]; } },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/chatService.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { module, exports: module.exports, require: (name: string) => {if(name.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(name.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(name==='@/services/diagnosticCallable')name='firebase/functions';return deps[name] ?? {};}, console });
  const stop = module.exports.chatService.subscribeMessages('dm', 'alice__teamder', seen, failed);
  const snap = (id: string, createdAt: number) => ({ docs: [{ id, data: () => ({ createdAt }) }] });
  callbacks[0].next(snap('today', 200)); expect(seen).not.toHaveBeenCalled();
  callbacks[1].next(snap('yesterday', 100)); expect(seen.mock.calls[0][0].map((m: ChatMessage) => m.id)).toEqual(['yesterday', 'today']);
  callbacks[1].error(Error('denied')); expect(failed).toHaveBeenCalledTimes(1);
  callbacks[0].next(snap('late', 300)); expect(seen).toHaveBeenCalledTimes(1);
  stop(); expect(stops.every(s => s.mock.calls.length >= 1)).toBe(true);
});
