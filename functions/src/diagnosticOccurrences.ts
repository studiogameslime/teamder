/** Bounded evidence inside the existing document. No new collection or permissions. */
export function retainOccurrences(previous:unknown,next:Record<string,unknown>[]):Record<string,unknown>[] {
 const result:Record<string,unknown>[]=[];
 for(const item of [...(Array.isArray(previous)?previous:[]),...next]){
  if(!item||typeof item!=='object'||typeof item.id!=='string')continue;
  if(!result.some(x=>x.id===item.id))result.push(item);
 }
 return result.length<=3?result:[result[0],...result.slice(-2)];
}
