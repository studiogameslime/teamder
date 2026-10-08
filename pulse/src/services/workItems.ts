// The work list — EVERYTHING that needs doing, in one place.
//
// Pulse used to scatter the same question ("what's open?") across five screens,
// each with its own collection and its own status vocabulary: משימות (tasks),
// שגיאות (errors), דיווחים (feedback), פיצרים (pulseFeatures) and רעיונות
// (pulseIdeas). So "go over the open items" had five different answers and no
// single place to see them. Now it has one: this module normalises all five
// into a single `WorkItem`, and the משימות screen renders that.
//
// ⚠️ NOTHING IS MIGRATED. Each item keeps living in its own collection, under
// its own status vocabulary, and every existing screen and counter keeps
// working untouched. The unification happens on READ. That matters because the
// closing vocabulary genuinely differs per stream — `errors` closes on
// 'resolved', the rest on 'done' — and writing the wrong one leaves an item
// counted as open forever. `closeItem()` below is the single place that knows
// which word each stream wants.
//
// ⚠️ WHY THIS DOES ITS OWN READS instead of reusing the per-stream services.
//
// Pulse keeps screenshots as base64 ON the document (there is no Storage
// bucket). Loading the five collections whole meant 34.8MB per open, of which
// 33.6MB — 96% — was JPEG this screen never renders: 351 screenshots hanging
// off closed `feedback` reports alone. That is what made the home screen slow,
// and no amount of trimming the RENDERED list could fix it, because the cost
// was already paid by the time anything was rendered.
//
// So the work list projects the image fields away (see LIST_FIELDS) and pulls
// them for ONE document at a time, when a row is actually expanded. The
// per-stream screens still read whole documents through their own services and
// their own caches; those screens are opened rarely, this one is the launch
// screen.

import { has } from '../secrets';
import { MOCK_WORK } from '../config';
import { mockWork } from './workItemsMock';
import { listAll, getDoc, patchDoc, type FsDoc } from './firestoreRest';
import { cached, invalidate } from './cache';
import { readClaude, type ClaudeCompletion } from './claudeWork';
import { type Task, type TaskPriority } from './tasksService';
import { type FeatureItem } from './featuresService';
import { type IdeaItem, type IdeaStatus } from './ideasService';
import { screenHe } from './screenNames';
import { listAwaitingReply, type ThreadSummary } from './teamderChatService';

export type WorkStream = 'task' | 'error' | 'report' | 'feature' | 'idea' | 'chat';

/**
 * Three states, and the middle one is the point of this whole change.
 *
 *   open   — nobody has finished it.
 *   claude — Claude finished it and left a note + proof. STILL OPEN as far as
 *            every other counter is concerned; it is waiting for the owner to
 *            read what changed and accept it.
 *   done   — the owner accepted it (or closed it himself).
 */
export type WorkState = 'open' | 'claude' | 'done';

export interface WorkItem {
  /** Unique across streams — the id alone is not (two collections can collide). */
  key: string;
  stream: WorkStream;
  /** The tag shown on the row and used by the filter. See WorkKind. */
  kind: WorkKind;
  id: string;
  /** `collection/id`, so the handover can be written without knowing the stream. */
  docPath: string;
  title: string;
  /** Longer detail, when the source has one distinct from the title. */
  body: string;
  /** Attached screenshots — raw base64 JPEG, no `data:` prefix. */
  images: string[];
  state: WorkState;
  claude: ClaudeCompletion | null;
  createdAt: number;
  /** Sorting weight inside a stream. Only tasks carry a real priority. */
  priority: TaskPriority;
  /** Where in Teamder it came from, already translated to Hebrew. */
  screen: string;
  reporterId: string;
  reporterName: string;
  /** Occurrences, for errors. 1 everywhere else. */
  count: number;
  /**
   * May Claude act on this item without asking first?
   *
   * FALSE for an idea still parked as 'רעיון'. Those are the owner's to
   * characterise before anyone builds anything — "go over the open items" must
   * skip them, and the screen says so on the row rather than leaving it to be
   * remembered. Everything else is fair game: an idea moved to 'לאיפיון' wants
   * a spec written, one moved to 'לביצוע' wants building.
   */
  claudeMayAct: boolean;
  /** Why, when `claudeMayAct` is false — or what the item is waiting for. */
  hint: string;
}

