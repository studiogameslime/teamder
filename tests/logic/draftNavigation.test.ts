import { returnFromDraft } from '../../src/utils/draftNavigation';

describe('draft return navigation', () => {
  function navigation(keys: string[]) {
    return { getState: () => ({ index: keys.length - 1, routes: keys.map(key => ({key})) }), pop: jest.fn(), navigate: jest.fn() };
  }
  it('pops every draft step back to the exact live entry', () => {
    const nav = navigation(['details', 'live-old', 'live-source', 'setup', 'board']);
    returnFromDraft(nav as any, 'game', 'live-source');
    expect(nav.pop).toHaveBeenCalledWith(2);
    expect(nav.navigate).not.toHaveBeenCalled();
  });
  it('returns from manual editing directly to the source', () => {
    const nav = navigation(['live-source', 'setup']);
    returnFromDraft(nav as any, 'game', 'live-source');
    expect(nav.pop).toHaveBeenCalledWith(1);
  });
  it.each([undefined, 'removed-source', 'board'])('falls back safely for %s', key => {
    const nav = navigation(['details', 'board']);
    returnFromDraft(nav as any, 'game', key);
    expect(nav.pop).not.toHaveBeenCalled();
    expect(nav.navigate).toHaveBeenCalledWith('MatchDetails', {gameId:'game'});
  });
});
