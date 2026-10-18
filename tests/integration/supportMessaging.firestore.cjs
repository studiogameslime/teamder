// Isolated demo only. No credentials, real users, or external push delivery.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDocs, collection, query, orderBy, serverTimestamp } = require('firebase/firestore');
const root = path.resolve(__dirname, '../..'), project = 'demo-teamder-support', port = 8187;
process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${port}`;
process.env.GCLOUD_PROJECT = project;
let emulator, env, admin, db, service, onDmChatMessage;
const alerts = [];
const disabledAccounts = new Set();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
before(async () => {
  await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(resolve)); });
  const jar = path.join(require('node:os').homedir(), '.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar');
  assert.ok(fs.existsSync(jar), 'Cached emulator required');
  const log = fs.createWriteStream(path.join(root, 'artifacts/support-messaging-emulator.log'));
  emulator = spawn('java', ['-jar', jar, '--host=127.0.0.1', `--port=${port}`, `--project_id=${project}`], { windowsHide: true });
  emulator.stdout.pipe(log); emulator.stderr.pipe(log);
  let ready = false;
  for (let i = 0; i < 300; i++) {
    if (emulator.exitCode !== null) throw Error('Local emulator exited');
    ready = await new Promise(resolve => { const socket = net.connect(port, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); });
    if (ready) break; await wait(200);
  }
  assert.ok(ready);
  env = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port, rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') } });
  admin = require('../../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: project }); db = admin.firestore();
  admin.auth().getUser = async uid => ({ uid, disabled: disabledAccounts.has(uid) }); // no real Auth calls
  require('../../functions/lib/adminPush').pushToAdmins = async (...args) => { alerts.push(args); };
  onDmChatMessage = require('../../functions/lib/chatPush').onDmChatMessage;
  // Execute the real Pulse service against real local Firestore operations.
  const rest = {
    patchDoc: async (p, fields) => { await db.doc(p).set(fields, { merge: true }); return true; },
    createDocOnly: async (p, fields) => { try { await db.doc(p).create(fields); return 'created'; } catch (e) { if (e.code === 6) return 'conflict'; throw e; } },
    getDoc: async p => { const snap = await db.doc(p).get(); return snap.exists ? { id: snap.id, ...snap.data() } : null; },
    queryCollectionRecent: async (p, count) => (await db.collection(p).orderBy('createdAt', 'desc').limit(count).get()).docs.map(s => ({ id: s.id, ...s.data() })),
    queryArrayContains: async (c, field, value) => (await db.collection(c).where(field, 'array-contains', value).get()).docs.map(s => ({ id: s.id, ...s.data() })),
  };
  const filename = path.join(root, 'pulse/src/services/teamderChatService.ts');
  const Module = require('node:module'), ts = require('typescript'), compiled = new Module(filename, module);
  compiled.filename = filename; compiled.paths = module.paths;
  compiled.require = name => name === './firestoreRest' ? rest : name === '../capabilities' ? { has: { firebase: () => true } } : name === './cache' ? { cached: (_key, fn) => fn(), invalidate() {} } : require(name);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
  service = compiled.exports;
  await db.doc('users/alice').set({ name: 'אליס', friends: [], dmFriendsOnly: true });
  await db.doc('users/bob').set({ name: 'בוב', friends: [] });
});
after(async () => {
  await env?.cleanup(); if (admin?.apps.length) await admin.app().delete();
  if (emulator && emulator.exitCode === null) { emulator.kill(); await new Promise(resolve => emulator.once('close', resolve)); }
});

test('Pulse send reaches a real rules-authorized end-user read, unread index and reply', async () => {
  assert.equal(await service.sendTeamderMessage('alice', 'איך הולך עם המועדון?', 100, 'tm-100-support'), true);
  const sent = await db.doc('dmConversations/alice__teamder/messages/tm-100-support').get();
  await onDmChatMessage.run({ data: sent, params: { convId: 'alice__teamder', msgId: sent.id } });
  const alice = env.authenticatedContext('alice', { firebase: { sign_in_provider: 'password' } }).firestore();
  const rows = await assertSucceeds(getDocs(query(collection(alice, 'dmConversations/alice__teamder/messages'), orderBy('createdAt', 'desc'))));
  assert.equal(rows.docs[0].data().senderId, 'teamder');
  const unread = (await db.doc('users/alice/chatUnread/dm__alice__teamder').get()).data();
  assert.equal(unread.count, 1); assert.equal(unread.lastSenderName, 'Teamder');
  await assertSucceeds(setDoc(doc(alice, 'dmConversations/alice__teamder/messages/user-reply'), { senderId: 'alice', text: 'אשמח לעזרה!', createdAt: serverTimestamp() }));
  const reply = await db.doc('dmConversations/alice__teamder/messages/user-reply').get();
  await onDmChatMessage.run({ data: reply, params: { convId: 'alice__teamder', msgId: reply.id } });
  const thread = await service.loadThread('alice', 'אליס', true);
  assert.equal(thread.awaitingReply, true); assert.equal(thread.messages.at(-1).text, 'אשמח לעזרה!');
  assert.equal(alerts.length, 1); assert.equal(alerts[0][0], 'teamderReply');
  assert.equal(alerts[0][3].parentId, 'alice__teamder');
  assert.equal((await db.collection('users/teamder/chatUnread').get()).size, 0);
});
test('retry creates one message, answer clears awaiting state without hiding thread', async () => {
  await service.sendTeamderMessage('alice', 'בשמחה, כאן בשבילך', 200, 'tm-200-answer');
  await service.sendTeamderMessage('alice', 'בשמחה, כאן בשבילך', 200, 'tm-200-answer');
  const snap = await db.doc('dmConversations/alice__teamder/messages/tm-200-answer').get();
  await onDmChatMessage.run({ data: snap, params: { convId: 'alice__teamder', msgId: snap.id } });
  const inbox = await service.listThreads(true);
  assert.equal(inbox.length, 1); assert.equal(inbox[0].awaitingReply, false);
  assert.equal((await db.collection('dmConversations/alice__teamder/messages').get()).size, 3);
  assert.equal(alerts.length, 1);
});
test('third party cannot read, inject or impersonate the brand', async () => {
  const bob = env.authenticatedContext('bob', { firebase: { sign_in_provider: 'password' } }).firestore();
  await assertFails(getDocs(collection(bob, 'dmConversations/alice__teamder/messages')));
  await assertFails(setDoc(doc(bob, 'dmConversations/alice__teamder/messages/forged'), { senderId: 'teamder', text: 'זיוף', createdAt: serverTimestamp() }));
  const alice = env.authenticatedContext('alice', { firebase: { sign_in_provider: 'password' } }).firestore();
  await assertFails(setDoc(doc(alice, 'dmConversations/alice__teamder/messages/forged'), { senderId: 'teamder', text: 'זיוף', createdAt: serverTimestamp() }));
});

test('support callable persists source/photo, replay stays single, Pulse reads them and user sees the same thread', async()=>{
  const {sendSupportMessage}=require('../../functions/lib/supportMessage');
  const image=fs.readFileSync(path.join(root,'artifacts/support-fixture.jpg')).toString('base64');
  const input={auth:{uid:'alice',token:{firebase:{sign_in_provider:'password'}}},data:{expectedUid:'alice',id:'support-fixture-photo-123456789',text:'לא מסתדר עם הקמת מועדון',image,context:{screen:'CommunitiesCreate',screenLabel:'הקמת מועדון',step:1,appVersion:'local-test',platform:'android'}}};
  const result=await sendSupportMessage.run(input);await sendSupportMessage.run(input);
  assert.equal(result.convId,service.convIdFor('alice'));
  const shot=await db.doc(`dmConversations/${result.convId}/messages/${result.id}`).get();
  await onDmChatMessage.run({data:shot,params:{convId:result.convId,msgId:result.id}});
  const thread=await service.loadThread('alice','אליס',true),last=thread.messages.at(-1);
  assert.equal(last.supportImage,image);assert.equal(last.supportContext.screen,'CommunitiesCreate');assert.equal(last.supportContext.step,1);assert.equal(thread.awaitingReply,true);
  const alice=env.authenticatedContext('alice',{firebase:{sign_in_provider:'password'}}).firestore();
  const stored=await assertSucceeds(getDocs(query(collection(alice,`dmConversations/${result.convId}/messages`),orderBy('createdAt','desc'))));
  assert.equal(stored.docs[0].data().supportImage,image);
  assert.equal((await db.doc('supportMessageLimits/alice').get()).data().count,1);
  assert.equal(alerts.at(-1)[0],'teamderReply');
});

test('released SDK text-only null attachment reaches Pulse exactly once', async () => {
  const { initializeApp, deleteApp } = require('firebase/app');
  const { getFunctions, httpsCallableFromURL } = require('firebase/functions');
  const app = initializeApp({apiKey:'demo',projectId:project},'support-wire-regression');
  const originalFetch = global.fetch; let input;
  global.fetch = async (_url, init) => { input=JSON.parse(init.body).data; return {status:200,json:async()=>({data:{ok:true}})}; };
  try { await httpsCallableFromURL(getFunctions(app),'https://example.invalid/support')({expectedUid:'alice',id:'support-wire-real-123456789',text:'היי',image:undefined,context:{screen:'Profile',screenLabel:'בית'}}); }
  finally { global.fetch=originalFetch;await deleteApp(app); }
  assert.equal(input.image,null);
  const send=require('../../functions/lib/supportMessage').sendSupportMessage;
  const request={auth:{uid:'alice',token:{firebase:{sign_in_provider:'password'}}},data:input};
  const result=await send.run(request);await send.run(request);
  const snap=await db.doc(`dmConversations/${result.convId}/messages/${result.id}`).get();
  assert.equal(snap.data().text,'היי');assert.equal(snap.data().supportImage,undefined);
  await onDmChatMessage.run({data:snap,params:{convId:result.convId,msgId:result.id}});
  const thread=await service.loadThread('alice','אליס',true);
  assert.equal(thread.messages.filter(m=>m.id===result.id).length,1);assert.equal(thread.awaitingReply,true);
  assert.equal(alerts.at(-1)[0],'teamderReply');
});

const now = Date.now(), day = 86400_000;
async function createNewManager(uid, overrides = {}) {
  await db.doc(`users/${uid}`).set({ name: uid, createdAt: now - 2 * day, friends: [], ...overrides });
  await db.doc(`groups/club-${uid}`).set({ creatorId: uid, adminIds: [uid], playerIds: [uid], name: 'מועדון בדיקה מקומי', createdAt: now - day });
  await require('../../functions/lib/supportOutreach').enrollClubOutreach(`club-${uid}`, now - day);
}
test('outreach pause, concurrency and retries produce one official message per user', async () => {
  const engine = require('../../functions/lib/supportOutreach');
  await db.doc('adminConfig/supportOutreach').set({ enabled: false, delayHours: 24, startHour: 0, endHour: 24, timeZone: 'UTC' });
  await createNewManager('newmanager');
  assert.equal(await engine.sendClubOutreach('newmanager', now), 'paused');
  await db.doc('adminConfig/supportOutreach').update({ enabled: true });
  await Promise.all(Array.from({ length: 4 }, () => engine.sendClubOutreach('newmanager', now)));
  const conv = 'newmanager__teamder', messages = await db.collection(`dmConversations/${conv}/messages`).get();
  assert.equal(messages.size, 1); assert.equal(messages.docs[0].data().supportOrigin, 'club_onboarding');
  await engine.enrollClubOutreach('club-newmanager', now - day);
  assert.equal((await db.doc('supportOutreach/newmanager').get()).data().status, 'sent');
  assert.equal((await db.collection(`dmConversations/${conv}/messages`).get()).size, 1);
});
test('delay changes reschedule existing pending jobs without re-sending completed jobs', async () => {
  const engine = require('../../functions/lib/supportOutreach');
  await createNewManager('rescheduled');
  await db.doc('adminConfig/supportOutreach').update({ delayHours: 48 });
  await engine.rescheduleClubOutreach();
  const job = (await db.doc('supportOutreach/rescheduled').get()).data();
  assert.equal(job.scheduledAt, now + day);
  assert.equal(await engine.sendClubOutreach('rescheduled', now), 'waiting');
  assert.equal((await db.doc('supportOutreach/newmanager').get()).data().status, 'sent');
  await db.doc('adminConfig/supportOutreach').update({ delayHours: 24 });
});
test('deleted club, lost manager role, disabled account and human help suppress outreach', async () => {
  const engine = require('../../functions/lib/supportOutreach');
  for (const uid of ['deletedclub', 'lostrole', 'disablednew', 'humanhelp']) await createNewManager(uid);
  disabledAccounts.add('disablednew'); // account disabled after queue enrollment
  await db.doc('groups/club-deletedclub').delete();
  await db.doc('groups/club-lostrole').update({ adminIds: [] });
  await db.doc('dmConversations/humanhelp__teamder').set({ participants: ['humanhelp', 'teamder'], supportLastHumanAt: now - 1000 });
  for (const [uid, reason] of [['deletedclub', 'club_deleted'], ['lostrole', 'no_longer_admin'], ['disablednew', 'user_unavailable'], ['humanhelp', 'human_support_exists']]) {
    assert.equal(await engine.sendClubOutreach(uid, now), reason);
    const job = (await db.doc(`supportOutreach/${uid}`).get()).data(); assert.equal(job.status, 'skipped'); assert.equal(job.scheduledAt, undefined);
  }
});
test('only first real club of a new full account is enrolled', async () => {
  const engine = require('../../functions/lib/supportOutreach');
  await createNewManager('oldmanager', { createdAt: now - 30 * day });
  await createNewManager('guestmanager', { isGuest: true });
  assert.equal((await db.doc('supportOutreach/oldmanager').get()).exists, false);
  assert.equal((await db.doc('supportOutreach/guestmanager').get()).exists, false);
  await db.doc('groups/second-newmanager').set({ creatorId: 'newmanager', adminIds: ['newmanager'], createdAt: now });
  await engine.enrollClubOutreach('second-newmanager', now);
  assert.equal((await db.doc('supportOutreach/newmanager').get()).data().clubId, 'club-newmanager');
});
test('a reply remains recorded even if its trigger arrives after a later human answer', async () => {
  const { updateSupportSummary } = require('../../functions/lib/supportReply');
  await db.doc('dmConversations/newmanager__teamder').set({ participants: ['newmanager', 'teamder'] }, { merge: true });
  await updateSupportSummary('newmanager__teamder', 'answer-later', { senderId: 'teamder', text: 'בשמחה', createdAt: now + 2000 });
  await updateSupportSummary('newmanager__teamder', 'reply-earlier', { senderId: 'newmanager', text: 'צריך עזרה', createdAt: now + 1000 });
  assert.equal((await db.doc('supportOutreach/newmanager').get()).data().status, 'replied');
  assert.equal((await db.doc('dmConversations/newmanager__teamder').get()).data().supportLastMessageId, 'answer-later');
});

test('real message converter and typed recent windows retain photos and chronological history beyond 100 messages', async () => {
  const ts=require('typescript'),vm=require('node:vm');
  const source=ts.createSourceFile('firestore.ts',fs.readFileSync(path.join(root,'src/firebase/firestore.ts'),'utf8'),ts.ScriptTarget.Latest,true);
  const declaration=source.statements.filter(ts.isVariableStatement).flatMap(s=>[...s.declarationList.declarations]).find(d=>d.name.getText(source)==='chatMessageConverter');
  const context={};vm.runInNewContext(ts.transpileModule(`result = ${declaration.initializer.getText(source)}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
  const utilities={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/utils/supportTimeline.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,utilities);
  const start=Date.now()+86400_000,base='dmConversations/alice__teamder/messages';
  const batch=db.batch();for(let i=0;i<105;i++)batch.set(db.doc(`${base}/typed-old-${i}`),{senderId:'teamder',text:'הודעה ישנה מקומית',createdAt:admin.firestore.Timestamp.fromMillis(start+i)});
  batch.set(db.doc(`${base}/typed-latest-photo`),{senderId:'alice',text:'דוגמה',createdAt:start+200,supportImage:'/9j/AAAA',supportContext:{screen:'CommunitiesFeed',screenLabel:'מועדונים'}});await batch.commit();
  const {where,limit,Timestamp}=require('firebase/firestore');
  const alice=env.authenticatedContext('alice',{firebase:{sign_in_provider:'password'}}).firestore();
  const collectionRef=collection(alice,base).withConverter(context.result);
  const windows=await Promise.all([0,Timestamp.fromMillis(0)].map((minimum,index)=>getDocs(query(collectionRef,where('createdAt','>=',minimum),where('createdAt','<=',index===0?Number.MAX_SAFE_INTEGER:Timestamp.fromMillis(253402300799999)),orderBy('createdAt','desc'),limit(100)))));
  const merged=utilities.exports.mergeSupportMessages(windows.map(s=>s.docs.map(d=>d.data())));
  assert.equal(merged.length,100);assert.equal(merged.at(-1).id,'typed-latest-photo');
  assert.equal(merged.at(-1).supportImage,'/9j/AAAA');assert.equal(merged.at(-1).supportContext.screen,'CommunitiesFeed');
  assert.ok(merged.every((m,i)=>i===0||merged[i-1].createdAt<=m.createdAt));
});
