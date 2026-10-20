import { filterSupportThreads } from '../../pulse/src/services/supportInbox';
import type { ThreadSummary } from '../../pulse/src/services/teamderChatService';

test('prioritizes waiting conversations by oldest last incoming message, preserving sent recency', () => {
  const rows = [
    {userId:'new-wait',userName:'חדש',awaitingReply:true,lastMessageAt:300},
    {userId:'sent-old',userName:'טופל',awaitingReply:false,lastMessageAt:100},
    {userId:'old-wait',userName:'ישן',awaitingReply:true,lastMessageAt:200},
    {userId:'sent-new',userName:'טופל',awaitingReply:false,lastMessageAt:400},
  ] as ThreadSummary[];
  expect(filterSupportThreads(rows,'','all').map(row=>row.userId)).toEqual(['old-wait','new-wait','sent-new','sent-old']);
  expect(filterSupportThreads(rows,'','waiting').map(row=>row.userId)).toEqual(['old-wait','new-wait']);
  expect(filterSupportThreads(rows,'ישן','all').map(row=>row.userId)).toEqual(['old-wait']);
  expect(rows[0].userId).toBe('new-wait');
});
