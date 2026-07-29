// MatchListCard — games-feed card. Two columns under forceRTL:
//
//   ┌─────────────────────────────────────────────────────────────┐
//   │                     14/15   כדורגל אנשים טובים ‹  [בהרכב][🛡] │
//   │  ▓▓▓▓▓▓▓░           📍 שדרות אליהו סעדון, אור יהודה           │
//   │  חסר שחקן אחד    [עוד 11 שעות] 20:00 🕐  היום 📅            │
//   │  [ אני מגיע ]    [מקום אחרון] [5×5] [אספלט] [סגור למועדון]    │
//   └─────────────────────────────────────────────────────────────┘
//
// RIGHT column = details (title + chevron + status/manager pill, location,
// date/time line with a relative-kickoff pill, chip tags). LEFT column =
// occupancy number (top), progress bar, spots-left text (bottom) + join CTA.
// Fill urgency (green plenty / amber last-few / red full) colours the bar +
// spots text. Tap → MatchDetails.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Game, GameFormat, FieldType, UserId, activeGuestCount } from '@/types';
import { spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { dayDiff, formatDateShort, formatTime } from '@/utils/format';
import { PressableScale } from '@/components/PressableScale';

export type MatchCardCta =
  | 'join'
  | 'requestJoin'
  | 'cancel'
  | 'waitlist'
  | 'leaveWaitlist'
  | 'pending'
  | 'none';

interface Props {
  game: Game;
  userId: UserId;
  onPrimary: (cta: MatchCardCta) => void;
  busy?: boolean;
}

const ACCENT = '#3B82F6';
const GREEN = '#16A34A';
const AMBER = '#F59E0B';
const RED = '#DC2626';
const MUTED = '#94A3B8';
const INK = '#0F172A';

// ─── Pure derivations ──────────────────────────────────────────────────

function statusForUser(
  g: Game,
  uid: UserId,
): 'joined' | 'waitlist' | 'pending' | 'none' {
  if (g.players.includes(uid)) return 'joined';
  if (g.waitlist.includes(uid)) return 'waitlist';
  if ((g.pending ?? []).includes(uid)) return 'pending';
  return 'none';
}

function ctaForGame(
  g: Game,
  status: ReturnType<typeof statusForUser>,
): MatchCardCta {
  if (status === 'joined') return 'cancel';
  if (status === 'waitlist') return 'leaveWaitlist';
  if (status === 'pending') return 'pending';
  if (g.status === 'scheduled') return 'none';
  if (g.requiresApproval) return 'requestJoin';
  const occupancy =
    g.players.length +
    activeGuestCount(g.guests) +
    (g.pendingPromotion?.uid ? 1 : 0);
  if (occupancy < g.maxPlayers) return 'join';
  return 'waitlist';
}

function formatLabel(f: GameFormat | undefined): string | null {
  const s = f as string | undefined;
  if (s === '4v4') return he.gameFormat4;
  if (s === '5v5') return he.gameFormat5;
  if (s === '6v6') return he.gameFormat6;
  if (s === '7v7') return he.gameFormat7;
  if (typeof s === 'string' && /^\d+v\d+$/.test(s)) return s.replace('v', '×');
  return null;
}

function fieldTypeLabel(f: FieldType): string {
  if (f === 'asphalt') return he.fieldTypeAsphalt;
  if (f === 'synthetic') return he.fieldTypeSynthetic;
  return he.fieldTypeGrass;
}

// ─── Component ─────────────────────────────────────────────────────────

export function MatchListCard({ game, userId, onPrimary, busy }: Props) {
  const nav = useNavigation<{ navigate: (s: string, p?: unknown) => void }>();
  const status = statusForUser(game, userId);
  const cta = ctaForGame(game, status);
  const isManager = !!userId && game.createdBy === userId;
  const fmt = formatLabel(game.format);
  const occupancy =
    game.players.length +
    activeGuestCount(game.guests) +
    (game.pendingPromotion?.uid ? 1 : 0);
  const isFull = occupancy >= game.maxPlayers;
  const spotsLeft = Math.max(0, game.maxPlayers - occupancy);
  const ratio = game.maxPlayers > 0 ? Math.min(1, occupancy / game.maxPlayers) : 0;

  // Fill urgency → colours the progress bar. (The spots-left text under the
  // bar was removed — the bar itself already reads at a glance.)
  const urgency = isFull ? RED : spotsLeft <= 3 ? AMBER : GREEN;

  // Smart when-line: today/tomorrow → "<day> ב-HH:MM"; further out → date + time.
  const dDiff = dayDiff(game.startsAt);
  const time = formatTime(game.startsAt);
  const whenText =
    dDiff === 0
      ? he.matchCardWhenToday(time)
      : dDiff === 1
        ? he.matchCardWhenTomorrow(time)
        : he.matchCardWhenDate(formatDateShort(game.startsAt), time);
  const whenSoon = dDiff <= 1;

  // Side accent stripe by the viewer's relationship to the game:
  // green = in the roster, orange = on the waitlist, blue = regular.
  const stripeColor =
    status === 'joined' ? GREEN : status === 'waitlist' ? AMBER : ACCENT;

  const openDetails = () => nav.navigate('MatchDetails', { gameId: game.id });

  // A full game always offers a waitlist join ("הצטרף") — there's no
  // lock-registration feature, so registration is open until the game is over.
  const showCta =
    cta === 'join' || cta === 'requestJoin' || cta === 'waitlist';
  // Even a full game's CTA just says "הצטרף" (not "…לרשימת המתנה") — tappers
  // land on the waitlist and then see the "ברשימת המתנה" badge.
  const ctaLabel =
    cta === 'requestJoin' ? he.gameCardRequestJoin : he.matchCardJoinShort;

  // Personal-status label — replaces the CTA button once the user has a
  // relationship to the game. Styled as a soft, non-interactive badge (looks
  // un-tappable, not a button) in the same spot the "הצטרף" button sat.
  const statusLabel =
    status === 'joined'
      ? { label: he.matchStatusJoined, bg: '#DCFCE7', fg: '#166534', icon: 'checkmark-circle' as const }
      : status === 'waitlist'
        ? { label: he.matchCardInWaitlist, bg: '#FEF3C7', fg: '#B45309', icon: 'hourglass' as const }
        : status === 'pending'
          ? { label: he.matchStatusPending, bg: '#E2E8F0', fg: '#475569', icon: 'time' as const }
          : null;

  // Chip tags — format + surface + visibility only. (Scarcity / full /
  // closed tags were dropped — they duplicate the occupancy bar.)
  const chips: Array<{ label: string; tone: 'neutral' | 'accent' | 'warning' | 'danger' }> = [];
  if (fmt) chips.push({ label: fmt, tone: 'neutral' });
  if (game.fieldType) chips.push({ label: fieldTypeLabel(game.fieldType), tone: 'neutral' });
  chips.push({
    label:
      game.visibility === 'public'
        ? he.matchTagOpenToAll
        : game.isOrphanContext
          ? he.matchTagQuickClosed
          : he.matchTagCommunityOnly,
    tone: game.visibility === 'public' ? 'accent' : 'neutral',
  });

  return (
    <PressableScale
      onPress={openDetails}
      style={[styles.card, { borderEndColor: stripeColor }]}
      haptic={false}
      accessibilityRole="button"
      accessibilityLabel={game.title}
    >
      <View style={styles.row}>
        {/* ── RIGHT column: details ──────────────────────────────── */}
        <View style={styles.detailsCol}>
          <Text style={styles.title} numberOfLines={2}>
            {game.title}
          </Text>

          {game.fieldName ? (
            <InfoRow icon="location-outline" text={game.fieldName} />
          ) : null}

          {/* Smart when-line: "היום ב-20:00" / "מחר ב-20:00" / "01.08 · 17:00". */}
          <View style={styles.dateRow}>
            <MetaChip icon="calendar-outline" text={whenText} emphasis={whenSoon} />
          </View>

          {/* Chip tags — format / surface / visibility. */}
          <View style={styles.chipsRow}>
            {chips.map((c, i) => (
              <Chip key={`${c.label}-${i}`} label={c.label} tone={c.tone} />
            ))}
          </View>
        </View>

        {/* ── LEFT column: occupancy + CTA / status label ────────── */}
        <View style={styles.statusCol}>
          <Text style={styles.occupancy}>
            {he.matchCardOccupancy(occupancy, game.maxPlayers)}
          </Text>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round(ratio * 100)}%`, backgroundColor: urgency },
              ]}
            />
          </View>

          {showCta ? (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onPrimary(cta);
              }}
              disabled={busy}
              hitSlop={6}
              style={({ pressed }) => [
                styles.cta,
                (pressed || busy) && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={ctaLabel}
            >
              <Text
                style={styles.ctaText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
              >
                {ctaLabel}
              </Text>
            </Pressable>
          ) : statusLabel ? (
            // Already in the game → a soft, NON-interactive status badge in the
            // button's spot (so the CTA doesn't just vanish after joining).
            <View style={[styles.statusLabel, { backgroundColor: statusLabel.bg }]}>
              <Ionicons name={statusLabel.icon} size={13} color={statusLabel.fg} />
              <Text
                style={[styles.statusLabelText, { color: statusLabel.fg }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {statusLabel.label}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function InfoRow({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoText} numberOfLines={1}>
        {text}
      </Text>
      <Ionicons name={icon} size={13} color={MUTED} />
    </View>
  );
}

function MetaChip({
  icon,
  text,
  emphasis,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.metaChip}>
      <Text style={[styles.metaText, emphasis && styles.metaTextEmphasis]} numberOfLines={1}>
        {text}
      </Text>
      <Ionicons name={icon} size={12} color={emphasis ? ACCENT : MUTED} />
    </View>
  );
}

function Chip({
  label,
  tone,
}: {
  label: string;
  tone: 'neutral' | 'accent' | 'warning' | 'danger';
}) {
  const palette =
    tone === 'danger'
      ? { bg: '#FEE2E2', fg: '#B91C1C' }
      : tone === 'warning'
        ? { bg: '#FEF3C7', fg: '#B45309' }
        : tone === 'accent'
          ? { bg: 'rgba(59,130,246,0.12)', fg: '#1D4ED8' }
          : { bg: '#F1F5F9', fg: '#475569' };
  return (
    <View style={[styles.chip, { backgroundColor: palette.bg }]}>
      <Text style={[styles.chipText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: spacing.md,
    // 6px colored accent border on the visual-LEFT edge (end under RTL).
    // paddingEnd is reduced by 6 so the CONTENT position is unchanged.
    borderEndWidth: 6,
    paddingEnd: spacing.md - 6,
    paddingStart: spacing.md,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  detailsCol: { flex: 1, gap: 6 },
  // Status pill (top-left) + centred occupancy + progress bar + CTA.
  statusCol: {
    width: 96,
    gap: 6,
    alignItems: 'stretch',
  },
  title: {
    color: INK,
    fontSize: 16,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  // Non-interactive status badge that replaces the CTA once joined/waitlisted.
  // Soft fill, no shadow/border → reads as a label, not a tappable button.
  statusLabel: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 999,
    alignSelf: 'stretch',
    marginTop: 2,
  },
  statusLabelText: { fontSize: 12.5, fontWeight: '800', flexShrink: 1 },
  infoRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  infoText: {
    color: '#475569',
    fontSize: 12.5,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  dateRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    flexWrap: 'wrap',
  },
  metaChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 3,
  },
  metaText: {
    color: '#475569',
    fontSize: 12.5,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  metaTextEmphasis: { color: ACCENT, fontWeight: '800' },
  chipsRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    flexWrap: 'wrap',
    marginTop: 1,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  chipText: { fontSize: 11, fontWeight: '700' },
  // ── left column ──
  // Smaller + centred over the progress bar.
  occupancy: {
    color: INK,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: '#EEF2F7',
    overflow: 'hidden',
    alignSelf: 'stretch',
    // Fill grows from the visual-LEFT (flex-end under forceRTL) to match the
    // sketch — was filling from the right (reversed).
    alignItems: 'flex-end',
  },
  progressFill: { height: '100%', borderRadius: 999 },
  cta: {
    backgroundColor: ACCENT,
    paddingVertical: 9,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: 2,
  },
  ctaText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '800', letterSpacing: 0.2 },
});
