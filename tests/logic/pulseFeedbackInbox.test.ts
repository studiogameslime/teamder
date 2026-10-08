import fs from 'fs';
import path from 'path';

describe('Pulse feedback inbox routing', () => {
  it('keeps the replacement trigger registered without copying reports into tasks', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../functions/src/index.ts'), 'utf8');
    const start = source.indexOf('export const onFeedbackCreated =');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('/**', start);
    const trigger = source.slice(start, end);
    expect(trigger).toContain("'feedback/{feedbackId}'");
    expect(trigger).not.toMatch(/\b(?:db|ref|tx)\s*\./);
    expect(trigger).not.toMatch(/\.(?:set|create|update|delete|add)\s*\(/);
  });
});
