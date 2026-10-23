import { KIND_ORDER, type WorkItem, type WorkKind } from './workItems';
import { groupWorkSections } from './unresolvedWork';
export type BoardTab = 'open' | 'claude' | 'done';
export function boardBuckets(items: WorkItem[]) {
  return {
    open: items.filter(i=>i.state==='open'),
    claude: items.filter(i=>i.state==='claude'),
    done: items.filter(i=>i.state==='done'),
  };
}
export function boardSections(items:WorkItem[]) {
 const titles: Record<WorkKind,string> = {error:'שגיאות',report:'דיווחים',bug:'באגים',feature:'פיצ׳ר',ui:'עיצוב',idea:'רעיון',chat:'שיחות ממתינות'};
 return groupWorkSections(items,KIND_ORDER).map(group=>({
   key:group.kind,
   title:group.kind==='unresolved'?'באגים לא פתורים':titles[group.kind],
   items:[...group.items].sort((a,b)=>b.createdAt-a.createdAt),
 }));
}
