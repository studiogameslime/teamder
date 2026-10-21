import { observeCaughtError } from './errorObservation';
// Talking to a user AS Teamder.
//
// When someone reports a bug we want to answer them — but from the brand, not
// from a personal profile. This rides the app's existing 1-on-1 chat: a
// conversation between the user and a reserved `teamder` account, which the
// app renders like any other DM. Nothing in the Teamder client knows or cares
// that one participant isn't a person, so this needed NO app release.
//
// The message is plain text on purpose. `ChatMessage` in the app has no
// attachment or quote fields ("No images in v1"), so a quoted report is
// formatted INTO the text — which works today, for every user, including
// those who never update.

import { has } from '../capabilities';
import {
  getDoc,
  patchDoc,
  queryArrayContains,
  queryEquals,
  queryCollectionRecent,
  createDocOnly,
} from './firestoreRest';
import { cached, invalidate } from './cache';

/** Mirrors TEAMDER_UID in functions/src/chatPush.ts — keep in sync. */
export const TEAMDER_UID = 'teamder';
const TEAMDER_NAME = 'Teamder';
const TEAMDER_PHOTO = 'https://teamderfc.web.app/logo.png';
/** Max message length the chat rules accept. */
export const MAX_TEXT = 1000;
export const THREAD_WINDOW = 100;

