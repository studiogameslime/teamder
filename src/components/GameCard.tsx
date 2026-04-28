// GameCard — single game row used in all three sections of the Games tab.
//
// Layout (top → bottom):
//   1. Header: title (community name), public/private chip, format chip,
//      skill chip
//   2. Date / time
//   3. Location (pitch name)
//   4. Cancel deadline (only when configured)
//   5. Player count + waitlist count + status pill (joined/waitlist/pending)
//   6. Status info line — one of:
//        - "חסרים עוד X שחקנים"
//        - "המשחק מלא — ניתן להצטרף להמתנה"
//        (suppressed when the user is already in the game and the line
//         would just be noise)
//   7. Compact player avatars row (first 6 + "+N", with ⚽ overlay on the
//      ball-holder avatar)
//   8. CTA button — derived from user status × game rules. ONE action
//      per card; never both join and waitlist, etc.

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card } from './Card';
import { Button } from './Button';
import { PlayerIdentity } from './PlayerIdentity';
import { Game, GameFormat, SkillLevel, UserId } from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useGameStore } from '@/store/gameStore';

export type GameCardCta =
  | 'join'
  | 'requestJoin'
  | 'joinWaitlist'
  | 'cancel'
  | 'leaveWaitlist'
  | 'none';

export type GameCardStatus = 'joined' | 'waitlist' | 'pending' | 'none';

const SKILL_LABEL: Record<SkillLevel, string> = {
  beginner: he.skillBeginner,
  intermediate: he.skillIntermediate,
  advanced: he.skillAdvanced,
  mixed: he.skillMixed,
};

export function statusForUser(g: Game, userId: UserId): GameCardStatus {
  if (g.players.includes(userId)) return 'joined';
  if (g.waitlist.includes(userId)) return 'waitlist';
  if ((g.pending ?? []).includes(userId)) return 'pending';
  return 'none';
}

export function ctaForGame(g: Game, status: GameCardStatus): GameCardCta {
  if (status === 'joined') return 'cancel';
  if (status === 'waitlist') return 'leaveWaitlist';
  if (status === 'pending') return 'none';
  // status === 'none'
  if (g.requiresApproval) return 'requestJoin';
  if (g.players.length < g.maxPlayers) return 'join';
  return 'joinWaitlist';
}

function fieldTypeLabel(f: import('@/types').FieldType): string {
  if (f === 'asphalt') return he.fieldTypeAsphalt;
  if (f === 'synthetic') return he.fieldTypeSynthetic;
  return he.fieldTypeGrass;
}

function formatLabel(f: GameFormat | undefined): string | null {
  if (f === '5v5') return he.gameFormat5;
  if (f === '6v6') return he.gameFormat6;
  if (f === '7v7') return he.gameFormat7;
  return null;
}

function formatDateTime(ms: number): string {
  // Hebrew weekday + dd/MM at HH:mm. Cheap & locale-independent.
  const d = new Date(ms);
  const days = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const day = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `יום ${day} · ${dd}/${mm} · ${hh}:${mi}`;
}

interface Props {
  game: Game;
  userId: UserId;
  onPrimary: (cta: GameCardCta) => void;
  busy?: boolean;
  /**
   * When true, the card surfaces a small "Manage Game" link in the
   * header (organizer / community admin only — caller decides). Tapping
   * it calls `onManage`. Kept off the primary CTA path so the join
   * flow stays clean.
   */
  isAdmin?: boolean;
  onManage?: () => void;
}

