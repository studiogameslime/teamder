/** Correlation only, never authorization or business idempotence. Mirrored on the server. */
export function joinDiagnosticId(gameId:string,userId:string,tappedAt:number):string{
 const text=JSON.stringify([gameId,userId,tappedAt]);let a=0x811c9dc5,b=0x9e3779b9;
 for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,0x01000193);b=Math.imul(b^c,0x85ebca6b);}
 return `join-${(a>>>0).toString(16).padStart(8,'0')}${(b>>>0).toString(16).padStart(8,'0')}`;
}
