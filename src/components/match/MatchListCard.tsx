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
import { formatDateShort, formatTime, relativeKickoff } from '@/utils/format';
import { PressableScale } from '@/components/PressableScale';

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


// ─── Component ─────────────────────────────────────────────────────────

export function MatchListCard({ game, userId, onPrimary, busy }: Props) {
  const nav = useNavigation<{ navigate: (s: string, p?: unknown) => void }>();
  const status = statusForUser(game, userId);
  const cta = ctaForGame(game, status);
  const fmt = formatLabel(game.format) ?? he.gameFormat5;
  const occupancy = game.players.length + (game.guests?.length ?? 0);

  const isFull = occupancy >= game.maxPlayers;
  // Relative "time to kickoff" chip — nudges the user with how soon the game
  // is ("מחר", "עוד 3 שעות") next to the absolute date.
  const kickoff = relativeKickoff(game.startsAt);
  // Highlight when it's imminent (today, within hours/minutes) vs just soon.
  const kickoffSoon = !!kickoff && kickoff.startsWith('עוד');

  const openDetails = () =>
    nav.navigate('MatchDetails', { gameId: game.id });

  // Status pill at the top-LEFT corner of the card (same row as the
  // title). Joined / waitlist / pending override the open/full
  // default so the user sees their personal state first.
  const statusPill = renderStatusPill(status, isFull);

  // Tag row — the capacity chip (מלא / מקומות אחרונים) leads so it
  // ends up on the visual LEFT EDGE of the row under RTL flip, where
  // a red/orange swatch reads as a scarcity alarm separated from the
  // descriptor cluster. Format + field type + approval follow on the
  // right, reading right-to-left as the primary facets.
  const tags: Array<{ label: string; tone: 'accent' | 'neutral' | 'warning' | 'danger' }> = [];
  const spotsLeft = Math.max(0, game.maxPlayers - occupancy);
  if (isFull) {
    tags.push({ label: he.matchStatusFull, tone: 'danger' });
  } else if (spotsLeft > 0 && spotsLeft <= 3) {
    tags.push({ label: he.matchStatusLastSpots(spotsLeft), tone: 'warning' });
  }
  tags.push({ label: fmt, tone: 'accent' });
  if (game.fieldType) {
    tags.push({ label: fieldTypeLabel(game.fieldType), tone: 'neutral' });
  }
  if (game.requiresApproval) {
    // Describes the GAME (joining needs approval) — not the viewer's status.
    tags.push({ label: he.matchTagNeedsApproval, tone: 'warning' });
  }
  // Visibility at a glance: open-to-all (accent) vs members-only / quick.
  if (game.visibility === 'public') {
    tags.push({ label: he.matchTagOpenToAll, tone: 'accent' });
  } else if (game.isOrphanContext) {
    tags.push({ label: he.matchTagQuickClosed, tone: 'neutral' });
  } else {
    tags.push({ label: he.matchTagCommunityOnly, tone: 'neutral' });
  }

  // Hide the cancel CTA on the list — it's a destructive action and
  // belongs only on MatchDetails where the consequence is more
  // visible. Same rule the old card followed.
  const showCta = cta === 'join' || cta === 'waitlist';

  return (
    <PressableScale
      onPress={openDetails}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={game.title}
    >
      <View style={styles.content}>
        {/* Title row — title (+ chevron) anchors the visual RIGHT
            edge of the card (Hebrew reading starts there). Status
            pill anchors the visual LEFT. JSX-first lands on the
            visual RIGHT under our RTL flow, so title comes first. */}
        <View style={styles.titleRow}>
          <View style={styles.titleTextWrap}>
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
          {statusPill ? (
            <View style={styles.titleStatusPill}>{statusPill}</View>
          ) : null}
        </View>

        {game.fieldName ? (
          <InfoRow icon="location" text={game.fieldName} />
        ) : null}

        <View style={styles.dateLine}>
          <InfoRow
            icon="calendar"
            text={formatDateShort(game.startsAt)}
          />
          <InfoRow icon="time" text={formatTime(game.startsAt)} />
          {kickoff ? (
            <View style={[styles.kickoffChip, kickoffSoon && styles.kickoffChipSoon]}>
              <Text style={[styles.kickoffText, kickoffSoon && styles.kickoffTextSoon]}>
                {kickoff}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Combined facts row — the per-game chips (capacity, format,
            field type) AND the player count share one row now. The
            count anchors the RIGHT edge so it lines up with the
            heaviest piece of info (where the eye lands first reading
            RTL); the chips spill from there toward the visual LEFT,
            capacity-first under the new ordering. */}
        <View style={styles.tagsRow}>
          {tags.map((t, i) => (
            <Tag key={`${t.label}-${i}`} label={t.label} tone={t.tone} />
          ))}
          <Text style={styles.playersInline} numberOfLines={1}>
            {he.matchCardPlayersOf(occupancy, game.maxPlayers)}
          </Text>
        </View>

        {showCta ? (
          <View style={styles.bottomRow}>
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
          </View>
        ) : null}
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
  tone: 'accent' | 'neutral' | 'warning' | 'danger';
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
    <View style={[styles.tag, { backgroundColor: palette.bg }]}>
      <Text style={[styles.tagText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

function renderStatusPill(
  status: ReturnType<typeof statusForUser>,
  isFull: boolean,
): React.ReactNode {
  // Status pill = USER'S relationship to the game (joined / waitlist /
  // pending). Capacity ("מלא" / "מקומות אחרונים") lives in the tags row
  // instead, so a registered user still sees the room/scarcity signal
  // without it stealing the status slot.
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
  // Not-related user: still show one pill so the card never looks bare.
  // Full is the louder of the two; open is the default.
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
  content: {
    gap: 6,
  },
  // Title row — title (+ chevron) on the visual RIGHT, status pill on
  // the visual LEFT. `space-between` resolves automatically under RTL
  // so we don't need an absolute child to anchor the pill.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  // Title + chevron move as a single unit on the visual RIGHT side of
  // the row. `flexShrink: 1` lets a long title elide rather than push
  // the pill off the card.
  titleTextWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  titleStatusPill: {
    flexShrink: 0,
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
  // "Time to kickoff" chip — neutral by default, blue when imminent (today).
  kickoffChip: {
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  kickoffChipSoon: { backgroundColor: '#DBEAFE' },
  kickoffText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  kickoffTextSoon: { color: '#1D4ED8' },
  tagsRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'stretch',
    marginTop: 2,
    flexWrap: 'wrap',
  },
  // Player count rides the chips row now. `marginEnd: auto` (RTL-aware
  // 'start' under forceRTL) pushes the count to the visual RIGHT edge,
  // which is where the eye lands first reading Hebrew. The chips
  // gather on its left.
  playersInline: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
    marginEnd: 'auto',
    textAlign: RTL_LABEL_ALIGN,
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
