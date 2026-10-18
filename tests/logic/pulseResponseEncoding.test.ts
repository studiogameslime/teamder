import { pulseResponseBytes } from '../../functions/src/pulseResponseEncoding';

// This is the ArrayBuffer text path used by Pulse's installed whatwg-fetch.
const nativeText = (bytes: Buffer) => Array.from(bytes, byte => String.fromCharCode(byte)).join('');
test('installed native response preserves Hebrew, emoji, bidi isolates and mixed names', () => {
  const value = [{document:{fields:{title:{stringValue:'שגיאה · שלום מתן ⚽ 👋'},text:{stringValue:'⁨Eliran⁩: ״עובד!״\nבדיקה'}}}}];
  const raw = Buffer.from(JSON.stringify(value), 'utf8');
  expect(JSON.parse(nativeText(raw))).not.toEqual(value); // reproduces the shipped bug
  const encoded = pulseResponseBytes(raw, 'application/json; charset=UTF-8');
  expect(encoded.every(byte => byte < 128)).toBe(true);
  expect(JSON.parse(nativeText(encoded))).toEqual(value);
  expect(JSON.parse(encoded.toString('utf8'))).toEqual(value);
});
test('JSON suffix, empty responses, escapes and scalar values preserve their meaning', () => {
  for (const value of [null, 0, 'עברית', {text:'\\u05e9 " שלום', count:18}]) {
    expect(JSON.parse(nativeText(pulseResponseBytes(Buffer.from(JSON.stringify(value)), 'application/problem+json')))).toEqual(value);
  }
  expect(pulseResponseBytes(Buffer.alloc(0), 'application/json').length).toBe(0);
});
test('binary and non-JSON responses are unchanged', () => {
  const bytes = Buffer.from([0, 255, 128, 215, 169, 10]);
  for (const mime of ['application/gzip','image/jpeg','text/csv',null]) {
    expect(pulseResponseBytes(bytes, mime)).toBe(bytes);
  }
});
