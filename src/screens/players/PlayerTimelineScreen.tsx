// PlayerTimelineScreen — admin-only, per-community timeline of a player's
// yellow/red cards + ball/jerseys handoffs. Reached from the community player
// menu ("ציר זמן"). Cards show their detail + state (active/expired/revoked);
// an admin can long-press a card to revoke it (kept, marked "בוטל").

import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
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
import { cardState } from '@/utils/cardState';
import { RefereeCard, CARD_YELLOW, CARD_RED } from '@/components/community/CardCountBadges';
import { colors, spacing, typography, radius, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { CommunityPlayerEvent, Group } from '@/types';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

type Nav = NativeStackNavigationProp<CommunitiesStackParamList, 'PlayerTimeline'>;
type Params = RouteProp<CommunitiesStackParamList, 'PlayerTimeline'>;

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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={he.timelineTitle(displayName || '')} />
      {visibleEvents.length === 0 ? (
        <EmptyState icon="time-outline" title={he.timelineEmpty} />
      ) : (
        <FlatList
          data={visibleEvents}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          renderItem={({ item: ev }) => {
            const meta = EVENT_META[ev.type];
            // Ball/jerseys marks cleared via "נהל ציוד" read "החזיר …" instead
            // of the default "לקח … הביתה".
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
            const canRevoke = isCard && isAdmin && !ev.revoked;
            return (
              <PressableScale
                onLongPress={canRevoke ? () => onRevoke(ev) : undefined}
                delayLongPress={400}
                style={styles.row}
              >
                {isCard ? (
                  // Card events use the SAME referee-card shape as the roster
                  // badges. Expired/revoked keep the FULL colour with a diagonal
                  // slash (dimming it just washed the red out to pink).
                  <View style={styles.iconWrap}>
                    <RefereeCard
                      color={ev.type === 'red' ? CARD_RED : CARD_YELLOW}
                      w={26}
                      h={34}
                      radius={6}
                      struck={dimmed}
                    />
                  </View>
                ) : (
                  <View style={[styles.iconWrap, { backgroundColor: meta.color + '22' }]}>
                    <Ionicons name={meta.icon} size={20} color={meta.color} />
                  </View>
                )}
                <View style={styles.body}>
                  {/* Title row: title (+ state tag) on the right, date on the
                      left of the same line. */}
                  <View style={styles.titleRow}>
                    <View style={styles.titleGroup}>
                      <Text
                        style={[styles.title, dimmed && styles.strike]}
                        numberOfLines={1}
                      >
                        {title}
                      </Text>
                      {stateLabel ? (
                        <View style={[styles.tag, state === 'revoked' ? styles.tagRevoked : styles.tagExpired]}>
                          <Text style={styles.tagText}>{stateLabel}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.date}>{fmtDate(ev.at)}</Text>
                  </View>
                  {ev.detail ? <Text style={styles.detail}>{ev.detail}</Text> : null}
                </View>
              </PressableScale>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  list: { padding: spacing.md },
  row: {
    // `row` (NOT row-reverse): under forceRTL the first child (the icon) sits on
    // the visual RIGHT, matching the roster row + the requested "icon on the
    // right" layout. row-reverse would flip it to the LEFT (RTL bug class).
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
    minWidth: 0,
  },
  title: { ...typography.bodyBold, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN, flexShrink: 1 },
  strike: { color: colors.textMuted, textDecorationLine: 'line-through' },
  tag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  tagExpired: { backgroundColor: colors.surfaceMuted },
  tagRevoked: { backgroundColor: colors.danger + '22' },
  tagText: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  detail: { ...typography.body, color: colors.text, textAlign: RTL_LABEL_ALIGN, marginTop: 4 },
  date: { ...typography.caption, color: colors.textMuted, flexShrink: 0 },
});
