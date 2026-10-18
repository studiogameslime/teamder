import { pulseAdminAllowed, pulseProxyTarget } from '../../functions/src/pulseProxyPolicy';

test('Pulse accepts only explicitly allowlisted full-account UIDs', () => {
  expect(pulseAdminAllowed('owner', false, ' owner,other ')).toBe(true);
  expect(pulseAdminAllowed('owner', true, 'owner')).toBe(false);
  expect(pulseAdminAllowed('stranger', false, 'owner')).toBe(false);
  expect(pulseAdminAllowed('owner', false, '')).toBe(false);
});
const firestore = 'https://firestore.googleapis.com/v1/projects/soccer-app-52b6b/databases/(default)/documents';
test('official support subqueries are permitted only for canonical two-person parents', () => {
  expect(pulseProxyTarget(firestore + '/dmConversations/alice__teamder:runQuery', 'POST').scope).toBe('datastore');
  for (const suffix of ['/dmConversations/alice__bob:runQuery', '/dmConversations/teamder__alice:runQuery', '/groups/club:runQuery', '/dmConversations/alice__teamder/messages:runQuery', '/dmConversations/teamder__teamder:runQuery']) {
    expect(() => pulseProxyTarget(firestore + suffix, 'POST')).toThrow('PULSE_TARGET_DENIED');
  }
});
test.each([
  [firestore + '/feedback/report', 'PATCH'], [firestore + ':runQuery', 'POST'],
  ['https://analyticsdata.googleapis.com/v1beta/properties/534662166:runReport', 'POST'],
  ['https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.studiogameslime.soccerapp/edits', 'POST'],
  ['https://api.appstoreconnect.apple.com/v1/apps/6775178022/customerReviews', 'GET'],
])('allows the existing administrative operation %s %s', (url, method) => {
  expect(pulseProxyTarget(url, method).url.href).toBe(url);
});
test.each([
  ['http://169.254.169.254/computeMetadata/v1/', 'GET'],
  ['https://firestore.googleapis.com.evil.invalid/v1/projects/soccer-app-52b6b', 'GET'],
  [firestore.replace('soccer-app-52b6b', 'other-project') + '/users', 'GET'],
  [firestore + '/groups/club', 'DELETE'],
  ['https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.studiogameslime.soccerapp/edits/id:commit', 'POST'],
  ['https://oauth2.googleapis.com/token', 'POST'],
  ['https://api.appstoreconnect.apple.com/v1/apps/another-app/customerReviews', 'GET'],
  ['https://api.appstoreconnect.apple.com/v1/apps/6775178022/appStoreVersions', 'PATCH'],
  ['https://owner:secret@firestore.googleapis.com/v1/projects/soccer-app-52b6b/databases/(default)/documents/users', 'GET'],
])('denies arbitrary destinations and store publication %s', (url, method) => {
  expect(() => pulseProxyTarget(url, method)).toThrow('PULSE_TARGET_DENIED');
});
