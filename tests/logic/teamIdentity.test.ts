import {
  teamName,
  teamDot,
  teamLetter,
  teamPaletteEntry,
  TEAM_PALETTE,
} from '@/utils/teamIdentity';
import { resolveSplitTeams } from '@/utils/draftTeamsView';

// The reported game 6HMQeD17G8zjGZaffYQJ: the admin set the bibs to
// green / yellow / white and every non-live surface kept saying red/blue/green.
const CHOSEN = [
  { index: 0, colorKey: 'green' },
  { index: 1, colorKey: 'yellow' },
  { index: 2, colorKey: 'white' },
];

describe('teamName', () => {
  it('uses the chosen colour, not the index default', () => {
    expect(teamName(0, CHOSEN)).toBe('הירוקים');
    expect(teamName(1, CHOSEN)).toBe('הצהובים');
    expect(teamName(2, CHOSEN)).toBe('הלבנים');
  });

  it('falls back to the index default when no colour was chosen', () => {
    expect(teamName(0)).toBe('קבוצה אדומה');
    expect(teamName(1)).toBe('קבוצה כחולה');
    expect(teamName(2)).toBe('קבוצה ירוקה');
  });

  it('mixes: an unset team keeps its default while its neighbours are chosen', () => {
    const partial = [{ index: 0, colorKey: 'white' }, { index: 1 }];
    expect(teamName(0, partial)).toBe('הלבנים');
    expect(teamName(1, partial)).toBe('קבוצה כחולה');
  });

  it('matches by team index, not array position', () => {
    const outOfOrder = [{ index: 2, colorKey: 'black' }, { index: 0, colorKey: 'red' }];
    expect(teamName(2, outOfOrder)).toBe('השחורים');
    expect(teamName(0, outOfOrder)).toBe('האדומים');
  });

  it('ignores an unknown colour key rather than blanking the name', () => {
    expect(teamName(0, [{ index: 0, colorKey: 'chartreuse' }])).toBe('קבוצה אדומה');
  });

  it('falls back to the Hebrew letter past the palette, then to the number', () => {
    expect(teamLetter(6)).toBe('ז');
    expect(teamLetter(7)).toBe('8');
  });
});

describe('teamDot — the WhatsApp export', () => {
  it('follows the chosen colour', () => {
    expect(teamDot(0, CHOSEN)).toBe('🟢');
    expect(teamDot(1, CHOSEN)).toBe('🟡');
    expect(teamDot(2, CHOSEN)).toBe('⚪');
  });

  it('follows the index default otherwise', () => {
    expect(teamDot(0)).toBe('🔴');
    expect(teamDot(1)).toBe('🔵');
  });
});

describe('palette', () => {
  it('every entry has a distinct key and a dot', () => {
    const keys = TEAM_PALETTE.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(TEAM_PALETTE.every((p) => !!p.dot && !!p.plural && /^#/.test(p.hex))).toBe(true);
  });

  it('resolves a key, and returns undefined for none/unknown', () => {
    expect(teamPaletteEntry('white')?.plural).toBe('הלבנים');
    expect(teamPaletteEntry(undefined)).toBeUndefined();
    expect(teamPaletteEntry('nope')).toBeUndefined();
  });
});

describe('resolveSplitTeams carries colorKey', () => {
  it('keeps it from originalTeams — the array the record renders', () => {
    const split = resolveSplitTeams({
      teams: [{ index: 0, playerIds: ['a'], colorKey: 'green' }],
      originalTeams: [{ index: 0, playerIds: ['a', 'b'], colorKey: 'green' }],
    });
    expect(split[0].colorKey).toBe('green');
    expect(teamName(0, split)).toBe('הירוקים');
  });

  it('borrows the draft colour when falling back to rotation.baseTeams', () => {
    const split = resolveSplitTeams(
      { teams: [{ index: 0, playerIds: [], colorKey: 'yellow' }] },
      { baseTeams: [{ index: 0, playerIds: ['x', 'y'] }] },
    );
    expect(split[0].colorKey).toBe('yellow');
  });

  it('leaves colorKey absent when no colour was ever chosen', () => {
    const split = resolveSplitTeams({ teams: [{ index: 0, playerIds: ['a'] }] });
    expect(split[0].colorKey).toBeUndefined();
    expect(teamName(0, split)).toBe('קבוצה אדומה');
  });
});