// Plural, because every place these are shown carries a count beside them
// ("משימות 26"), and a singular noun next to a number reads as a typo.
/**
 * What KIND of thing this is — the tag on the row, and what the filter filters.
 *
 * Deliberately finer than `stream`. A stream is where an item is stored; a kind
 * is what it IS, which is the only thing worth sorting your morning by. Three
 * different kinds all live in the `tasks` collection (a bug, a design note and
 * a feature idea are not the same work), and `chat` has no collection at all —
 * it is a live Teamder conversation someone is waiting on.
 */
export type WorkKind =
  | 'bug'
  | 'ui'
  | 'feature'
  | 'error'
  | 'report'
  | 'idea'
  | 'chat';

export const KIND_LABEL: Record<WorkKind, string> = {
  bug: 'באג',
  ui: 'עיצוב',
  feature: 'פיצ׳ר',
  error: 'שגיאה',
  report: 'דיווח',
  idea: 'רעיון',
  chat: 'צ׳אט',
};

export const KIND_ICON: Record<WorkKind, string> = {
  bug: 'bug',
  ui: 'color-palette',
  feature: 'sparkles',
  error: 'warning',
  report: 'chatbubble-ellipses',
  idea: 'bulb',
  chat: 'mail-unread',
};

/** Order the groups appear in — most urgent kind of work first. */
export const KIND_ORDER: WorkKind[] = [
  'chat',
  'error',
  'report',
  'bug',
  'ui',
  'feature',
  'idea',
];

/** The collection each stream lives in — also the closing vocabulary key. */
const COLL: Record<WorkStream, string> = {
  task: 'tasks',
  error: 'errors',
  report: 'feedback',
  feature: 'pulseFeatures',
  idea: 'pulseIdeas',
  // A chat thread is a live conversation, not a stored work item — it is never
  // closed or handed over here, only opened. The entry keeps the record total.
  chat: '',
};

/**
 * The word each stream uses for "closed".
 * ⚠️ `errors` says 'resolved'; everything else says 'done'. Getting this wrong
 * does not fail loudly — it leaves the item counted as open by the badge
 * queries forever. This map is the only place the distinction is written down.
 */
const CLOSED_STATUS: Record<WorkStream, string> = {
  task: 'done',
  error: 'resolved',
  report: 'done',
  feature: 'done',
  idea: 'done',
  chat: '',
};

/** Cache keys to drop when an item changes, so the next read is fresh. */
/** Cache keys to drop when an item changes — BOTH the lean list this screen
 *  reads and the full list the per-stream screens read, so neither goes stale
 *  after a write. */
const CACHE_KEYS: Record<WorkStream, readonly string[]> = {
  task: ['work:task', 'tasks'],
  error: ['work:error', 'raw:errors'],
  report: ['work:report', 'raw:feedback'],
  feature: ['work:feature', 'pulseFeatures'],
  idea: ['work:idea', 'pulseIdeas'],
  chat: ['teamderThreads'],
};

/**
 * How many CLOSED items to keep on screen. The open list is the work; the
 * closed list is a receipt, and 687 receipts is not a screen anyone reads — it
 * is a screen everyone waits for. The most recent 20 answer "did that go
 * through?", which is the only question the tab is ever asked.
 */
export const DONE_LIMIT = 20;

/**
 * The fields the LIST needs — deliberately excluding every image field
 * (`images`, `image`, `claudeImages`). See the note at the top of the file.
 */
const LIST_FIELDS: Record<Exclude<WorkStream, 'chat'>, readonly string[]> = {
  task: ['title', 'notes', 'category', 'status', 'priority', 'source', 'screen',
    'reporterId', 'reporterName', 'createdAt', 'doneAt',
    'claudeStatus', 'claudeNote', 'claudeAt'],
  error: ['title', 'operation', 'status', 'count', 'firstSeen', 'lastSeen',
    'lastMessage', 'lastScreen', 'lastUserId',
    'claudeStatus', 'claudeNote', 'claudeAt'],
  report: ['type', 'message', 'userName', 'userId', 'screen', 'createdAt',
    'status', 'fixRequested', 'trail',
    'claudeStatus', 'claudeNote', 'claudeAt'],
  feature: ['kind', 'text', 'status', 'createdAt',
    'claudeStatus', 'claudeNote', 'claudeAt'],
  idea: ['text', 'status', 'spec', 'createdAt',
    'claudeStatus', 'claudeNote', 'claudeAt'],
};

const IDEA_HINT: Record<IdeaStatus, string> = {
  idea: 'רעיון — לאפיון מצידכם לפני שנוגעים',
  spec: 'לאיפיון — קלוד כותב אפיון',
  build: 'לביצוע — אפיון אושר',
  done: 'בוצע',
};

