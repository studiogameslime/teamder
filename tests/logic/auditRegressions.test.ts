/** Execute the actual source with controlled failures and concurrent completions. */
test('all fifteen audit regression scenarios preserve their contracts', async () => {
  // The source-node harness is shared with the reproducible audit report.
  const { main } = require('../../docs/audits/2026-10-08/verify-fixed.cjs');
  const results = await main();
  expect(results.map((r: { id: string }) => r.id).sort()).toEqual(
    Array.from({ length: 15 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`),
  );
});
