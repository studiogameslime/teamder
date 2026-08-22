/**
 * Guard: the Joryio SDK key must survive a store build.
 *
 * It briefly did not. The key was moved to EXPO_PUBLIC_JORYIO_SDK_KEY_*, which
 * reads fine locally — `.env` is loaded by `expo run:android`. But `.env` is
 * gitignored, and `eas build --local` copies the project by git, so the release
 * bundle resolved the key to '' and initJoryio() returned early. The AAB built,
 * signed, installed and ran with analytics silently off. Verified by grepping
 * the shipped bundle: the API host and Firebase config were both present, the
 * SDK key was not.
 *
 * An env var is still honoured as an override. What this test enforces is that
 * something real remains when the environment is empty — which is the state
 * every store build is in.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '..', '..', 'src', 'services', 'joryio.ts'),
  'utf8',
);

describe('joryio config', () => {
  it('every SDK key has a literal fallback, not just an env var', () => {
    const block = SRC.match(/const SDK_KEYS = \{[\s\S]*?\} as const;/)?.[0] ?? '';
    expect(block).not.toBe('');
    for (const platform of ['ios', 'android', 'web']) {
      const line = block.match(new RegExp(`${platform}:[\\s\\S]*?,\\n`))?.[0] ?? '';
      // A key that is only ever read from the environment is the bug.
      expect(line).toMatch(/'jry_sdk_/);
    }
  });

  it('the API host has a literal fallback too', () => {
    expect(SRC).toMatch(/API_HOST[\s\S]{0,160}?'https:\/\//);
  });

  it('env vars are still honoured as overrides', () => {
    expect(SRC).toContain('EXPO_PUBLIC_JORYIO_SDK_KEY_ANDROID');
  });
});
