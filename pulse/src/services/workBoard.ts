import type { WorkItem } from './workItems';
export type BoardTab = 'open' | 'claude' | 'done';
export function boardBuckets(items: WorkItem[]) {
  return {
    open: items.filter(i=>i.state==='open'),
    claude: items.filter(i=>i.state==='claude'),
    done: items.filter(i=>i.state==='done'),
  };
}
export function boardSections(items:WorkItem[], newest=false) {
 const sorted=[...items].sort((a,b)=>b.createdAt-a.createdAt);
 if(newest) return [{key:'all',title:'לפי עדכניות',items:sorted}];
 const urgent=sorted.filter(i=>i.state==='open' && (i.priority==='high' || !!i.unresolved));
 return [{key:'urgent',title:'דורש טיפול קודם',items:urgent},{key:'rest',title:urgent.length?'להמשך עבודה':'כל הפריטים',items:sorted.filter(i=>!urgent.includes(i))}].filter(g=>g.items.length);
}
