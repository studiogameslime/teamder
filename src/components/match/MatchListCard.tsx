// MatchListCard — premium row card for the redesigned matches list.
//
// Layout under forceRTL (visual):
//
//   ┌──────────────────────────────────────────────────────┐
//   │ [פתוח]                       קבוצה / שם המשחק   →    │
//   │                              📍 שם המגרש              │
//   │                              📅 30/04   ⏰ 20:00      │
//   │                              [5×5] [אספלט] [ממתין]   │
//   │   [הצטרף למשחק]              8/15 שחקנים              │
//   └──────────────────────────────────────────────────────┘
//
// Status pill is absolute at the top-LEFT (same row as the title);
// the format (5×5) lives as a leading chip in the tags row instead
// of a wide vertical strip — keeps the card compact.
//
// Tapping the card → MatchDetails (same-stack push, registered in
// every host stack so back returns to the list).

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Game, GameFormat, FieldType, UserId } from '@/types';
import { spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export type MatchCardCta =
  | 'join'
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
  if (g.requiresApproval) return 'pending';
  const occupancy = g.players.length + (g.guests?.length ?? 0);
  if (occupancy < g.maxPlayers) return 'join';
  return 'waitlist';
}

function formatLabel(f: GameFormat | undefined): string | null {
  if (f === '5v5') return he.gameFormat5;
  if (f === '6v6') return he.gameFormat6;
  if (f === '7v7') return he.gameFormat7;
  return null;
}

function fieldTypeLabel(f: FieldType): string {
  if (f === 'asphalt') return he.fieldTypeAsphalt;
  if (f === 'synthetic') return he.fieldTypeSynthetic;
  return he.fieldTypeGrass;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function formatDateOnly(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
}
function formatTimeOnly(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Component ─────────────────────────────────────────────────────────

export function MatchListCard({ game, userId, onPrimary, busy }: Props) {
  const nav = useNavigation<{ navigate: (s: string, p?: unknown) => void }>();
  const status = statusForUser(game, userId);
  const cta = ctaForGame(game, status);
  const fmt = formatLabel(game.format) ?? he.gameFormat5;
  const occupancy = game.players.length + (game.guests?.length ?? 0);

  const isFull = occupancy >= game.maxPlayers;

  const openDetails = () =>
    nav.navigate('MatchDetails', { gameId: game.id });

  // Status pill at the top-LEFT corner of the card (same row as the
  // title). Joined / waitlist / pending override the open/full
  // default so the user sees their personal state first.
  const statusPill = renderStatusPill(status, isFull);

  // Tag row — leads with the format chip (5×5 / 6×6 / 7×7), then any
  // optional descriptors (field type, requires-approval). Format used
  // to live in a wide vertical strip on the left; folding it into the
  // tags row reclaims that horizontal real-estate.
  const tags: Array<{ label: string; tone: 'accent' | 'neutral' | 'warning' }> = [
    { label: fmt, tone: 'accent' },
  ];
  if (game.fieldType) {
    tags.push({ label: fieldTypeLabel(game.fieldType), tone: 'neutral' });
  }
  if (game.requiresApproval) {
    tags.push({ label: he.matchStatusPending, tone: 'warning' });
  }

  // Hide the cancel CTA on the list — it's a destructive action and
  // belongs only on MatchDetails where the consequence is more
  // visible. Same rule the old card followed.
  const showCta = cta === 'join' || cta === 'waitlist';

  return (
    <Pressable
      onPress={openDetails}
      style={({ pressed }) => [
        styles.card,
        pressed && { opacity: 0.95, transform: [{ scale: 0.997 }] },
      ]}
      accessibilityRole="button"
      accessibilityLabel={game.title}
    >
      {/* Status pill — absolute on the visual LEFT edge of the
          title's row, mirroring the community card pattern. `end:`
          under forceRTL maps to physical LEFT, so the pill always
          lands left-of-name regardless of any RTL flip in surrounding
          layout. The title gets a `marginEnd` clearance below so the
          right-aligned Hebrew text never bleeds into the pill area. */}
      {statusPill ? (
        <View style={styles.statusPillWrap}>{statusPill}</View>
      ) : null}

      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {game.title}
          </Text>
          <Ionicons
            name="chevron-back"
            size={18}
            color="#94A3B8"
            style={styles.titleChevron}
          />
        </View>

        {game.fieldName ? (
          <InfoRow icon="location" text={game.fieldName} />
        ) : null}

        <View style={styles.dateLine}>
          <InfoRow
            icon="calendar"
            text={formatDateOnly(game.startsAt)}
          />
          <InfoRow icon="time" text={formatTimeOnly(game.startsAt)} />
        </View>

        {tags.length > 0 ? (
          <View style={styles.tagsRow}>
            {tags.map((t, i) => (
              <Tag key={`${t.label}-${i}`} label={t.label} tone={t.tone} />
            ))}
          </View>
        ) : null}

        <View style={styles.bottomRow}>
          <Text style={styles.players} numberOfLines={1}>
            {he.matchCardPlayersOf(occupancy, game.maxPlayers)}
          </Text>
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
                cta === 'waitlist' && styles.ctaWaitlist,
                (pressed || busy) && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                cta === 'waitlist'
                  ? he.matchCardWaitlist
                  : he.matchCardJoinFull
              }
            >
              <Text style={styles.ctaText}>
                {cta === 'waitlist'
                  ? he.matchCardWaitlist
                  : he.matchCardJoinFull}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

    </Pressable>
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
  // `row-reverse` keeps the icon on the visual LEFT of the text
  // regardless of whether RN auto-flips `row` for the surrounding
  // layout — text is the FIRST JSX child so it lands on the visual
  // RIGHT under both LTR and RTL renderings.
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoText} numberOfLines={1}>
        {text}
      </Text>
      <Ionicons name={icon} size={13} color="#94A3B8" />
    </View>
  );
}

