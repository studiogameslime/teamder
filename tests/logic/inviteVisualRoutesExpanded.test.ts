import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { he } from '../../src/i18n/he';

// Execute the real choice mapper without claiming to render React Native.
const source = fs.readFileSync(path.join(__dirname, '../../src/screens/entry/IntentScreen.tsx'), 'utf8');
const mapperSource = source.slice(source.indexOf('export function buildInviteChoice('), source.indexOf('const styles = StyleSheet.create'));
const compiled = ts.transpileModule(mapperSource.replace('export function', 'function') + '\nthis.mapper = buildInviteChoice;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const sandbox: any = { he };
vm.runInNewContext(compiled, sandbox);
const mapper = sandbox.mapper as (invite: { kind: string } | null, name: string | null) => any;

describe('invitation cards preserve destination and isolate mixed names', () => {
  test.each(['game', 'club', 'referral'])('%s keeps complete long mixed inviter name', (kind) => {
    const name = 'Alex + Dan 123 שם עברי ארוך במיוחד';
    const choice = mapper({ kind }, name);
    expect(choice.intent).toBe('invite');
    const artwork: Record<string, string> = { game: 'invite_game', club: 'invite_club', referral: 'invite_referral' };
    expect(choice.art).toBe(artwork[kind]);
    expect(choice.title).toContain(`\u2068${name}\u2069`);
    expect(choice.tag).toContain(`\u2068${name}\u2069`);
    if (kind === 'referral') expect(choice.body).toContain(`\u2068${name}\u2069`);
  });
  test.each(['game', 'club'])('%s remains selectable without inviter', kind => {
    const choice = mapper({ kind }, null);
    expect(choice.intent).toBe('invite');
    expect(choice.tag).toBe(he.entryInviteTagAnon);
    expect(choice.title).not.toContain('null');
  });
  test('personal missing name and absent invite do not invent a destination', () => {
    expect(mapper({ kind: 'referral' }, null)).toBeNull();
    expect(mapper(null, 'שם')).toBeNull();
  });
});

