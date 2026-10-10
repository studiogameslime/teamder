// Shared segment model + matcher (Braze-style condition builder). A
// segment is a list of conditions — each {field, op, value} — combined
// with 'all' (AND) or 'any' (OR). The SAME definition the "calculate
// audience" button evaluates here is embedded into each campaign and
// evaluated by the app (popups) and the Cloud Function (push). Keep in
// lockstep with:
//   • soccer/src/services/campaignService.ts
//   • soccer/functions/src/adminUserPush.ts

import type { AppUser } from '../types';

export type Combinator = 'all' | 'any';

export type FieldKey =
  | 'attended'
  | 'cancelled'
  | 'gamesJoined'
  | 'communitiesCreated'
  | 'invitesSent'
  | 'friends'
  | 'achievements'
  | 'daysSinceJoin'
  | 'daysSinceActive'
  | 'city'
  | 'provider'
  | 'platform'
  | 'inGroup'
  | 'hasPush'
  | 'invited';

export type Op = 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq';

export interface SegmentRule {
  field: FieldKey;
  op: Op;
  value: string | number | boolean;
}

export interface SegmentDef {
  combinator: Combinator;
  rules: SegmentRule[];
}

export type FieldType = 'number' | 'text' | 'enum' | 'bool';

export interface FieldDef {
  key: FieldKey;
  label: string;
  type: FieldType;
  unit?: string;
  options?: { value: string; label: string }[];
}

export const FIELDS: FieldDef[] = [
  { key: 'attended', label: 'סה״כ משחקים ששיחק', type: 'number', unit: 'משחקים' },
  { key: 'cancelled', label: 'משחקים שביטל', type: 'number', unit: 'משחקים' },
  { key: 'gamesJoined', label: 'משחקים שנרשם אליהם', type: 'number', unit: 'משחקים' },
  { key: 'communitiesCreated', label: 'קהילות שיצר', type: 'number', unit: 'קהילות' },
  { key: 'invitesSent', label: 'הזמנות ששלח', type: 'number', unit: 'הזמנות' },
  { key: 'friends', label: 'מספר חברים', type: 'number', unit: 'חברים' },
  { key: 'achievements', label: 'הישגים שפתח', type: 'number', unit: 'הישגים' },
  { key: 'daysSinceJoin', label: 'ימים מאז הצטרפות', type: 'number', unit: 'ימים' },
  { key: 'daysSinceActive', label: 'ימים מאז כניסה אחרונה', type: 'number', unit: 'ימים' },
  { key: 'city', label: 'עיר', type: 'text' },
  {
    key: 'provider', label: 'ספק התחברות', type: 'enum',
    options: [{ value: 'google', label: 'Google' }, { value: 'apple', label: 'Apple' }],
  },
  {
    key: 'platform', label: 'מכשיר', type: 'enum',
    options: [{ value: 'ios', label: 'iPhone' }, { value: 'android', label: 'אנדרואיד' }],
  },
  { key: 'inGroup', label: 'חבר בקהילה', type: 'bool' },
  { key: 'hasPush', label: 'מקבל פוש', type: 'bool' },
  { key: 'invited', label: 'הגיע מהזמנה', type: 'bool' },
];

export const OPS: { key: Op; label: string; sym: string }[] = [
  { key: 'gt', label: 'גדול מ', sym: '>' },
  { key: 'lt', label: 'קטן מ', sym: '<' },
  { key: 'gte', label: 'גדול/שווה', sym: '≥' },
  { key: 'lte', label: 'קטן/שווה', sym: '≤' },
  { key: 'eq', label: 'שווה ל', sym: '=' },
  { key: 'neq', label: 'שונה מ', sym: '≠' },
];

export const OPS_FOR_TYPE: Record<FieldType, Op[]> = {
  number: ['gt', 'lt', 'gte', 'lte', 'eq', 'neq'],
  text: ['eq', 'neq'],
  enum: ['eq', 'neq'],
  bool: ['eq'],
};

export const fieldDef = (key: FieldKey): FieldDef =>
  FIELDS.find((f) => f.key === key) ?? FIELDS[0];

const DAY = 24 * 60 * 60 * 1000;
export const EMPTY_SEGMENT: SegmentDef = { combinator: 'all', rules: [] };

// ── normalization (accepts the new {field,op,value} shape, the previous
// {kind,value} shape, and the original flat filters) ──
interface OldKindRule { kind: string; value?: string | number }
interface LegacyFilters {
  city?: string; provider?: string; platform?: string;
  games?: string; minGames?: number; group?: string;
  newDays?: number; inactiveDays?: number; hasPush?: boolean; invited?: boolean;
}

function kindToRule(k: OldKindRule): SegmentRule | null {
  switch (k.kind) {
    case 'neverPlayed': return { field: 'attended', op: 'eq', value: 0 };
    case 'minGames': return { field: 'attended', op: 'gte', value: Number(k.value ?? 1) };
    case 'inGroup': return { field: 'inGroup', op: 'eq', value: true };
    case 'notInGroup': return { field: 'inGroup', op: 'eq', value: false };
    case 'city': return { field: 'city', op: 'eq', value: String(k.value ?? '') };
    case 'provider': return { field: 'provider', op: 'eq', value: String(k.value ?? '') };
    case 'platform': return { field: 'platform', op: 'eq', value: String(k.value ?? '') };
    case 'newWithinDays': return { field: 'daysSinceJoin', op: 'lte', value: Number(k.value ?? 0) };
    case 'inactiveDays': return { field: 'daysSinceActive', op: 'gte', value: Number(k.value ?? 0) };
    case 'hasPush': return { field: 'hasPush', op: 'eq', value: true };
    case 'fromInvite': return { field: 'invited', op: 'eq', value: true };
    default: return null;
  }
}