export function newTeamderMessageId(now = Date.now()): string {
  return `tm-${now}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function validUserId(userId: string): boolean {
  return !!userId && userId !== TEAMDER_UID && !/[\/\s]/.test(userId) && !userId.includes('__');
}

export interface TeamderMessage {
  id: string;
  text: string;
  senderId: string;
  /** True when Teamder sent it; false when the user replied. */
  fromTeamder: boolean;
  createdAt: number;
  supportImage?: string;
  supportContext?: { screen: string; screenLabel?: string; step?: number; groupId?: string; gameId?: string; appVersion?: string; platform?: string };
}

export interface TeamderThread {
  userId: string;
  userName: string;
  messages: TeamderMessage[];
  /** Last sender is the user and that exact message has not been resolved. */
  awaitingReply: boolean;
  lastMessageAt: number;
  lastMessageId?: string;
  resolved?: boolean;
}

/** A report this user filed, offered for quoting. */
export interface UserReport {
  id: string;
  message: string;
  category: string;
  screen: string;
  createdAt: number;
  hasImage: boolean;
}

/**
 * Conversation id — the SAME rule the app uses (`dmConvId`): the two uids
 * sorted and joined. Getting this wrong would create a conversation the app
 * can't find, so it must stay identical to src/services/chatService.ts.
 */
export function convIdFor(userId: string): string {
  return [userId, TEAMDER_UID].sort().join('__');
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Format a report as a quote block. Plain text, because that's what the app
 * can render — but shaped so it reads as a quote rather than as our words.
 */
export function quoteReport(r: UserReport, userName: string): string {
  const when = new Date(r.createdAt);
  const date = `${when.getDate()}.${when.getMonth() + 1}`;
  const body = r.message.trim().slice(0, 400);
  const greeting = userName ? `היי ${userName.split(' ')[0]}, ` : '';
  return `${greeting}לגבי מה שדיווחת לנו ב־${date}:\n\n« ${body} »\n\n`;
}

export async function sendTeamderMessage(
  userId: string,
  text: string,
  now: number,
  messageId = newTeamderMessageId(now),
): Promise<boolean> {
  if (!has.firebase()) return false;
  const body = text.trim();
  if (!body || body.length > MAX_TEXT || !validUserId(userId) || !/^tm-[a-zA-Z0-9-]+$/.test(messageId)) return false;

  const convId = convIdFor(userId);
  // The conversation doc must exist and carry both participants — the app's
  // rules authorise reads off it (and off the id itself).
  const ready = await patchDoc(`dmConversations/${convId}`, {
    participants: [userId, TEAMDER_UID].sort(),
    updatedAt: now,
  });
  if (!ready) return false;

  const path = `dmConversations/${convId}/messages/${messageId}`;
  const outcome = await createDocOnly(path, {
    text: body,
    senderId: TEAMDER_UID,
    // Denormalised on the message, which is how the app renders a chat row
    // without a user lookup — and how the brand's name and logo reach both
    // the conversation and the chats-list entry.
    senderName: TEAMDER_NAME,
    senderPhotoUrl: TEAMDER_PHOTO,
    createdAt: now,
  });
  let ok = outcome === 'created';
  if (outcome === 'conflict') {
    const existing = await getDoc(path);
    ok = existing?.senderId === TEAMDER_UID && existing?.text === body;
  }
  invalidate(`teamderThread.${userId}`);
  invalidate('teamderThreadList');
  return ok;
}

export async function loadThread(
  userId: string,
  userName: string,
  force = false,
): Promise<TeamderThread> {
  if (!has.firebase()) {
    return { userId, userName, messages: [], awaitingReply: false, lastMessageAt: 0 };
  }
  return cached(
    `teamderThread.${userId}`,
    async () => {
      const convId = convIdFor(userId);
      const [docs, conversation] = await Promise.all([
        queryCollectionRecent(`dmConversations/${convId}/messages`, THREAD_WINDOW),
        getDoc(`dmConversations/${convId}`),
      ]);
      const messages: TeamderMessage[] = docs
        .map((d) => ({
          id: d.id,
          text: str(d.text),
          senderId: str(d.senderId),
          fromTeamder: str(d.senderId) === TEAMDER_UID,
          createdAt: num(d.createdAt),
          supportImage: typeof d.supportImage === 'string' && d.supportImage.length <= 180_000 && d.supportImage.startsWith('/9j/') ? d.supportImage : undefined,
          supportContext: d.supportContext && typeof d.supportContext.screen === 'string' ? d.supportContext : undefined,
        }))
        .sort((a, b) => a.createdAt - b.createdAt);
      const last = messages[messages.length - 1];
      return {
        userId,
        userName,
        messages,
        awaitingReply: !!last && !last.fromTeamder && !isSupportResolved(conversation, last.id, last.createdAt),
        resolved: !!last && isSupportResolved(conversation, last.id, last.createdAt),
        lastMessageId: last?.id,
        lastMessageAt: last?.createdAt ?? 0,
      };
    },
    { force },
  );
}

/**
 * This user's most recent reports — the pool to quote from. Covers every kind
 * (screenshot report, bug, feature idea) since they all land in `feedback`.
 *
 * Capped on purpose. A heavy tester here has 167 reports, and neither a
 * 167-row picker nor a 167-document read per sheet-open is useful — the one
 * you want to quote is almost always recent. The UI says it's showing the
 * latest rather than implying this is everything.
 */
export const REPORTS_LIMIT = 40;

export async function listUserReports(userId: string): Promise<UserReport[]> {
  if (!has.firebase() || !userId) return [];
  return cached(`userReports.${userId}`, async () => {
    const docs = await queryEquals('feedback', 'userId', userId, REPORTS_LIMIT).catch(
      (caughtError3bb28ccec3: unknown) => { observeCaughtError(caughtError3bb28ccec3, {"source":"pulse/src/services/teamderChatService.ts","handler":"listUserReports","site":"teamderChatService:3bb28ccec3"}); return []; },
    );
    return docs
      .map((d) => ({
        id: d.id,
        message: str(d.message),
        category: str(d.category) || 'bug',
        screen: str(d.screen),
        createdAt: toMs(d.createdAt),
        hasImage: typeof d.image === 'string' && d.image.length > 0,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  });
}

/** `createdAt` on feedback is a Firestore timestamp, not a number. */
function toMs(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

/**
 * All conversations that have a user reply we haven't answered yet.
 *
 * Shared by the tasks badge and the dedicated operator inbox. The server
 * sends operator reply notifications independently of the local poller.
 */
/** One row in the Teamder inbox. */
export interface ThreadSummary {
  userId: string;
  userName: string;
  lastText: string;
  lastMessageAt: number;
  lastMessageId?: string;
  resolved?: boolean;
  /** User wrote last, without an explicit resolution of that message. */
  awaitingReply: boolean;
}

/**
 * Every Teamder conversation, newest first — answered ones included.
 *
 * `listAwaitingReply` below only ever returned threads where the user spoke
 * last, so a conversation vanished the moment it was answered and there was no
 * way back into it. That made "did they reply to what I sent?" unanswerable
 * without knowing the user and going through their profile.
 *
 * Names are resolved from /users here rather than left to the caller. The
 * awaiting-list on the tasks screen looked its names up in the TASK list, so a
 * thread not born from a report — the normal case for a conversation we
 * started ourselves — rendered as a nameless "משתמש".
 */
export async function listThreads(force = false): Promise<ThreadSummary[]> {
  if (!has.firebase()) return [];
  return cached(
    'teamderThreadList',
    async () => {
      // Ask Firestore for OUR conversations only. Listing the collection and
      // filtering here would read every private conversation between every
      // pair of users in the app, to find the handful that involve us.
      const mine = await queryArrayContains(
        'dmConversations',
        'participants',
        TEAMDER_UID,
      );
      const out: ThreadSummary[] = [];
      let next = 0;
      // Resolve a bounded number of independent conversations in parallel.
      // A cold name/message lookup must not serialize every later thread.
      const worker = async () => { while (next < mine.length) {
        const c = mine[next++];
        const participants = Array.isArray(c.participants) ? c.participants : [];
        const userId = participants.find((x: unknown) => typeof x === 'string' && x !== TEAMDER_UID) ?? '';
        if (!validUserId(userId) || participants.length !== 2 || c.id !== convIdFor(userId)) continue;
        const msgs = typeof c.supportLastMessageId === 'string' && typeof c.supportLastSenderId === 'string' && typeof c.supportLastMessageAt === 'number'
          ? [{ id: c.supportLastMessageId, senderId: c.supportLastSenderId, text: c.supportLastText, createdAt: c.supportLastMessageAt }]
          : await queryCollectionRecent(`dmConversations/${c.id}/messages`, 1);
        const sorted = msgs
          .map((m) => ({
            id: str(m.id),
            senderId: str(m.senderId),
            text: str(m.text),
            createdAt: num(m.createdAt),
          }))
          .sort((a, b) => a.createdAt - b.createdAt);
        const last = sorted[sorted.length - 1];
        if (!last) continue;
        out.push({
          userId,
          userName: await userNameOf(userId),
          lastText: last.text,
          lastMessageAt: last.createdAt,
          lastMessageId: last.id,
          resolved: isSupportResolved(c, last.id, last.createdAt),
          awaitingReply: last.senderId !== TEAMDER_UID && !isSupportResolved(c, last.id, last.createdAt),
        });
      } };
      await Promise.all(Array.from({ length: Math.min(4, mine.length) }, worker));
      return out.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    },
    { force },
  );
}

/**
 * Threads waiting on us. A view over {@link listThreads} — one query, one
 * cache, and the same resolved names.
 */
export async function listAwaitingReply(
  force = false,
): Promise<ThreadSummary[]> {
  return (await listThreads(force)).filter((t) => t.awaitingReply);
}

/** Display name for a uid, for the thread header. */
export async function userNameOf(userId: string): Promise<string> {
  return cached(`teamderUserName.${userId}`, async () => {
    const d = await getDoc(`users/${userId}`);
    return str(d?.name);
  });
}

/** The exact last message is the boundary: even a same-clock new reply reopens. */
export function isSupportResolved(conversation: Record<string, unknown> | null | undefined, messageId: string, at: number): boolean {
  return !!messageId && at > 0 && conversation?.supportResolvedMessageId === messageId && conversation?.supportResolvedMessageAt === at;
}

/** Administrative metadata only; never creates a message or changes the last sender. */
export async function resolveSupportThread(userId: string, messageId: string, messageAt: number): Promise<boolean> {
  if (!has.firebase() || !validUserId(userId) || !messageId || /[\/\s]/.test(messageId) || !Number.isFinite(messageAt) || messageAt <= 0) return false;
  const ok = await patchDoc(`dmConversations/${convIdFor(userId)}`, {
    supportResolvedMessageId: messageId,
    supportResolvedMessageAt: messageAt,
    supportResolvedAt: Date.now(),
  }, { mustExist: true });
  if (ok) { invalidate(`teamderThread.${userId}`); invalidate('teamderThreadList'); }
  return ok;
}

export async function reopenSupportThread(userId: string): Promise<boolean> {
  if (!has.firebase() || !validUserId(userId)) return false;
  const ok = await patchDoc(`dmConversations/${convIdFor(userId)}`, {
    supportResolvedMessageId: '', supportResolvedMessageAt: 0, supportResolvedAt: 0,
  }, { mustExist: true });
  if (ok) { invalidate(`teamderThread.${userId}`); invalidate('teamderThreadList'); }
  return ok;
}
