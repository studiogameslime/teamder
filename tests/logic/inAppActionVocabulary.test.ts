/**
 * The in-app action string is wire protocol, not a label.
 *
 * Joryio's backend classifies an interaction by SUBSTRING: an action containing
 * 'click' is a click, one containing 'dismiss' is a dismissal, and ANYTHING
 * ELSE falls through to a display. A friendly label — 'impression', 'button:cta',
 * 'backdrop' — therefore reports another display, so a campaign shows
 * impressions it never had and zero clicks it did. That shipped once; this test
 * is why it cannot ship twice.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const ALLOWED = ['displayed', 'clicked', 'dismissed'];

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('in-app action vocabulary', () => {
  const files = sources(path.join(ROOT, 'src'));

  it('every literal passed to trackInAppImpression is one the backend classifies', () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      // Second argument only when it is a plain string literal; a variable is
      // covered by the InAppAction union at compile time instead.
      const re = /trackInAppImpression\(\s*[^,]+,\s*'([^']*)'/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (!ALLOWED.includes(m[1])) bad.push(`${path.relative(ROOT, f)}: '${m[1]}'`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the wrapper types the action so a stray string cannot compile', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/services/joryio.ts'), 'utf8');
    expect(src).toMatch(/export type InAppAction =/);
    for (const a of ALLOWED) expect(src).toContain(`'${a}'`);
    expect(src).toMatch(/trackInAppImpression\(campaignId: string, action: InAppAction\)/);
  });

  it('a button tap reports a click, not just a close', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'src/components/joryio/InAppMessageHost.tsx'), 'utf8');
    expect(src).toMatch(/trackInAppImpression\(msg\.id, 'clicked'\)/);
    expect(src).toMatch(/trackInAppImpression\(msg\.id, 'displayed'\)/);
  });
});
