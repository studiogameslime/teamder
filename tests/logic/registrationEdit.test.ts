import { registrationEditPatch, registrationEditStatus } from '@/utils/registrationEdit';

const NOW = 1800000000000;
const LATER = NOW + 86400000;
describe('editing the registration gate without changing participants', () => {
  it('closes an already open round until the chosen time, retaining the roster and queue', () => {
    const game = { status: 'open', players: ['registered'], waitlist: ['waiting'], pending: ['request'], guests: [{ id: 'guest' }], pendingPromotion: { uid: 'offered' }, openedNotificationSent: true };
    const patch = registrationEditPatch(game.status, true, LATER, NOW);
    const status = registrationEditStatus(game.status, patch.registrationOpensAt!, NOW);
    const next = { ...game, ...patch, status };
    expect(next.status).toBe('scheduled');
    for (const key of ['players', 'waitlist', 'pending', 'guests', 'pendingPromotion', 'openedNotificationSent'] as const) {
      expect(next[key]).toBe(game[key]);
    }
    expect(patch.registrationOpensAt).toBe(LATER);
  });
  it('updates a scheduled time and makes disabling due now for the existing server opener', () => {
    expect(registrationEditPatch('scheduled', true, LATER, NOW)).toEqual({ registrationOpensAt: LATER });
    expect(registrationEditPatch('scheduled', false, LATER, NOW)).toEqual({ registrationOpensAt: NOW });
  });
  it('does not close an open round for an elapsed or cleared time', () => {
    expect(registrationEditStatus('open', NOW, NOW)).toBeUndefined();
    expect(registrationEditStatus('open', 0, NOW)).toBeUndefined();
    expect(registrationEditPatch('open', false, LATER, NOW)).toEqual({ registrationOpensAt: 0 });
  });
  it('cannot reopen locked, active or terminal rounds through this gate', () => {
    for (const status of ['locked', 'active', 'finished', 'cancelled']) {
      expect(registrationEditPatch(status, true, LATER, NOW)).toEqual({});
      expect(registrationEditStatus(status, LATER, NOW)).toBeUndefined();
    }
  });
});
