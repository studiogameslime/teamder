import type { InboxPreview } from '@/components/chat/ChatInbox';
import type { ChatMessage } from '@/types';
import { getCoverSource } from '@/data/coverImages';

const now=Date.now();
export const chatInboxPreview: InboxPreview = {
  rows:[
    {scope:'community',id:'qa-club',title:'כדורגל אנשים טובים',preview:'איתי: מי מביא כדור השבוע?',at:now-900000,unread:4,image:getCoverSource('c03')!,subtitle:'שיחת המועדון'},
    {scope:'dm',id:'qa-dm',title:'איתי לוי',preview:'סגור, נתראה על המגרש ⚽',at:now-1500000,unread:2,user:{id:'qa-itay',name:'איתי לוי',avatarId:'a13'},subtitle:'שיחה אישית'},
    {scope:'game',id:'qa-round',title:'רביעי כדורגל בנחלים',preview:'דניאל: אני כבר בדרך למגרש',at:now-3600000,unread:0,image:getCoverSource('c05')!,subtitle:'שיחת המחזור'},
    {scope:'dm',id:'qa-dm2',title:'דניאל כהן',preview:'אני: משחק מעולה אתמול!',at:now-86400000,unread:0,user:{id:'qa-daniel',name:'דניאל כהן',avatarId:'a09'},subtitle:'שיחה אישית'},
    {scope:'game',id:'qa-old',title:'חמישי כדורגל',preview:'תודה לכולם, היה ערב מעולה',at:now-172800000,unread:0,closed:true,image:getCoverSource('c11')!,subtitle:'שיחת המחזור'},
    {scope:'community',id:'qa-start',title:'מועדון שכונת שושני',preview:'',at:0,unread:0,image:getCoverSource('c13')!,subtitle:'שיחת המועדון'},
  ],
  preferences:{'community__qa-club':{pinned:true,muted:false,archivedAt:0},'dm__qa-dm2':{pinned:false,muted:true,archivedAt:0}},
  friends:[{id:'qa-itay',name:'איתי לוי',avatarId:'a13',createdAt:now},{id:'qa-daniel',name:'דניאל כהן',avatarId:'a09',createdAt:now},{id:'qa-noam',name:'נועם אברהם',avatarId:'a03',createdAt:now}],
};
export function chatPreviewMessages(meId:string):ChatMessage[] {
  return [
    {id:'qa-msg1',senderId:'qa-itay',senderName:'איתי לוי',senderAvatarId:'a13',text:'איזה ערב! היה כיף לשחק איתכם ⚽',createdAt:now-900000},
    {id:'qa-msg2',senderId:meId,senderName:'אני',text:'לגמרי, נתראה במחזור הבא!',createdAt:now-840000},
    {id:'qa-msg3',senderId:'qa-daniel',senderName:'דניאל כהן',senderAvatarId:'a09',text:'מישהו לקח את הגופיות בסוף?',createdAt:now-780000},
    {id:'qa-msg4',senderId:meId,senderName:'אני',text:'כן, אצלי. אביא אותן בשבוע הבא 👍',createdAt:now-720000},
  ];
}
