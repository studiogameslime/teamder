// The ONE vocabulary for team colour and name.
//
// This lived twice — a palette-aware copy in components/match/rotationView.ts
// for the live surfaces, and a palette-BLIND copy in utils/draft.ts for the
// draft/summary surfaces — each carrying a comment promising to stay in step
// with the other. It didn't: an admin set the teams to green/yellow/white and
// the live screens honoured it while "הכוחות שחולקו", the mini-game history and
// the edit modal all kept saying קבוצה אדומה/כחולה/ירוקה in the default tints.
// Both modules now re-export from here, so a team cannot be one colour on one
// screen and another colour on the next.
//
// Deliberately free of `@/theme` (and so of react-native): the draft and balance
// logic suites import this, and pulling the theme in here breaks them. The
// theme-DEPENDENT half — the default per-index tint, which has a lighter variant
// in dark mode — stays in components/match/rotationView as `teamColor`.

// Seven letters, matching TEAM_COUNT_MAX — past that the label is the number.
// (rotationView's copy carried an eighth, 'ח', which no picker can produce; the
// draft copy's seven is the one the tests pin, so seven it is.)
export const TEAM_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז'] as const;

export function teamLetter(i: number): string {
  return TEAM_LETTERS[i] ?? String(i + 1);
}

// Default identity, fixed per team INDEX so a team keeps it across rotations.
// Seven entries, one per team the format picker allows.
const TEAM_COLOR_NAMES = ['אדומה', 'כחולה', 'ירוקה', 'צהובה', 'כתומה', 'סגולה', 'שחורה'];

/** Admin-selectable team colours. `key` is stored on `DraftTeam.colorKey`;
 *  `plural` is the team's name once chosen ("האדומים"); `hex` tints it. */
export interface TeamPaletteEntry {
  key: string;
  plural: string;
  hex: string;
  /** Emoji dot for plain-text surfaces (the WhatsApp export). */
  dot: string;
  /** true when the colour is light → needs dark text/contrast on top. */
  light?: boolean;
}

export const TEAM_PALETTE: TeamPaletteEntry[] = [
  { key: 'red', plural: 'האדומים', hex: '#EF4444', dot: '🔴' },
  { key: 'blue', plural: 'הכחולים', hex: '#3B82F6', dot: '🔵' },
  { key: 'green', plural: 'הירוקים', hex: '#22C55E', dot: '🟢' },
  { key: 'yellow', plural: 'הצהובים', hex: '#EAB308', dot: '🟡' },
  { key: 'orange', plural: 'הכתומים', hex: '#F97316', dot: '🟠' },
  { key: 'purple', plural: 'הסגולים', hex: '#8B5CF6', dot: '🟣' },
  { key: 'black', plural: 'השחורים', hex: '#1F2937', dot: '⚫' },
  { key: 'white', plural: 'הלבנים', hex: '#E5E7EB', dot: '⚪', light: true },
];

const PALETTE_BY_KEY: Record<string, TeamPaletteEntry> = Object.fromEntries(
  TEAM_PALETTE.map((p) => [p.key, p]),
);

export function teamPaletteEntry(colorKey?: string): TeamPaletteEntry | undefined {
  return colorKey ? PALETTE_BY_KEY[colorKey] : undefined;
}

export type TeamLike = { index: number; colorKey?: string };

/** The palette entry chosen for team `i`, if the admin picked one. */
export function chosenFor(
  i: number,
  teams?: readonly TeamLike[],
): TeamPaletteEntry | undefined {
  return teamPaletteEntry(teams?.find((t) => t.index === i)?.colorKey);
}

/** Team name. With a chosen colour it is that colour in plural ("האדומים");
 *  otherwise the default "קבוצה אדומה", or the Hebrew letter past the palette. */
export function teamName(i: number, teams?: readonly TeamLike[]): string {
  const chosen = chosenFor(i, teams);
  if (chosen) return chosen.plural;
  const c = TEAM_COLOR_NAMES[i];
  return c ? `קבוצה ${c}` : `קבוצה ${teamLetter(i)}`;
}

/** Emoji dot for plain-text surfaces, matching `teamName`. */
export function teamDot(i: number, teams?: readonly TeamLike[]): string {
  const chosen = chosenFor(i, teams);
  if (chosen) return chosen.dot;
  return TEAM_PALETTE[i]?.dot ?? '⚽';
}
