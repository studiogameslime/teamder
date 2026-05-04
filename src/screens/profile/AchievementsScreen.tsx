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
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { AchievementBadge } from '@/components/AchievementBadge';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { achievementsService } from '@/services/achievementsService';
import { userService } from '@/services';
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
      .deriveCounters(localUser.id, { groups })
      .then((c) => {
        if (!alive) return;
        setCounters(c);
        // Reconcile the persisted unlocked list with the new
        // truth — adds newly-met thresholds and prunes stale
        // entries from the legacy bump path. Best-effort.
        achievementsService.persistDerivedUnlocks(localUser.id, c);
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
            {unlockedCount} / {items.length}
          </Text>
        </View>

        {items.length === 0 ? (
          <Text style={styles.empty}>{he.achievementsEmpty}</Text>
        ) : (
          <>
            <View style={styles.grid}>
              {ordered.map((item) => (
                <View key={item.def.id} style={styles.cell}>
                  <AchievementBadge
                    def={item.def}
                    unlocked={item.unlocked}
                    size={72}
                    onPress={() => setActiveId(item.def.id)}
                  />
                </View>
              ))}
            </View>

            {active ? (
              <Card style={styles.detailCard}>
                <Text style={styles.detailTitle}>{active.def.titleHe}</Text>
                <Text style={styles.detailDesc}>
                  {active.def.descriptionHe}
                </Text>
                {active.unlocked && active.unlockedAt ? (
                  <Text style={styles.detailMeta}>
                    {he.achievementUnlockedAt(formatHebrewDate(active.unlockedAt))}
                  </Text>
                ) : !active.unlocked ? (
                  <Text style={styles.detailMeta}>
                    {he.achievementsLockedHint}
                  </Text>
                ) : null}
              </Card>
            ) : null}
          </>
        )}
        {loading ? (
          <View style={styles.loadingFooter}>
            <SoccerBallLoader size={20} />
          </View>
        ) : null}
      </ScrollView>
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

const CELL_BASIS = '33.333%';

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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.lg,
  },
  cell: {
    width: CELL_BASIS,
    alignItems: 'center',
  },
  detailCard: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  detailTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  detailDesc: {
    ...typography.body,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  detailMeta: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.xs,
  },
  loadingFooter: {
    alignItems: 'center',
    paddingTop: spacing.md,
  },
});
