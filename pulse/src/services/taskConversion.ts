import { fromByteArray } from 'base64-js';
import { getDoc, queryEquals, createDocOnly, type FsDoc } from './firestoreRest';
import { convIdFor, TEAMDER_UID } from './teamderChatService';
import { invalidate } from './cache';
import { observeCaughtError } from './errorObservation';

export type TaskOrigin = { kind: 'feedback'; id: string } | { kind: 'support_message'; userId: string; messageId: string };
type Result = { taskId: string; created: boolean };
const inFlight = new Map<string, Promise<Result>>();
function segment(value: string): string {
  if (typeof value !== 'string' || !value || new TextEncoder().encode(value).length > 256 || /[\/\\\x00-\x1f]/.test(value) || value === '.' || value === '..') throw new Error('TASK_SOURCE_INVALID');
  return encodeURIComponent(value);
}
export function taskOriginPath(origin: TaskOrigin): string {
  if (origin.kind === 'feedback') return `feedback/${segment(origin.id)}`;
  if (origin.kind !== 'support_message') throw new Error('TASK_SOURCE_INVALID');
  if (!origin.userId || origin.userId === TEAMDER_UID || /\s|__/.test(origin.userId)) throw new Error('TASK_SOURCE_INVALID');
  return `dmConversations/${segment(convIdFor(origin.userId))}/messages/${segment(origin.messageId)}`;
}
/** Lossless bounded encoding: the same source always selects the same create-only document. */
export function taskIdForOrigin(origin: TaskOrigin): string {
  const id = 'source-' + fromByteArray(new TextEncoder().encode(taskOriginPath(origin))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (id.length > 1400) throw new Error('TASK_SOURCE_INVALID');
  return id;
}
const text = (v: unknown) => typeof v === 'string' ? v : '';
const META = ['source', 'sourceType', 'sourceId', 'sourcePath', 'createdAt'] as const;
function matches(doc: FsDoc, origin: TaskOrigin, path: string): boolean {
  if (doc.sourcePath) return doc.sourceType === origin.kind && doc.sourcePath === path;
  return origin.kind === 'feedback' && doc.source === 'teamder' && !doc.sourceType && doc.sourceId === origin.id;
}
function invalidateTasks() { invalidate('tasks'); invalidate('work:task'); invalidate('work:report'); }

async function ensure(origin: TaskOrigin, path: string): Promise<Result> {
  const id = taskIdForOrigin(origin), taskPath = `tasks/${id}`;
  const existing = await getDoc(taskPath, META);
  if (existing) {
    if (!matches(existing, origin, path)) throw new Error('TASK_SOURCE_CONFLICT');
    invalidateTasks(); return { taskId: existing.id, created: false };
  }
  if (origin.kind === 'feedback') {
    // Preserve old imported tasks rather than making a new copy under the modern id.
    const candidates = await queryEquals('tasks', 'sourceId', origin.id, 100, META);
    const legacy = candidates.filter(d => matches(d, origin, path))
      .sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0) || a.id.localeCompare(b.id));
    if (legacy.length) { invalidateTasks(); return { taskId: legacy[0].id, created: false }; }
    if (candidates.length === 100) throw new Error('TASK_SOURCE_LOOKUP_PARTIAL');
  }
  const source = await getDoc(path);
  if (!source) throw new Error('TASK_SOURCE_UNAVAILABLE');
  const support = origin.kind === 'support_message';
  if (support && (source.senderId !== origin.userId || source.senderId === TEAMDER_UID)) throw new Error('TASK_SOURCE_NOT_INCOMING');
  const body = text(support ? source.text : source.message).trim();
  const category = !support && source.type === 'suggestion' ? 'feature' : source.category === 'ui' ? 'ui' : 'bug';
  const reporterId = support ? origin.userId : text(source.userId);
  const reporterName = text(support ? source.senderName : source.userName);
  const context = support && source.supportContext && typeof source.supportContext === 'object' ? source.supportContext : source;
  const images = [...new Set([...(Array.isArray(source.images) ? source.images.filter((v: unknown): v is string => typeof v === 'string' && !!v) : []), text(support ? source.supportImage : source.image)].filter(Boolean))];
  const createdAt = typeof source.createdAt === 'number' && Number.isFinite(source.createdAt) ? source.createdAt : 0;
  const now = Date.now();
  const title = (body.split('\n')[0] || (support ? 'משימה מהודעת תמיכה' : 'משימה מהצעת משתמש')).slice(0, 160);
  const fields = {
    title, notes: body, category, priority: 'normal', status: 'new', doneAt: 0,
    // Older Pulse versions interpret every teamder/sourceId as a feedback id.
    source: support ? 'pulse' : 'teamder', sourceType: origin.kind, sourcePath: path,
    sourceId: support ? origin.messageId : origin.id,
    ...(support ? { sourceConversationId: convIdFor(origin.userId), sourceMessageId: origin.messageId } : {}),
    sourceText: body, sourceCreatedAt: createdAt,
    sourceContext: Object.fromEntries(['screen', 'screenLabel', 'step', 'groupId', 'gameId', 'appVersion', 'platform'].filter(key => typeof context[key] === 'string' || (typeof context[key] === 'number' && Number.isFinite(context[key]))).map(key => [key, context[key]])),
    reporterId, reporterName, screen: text(context.screen), images, createdAt: now, updatedAt: now,
  };
  // No write touches the report, message, reply status, screenshot or sender.
  const result = await createDocOnly(taskPath, fields);
  if (result === 'error') throw new Error('TASK_CREATE_FAILED');
  invalidateTasks();
  const saved = await getDoc(taskPath, META);
  if (!saved || !matches(saved, origin, path)) throw new Error('TASK_CREATE_NOT_CONFIRMED');
  return { taskId: saved.id, created: result === 'created' };
}
export function ensureTaskFromOrigin(origin: TaskOrigin): Promise<Result> {
  const path = taskOriginPath(origin), current = inFlight.get(path);
  if (current) return current;
  const work = ensure(origin, path);
  inFlight.set(path, work);
  void work.then(() => inFlight.delete(path), error => { observeCaughtError(error, {source:'pulse/src/services/taskConversion.ts',handler:'ensureTaskFromOrigin',site:'task:source'}); inFlight.delete(path); });
  return work;
}
