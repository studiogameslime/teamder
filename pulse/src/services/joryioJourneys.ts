import { cached } from './cache';
import { getDoc } from './firestoreRest';

export interface JourneyStep {
  id: string; label: string; type: string;
  entered: number | null; proceeded: number | null;
  sent: number | null; displayed: number | null; clicked: number | null;
}
export interface JourneySnapshot {
  schemaVersion: 1; journeyId: string; name: string; status: string;
  source: string; syncedAt: number; syncMode: 'manual'; range: 'all_time';
  entries: number | null; active: number | null; completed: number | null;
  exited: number | null; failed: number | null; steps: JourneyStep[];
}
const counter = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
export function parseJourneySnapshot(raw: unknown): JourneySnapshot {
  const v = raw as Partial<JourneySnapshot> | null;
  if (!v || v.schemaVersion !== 1 || v.source !== 'https://api-eu1.joryio.com/api' ||
      !v.journeyId || !v.name || !v.status || !Number.isFinite(v.syncedAt) || !v.syncedAt ||
      v.syncMode !== 'manual' || v.range !== 'all_time' || !Array.isArray(v.steps)) {
    throw new Error('נתוני המסע חסרים או אינם תקינים');
  }
  const steps = v.steps.map(step => {
    if (!step || typeof step.id !== 'string' || typeof step.label !== 'string' || typeof step.type !== 'string') throw new Error('נתוני שלב אינם תקינים');
    return {...step, entered:counter(step.entered),proceeded:counter(step.proceeded),sent:counter(step.sent),displayed:counter(step.displayed),clicked:counter(step.clicked)};
  });
  if (new Set(steps.map(step=>step.id)).size !== steps.length) throw new Error('מזהי השלבים אינם ייחודיים');
  return {...v, entries:counter(v.entries),active:counter(v.active),completed:counter(v.completed),
    exited:counter(v.exited),failed:counter(v.failed),steps} as JourneySnapshot;
}
export async function fetchJourneySnapshot(force=false): Promise<JourneySnapshot> {
  return cached('joryio-invite-journey', async()=>parseJourneySnapshot(await getDoc('appConfig/joryioInviteJourney')), {force,ttl:60000});
}
export function journeyReach(entered: number | null, entries: number | null): string {
  if (entered === null || entries === null || entries <= 0) return 'אין מכנה לחישוב';
  return `${Math.round(entered / entries * 100)}% מהכניסות למסע`;
}
