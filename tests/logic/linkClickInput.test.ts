import { clickDocumentId, clickSource } from '../../functions/src/linkClickInput';
test.each([undefined, null, '', '.', '..', 'a/b', 'a\\b', 'a\n', 'x'.repeat(129)])('rejects unsafe click document identifiers %s', value => {
  expect(clickDocumentId(value)).toBe('');
});
test('keeps historical Hebrew campaign labels and valid references', () => {
  expect(clickSource('כדורגל בפייסבוק')).toBe('כדורגל בפייסבוק');
  expect(clickDocumentId('valid-link_123')).toBe('valid-link_123');
});