export function normalizeSegment(raw: unknown): SegmentDef {
  const r = raw as (Partial<SegmentDef> & LegacyFilters) | undefined;
  if (r && Array.isArray(r.rules)) {
    const rules: SegmentRule[] = [];
    for (const rule of r.rules as (SegmentRule | OldKindRule)[]) {
      if (rule && 'field' in rule && 'op' in rule) rules.push(rule as SegmentRule);
      else if (rule && 'kind' in rule) {
        const m = kindToRule(rule as OldKindRule);
        if (m) rules.push(m);
      }
    }
    return { combinator: r.combinator === 'any' ? 'any' : 'all', rules };
  }
  // original flat filters
  const f = (r ?? {}) as LegacyFilters;
  const rules: SegmentRule[] = [];
  if (f.city) rules.push({ field: 'city', op: 'eq', value: f.city });
  if (f.provider) rules.push({ field: 'provider', op: 'eq', value: f.provider });
  if (f.platform) rules.push({ field: 'platform', op: 'eq', value: f.platform });
  if (f.games === 'never') rules.push({ field: 'attended', op: 'eq', value: 0 });
  if (f.games === 'min') rules.push({ field: 'attended', op: 'gte', value: f.minGames ?? 1 });
  if (f.group === 'in') rules.push({ field: 'inGroup', op: 'eq', value: true });
  if (f.group === 'notin') rules.push({ field: 'inGroup', op: 'eq', value: false });
  if (f.newDays) rules.push({ field: 'daysSinceJoin', op: 'lte', value: f.newDays });
  if (f.inactiveDays) rules.push({ field: 'daysSinceActive', op: 'gte', value: f.inactiveDays });
  if (f.hasPush === true) rules.push({ field: 'hasPush', op: 'eq', value: true });
  if (f.invited === true) rules.push({ field: 'invited', op: 'eq', value: true });
  return { combinator: 'all', rules };
}

// ── matcher ──
function userField(u: AppUser, field: FieldKey, memberSet: Set<string>, now: number): number | string | boolean {
  switch (field) {
    case 'attended': return u.attended;
    case 'cancelled': return u.cancelled;
    case 'gamesJoined': return u.gamesJoined;
    case 'communitiesCreated': return u.communitiesCreated;
    case 'invitesSent': return u.invitesSent;
    case 'friends': return u.friends;
    case 'achievements': return u.achievements;
    case 'daysSinceJoin': return (now - u.joinedAt) / DAY;
    case 'daysSinceActive': {
      const last = u.lastActiveAt ?? u.lastLoginAt ?? u.joinedAt;
      return (now - last) / DAY;
    }
    case 'city': return (u.city ?? '').trim();
    case 'provider': return u.provider ?? '';
    case 'platform': return u.platform ?? '';
    case 'inGroup': return memberSet.has(u.id);
    case 'hasPush': return u.hasPush;
    case 'invited': return !!u.invitedBy;
    default: return '';
  }
}

export function applyOp(actual: number | string | boolean, op: Op, value: string | number | boolean): boolean {
  if (typeof actual === 'number') {
    const v = Number(value);
    switch (op) {
      case 'gt': return actual > v;
      case 'lt': return actual < v;
      case 'gte': return actual >= v;
      case 'lte': return actual <= v;
      case 'eq': return actual === v;
      case 'neq': return actual !== v;
    }
  }
  if (typeof actual === 'boolean') {
    const v = value === true || value === 'true' || value === 'כן';
    return op === 'neq' ? actual !== v : actual === v;
  }
  const a = String(actual).trim();
  const b = String(value).trim();
  return op === 'neq' ? a !== b : a === b;
}

export function matchUser(u: AppUser, raw: unknown, memberSet: Set<string>, now: number): boolean {
  if (u.isTest || u.deleted) return false;
  const seg = normalizeSegment(raw);
  if (seg.rules.length === 0) return true;
  const test = (r: SegmentRule) => applyOp(userField(u, r.field, memberSet, now), r.op, r.value);
  return seg.combinator === 'any' ? seg.rules.some(test) : seg.rules.every(test);
}

// ── display ──
export function ruleLabel(rule: SegmentRule): string {
  const fd = fieldDef(rule.field);
  if (fd.type === 'bool') {
    const yes = rule.value === true || rule.value === 'true' || rule.value === 'כן';
    return `${fd.label}: ${(rule.op === 'neq' ? !yes : yes) ? 'כן' : 'לא'}`;
  }
  // Use the WORD label, not the math symbol: >, <, ≥, ≤ get bidi-mirrored
  // inside RTL text and render reversed.
  const opLabel = OPS.find((o) => o.key === rule.op)?.label ?? 'שווה ל';
  let val = String(rule.value);
  if (fd.type === 'enum') val = fd.options?.find((o) => o.value === rule.value)?.label ?? val;
  const unit = fd.type === 'number' && fd.unit ? ` ${fd.unit}` : '';
  return `${fd.label} ${opLabel} ${val}${unit}`;
}

export function describeSegment(raw: unknown): string {
  const seg = normalizeSegment(raw);
  if (seg.rules.length === 0) return 'כל המשתמשים';
  const joiner = seg.combinator === 'any' ? ' · או · ' : ' · וגם · ';
  return seg.rules.map(ruleLabel).join(joiner);
}

export function segmentNeedsAuth(raw: unknown): boolean {
  return normalizeSegment(raw).rules.some(
    (r) => r.field === 'provider' || r.field === 'daysSinceActive',
  );
}
