import { chatCountdown, chatIsArchived, roundChatState, ROUND_CHAT_WINDOW_MS } from '../../src/utils/chatInbox';

const end = 1800000000000;
test('round chat closes at the exact 24 hour boundary, based on actual end', () => {
  expect(roundChatState({status:'finished',endedAt:end},end+ROUND_CHAT_WINDOW_MS-1)).toMatchObject({closed:false,remainingMs:1});
  expect(roundChatState({status:'finished',endedAt:end},end+ROUND_CHAT_WINDOW_MS)).toMatchObject({closed:true,remainingMs:0});
  expect(roundChatState({status:'active'},end)).toMatchObject({closed:false,remainingMs:null});
});
test('cancelled and legacy finished rounds cannot reopen a writing window', () => {
  expect(roundChatState({status:'cancelled',endedAt:end},end).closed).toBe(true);
  for (const endedAt of [undefined,0,NaN,Infinity]) expect(roundChatState({status:'finished',endedAt},end).closed).toBe(true);
});
test('a newly received message restores a manual archive without losing its mute setting', () => {
  const settings={muted:true,pinned:true,archivedAt:end};
  expect(chatIsArchived(end,settings)).toBe(true);
  expect(chatIsArchived(end+1,settings)).toBe(false);
  expect(settings.muted).toBe(true);
  expect(chatIsArchived(end+1,settings,true)).toBe(true);
  expect(chatIsArchived(end,undefined)).toBe(false);
});
test('countdown does not disappear before the last second or wrap at 24h', () => {
  expect(chatCountdown(ROUND_CHAT_WINDOW_MS)).toBe('24:00:00');
  expect(chatCountdown(8*3600000+42*60000+15000)).toBe('08:42:15');
  expect(chatCountdown(1)).toBe('00:00:01');
  expect(chatCountdown(-1)).toBe('00:00:00');
});

// Message identity beats phone clocks: a delayed/clock-skewed new message still resurfaces.
test('archive compares message identity when available, independent of client clock',()=>{
 const prefs={muted:true,pinned:false,archivedAt:end,archivedMessageId:'old'};
 expect(chatIsArchived(end-1000,prefs,false,'new')).toBe(false);
 expect(chatIsArchived(end+1000,prefs,false,'old')).toBe(true);
});
