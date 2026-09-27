// The club screen's accent palette, SAMPLED from the reference mockups.
//
// Why this exists instead of `colors.primary` and friends: the app's brand
// blue is `#1E40AF`, a dark navy that reads as grey-blue at 26pt on white. The
// reference's numbers are `#0056FF` — the same hue, far more electric — and
// the gap is the whole "washed out / pastel" complaint. Every number, icon,
// badge and bar on this screen is an ACCENT on a white card, and an accent has
// to carry.
//
// The values below are the dominant saturated pixel in each element of the
// mockups, measured rather than guessed:
//
//   podium number      #0054FF  #0049FF  #005CFF
//   pair metric        #0059FF  #0552F6  #0F55FF
//   pair win-rate      #00B243  #00B147
//   pair losses        #E31F23  #F92726
//   crown              #FBA30E  #FF9B0E
//   assists bar        #7755EA  #5C3AE6
//   donut green / red  #00943E  #F12F2D
//   table rating       #F4B148
//   podium side number #0E173E
//
// This is deliberately NOT a change to `colors`: repainting the brand would
// touch every screen in the app, and this pass is the club screen.
// ── Category colours ───────────────────────────────────────────────────────
//
// Five hues, and they are CATEGORY colours, not status codes. An earlier pass
// tried to make every colour earn a semantic meaning — blue for neutral, green
// for positive, red for negative, gold for champion — and forced everything
// else to blue. That rule is withdrawn: it flattened the screen into a
// corporate dashboard and took the football out of a football app.
//
// Colour here does three jobs, and differentiation is a legitimate one:
// telling categories apart, giving the screen rhythm, and making a stat card
// feel like a stat card. The donut and the progress bars keep their semantic
// reading (green wins, red losses) because there the colour genuinely encodes
// an outcome — everywhere else it identifies a category.
export const clubAccent = {
  /** Numbers, primary icons, the active tab. The default for everything. */
  blue: '#0B57FF',
  /** Success: win rates, clean sheets, the donut's majority slice. */
  green: '#00A84A',
  /** Negative: losses, the penalty slice. */
  red: '#E5322F',
  /** Assists and the metrics that belong with them. A category colour. */
  purple: '#6D3BEA',
  /** Achievement: the crown, the streak, the rating star. */
  gold: '#F59A0B',
  /** The neutral slice of the donut, and muted table columns. */
  slate: '#94A3B8',
  /** Side-podium numbers — a deep navy, not the blue. */
  navy: '#0E173E',
} as const;


/**
 * The club screen's SURFACE tokens — a local override, never the global theme.
 *
 * Measured the same way as the accents, and this is where the "washed out"
 * reading actually came from. The accents were already right: sampling the
 * rendered screenshot showed the podium's 58 at `#0B57FF`, saturation 244,
 * against the reference's `#0054FF` at 255. What was wrong is underneath them.
 *
 *   page ground   ours rendered #FFFFFF · reference #F4F7FC (cool, b−r = +8)
 *   card surface  ours #FFFFFF          · reference #FCFEFD
 *
 * White cards on a white page have no edge, so every card "sank" into the
 * ground and the whole screen read as one flat pale sheet — no matter how
 * saturated the numbers on it were. `colors.bg` is `#F9FAFB`, a neutral grey
 * two levels off white; the reference's ground is cooler AND darker, and that
 * difference is what separates the layers.
 *
 * Local, because `colors.bg` is every screen in the app.
 */
export const clubSurface = {
  /**
   * The page behind the cards — measured from the reference at `#F6F9FE`.
   *
   * ⚠️ Do not darken this. A previous pass took it to `#EFF3FA` to make white
   * cards stand out, and that single value caused three failed rounds: an 8%
   * tinted card is LIGHTER than `#EFF3FA`, so every coloured card inverted
   * against its own page and read as washed out. The tints were then pushed to
   * 15% (pastel slabs), then removed entirely (a grey dashboard).
   *
   * The reference separates layers with a SHADOW, not with ground contrast —
   * its card interior and its page differ by four levels. See `clubShadow`.
   */
  ground: '#F6F9FE',
  /** Cards sit on it in plain white — the contrast IS the separation. */
  card: '#FFFFFF',
  /**
   * A cool hairline. Used only where the reference actually shows an edge —
   * the record cards and the data table. Leader and pair cards carry NO
   * border: they have a shadow and a tint, and a grey outline on top of both
   * is what made them look like table cells.
   */
  border: '#DCE4F0',
  /** Row separators inside a card. */
  divider: '#E9EFF7',
  /** Sub-labels. Cooler than the global `textMuted`, matching the reference. */
  subtle: '#7C869E',
} as const;

/**
 * A category card's ground, as an OPAQUE colour.
 *
 * Opaque matters and was a real bug: an 8%-alpha background plus `elevation`
 * on Android composites the platform's drop shadow THROUGH the card, so every
 * tinted card rendered inside a hard grey slab instead of over a soft one.
 * Blending the tint over white here and returning a solid hex fixes it, and
 * costs nothing — the result is the same colour the reference uses.
 *
 * 8% is measured off the reference's own cards:
 *
 *   leader blue    #ECF5FE      this function  #ECF2FF
 *   leader cream   #FEF6EB      this function  #FEF7EB
 *   leader mint    #EAF9F4      this function  #EBF8F0
 *
 * 8% only reads when the page under it is LIGHTER than the tint, which is why
 * `ground` above must stay at `#F6F9FE`. If a card ever looks washed out at
 * 8%, the ground is too dark — do not chase it with a stronger tint.
 */
const TINT_ALPHA = 0.08;

export function clubCardTint(accent: string): string {
  const hex = accent.replace('#', '');
  const over = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16);
    // Blend over white: the page and the section card are both near-white, so
    // white is the correct backdrop to pre-composite against.
    return Math.round(255 - (255 - c) * TINT_ALPHA);
  };
  const to2 = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to2(over(0))}${to2(over(2))}${to2(over(4))}`;
}

/**
 * The one elevation on the club screen.
 *
 * Measured by scanning down through a card's bottom edge in the reference:
 * the interior sits at `#F2F7FD`, then six pixels darken to roughly `#7C8896`
 * before returning to the page. That is a soft shadow, not a border — and it
 * is the ONLY thing separating a card from a page four levels away from it.
 *
 * Applied to every card on the screen, identically. Elevation is not a
 * ranking cue here: two cards at different heights would say one matters more.
 */
export const clubShadow = {
  shadowColor: '#1E293B',
  shadowOpacity: 0.08,
  shadowOffset: { width: 0, height: 3 },
  shadowRadius: 10,
  elevation: 2,
} as const;
