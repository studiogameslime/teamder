// MatchParticipantsSection — header + tappable list of registered
// players. Replaces both the old preview (jersey-only avatars) and
// the old full inline list. Each row uses the actual player jersey
// (not a generic avatar circle) so the visual matches the rest of
// the app's jersey-as-identity language.
//
// Header layout:
//   רשימת משתתפים (X/Y)                                  הצג הכל ↤
//
// Row layout:
//   [Shirt]  Name + small role badge                  Status badge
//
// Tap on any row → PlayerCard. Tap "הצג הכל" → MatchPlayers.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import type { ArrivalStatus } from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export interface ParticipantEntry {
  id: string;
  name: string;
  avatarId?: string;
  photoUrl?: string;
  isAdmin: boolean;
  /** Did this user create the game? Drives the "ארגון" role
   *  badge — distinct from a community admin (which would render
   *  as "מנהל" if we ever surface that here). */
  isOrganizer?: boolean;
  /** Per-game arrival, if recorded. */
  arrival?: ArrivalStatus;
  /** Bucket — drives the trailing status badge. */
  bucket: 'players' | 'waitlist' | 'pending' | 'guest';
  /** Self-marked "אני מביא כדור". Surfaced as a small football
   *  icon on the trailing (visual-left under RTL) edge of the row. */
  isBringingBall?: boolean;
  /** Flag the auth user's own row. When true, the ball indicator
   *  becomes a tappable toggle so the user can flip their own
   *  bring-ball state inline (no extra section needed below the
   *  fold). Other rows render the read-only badge as before. */
  isCurrentUser?: boolean;
}

interface Props {
  total: number;
  capacity: number;
  /** Trim to this many rows on the main screen — caller decides. */
  maxRows?: number;
  members: ParticipantEntry[];
  onSeeAll: () => void;
  onPressMember: (uid: string) => void;
  /** Fires when the auth user taps the inline ball toggle on their
   *  own row. Caller is expected to optimistically flip local state
   *  and persist the change. */
  onToggleBringingBall?: (uid: string) => void;
  /** Admin-only entry to the add-guest flow. When provided, a small
   *  text link renders next to "הצג הכל" in the header. Hidden when
   *  omitted — non-admins / terminal games shouldn't see it. */
  onAddGuest?: () => void;
  /** True when the current viewer is a game/community admin. Drives
   *  the inline ball-bringer toggle on guest rows (guests can't sign
   *  in to toggle themselves, so the admin manages it on their
   *  behalf). Read-only otherwise. */
  isAdminViewer?: boolean;
}

export function MatchParticipantsSection({
  total,
  capacity,
  maxRows = 6,
  members,
  onSeeAll,
  onPressMember,
  onToggleBringingBall,
  onAddGuest,
  isAdminViewer = false,
}: Props) {
  const visible = members.slice(0, maxRows);
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>
          {he.matchParticipantsTitle}{' '}
          <Text style={styles.count}>
            ({total}/{capacity})
          </Text>
        </Text>
        <View style={styles.headerActions}>
          {onAddGuest ? (
            <Pressable onPress={onAddGuest} hitSlop={8}>
              <Text style={styles.seeAll}>{he.guestAddButton}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onSeeAll} hitSlop={8}>
            <Text style={styles.seeAll}>{he.achievementsSeeAll}</Text>
          </Pressable>
        </View>
      </View>
      {visible.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.empty}>{he.matchPlayersEmpty}</Text>
        </Card>
      ) : (
        <Card style={styles.listCard}>
          {visible.map((m, i) => (
            <ParticipantRow
              key={m.id}
              entry={m}
              showDivider={i > 0}
              onPress={() => onPressMember(m.id)}
              onToggleBringingBall={onToggleBringingBall}
              isAdminViewer={isAdminViewer}
            />
          ))}
        </Card>
      )}
    </View>
  );
}

