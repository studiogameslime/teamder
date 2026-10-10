// chatMonitorService — reads the Teamder chat data model so Pulse can (a)
// stream every chat message (with sender + text) and (b) surface user reports
// of abusive messages. Same datastore service-account token as everything else
// (bypasses rules).
//
// Teamder chat layout:
//   • messages live in subcollections /games/{id}/messages and
//     /groups/{id}/messages — read via a collection-group query.
//   • a reported message is written to the top-level /chatReports collection
//     with the offending text + sender denormalised onto the report doc.

import {
  listAll,
  getDoc,
  patchDoc,
  deleteDoc,
  queryGroupRecent,
  type FsDoc,
} from './firestoreRest';

export type ChatScope = 'game' | 'community' | string;

const scopeOf = (parentColl: string): ChatScope =>
  parentColl === 'games' ? 'game' : parentColl === 'groups' ? 'community' : parentColl;

// ── chat messages (live feed + per-message push) ───────────────────
export interface ChatMsg {
  id: string;
  scope: ChatScope;
  parentId: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: number;
}

export async function listRecentChatMessages(limit = 40): Promise<ChatMsg[]> {
  const docs = await queryGroupRecent('messages', 'createdAt', limit).catch(
    () => [],
  );
  return docs.map((d) => ({
    id: d.id,
    scope: scopeOf(d._parentColl),
    parentId: d._parentId,
    senderId: String(d.senderId ?? ''),
    senderName: String(d.senderName ?? ''),
    text: String(d.text ?? ''),
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : 0,
  }));
}

// ── reported messages (/chatReports) ───────────────────────────────
export type ChatReportStatus = 'new' | 'reviewed' | 'done';
const RSTATUSES: ChatReportStatus[] = ['new', 'reviewed', 'done'];

export interface ChatReport {
  id: string;
  reporterId: string;
  scope: ChatScope;
  parentId: string;
  messageId: string;
  messageText: string;
  senderId: string;
  senderName: string;
  createdAt: number;
  status: ChatReportStatus;
}

export async function listChatReports(): Promise<ChatReport[]> {
  const docs = await listAll('chatReports').catch(() => [] as FsDoc[]);
  return docs
    .map((d): ChatReport => ({
      id: d.id,
      reporterId: String(d.reporterId ?? ''),
      scope: String(d.scope ?? ''),
      parentId: String(d.parentId ?? ''),
      messageId: String(d.messageId ?? ''),
      messageText: String(d.messageText ?? ''),
      senderId: String(d.senderId ?? ''),
      senderName: String(d.senderName ?? ''),
      // The app writes a server timestamp (createdAt) + a client ms backup
      // (createdAtMs). Prefer the numeric backup for sorting.
      createdAt:
        typeof d.createdAtMs === 'number'
          ? d.createdAtMs
          : typeof d.createdAt === 'number'
            ? d.createdAt
            : 0,
      status: RSTATUSES.includes(d.status as ChatReportStatus)
        ? (d.status as ChatReportStatus)
        : 'new',
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function setChatReportStatus(
  id: string,
  status: ChatReportStatus,
): Promise<boolean> {
  return patchDoc(`chatReports/${id}`, { status });
}

export async function deleteChatReport(id: string): Promise<boolean> {
  return deleteDoc(`chatReports/${id}`);
}

// ── blocks (who blocked whom) ───────────────────────────────────────
// Blocks live at /users/{blockerId}/blocked/{blockedId} = { at }. Read via
// a collection-group query (same shape as messages). Names aren't stored on
// the block doc, so we resolve both sides from /users/{uid}.name.
export interface ChatBlock {
  id: string; // `${blockerId}:${blockedId}` — stable row key
  blockerId: string;
  blockerName: string;
  blockedId: string;
  blockedName: string;
  at: number;
}

export async function listRecentBlocks(limit = 80): Promise<ChatBlock[]> {
  const docs = await queryGroupRecent('blocked', 'at', limit).catch(
    () => [] as Array<FsDoc & { _parentId?: string }>,
  );
  // Unique uids on both sides → one /users read each, cached in a map.
  const uids = new Set<string>();
  for (const d of docs) {
    const blockerId = (d as { _parentId?: string })._parentId ?? '';
    if (blockerId) uids.add(blockerId);
    if (d.id) uids.add(d.id);
  }
  const names: Record<string, string> = {};
  await Promise.all(
    Array.from(uids).map(async (uid) => {
      const u = await getDoc(`users/${uid}`).catch(() => null);
      names[uid] = (u?.name as string) || uid.slice(0, 6);
    }),
  );
  return docs.map((d) => {
    const blockerId = (d as { _parentId?: string })._parentId ?? '';
    const blockedId = d.id;
    return {
      id: `${blockerId}:${blockedId}`,
      blockerId,
      blockerName: names[blockerId] ?? blockerId.slice(0, 6),
      blockedId,
      blockedName: names[blockedId] ?? blockedId.slice(0, 6),
      at: typeof d.at === 'number' ? d.at : 0,
    };
  });
}
