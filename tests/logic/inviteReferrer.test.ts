/**
 * The inviter must survive the Play Store.
 *
 * A personal invite can reach the store two ways, and the landing page picks
 * between them on whether the link carries a `source`. Only one of the two
 * used to carry the inviter: a tracked link built the referrer as a UTM
 * string with nowhere to put him, so the installer opened the app and the
 * invitation was simply not there. It appeared on the SECOND tap, once the
 * app was installed and the deep link could carry it directly — which is
 * exactly how it was reported.
 */
import { parseReferrerInvite } from '@/utils/referrerInvite';

describe('an inviter in a tracked (UTM) referrer', () => {
  it('is read when the landing page sends one', () => {
    const r = parseReferrerInvite('utm_source=whatsapp&utm_campaign=sept&by=uid-123');
    expect(r).toMatchObject({ type: 'app', source: 'whatsapp', invitedBy: 'uid-123' });
  });

  it('rides alongside a game target', () => {
    const r = parseReferrerInvite('utm_source=sms&g=game-9&by=uid-7');
    expect(r).toMatchObject({ type: 'session', id: 'game-9', invitedBy: 'uid-7' });
  });

  it('is simply absent on every referrer emitted before this', () => {
    // Backward compatibility: the old string still parses, it just credits
    // nobody — which is what it always did.
    const r = parseReferrerInvite('utm_source=whatsapp&utm_campaign=sept');
    expect(r).toMatchObject({ type: 'app', source: 'whatsapp' });
    expect((r as { invitedBy?: string }).invitedBy).toBeUndefined();
  });

  it('still reads the non-UTM form, which always carried him', () => {
    expect(parseReferrerInvite('invite_app_by_uid-5')).toEqual({
      type: 'app',
      invitedBy: 'uid-5',
    });
  });
});