function ParticipantRow({
  entry,
  showDivider,
  onPress,
  onToggleBringingBall,
  isAdminViewer,
}: {
  entry: ParticipantEntry;
  showDivider: boolean;
  onPress: () => void;
  onToggleBringingBall?: (uid: string) => void;
  isAdminViewer?: boolean;
}) {
  // Ball indicator. Toggle is enabled for:
  //   • The auth user's own row (any registered player toggles
  //     their own bring-ball state inline).
  //   • Guest rows when viewer is an admin — guests can't sign in,
  //     so the admin manages their state on their behalf.
  // Other rows render a read-only badge ONLY when they're carrying
  // a ball.
  const isMine =
    entry.isCurrentUser === true &&
    entry.bucket === 'players' &&
    !!onToggleBringingBall;
  const canToggleGuest =
    entry.bucket === 'guest' &&
    !!isAdminViewer &&
    !!onToggleBringingBall;
  const canToggle = isMine || canToggleGuest;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        showDivider && styles.rowDivider,
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
      accessibilityRole="button"
      accessibilityLabel={entry.name}
    >
      {/* Real avatar — uploaded photo first, then chosen avatarId,
          then deterministic colourful fallback (UserAvatar handles
          the priority chain + fallback). Replaces an earlier static
          "person silhouette" Ionicons placeholder that ignored the
          user's actual identity even when avatarId/photoUrl were
          available. */}
      <UserAvatar
        user={{
          id: entry.id,
          name: entry.name,
          avatarId: entry.avatarId,
          photoUrl: entry.photoUrl,
        }}
        size={44}
      />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {entry.name}
        </Text>
        {entry.isOrganizer ? (
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>
              {he.matchParticipantRoleOrganizer}
            </Text>
          </View>
        ) : null}
        {entry.bucket === 'guest' ? (
          <View style={[styles.roleBadge, styles.guestBadge]}>
            <Text style={[styles.roleBadgeText, styles.guestBadgeText]}>
              {he.matchPlayersGuestTag}
            </Text>
          </View>
        ) : null}
      </View>
      {canToggle ? (
        <Pressable
          onPress={(e) => {
            // Inner press shouldn't bubble to the row's navigate-to-
            // PlayerCard handler. RN doesn't auto-stop bubbling for
            // Pressable so call the helper explicitly.
            e.stopPropagation?.();
            onToggleBringingBall?.(entry.id);
          }}
          hitSlop={8}
          style={({ pressed }) => [
            styles.ballBadge,
            !entry.isBringingBall && styles.ballBadgeInactive,
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={he.matchBringBallToggle}
          accessibilityState={{ selected: !!entry.isBringingBall }}
        >
          <Ionicons
            name={entry.isBringingBall ? 'football' : 'football-outline'}
            size={14}
            color={entry.isBringingBall ? '#1D4ED8' : colors.textMuted}
          />
        </Pressable>
      ) : entry.isBringingBall ? (
        <View style={styles.ballBadge}>
          <Ionicons name="football" size={14} color="#1D4ED8" />
        </View>
      ) : null}
      {entry.bucket === 'guest' ? null : (
        <StatusBadge bucket={entry.bucket} arrival={entry.arrival} />
      )}
      <Ionicons name="chevron-back" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

function StatusBadge({
  bucket,
  arrival,
}: {
  bucket: 'players' | 'waitlist' | 'pending' | 'guest';
  arrival?: ArrivalStatus;
}) {
  // Guests are tagged inline next to their name (mirroring the
  // "מנהל" badge), so we never render a trailing guest tag here.
  if (bucket === 'guest') return null;
  // Arrival overrides bucket when present (post-game accuracy).
  if (arrival === 'arrived') {
    return (
      <Tag
        label={he.matchParticipantStatusArrived}
        tone="success"
        icon="checkmark-circle"
      />
    );
  }
  if (arrival === 'late') {
    return <Tag label={he.matchPlayersLateTag} tone="warning" />;
  }
  if (arrival === 'no_show') {
    return <Tag label={he.matchPlayersNoShowTag} tone="danger" />;
  }
  if (bucket === 'waitlist') {
    return <Tag label={he.matchPlayersWaitlistTag} tone="muted" />;
  }
  if (bucket === 'pending') {
    return <Tag label={he.matchPlayersPendingTag} tone="muted" />;
  }
  // Registered players (default 'players' bucket) — the row already
  // implies "coming", so the green "מגיע" tag was visual noise on
  // every line. Only render a badge when there's something the row
  // alone doesn't convey (waitlist/pending/late/no-show/arrived).
  return null;
}

function Tag({
  label,
  tone,
  icon,
}: {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'muted';
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const palette =
    tone === 'success'
      ? { bg: '#DCFCE7', fg: '#166534' }
      : tone === 'warning'
        ? { bg: '#FEF3C7', fg: '#B45309' }
        : tone === 'danger'
          ? { bg: '#FEE2E2', fg: '#B91C1C' }
          : { bg: colors.surfaceMuted, fg: colors.textMuted };
  return (
    <View style={[styles.tag, { backgroundColor: palette.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={palette.fg} /> : null}
      <Text style={[styles.tagText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  title: {
    ...typography.body,
    color: '#0F172A',
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  count: { color: '#64748B', fontWeight: '500' },
  // Trailing-edge action group. Sits between the title and the row
  // edge with a small gap so multiple text-link CTAs (e.g. "הוסף
  // אורח" + "הצג הכל") don't crowd each other when both are visible.
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  seeAll: {
    ...typography.caption,
    color: '#3B82F6',
    fontWeight: '700',
  },
  listCard: {
    padding: 0,
    overflow: 'hidden',
    borderRadius: 18,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  emptyCard: {
    padding: spacing.xl,
    alignItems: 'center',
    borderRadius: 18,
  },
  empty: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  // Taller rows (was 10 vertical → 14) with more horizontal
  // breathing room. Premium-feeling list rather than a tight
  // settings table.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(15,23,42,0.06)',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  name: {
    ...typography.body,
    color: '#0F172A',
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#DBEAFE',
  },
  roleBadgeText: {
    fontWeight: '700',
    fontSize: 11,
    color: '#1D4ED8',
  },
  // Guest variant — same shape as the organizer badge, neutral tint
  // so the visual hierarchy reads "organizer > guest > player".
  guestBadge: {
    backgroundColor: colors.surfaceMuted,
  },
  guestBadgeText: {
    color: colors.textMuted,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  ballBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#DBEAFE',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // "Off" state of the inline ball toggle on the auth user's own
  // row — neutral surface + dashed-feeling outline so the toggle
  // reads as "tap to flip" rather than a filled badge.
  ballBadgeInactive: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.divider,
  },
});
