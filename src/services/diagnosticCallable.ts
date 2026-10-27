import { httpsCallable as firebaseCallable } from 'firebase/functions';
import { beginDiagnosticOperation, diagnosticOwner } from './diagnosticJournal';
export * from 'firebase/functions';

/** Keep SDK response/error identity, options and streaming API intact. Never instrument report delivery. */
export const httpsCallable:typeof firebaseCallable=((functions:unknown,name:string,options:unknown)=>{
 const call=firebaseCallable(functions as Parameters<typeof firebaseCallable>[0],name,options as Parameters<typeof firebaseCallable>[2]);
 if(name==='recordClientError')return call;
 const observed=async(data?:unknown)=>{
  const owner=diagnosticOwner(),span=beginDiagnosticOperation(`call:${name}`,data);
  // Only object payloads can carry metadata without changing the wire contract.
  const payload=data&&typeof data==='object'&&!Array.isArray(data)?{...data,_diagnostic:{requestId:span.id}}:data;
  try{const result=await call(payload);if(owner===diagnosticOwner())span.finish(undefined,false,result.data);return result;}
  catch(error){if(owner===diagnosticOwner())span.finish(error,true);throw error;}
 };
 // No existing caller uses streaming. Preserve it without interpreting streaming completion as RPC success.
 observed.stream=call.stream?.bind(call);
 return observed;
}) as typeof firebaseCallable;
