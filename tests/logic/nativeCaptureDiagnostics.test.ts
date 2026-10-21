function load(native: Record<string,unknown> | undefined) {
  jest.resetModules();
  jest.doMock('react-native',()=>({NativeModules:{ScreenCapture:native}}));
  const {installCaughtErrorSink}=require('../../src/utils/errorObservation');
  const sink=jest.fn();installCaughtErrorSink(sink);
  return {capture:require('../../src/native/screenCapture').captureFullScreenBase64,sink};
}
test('a partial overlay failure is reported while the captured image survives',async()=>{
 const native={captureFullScreen:jest.fn().mockResolvedValue('jpeg'),takeDiagnostics:jest.fn().mockResolvedValue(['capture.overlay-draw'])};
 const {capture,sink}=load(native);
 await expect(capture({quality:.35,maxWidth:500})).resolves.toBe('jpeg');
 expect(native.captureFullScreen).toHaveBeenCalledWith(.35,500);
 expect(sink).toHaveBeenCalledWith(expect.objectContaining({code:'native/capture.overlay-draw'}),expect.objectContaining({handler:'compositeOverlayWindows'}));
});
test('failed diagnostic reads retain successful captures; capture failure retains the null fallback',async()=>{
 const native={captureFullScreen:jest.fn().mockResolvedValue('jpeg'),takeDiagnostics:jest.fn().mockRejectedValue(new Error('diagnostics down'))};
 const {capture,sink}=load(native);
 await expect(capture()).resolves.toBe('jpeg');
 const error=new Error('capture failed');native.captureFullScreen.mockRejectedValue(error);
 await expect(capture()).resolves.toBeNull();
 expect(sink).toHaveBeenCalledWith(error,expect.objectContaining({handler:'captureFullScreenBase64'}));
});
test('binaries without the optional method and platforms without capture stay compatible',async()=>{
 await expect(load({captureFullScreen:async()=>'old-jpeg'}).capture()).resolves.toBe('old-jpeg');
 await expect(load(undefined).capture()).resolves.toBeNull();
});