function stateOf(closed: boolean, claude: ClaudeCompletion | null): WorkState {
  if (closed) return 'done';
  return claude ? 'claude' : 'open';
}

function firstLine(text: string, max = 90): string {
  const line = (text ?? '').trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// ── per-stream mapping ────────────────────────────────────────────────────

// ── raw doc → the per-stream item shapes ────────────────────────────────
// These used to come from the per-stream services; the work list maps the
// projected documents itself so it can leave the images behind.

function taskFromDoc(d: FsDoc): Task {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    id: d.id,
    title: str(d.title),
    notes: str(d.notes),
    category: d.category === 'ui' || d.category === 'feature' ? d.category : 'bug',
    status: d.status === 'doing' || d.status === 'done' ? d.status : 'new',
    priority: d.priority === 'high' || d.priority === 'low' ? d.priority : 'normal',
    source: d.source === 'teamder' ? 'teamder' : 'pulse',
    images: [], // projected away — fetched on expand
    screen: str(d.screen),
    sourceId: str(d.sourceId),
    reporterId: str(d.reporterId),
    reporterName: str(d.reporterName),
    createdAt: Number(d.createdAt ?? 0),
    updatedAt: Number(d.updatedAt ?? 0),
    doneAt: Number(d.doneAt ?? 0),
    claude: readClaude(d),
  };
}

function featureFromDoc(d: FsDoc): FeatureItem {
  return {
    id: d.id,
    kind: d.kind === 'bug' ? 'bug' : 'feature',
    text: typeof d.text === 'string' ? d.text : '',
    status: d.status === 'in-progress' || d.status === 'done' ? d.status : 'new',
    images: [],
    createdAt: Number(d.createdAt ?? 0),
    claude: readClaude(d),
  };
}

function ideaFromDoc(d: FsDoc): IdeaItem {
  const ok = ['idea', 'spec', 'build', 'done'];
  return {
    id: d.id,
    text: typeof d.text === 'string' ? d.text : '',
    images: [],
    status: ok.includes(d.status) ? (d.status as IdeaStatus) : 'idea',
    spec: typeof d.spec === 'string' && d.spec ? d.spec : undefined,
    createdAt: Number(d.createdAt ?? 0),
    claude: readClaude(d),
  };
}

function fromTask(t: Task): WorkItem {
  return {
    key: `task:${t.id}`,
    stream: 'task',
    // A task's own category IS its kind — bug / design / feature are three
    // different jobs that happen to share a collection.
    kind: t.category === 'ui' ? 'ui' : t.category === 'feature' ? 'feature' : 'bug',
    id: t.id,
    docPath: `tasks/${t.id}`,
    title: t.title,
    body: t.notes,
    images: t.images,
    state: stateOf(t.status === 'done', t.claude),
    claude: t.claude,
    createdAt: t.createdAt,
    priority: t.priority,
    screen: t.screen ? screenHe(t.screen) : '',
    reporterId: t.reporterId,
    reporterName: t.reporterName,
    count: 1,
    claudeMayAct: true,
    hint: t.status === 'doing' ? 'בעבודה' : '',
  };
}

function fromError(d: FsDoc): WorkItem {
  const title = typeof d.title === 'string' && d.title ? d.title : String(d.operation ?? 'שגיאה');
  const screen = typeof d.lastScreen === 'string' ? d.lastScreen : '';
  return {
    key: `error:${d.id}`,
    stream: 'error',
    kind: 'error',
    id: d.id,
    docPath: `errors/${d.id}`,
    title,
    body: String(d.lastMessage ?? ''),
    images: [],
    state: stateOf(d.status === 'resolved', readClaude(d)),
    claude: readClaude(d),
    createdAt: Number(d.lastSeen ?? d.firstSeen ?? 0),
    // An error that has happened many times outranks a one-off, without
    // anyone having to triage it by hand.
    priority: Number(d.count ?? 1) >= 10 ? 'high' : 'normal',
    screen: screen ? screenHe(screen) : '',
    reporterId: typeof d.lastUserId === 'string' ? d.lastUserId : '',
    reporterName: '',
    count: Number(d.count ?? 1),
    claudeMayAct: true,
    hint: '',
  };
}

