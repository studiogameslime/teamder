// AchievementsScreen — dedicated view for the user's achievements.
//
// Reachable from the Profile-tab hamburger. Replaces the previous
// "open my full player card" route which exposed a lot more than the
// user wanted. This screen renders ONLY the achievements grid +
// detail popover, nothing else.
//
// Read model: pulls the latest /users/{uid} on mount so the unlocked
// list is fresh (the local store can lag a few seconds behind a
// just-fired achievement bump).

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { AchievementBadge } from '@/components/AchievementBadge';
import { AchievementCelebration } from '@/components/AchievementCelebration';
import { AppearItem } from '@/components/anim/AppearItem';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import {
  achievementsService,
  type NewlyUnlocked,
} from '@/services/achievementsService';
import { TIER_META } from '@/data/achievements';
import { userService } from '@/services';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import type { User, UserAchievementState } from '@/types';

export function AchievementsScreen() {
  const localUser = useUserStore((s) => s.currentUser);
  const groups = useGroupStore((s) => s.groups);
  const [user, setUser] = useState<User | null>(localUser);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Derived counters live alongside the user fetch. Null while
  // computing — once resolved they replace the (often stale) stored
  // counters for the unlock check. The persisted unlocked-id list
  // still wins, so a badge already earned stays earned.
  const [counters, setCounters] = useState<UserAchievementState | null>(null);
  // Newly-reached tiers to celebrate (filled from persistDerivedUnlocks).
  const [celebrate, setCelebrate] = useState<NewlyUnlocked[]>([]);

  // Screen-level mount log so we can chart how often the achievements
  // page is opened (separate from the generic ScreenView signal).
  useEffect(() => {
    logEvent(AnalyticsEvent.AchievementsOpened);
  }, []);

  useEffect(() => {
    if (!localUser) return;
    let alive = true;
    setLoading(true);
    userService
      .getUserById(localUser.id)
      .then((u) => {
        if (alive && u) setUser(u);
      })
      .catch(() => {
        // Keep showing the cached store value on transient failure.
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [localUser?.id]);

  useEffect(() => {
    if (!localUser) return;
    let alive = true;
    achievementsService
      .deriveCounters(localUser.id, {
        groups,
        friendsCount: localUser.friends?.length ?? 0,
        goals: localUser.stats?.goals ?? 0,
        assists: localUser.stats?.assists ?? 0,
      })
      .then(async (c) => {
        if (!alive) return;
        setCounters(c);
        // Reconcile the persisted unlocked list with the new truth and
        // celebrate any tiers that were just crossed.
        const fresh = await achievementsService.persistDerivedUnlocks(
          localUser.id,
          c,
        );
        if (alive && fresh.length) setCelebrate(fresh);
      })
      .catch(() => {
        // Leave counters null → screen falls back to the stored
        // counters via achievementsService.list as a last resort.
      });
    return () => {
      alive = false;
    };
    // groups is included so adding/leaving a community refreshes the
    // teams* metrics on the next render.
  }, [localUser?.id, groups]);

  if (!user) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.profileSectionMyAchievements} />
        <View style={styles.center}>
          <SoccerBallLoader size={40} />
        </View>
      </SafeAreaView>
    );
  }

  // Prefer the derived counters when ready. Fall back to the
  // (possibly stale) stored counters only while the derivation is
  // in flight — never lose the persisted unlocked list.
  const items = counters
    ? achievementsService.listFromCounters(user, counters)
    : achievementsService.list(user);
  const ordered = [...items].sort((a, b) => {
    if (a.unlocked === b.unlocked) return 0;
    return a.unlocked ? -1 : 1;
  });
  const unlockedCount = items.filter((i) => i.unlocked).length;
  const active = activeId ? items.find((i) => i.def.id === activeId) : null;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.profileSectionMyAchievements} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{he.achievementsTitle}</Text>
          <Text style={styles.count}>
            {he.achievementsCount(unlockedCount, items.length)}
          </Text>
        </View>

        {items.length === 0 ? (
          <Text style={styles.empty}>{he.achievementsEmpty}</Text>
        ) : (
          <>
            <View style={styles.grid}>
              {ordered.map((item, idx) => (
                <AppearItem key={item.def.id} index={idx} style={styles.cell}>
                  <AchievementBadge
                    def={item.def}
                    tier={item.currentTier?.tier ?? null}
                    size={72}
                    showTierLabel
                    onPress={() => setActiveId(item.def.id)}
                  />
                </AppearItem>
              ))}
            </View>

          </>
        )}
        {loading ? (
          <View style={styles.loadingFooter}>
            <SoccerBallLoader size={20} />
          </View>
        ) : null}
      </ScrollView>

      {/* Tap-to-detail tooltip — a centered popover so the explanation is
          always visible (the old inline card sat below the fold and was
          easy to miss). Tap anywhere to dismiss. */}
      <Modal
        visible={!!active}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveId(null)}
      >
        <Pressable style={styles.tooltipBackdrop} onPress={() => setActiveId(null)}>
          {active ? (
            <Pressable style={styles.tooltipCard} onPress={(e) => e.stopPropagation()}>
              <AchievementBadge
                def={active.def}
                tier={active.currentTier?.tier ?? null}
                size={72}
                hideTitle
              />
              <Text style={styles.detailTitle}>{active.def.titleHe}</Text>
              {/* What the player has actually DONE for this badge (feat-63l30):
                  e.g. "כבר 10 שערים". Counted metrics only — a one-off badge
                  is binary (earned / not) and has no running tally. */}
              {!active.def.oneOff && active.value > 0 ? (
                <Text style={styles.detailTally}>
                  {he.achievementYourTally(active.value, active.def.nounHe)}
                </Text>
              ) : null}
              {/* How to earn — the action + the concrete tier targets, so
                  the user knows exactly what unlocks each medal. */}
              <View style={styles.howBox}>
                <Text style={styles.howTitle}>{he.achievementHowTitle}</Text>
                <Text style={styles.howText}>{active.def.howHe}</Text>
                {!active.def.oneOff ? (
                  <Text style={styles.howTiers}>
                    {he.achievementTiersLine(
                      active.def.tiers[0].threshold,
                      active.def.tiers[1].threshold,
                      active.def.tiers[2].threshold,
                    )}
                  </Text>
                ) : null}
              </View>
              {active.currentTier ? (
                <Text
                  style={[
                    styles.detailTier,
                    { color: TIER_META[active.currentTier.tier].color },
                  ]}
                >
                  {he.achievementTierReached(
                    TIER_META[active.currentTier.tier].he,
                  )}
                </Text>
              ) : null}
              {/* Progress bar toward the NEXT tier (or "maxed" when gold). */}
              {active.next ? (
                <View style={styles.progressWrap}>
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${Math.min(1, active.value / active.next.threshold) * 100}%`,
                          backgroundColor: active.currentTier
                            ? TIER_META[active.currentTier.tier].color
                            : '#94A3B8',
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.progressText}>
                    {he.achievementProgressToNext(
                      Math.min(active.value, active.next.threshold),
                      active.next.threshold,
                      TIER_META[active.next.tier].he,
                    )}
                  </Text>
                </View>
              ) : (
                <Text style={styles.detailDesc}>{he.achievementMaxed}</Text>
              )}
              {active.unlocked && active.unlockedAt ? (
                <Text style={styles.detailMeta}>
                  {he.achievementUnlockedAt(formatHebrewDate(active.unlockedAt))}
                </Text>
              ) : !active.unlocked ? (
                <Text style={styles.detailMeta}>{he.achievementsLockedHint}</Text>
              ) : null}
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>

      {celebrate.length > 0 ? (
        <AchievementCelebration
          items={celebrate}
          onDone={() => setCelebrate([])}
        />
      ) : null}
    </SafeAreaView>
  );
}

function formatHebrewDate(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

// Three per row. Kept under a third so the two inter-column gaps that
// `space-between` inserts fit inside 100% — at exactly 33.333% the row
// overflows and silently drops to two columns (orphaning the left half).
const CELL_BASIS = '30%';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  count: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '700',
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  // space-between distributes the cells evenly across each row,
  // so a lone tile in the bottom row sits flush to the start (the
  // right side under RTL) instead of getting visually orphaned in
  // the centre. The unlocked badge stays on the right where the
  // user's eye lands first.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.lg,
    justifyContent: 'space-between',
  },
  cell: {
    width: CELL_BASIS,
    alignItems: 'center',
  },
  tooltipBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  tooltipCard: {
    backgroundColor: colors.bg,
    borderRadius: 20,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
    alignSelf: 'stretch',
    maxWidth: 360,
  },
  detailTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  detailTally: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 2,
  },
  detailTier: {
    ...typography.body,
    fontWeight: '900',
    textAlign: 'center',
  },
  detailDesc: {
    ...typography.body,
    color: colors.text,
    textAlign: 'center',
  },
  howBox: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.sm,
    gap: 2,
    alignItems: 'center',
  },
  howTitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '800',
    textAlign: 'center',
  },
  howText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: 'center',
  },
  howTiers: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: 'center',
  },
  detailMeta: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  progressWrap: {
    width: '100%',
    marginTop: spacing.sm,
    alignItems: 'center',
    gap: 4,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  loadingFooter: {
    alignItems: 'center',
    paddingTop: spacing.md,
  },
});
