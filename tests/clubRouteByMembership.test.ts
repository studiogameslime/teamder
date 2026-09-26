/**
 * A non-member must never be sent to the members' club page.
 *
 * `CommunityDetails` reads the canonical `/groups/{gid}` document, and the
 * rules gate that on membership:
 *
 *     allow read: if isSignedIn() && (
 *       request.auth.uid in resource.data.playerIds ||
 *       request.auth.uid in resource.data.adminIds ||
 *       request.auth.uid in resource.data.pendingPlayerIds
 *     );
 *
 * So opening it as a non-member is not a thinner page — it is
 * `permission-denied` and a screen with nothing on it.
 *
 * The clubs feed always branched correctly. Two other entry points did not: the
 * club chips on a player card, and the club row on a match screen. Both are
 * reachable by a GUEST (a public game → its roster → a player card, or the
 * match screen itself), and 1.1.15 put far more guests in front of exactly
 * those surfaces. Production reported it the morning the rollout began:
 * `getGroup` and `communityDetailsReload`, permission-denied, on 1.1.15.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ─── the rule, as behaviour ────────────────────────────────────────────────

const groups: { id: string }[] = [];
jest.mock('@/store/groupStore', () => ({
  useGroupStore: { getState: () => ({ groups }) },
}));

import { clubRouteFor } from '@/utils/clubRoute';

describe('choosing a club page', () => {
  beforeEach(() => {
    groups.length = 0;
  });

  it('sends a member to the members page', () => {
    groups.push({ id: 'g1' });
    expect(clubRouteFor('g1')).toBe('CommunityDetails');
  });

  it('sends a non-member to the public page', () => {
    groups.push({ id: 'g1' });
    expect(clubRouteFor('g2')).toBe('CommunityDetailsPublic');
  });

  // A guest has no clubs at all, and the members' page is the one thing that
  // cannot render for them.
  it('sends a guest to the public page', () => {
    expect(clubRouteFor('g1')).toBe('CommunityDetailsPublic');
  });

  // Before the store hydrates the answer is "not a member". Too cautious costs
  // a member one tap; too permissive costs a guest the whole screen.
  it('defaults to the public page when nothing is loaded yet', () => {
    expect(clubRouteFor('anything')).toBe('CommunityDetailsPublic');
  });
});

// ─── every entry point goes through it ─────────────────────────────────────

describe('the screens that link to a club', () => {
  const SITES = [
    path.join('src', 'screens', 'players', 'PlayerCardScreen.tsx'),
    path.join('src', 'screens', 'games', 'MatchDetailsScreen.tsx'),
  ];

  it.each(SITES)('routes by membership rather than hard-coding — %s', (rel) => {
    const src = read(rel);
    expect(src).toContain("from '@/utils/clubRoute'");
    // The members' page is never named directly at a navigate() call here.
    expect(src).not.toMatch(/navigate\(\s*'CommunityDetails'/);
  });

  // The feed already did this correctly and must keep doing it.
  it('leaves the clubs feed branching as it was', () => {
    const feed = read(
      path.join('src', 'screens', 'communities', 'PublicGroupsFeedScreen.tsx'),
    );
    expect(feed).toContain("memberIds.has(item.id)");
    expect(feed).toContain("navigate('CommunityDetailsPublic'");
  });
});

// ─── and the destination exists wherever the source does ───────────────────

/**
 * The other half, and the one that turns a fix into a dead button.
 *
 * `navigate()` on a name the focused stack does not register does nothing and
 * reports nothing. PlayerCard is registered in all four stacks; the club pages
 * were registered in three. Routing the chips correctly from the chats tab
 * would have swapped a permission-denied for silence.
 */
describe('stack registration', () => {
  const STACKS = ['ProfileStack', 'CommunitiesStack', 'GameStack', 'ChatStack'];
  const srcOf = (s: string) => read(path.join('src', 'navigation', `${s}.tsx`));

  it.each(STACKS)('%s registers a club page wherever it registers PlayerCard', (stack) => {
    const src = srcOf(stack);
    if (!src.includes('name="PlayerCard"')) return;
    expect(src).toContain('name="CommunityDetails"');
    expect(src).toContain('name="CommunityDetailsPublic"');
  });

  it.each(STACKS)('%s registers a club page wherever it registers MatchDetails', (stack) => {
    const src = srcOf(stack);
    if (!src.includes('name="MatchDetails"')) return;
    expect(src).toContain('name="CommunityDetailsPublic"');
  });
});
