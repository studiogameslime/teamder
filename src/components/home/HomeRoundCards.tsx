// The round area of the home screen — one card system, nine states.
//
// The question this area answers is not "what is my next game" but "what do
// I need to DO about it". So the badge, the status panel, the colour and the
// primary action all move together with the state, and there is exactly one
// primary action on screen at a time.
//
// The state itself is NOT decided here. `deriveRoundState` decides it from
// the game document and the viewer, and is tested on its own; these are
// views over its answer. That split is deliberate — the previous version
// made the decision inside the JSX, where "a waitlist place is not a
// registration" was a condition nobody could see.
//
// ── RTL ────────────────────────────────────────────────────────────────────
// Under `forceRTL` the FIRST child of a row lands on the visual RIGHT, and
// `RTL_LABEL_ALIGN` ('left') anchors text to the visual RIGHT. Nothing here
// uses `row-reverse`: it reverses an already-reversed row. Source order is
// the layout, which is why the image is written LAST and appears on the left.
//
// ── No faces ───────────────────────────────────────────────────────────────
// Occupancy is numbers only. Avatars were tried and removed: `game.players`
// holds ids, so faces mean a read per player on the screen that must open
// instantly, and three heads say less about "can I still get in" than
// "12/15" does.

import React from 'react';
import {
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { PressableScale } from '@/components/PressableScale';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { motion } from '@/theme/motion';
import { he } from '@/i18n/he';
import { formatGameDay, formatTime } from '@/utils/format';
import type { Game } from '@/types';
import {
  completedMetrics,
  type RoundStateKind,
  type UpcomingRoundState,
} from '@/utils/homeRoundState';

/** The ball-on-grass photo the card has always used. No per-game image
 *  exists on the document, so this is the one fallback for every round —
 *  bundled, so it costs no request. */
const BALL_FIELD: ImageSourcePropType = require('../../assets/images/ball-field.jpg');
/** The floodlit pitch, for the finished round. */
const NIGHT_PITCH: ImageSourcePropType = require('../../assets/images/stadium-bg.png');

// ── one card system ─────────────────────────────────────────────────────────
const R = 22;
const CARD_SHADOW = {
  shadowColor: '#0F172A',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 3,
} as const;

/**
 * The accent for each state.
 *
 * `ink` is the badge and the emphasis; `wash` is the status panel behind the
 * sentence. The card stays white — the colour is a signal, not a surface.
 */
const TONE: Record<RoundStateKind, { ink: string; wash: string; onInk: string }> = {
  open: { ink: '#2563EB', wash: '#EFF4FF', onInk: '#FFFFFF' },
  registered: { ink: '#15803D', wash: '#ECFDF3', onInk: '#FFFFFF' },
  today: { ink: '#6D28D9', wash: '#F3EEFF', onInk: '#FFFFFF' },
  live: { ink: '#6D28D9', wash: '#F3EEFF', onInk: '#FFFFFF' },
  waitlist: { ink: '#C2410C', wash: '#FFF3E6', onInk: '#FFFFFF' },
  pending: { ink: '#C2410C', wash: '#FFF3E6', onInk: '#FFFFFF' },
  opensSoon: { ink: '#6D28D9', wash: '#F3EEFF', onInk: '#FFFFFF' },
  full: { ink: '#DC2626', wash: '#FEF2F2', onInk: '#FFFFFF' },
  closed: { ink: '#475569', wash: '#F1F5F9', onInk: '#FFFFFF' },
};

const BADGE_ICON: Record<RoundStateKind, keyof typeof Ionicons.glyphMap> = {
  open: 'flash',
  registered: 'checkmark-circle',
  today: 'flash',
  live: 'radio',
  waitlist: 'hourglass',
  pending: 'hourglass',
  opensSoon: 'time',
  full: 'close-circle',
  closed: 'lock-closed',
};

function badgeText(s: UpcomingRoundState): string {
  switch (s.kind) {
    case 'registered':
      return he.roundBadgeRegistered;
    case 'today':
      return he.roundBadgeToday;
    case 'live':
      return he.roundBadgeLive;
    case 'waitlist':
      return he.roundBadgeWaitlist;
    case 'pending':
      return he.roundBadgePending;
    case 'opensSoon':
      return he.roundBadgeOpensSoon;
    case 'full':
      return he.roundBadgeFull;
    case 'closed':
      return he.roundBadgeClosed;
    case 'open':
    default:
      // "3 מקומות נותרו" is the more useful badge, but only when the game
      // actually has a maximum to count down from.
      return s.spotsLeft !== null
        ? he.roundBadgeSpots(s.spotsLeft)
        : he.roundBadgeSpotsOpen;
  }
}

/** How long until kickoff, in words.
 *
 *  It used to print "H:MM", and "מתחילים בעוד 0:11" reads as a scoreline —
 *  the reader has to work out that the first digit is hours. No interval
 *  runs behind this: the screen re-renders on focus and on refresh, which is
 *  as often as the number needs to move. */
function startsInLabel(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return he.roundStartsInMinutes(mins);
  return he.roundStartsInHours(Math.floor(mins / 60), mins % 60);
}

/** When registration opens, said in whatever unit is still meaningful. */
function opensLabel(opensAt: number, now: number): string {
  const diff = opensAt - now;
  if (diff <= 0) return he.roundOpeningNow;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return he.roundOpensInDays(days, hours % 24);
  if (hours >= 1) return he.roundOpensInHours(hours, mins % 60);
  return he.roundOpensInHours(0, mins);
}

export interface RoundActions {
  onDetails: (gameId: string) => void;
  onJoin: (game: Game) => void;
  onSummary: (gameId: string) => void;
  onShare?: (game: Game) => void;
  onCreate: () => void;
  onFind: () => void;
}

// ════════════════════════════════════════════════════════════════════════════
// The upcoming round
// ════════════════════════════════════════════════════════════════════════════

export function UpcomingRoundCard({
  game,
  state,
  clubName,
  actions,
  busy,
  now,
}: {
  game: Game;
  state: UpcomingRoundState;
  clubName?: string;
  actions: RoundActions;
  /** A join is in flight — the primary action locks so it cannot double-fire. */
  busy?: boolean;
  now: number;
}) {
  const tone = TONE[state.kind];
  const venue = [game.fieldName, game.city].filter(Boolean).join(' · ');
  const club = (clubName || game.title || '').trim();

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        {/* Meta first → visual RIGHT. The photo is written last and lands
            on the left, which is the reference's split. */}
        <View style={styles.meta}>
          <View style={styles.titleRow}>
            <View style={[styles.calChip, { backgroundColor: `${tone.ink}14` }]}>
              <Ionicons name="calendar" size={15} color={tone.ink} />
            </View>
            <Text
              style={styles.title}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
            >
              {he.homeNextGameTitle}
            </Text>
          </View>

          {club ? (
            <Text style={[styles.club, { color: tone.ink }]} numberOfLines={1}>
              {club}
            </Text>
          ) : null}

          {venue ? (
            <View style={styles.infoRow}>
              <Ionicons name="location-outline" size={14} color={colors.textMuted} />
              <Text style={styles.infoMuted} numberOfLines={1}>
                {venue}
              </Text>
            </View>
          ) : null}

          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={14} color={tone.ink} />
            <Text style={styles.infoStrong} numberOfLines={1}>
              {formatGameDay(game.startsAt)} · {formatTime(game.startsAt)}
            </Text>
          </View>

          <Occupancy state={state} tone={tone} />
        </View>

        <View style={styles.photo}>
          <ImageBackground
            source={BALL_FIELD}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
          {/* Fades the photo's inner edge into the card so it blends instead
              of butting up as a hard rectangle. */}
          <LinearGradient
            colors={['#FFFFFF', 'rgba(255,255,255,0)']}
            locations={[0, 0.72]}
            start={{ x: 1, y: 0.5 }}
            end={{ x: 0, y: 0.5 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {/* Label FIRST → it lands on the visual right and the icon on its
              LEFT, which is where every other icon-plus-label in the app
              sits. It was the other way round. */}
          <View style={[styles.badge, { backgroundColor: tone.ink }]}>
            <Text
              style={[styles.badgeTxt, { color: tone.onInk }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {badgeText(state)}
            </Text>
            <Ionicons name={BADGE_ICON[state.kind]} size={11} color={tone.onInk} />
          </View>
        </View>
      </View>

      <StatusPanel state={state} tone={tone} now={now} />

      <PinnedNote game={game} />

      <PrimaryCta game={game} state={state} actions={actions} busy={busy} />

      <SecondaryCta game={game} state={state} actions={actions} />
    </View>
  );
}

/**
 * The organiser's note for this evening.
 *
 * `pinnedMessage` already travels on the game document this card holds, so
 * showing it costs nothing — and until now a player had to open the game to
 * find out the pitch moved or to bring a light shirt.
 *
 * Shown to ANYONE looking at the round, not only to the roster. It was gated
 * on being registered on the theory that an instruction to the roster is
 * noise to everyone else — and the person who asked for the feature reported
 * that it simply never appeared. He was right about the product too: "חסר
 * שחקן, בואו" is exactly what someone deciding whether to join needs to read.
 */
function PinnedNote({ game }: { game: Game }) {
  const text = (game.pinnedMessage ?? '').trim();
  if (!text) return null;
  return (
    <View style={styles.pinned}>
      {/* Icon first → visual RIGHT, where the heading starts. */}
      <Ionicons name="megaphone-outline" size={14} color="#92400E" />
      <View style={styles.pinnedTexts}>
        <Text style={styles.pinnedTitle}>{he.roundCoachNote}</Text>
        <Text style={styles.pinnedBody} numberOfLines={3}>
          {text}
        </Text>
      </View>
    </View>
  );
}

/**
 * "12/15 נרשמו" and the thin bar beneath it.
 *
 * Both are skipped entirely when the game sets no maximum — a bar with no
 * denominator would be drawing a proportion out of nothing.
 */
function Occupancy({
  state,
  tone,
}: {
  state: UpcomingRoundState;
  tone: { ink: string };
}) {
  // Registration has not opened: "0/15 נרשמו" is accurate and useless, and
  // an empty bar reads as a game nobody wants. The panel below says when the
  // doors open, which is the only fact that matters yet.
  if (state.kind === 'opensSoon') return null;
  if (state.registered <= 0 && state.capacity === null) return null;
  const pct =
    state.capacity !== null && state.capacity > 0
      ? Math.min(1, state.registered / state.capacity)
      : null;

  return (
    <View style={styles.occWrap}>
      <Text style={[styles.occText, { color: tone.ink }]}>
        {state.capacity !== null
          ? he.roundRegisteredOf(state.registered, state.capacity)
          : he.roundRegisteredPlain(state.registered)}
      </Text>
      {pct !== null ? (
        <View style={styles.occTrack}>
          {/* Written first → fills from the visual RIGHT, the direction the
              line above it is read in. */}
          <View style={[styles.occFill, { flex: pct, backgroundColor: tone.ink }]} />
          <View style={{ flex: 1 - pct }} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The sentence that says what to do — or that nothing needs doing.
 *
 * Returns null for the plain open state: there the badge and the occupancy
 * line already say everything, and a panel repeating them would push the
 * button down for nothing.
 */
function StatusPanel({
  state,
  tone,
  now,
}: {
  state: UpcomingRoundState;
  tone: { ink: string; wash: string };
  now: number;
}) {
  const body = ((): { icon: keyof typeof Ionicons.glyphMap; title: string; sub?: string } | null => {
    switch (state.kind) {
      case 'registered':
        return {
          icon: 'checkmark-circle',
          title: he.roundYouAreIn,
          sub: he.roundYouAreInSub,
        };
      case 'today':
        return {
          icon: 'time',
          title: state.startsSoon
            ? startsInLabel(state.startsInMs)
            : he.roundYouAreIn,
          sub: state.startsSoon ? he.roundStartsInSub : he.roundYouAreInSub,
        };
      case 'live':
        return { icon: 'radio', title: he.roundLiveTitle, sub: he.roundLiveSub };
      case 'waitlist':
        return {
          icon: 'hourglass',
          // Only said when the queue actually gives a place. The array's
          // order IS the queue, so this is read, never estimated.
          title:
            state.waitlistPosition !== null
              ? he.roundWaitlistPlace(state.waitlistPosition)
              : he.roundWaitlistNoPlace,
          sub: he.roundWaitlistSub,
        };
      case 'pending':
        return { icon: 'hourglass', title: he.roundPendingTitle, sub: he.roundPendingSub };
      case 'opensSoon':
        // One line, not two. "ההרשמה תיפתח" on its own row with the duration
        // underneath read as two separate facts; it is one sentence.
        return {
          icon: 'time',
          title:
            state.opensAt !== null
              ? he.roundOpensInLine(opensLabel(state.opensAt, now))
              : he.roundOpensIn,
        };
      case 'full':
        return {
          icon: 'people',
          title: he.roundFullTitle,
          sub:
            state.waitlistCount > 0
              ? he.roundFullWaitlistCount(state.waitlistCount)
              : he.roundFullNoWaitlist,
        };
      case 'closed':
        // Always "you cannot get in", never "you are in": a viewer who holds
        // a place resolves to `registered` several rungs earlier and never
        // reaches this branch. Saying it both ways here would be a condition
        // that can only ever take one side.
        return {
          icon: 'lock-closed',
          title: he.roundClosedTitle,
          sub: he.roundClosedSubOut,
        };
      case 'open':
      default:
        return null;
    }
  })();

  if (!body) return null;
  return (
    <View style={[styles.panel, { backgroundColor: tone.wash }]}>
      <View style={[styles.panelIcon, { backgroundColor: '#FFFFFF' }]}>
        <Ionicons name={body.icon} size={16} color={tone.ink} />
      </View>
      <View style={styles.panelTexts}>
        <Text style={[styles.panelTitle, { color: tone.ink }]} numberOfLines={2}>
          {body.title}
        </Text>
        {body.sub ? (
          <Text style={styles.panelSub} numberOfLines={2}>
            {body.sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function PrimaryCta({
  game,
  state,
  actions,
  busy,
}: {
  game: Game;
  state: UpcomingRoundState;
  actions: RoundActions;
  busy?: boolean;
}) {
  // One primary per state, and the action it names is the one it performs.
  const { label, icon, onPress } = ((): {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
  } => {
    switch (state.kind) {
      case 'open':
        return { label: he.roundCtaJoin, icon: 'add-circle', onPress: () => actions.onJoin(game) };
      case 'full':
        return {
          label: he.roundCtaWaitlist,
          icon: 'hourglass',
          onPress: () => actions.onJoin(game),
        };
      case 'live':
        return { label: he.roundCtaLive, icon: 'radio', onPress: () => actions.onDetails(game.id) };
      default:
        return {
          label: he.roundCtaDetails,
          icon: 'football',
          onPress: () => actions.onDetails(game.id),
        };
    }
  })();

  const tone = TONE[state.kind];
  return (
    <PressableScale
      onPress={onPress}
      disabled={busy}
      pressedScale={motion.press.controlScale}
      haptic={false}
      style={[styles.cta, { backgroundColor: tone.ink }, busy && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!busy }}
    >
      {/* The row lives on this inner View, not on PressableScale: a style
          given to it reaches the Pressable, whose only child is its transform
          wrapper, so the row would never touch these two. */}
      <View style={styles.ctaRow}>
        <Text style={styles.ctaText}>{label}</Text>
        <Ionicons name={icon} size={17} color="#FFFFFF" />
      </View>
    </PressableScale>
  );
}

/**
 * A second action, only where one genuinely exists.
 *
 * Open → the details, because joining from the card skips the roster and the
 * rules and some people want to look first. Registered → share, which is a
 * flow the app already has. Everywhere else: nothing. A secondary button
 * that merely repeats the primary is a decision the reader has to make twice.
 */
function SecondaryCta({
  game,
  state,
  actions,
}: {
  game: Game;
  state: UpcomingRoundState;
  actions: RoundActions;
}) {
  if (state.kind === 'open' || state.kind === 'full') {
    return (
      <Pressable
        onPress={() => actions.onDetails(game.id)}
        hitSlop={8}
        style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryTxt}>{he.roundCtaDetails}</Text>
        <Ionicons name="chevron-back" size={14} color={colors.primary} />
      </Pressable>
    );
  }
  if ((state.kind === 'registered' || state.kind === 'today') && actions.onShare) {
    return (
      <Pressable
        onPress={() => actions.onShare?.(game)}
        hitSlop={8}
        style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryTxt}>{he.roundCtaShare}</Text>
        <Ionicons name="share-social-outline" size={14} color={colors.primary} />
      </Pressable>
    );
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// The round that finished
// ════════════════════════════════════════════════════════════════════════════

/**
 * Deliberately NOT the upcoming card in another colour.
 *
 * Nothing here can be registered for, so nothing here shows places,
 * occupancy or a join. It is a summary: a trophy, what the evening was, the
 * numbers the evening actually recorded, and the way into its full summary.
 *
 * `role` decides its weight. `compact` is what it is whenever an upcoming
 * round is leading — a short strip that cannot be mistaken for the headline.
 */
export function CompletedRoundCard({
  game,
  clubName,
  role,
  onSummary,
}: {
  game: Game;
  clubName?: string;
  role: 'primary' | 'compact';
  onSummary: (gameId: string) => void;
}) {
  const metrics = completedMetrics(game);
  const club = (clubName || game.title || '').trim();
  const when = formatGameDay(game.endedAt ?? game.startsAt);
  const compact = role === 'compact';

  return (
    <Pressable
      onPress={() => onSummary(game.id)}
      style={({ pressed }) => [
        styles.doneCard,
        compact && styles.doneCompact,
        pressed && { opacity: 0.93 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${he.roundCompletedTitle} — ${he.roundCtaSummary}`}
    >
      {!compact ? (
        <ImageBackground
          source={NIGHT_PITCH}
          style={styles.doneBanner}
          resizeMode="cover"
          imageStyle={styles.doneBannerImg}
        >
          <LinearGradient
            colors={['rgba(79,70,229,0.86)', 'rgba(37,99,235,0.88)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.doneTrophy}>
            <Ionicons name="trophy" size={20} color="#4F46E5" />
          </View>
        </ImageBackground>
      ) : null}

      <View style={styles.doneBody}>
        <View style={styles.doneHead}>
          {compact ? (
            <View style={styles.doneTrophySm}>
              <Ionicons name="trophy" size={15} color="#4F46E5" />
            </View>
          ) : null}
          <View style={styles.doneTexts}>
            <Text style={styles.doneTitle} numberOfLines={1}>
              {he.roundCompletedTitle}
            </Text>
            <Text style={styles.doneSub} numberOfLines={1}>
              {[when, club].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>

        {/* Only the numbers the evening really recorded. An evening with
            none shows the line above and the button, and says nothing it
            cannot back up. */}
        {metrics.length > 0 ? (
          <View style={styles.doneMetrics}>
            {metrics.map((m) => (
              <View key={m.key} style={styles.doneMetric}>
                <Text style={styles.doneMetricValue}>{m.value}</Text>
                <Text style={styles.doneMetricLabel}>
                  {m.key === 'rounds' ? he.roundMetricRounds : he.roundMetricPlayers}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Centred, with the icon on the LEFT of the label. It used to be
            pinned right with a chevron pushed to the far edge, which read as
            two controls rather than one. */}
        <View style={styles.doneCtaRow}>
          <Text style={styles.doneCta}>{he.roundCtaSummary}</Text>
          <Ionicons name="document-text-outline" size={15} color="#4F46E5" />
        </View>
      </View>
    </Pressable>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Nothing coming
// ════════════════════════════════════════════════════════════════════════════

/**
 * Not a blank. The one thing a player with no game needs is a way to get one,
 * so this card is an invitation with the two routes the app already has.
 */
export function NoRoundCard({
  onCreate,
  onFind,
}: {
  onCreate: () => void;
  onFind: () => void;
}) {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyTop}>
        <View style={styles.emptyTexts}>
          <Text style={styles.emptyTitle}>{he.roundEmptyTitle}</Text>
          <Text style={styles.emptyAccent}>{he.roundEmptySub}</Text>
          <Text style={styles.emptyBody}>{he.roundEmptyBody}</Text>
        </View>
        <View style={styles.emptyArt}>
          <MaterialCommunityIcons name="soccer-field" size={40} color="#93C5FD" />
          <MaterialCommunityIcons
            name="soccer"
            size={26}
            color="#1E40AF"
            style={styles.emptyBall}
          />
        </View>
      </View>

      <PressableScale
        onPress={onCreate}
        pressedScale={motion.press.controlScale}
        haptic={false}
        style={[styles.cta, { backgroundColor: colors.primary }]}
        accessibilityRole="button"
        accessibilityLabel={he.roundEmptyCtaOpen}
      >
        <View style={styles.ctaRow}>
          <Text style={styles.ctaText}>{he.roundEmptyCtaOpen}</Text>
          <Ionicons name="calendar" size={17} color="#FFFFFF" />
        </View>
      </PressableScale>

      <Pressable
        onPress={onFind}
        style={({ pressed }) => [styles.emptyFind, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel={he.roundEmptyCtaFind}
      >
        <Text style={styles.emptyFindTxt}>{he.roundEmptyCtaFind}</Text>
        <Ionicons name="chevron-back" size={15} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  // ── upcoming ──
  card: {
    backgroundColor: colors.surface,
    borderRadius: R,
    padding: spacing.md,
    gap: spacing.sm,
    ...CARD_SHADOW,
  },
  top: { flexDirection: 'row', gap: spacing.md, alignItems: 'stretch', minHeight: 136 },
  meta: { flex: 1, minWidth: 0, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  calChip: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '900',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  club: { ...typography.body, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  infoStrong: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  infoMuted: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  // A share of the card, so the meta column keeps its room on a 320dp phone.
  photo: {
    width: '34%',
    minWidth: 96,
    maxWidth: 140,
    borderRadius: 16,
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    top: 8,
    left: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeTxt: { fontSize: 10, fontWeight: '800', flexShrink: 1 },

  occWrap: { marginTop: spacing.xs, gap: 5 },
  occText: {
    fontSize: 13,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    fontVariant: ['tabular-nums'],
  },
  occTrack: {
    flexDirection: 'row',
    height: 5,
    borderRadius: 3,
    backgroundColor: '#EDF1F7',
    overflow: 'hidden',
  },
  occFill: { height: 5, borderRadius: 3 },

  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 14,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  panelIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelTexts: { flex: 1, minWidth: 0 },
  panelTitle: { fontSize: 14, fontWeight: '900', textAlign: RTL_LABEL_ALIGN },
  panelSub: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 1,
  },

  // The organiser's note. Amber rather than the state's own colour: it is the
  // club talking, not another reading of the registration.
  pinned: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#FFFBEB',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FDE68A',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  pinnedTexts: { flex: 1, minWidth: 0 },
  pinnedTitle: {
    fontSize: 11.5,
    fontWeight: '900',
    color: '#92400E',
    textAlign: RTL_LABEL_ALIGN,
  },
  pinnedBody: {
    fontSize: 13,
    lineHeight: 18,
    color: '#78350F',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 1,
  },
  cta: { justifyContent: 'center', height: 50, borderRadius: 14 },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 2,
  },
  secondaryTxt: { fontSize: 13.5, fontWeight: '800', color: colors.primary },

  // ── completed ──
  doneCard: {
    backgroundColor: '#F5F6FF',
    borderRadius: R,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#DDE0FB',
    ...CARD_SHADOW,
  },
  doneCompact: { backgroundColor: '#F5F6FF' },
  doneBanner: { height: 64, alignItems: 'center', justifyContent: 'center' },
  doneBannerImg: { opacity: 0.6 },
  doneTrophy: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBody: { padding: spacing.md, gap: spacing.sm },
  doneHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  doneTrophySm: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneTexts: { flex: 1, minWidth: 0 },
  doneTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#312E81',
    textAlign: RTL_LABEL_ALIGN,
  },
  doneSub: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 1,
  },
  doneMetrics: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: spacing.sm,
  },
  doneMetric: { flex: 1, alignItems: 'center', gap: 1 },
  doneMetricValue: {
    fontSize: 19,
    fontWeight: '900',
    color: '#312E81',
    fontVariant: ['tabular-nums'],
  },
  doneMetricLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '700' },
  doneCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  doneCta: { fontSize: 13.5, fontWeight: '800', color: '#4F46E5' },

  // ── nothing coming ──
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: R,
    padding: spacing.md,
    gap: spacing.sm,
    ...CARD_SHADOW,
  },
  emptyTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  emptyTexts: { flex: 1, minWidth: 0, gap: 1 },
  emptyTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '900',
    textAlign: RTL_LABEL_ALIGN,
  },
  emptyAccent: {
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.primary,
    textAlign: RTL_LABEL_ALIGN,
  },
  emptyBody: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 2,
  },
  emptyArt: {
    width: 92,
    height: 72,
    borderRadius: 16,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBall: { position: 'absolute', bottom: 10 },
  emptyFind: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#EFF4FF',
  },
  emptyFindTxt: { fontSize: 14.5, fontWeight: '800', color: colors.primary },
});
