// The closed list is the point: a dashboard typo must read as "not ours" and
// fall through to the invite parser, never resolve to a route that does not
// exist.

import { parseAppLink, buildAppLink } from '@/utils/appLinks';

describe('parseAppLink', () => {
  it('reads a destination off the custom scheme', () => {
    expect(parseAppLink('footy://open/games')).toEqual({ dest: 'games' });
    expect(parseAppLink('teamder://open/create-community')).toEqual({
      dest: 'create-community',
    });
  });

  it('carries the role when the link is also an answer', () => {
    expect(parseAppLink('footy://open/create-community?role=organiser')).toEqual({
      dest: 'create-community',
      role: 'organiser',
    });
    expect(parseAppLink('footy://open/games?role=player')).toEqual({
      dest: 'games',
      role: 'player',
    });
  });

  it('drops a role it does not know rather than storing it', () => {
    expect(parseAppLink('footy://open/games?role=coach')).toEqual({ dest: 'games' });
  });

  it('accepts the https form', () => {
    expect(parseAppLink('https://teamderfc.web.app/open/communities')).toEqual({
      dest: 'communities',
    });
  });

  it('refuses an unknown destination', () => {
    expect(parseAppLink('footy://open/settings')).toBeNull();
    expect(parseAppLink('footy://open/')).toBeNull();
    expect(parseAppLink('footy://open')).toBeNull();
  });

  // The whole reason the host is `open`. deepLinkService already reads
  // footy://go as the generic app-invite link; if this parser claimed it too,
  // a campaign tap would be recorded as an acquisition referral.
  it('leaves the invite hosts alone', () => {
    expect(parseAppLink('footy://go')).toBeNull();
    expect(parseAppLink('footy://go?s=fb')).toBeNull();
    expect(parseAppLink('footy://app')).toBeNull();
    expect(parseAppLink('footy://session/abc123')).toBeNull();
    expect(parseAppLink('footy://team/xyz')).toBeNull();
    expect(parseAppLink('https://teamderfc.web.app/session/abc')).toBeNull();
  });

  it('refuses a scheme that is not ours', () => {
    expect(parseAppLink('https://example.com/open/games')).toBeNull();
    expect(parseAppLink('evil://open/games')).toBeNull();
  });

  it('survives junk', () => {
    expect(parseAppLink('')).toBeNull();
    expect(parseAppLink('not a url')).toBeNull();
  });

  it('round-trips what it builds', () => {
    expect(parseAppLink(buildAppLink('create-game'))).toEqual({ dest: 'create-game' });
    expect(parseAppLink(buildAppLink('games', 'player'))).toEqual({
      dest: 'games',
      role: 'player',
    });
  });
});
