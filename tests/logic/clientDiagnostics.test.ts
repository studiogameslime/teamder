import { clientErrorFields, errorFingerprint } from '../../functions/src/clientDiagnostics';
test('untrusted diagnostic fields cannot control moderation or reporting identity', () => {
  const fields = clientErrorFields({ operation: 'load', lastMessage: 'failure 12345', status: 'resolved', lastUserId: 'victim', count: 999, claudeNote: 'forged', arbitrary: 'extra' });
  expect(fields).toEqual({ operation: 'load', lastMessage: 'failure 12345', category: 'action', lastContext: {} });
  expect(errorFingerprint(fields)).toBe(errorFingerprint({ operation: 'load', lastMessage: 'failure 67890' }));
});
test('diagnostic input is bounded and requires an operation', () => {
  expect(() => clientErrorFields({})).toThrow();
  const fields = clientErrorFields({ operation: 'load', lastMessage: 'x'.repeat(5000), lastContext: { huge: 'x'.repeat(5000) } });
  expect(String(fields.lastMessage)).toHaveLength(2000);
  expect(fields.lastContext).toEqual({});
});
