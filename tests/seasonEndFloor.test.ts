/**
 * A season cannot be ended before it has been played, and saying so is not the
 * same as offering a way out.
 *
 * Reported on a brand-new club: seasons switched on, no evening ever played,
 * and "סיים עונה עכשיו" sitting there pressable. Before the server floor
 * existed it sealed — an archive of a season holding nothing, nine `null`
 * titles, `count: 1`, permanent, because an archive is written once and never
 * recomputed.
 *
 * The floor is enforced in three places on the server and none of them is
 * enough on its own, so this pins all three plus the client's half:
 *
 *   • `endSeasonNow`        — refuses to seal under MIN_SEASON_ROUNDS
 *   • `updateSeasonTarget`  — refuses a target under it, which is the same
 *                             close reached through a number
 *   • `disableClubSeasons`  — DISCARDS an empty season instead of archiving,
 *                             so the floor above can never become a trap
 *
 * The client half is the part this round added: pressing the button on a
 * too-short season must explain the floor and OFFER the season settings, not
 * sit grey or run the destructive confirmation first.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const FNS = read(path.join('functions', 'src', 'index.ts'));
const UI = read(path.join('src', 'components', 'community', 'SeasonsSettings.tsx'));

/** One function's body, so a match cannot leak in from its neighbours. */
function bodyOf(src: string, name: string): string {
  const at = src.indexOf(`export const ${name}`);
  expect(at).toBeGreaterThan(-1);
  const next = src.indexOf('\nexport const ', at + 10);
  return src.slice(at, next > -1 ? next : undefined);
}

// ─── the floor itself ──────────────────────────────────────────────────────

describe('the minimum', () => {
  it('is two, and the client reads the same number as the server', () => {
    expect(read(path.join('functions', 'src', 'seasonActivation.ts')))
      .toMatch(/MIN_SEASON_ROUNDS\s*=\s*2/);
    expect(read(path.join('src', 'utils', 'seasonActivation.ts')))
      .toMatch(/MIN_SEASON_ROUNDS\s*=\s*2/);
  });
});

// ─── server: every way to end a season is floored ──────────────────────────

describe('ending a season on the server', () => {
  it('refuses when fewer rounds have been played than the floor', () => {
    const body = bodyOf(FNS, 'endSeasonNow');
    expect(body).toMatch(/playedSoFar\s*<\s*MIN_SEASON_ROUNDS/);
    // The refusal carries BOTH numbers so the client can say "you have 1 of 2"
    // rather than repeating a constant it hopes still matches.
    expect(body).toContain('season-close:tooFewRounds:${playedSoFar}:${MIN_SEASON_ROUNDS}');
  });

  // Setting the target to 1 is a close disguised as a number: the season is
  // over the evening it is asked for.
  it('refuses a target below the floor', () => {
    const body = bodyOf(FNS, 'updateSeasonTarget');
    expect(body).toMatch(/asked\s*<\s*MIN_SEASON_ROUNDS/);
  });

  // Without this the floor is a trap: an admin who enabled seasons by mistake
  // could neither end the season nor be rid of it.
  it('discards an empty season when seasons are switched off', () => {
    const body = bodyOf(FNS, 'disableClubSeasons');
    expect(body).toMatch(/played\s*<\s*MIN_SEASON_ROUNDS/);
    expect(body).toContain('discarded, not archived');
  });
});

// ─── client: the press is answered, not swallowed ──────────────────────────

describe('pressing "end season now" on a season that is too short', () => {
  it('knows whether the season is long enough', () => {
    expect(UI).toMatch(/const canEndSeason\s*=\s*playedThisSeason\s*>=\s*MIN_SEASON_ROUNDS/);
  });

  it('answers the press instead of running the destructive confirmation', () => {
    const at = UI.indexOf('const endNow = useCallback');
    expect(at).toBeGreaterThan(-1);
    const head = UI.slice(at, at + 1600);
    // The guard comes FIRST — before the appAlert that offers to seal.
    const guard = head.indexOf('if (!canEndSeason)');
    const confirm = head.indexOf('seasonsEndConfirmTitle');
    expect(guard).toBeGreaterThan(-1);
    expect(confirm).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(confirm);
    expect(head).toContain('offerSeasonSettings()');
  });

  it('offers the season settings rather than a dead end', () => {
    const at = UI.indexOf('const offerSeasonSettings');
    expect(at).toBeGreaterThan(-1);
    const body = UI.slice(at, at + 900);
    expect(body).toContain('seasonsEndTooEarlyTitle');
    // The same sentence the inline hint uses, which names the count and the
    // floor rather than repeating a bare "at least 2".
    expect(body).toContain('seasonBlockedTooFewRoundsAt(playedThisSeason, MIN_SEASON_ROUNDS)');
    expect(body).toContain('seasonsEditSettingsCta');
  });

  // A grey button answers "why not" and never "what now". The press has to
  // reach `endNow` for the dialog above to exist at all.
  it('leaves the button pressable so the offer can be reached', () => {
    const at = UI.indexOf('title={he.seasonsEndCta}');
    expect(at).toBeGreaterThan(-1);
    const btn = UI.slice(at, at + 1400);
    expect(btn).toContain('disabled={busy}');
    expect(btn).not.toContain('disabled={busy || !canEndSeason}');
  });

  // The reason still shows before the press, too — the dialog is the answer to
  // a press, not a replacement for saying why up front.
  it('still explains the floor inline', () => {
    expect(UI).toContain('live && !canEndSeason ?');
    expect(UI).toContain('seasonBlockedTooFewRoundsAt(playedThisSeason, MIN_SEASON_ROUNDS)');
  });
});

// ─── the copy exists and says something actionable ─────────────────────────

describe('the strings', () => {
  const he = read(path.join('src', 'i18n', 'he.ts'));

  it('has a title that does not call a refusal an error', () => {
    expect(he).toContain('seasonsEndTooEarlyTitle:');
    expect(he).not.toMatch(/seasonsEndTooEarlyTitle:\s*'שגיאה'/);
  });

  it('has a call to action pointing at the settings', () => {
    expect(he).toMatch(/seasonsEditSettingsCta:\s*'ערוך את הגדרות העונה'/);
  });

  // The zero case is its own sentence: "play one more" is wrong advice for a
  // season that has played nothing, and the empty-season remedy is different.
  it('says something different when nothing has been played', () => {
    const at = he.indexOf('seasonBlockedTooFewRoundsAt:');
    const body = he.slice(at, at + 600);
    expect(body).toContain('played <= 0');
    expect(body).toContain('עוד לא שוחק אף מחזור');
  });
});
