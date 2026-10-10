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

import { has } from '../secrets';
import {
  getDoc,
  listAll,
  patchDoc,
  queryArrayContains,
  queryEquals,
} from './firestoreRest';
import { cached, invalidate } from './cache';

/** Mirrors TEAMDER_UID in functions/src/chatPush.ts — keep in sync. */
export const TEAMDER_UID = 'teamder';
const TEAMDER_NAME = 'Teamder';
const TEAMDER_PHOTO = 'https://teamderfc.web.app/logo.png';
/** Max message length the chat rules accept. */
const MAX_TEXT = 1000;

export interface TeamderMessage {
  id: string;
  text: string;
  senderId: string;
  /** True when Teamder sent it; false when the user replied. */
  fromTeamder: boolean;
  createdAt: number;
}

export interface TeamderThread {
  userId: string;
  userName: string;
  messages: TeamderMessage[];
  /** True when the LAST message came from the user — i.e. they're waiting. */
  awaitingReply: boolean;
  lastMessageAt: number;
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
): Promise<boolean> {
  if (!has.firebase()) return false;
  const body = text.trim().slice(0, MAX_TEXT);
  if (!body || !userId) return false;

  const convId = convIdFor(userId);
  // The conversation doc must exist and carry both participants — the app's
  // rules authorise reads off it (and off the id itself).
  await patchDoc(`dmConversations/${convId}`, {
    participants: [userId, TEAMDER_UID].sort(),
    updatedAt: now,
  });

  const msgId = `tm-${now}-${Math.floor(now % 1e6).toString(36)}`;
  const ok = await patchDoc(`dmConversations/${convId}/messages/${msgId}`, {
    text: body,
    senderId: TEAMDER_UID,
    // Denormalised on the message, which is how the app renders a chat row
    // without a user lookup — and how the brand's name and logo reach both
    // the conversation and the chats-list entry.
    senderName: TEAMDER_NAME,
    senderPhotoUrl: TEAMDER_PHOTO,
    createdAt: now,
  });
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
      const docs = await listAll(`dmConversations/${convId}/messages`).catch(
        () => [],
      );
      const messages: TeamderMessage[] = docs
        .map((d) => ({
          id: d.id,
          text: str(d.text),
          senderId: str(d.senderId),
          fromTeamder: str(d.senderId) === TEAMDER_UID,
          createdAt: num(d.createdAt),
        }))
        .sort((a, b) => a.createdAt - b.createdAt);
      const last = messages[messages.length - 1];
      return {
        userId,
        userName,
        messages,
        awaitingReply: !!last && !last.fromTeamder,
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
      () => [],
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
 * There's no separate "messages" screen, so without this a reply could sit
 * unread forever. The tasks screen surfaces the count, and the poller turns
 * new ones into a local push.
 */
/** One row in the Teamder inbox. */
export interface ThreadSummary {
  userId: string;
  userName: string;
  lastText: string;
  lastMessageAt: number;
  /** The last message came from the USER — they're waiting on us. */
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
      ).catch(() => []);
      const out: ThreadSummary[] = [];
      for (const c of mine) {
        const userId = c.id.split('__').find((x) => x !== TEAMDER_UID) ?? '';
        if (!userId) continue;
        const msgs = await listAll(`dmConversations/${c.id}/messages`).catch(
          () => [],
        );
        const sorted = msgs
          .map((m) => ({
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
          awaitingReply: last.senderId !== TEAMDER_UID,
        });
      }
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
  const d = await getDoc(`users/${userId}`).catch(() => null);
  return str(d?.name);
}
