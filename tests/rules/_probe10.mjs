import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import fs from 'node:fs';
let rules = fs.readFileSync('/Users/matan/Projects/soccer/firestore.rules','utf8');
const anchor = `      allow create: if isSignedIn() &&
        request.resource.data.adminIds == [request.auth.uid] &&`;
if(!rules.includes(anchor)) { console.log('anchor missing'); process.exit(1); }
rules = rules.replace(anchor, `      allow create: if isSignedIn() &&
        !('seasons' in request.resource.data) &&
        request.resource.data.adminIds == [request.auth.uid] &&`);
const e = await initializeTestEnvironment({projectId:'p10', firestore:{rules,host:'127.0.0.1',port:8080}});
await e.clearFirestore();
const db = e.authenticatedContext('planter').firestore();
const base = { name:'מועדון', adminIds:['planter'], playerIds:['planter'], pendingPlayerIds:[], createdAt:1 };
try { await setDoc(doc(db,'groups','planted'), {...base, seasons:{enabled:true,count:1e9}}); console.log('planted → ALLOWED (bad)'); }
catch { console.log('planted → DENIED (good)'); }
try { await setDoc(doc(db,'groups','clean'), base); console.log('normal create → ALLOWED (good)'); }
catch(err){ console.log('normal create → DENIED (bad)', String(err.message).slice(0,120)); }
await e.cleanup();
