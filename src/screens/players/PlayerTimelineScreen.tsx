// PlayerTimelineScreen — admin-only, per-community timeline of a player's
// yellow/red cards + ball/jerseys handoffs. Reached from the community player
// menu ("ציר זמן"). Cards show their detail + state (active/expired/revoked);
// an admin can long-press a card to revoke it (kept, marked "בוטל").

import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { PressableScale } from '@/components/PressableScale';
import { successHaptic } from '@/utils/haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { appAlert } from '@/components/AppDialog';
import { toast } from '@/components/Toast';
import { communityEventsService } from '@/services';
import { groupService } from '@/services';
import { userService } from '@/services';
import { logError } from '@/services/errorLog';
import { useUserStore } from '@/store/userStore';
import { cardState, effectiveExpiry, DAY_MS } from '@/utils/cardState';
import { formatTime, formatDayDate } from '@/utils/format';
import { RefereeCard, CARD_YELLOW, CARD_RED } from '@/components/community/CardCountBadges';
import { colors, spacing, typography, radius, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { CommunityPlayerEvent, Group } from '@/types';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

type Nav = NativeStackNavigationProp<CommunitiesStackParamList, 'PlayerTimeline'>;
type Params = RouteProp<CommunitiesStackParamList, 'PlayerTimeline'>;

// A timeline entry is either a real discipline/equipment event, or a synthetic
// membership milestone derived from the group (join / admin-promotion dates).
type TLEntry =
  | { src: 'event'; ev: CommunityPlayerEvent }
  | { src: 'membership'; mkind: 'joined' | 'admin'; at: number };
const entryAt = (e: TLEntry): number => (e.src === 'event' ? e.ev.at : e.at);
type TimelineItem =
  | { kind: 'header'; ts: number }
  | { kind: 'entry'; entry: TLEntry };

const EVENT_META: Record<
  CommunityPlayerEvent['type'],
  { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }
> = {
  yellow: { icon: 'card', color: colors.warning, label: he.timelineEventYellow },
  red: { icon: 'card', color: colors.danger, label: he.timelineEventRed },
  ball: { icon: 'football', color: colors.primary, label: he.timelineEventBall },
  jerseys: { icon: 'shirt', color: colors.info ?? colors.primary, label: he.timelineEventJerseys },
};

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (same(d, today)) return `היום ${time}`;
  if (same(d, y)) return `אתמול ${time}`;
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

export function PlayerTimelineScreen() {
  const nav = useNavigation<Nav>();
  const { userId, groupId, name } = useRoute<Params>().params;
  const me = useUserStore((s) => s.currentUser);
  const [group, setGroup] = useState<Group | null>(null);
  const [events, setEvents] = useState<CommunityPlayerEvent[] | null>(null);
  const [displayName, setDisplayName] = useState(name ?? '');
  // Name of whoever approved this member's join (from the join-request audit).
  const [approverName, setApproverName] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [g, evs] = await Promise.all([
        groupService.get(groupId),
        communityEventsService.getPlayerTimeline(groupId, userId),
      ]);
      setGroup(g);
      setEvents(evs);
      if (!name) {
        const u = await userService.getUserById(userId).catch(() => null);
        if (u) setDisplayName(u.name ?? '');
      }
      // Resolve who approved the join → shown on the "joined" milestone.
      groupService
        .getMemberApprover(groupId, userId)
        .then(async (a) => {
          if (!a) return setApproverName(null);
          const u = await userService.getUserById(a.by).catch(() => null);
          setApproverName(u?.name ?? null);
        })
        .catch(() => setApproverName(null));
    } catch (err) {
      logError('playerTimelineLoad', err, { groupId, userId });
      setEvents([]);
    }
  }, [groupId, userId, name]);

  // Reload on focus (not just mount) so returning to the timeline re-reads
  // events AND re-stamps `now` — a card that aged past its validity while the
  // admin was elsewhere then reads "פג תוקף" instead of a stale "פעיל".
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const isAdmin = !!me && !!group && group.adminIds.includes(me.id);
  const now = useMemo(() => Date.now(), [events]);

  // When the club's cards feature is OFF, the timeline is equipment-only
  // (ball/jerseys) — no cards are shown at all, matching the disabled state
  // that also hides the issue-card menu items + roster badges.
  const cardsOn = group?.cardsEnabled === true;
  const visibleEvents = useMemo(
    () =>
      (events ?? []).filter(
        (e) => cardsOn || e.type === 'ball' || e.type === 'jerseys',
      ),
    [events, cardsOn],
  );

  // Merge real events with the synthetic membership milestones (join / admin
  // dates from the group), sort newest-first, then interleave "יום … " day
  // headers so the spine breaks into day groups.
  const listData = useMemo<TimelineItem[]>(() => {
    const entries: TLEntry[] = visibleEvents.map((ev) => ({ src: 'event', ev }));
    const joinedTs = group?.joinedAt?.[userId];
    if (typeof joinedTs === 'number' && joinedTs > 0) {
      entries.push({ src: 'membership', mkind: 'joined', at: joinedTs });
    }
    const adminTs = group?.adminSince?.[userId];
    if (typeof adminTs === 'number' && adminTs > 0) {
      entries.push({ src: 'membership', mkind: 'admin', at: adminTs });
    }
    entries.sort((a, b) => entryAt(b) - entryAt(a));

    const out: TimelineItem[] = [];
    let lastDay = '';
    for (const entry of entries) {
      const at = entryAt(entry);
      const d = new Date(at);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (key !== lastDay) {
        out.push({ kind: 'header', ts: at });
        lastDay = key;
      }
      out.push({ kind: 'entry', entry });
    }
    return out;
  }, [visibleEvents, group?.joinedAt, group?.adminSince, userId]);

  const validityFor = (type: CommunityPlayerEvent['type']) =>
    type === 'red' ? group?.redCardValidityDays : type === 'yellow' ? group?.yellowCardValidityDays : null;

  const onRevoke = (ev: CommunityPlayerEvent) => {
    if (!isAdmin || !me || ev.revoked) return;
    appAlert(he.cardRevokeConfirmTitle, he.cardRevokeConfirmBody, [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.cardRevoke,
        style: 'destructive',
        onPress: async () => {
          try {
            await communityEventsService.revokeCard(ev.id, me.id);
            successHaptic();
            toast.success(he.cardRevokedToast);
            reload();
          } catch (err) {
            logError('revokeCardAction', err, { id: ev.id });
          }
        },
      },
    ]);
  };

  if (events === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={he.timelineTitle(displayName || '')} />
        <View style={styles.center}><SoccerBallLoader /></View>
      </SafeAreaView>
    );
  }

  // One timeline event → a rail node (right, on the spine) + a card (left).
  const renderEvent = (ev: CommunityPlayerEvent, isLast: boolean) => {
    const meta = EVENT_META[ev.type];
    // Ball/jerseys marks cleared via "נהל ציוד" read "החזיר …" instead of the
    // default "לקח … הביתה".
    const title =
      ev.returned && ev.type === 'ball'
        ? he.timelineEventBallReturned
        : ev.returned && ev.type === 'jerseys'
          ? he.timelineEventJerseysReturned
          : meta.label;
    const isCard = ev.type === 'yellow' || ev.type === 'red';
    const state = isCard ? cardState(ev, validityFor(ev.type), now) : 'active';
    const stateLabel =
      state === 'revoked' ? he.cardStateRevoked : state === 'expired' ? he.cardStateExpired : null;
    const dimmed = state !== 'active';
    const accent = isCard ? (ev.type === 'red' ? CARD_RED : CARD_YELLOW) : meta.color;
    // Validity line — only when the card actually has an expiry (club set a
    // validity in days). Active → "בתוקף עד … · עוד N ימים"; expired → "פג …".
    const exp = isCard ? effectiveExpiry(ev, validityFor(ev.type)) : null;
    let validityText: string | null = null;
    if (isCard && exp !== null && !ev.revoked) {
      if (state === 'active') {
        // Calendar-day difference (not raw ms/ceil) so the expiry DAY reads
        // "מסתיים היום", the day before "עוד יום", etc. — matching the date shown.
        const dayStart = (t: number) => {
          const d = new Date(t);
          d.setHours(0, 0, 0, 0);
          return d.getTime();
        };
        const daysLeft = Math.round((dayStart(exp) - dayStart(now)) / DAY_MS);
        validityText = `${he.cardValidUntil(fmtDate(exp))} · ${he.cardDaysLeft(daysLeft)}`;
      } else if (state === 'expired') {
        validityText = he.cardExpiredOn(fmtDate(exp));
      }
    }
    const canRevoke = isCard && isAdmin && !ev.revoked;
    // Explicit "בטל כרטיס" button on ACTIVE cards — long-press wasn't
    // discoverable (user report). Long-press stays as a shortcut.
    const showRevokeBtn = canRevoke && state === 'active';
    return (
      <View style={styles.eventRow}>
        {/* Spine rail — the vertical line + the colored node + time. First
            child so it lands on the visual RIGHT under forceRTL. */}
        <View style={styles.rail}>
          <View style={[styles.railLine, isLast && styles.railLineLast]} />
          <View style={styles.node}>
            {isCard ? (
              <RefereeCard color={accent} w={18} h={24} radius={4} struck={dimmed} />
            ) : (
              <View style={[styles.nodeCircle, { borderColor: accent, backgroundColor: accent + '1A' }]}>
                <Ionicons name={meta.icon} size={15} color={accent} />
              </View>
            )}
          </View>
          <Text style={styles.railTime}>{formatTime(ev.at)}</Text>
        </View>

        {/* Card — full remaining width on the LEFT, colored accent on its
            rail-side edge. */}
        <PressableScale
          onLongPress={canRevoke ? () => onRevoke(ev) : undefined}
          delayLongPress={400}
          style={styles.card}
        >
          <View style={[styles.cardAccent, { backgroundColor: accent, opacity: dimmed ? 0.45 : 1 }]} />
          <View style={styles.cardBody}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, dimmed && styles.strike]} numberOfLines={1}>
                {title}
              </Text>
              {stateLabel ? (
                <View style={[styles.tag, state === 'revoked' ? styles.tagRevoked : styles.tagExpired]}>
                  <Text style={styles.tagText}>{stateLabel}</Text>
                </View>
              ) : null}
            </View>
            {ev.detail ? <Text style={styles.detail}>{ev.detail}</Text> : null}
            {validityText ? (
              <View style={styles.validityRow}>
                <Ionicons
                  name="hourglass-outline"
                  size={13}
                  color={state === 'expired' ? colors.textMuted : colors.primary}
                />
                <Text
                  style={[styles.validityText, state === 'expired' && { color: colors.textMuted }]}
                  numberOfLines={1}
                >
                  {validityText}
                </Text>
              </View>
            ) : null}
            {showRevokeBtn ? (
              <Pressable
                onPress={() => onRevoke(ev)}
                hitSlop={6}
                style={({ pressed }) => [styles.revokeBtn, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel={he.cardRevoke}
              >
                <Ionicons name="close-circle-outline" size={16} color={colors.danger} />
                <Text style={styles.revokeBtnText}>{he.cardRevoke}</Text>
              </Pressable>
            ) : null}
          </View>
        </PressableScale>
      </View>
    );
  };

  // Synthetic membership milestone (join / admin promotion) → same spine +
  // card shape, primary-tinted, no detail/validity/revoke.
  const renderMembership = (mkind: 'joined' | 'admin', at: number, isLast: boolean) => {
    const isAdminEvent = mkind === 'admin';
    const accent = colors.primary;
    return (
      <View style={styles.eventRow}>
        <View style={styles.rail}>
          <View style={[styles.railLine, isLast && styles.railLineLast]} />
          <View style={styles.node}>
            <View style={[styles.nodeCircle, { borderColor: accent, backgroundColor: accent + '1A' }]}>
              <Ionicons name={isAdminEvent ? 'shield-checkmark' : 'person-add'} size={15} color={accent} />
            </View>
          </View>
          <Text style={styles.railTime}>{formatTime(at)}</Text>
        </View>
        <View style={styles.card}>
          <View style={[styles.cardAccent, { backgroundColor: accent }]} />
          <View style={styles.cardBody}>
            <Text style={styles.title} numberOfLines={1}>
              {isAdminEvent ? he.timelineBecameAdmin : he.timelineJoinedCommunity}
            </Text>
            {!isAdminEvent && approverName ? (
              <Text style={styles.detail} numberOfLines={1}>
                {he.timelineApprovedBy(approverName)}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  const renderEntry = (entry: TLEntry, isLast: boolean) =>
    entry.src === 'membership'
      ? renderMembership(entry.mkind, entry.at, isLast)
      : renderEvent(entry.ev, isLast);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={he.timelineTitle(displayName || '')} />
      {listData.length === 0 ? (
        <EmptyState icon="time-outline" title={he.timelineEmpty} />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(it) =>
            it.kind === 'header'
              ? `h-${it.ts}`
              : it.entry.src === 'event'
                ? it.entry.ev.id
                : `m-${it.entry.mkind}`
          }
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) =>
            item.kind === 'header' ? (
              <DayHeader ts={item.ts} />
            ) : (
              renderEntry(item.entry, index === listData.length - 1)
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

// Day-group separator on the spine — a centered "יום … " pill with a hairline
// rule on each side.
function DayHeader({ ts }: { ts: number }) {
  return (
    <View style={styles.dayHeader}>
      <View style={styles.dayRule} />
      <View style={styles.dayPill}>
        <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
        <Text style={styles.dayPillText}>
          {formatDayDate(ts, { day: 'long', withYear: true })}
        </Text>
      </View>
      <View style={styles.dayRule} />
    </View>
  );
}

const RAIL_W = 54;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  list: { paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  // ── Day header ──
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  dayRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
  dayPill: {
    // `row` under forceRTL puts the first child (calendar icon) on the visual
    // RIGHT (leading), matching the eventRow convention.
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  dayPillText: { ...typography.caption, color: colors.textMuted, fontWeight: '800' },
  // ── Event row = rail (right) + card (left) ──
  eventRow: {
    // `row` (NOT row-reverse): first child (rail) lands on the visual RIGHT
    // under forceRTL, so the spine runs down the right and cards extend left.
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  rail: { width: RAIL_W, alignItems: 'center', paddingTop: spacing.md },
  // Continuous vertical spine, drawn behind the node down the rail's center.
  railLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    // Centered in the RAIL_W-wide rail (physical `left`, unaffected by RTL).
    left: RAIL_W / 2 - 1,
    width: 2,
    backgroundColor: colors.divider,
  },
  // The last node has no line below it.
  railLineLast: { bottom: '50%' },
  node: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railTime: { ...typography.caption, color: colors.textMuted, fontWeight: '700', marginTop: 4 },
  card: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginStart: spacing.sm,
    marginBottom: spacing.md,
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  // Colored accent on the card's rail-side edge (first child → visual RIGHT).
  cardAccent: { width: 4, alignSelf: 'stretch' },
  cardBody: { flex: 1, minWidth: 0, padding: spacing.md },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // The state chip (בוטל / פג תוקף) wraps below the event label rather than
    // crushing it — same rule we use for names.
    flexWrap: 'wrap',
  },
  title: { ...typography.bodyBold, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN, flexShrink: 0, maxWidth: '100%' },
  strike: { color: colors.textMuted, textDecorationLine: 'line-through' },
  tag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  tagExpired: { backgroundColor: colors.surfaceMuted },
  tagRevoked: { backgroundColor: colors.danger + '22' },
  tagText: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  detail: { ...typography.body, color: colors.text, textAlign: RTL_LABEL_ALIGN, marginTop: 4 },
  // Validity ("בתוקף עד …") line — icon on the visual right under RTL ('row'
  // puts the first child on the right under forceRTL).
  validityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 4,
  },
  validityText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  // Explicit revoke affordance on active cards (replaces the hidden long-press
  // as the primary action).
  revokeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.danger + '55',
    backgroundColor: colors.danger + '11',
  },
  revokeBtnText: { ...typography.caption, color: colors.danger, fontWeight: '800' },
});
