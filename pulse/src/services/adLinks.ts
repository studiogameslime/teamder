import { createShortAdLink } from './shortAdLinks';
// Acquisition (UTM) tracking. The admin creates a tracked link per
// distribution channel (whatsapp / facebook / …); the app records
// `acquisition.source` on account attribution. These are account counts,
// not store downloads or unique visitors.

import { createDocOnly, listAll, deleteDoc, type FsDoc } from './firestoreRest';
import { cached, invalidate } from './cache';
import { fetchUsers, fetchUsersWithAuth } from './firebase';

// Public hosting origin that serves the /go landing page (mirrors the
// app's deepLinkService HOSTING_ORIGIN).
const ORIGIN = 'https://teamderfc.web.app';

export const SOURCE_PRESETS = ['whatsapp', 'facebook', 'instagram', 'telegram', 'sms', 'other'];

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/**
 * UTF-8 → base64url (no padding), self-contained (no btoa/Buffer). A Hebrew
 * source like "קמפיין חדש" becomes a short ASCII token instead of a ~60-char
 * %D7%-encoded string. `invite.html` decodes it back client-side.
 */
export function encodeSourceToken(str: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = str.charCodeAt(++i);
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64[b2 & 63];
  }
  return out;
}

/** Build the shareable tracked link. The source is carried as a short base64url
 *  token `b` (decoded client-side by invite.html) instead of a long encoded
 *  Hebrew `s`. `linkId` (`l`) is the per-link attribution key. */
export function buildAdLink(source: string, campaign?: string, gameId?: string, linkId?: string): string {
  const p = [`b=${encodeSourceToken(source)}`];
  if (campaign) p.push(`c=${encodeURIComponent(campaign)}`);
  if (gameId) p.push(`g=${encodeURIComponent(gameId)}`);
  if (linkId) p.push(`l=${encodeURIComponent(linkId)}`);
  return `${ORIGIN}/go?${p.join('&')}`;
}

export interface AdLinkInput {
  name: string;
  source: string;
  campaign?: string;
  gameId?: string;
}

export async function createAdLink(a: AdLinkInput): Promise<{ ok: boolean; url: string }> {
  const result = await createShortAdLink(a, createDocOnly);
  if (result.ok) invalidate('adLinks');
  return result;
}

export async function listAdLinks(force = false): Promise<FsDoc[]> {
  return cached('adLinks', async () => {
    const docs = await listAll('adLinks');
    return docs.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
  }, { force });
}

/** Remove a link from the dashboard. Does NOT touch already-attributed users. */
export async function deleteAdLink(id: string): Promise<boolean> {
  const ok = await deleteDoc(`adLinks/${id}`);
  if (ok) invalidate('adLinks');
  return ok;
}

export interface SourceRow {
  source: string; // '(אורגני)' for users with no acquisition tag
  accounts: number; // real accounts, not store downloads
  signups: number; // completed onboarding
  joined: number; // attended ≥ 1 game
}

export interface AcquisitionReport {
  rows: SourceRow[];
  totalTracked: number; // users with any source
  totalUsers: number; // all real users
}

/**
 * Roll real users up by acquisition.source into the funnel. Optionally
 * filter by [fromMs, toMs] on acquisition.at. Organic (no source) is a row.
 */
export async function fetchAcquisitionReport(range?: { from?: number; to?: number }): Promise<AcquisitionReport> {
  const users = (await fetchUsers()).filter((u) => !u.isTest && !u.deleted);
  const map = new Map<string, SourceRow>();
  const bump = (key: string, u: (typeof users)[number]) => {
    const row = map.get(key) ?? { source: key, accounts: 0, signups: 0, joined: 0 };
    row.accounts += 1;
    if (u.onboardingCompleted) row.signups += 1;
    if (u.attended > 0) row.joined += 1;
    map.set(key, row);
  };

  let tracked = 0;
  for (const u of users) {
    const src = u.acquisition?.source;
    if (src) {
      if (range) {
        const at = u.acquisition?.at ?? u.joinedAt;
        if (range.from && at < range.from) continue;
        if (range.to && at > range.to) continue;
        // organic users are unaffected by the range filter (no `at`),
        // but we only count them when no range is applied.
      }
      tracked += 1;
      bump(src, u);
    } else if (!range) {
      bump('(אורגני)', u);
    }
  }

  const rows = [...map.values()].sort((a, b) => b.accounts - a.accounts);
  return { rows, totalTracked: tracked, totalUsers: users.length };
}

// ── Per-link detail funnel ──────────────────────────────────────────────
export { calculateLinkStats, type LinkStats } from './adLinkStats';
import { calculateLinkStats, type LinkStats } from './adLinkStats';

/** uids that created (hosted) at least one game. */
export async function fetchGameCreators(): Promise<Set<string>> {
  return cached('gameCreators', async () => {
    const games = await listAll('games');
    const s = new Set<string>();
    for (const g of games) {
      const c = (g.createdBy ?? g.creatorId) as string | undefined;
      if (typeof c === 'string' && c) s.add(c);
    }
    return s;
  });
}

/** Exact link attribution only. Legacy source/campaign-only accounts belong
 * to fetchAcquisitionReport; they cannot be assigned to an individual link.
 * Read failures propagate so the UI never labels unavailable data as zero. */
export async function fetchLinkStats(link: FsDoc): Promise<LinkStats> {
  const [users, creators] = await Promise.all([
    fetchUsersWithAuth(),
    fetchGameCreators(),
  ]);
  return calculateLinkStats(link, users, creators);
}
