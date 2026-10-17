import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function shareHandler(context: Record<string, unknown>) {
  const file = 'src/components/community/ClubStatusCard.tsx';
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body = '';
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'share') body = node.initializer!.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!body) throw new Error('Share handler missing');
  return vm.runInNewContext(ts.transpileModule(`(${body})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context) as () => Promise<void>;
}
function setup() {
  const Sharing = { isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async (_uri: string, _options: unknown) => undefined) };
  const context = {
    busy: { current: false }, cardRef: { current: { captureTarget: 'club-card' } },
    setSharing: jest.fn(), captureRef: jest.fn(async (_target: unknown) => 'file:///club-card.png'),
    releaseCapture: jest.fn(), appAlert: jest.fn(),
    requestAnimationFrame: (callback: () => void) => callback(), require: () => Sharing,
  };
  return { context, Sharing, share: shareHandler(context) };
}

test('a repeated tap cannot capture or open sharing twice; only the card is captured', async () => {
  const { context, Sharing, share } = setup();
  let resolveCapture!: (uri: string) => void;
  let captureStarted!: () => void;
  const started = new Promise<void>(resolve => { captureStarted = resolve; });
  context.captureRef.mockImplementation(() => { captureStarted(); return new Promise<string>(resolve => { resolveCapture = resolve; }); });
  const first = share();
  await started;
  await share();
  expect(context.captureRef).toHaveBeenCalledTimes(1);
  expect(context.captureRef.mock.calls[0][0]).toBe(context.cardRef);
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  resolveCapture('file:///club-card.png');
  await first;
  expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
  expect(context.releaseCapture).toHaveBeenCalledWith('file:///club-card.png');
  expect(context.busy.current).toBe(false);
  expect(context.setSharing).toHaveBeenLastCalledWith(false);
});

test('unavailable sharing does not create an unused image', async () => {
  const { context, Sharing, share } = setup();
  Sharing.isAvailableAsync.mockResolvedValue(false);
  await share();
  expect(context.captureRef).not.toHaveBeenCalled();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(context.appAlert).toHaveBeenCalledTimes(1);
  expect(context.busy.current).toBe(false);
});

test('a rejected native share releases the temporary photo and allows a retry', async () => {
  const { context, Sharing, share } = setup();
  Sharing.shareAsync.mockRejectedValueOnce(new Error('Native share failed'));
  await share();
  expect(context.releaseCapture).toHaveBeenCalledWith('file:///club-card.png');
  expect(context.appAlert).toHaveBeenCalledTimes(1);
  expect(context.busy.current).toBe(false);
  await share();
  expect(Sharing.shareAsync).toHaveBeenCalledTimes(2);
});
