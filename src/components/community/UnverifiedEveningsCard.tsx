// "האם המחזור התקיים?" — asked once, in one place, only when it has to be.
//
// An evening the system closed with no trace of play is the one case it cannot
// decide alone. Counting it would inflate the club's history; dropping it would
// take a night away from everyone who played it. So it asks — but the asking
// has to earn its place on the screen.
//
// Three rules shape this card:
//
//   • It is not a modal. A question that interrupts is a question answered
//     carelessly, and this one writes to the club's permanent record.
//   • Several evenings share ONE card, one row each. A club coming back from a
//     quiet month should not face a queue of dialogs.
//   • Each row is one tap either way. There is nothing to read, choose or
//     confirm: the admin was there or they were not.
//
// Admin-only, and invisible the rest of the time — which is almost always.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Card } from '@/components/Card';
import {
  eveningVerifyService,
  type UnverifiedEvening,
} from '@/services/eveningVerifyService';
import { colors, spacing, typography, radius, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { GroupId } from '@/types';

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
  });
}

/** A new evening is created with the club's own name as its title, so on THIS
 *  screen the title is usually the club heading repeated a second time — and
 *  the row is one line, so the repeat squeezes out the date, the only thing
 *  that tells two rows apart. Drop it when it says nothing new; keep a title
 *  an admin actually typed. */
function rowLabel(startsAt: number, title: string, groupName?: string): string {
  const t = title.trim();
  const g = (groupName ?? '').trim();
  if (!t || t === g) return dayLabel(startsAt);
  return `${dayLabel(startsAt)} · ${t}`;
}

export function UnverifiedEveningsCard({
  groupId,
  groupName,
  isAdmin,
  onResolved,
}: {
  groupId: GroupId;
  /** The club this card is shown inside. Used only to suppress an evening
   *  title that merely repeats it — see `rowLabel`. */
  groupName?: string;
  isAdmin: boolean;
  /** Fired after a verdict lands, so the screen can refresh the numbers it
   *  just changed — confirming an evening adds it to the club's count. */
  onResolved?: () => void;
}) {
  const [items, setItems] = useState<UnverifiedEvening[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!isAdmin) {
      setItems([]);
      return;
    }
    let alive = true;
    void eveningVerifyService.listUnverified(groupId).then((r) => {
      if (alive) setItems(r);
    });
    return () => {
      alive = false;
    };
  }, [groupId, isAdmin]);

  useEffect(() => load(), [load]);

  const answer = async (id: string, played: boolean) => {
    setBusyId(id);
    const ok = await eveningVerifyService.setPlayed(id, played);
    setBusyId(null);
    if (!ok) return; // the row stays; the service already logged it
    // Drop the row locally rather than re-reading: the answer is final, and a
    // list that flickers back before settling reads as a failed tap.
    setItems((prev) => (prev ?? []).filter((x) => x.id !== id));
    onResolved?.();
  };

  // Nothing while loading, and nothing when there is nothing to ask — which is
  // the normal state of every club.
  if (!isAdmin || !items || items.length === 0) return null;

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="help-circle-outline" size={18} color={colors.warning} />
        <Text style={styles.title}>{he.unverifiedEveningsTitle}</Text>
      </View>
      <Text style={styles.body}>{he.unverifiedEveningsBody}</Text>

      {items.map((it) => (
        <View key={it.id} style={styles.row}>
          <Text style={styles.when} numberOfLines={1}>
            {rowLabel(it.startsAt, it.title, groupName)}
          </Text>
          {busyId === it.id ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <View style={styles.actions}>
              {/* "כן" first in source order → rightmost under forceRTL, where
                  the thumb lands and where the expected answer belongs. */}
              <Pressable
                style={[styles.btn, styles.yes]}
                onPress={() => answer(it.id, true)}
                accessibilityRole="button"
                accessibilityLabel={he.unverifiedEveningYes}
              >
                <Text style={styles.yesText}>{he.unverifiedEveningYes}</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.no]}
                onPress={() => answer(it.id, false)}
                accessibilityRole="button"
                accessibilityLabel={he.unverifiedEveningNo}
              >
                <Text style={styles.noText}>{he.unverifiedEveningNo}</Text>
              </Pressable>
            </View>
          )}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  // Icon first → rightmost under forceRTL, beside the title.
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  body: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  when: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  actions: { flexDirection: 'row', gap: spacing.xs },
  btn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  yes: { backgroundColor: colors.primary, borderColor: colors.primary },
  yesText: { ...typography.caption, color: '#fff', fontWeight: '700' },
  no: { backgroundColor: 'transparent', borderColor: colors.border },
  noText: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
});
