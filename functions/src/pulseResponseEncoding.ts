/**
 * Pulse 1.0.93 constructs a native Response from an ArrayBuffer. Its fetch
 * polyfill reads each byte as a character instead of decoding UTF-8. JSON
 * unicode escapes preserve the original values while keeping that wire body
 * ASCII-only. Binary downloads must remain byte-for-byte unchanged.
 */
export function pulseResponseBytes(bytes: Buffer, contentType: string | null): Buffer {
  const mime = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (mime !== 'application/json' && !mime.endsWith('+json')) return bytes;
  return Buffer.from(bytes.toString('utf8').replace(/[\u007f-\uffff]/g,
    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')), 'ascii');
}
