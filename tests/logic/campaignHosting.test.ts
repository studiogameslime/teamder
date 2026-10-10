import fs from 'fs';
import { readTrackedAdLink, renderTrackedAdLink, shortCodeFromPath } from '../../functions/src/shortAdLinkPage';

test('every hosting site retains the Pulse campaign route and exported handler', () => {
  const config = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
  for (const site of config.hosting) {
    expect(site.rewrites.find((r: any) => r.source === '/play/**')?.function).toEqual({ functionId: 'serveAdLink', region: 'us-central1' });
  }
  expect(fs.readFileSync('functions/src/index.ts', 'utf8')).toContain("export { serveAdLink } from './serveAdLink'");
});

test('campaign codes reject invalid paths and missing or mismatched documents', () => {
  expect(shortCodeFromPath('/play/U5tUXbaG')).toBe('U5tUXbaG');
  for (const p of ['/play/short', '/play/../users', '/play/U5tUXbaG/extra']) expect(shortCodeFromPath(p)).toBeNull();
  expect(readTrackedAdLink(undefined, 'U5tUXbaG')).toBeNull();
  expect(readTrackedAdLink({ shortCode: 'wrong', source: 'facebook' }, 'U5tUXbaG')).toBeNull();
});

test('campaign metadata cannot break out of its script element', () => {
  const html = renderTrackedAdLink('<head></head>', { source: '</script><script>attack()</script>', shortCode: 'U5tUXbaG' });
  expect(html.match(/<script>/g)).toHaveLength(1);
  expect(html).not.toContain('<script>attack()');
});
