// Jersey palette + helpers. The Jersey component reads from here to
// render colors and to compute a sensible fallback when the user hasn't
// picked one yet.

import type { Jersey, JerseyPattern } from '@/types';

// Hand-picked saturated football-team-ish colors. Order matters — the
// auto-jersey hash uses the array index.
export const JERSEY_COLORS: { id: string; hex: string; nameHe: string }[] = [
  { id: 'red', hex: '#DC2626', nameHe: 'אדום' },
  { id: 'blue', hex: '#2563EB', nameHe: 'כחול' },
  { id: 'green', hex: '#16A34A', nameHe: 'ירוק' },
  { id: 'yellow', hex: '#EAB308', nameHe: 'צהוב' },
  { id: 'orange', hex: '#EA580C', nameHe: 'כתום' },
  { id: 'purple', hex: '#7C3AED', nameHe: 'סגול' },
  { id: 'pink', hex: '#DB2777', nameHe: 'ורוד' },
  { id: 'cyan', hex: '#0891B2', nameHe: 'טורקיז' },
  { id: 'black', hex: '#111827', nameHe: 'שחור' },
  { id: 'white', hex: '#F8FAFC', nameHe: 'לבן' },
];

export const JERSEY_PATTERNS: { id: JerseyPattern; nameHe: string }[] = [
  { id: 'solid', nameHe: 'חלק' },
  { id: 'stripes', nameHe: 'פסים' },
  { id: 'split', nameHe: 'חצוי' },
  { id: 'dots', nameHe: 'נקודות' },
];

/** Stable string-hash → integer in [0, n). */
function hash(str: string, n: number): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % n;
}

/**
 * Deterministic auto-jersey for a user who hasn't picked one yet — same
 * input always returns the same jersey, so the empty-state still feels
 * personal across screens.
 */
export function autoJersey(seed: string, name: string): Jersey {
  const color = JERSEY_COLORS[hash(seed || name || 'x', JERSEY_COLORS.length)].hex;
  // Number in 1-99 derived from the seed; +1 so we never get zero.
  const number = (hash(seed + ':n', 99) + 1);
  return {
    color,
    pattern: 'solid',
    number,
    displayName: trimDisplayName(name),
  };
}

export function trimDisplayName(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'שחקן';
  return trimmed.slice(0, 10);
}

/**
 * Pick a readable foreground color (white or near-black) for text on
 * top of the jersey base color. Threshold tuned around the palette
 * here — yellow (#EAB308 ≈ 176 luma) needs dark text to read; pure
 * black/blue/red etc. still get white. WCAG-relative luma would be
 * more accurate but this is a 10-color palette.
 */
export function jerseyContrast(hex: string): string {
  const m = /^#([0-9A-Fa-f]{6})$/.exec(hex);
  if (!m) return '#FFFFFF';
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  const luma = (r * 299 + g * 587 + b * 114) / 1000;
  return luma > 165 ? '#1F2937' : '#FFFFFF';
}
