import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import fs from 'node:fs';
const HEAD = fs.readFileSync('/Users/matan/Projects/soccer/firestore.rules','utf8');
const BASE = fs.readFileSync('./_base.rules','utf8');
let n=0;
const N = 498;
const players = Array.from({length:N},(_,i)=>'u'+i).concat(['coadmin','creator','joiner']);
const pending = Array.from({length:200},(_,i)=>'p'+i).concat(['asker']);
const admins = ['creator','coadmin','a3'];

async function mk(rules, hasSeasons){
  const e = await initializeTestEnvironment({projectId:'p7-'+(++n), firestore:{rules,host:'127.0.0.1',port:8080}});
  await e.clearFirestore();
  await e.withSecurityRulesDisabled(async c=>{
    await setDoc(doc(c.firestore(),'groups','g1'),{
      name:'club',adminIds:admins,creatorId:'creator',playerIds:players,
      pendingPlayerIds:pending,createdAt:1,isOpen:true,maxMembers:0,description:'d',
      ...(hasSeasons?{seasons:{enabled:true,currentNo:2,currentId:'s2',count:1,startedAt:1,cadence:{type:'date',months:6,endsAt:9}}}:{}),
    });
  });
  return e;
}
const cases = {
  'admin edits description': ['coadmin', {description:'חדש'}],
  'creator rotates admins': ['creator', {adminIds:['creator','coadmin','a3','u5'], updatedAt:2}],
  'stranger asks to join (pending)': ['newguy', {pendingPlayerIds:pending.concat(['newguy']), updatedAt:2}],
  'pending withdraws': ['asker', {pendingPlayerIds:pending.filter(p=>p!=='asker'), updatedAt:2}],
  'stranger self-joins open club': ['newguy2', {playerIds:players.concat(['newguy2']), updatedAt:2}],
  'player self-leaves': ['u7', {playerIds:players.filter(p=>p!=='u7'), updatedAt:2}],
  'co-admin self-leaves': ['coadmin', {adminIds:admins.filter(a=>a!=='coadmin'), playerIds:players.filter(p=>p!=='coadmin'), updatedAt:2}],
  'creator hands off & leaves': ['creator', {adminIds:['coadmin','a3'], playerIds:players.filter(p=>p!=='creator'), creatorId:'coadmin', updatedAt:2}],
};
for (const hasSeasons of [true,false]) {
  for (const [label,[uid,payload]] of Object.entries(cases)) {
    const out = {};
    for (const [tag,rules] of [['BASE',BASE],['HEAD',HEAD]]) {
      const e = await mk(rules, hasSeasons);
      try { await updateDoc(doc(e.authenticatedContext(uid).firestore(),'groups','g1'), payload); out[tag]='ALLOW'; }
      catch(err){ out[tag] = /1000 expressions/.test(err.message) ? 'DENY(budget)' : 'DENY'; }
      await e.cleanup();
    }
    const flag = out.BASE===out.HEAD ? '   ' : '<<<';
    console.log(`${flag} seasons=${hasSeasons?'yes':'no '} ${label.padEnd(34)} BASE=${out.BASE.padEnd(12)} HEAD=${out.HEAD}`);
  }
}
