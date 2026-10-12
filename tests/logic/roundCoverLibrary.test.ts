import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

it('bundles sixty distinct, intact images in six pools with ten entries each', () => {
  const root = path.join(process.cwd(), 'src/assets/images/roundCovers');
  const rows = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
  expect(rows).toHaveLength(60);
  const hashes = new Set();
  for (const surface of ['grass','synthetic','asphalt']) for(const period of ['day','night']) {
    const pool = rows.filter((r: any) => r.id.startsWith(`${surface}-${period}-`));
    expect(pool).toHaveLength(10);
    for (let i=1;i<=10;i++) expect(pool.some((r: any) => r.id === `${surface}-${period}-${String(i).padStart(2,'0')}`)).toBe(true);
  }
  for (const row of rows) {
    const bytes = fs.readFileSync(path.join(root,row.file));
    expect(bytes.length).toBe(row.bytes);
    expect(bytes[0]).toBe(0xff); expect(bytes[1]).toBe(0xd8);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    expect(hash).toBe(row.sha256);hashes.add(hash);
    expect(row.width).toBe(1152); expect(row.height).toBe(768);
  }
  expect(hashes.size).toBe(60);
  expect(rows.reduce((n: number,r: any)=>n+r.bytes,0)).toBeLessThan(12*1024*1024);
});
