import { redactDiagnosticContext, redactDiagnosticText } from '@/utils/diagnosticRedaction';

test('redacts nested credentials and contact details while retaining reproduction ids', () => {
  const input = {gameId:'round-123', tab:'players', count:7, nested:{refreshToken:'private-token', email:'private@example.invalid'}, message:'user private@example.invalid phone 050-1234567', url:'https://example.invalid/i/club?gameId=round-123&token=private-token'};
  const result = redactDiagnosticContext(input);
  expect(result).toMatchObject({gameId:'round-123',tab:'players',count:7});
  const json=JSON.stringify(result);
  expect(json).not.toMatch(/private-token|private@example|050-1234567/);
  expect(json).toContain('gameId=round-123');
  expect(input.nested.refreshToken).toBe('private-token');
});

test('redacts bearer, jwt, encoded contact query and private key in error messages', () => {
  const text = 'Bearer abc-secret https://host/path?email=a%40example.com&access_token=abc eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOiJhIn0.signature -----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----';
  expect(redactDiagnosticText(text)).not.toMatch(/abc-secret|a%40example|access_token=abc|eyJhbGci|\nprivate\n/);
});

test('caps pathological contexts, preserves valid JSON and handles cycles', () => {
  const cycle:any={gameId:'g',large:'"\\'.repeat(8000), nested:{value:Infinity}};cycle.self=cycle;
  const result=redactDiagnosticContext(cycle);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(4000);
  expect(result.gameId).toBe('g');
  expect(()=>JSON.parse(JSON.stringify(result))).not.toThrow();
});
