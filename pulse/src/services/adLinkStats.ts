import type { AppUser } from '../types';

export interface LinkStats {
  clicks: number; // page opens, possibly repeated; not unique people
  attributedAccounts: number; // exact acquisition.linkId match, not installs
  signups: number;
  google: number;
  apple: number;
  joined: number;
  created: number;
}

/** Current account state within an exact attributed cohort. A source or
 * campaign match is never evidence that an account came from this link. */
export function calculateLinkStats(
  link: { id: string; clicks?: unknown },
  users: readonly AppUser[],
  creators: ReadonlySet<string>,
): LinkStats {
  const clicks = Number(link.clicks ?? 0);
  const st: LinkStats = {
    clicks: Number.isFinite(clicks) && clicks >= 0 ? clicks : 0,
    attributedAccounts: 0, signups: 0, google: 0, apple: 0, joined: 0, created: 0,
  };
  for (const u of users) {
    if (!link.id || u.isTest || u.deleted || u.acquisition?.linkId !== link.id) continue;
    st.attributedAccounts += 1;
    if (u.onboardingCompleted) st.signups += 1;
    if (u.provider === 'google') st.google += 1;
    else if (u.provider === 'apple') st.apple += 1;
    if (u.attended > 0) st.joined += 1;
    if (creators.has(u.id)) st.created += 1;
  }
  return st;
}

/** Only used for a subset of the same account cohort. Clicks are not a
 * denominator: their counter has neither unique-person nor cohort identity. */
export function accountPercentage(numerator: number, accounts: number): string | null {
  return accounts > 0 ? `${Math.round(numerator / accounts * 100)}%` : null;
}
