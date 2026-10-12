import {chatMessagePreview,chatSenderNeedsIdentity} from '../../src/utils/chatInbox';
import type {ChatUnreadEntry} from '../../src/types';
const entry:ChatUnreadEntry={id:'community__club',scope:'community',parentId:'club',title:'מועדון',count:1,lastMessageAt:1,lastText:'להביא מצב רוח',lastSenderId:'matan',lastSenderName:'שחקן'};
test('legacy group preview resolves the actual sender instead of a generic name',()=>{
  expect(chatSenderNeedsIdentity(entry)).toBe(true);
  expect(chatMessagePreview(entry,'me','מתן')).toBe('מתן: להביא מצב רוח');
  expect(chatMessagePreview({...entry,scope:'game',lastSenderName:'  '},'me','מתן')).toBe('מתן: להביא מצב רוח');
});
test('valid names remain authoritative, with a space after the colon',()=>{
  const named={...entry,lastSenderName:'איתי'};
  expect(chatSenderNeedsIdentity(named)).toBe(false);
  expect(chatMessagePreview(named,'me','מתן')).toBe('איתי: להביא מצב רוח');
});
test('own messages, personal chats and empty previews retain their meaning',()=>{
  expect(chatMessagePreview(entry,'matan','מתן')).toBe('אני: להביא מצב רוח');
  expect(chatMessagePreview({...entry,scope:'dm'},'me','מתן')).toBe('להביא מצב רוח');
  expect(chatSenderNeedsIdentity({...entry,scope:'dm'})).toBe(false);
  expect(chatMessagePreview(undefined,'me')).toBe('');
  expect(chatMessagePreview({...entry,lastText:''},'me')).toBe('');
});
test('unavailable identity keeps the message visible and Latin names are isolated',()=>{
  expect(chatMessagePreview(entry,'me')).toBe('שחקן: להביא מצב רוח');
  expect(chatMessagePreview(entry,'me','Matan')).toBe('⁨Matan⁩: להביא מצב רוח');
  expect(chatSenderNeedsIdentity({...entry,lastSenderId:''})).toBe(false);
});
