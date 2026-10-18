import {onboardingPushContent as content} from '../../functions/src/onboardingPushContent';
import {getEntryContext,resetEntrySource,setEntrySource} from '@/services/entrySource';
beforeEach(resetEntrySource);

test('numbered guest choices describe actual transitions with isolated Hebrew labels', () => {
  const push = content({ action: 'entry_intent_selected', guestNumber: 42, previousIntent: 'create_club', params: { is_guest: true, intent: 'one_off_game' } });
  expect(push.title).toBe('שינוי בחירה');
  expect(push.body).toContain('אורח 42: שינה בחירה');
  expect(push.body).toContain('מ־\u2068הקמת מועדון\u2069 ל־\u2068יצירת מחזור חד־פעמי\u2069');
  expect(content({ action: 'entry_source_resolved', guestNumber: -1, params: { is_guest: true } }).body).not.toContain('אורח -1');
});

test('launch channel survives for subsequent authentication without install attribution',()=>{
  setEntrySource('club_link',{entry_channel:'whatsapp',target_id:'club'});
  const context=getEntryContext();context.entry_channel='changed';
  expect(getEntryContext()).toEqual({entry_source:'club_link',entry_channel:'whatsapp',target_id:'club'});
  resetEntrySource();expect(getEntryContext()).toEqual({entry_source:'unknown'});
});
test.each([
  ['club_link','קישור למועדון'],['game_link','קישור למחזור'],['personal_invite','קישור לאפליקציה'],['organic','פתיחה רגילה'],['unknown','מקור כניסה לא ידוע'],
])('source %s remains precise without an inviter', (entry_source,label)=>{
  expect(content({action:'entry_source_resolved',params:{is_guest:true,entry_source,has_inviter:false}}).body).toContain(label);
});
test('server profile beats the snapshot; distribution channel is from this event',()=>{
  const push=content({action:'auth_completed',actorName:'ישן',params:{auth_method:'apple',entry_source:'club_link',entry_channel:'whatsapp',entry_campaign:'סתיו'}},{name:'Matan',acquisition:{source:'facebook'}});
  expect(push.body).toContain('\u2068Matan\u2069');expect(push.body).toContain('באמצעות אפל');expect(push.body).toContain('ווטסאפ');expect(push.body).toContain('סתיו');
  expect(push.body).not.toMatch(/ישן|פייסבוק/);
});
test('missing current name falls back to server snapshot; unnamed member is not a guest',()=>{
  expect(content({action:'entry_source_resolved',actorName:'מתן',params:{is_guest:false}},{name:' '}).body).toContain('מתן');
  expect(content({action:'entry_source_resolved',params:{is_guest:false}},{name:'אורח'}).body).toContain('משתמש מחובר ללא שם');
});
test('opening an app is never described as authenticating',()=>{
  expect(content({action:'entry_source_resolved',params:{is_guest:false}}).body).toContain('פתח את האפליקציה');
  expect(content({action:'entry_source_resolved',params:{is_guest:false}}).body).not.toContain('התחבר לחשבון');
});

test('inviter display name comes only from the server, and missing identity remains explicit',()=>{
  const push=content({action:'auth_completed',inviterName:'Matan',params:{entry_source:'club_link',inviter_name:'מזויף',has_inviter:true}});
  expect(push.body).toContain('דרך \u2068Matan\u2069');expect(push.body).not.toContain('מזויף');
  expect(content({action:'auth_prompt_shown',params:{has_inviter:true}}).body).toContain('המזמין טרם זוהה');
});
test('untrusted display values cannot inject bidi controls, extra lines or URLs',()=>{
  const push=content({action:'entry_source_resolved',params:{entry_source:'made-up',entry_channel:'https://private.test?token=secret',entry_campaign:'a@b.test'}},{name:'\u202eMatan\nName'});
  expect(push.body).not.toMatch(/\u202e|private.test|secret|a@b.test/);
  expect(push.body.split('\n')).toHaveLength(2);
});