export function GameCard({
  game,
  userId,
  onPrimary,
  busy,
  isAdmin,
  onManage,
}: Props) {
  const status = statusForUser(game, userId);
  const cta = ctaForGame(game, status);
  const fmt = formatLabel(game.format);
  const skill = game.skillLevel ? SKILL_LABEL[game.skillLevel] : null;

  const open = Math.max(0, game.maxPlayers - game.players.length);
  const isFull = open === 0;
  // The "info" line below the counts row tells the user what the game's
  // current capacity status MEANS for them. Hide it when the user is
  // already in the players list — they don't need a "missing players"
  // nudge for a game they're playing.
  const showMissing = !isFull && status !== 'joined';
  const showFull = isFull && status === 'none' && !game.requiresApproval;

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={1}>
          {game.title}
        </Text>
        <View style={styles.headerChips}>
          <PublicityChip isPublic={!!game.isPublic} />
          {fmt ? (
            <View style={styles.formatPill}>
              <Text style={styles.formatPillText}>{fmt}</Text>
            </View>
          ) : null}
          {skill ? (
            <View style={styles.skillPill}>
              <Text style={styles.skillPillText}>{skill}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.metaRow}>
        <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
        <Text style={styles.metaText}>{formatDateTime(game.startsAt)}</Text>
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="location-outline" size={14} color={colors.textMuted} />
        <Text style={styles.metaText} numberOfLines={1}>
          {game.fieldName}
        </Text>
      </View>
      {game.fieldType || game.matchDurationMinutes ? (
        <View style={styles.metaRow}>
          <Ionicons name="football-outline" size={14} color={colors.textMuted} />
          <Text style={styles.metaText}>
            {[
              game.fieldType ? fieldTypeLabel(game.fieldType) : null,
              game.matchDurationMinutes
                ? `${game.matchDurationMinutes} ${he.minutesShort}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      ) : null}
      {game.cancelDeadlineHours ? (
        <View style={styles.metaRow}>
          <Ionicons name="alert-circle-outline" size={14} color={colors.textMuted} />
          <Text style={styles.metaText}>
            {he.gameCardCancelDeadline(game.cancelDeadlineHours)}
          </Text>
        </View>
      ) : null}

      <View style={styles.countsRow}>
        <View style={styles.metaRow}>
          <Ionicons name="people-outline" size={14} color={colors.primary} />
          <Text style={[styles.metaText, { color: colors.primary }]}>
            {he.gameCardPlayersOf(game.players.length, game.maxPlayers)}
          </Text>
        </View>
        {game.waitlist.length > 0 ? (
          <Text style={styles.waitlistText}>
            {he.gameCardWaitlist(game.waitlist.length)}
          </Text>
        ) : null}
        <StatusPill status={status} />
      </View>

      {showMissing ? (
        <Text style={styles.missingText}>{he.gameCardMissing(open)}</Text>
      ) : null}
      {showFull ? <Text style={styles.fullText}>{he.gameCardFull}</Text> : null}

      <PlayersStrip game={game} />

      {cta !== 'none' ? (
        <View style={{ marginTop: spacing.sm }}>
          <PrimaryButton
            cta={cta}
            busy={busy}
            onPress={() => onPrimary(cta)}
          />
        </View>
      ) : null}

      {isAdmin && onManage ? (
        <Pressable
          onPress={onManage}
          style={({ pressed }) => [
            styles.manageLink,
            pressed && { opacity: 0.7 },
          ]}
          accessibilityLabel="manage-game"
        >
          <Ionicons name="settings-outline" size={14} color={colors.primary} />
          <Text style={styles.manageLinkText}>{he.liveManageGame}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function PublicityChip({ isPublic }: { isPublic: boolean }) {
  return (
    <View
      style={[
        styles.publicChip,
        isPublic
          ? { backgroundColor: colors.primaryLight }
          : { backgroundColor: colors.surfaceMuted },
      ]}
    >
      <Ionicons
        name={isPublic ? 'globe-outline' : 'lock-closed-outline'}
        size={11}
        color={isPublic ? colors.primary : colors.textMuted}
      />
      <Text
        style={[
          styles.publicChipText,
          { color: isPublic ? colors.primary : colors.textMuted },
        ]}
      >
        {isPublic ? he.gameCardPublic : he.gameCardPrivate}
      </Text>
    </View>
  );
}

/**
 * Compact horizontal row of player avatars. We pull the avatar/name from
 * `gameStore.players` (the in-memory roster the store hydrates as games
 * load); falling back to a colored initial if the user isn't loaded yet.
 * Caps at 6 visible — the rest collapse into a "+N" tile.
 */
function PlayersStrip({ game }: { game: Game }) {
  const playersMap = useGameStore((s) => s.players);
  const nav = useNavigation<any>();
  if (game.players.length === 0) return null;
  const VISIBLE = 6;
  const head = game.players.slice(0, VISIBLE);
  const overflow = game.players.length - head.length;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.playersStrip}
      contentContainerStyle={styles.playersStripContent}
    >
      {head.map((uid) => {
        const p = playersMap[uid];
        const name = p?.displayName ?? uid;
        const isBallHolder = game.ballHolderUserId === uid;
        return (
          <View key={uid} style={styles.playerSlot}>
            <PlayerIdentity
              user={{ id: uid, name, jersey: p?.jersey }}
              size="sm"
              onPress={() =>
                nav.navigate('PlayerCard', {
                  userId: uid,
                  groupId: game.groupId,
                })
              }
            />
            {isBallHolder ? (
              <View style={styles.indicator}>
                <Text style={styles.indicatorText}>⚽</Text>
              </View>
            ) : null}
          </View>
        );
      })}
      {overflow > 0 ? (
        <View style={[styles.playerSlot, styles.overflowTile]}>
          <Text style={styles.overflowText}>
            {he.gameCardPlayersMore(overflow)}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function StatusPill({ status }: { status: GameCardStatus }) {
  if (status === 'joined') {
    return (
      <View style={[styles.statusPill, { backgroundColor: colors.primaryLight }]}>
        <Text style={[styles.statusPillText, { color: colors.primary }]}>
          {he.gameStatusJoined}
        </Text>
      </View>
    );
  }
  if (status === 'waitlist') {
    return (
      <View style={[styles.statusPill, { backgroundColor: '#FEF3C7' }]}>
        <Text style={[styles.statusPillText, { color: colors.warning }]}>
          {he.gameStatusWaitlist}
        </Text>
      </View>
    );
  }
  if (status === 'pending') {
    return (
      <View style={[styles.statusPill, { backgroundColor: colors.surfaceMuted }]}>
        <Text style={[styles.statusPillText, { color: colors.textMuted }]}>
          {he.gameStatusPending}
        </Text>
      </View>
    );
  }
  return null;
}

function PrimaryButton({
  cta,
  busy,
  onPress,
}: {
  cta: GameCardCta;
  busy?: boolean;
  onPress: () => void;
}) {
  const props: {
    title: string;
    variant: 'primary' | 'outline';
  } = (() => {
    switch (cta) {
      case 'join':
        return { title: he.gameCardJoin, variant: 'primary' as const };
      case 'requestJoin':
        return { title: he.gameCardRequestJoin, variant: 'primary' as const };
      case 'joinWaitlist':
        return { title: he.gameCardJoinWaitlist, variant: 'outline' as const };
      case 'cancel':
        return { title: he.gameCardCancel, variant: 'outline' as const };
      case 'leaveWaitlist':
        return { title: he.gameCardLeaveWaitlist, variant: 'outline' as const };
      default:
        return { title: '', variant: 'outline' as const };
    }
  })();
  return (
    <Button
      title={props.title}
      variant={props.variant}
      size="sm"
      onPress={onPress}
      loading={busy}
      fullWidth
    />
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.xs },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerChips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  title: { ...typography.bodyBold, color: colors.text, flex: 1 },

  formatPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  formatPillText: { ...typography.caption, color: colors.text, fontWeight: '600' },

  skillPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: '#EEF2FF',
  },
  skillPillText: { ...typography.caption, color: '#4338CA', fontWeight: '600' },

  publicChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  publicChipText: { ...typography.caption, fontWeight: '600' },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  metaText: { ...typography.caption, color: colors.textMuted },

  countsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
    flexWrap: 'wrap',
  },
  waitlistText: { ...typography.caption, color: colors.warning, fontWeight: '600' },

  missingText: {
    ...typography.caption,
    color: colors.primary,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  fullText: {
    ...typography.caption,
    color: colors.warning,
    marginTop: spacing.xs,
    textAlign: 'right',
    fontWeight: '600',
  },

  playersStrip: {
    marginTop: spacing.sm,
  },
  playersStripContent: {
    gap: spacing.xs,
    paddingHorizontal: 2,
  },
  playerSlot: {
    width: 36,
    height: 36,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    bottom: -2,
    end: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  indicatorText: { fontSize: 11 },

  overflowTile: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },

  statusPill: {
    marginStart: 'auto',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  statusPillText: { ...typography.caption, fontWeight: '600' },

  manageLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  manageLinkText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
  },
});
