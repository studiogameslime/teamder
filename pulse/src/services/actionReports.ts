import { observeCaughtError } from './errorObservation';

export interface ActionRow {
  id: string;
  label: string;
  users: number;
  events: number;
}
export interface ActionReport {
  state: 'ready' | 'error' | 'unavailable';
  rows: ActionRow[];
  thresholded: boolean;
  sampled: boolean;
  other: boolean;
}
export const noActions = (state: ActionReport['state']): ActionReport =>
  ({ state, rows: [], thresholded: false, sampled: false, other: false });

export function sortedActions(rows: readonly ActionRow[], metric: 'users' | 'events'): ActionRow[] {
  const secondary = metric === 'users' ? 'events' : 'users';
  return [...rows].sort((a,b) => b[metric]-a[metric] || b[secondary]-a[secondary] || a.id.localeCompare(b.id));
}

function metricValue(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw Error('Incomplete action metric');
  }
  return Number(value);
}

interface Page {
  rowCount?: number;
  rows?: {dimensionValues?: {value?: string}[]; metricValues?: {value?: string}[]}[];
  metadata?: { subjectToThresholding?: boolean; dataLossFromOtherRow?: boolean; samplingMetadatas?: unknown[] };
}
const PAGE_SIZE = 200;

/** One row per action across the entire date range. Never sum daily unique users. */
export async function readActionReport(
  query: (body: object) => Promise<Page>, range: { startDate: string; endDate: string },
  kind: 'events' | 'controls', labels: Record<string,string>, skip: ReadonlySet<string>,
): Promise<ActionReport> {
  const dimension = kind === 'controls' ? 'contentId' : 'eventName';
  const result = noActions('ready');
  const seen = new Set<string>();
  let offset = 0, total: number | undefined;
  try {
    do {
      const page = await query({
        dateRanges: [range], dimensions: [{name:dimension}],
        metrics: [{name:'totalUsers'},{name:'eventCount'}], keepEmptyRows: true,
        orderBys: [{dimension:{dimensionName:dimension,orderType:'ALPHANUMERIC'}}],
        ...(kind === 'controls' ? {dimensionFilter:{filter:{fieldName:'eventName',stringFilter:{matchType:'EXACT',value:'teamder_ui_action'}}}} : {}),
        offset, limit: PAGE_SIZE,
      });
      const rows = page.rows ?? [];
      // Zero is the only count that the API can omit in its JSON representation.
      const count = page.rowCount ?? (rows.length ? NaN : 0);
      if (!Number.isSafeInteger(count) || count < 0 || (total !== undefined && count !== total) ||
        rows.length > PAGE_SIZE || offset+rows.length > count || (!rows.length && offset<count)) {
        throw Error('Action pages changed or incomplete');
      }
      total = count;
      result.thresholded ||= page.metadata?.subjectToThresholding === true;
      result.sampled ||= !!page.metadata?.samplingMetadatas?.length;
      result.other ||= page.metadata?.dataLossFromOtherRow === true;
      for (const row of rows) {
        const id = row.dimensionValues?.[0]?.value;
        if (!id || seen.has(id)) throw Error('Invalid or repeated action row');
        seen.add(id);
        if (id === '(other)' || id === '(not set)') { result.other = true; continue; }
        if (kind === 'events' && skip.has(id)) continue;
        const label = Object.prototype.hasOwnProperty.call(labels,id) ? labels[id] :
          kind === 'controls' ? 'פקד ללא תווית מוכרת' : id;
        result.rows.push({id,label,users:metricValue(row.metricValues?.[0]?.value),events:metricValue(row.metricValues?.[1]?.value)});
      }
      offset += rows.length;
    } while (offset < total!);
    return result;
  } catch (error) {
    observeCaughtError(error,{source:'pulse/src/services/actionReports.ts',handler:'readActionReport',site:'actionReports:'+kind});
    return noActions('error');
  }
}
