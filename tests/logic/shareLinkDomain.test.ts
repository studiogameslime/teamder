jest.mock('firebase/firestore', () => ({ doc: jest.fn((...parts: unknown[]) => parts), setDoc: jest.fn() }));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false, getFirebase: () => ({ db: 'db' }) }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));
jest.mock('@/utils/errorObservation', () => ({ observeCaughtError: jest.fn() }));

import { setDoc } from 'firebase/firestore';
import { createShortInviteUrl } from '@/services/inviteLinkService';
import fs from 'fs';

beforeEach(() => { jest.clearAllMocks(); (setDoc as jest.Mock).mockResolvedValue(undefined); });

test.each(['app', 'team', 'session'] as const)('%s short link preserves canonical target and inviter without repeating the UID', async type => {
 const url = await createShortInviteUrl({ type, id: type === 'app' ? undefined : 'target', invitedBy: 'sender', fallbackLong: 'long' });
 expect(url).toMatch(/^https:\/\/teamder\.co\.il\/i\/[A-Za-z0-9]{7}$/);
 expect(setDoc).toHaveBeenCalledWith(['db', 'inviteLinks', new URL(url).pathname.split('/')[2]], expect.objectContaining({ type, targetId: type === 'app' ? '' : 'target', invitedBy: 'sender' }));
});

test('a failed short-code write retains the supplied complete invite URL', async () => {
 (setDoc as jest.Mock).mockRejectedValue(new Error('offline'));
 const fallbackLong = 'https://teamder.co.il/session/round?invitedBy=sender';
 expect(await createShortInviteUrl({type:'session',id:'round',invitedBy:'sender',fallbackLong})).toBe(fallbackLong);
});

test('both native platforms register every shared route on new and previous domains', () => {
 const config = JSON.parse(fs.readFileSync('app.json','utf8')).expo;
 for (const host of ['teamder.co.il','www.teamder.co.il','teamderfc.web.app']) {
  expect(config.ios.associatedDomains).toContain(`applinks:${host}`);
  for (const pathPrefix of ['/session','/team','/app','/i/','/go','/c/']) {
   expect(config.android.intentFilters.flatMap((f: any) => f.data)).toContainEqual({scheme:'https',host,pathPrefix});
  }
 }
});
