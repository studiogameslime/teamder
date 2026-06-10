// ProfileNextGameCard — the soonest game the user is registered for,
// shown on their OWN player card in place of the achievements rail.
//
// Two states:
//   • Has a game  → white card (title + venue + date/time + kickoff
//                   chip + occupancy + status pill). Tap → MatchDetails.
//   • No game     → muted empty card with a "find a game" CTA that
//                   jumps to the Games tab.
//
// Visual language is borrowed from MatchListCard so the card reads as
// "the same game, surfaced here" rather than a bespoke widget.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Game, GameFormat, UserId } from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { dayDiff, formatGameDay, formatTime, relativeKickoff } from '@/utils/format';
import { PressableScale } from '@/components/PressableScale';

interface Props {
  game: Game | null;
  userId: UserId;
  /** Tap on a populated card → open that game's details. */
  onOpenGame: (gameId: string) => void;
  /** Tap on the empty-state CTA → jump to the Games tab. */
  onFindGame: () => void;
}

const ACCENT = '#3B82F6';

function formatLabel(f: GameFormat | undefined): string {
  if (f === '6v6') return he.gameFormat6;
  if (f === '7v7') return he.gameFormat7;
  return he.gameFormat5;
}

function statusForUser(
  g: Game,
  uid: UserId,
): 'joined' | 'waitlist' | 'pending' | 'none' {
  if (g.players.includes(uid)) return 'joined';
  if (g.waitlist.includes(uid)) return 'waitlist';
  if ((g.pending ?? []).includes(uid)) return 'pending';
  return 'none';
}

export function ProfileNextGameCard({
  game,
  userId,
  onOpenGame,
  onFindGame,
}: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Ionicons name="football-outline" size={18} color={colors.text} />
        <Text style={styles.title}>{he.profileNextGameTitle}</Text>
      </View>
      {game ? (
        <GameBody game={game} userId={userId} onOpenGame={onOpenGame} />
      ) : (
        <EmptyBody onFindGame={onFindGame} />
      )}
    </View>
  );
}

function GameBody({
  game,
  userId,
  onOpenGame,
}: {
  game: Game;
  userId: UserId;
  onOpenGame: (gameId: string) => void;
}) {
  const occupancy = game.players.length + (game.guests?.length ?? 0);
  const kickoff = relativeKickoff(game.startsAt);
  const kickoffSoon = !!kickoff && kickoff.startsWith('עוד');
  const status = statusForUser(game, userId);

  return (
    <PressableScale
      onPress={() => onOpenGame(game.id)}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={game.title}
    >
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <View style={styles.titleTextWrap}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {game.title}
            </Text>
            <Ionicons
              name="chevron-back"
              size={18}
              color="#94A3B8"
              style={styles.titleChevron}
            />
          </View>
          {renderStatusPill(status)}
        </View>

        {game.fieldName ? (
          <InfoRow icon="location" text={game.fieldName} />
        ) : null}

        <View style={styles.dateLine}>
          <InfoRow
            icon="calendar"
            text={formatGameDay(game.startsAt)}
            emphasis={dayDiff(game.startsAt) <= 1}
          />
          <InfoRow icon="time" text={formatTime(game.startsAt)} />
          {kickoff ? (
            <View
              style={[styles.kickoffChip, kickoffSoon && styles.kickoffChipSoon]}
            >
              <Text
                style={[
                  styles.kickoffText,
                  kickoffSoon && styles.kickoffTextSoon,
                ]}
              >
                {kickoff}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.tagsRow}>
          <View style={styles.formatTag}>
            <Text style={styles.formatTagText}>{formatLabel(game.format)}</Text>
          </View>
          <Text style={styles.playersInline} numberOfLines={1}>
            {he.matchCardPlayersOf(occupancy, game.maxPlayers)}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}

function EmptyBody({ onFindGame }: { onFindGame: () => void }) {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name="football-outline" size={26} color={ACCENT} />
      </View>
      <Text style={styles.emptyTitle}>{he.profileNextGameEmptyTitle}</Text>
      <Text style={styles.emptyBody}>{he.profileNextGameEmptyBody}</Text>
      <Pressable
        onPress={onFindGame}
        style={({ pressed }) => [styles.emptyCta, pressed && { opacity: 0.88 }]}
        accessibilityRole="button"
        accessibilityLabel={he.profileNextGameEmptyCta}
      >
        <Ionicons name="search" size={16} color="#FFFFFF" />
        <Text style={styles.emptyCtaText}>{he.profileNextGameEmptyCta}</Text>
      </Pressable>
    </View>
  );
}

function InfoRow({
  icon,
  text,
  emphasis,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  /** Brand-colored + bold (for the "היום"/"מחר" day label). */
  emphasis?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Text
        style={[styles.infoText, emphasis && styles.infoTextEmphasis]}
        numberOfLines={1}
      >
        {text}
      </Text>
      <Ionicons name={icon} size={13} color={emphasis ? ACCENT : '#94A3B8'} />
    </View>
  );
}

function renderStatusPill(
  status: 'joined' | 'waitlist' | 'pending' | 'none',
): React.ReactNode {
  if (status === 'joined') {
    return (
      <Pill label={he.matchStatusJoined} bg="#DCFCE7" fg="#166534" icon="checkmark-circle" />
    );
  }
  if (status === 'waitlist') {
    return (
      <Pill label={he.matchStatusWaitlist} bg="#FEF3C7" fg="#B45309" icon="hourglass" />
    );
  }
  if (status === 'pending') {
    return (
      <Pill label={he.matchStatusPending} bg="#E2E8F0" fg="#475569" icon="time" />
    );
  }
  return null;
}

function Pill({
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

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  // `row` flips under forceRTL so the first JSX child (the icon)
  // lands on the visual RIGHT (leading) edge, the title to its left —
  // matching the section-header pattern in the mockup.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    paddingHorizontal: spacing.xs,
  },
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  // ── Populated card (mirrors MatchListCard) ──────────────────────
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  content: { gap: 6 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  titleTextWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  cardTitle: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  titleChevron: { opacity: 0.6 },
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
  infoTextEmphasis: {
    color: ACCENT,
    fontWeight: '800',
  },
  dateLine: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.md,
    alignSelf: 'flex-start',
  },
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
  },
  formatTag: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(59,130,246,0.12)',
  },
  formatTagText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: '#1D4ED8',
  },
  playersInline: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
    marginEnd: 'auto',
    textAlign: RTL_LABEL_ALIGN,
  },
  pill: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    flexShrink: 0,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  // ── Empty state ─────────────────────────────────────────────────
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  emptyIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  emptyTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  emptyCta: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: 20,
    height: 44,
    borderRadius: 999,
    backgroundColor: ACCENT,
  },
  emptyCtaText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
