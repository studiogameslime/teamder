// MatchCard — compact, fixed-RTL list row.
//
// Strict structure (rebuilt from scratch — no improvisation):
//
//   ┌──────────────────────────────────────────────────────────┐ ← padding 16
//   │  [name (RIGHT)]                  [status badge (LEFT)]   │   TOP   row-reverse
//   │                                                          │
//   │                          📅 30/04 · 20:00                │   INFO  alignItems:flex-end
//   │                          📍 המגרש של אלירן                │         each row row-reverse
//   │                          ⚽ 5 × 5                         │
//   │                          🍃 סינטטי                        │
//   │                                                          │
//   │  6/15 שחקנים  👕                          [join / leave]  │  BOTTOM row-reverse
//   └──────────────────────────────────────────────────────────┘
//
// Hard rules embedded in styles:
//   • card padding 16, gap 8
//   • info block alignItems:'flex-end' so it hugs the right edge
//   • info row flexDirection:'row-reverse', justifyContent:'flex-start'
//     ⇒ icon is RIGHTMOST regardless of I18nManager.forceRTL state
//   • icon spacing via marginLeft:6 (RTL: that's the gap to the text)
//   • text textAlign:'right' explicit on every Text
//   • compact line height (fontSize 13 / lineHeight 18) so 4 info rows
//     keep total card height ≈ 150dp.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Card } from './Card';
import { Badge } from './Badge';
import { PlayerIdentity } from './PlayerIdentity';
import { Game, GameFormat, FieldType, UserId } from '@/types';
import { colors, radius, shadows, spacing } from '@/theme';
import { he } from '@/i18n/he';
import { useGameStore } from '@/store/gameStore';

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
  // Capacity counts both registered users and per-game guests.
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