function Tag({
  label,
  tone,
}: {
  label: string;
  tone: 'accent' | 'neutral' | 'warning';
}) {
  const palette =
    tone === 'warning'
      ? { bg: '#FEF3C7', fg: '#B45309' }
      : tone === 'accent'
        ? { bg: 'rgba(59,130,246,0.12)', fg: '#1D4ED8' }
        : { bg: '#F1F5F9', fg: '#475569' };
  return (
    <View style={[styles.tag, { backgroundColor: palette.bg }]}>
      <Text style={[styles.tagText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

function renderStatusPill(
  status: ReturnType<typeof statusForUser>,
  isFull: boolean,
): React.ReactNode {
  if (status === 'joined') {
    return (
      <PillBadge label={he.matchStatusJoined} bg="#DCFCE7" fg="#166534" icon="checkmark-circle" />
    );
  }
  if (status === 'waitlist') {
    return (
      <PillBadge label={he.matchStatusWaitlist} bg="#FEF3C7" fg="#B45309" icon="hourglass" />
    );
  }
  if (status === 'pending') {
    return (
      <PillBadge label={he.matchStatusPending} bg="#E2E8F0" fg="#475569" icon="time" />
    );
  }
  if (isFull) {
    return (
      <PillBadge label={he.matchStatusFull} bg="#FEE2E2" fg="#B91C1C" icon="people" />
    );
  }
  return (
    <PillBadge label={he.matchStatusOpen} bg="#DCFCE7" fg="#166534" icon="checkmark-circle" />
  );
}

function PillBadge({
  label,
  bg,
  fg,
  icon,
}: {
  label: string;
  bg: string;
  fg: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={11} color={fg} />
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  // Status pill — pinned to the visual LEFT (end under RTL) edge of
  // the card, aligned with the title's first line so the pill sits
  // on the SAME ROW as the title.
  statusPillWrap: {
    position: 'absolute',
    top: spacing.md,
    end: spacing.md,
  },
  content: {
    gap: 6,
  },
  // Title shares the row with the absolute status pill. `marginEnd`
  // (RTL-aware) reserves a gutter on the badge's side so the right-
  // aligned Hebrew title never bleeds into the pill area.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'stretch',
    justifyContent: 'flex-start',
    marginEnd: 110,
  },
  title: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  // Chevron hint — points "back" under RTL (which Hebrew users read
  // as "next/forward"), tucked next to the title.
  titleChevron: {
    opacity: 0.6,
  },
  infoRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
  },
  infoText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
  },
  // Date + time live on one line (two InfoRows separated by a small
  // gap) — saves a row of vertical real estate.
  dateLine: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.md,
    alignSelf: 'flex-start',
  },
  tagsRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 2,
    flexWrap: 'wrap',
    maxWidth: '100%',
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  // Bottom row — players count on the visual RIGHT (Hebrew text);
  // join CTA on the visual LEFT. Built with `row-reverse` so the
  // first JSX child lands on the right regardless of RTL flip
  // behavior in the surrounding layout.
  bottomRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  players: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  cta: {
    backgroundColor: ACCENT,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 999,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaWaitlist: {
    backgroundColor: '#94A3B8',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  pill: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
