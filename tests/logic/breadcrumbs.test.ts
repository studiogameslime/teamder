/**
 * The trail that rides along on a user report.
 *
 * Asked for by the owner on 02.10 while filing a bug he knew nobody could
 * reproduce ("פתאום זה לא לוחץ לי על הכפתור"). The point of it is narrow and
 * worth stating: a tap that no control claims produces no analytics event, no
 * navigation and no error — it is invisible in every log the app keeps. The
 * trail records the raw touch, so a tap with nothing after it finally shows up
 * as what it is.
 */
import {
  clearTrail,
  crumbAct,
  crumbErr,
  crumbNav,
  crumbTap,
  formatTrail,
  trailLength,
} from '@/services/breadcrumbs';

beforeEach(() => clearTrail());

describe('what the trail records', () => {
  it('is empty before anything happens', () => {
    expect(formatTrail()).toBe('');
  });

  it('keeps a dead tap — a touch with nothing after it', () => {
    crumbNav('CommunityDetails');
    crumbTap(120, 480);

    const out = formatTrail();
    expect(out).toContain('nav CommunityDetails');
    expect(out).toContain('tap 120,480');
    // Nothing follows the tap. That absence IS the finding.
    expect(out.trim().split('\n')).toHaveLength(2);
  });

  it('shows a LIVE tap as a tap followed by what it caused', () => {
    crumbTap(300, 90);
    crumbAct('community_chat_opened');

    expect(formatTrail().trim().split('\n')).toEqual([
      expect.stringContaining('tap 300,90'),
      expect.stringContaining('act community_chat_opened'),
    ]);
  });

  it('rounds coordinates — a decimal place helps nobody', () => {
    crumbTap(119.63, 480.2);
    expect(formatTrail()).toContain('tap 120,480');
  });

  it('records failures by operation, never the message', () => {
    crumbErr('joinGroup');
    expect(formatTrail()).toContain('err joinGroup');
  });
});

describe('what the trail refuses to do', () => {
  it('collapses a stutter into one tap', () => {
    crumbTap(10, 10);
    crumbTap(11, 11); // same gesture, milliseconds later
    expect(trailLength()).toBe(1);
  });

  it('does not repeat the screen you are already on', () => {
    crumbNav('Home');
    crumbNav('Home');
    expect(trailLength()).toBe(1);
  });

  it('holds at most 50 steps, keeping the NEWEST', () => {
    for (let i = 0; i < 80; i += 1) crumbAct(`e${i}`);
    expect(trailLength()).toBe(50);
    const out = formatTrail();
    expect(out).toContain('e79');
    expect(out).not.toContain('e29');
  });

  it('is wiped on sign-out, so one person cannot reach another report', () => {
    crumbAct('something');
    clearTrail();
    expect(formatTrail()).toBe('');
  });
});

describe('how it reads', () => {
  it('times every step relative to the LAST one, oldest first', () => {
    crumbAct('first');
    crumbAct('last');
    const lines = formatTrail().trim().split('\n');
    expect(lines[0]).toMatch(/^-\d+\.\d+s act first$/);
    // The final step is the reference point, so it is always -0.0s.
    expect(lines[1]).toBe('-0.0s act last');
  });
});