function formatDate(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} · ${hh}:${mn}`;
}

// ─── Component ─────────────────────────────────────────────────────────

export function MatchCard({ game, userId, onPrimary, busy }: Props) {
  const nav = useNavigation<any>();
  const status = statusForUser(game, userId);
  const cta = ctaForGame(game, status);
  const fmt = formatLabel(game.format);
  const occupancy = game.players.length + (game.guests?.length ?? 0);

  const openDetails = () => nav.navigate('MatchDetails', { gameId: game.id });

  return (
    <Pressable
      onPress={openDetails}
      style={({ pressed }) => [pressed && { transform: [{ scale: 0.985 }] }]}
    >
      <Card style={styles.card}>
        {/* TOP — title (RIGHT) + status badge (LEFT) */}
        <View style={styles.topRow}>
          <Text style={styles.title} numberOfLines={1}>
            {game.title}
          </Text>
          <StatusBadge status={status} game={game} />
        </View>

        {/* MIDDLE — two compact rows. Each row carries two atoms:
            primary info on the RIGHT (date / location), secondary
            descriptors on the LEFT (format / surface). Halves the
            card height vs. four full-width rows. */}
        <View style={styles.infoBlock}>
          <View style={styles.infoLine}>
            <InfoRow icon="calendar-outline" text={formatDate(game.startsAt)} />
            {fmt ? <InfoRow icon="football-outline" text={fmt} /> : <View />}
          </View>
          <View style={styles.infoLine}>
            <InfoRow icon="location-outline" text={game.fieldName} />
            {game.fieldType ? (
              <InfoRow
                icon="leaf-outline"
                text={fieldTypeLabel(game.fieldType)}
              />
            ) : (
              <View />
            )}
          </View>
        </View>

        {/* BOTTOM — players (RIGHT) + action (LEFT) */}
        <View style={styles.bottomRow}>
          <View style={styles.playersWrap}>
            <Ionicons
              name="shirt-outline"
              size={14}
              color={colors.textMuted}
              style={styles.shirtIcon}
            />
            <Text style={styles.playersCount}>
              {he.matchCardPlayersOf(occupancy, game.maxPlayers)}
            </Text>
          </View>
          <ActionButton cta={cta} busy={busy} onPress={() => onPrimary(cta)} />
        </View>
      </Card>
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
  // View + flex layout, content-sized children:
  //   • forceRTL flips `flexDirection: 'row'` → first child renders RIGHT
  //   • Icon is the first child → glues to RIGHT edge
  //   • Text follows, content-sized → glues immediately LEFT of icon
  //   • NO `flex:1` on text — that was the bug. With flex:1 the Text
  //     View expanded all the way to the LEFT edge of the row, and
  //     its inner alignment was unpredictable for mixed Hebrew/digits.
  return (
    <View style={styles.infoRow}>
      <Ionicons
        name={icon}
        size={13}
        color={colors.textMuted}
        style={styles.infoIcon}
      />
      <Text style={styles.infoText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function StatusBadge({
  status,
  game,
}: {
  status: ReturnType<typeof statusForUser>;
  game: Game;
}) {
  if (status === 'joined')
    return <Badge label={he.matchStatusJoined} tone="primary" size="sm" />;
  if (status === 'waitlist')
    return <Badge label={he.matchStatusWaitlist} tone="warning" size="sm" />;
  if (status === 'pending')
    return <Badge label={he.matchStatusPending} tone="neutral" size="sm" />;
  const occupancy = game.players.length + (game.guests?.length ?? 0);
  if (occupancy >= game.maxPlayers)
    return <Badge label={he.matchStatusFull} tone="neutral" size="sm" />;
  return <Badge label={he.matchStatusOpen} tone="primary" size="sm" />;
}

function ActionButton({
  cta,
  busy,
  onPress,
}: {
  cta: MatchCardCta;
  busy?: boolean;
  onPress: () => void;
}) {
  if (cta === 'none') return null;

  // Cancel / leave actions are intentionally NOT exposed on the
  // list card — they live only on the MatchDetails sticky CTA. This
  // keeps the list focused on the "join" path; users open the detail
  // screen to cancel, where the consequence is more visible.
  if (cta === 'cancel' || cta === 'leaveWaitlist') return null;

  if (cta === 'pending') {
    return <Text style={styles.pendingHint}>{he.matchStatusPending}</Text>;
  }

  // Join / waitlist — green pill, compact.
  const label = cta === 'waitlist' ? he.matchCardWaitlist : he.matchCardJoin;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      hitSlop={4}
      style={({ pressed }) => [
        styles.joinPill,
        (pressed || busy) && { opacity: 0.85 },
      ]}
    >
      <Text style={styles.joinLabel}>{label}</Text>
    </Pressable>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },

  // TOP — title pinned to the RIGHT corner of the card, status badge
  // pinned to the LEFT corner. `space-between` does the work; we keep
  // title content-sized via `flexShrink:1` so a long match name
  // truncates instead of pushing the badge off-screen.
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
  },

  // INFO — two rows × two atoms each.
  //   • `infoLine` is a full-width flex row with `space-between`,
  //     pushing one atom to the RIGHT and one to the LEFT corner.
  //   • Each `infoRow` atom is content-sized — icon + text glued
  //     together in their own little RTL-aware box.
  infoBlock: {
    width: '100%',
    gap: 2,
  },
  infoLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  infoIcon: {
    // `marginEnd` is RTL-aware: under forceRTL it resolves to the
    // icon's physical LEFT side — exactly where we want the gap to
    // the text. Plain `marginLeft` gets flipped to the right side
    // (towards the card edge) by `swapLeftAndRightInRTL`, leaving
    // no visible gap to the text.
    marginEnd: 8,
  },
  infoText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },

  // BOTTOM — players (RIGHT) + action (LEFT).
  // Same gotcha as topRow: under forceRTL we need plain `row` so the
  // first JSX child renders to the right edge. `space-between` then
  // pushes the second child (action) to the left.
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: 4,
  },
  playersWrap: {
    // forceRTL flips `flexDirection:'row'` to RTL flow, so the first
    // JSX child (shirt icon) ends up at the row's RIGHT edge and the
    // count text falls to its LEFT.
    flexDirection: 'row',
    alignItems: 'center',
  },
  shirtIcon: {
    marginEnd: 6,
  },
  playersCount: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },

  // Join CTA — green pill, compact.
  joinPill: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },

  pendingHint: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
});
