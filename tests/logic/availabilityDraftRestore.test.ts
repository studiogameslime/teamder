/**
 * What a guest filled in survives the sign-in — all of it.
 *
 * The principle the whole refactor rests on is that authentication in the
 * middle of an action loses nothing already entered. This lost a map pin.
 *
 * The draft is written as `{ availability, coords }` — the coords sit BESIDE
 * the availability object because the reverse-geocode happened while the
 * person was still on the screen. The restore read only the first half, and
 * the second half is what decides whether the home area is on: the screen
 * derives that from `homeCityLat/Lng`, which live nowhere else. So a guest who
 * pinned a home area came back to a toggle that was off, and the next save
 * wrote `acceptsFillerPush: false`.
 *
 * The derivation under test is the one the screen performs on mount. It is
 * asserted here rather than in a renderer because this harness has none — and
 * because the property is about DATA: given what was parked, what should the
 * form hold?
 */

import fs from 'fs';
import path from 'path';

import {
  restoreAvailabilityDraft,
  DEFAULT_CENTER,
} from '@/utils/availabilityDraft';

const AV = {
  preferredDays: [2, 5],
  preferredTimes: ['evening'],
  availabilitySlots: { '2': ['evening'] },
  homeCity: 'תל אביב',
  availabilityRadiusKm: 25,
  acceptsFillerPush: true,
} as never;

const COORDS = { lat: 32.0853, lng: 34.7818 };

// ─── everything the person entered comes back ─────────────────────────────

describe('a draft with a home area', () => {
  const r = () => restoreAvailabilityDraft({ availability: AV, coords: COORDS })!;

  it('brings the coords back onto the availability shape', () => {
    expect(r().availability).toMatchObject({
      homeCityLat: 32.0853,
      homeCityLng: 34.7818,
    });
  });

  // The toggle is DERIVED from the coords; it is not stored separately, which
  // is exactly why dropping them turned it off.
  it('leaves the home area enabled', () => {
    expect(r().locationEnabled).toBe(true);
  });

  // A pin somebody placed is a choice. Making them place it again is the loss
  // this exists to prevent.
  it('counts the pin as chosen', () => {
    expect(r().locationPicked).toBe(true);
  });

  it('keeps the radius they dragged', () => {
    expect(r().availability.availabilityRadiusKm).toBe(25);
  });

  it('keeps the days, times and the grid', () => {
    expect(r().availability).toMatchObject({
      preferredDays: [2, 5],
      preferredTimes: ['evening'],
      availabilitySlots: { '2': ['evening'] },
    });
  });

  it('keeps the city name', () => {
    expect(r().availability.homeCity).toBe('תל אביב');
  });

  // The whole point of the chain: a save after this restore produces the same
  // preference a save without any sign-in would have.
  it('would save the same acceptsFillerPush as an uninterrupted save', () => {
    const { locationEnabled, availability } = r();
    const notify = availability.acceptsFillerPush !== false;
    expect(locationEnabled ? notify : false).toBe(true);
  });
});

// ─── no home area stays no home area ──────────────────────────────────────

describe('a draft without a home area', () => {
  // Nothing may be inferred to fill the gap. Somebody who never picked an area
  // must come back to one that is off, and a save then writes
  // `acceptsFillerPush: false` — correctly, because `fillerOpportunity` would
  // have nowhere to match them.
  it('stays off', () => {
    const out = restoreAvailabilityDraft({ availability: AV, coords: null })!;
    expect(out.locationEnabled).toBe(false);
    expect(out.locationPicked).toBe(false);
    expect(out.availability.homeCityLat).toBeUndefined();
  });

  it('would save acceptsFillerPush false, whatever the toggle said', () => {
    const { locationEnabled, availability } = restoreAvailabilityDraft({
      availability: AV,
      coords: null,
    })!;
    const notify = availability.acceptsFillerPush !== false;
    expect(locationEnabled ? notify : false).toBe(false);
  });

  it('still brings the grid and the radius back', () => {
    const out = restoreAvailabilityDraft({ availability: AV, coords: null })!;
    expect(out.availability).toMatchObject({
      preferredDays: [2, 5],
      availabilityRadiusKm: 25,
    });
  });
});

// ─── old and broken drafts ────────────────────────────────────────────────

describe('a draft that is not the current shape', () => {
  // Written before coords were parked at all. Best effort: everything else
  // comes back, the home area does not, nothing crashes.
  it('survives having no coords key', () => {
    const out = restoreAvailabilityDraft({ availability: AV })!;
    expect(out.locationEnabled).toBe(false);
    expect(out.availability.preferredDays).toEqual([2, 5]);
  });

  it.each([
    ['strings', { lat: '32.1', lng: '34.8' }],
    ['NaN', { lat: NaN, lng: NaN }],
    ['Infinity', { lat: Infinity, lng: 34.8 }],
    ['half a pair', { lat: 32.1 }],
    ['nonsense', 'tel aviv'],
  ])('refuses %s rather than trusting it', (_label, coords) => {
    const out = restoreAvailabilityDraft({ availability: AV, coords } as never)!;
    expect(out.locationEnabled).toBe(false);
    expect(out.availability.homeCityLat).toBeUndefined();
  });

  it('returns null for a draft with no availability at all', () => {
    expect(restoreAvailabilityDraft({ coords: COORDS } as never)).toBeNull();
    expect(restoreAvailabilityDraft(null as never)).toBeNull();
    expect(restoreAvailabilityDraft(undefined as never)).toBeNull();
  });
});

// ─── the map's opening view is not a choice ───────────────────────────────

describe('a draft carrying the default map centre', () => {
  // The screen has always refused to treat the map's opening position as a
  // picked location — it once wrote 'בני ברק' as people's home city that way.
  // A restore must not smuggle it back in as a choice.
  it('enables the section but does not call the pin chosen', () => {
    const out = restoreAvailabilityDraft({
      availability: AV,
      coords: { ...DEFAULT_CENTER },
    });
    expect(out!.locationEnabled).toBe(true);
    expect(out!.locationPicked).toBe(false);
  });
});

// ─── the draft's lifetime ─────────────────────────────────────────────────
//
// Cleared only on a terminal business success. The coordinator's own suite
// already proves that end (terminal clears both, a retryable failure keeps
// both, the retry then clears). What it cannot show is the CANCEL: backing
// out of the auth sheet must leave everything on disk, and the only way that
// stays true is that nothing on the cancel path touches it.

const ROOT = path.resolve(__dirname, '..', '..');
const code = (rel: string) =>
  fs
    .readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('backing out of the auth sheet', () => {
  it('does not touch the stash or the draft', () => {
    const hook = code(path.join('src', 'hooks', 'useAuthenticatedAction.tsx'));
    const at = hook.indexOf('const onCancel');
    expect(at).toBeGreaterThan(-1);
    const branch = hook.slice(at, at + 260);
    expect(branch).not.toMatch(/clearPendingAction|draftStore|discard|consume/);
  });

  // And the screen must not clear on its way out either — a draft is cleared
  // when the work it represents is DONE, never because a component unmounted.
  it('and neither does leaving the screen', () => {
    const screen = code(
      path.join('src', 'screens', 'profile', 'AvailabilityEditScreen.tsx'),
    );
    expect(screen).not.toMatch(/draftStore\.(discard|consume|clear)/);
  });
});
