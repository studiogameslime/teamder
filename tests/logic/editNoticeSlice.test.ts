// The slice updateGameV2 diffs an edit against must carry every field the
// diff looks at.
//
// It did not. `existing` was a four-field object literal written for the
// overlap and status guards — startsAt, registrationOpensAt, groupId, status —
// and buildEditNotice was later pointed at the same object. So fieldName,
// fieldAddress and city were compared against `undefined` on every edit, and
// EVERY save of a game that had a venue told the whole roster
// "המיקום השתנה · בדוק בפרטי המחזור", whatever the organiser had touched.
//
// Reported by an organiser who set only the scheduled-teams time on the
// evening's game and watched the roster get a location-change push.
//
// `startsAt` was in the slice, which is why the time half of the notice was
// correct all along and only the venue half lied — the kind of partial
// correctness that makes a bug look like a one-off.
//
// The failure mode is silent: nothing throws, the push just says something
// untrue. So the test is on the SHAPE, not on one scenario.

import {
  MATERIAL_EDIT_FIELDS,
  gameSliceForEdit,
  buildEditNotice,
  materialEditChanges,
} from '@/utils/gameEditNotice';

const game = {
  startsAt: 1789045200000,
  registrationOpensAt: 1788959018113,
  groupId: 'g1',
  status: 'open',
  fieldName: 'שדרות אליהו סעדון, אור יהודה',
  fieldAddress: 'שדרות אליהו סעדון, אור יהודה',
  city: 'אור יהודה',
};

/** The slice as the notice sees it — the same cast updateGameV2 makes. */
const slice = (g: typeof game) =>
  gameSliceForEdit(g) as unknown as Record<string, unknown>;

/** What GameEditScreen submits: the whole form, every time. */
function formPatch(over: Partial<typeof game> = {}) {
  const v = { ...game, ...over };
  return {
    title: 'כדורגל רביעי',
    startsAt: v.startsAt,
    fieldName: v.fieldName.trim(),
    city: v.city.trim() || undefined,
    fieldAddress: v.fieldAddress.trim() || undefined,
    maxPlayers: 10,
    notes: undefined,
    autoTeamsAt: 1788969600000,
    autoTeamsMethod: 'rating',
  };
}

describe('the edit slice covers everything the notice diffs', () => {
  it('carries every MATERIAL_EDIT_FIELD', () => {
    const slice = gameSliceForEdit(game) as unknown as Record<string, unknown>;
    for (const field of MATERIAL_EDIT_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(slice, field)).toBe(true);
    }
  });

  it('carries them with the game values, not undefined', () => {
    const slice = gameSliceForEdit(game) as unknown as Record<string, unknown>;
    for (const field of MATERIAL_EDIT_FIELDS) {
      expect(slice[field]).toBe((game as Record<string, unknown>)[field]);
    }
  });

  it('still carries what the overlap and status guards need', () => {
    const slice = gameSliceForEdit(game);
    expect(slice.groupId).toBe('g1');
    expect(slice.status).toBe('open');
    expect(slice.registrationOpensAt).toBe(1788959018113);
  });
});

describe('an edit that touches nothing material says nothing', () => {
  it('scheduling the teams does not claim the venue moved — the report', () => {
    const notice = buildEditNotice(formPatch(), slice(game));
    expect(notice).toBeNull();
  });

  it('re-saving the form unchanged is silent', () => {
    expect(materialEditChanges(formPatch(), slice(game))).toEqual([]);
  });

  it('a game with no venue at all is still silent', () => {
    const bare = { ...game, fieldName: '', fieldAddress: '', city: '' };
    expect(
      buildEditNotice(formPatch(bare), slice(bare)),
    ).toBeNull();
  });
});

describe('and a real change still speaks', () => {
  it('a moved kickoff states the new time and not the venue', () => {
    const moved = { ...game, startsAt: game.startsAt + 3600_000 };
    const notice = buildEditNotice(formPatch(moved), slice(game));
    expect(notice).toEqual({ newStartsAt: moved.startsAt });
  });

  it('a new venue flags the place without naming it', () => {
    const moved = { ...game, fieldName: 'מגרש אחר', fieldAddress: 'מגרש אחר' };
    const notice = buildEditNotice(formPatch(moved), slice(game));
    expect(notice).toEqual({ placeChanged: true });
    expect(JSON.stringify(notice)).not.toContain('מגרש אחר');
  });

  it('a changed city alone counts as the place changing', () => {
    const moved = { ...game, city: 'תל אביב' };
    const notice = buildEditNotice(formPatch(moved), slice(game));
    expect(notice).toEqual({ placeChanged: true });
  });

  it('both moving says both', () => {
    const moved = {
      ...game,
      startsAt: game.startsAt + 3600_000,
      fieldName: 'מגרש אחר',
    };
    const notice = buildEditNotice(formPatch(moved), slice(game));
    expect(notice).toEqual({
      newStartsAt: moved.startsAt,
      placeChanged: true,
    });
  });
});
