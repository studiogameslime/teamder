export function clickDocumentId(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[./\\\x00-\x1f]/.test(value) ? value : '';
}
// Historical campaign labels may be Hebrew; preserve their vocabulary.
export function clickSource(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128 && !/[./\\\x00-\x1f]/.test(value) ? value.trim() : '';
}
