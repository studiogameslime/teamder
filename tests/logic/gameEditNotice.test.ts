// What an edit tells the roster — and what it deliberately doesn't.
//
// Two rules from the organiser: only TIME and PLACE are worth a push, the push
// states the new time outright, and it says the venue changed without naming it.

import {
  materialEditChanges,
  shouldNotifyRosterOfEdit,
  buildEditNotice,
  MATERIAL_EDIT_FIELDS,
} from '@/utils/gameEditNotice';

/** A game as the edit form submits it — the WHOLE state, every time. */
const game = {
  title: 'חמישי כדורגל',
  startsAt: 1_700_000_000_000,
  fieldName: 'אולם א',
  fieldAddress: 'שדרות אליהו סעדון',
  city: 'אור יהודה',
  durationMinutes: 90,
  maxPlayers: 15,
  notes: '',
  ruleTags: ['בלי מגלשות'],
  acceptsFillers: false,
  visibility: 'community',
};

describe('nothing the roster needs to hear about', () => {
  it('an unchanged save says nothing — the form resubmits everything', () => {
    // The heart of the original bug: the form always carries startsAt, so a
    // key-presence test would still have pushed on a typo fix.
    expect(buildEditNotice({ ...game }, game)).toBeNull();
  });

  it('title, notes, rule chips, filler settings, visibility', () => {
    for (const patch of [
      { title: 'חמישי כדורגל!' },
      { notes: 'להביא מים' },
      { ruleTags: ['בלי סלייד'] },
      { acceptsFillers: true },
      { visibility: 'public' },
      { autoTeamsAt: 123 },
    ]) {
      expect(shouldNotifyRosterOfEdit({ ...game, ...patch }, game)).toBe(false);
    }
  });

  it('duration and capacity are NOT notifiable — the organiser said so', () => {
    // These used to push. They are the organiser's business.
    expect(shouldNotifyRosterOfEdit({ ...game, durationMinutes: 120 }, game)).toBe(false);
    expect(shouldNotifyRosterOfEdit({ ...game, maxPlayers: 22 }, game)).toBe(false);
  });

  it('clearing an optional venue field that was already empty', () => {
    const noAddress = { ...game, fieldAddress: '' };
    expect(shouldNotifyRosterOfEdit({ fieldAddress: null }, noAddress)).toBe(false);
    expect(shouldNotifyRosterOfEdit({ fieldAddress: undefined }, noAddress)).toBe(false);
  });
});

describe('a moved kickoff states the NEW time', () => {
  const moved = game.startsAt + 3_600_000;

  it('carries the new time as a value', () => {
    expect(buildEditNotice({ ...game, startsAt: moved }, game)).toEqual({
      newStartsAt: moved,
    });
  });

  it('states the new time only — never where it moved FROM', () => {
    // Edits inside the 60s dedup window collapse into one push, so "moved from
    // X" could span three edits and be wrong. The new time is right whatever
    // happened before it.
    const notice = buildEditNotice({ ...game, startsAt: moved }, game)!;
    expect(Object.values(notice)).not.toContain(game.startsAt);
  });
});

describe('a moved venue says THAT it changed, not WHERE', () => {
  it('flags the change without carrying any address', () => {
    const notice = buildEditNotice({ ...game, fieldName: 'אולם ב' }, game)!;
    expect(notice).toEqual({ placeChanged: true });
    // The whole point: the new venue must not travel in the payload.
    expect(JSON.stringify(notice)).not.toContain('אולם ב');
  });

  it('any of the three venue fields counts as one place change', () => {
    for (const patch of [
      { fieldName: 'אולם ב' },
      { fieldAddress: 'רחוב אחר 5' },
      { city: 'רמת גן' },
    ]) {
      expect(buildEditNotice({ ...game, ...patch }, game)).toEqual({ placeChanged: true });
    }
  });

  it('two venue fields at once is still ONE place change', () => {
    expect(
      buildEditNotice({ ...game, fieldName: 'אולם ב', city: 'רמת גן' }, game),
    ).toEqual({ placeChanged: true });
  });

  it('a venue appearing for the first time counts', () => {
    const noAddress = { ...game, fieldAddress: '' };
    expect(buildEditNotice({ fieldAddress: 'שדרות אליהו סעדון' }, noAddress))
      .toEqual({ placeChanged: true });
  });
});

describe('both at once', () => {
  it('carries the new time AND the place flag', () => {
    const moved = game.startsAt + 7_200_000;
    expect(
      buildEditNotice({ ...game, startsAt: moved, city: 'חולון' }, game),
    ).toEqual({ newStartsAt: moved, placeChanged: true });
  });

  it('reports every notifiable field that moved', () => {
    const patch = { ...game, startsAt: 1, city: 'חולון', title: 'אחר' };
    expect(materialEditChanges(patch, game).sort()).toEqual(['city', 'startsAt']);
  });
});

describe('the field list itself', () => {
  it('is exactly time and venue — nothing else notifies', () => {
    expect([...MATERIAL_EDIT_FIELDS].sort()).toEqual(
      ['city', 'fieldAddress', 'fieldName', 'startsAt'].sort(),
    );
  });

  it('each listed field on its own produces a notice', () => {
    // Guards the list: adding a field without it actually working would pass
    // every other test here.
    for (const f of MATERIAL_EDIT_FIELDS) {
      const patch = { [f]: f === 'startsAt' ? game.startsAt + 1 : 'שונה' };
      expect(shouldNotifyRosterOfEdit(patch, game)).toBe(true);
    }
  });
});
