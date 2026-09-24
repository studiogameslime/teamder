/**
 * Work in progress that has to survive authentication.
 *
 * Two cases here carry most of the weight. The TTL boundary, because "7 days"
 * has to mean one specific comparison and not roughly a week. And the stale
 * `startsAt`, because restoring an absolute kick-off timestamp from a draft
 * written five days ago schedules a game for a moment that has already passed —
 * and the submit guard in GameCreateScreen only catches that when the value
 * happens to land in the past, not when a guess lands somewhere plausible.
 */

jest.mock('@react-native-async-storage/async-storage', () => {
  const mem = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: (k: string) => Promise.resolve(mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => {
        mem.set(k, v);
        return Promise.resolve();
      },
      removeItem: (k: string) => {
        mem.delete(k);
        return Promise.resolve();
      },
      __mem: mem,
    },
  };
});
jest.mock(
  'expo-constants',
  () => ({ __esModule: true, default: { expoConfig: { version: '1.1.14' } } }),
  { virtual: true },
);

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DRAFT_TTL_MS,
  writeDraft,
  readDraft,
  discardDraft,
  consumeDraft,
  peekExpired,
  parseDraft,
  isExpired,
  mergeDraftValues,
  restoreValues,
  restoreGameValues,
  draftStore,
} from '@/services/draftStore';

const NOW = 1_700_000_000_000;
const mem = (AsyncStorage as unknown as { __mem: Map<string, string> }).__mem;

beforeEach(() => mem.clear());

// ─── write / read ─────────────────────────────────────────────────────────

