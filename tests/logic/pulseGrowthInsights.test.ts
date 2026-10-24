import { clubInsight, personInsight, journeySessions, personSource, GROWTH_DAY, type GrowthData } from '../../pulse/src/services/growthInsights';
const now=Date.UTC(2026,9,24,12);
const source=(rows:any[]=[],limited=false)=>({rows,limited,at:now});
const data=(overrides:Partial<GrowthData>={}):GrowthData=>({users:source(),groups:source(),games:source(),failed:[],at:now,...overrides});
const group={id:'club',name:'החבר׳ה',adminIds:['organizer'],playerIds:['person','person','organizer'],pendingPlayerIds:[]};

test('club activity uses the shared evidence gate, excludes cancelled, future and unverified evenings and deduplicates members',()=>{
 const d=data({games:source([
  {id:'played',groupId:'club',status:'finished',endedBy:'admin',startsAt:now-GROWTH_DAY},
  {id:'not-confirmed',groupId:'club',status:'finished',endedBy:'auto',startsAt:now-GROWTH_DAY},
  {id:'cancelled',groupId:'club',status:'cancelled',startsAt:now-GROWTH_DAY,committedRoundCount:3},
  {id:'future-bad',groupId:'club',status:'finished',startsAt:now+GROWTH_DAY},
  {id:'other',groupId:'other',status:'finished',startsAt:now-GROWTH_DAY},
 ])});
 const result=clubInsight(group,d,now);
 expect(result.played.map(g=>g.id)).toEqual(['played']);expect(result.unverified.map(g=>g.id)).toEqual(['not-confirmed']);expect(result.members).toEqual(['person','organizer']);expect(result.stage).toBe('משחקים בפועל');
});
test('failed and truncated sources never assert inactivity',()=>{
 expect(clubInsight(group,data({games:null,failed:['games']}),now).stage).toBe('פעילות לא נטענה');
 const old={id:'old',groupId:'club',status:'finished',startsAt:now-70*GROWTH_DAY};
 expect(clubInsight(group,data({games:source([old],true)}),now).stage).toBe('לא נמצאה פעילות בחלון');
 expect(clubInsight(group,data({games:source([old])}),now).stage).toBe('ללא מחזור ב־30 יום');
});
test('recruitment is attributed only to a club-specific saved invite and current member, not all referral signups',()=>{
 const d=data({users:source([
  {id:'person',invitedBy:'organizer',invitedByType:'team',invitedByTargetId:'club'},
  {id:'other',invitedBy:'organizer',invitedByType:'team',invitedByTargetId:'club'},
  {id:'organizer',invitedBy:'wrong',invitedByType:'app',invitedByTargetId:'club'},
 ])});
 expect(clubInsight(group,d,now).recruiters).toEqual([{id:'organizer',count:1}]);
});
test('a registration is not represented as attendance, and missing data is not an empty onboarding path',()=>{
 const user={id:'person',name:'איתי',createdAt:now-3*GROWTH_DAY};
 const registered=personInsight(user,data({games:source([{id:'g',status:'finished',players:['person']}])}),now);
 expect(registered.stage).toBe('רשום למחזור');expect(registered.summary).toContain('אינה הוכחה להשתתפות');
 const missing=personInsight(user,data({groups:null,failed:['groups']}),now);expect(missing.partial).toBe(true);expect(missing.follow).toBe(false);expect(missing.summary).toContain('אין מספיק מידע');
 expect(personInsight({...user,stats:{attended:1}},data(),now).stage).toBe('נרשמה השתתפות');
});
test('waiting for a manager provides a relevant follow-up instead of calling a successful request a failure',()=>{
 const result=personInsight({id:'person',createdAt:now},data({groups:source([{...group,playerIds:[],pendingPlayerIds:['person']}])}),now);
 expect(result.stage).toBe('ממתין לאישור');expect(result.follow).toBe(true);expect(result.next).toContain('מנהל');
});
test('journey isolation uses UID and session, with chronological ordering and no invented visit duration',()=>{
 const result=journeySessions([
  {id:'later',uid:'person',sessionId:'s',occurredAt:200,sequence:2},
  {id:'earlier',uid:'person',sessionId:'s',occurredAt:100,sequence:1},
  {id:'latest',uid:'person',sessionId:'s2',occurredAt:300},
  {id:'different-person',uid:'other',sessionId:'s',occurredAt:400},
  {id:'missing-session',uid:'person',occurredAt:500},
 ],'person');
 expect(result.map(r=>r.id)).toEqual(['s2','s']);expect(result[1].rows.map(r=>r.id)).toEqual(['earlier','later']);expect(result[1]).not.toHaveProperty('duration');
});
test('unknown acquisition stays unknown, and referrer names are resolved from actual ids',()=>{
 expect(personSource({id:'p'},[])).toBe('מקור הגעה לא תועד');
 expect(personSource({id:'p',invitedBy:'r'},[{id:'r',name:'דני'}])).toBe('הזמנה של דני');
});
test('technical personal containers are not treated as clubs founded by a new organizer',()=>{
 const result=personInsight({id:'person',createdAt:now},data({groups:source([{id:'technical',isPersonal:true,creatorId:'person',adminIds:['person'],playerIds:['person']}])}),now);
 expect(result.groups).toEqual([]);expect(result.stage).not.toBe('מארגן מועדון');
});
