// Tasks — the single work list behind the app's home screen.
//
// Everything the owner has to DO lives in one Firestore collection: items
// typed by hand in Pulse, and reports that arrive from the Teamder app. The
// old split (errors / features / reports / QA, each its own screen with its
// own status vocabulary) meant the same question — "what's left to fix?" —
// had four different answers. Here it has one.
//
// SPEED IS THE POINT. This screen replaced a dashboard that opened on four
// heavy network calls (Play install CSVs, App Store Connect, user counts).
// So the list is read from ONE collection, and the last result is mirrored to
// AsyncStorage: a cold start paints instantly from disk while the network read
// happens behind it. `loadCachedTasks()` is that disk read.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { has } from '../secrets';
import { listAll, patchDoc, deleteDoc } from './firestoreRest';
import { cached, invalidate } from './cache';
import { readClaude, type ClaudeCompletion } from './claudeWork';

/** UI = look/layout/copy, bug = broken behaviour, feature = new capability. */
export type TaskCategory = 'ui' | 'bug' | 'feature';
export type TaskStatus = 'new' | 'doing' | 'done';
export type TaskPriority = 'high' | 'normal' | 'low';
/** Typed in Pulse, or ingested from a Teamder in-app report. */
export type TaskSource = 'pulse' | 'teamder';

export interface Task {
  id: string;
  title: string;
  /** Free-text detail. Optional — a one-line task shouldn't need a body. */
  notes: string;
  category: TaskCategory;
  status: TaskStatus;
  priority: TaskPriority;
  source: TaskSource;
  /** Raw base64 JPEGs (no data: prefix), same convention as pulseFeatures. */
  images: string[];
  /** Where in Teamder the report came from (screen name). Reports only. */
  screen: string;
  /** The originating feedback doc id — lets a task point back at its source
   *  and stops the ingester creating the same task twice. */
  sourceId: string;
  /** Who filed it. Empty for tasks typed here. Kept so a report isn't a dead
   *  end — without an id there's no way back to the person who reported. */
  reporterId: string;
  reporterName: string;
  createdAt: number;
  updatedAt: number;
  doneAt: number;
  /** Claude's handover, when it marked this done. See ./claudeWork — it must
   *  be mapped HERE, or it is silently dropped on read the way every field
   *  this mapper doesn't name is dropped. */
  claude: ClaudeCompletion | null;
}

const COLL = 'tasks';
const CACHE_KEY = 'tasks';
const DISK_KEY = 'pulse.tasks.snapshot.v1';

export const CATEGORIES: TaskCategory[] = ['bug', 'ui', 'feature'];
export const PRIORITIES: TaskPriority[] = ['high', 'normal', 'low'];

export const CATEGORY_LABEL: Record<TaskCategory, string> = {
  bug: 'באגים',
  ui: 'עיצוב וממשק',
  feature: 'פיצ׳רים',
};
export const CATEGORY_ICON: Record<TaskCategory, string> = {
  bug: 'bug',
  ui: 'color-palette',
  feature: 'sparkles',
};
export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  high: 'דחוף',
  normal: 'רגיל',
  low: 'לא בוער',
};
export const STATUS_LABEL: Record<TaskStatus, string> = {
  new: 'חדש',
  doing: 'בעבודה',
  done: 'בוצע',
};

/** Sort weight — `high` first. Used inside each category group. */
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

function asCategory(v: unknown): TaskCategory {
  return v === 'ui' || v === 'feature' ? v : 'bug';
}
function asStatus(v: unknown): TaskStatus {
  return v === 'doing' || v === 'done' ? v : 'new';
}
function asPriority(v: unknown): TaskPriority {
  return v === 'high' || v === 'low' ? v : 'normal';
}
function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : [];
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function toTask(d: Record<string, unknown> & { id: string }): Task {
  return {
    id: d.id,
    title: str(d.title),
    notes: str(d.notes),
    category: asCategory(d.category),
    status: asStatus(d.status),
    priority: asPriority(d.priority),
    source: d.source === 'teamder' ? 'teamder' : 'pulse',
    images: asStrings(d.images),
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

/**
 * The open list, grouped and sorted the way the screen shows it:
 * category groups, and inside each one the urgent items first, then newest.
 */
export function groupByCategory(
  tasks: Task[],
): Array<{ category: TaskCategory; items: Task[] }> {
  return CATEGORIES.map((category) => ({
    category,
    items: tasks
      .filter((t) => t.category === category)
      .sort(
        (a, b) =>
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
          b.createdAt - a.createdAt,
      ),
  })).filter((g) => g.items.length > 0);
}

export async function listTasks(force = false): Promise<Task[]> {
  if (!has.firebase()) return [];
  const tasks = await cached(CACHE_KEY, listTasksUncached, { force });
  return tasks;
}

async function listTasksUncached(): Promise<Task[]> {
  const docs = await listAll(COLL);
  const tasks = docs.map((d) => toTask(d as never)).sort((a, b) => b.createdAt - a.createdAt);
  // Mirror to disk so the NEXT cold start paints before the network answers.
  // Images are stripped: they're the bulk of the payload and the list only
  // renders a thumbnail count, so the snapshot stays small and fast to parse.
  void AsyncStorage.setItem(
    DISK_KEY,
    JSON.stringify(tasks.map((t) => ({ ...t, images: [] }))),
  ).catch(() => {});
  return tasks;
}

/**
 * Last known list, straight off disk. Returns [] when there's nothing stored
 * (first ever launch) — the caller then just shows its loading state.
 * Images are absent by design; open a task to fetch the full doc.
 */
export async function loadCachedTasks(): Promise<Task[]> {
  try {
    const raw = await AsyncStorage.getItem(DISK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((d) => toTask(d)) : [];
  } catch {
    return [];
  }
}

export interface NewTask {
  title: string;
  notes?: string;
  category: TaskCategory;
  priority: TaskPriority;
  images?: string[];
  /** Pass Date.now() from the caller — keeps this module free of clock reads. */
  now: number;
  source?: TaskSource;
  screen?: string;
  sourceId?: string;
}

export async function createTask(input: NewTask): Promise<boolean> {
  const rnd = Math.floor(input.now % 1e6).toString(36);
  const id = `task-${input.now}-${rnd}`;
  invalidate(CACHE_KEY);
  return patchDoc(`${COLL}/${id}`, {
    title: input.title.trim(),
    notes: (input.notes ?? '').trim(),
    category: input.category,
    status: 'new',
    priority: input.priority,
    source: input.source ?? 'pulse',
    images: input.images ?? [],
    screen: input.screen ?? '',
    sourceId: input.sourceId ?? '',
    createdAt: input.now,
    updatedAt: input.now,
    doneAt: 0,
  });
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<Task, 'title' | 'notes' | 'category' | 'priority' | 'status'>>,
  now: number,
): Promise<boolean> {
  invalidate(CACHE_KEY);
  const fields: Record<string, unknown> = { ...patch, updatedAt: now };
  // Stamp the completion time on the way in, and clear it on re-open — so
  // "done last week" can't linger on a task that was pulled back into work.
  if (patch.status !== undefined) fields.doneAt = patch.status === 'done' ? now : 0;
  return patchDoc(`${COLL}/${id}`, fields);
}

export async function removeTask(id: string): Promise<boolean> {
  invalidate(CACHE_KEY);
  return deleteDoc(`${COLL}/${id}`);
}