describe('write and read', () => {
  it('round-trips values', async () => {
    await writeDraft('club', 'd1', { name: 'שכונת שושי', isOpen: true }, NOW);
    const got = await readDraft('club', NOW);
    expect(got).toMatchObject({
      id: 'd1',
      kind: 'club',
      values: { name: 'שכונת שושי', isOpen: true },
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('stamps the app version that wrote it', async () => {
    await writeDraft('club', 'd1', {}, NOW);
    expect((await readDraft('club', NOW))?.appVersion).toBe('1.1.14');
  });

  it('returns null for a kind that was never written', async () => {
    expect(await readDraft('game', NOW)).toBeNull();
  });

  it('uses one namespaced key per kind', () => {
    expect(draftStore.keyFor('club')).toBe('footy.draft.club');
    expect(draftStore.keyFor('game')).toBe('footy.draft.game');
    expect(draftStore.keyFor('availability')).toBe('footy.draft.availability');
  });
});

describe('slot semantics', () => {
  it('a second write to the same kind overwrites the first', async () => {
    await writeDraft('club', 'd1', { name: 'first' }, NOW);
    await writeDraft('club', 'd2', { name: 'second' }, NOW + 1000);
    const got = await readDraft('club', NOW + 1000);
    expect(got?.id).toBe('d2');
    expect(got?.values).toEqual({ name: 'second' });
  });

  // Editing your own draft should extend its life, not restart its age.
  it('preserves createdAt when overwriting the SAME draft id', async () => {
    await writeDraft('club', 'd1', { name: 'a' }, NOW);
    await writeDraft('club', 'd1', { name: 'b' }, NOW + 60_000);
    const got = await readDraft('club', NOW + 60_000);
    expect(got?.createdAt).toBe(NOW);
    expect(got?.updatedAt).toBe(NOW + 60_000);
  });

  it('resets createdAt when a DIFFERENT draft id takes the slot', async () => {
    await writeDraft('club', 'd1', {}, NOW);
    await writeDraft('club', 'd2', {}, NOW + 60_000);
    expect((await readDraft('club', NOW + 60_000))?.createdAt).toBe(NOW + 60_000);
  });

  it('kinds are independent', async () => {
    await writeDraft('club', 'c', { a: 1 }, NOW);
    await writeDraft('game', 'g', { b: 2 }, NOW);
    await writeDraft('availability', 'v', { c: 3 }, NOW);
    expect((await readDraft('club', NOW))?.values).toEqual({ a: 1 });
    expect((await readDraft('game', NOW))?.values).toEqual({ b: 2 });
    expect((await readDraft('availability', NOW))?.values).toEqual({ c: 3 });
  });

  it('discarding one kind leaves the others alone', async () => {
    await writeDraft('club', 'c', { a: 1 }, NOW);
    await writeDraft('game', 'g', { b: 2 }, NOW);
    await discardDraft('club');
    expect(await readDraft('club', NOW)).toBeNull();
    expect(await readDraft('game', NOW)).not.toBeNull();
  });
});

// ─── TTL ──────────────────────────────────────────────────────────────────

describe('expiry', () => {
  it('is seven days', () => {
    expect(DRAFT_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('holds right up to the boundary and not past it', () => {
    const d = { id: 'x', kind: 'club' as const, values: {}, createdAt: NOW, updatedAt: NOW, appVersion: 'x' };
    expect(isExpired(d, NOW)).toBe(false);
    expect(isExpired(d, NOW + DRAFT_TTL_MS - 1)).toBe(false);
    expect(isExpired(d, NOW + DRAFT_TTL_MS)).toBe(false);
    expect(isExpired(d, NOW + DRAFT_TTL_MS + 1)).toBe(true);
  });

  it('reads a draft one millisecond inside the window', async () => {
    await writeDraft('club', 'd1', { name: 'a' }, NOW);
    expect(await readDraft('club', NOW + DRAFT_TTL_MS)).not.toBeNull();
  });

  // The read IS the collection mechanism — there is no sweep and no timer.
  it('deletes an expired draft on read and reports it absent', async () => {
    await writeDraft('club', 'd1', { name: 'a' }, NOW);
    expect(await readDraft('club', NOW + DRAFT_TTL_MS + 1)).toBeNull();
    expect(mem.has('footy.draft.club')).toBe(false);
  });

  it('an edit extends the life of a nearly-expired draft', async () => {
    await writeDraft('club', 'd1', { name: 'a' }, NOW);
    await writeDraft('club', 'd1', { name: 'b' }, NOW + DRAFT_TTL_MS - 1000);
    expect(await readDraft('club', NOW + DRAFT_TTL_MS + 1)).not.toBeNull();
  });

  // "Nothing to continue" and "your draft expired" are different sentences.
  it('peekExpired distinguishes expired from absent, without deleting', async () => {
    expect(await peekExpired('club', NOW)).toBe(false);
    await writeDraft('club', 'd1', {}, NOW);
    expect(await peekExpired('club', NOW)).toBe(false);
    expect(await peekExpired('club', NOW + DRAFT_TTL_MS + 1)).toBe(true);
    expect(mem.has('footy.draft.club')).toBe(true);
  });
});

// ─── malformed input ──────────────────────────────────────────────────────

describe('parseDraft', () => {
  const ok = {
    id: 'd1',
    kind: 'club',
    values: { a: 1 },
    createdAt: NOW,
    updatedAt: NOW,
    appVersion: '1.0.0',
  };

  it('accepts a well-formed draft', () => {
    expect(parseDraft(ok)).toMatchObject({ id: 'd1', kind: 'club' });
  });

  it('rejects non-objects', () => {
    for (const v of [null, undefined, 'x', 7, []]) expect(parseDraft(v)).toBeNull();
  });

  it('rejects a missing or empty id', () => {
    const { id: _drop, ...noId } = ok;
    expect(parseDraft(noId)).toBeNull();
    expect(parseDraft({ ...ok, id: '' })).toBeNull();
  });

  it('rejects an unknown kind', () => {
    expect(parseDraft({ ...ok, kind: 'spaceship' })).toBeNull();
  });

  it('rejects non-finite timestamps', () => {
    expect(parseDraft({ ...ok, createdAt: NaN })).toBeNull();
    expect(parseDraft({ ...ok, updatedAt: 'later' })).toBeNull();
  });

  it('rejects values that is not a plain object', () => {
    expect(parseDraft({ ...ok, values: [1, 2] })).toBeNull();
    expect(parseDraft({ ...ok, values: 'x' })).toBeNull();
    expect(parseDraft({ ...ok, values: null })).toBeNull();
  });

  it('defaults a missing appVersion rather than rejecting', () => {
    const { appVersion: _drop, ...noVersion } = ok;
    expect(parseDraft(noVersion)?.appVersion).toBe('unknown');
  });
});

describe('malformed storage', () => {
  it('malformed JSON reads as absent and is cleaned up', async () => {
    mem.set('footy.draft.club', '{{{ not json');
    expect(await readDraft('club', NOW)).toBeNull();
    expect(mem.has('footy.draft.club')).toBe(false);
  });

  it('valid JSON of the wrong shape reads as absent and is cleaned up', async () => {
    mem.set('footy.draft.game', JSON.stringify({ hello: 'world' }));
    expect(await readDraft('game', NOW)).toBeNull();
    expect(mem.has('footy.draft.game')).toBe(false);
  });

  it('a draft whose kind disagrees with its slot is still readable', async () => {
    // Defensive: the slot is authoritative for WHERE it lives; a mismatched
    // `kind` field is odd but not a reason to throw away the person's work.
    mem.set(
      'footy.draft.club',
      JSON.stringify({ id: 'd', kind: 'game', values: { a: 1 }, createdAt: NOW, updatedAt: NOW }),
    );
    expect(await readDraft('club', NOW)).not.toBeNull();
  });
});

// ─── merge with current defaults ──────────────────────────────────────────

describe('mergeDraftValues', () => {
  const defaults = {
    name: '',
    isOpen: false,
    maxMembers: '40',
    tags: [] as string[],
    coords: undefined as { lat: number } | undefined,
  };

  it('overlays stored values onto the defaults', () => {
    expect(mergeDraftValues(defaults, { name: 'שושי', isOpen: true })).toEqual({
      ...defaults,
      name: 'שושי',
      isOpen: true,
    });
  });

  it('returns the defaults untouched for empty input', () => {
    expect(mergeDraftValues(defaults, null)).toEqual(defaults);
    expect(mergeDraftValues(defaults, undefined)).toEqual(defaults);
    expect(mergeDraftValues(defaults, {})).toEqual(defaults);
  });

  // A field the form no longer has must not come back from a stale draft.
  it('ignores keys absent from the current defaults', () => {
    const out = mergeDraftValues(defaults, { name: 'x', removedLastRelease: 'ghost' });
    expect(out).not.toHaveProperty('removedLastRelease');
    expect(out.name).toBe('x');
  });

  // A field whose type changed between builds is dropped, not handed to a form
  // that would render or submit nonsense.
  it('drops a value whose type no longer matches', () => {
    expect(mergeDraftValues(defaults, { maxMembers: 40 }).maxMembers).toBe('40');
    expect(mergeDraftValues(defaults, { isOpen: 'yes' }).isOpen).toBe(false);
    expect(mergeDraftValues(defaults, { name: null }).name).toBe('');
  });

  it('respects array-ness in both directions', () => {
    expect(mergeDraftValues(defaults, { tags: ['a'] }).tags).toEqual(['a']);
    expect(mergeDraftValues(defaults, { tags: { 0: 'a' } }).tags).toEqual([]);
  });

  it('accepts anything for a key whose default is undefined', () => {
    expect(mergeDraftValues(defaults, { coords: { lat: 32 } }).coords).toEqual({ lat: 32 });
  });

  it('skips an explicitly undefined stored value', () => {
    expect(mergeDraftValues(defaults, { name: undefined }).name).toBe('');
  });

  it('does not mutate either input', () => {
    const stored = { name: 'x' };
    const snapshot = { ...defaults };
    mergeDraftValues(defaults, stored);
    expect(defaults).toEqual(snapshot);
    expect(stored).toEqual({ name: 'x' });
  });
});

describe('restoreValues', () => {
  it('merges and reports nothing needing attention', () => {
    expect(restoreValues({ a: '' }, { a: 'x' })).toEqual({
      values: { a: 'x' },
      needsAttention: [],
    });
  });
});

// ─── the stale kick-off ───────────────────────────────────────────────────

describe('restoreGameValues', () => {
  const defaults = { title: '', startsAt: NOW + 86_400_000, city: '' };

  it('restores a future kick-off as typed', () => {
    const future = NOW + 172_800_000;
    const out = restoreGameValues(defaults, { title: 'ערב', startsAt: future }, NOW);
    expect(out.values.startsAt).toBe(future);
    expect(out.values.title).toBe('ערב');
    expect(out.needsAttention).toEqual([]);
  });

  // Does NOT guess a replacement date. The value falls back to whatever a
  // fresh form would show, and the caller is told the person must pick one.
  it('refuses a past kick-off and asks for a new one', () => {
    const out = restoreGameValues(defaults, { title: 'ערב', startsAt: NOW - 1000 }, NOW);
    expect(out.values.startsAt).toBe(defaults.startsAt);
    expect(out.needsAttention).toEqual(['startsAt']);
  });

  it('treats exactly-now as past', () => {
    const out = restoreGameValues(defaults, { startsAt: NOW }, NOW);
    expect(out.needsAttention).toEqual(['startsAt']);
  });

  // The rest of the work is still theirs — only the date is in question.
  it('keeps every other field when the kick-off is stale', () => {
    const out = restoreGameValues(defaults, { title: 'ערב', city: 'חולון', startsAt: 1 }, NOW);
    expect(out.values.title).toBe('ערב');
    expect(out.values.city).toBe('חולון');
  });

  it('reports nothing when the draft carried no kick-off at all', () => {
    const out = restoreGameValues(defaults, { title: 'ערב' }, NOW);
    expect(out.values.startsAt).toBe(defaults.startsAt);
    expect(out.needsAttention).toEqual([]);
  });
});

// ─── lifecycle ────────────────────────────────────────────────────────────

describe('discard and consume', () => {
  it('discard removes the draft', async () => {
    await writeDraft('club', 'd1', { a: 1 }, NOW);
    await discardDraft('club');
    expect(await readDraft('club', NOW)).toBeNull();
  });

  it('discard is idempotent on an empty slot', async () => {
    await expect(discardDraft('club')).resolves.toBeUndefined();
    await expect(discardDraft('club')).resolves.toBeUndefined();
  });

  it('consume removes the draft after the work landed', async () => {
    await writeDraft('game', 'd1', { a: 1 }, NOW);
    await consumeDraft('game');
    expect(await readDraft('game', NOW)).toBeNull();
  });

  it('consume is idempotent', async () => {
    await writeDraft('game', 'd1', {}, NOW);
    await consumeDraft('game');
    await expect(consumeDraft('game')).resolves.toBeUndefined();
  });
});
