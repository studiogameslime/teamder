/**
 * The nine reports from 26.09, pinned so they cannot quietly come back.
 *
 * Three of them are one bug: on the seasons settings screen the months chips
 * do NOT end season 1 when the club's history is carried into it — the date
 * chips below do, and the months only begin to apply at season 2. The screen
 * said otherwise in three places at once: the chips' own heading, the
 * activation confirmation, and a preview box that showed a live club a season
 * it is not in.
 *
 * The other six are copy and iconography, each reported with the element
 * circled in a screenshot.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const HE = read(path.join('src', 'i18n', 'he.ts'));
const SETTINGS = read(path.join('src', 'components', 'community', 'SeasonsSettings.tsx'));
const SHEET = read(path.join('src', 'components', 'community', 'SeasonConfirmSheet.tsx'));

// ─── the season-length family (reports 01, 02, 03) ─────────────────────────

describe('approved season target and confirmation wording', () => {
  it('includes existing activity in the selected goal rather than silently measuring from today', () => {
    expect(SETTINGS).toContain("choice === 'continue' && (history?.played ?? 0) > 0 ? history!.startsAt");
    expect(SETTINGS).toContain('היעד נמדד מתחילת התקופה שנכללת');
  });
  it('names which season is edited and keeps the next defaults separate', () => {
    expect(SETTINGS).toContain('העונה הנוכחית'); expect(SETTINGS).toContain('העונות הבאות');
    expect(SETTINGS).toContain('העונה הפעילה לא משתנה');
  });
  it('the confirmation explicitly describes historical inclusion and fresh starts', () => {
    expect(SHEET).toContain("selected === 'fresh'"); expect(SHEET).toContain("selected === 'sealNow'");
    expect(SHEET).toContain('היעד כולל את ההתקדמות שכבר נצברה');
  });
  it('a live date preview uses the actual season start', () => {
    expect(SETTINGS).toContain("scope === 'current' ? seasons?.startedAt");
  });
});

// ─── copy (reports 04, 08) ─────────────────────────────────────────────────

describe('copy', () => {
  it('the seal-and-restart chip reads "לסגור ולהתחיל חדשה"', () => {
    expect(HE).toMatch(/seasonsCloseFirstSeal:\s*'לסגור ולהתחיל חדשה'/);
    expect(HE).not.toContain('לסגור ולהתחיל מאפס');
  });

  it('the season numbers section is addressed to the reader', () => {
    expect(HE).toMatch(/seasonSectionNumbers:\s*'המספרים שלך בעונה'/);
  });
});

// ─── iconography (reports 06, 07, 09) ──────────────────────────────────────

describe('icons', () => {
  const SUMMARY = read(path.join('src', 'screens', 'profile', 'SeasonSummaryScreen.tsx'));

  // A tile labelled שערים should look like the goals tile everywhere else.
  // The podium celebration survives in the tint.
  it('the standing tiles carry their own stat icon', () => {
    const at = SUMMARY.indexOf('he.seasonSectionStanding');
    const block = SUMMARY.slice(at, at + 1600);
    expect(block).toContain('icon="football"');
    expect(block).toContain('icon="footsteps-outline"');
    expect(block).toContain('tint={rankTint(me.ranks.goals)}');
    expect(block).toContain('tint={rankTint(me.ranks.assists)}');
  });

  // Wins was not part of the report and keeps the medal.
  it('leaves the wins tile on its rank icon', () => {
    const at = SUMMARY.indexOf('he.seasonSectionStanding');
    const block = SUMMARY.slice(at, at + 1600);
    expect(block).toContain('icon={rankIcon(me.ranks.wins)}');
  });

  it('the club achievements heading has no icon', () => {
    const card = read(path.join('src', 'components', 'community', 'ClubAchievementsCard.tsx'));
    const at = card.indexOf('communityStatsSectionAchievements');
    const head = card.slice(Math.max(0, at - 400), at);
    expect(head).not.toContain('<Ionicons');
  });
});

// ─── the create screen's seasons row (report 05) ───────────────────────────

describe('the seasons toggle on the create screen', () => {
  const NEW = read(path.join('src', 'components', 'community', 'NewClubSeasons.tsx'));

  it('is a card like the toggles above it, not a bare row', () => {
    expect(NEW).toContain('styles.toggleCard');
    expect(NEW).not.toContain('styles.toggleRow');
    expect(NEW).toContain('backgroundColor: colors.surface');
    expect(NEW).toContain('borderRadius: radius.lg');
  });

  it('uses the same BallSwitch and is pressable as a whole', () => {
    expect(NEW).toContain('BallSwitch');
    expect(NEW).not.toMatch(/<Switch\b/);
    expect(NEW).toContain('<Pressable');
  });
});
