// The titles a player has won, across every club and every season.
//
// An achievement is something the app grants you for a milestone. A season
// title is something you beat other people to, once, in a competition with an
// end — so it belongs beside the achievements but not among them, and it is
// listed newest first rather than scored or tiered.
//
// Read from users/{uid}/seasonTitles, written only by closeSeason. Each doc
// carries the club's name FROZEN at the moment it was won: the title survives
// the player leaving that club and the club being renamed, and a live lookup
// would render both as a dash.

import { Ionicons } from '@expo/vector-icons';

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { collection, getDocs } from 'firebase/firestore';

import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { logError } from '@/services/errorLog';
import { SEASON_TITLE_KEYS, type SeasonTitleKey } from '@/utils/seasonAwards';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { seasonTitleIcon, seasonTitleTint } from '@/utils/seasonTitleIcon';
import type { UserId } from '@/types';

interface Held {
  id: string;
  groupName: string;
  seasonNo: number;
  titleKey: SeasonTitleKey;
  at: number;
}

const KEYS = new Set<string>(SEASON_TITLE_KEYS);

async function loadTitles(uid: UserId): Promise<Held[]> {
  if (USE_MOCK_DATA) {
    return [
      { id: 'm1', groupName: 'חמישי כדורגל', seasonNo: 1, titleKey: 'topAssister', at: 2 },
      { id: 'm2', groupName: 'חמישי כדורגל', seasonNo: 1, titleKey: 'mostLoyal', at: 1 },
    ];
  }
  try {
    const { db } = getFirebase();
    const snap = await getDocs(collection(db, 'users', uid, 'seasonTitles'));
    const out: Held[] = [];
    snap.forEach((d) => {
      const x = d.data() as Record<string, unknown>;
      const titleKey = typeof x.titleKey === 'string' ? x.titleKey : '';
      // A key this build does not know about is skipped rather than rendered
      // as a blank row — a future title should not leave a hole here.
      if (!KEYS.has(titleKey)) return;
      out.push({
        id: d.id,
        groupName: typeof x.groupName === 'string' ? x.groupName : '',
        seasonNo: typeof x.seasonNo === 'number' ? x.seasonNo : 0,
        titleKey: titleKey as SeasonTitleKey,
        at: typeof x.at === 'number' ? x.at : 0,
      });
    });
    // Newest first, and stable when two titles were sealed in the same
    // millisecond — which every title from one season is.
    return out.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  } catch (err) {
    logError('seasonTitlesLoad', err, { userId: uid });
    return [];
  }
}

export function SeasonTitlesShelf({ userId }: { userId: UserId }) {
  const [titles, setTitles] = useState<Held[] | null>(null);

  useEffect(() => {
    let alive = true;
    loadTitles(userId).then((t) => {
      if (alive) setTitles(t);
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  // Nothing at all while loading, and nothing when a player holds none: an
  // empty trophy shelf on a screen that already has its own empty state reads
  // as something broken rather than as something not yet won.
  if (!titles || titles.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{he.seasonTitlesShelfTitle}</Text>
        <Text style={styles.count}>{he.seasonTitlesShelfCount(titles.length)}</Text>
      </View>
      {titles.map((t) => (
        <View key={t.id} style={styles.row}>
          {/* Its own mark, the same one the hall of fame and the summary
              draw for this title. Nine titles shared one 🏆 across four
              surfaces. */}
          <View
            style={[
              styles.medalDisc,
              { backgroundColor: seasonTitleTint(t.titleKey) + '1A' },
            ]}
          >
            <Ionicons
              name={seasonTitleIcon(t.titleKey)}
              size={16}
              color={seasonTitleTint(t.titleKey)}
            />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{he.seasonTitleNames[t.titleKey]}</Text>
            <Text style={styles.rowWhere}>
              {he.seasonTitleWhere(t.groupName, t.seasonNo)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  // Title first in source order → rightmost under forceRTL, count to its left,
  // matching the achievements header directly above it.
  headerRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  title: {
    ...typography.h3,
    color: colors.text,
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  count: { ...typography.caption, color: colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  medalDisc: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  rowWhere: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
});