function fromReport(d: FsDoc): WorkItem {
  const screen = typeof d.screen === 'string' ? d.screen : '';
  const message = String(d.message ?? '');
  // The last ~50 steps before the report was written — taps with their
  // coordinates, screens, actions, failures. Teamder started attaching this on
  // 03.10 for the reports nobody can reproduce; older reports have no `trail`
  // and read exactly as they did before.
  //
  // A `tap` with nothing after it is a tap that hit nothing. That is the one
  // thing no other log in either app can show, and it is why this is worth the
  // space it takes under the message.
  const trail = typeof d.trail === 'string' ? d.trail : '';
  return {
    key: `report:${d.id}`,
    stream: 'report',
    kind: 'report',
    id: d.id,
    docPath: `feedback/${d.id}`,
    title: firstLine(message) || 'דיווח משתמש',
    body: trail ? `${message}\n\n— מה הוא עשה לפני —\n${trail}` : message,
    // ⚠️ Every report may carry a screenshot the user took, in `image`. It is
    // the whole point of the report far more often than the text is.
    images: typeof d.image === 'string' && d.image ? [d.image] : [],
    state: stateOf(d.status === 'done', readClaude(d)),
    claude: readClaude(d),
    createdAt: Number(d.createdAt ?? 0),
    // The owner can flag a report for Claude; that flag is the priority signal.
    priority: d.fixRequested === true ? 'high' : 'normal',
    screen: screen ? screenHe(screen) : '',
    reporterId: typeof d.userId === 'string' ? d.userId : '',
    reporterName: typeof d.userName === 'string' ? d.userName : '',
    count: 1,
    claudeMayAct: true,
    hint: d.fixRequested === true ? 'סומן לתיקון' : '',
  };
}

function fromFeature(f: FeatureItem): WorkItem {
  return {
    key: `feature:${f.id}`,
    stream: 'feature',
    kind: f.kind === 'bug' ? 'bug' : 'feature',
    id: f.id,
    docPath: `pulseFeatures/${f.id}`,
    title: firstLine(f.text) || 'פיצ׳ר',
    body: f.text,
    images: f.images,
    state: stateOf(f.status === 'done', f.claude),
    claude: f.claude,
    createdAt: f.createdAt,
    priority: 'normal',
    screen: '',
    reporterId: '',
    reporterName: '',
    count: 1,
    claudeMayAct: true,
    hint: f.status === 'in-progress' ? 'בעבודה' : '',
  };
}

function fromIdea(i: IdeaItem): WorkItem {
  return {
    key: `idea:${i.id}`,
    stream: 'idea',
    kind: 'idea',
    id: i.id,
    docPath: `pulseIdeas/${i.id}`,
    title: firstLine(i.text) || 'רעיון',
    body: i.spec ? `${i.text}\n\n— אפיון —\n${i.spec}` : i.text,
    images: i.images,
    state: stateOf(i.status === 'done', i.claude),
    claude: i.claude,
    createdAt: i.createdAt,
    // Ready-to-build outranks the rest, matching the ideas screen's own order.
    priority: i.status === 'build' ? 'high' : 'low',
    screen: '',
    reporterId: '',
    reporterName: '',
    count: 1,
    // THE gate. A parked idea is the owner's to characterise first.
    claudeMayAct: i.status !== 'idea',
    hint: IDEA_HINT[i.status],
  };
}

/**
 * A Teamder conversation someone is waiting on.
 *
 * Answering a person who wrote in is work, and it used to live in a strip
 * pinned above the list — visible, but outside the thing you actually work
 * through, and invisible the moment you filtered. It belongs on the list, with
 * a tag, like everything else.
 *
 * It has no stored state: it is "open" while the last word is theirs, and it
 * leaves the list when you answer. There is nothing to close and nothing to
 * hand over, so `closeItem` refuses it.
 */
function fromThread(t: ThreadSummary): WorkItem {
  return {
    key: `chat:${t.userId}`,
    stream: 'chat',
    kind: 'chat',
    id: t.userId,
    docPath: '',
    title: t.lastText || 'הודעה חדשה',
    body: '',
    images: [],
    state: 'open',
    claude: null,
    createdAt: t.lastMessageAt,
    // Someone is waiting for a human. That outranks a backlog item.
    priority: 'high',
    screen: '',
    reporterId: t.userId,
    reporterName: t.userName,
    count: 1,
    claudeMayAct: false,
    hint: 'ממתין לתשובה שלך',
  };
}

// ── the list ──────────────────────────────────────────────────────────────

/** Newest first, urgent first. */
function sortWork(items: WorkItem[]): WorkItem[] {
  const rank: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };
  return items.sort(
    (a, b) => rank[a.priority] - rank[b.priority] || b.createdAt - a.createdAt,
  );
}

/**
 * Every stream, merged. A stream that fails to load is skipped rather than
 * failing the screen — a dead `errors` read must not hide the tasks.
 */
