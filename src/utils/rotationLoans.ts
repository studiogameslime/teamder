import type { RotationLoan } from '@/types';

/** A temporary exchange returns as a whole. Returning half would overfill
 * the staying team and leave the incoming team short. Ordinary fills keep
 * their existing independent lifetime. */
export function retainRotationLoans(loans: RotationLoan[], keep: (loan: RotationLoan) => boolean): RotationLoan[] {
  const returning = new Set(loans.filter(l => l.swapId && !keep(l)).map(l => l.swapId));
  return loans.filter(l => keep(l) && (!l.swapId || !returning.has(l.swapId)));
}
