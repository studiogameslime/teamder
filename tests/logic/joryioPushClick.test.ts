/**
 * A Joryio campaign push must report its click.
 *
 * Two ways this silently breaks, both of which shipped:
 *   1. `trackPushClick` exists in the service and is never called, so every
 *      marketing push reads as delivered-and-never-opened.
 *   2. It IS called, but after `if (!type) return` — and a Joryio push carries
 *      `trackingId`, not one of OUR `type`s, so the handler bails first.
 *
 * Neither produces an error at runtime; the click just never exists.
 */
import * as fs from 'fs';
import * as path from 'path';

const APP = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

describe('joryio push click reporting', () => {
  it('the tap handler reports the click', () => {
    expect(APP).toMatch(/joryio\.trackPushClick\(/);
  });

  it('reads the trackingId the server actually sends', () => {
    expect(APP).toMatch(/data\.trackingId/);
  });

  it('reports before the `!type` bail-out, which a Joryio push always hits', () => {
    const report = APP.indexOf('joryio.trackPushClick(');
    const bail = APP.indexOf('if (!type) return;');
    expect(report).toBeGreaterThan(-1);
    expect(bail).toBeGreaterThan(-1);
    expect(report).toBeLessThan(bail);
  });
});