const lean = (stream: WorkStream, force: boolean) =>
  cached(`work:${stream}`, () => listAll(COLL[stream], 5000, LIST_FIELDS[stream as Exclude<WorkStream, 'chat'>]), {
    force,
  }).catch(() => [] as FsDoc[]);

export async function listWork(force = false): Promise<WorkItem[]> {
  // The fixture covers every state the screen can show, including the ones
  // production has not produced yet. See ./workItemsMock.
  if (MOCK_WORK || !has.firebase()) return sortWork(mockWork(Date.now()));
  const [tasks, errs, reps, feats, ideas, threads] = await Promise.all([
    lean('task', force),
    lean('error', force),
    lean('report', force),
    lean('feature', force),
    lean('idea', force),
    listAwaitingReply(force).catch(() => [] as ThreadSummary[]),
  ]);
  const all = sortWork([
    ...threads.map(fromThread),
    ...tasks.map((d) => fromTask(taskFromDoc(d))),
    ...errs.map(fromError),
    ...reps.map(fromReport),
    ...feats.map((d) => fromFeature(featureFromDoc(d))),
    ...ideas.map((d) => fromIdea(ideaFromDoc(d))),
  ]);
  // Every open item, and only the most recent closed ones — see DONE_LIMIT.
  const done = all
    .filter((i) => i.state === 'done')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, DONE_LIMIT);
  return [...all.filter((i) => i.state !== 'done'), ...done];
}

/**
 * The images for ONE item, fetched on demand.
 *
 * The list projects image fields away, so this is what actually puts a
 * screenshot on screen — called when a row is expanded. Returns the item's own
 * attachments and Claude's proof separately, since the row renders them in
 * different places.
 */
export async function loadItemImages(
  item: WorkItem,
): Promise<{ images: string[]; claudeImages: string[] }> {
  if (!item.docPath) return { images: [], claudeImages: [] };
  if (MOCK_WORK || !has.firebase()) {
    return { images: item.images, claudeImages: item.claude?.images ?? [] };
  }
  try {
    const d = await getDoc(item.docPath);
    if (!d) return { images: [], claudeImages: [] };
    const list = (v: unknown): string[] =>
      typeof v === 'string' && v
        ? [v]
        : Array.isArray(v)
          ? (v.filter((x) => typeof x === 'string' && x) as string[])
          : [];
    return {
      // `feedback` keeps its single screenshot in `image`; the rest use an
      // `images` array.
      images: [...list(d.images), ...list(d.image)],
      claudeImages: list(d.claudeImages),
    };
  } catch {
    return { images: [], claudeImages: [] };
  }
}

/** Grouped the way the screen shows it: one section per KIND. */
export function groupByKind(
  items: WorkItem[],
): Array<{ kind: WorkKind; items: WorkItem[] }> {
  return KIND_ORDER.map((kind) => ({
    kind,
    items: items.filter((i) => i.kind === kind),
  })).filter((g) => g.items.length > 0);
}

/**
 * The set Claude works through on "go over the open items".
 *
 * Open (or handed over and not yet accepted) MINUS anything the owner still
 * wants to characterise himself. Exported so the rule lives in code rather than
 * in a habit.
 */
export function claudeQueue(items: WorkItem[]): WorkItem[] {
  return items.filter((i) => i.state === 'open' && i.claudeMayAct);
}

// ── writes ────────────────────────────────────────────────────────────────

/** Accept / close an item, in whatever word its own collection speaks. */
export async function closeItem(item: WorkItem): Promise<boolean> {
  // A conversation is closed by replying to it, not by ticking it.
  if (item.stream === 'chat') return false;
  invalidateStream(item.stream);
  const fields: Record<string, unknown> = { status: CLOSED_STATUS[item.stream] };
  // Tasks carry their own completion timestamp that the tasks list sorts by.
  if (item.stream === 'task') fields.doneAt = Date.now();
  return patchDoc(`${COLL[item.stream]}/${item.id}`, fields);
}

/** Re-open an accepted item. */
export async function reopenItem(item: WorkItem): Promise<boolean> {
  if (item.stream === 'chat') return false;
  invalidateStream(item.stream);
  const fields: Record<string, unknown> = { status: 'new' };
  if (item.stream === 'task') fields.doneAt = 0;
  return patchDoc(`${COLL[item.stream]}/${item.id}`, fields);
}

/** Drop the cached lists for one stream — call after writing the handover. */
export function invalidateStream(stream: WorkStream): void {
  for (const k of CACHE_KEYS[stream]) invalidate(k);
}
