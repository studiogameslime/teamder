import { drainNativeDiagnostics } from '../../src/native/nativeDiagnostics';
import { installCaughtErrorSink, clearCaughtErrorOrigins } from '../../src/utils/errorObservation';

beforeEach(() => clearCaughtErrorOrigins());
test('old binaries need no diagnostic method', async () => {
  const sink=jest.fn();installCaughtErrorSink(sink);
  await drainNativeDiagnostics({});expect(sink).not.toHaveBeenCalled();
});
test('native codes pass through the existing sink without forwarding arbitrary native data', async () => {
  const sink=jest.fn();installCaughtErrorSink(sink);
  await drainNativeDiagnostics({takeDiagnostics:async()=>['watch.widgets','payload-with-private-data','capture.overlay-draw','native.overflow',{message:'private'},'__proto__']});
  expect(sink).toHaveBeenCalledTimes(3);
  expect(sink.mock.calls[0][0]).toMatchObject({code:'native/watch.widgets'});
  expect(sink.mock.calls[1][1]).toMatchObject({source:'plugins/screenshot-src/ScreenCaptureModule.kt',handler:'compositeOverlayWindows'});
  expect(JSON.stringify(sink.mock.calls)).not.toContain('private');
});
test('diagnostic read and reporter failures do not fail the main operation', async () => {
  const sink=jest.fn();installCaughtErrorSink(sink);const error=new Error('unavailable');
  await expect(drainNativeDiagnostics({takeDiagnostics:async()=>{throw error;}})).resolves.toBeUndefined();
  expect(sink).toHaveBeenCalledWith(error,expect.objectContaining({site:'native:diagnostic-read'}));
  installCaughtErrorSink(()=>{throw new Error('sink unavailable');});
  await expect(drainNativeDiagnostics({takeDiagnostics:async()=>['watch.context']})).resolves.toBeUndefined();
});
test('malformed and oversized native queues remain bounded', async () => {
  const sink=jest.fn();installCaughtErrorSink(sink);
  await drainNativeDiagnostics({takeDiagnostics:async()=>null});
  expect(sink).not.toHaveBeenCalled();
  await drainNativeDiagnostics({takeDiagnostics:async()=>Array(300).fill('watch.message')});
  expect(sink).toHaveBeenCalledTimes(32);
});

test('a stalled native diagnostic method cannot hold the main operation indefinitely', async () => {
  jest.useFakeTimers();
  try {
    const sink=jest.fn();installCaughtErrorSink(sink);
    const pending=drainNativeDiagnostics({takeDiagnostics:()=>new Promise(()=>{})});
    jest.advanceTimersByTime(750);
    await expect(pending).resolves.toBeUndefined();
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({message:'Native diagnostic read timed out'}),expect.objectContaining({site:'native:diagnostic-read'}));
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
