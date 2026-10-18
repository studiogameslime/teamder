const mockVerify = jest.fn();
const mockSecret = jest.fn((name: string) => name === 'PULSE_ADMIN_UIDS' ? 'owner' : '{}');
jest.mock('firebase-admin', () => ({ __esModule: true, auth: () => ({ verifyIdToken: mockVerify }) }), { virtual: true });
jest.mock('firebase-functions/v2/https', () => ({ onRequest: (_options: unknown, handler: unknown) => handler }), { virtual: true });
jest.mock('firebase-functions/params', () => ({ defineSecret: (name: string) => ({ value: () => mockSecret(name) }) }), { virtual: true });
import { pulseAdminProxy } from '../../functions/src/pulseAdminProxy';
async function request(headers: Record<string, string>, body = { operation: 'session' }) {
  const res: any = { set: jest.fn(), status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  await pulseAdminProxy({ method: 'POST', headers, body } as any, res);
  return res;
}
beforeEach(() => { jest.clearAllMocks(); });
test('no credential means no access to any secret or upstream', async () => {
  const res = await request({});
  expect(res.status).toHaveBeenCalledWith(401);
  expect(mockVerify).not.toHaveBeenCalled();
  expect(mockSecret).not.toHaveBeenCalled();
});
test.each([{ uid: 'stranger', firebase: { sign_in_provider: 'google.com' } }, { uid: 'owner', firebase: { sign_in_provider: 'anonymous' } }])('denies non-owner and anonymous accounts before reading provider credentials', async identity => {
  mockVerify.mockResolvedValue(identity);
  const res = await request({ authorization: 'Bearer firebase-user-token' });
  expect(mockVerify).toHaveBeenCalledWith('firebase-user-token', true);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(mockSecret).not.toHaveBeenCalledWith('PULSE_UPSTREAM_CREDENTIALS');
});
test('revoked/invalid tokens cannot reach the UID allowlist', async () => {
  mockVerify.mockRejectedValue(new Error('revoked'));
  const res = await request({ authorization: 'Bearer revoked-token' });
  expect(res.status).toHaveBeenCalledWith(401);
  expect(mockSecret).not.toHaveBeenCalled();
});
test('authorised session returns capabilities, never provider keys or tokens', async () => {
  mockVerify.mockResolvedValue({ uid: 'owner', firebase: { sign_in_provider: 'google.com' } });
  const res = await request({ authorization: 'Bearer firebase-user-token' });
  expect(res.json).toHaveBeenCalledWith({ uid: 'owner', capabilities: { firebase: true, appStore: false, appleDownloads: false, play: false, playDownloads: false, analytics: false, admob: false } });
});
