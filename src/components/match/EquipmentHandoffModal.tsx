// EquipmentHandoffModal — shown right after the admin ends the evening of a
// COMMUNITY game ("סיים ערב"). Records who took the club's ball(s) and jerseys
// home, so before the next game everyone sees who currently holds them. Both
// items are multi-holder (two people can each take a ball). Only registered
// members are selectable — a holder is a community-member state (guests excluded
// upstream). "דלג" leaves the current holders unchanged.

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { selectionHaptic } from '@/utils/haptics';
import { he } from '@/i18n/he';
import type { LastTakenMap } from '@/services/communityEventsService';

export interface EquipmentHolders {
  ballHolderIds: string[];
  jerseysHolderIds: string[];
}

interface Props {
  visible: boolean;
  /** Registered participants of the just-finished game (no guests). */
  players: { id: string; name: string; avatarId?: string; photoUrl?: string }[];
  /** Current holders, used to pre-select the rows. */
  initial: EquipmentHolders;
  /** When each player last took the ball/jerseys home (for the fairness hint). */
  lastTaken?: LastTakenMap;
  onSave: (holders: EquipmentHolders) => void;
  onSkip: () => void;
}

/** Compact "took last at DD.MM" line for a player. */
function lastTakenHint(lt: { ball?: number; jerseys?: number } | undefined): string {
  const short = (ms: number) => {
    const d = new Date(ms);
    const dm = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    // Append a 2-digit year for cross-season events so last year isn't confused
    // with this year (getLastTakenMap can surface older handoffs).
    const yr = d.getFullYear();
    return yr === new Date().getFullYear() ? dm : `${dm}.${String(yr).slice(2)}`;
  };
  const parts: string[] = [];
  if (lt?.ball) parts.push(`${he.equipmentBall} ${short(lt.ball)}`);
  if (lt?.jerseys) parts.push(`${he.equipmentJerseys} ${short(lt.jerseys)}`);
  return parts.length ? he.equipmentLastTook(parts.join(' · ')) : he.equipmentNeverTook;
}

export function EquipmentHandoffModal({ visible, players, initial, lastTaken, onSave, onSkip }: Props) {
  const [ball, setBall] = useState<string[]>([]);
  const [jerseys, setJerseys] = useState<string[]>([]);

  // Fairness rotation: 0 = never took (most overdue → suggested first).
  const took = (id: string, item: 'ball' | 'jerseys') => lastTaken?.[id]?.[item] ?? 0;
  const hasLastData = !!lastTaken && Object.keys(lastTaken).length > 0;

  // Display order: whoever carried equipment (either item) least recently rises
  // to the top, so the fair candidates are the first ones the admin sees.
  const orderedPlayers = useMemo(() => {
    if (!hasLastData) return players;
    // Overdue on EITHER item floats a player up: min() means a never-took (0)
    // on any single item sorts them first, even if they carried the other one.
    const staleness = (id: string) => Math.min(took(id, 'ball'), took(id, 'jerseys'));
    return [...players].sort((a, b) => staleness(a.id) - staleness(b.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, lastTaken, hasLastData]);

  // Pre-select the FAIREST holders (took that item longest ago / never) instead
  // of last week's holders — same count the club used before, so we rotate
  // rather than re-assign the same people. Falls back to the current holders
  // when there's no history yet.
  useEffect(() => {
    if (!visible) return;
    if (!hasLastData) {
      setBall(initial.ballHolderIds ?? []);
      setJerseys(initial.jerseysHolderIds ?? []);
      return;
    }
    const fairest = (item: 'ball' | 'jerseys', k: number) =>
      [...players]
        .sort((a, b) => took(a.id, item) - took(b.id, item))
        .slice(0, Math.max(0, k))
        .map((p) => p.id);
    setBall(fairest('ball', initial.ballHolderIds?.length ?? 0));
    setJerseys(fairest('jerseys', initial.jerseysHolderIds?.length ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initial, lastTaken, players]);

  const toggle = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    id: string,
  ) => {
    selectionHaptic();
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onSkip}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{he.equipmentHandoffTitle}</Text>
            <Pressable
              onPress={onSkip}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={he.equipmentSkip}
            >
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </Pressable>
          </View>
          <Text style={styles.hint}>{he.equipmentHandoffHint}</Text>

          {/* Column legend so the two trailing toggles are self-explanatory. */}
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <Ionicons name="football" size={16} color={colors.primary} />
              <Text style={styles.legendText}>{he.equipmentBall}</Text>
            </View>
            <View style={styles.legendItem}>
              <Ionicons name="shirt" size={16} color={colors.primary} />
              <Text style={styles.legendText}>{he.equipmentJerseys}</Text>
            </View>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listInner}>
            {orderedPlayers.map((p) => {
              const ballOn = ball.includes(p.id);
              const jerseyOn = jerseys.includes(p.id);
              return (
                <View key={p.id} style={styles.row}>
                  <UserAvatar user={p} size={34} />
                  <View style={styles.nameCol}>
                    <Text style={styles.name} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={styles.lastTook} numberOfLines={1}>
                      {lastTakenHint(lastTaken?.[p.id])}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => toggle(setBall, p.id)}
                    style={[styles.toggle, ballOn && styles.toggleBallOn]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: ballOn }}
                    accessibilityLabel={he.equipmentBall}
                    hitSlop={6}
                  >
                    <Ionicons
                      name={ballOn ? 'football' : 'football-outline'}
                      size={20}
                      color={ballOn ? '#FFFFFF' : colors.textMuted}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => toggle(setJerseys, p.id)}
                    style={[styles.toggle, jerseyOn && styles.toggleJerseyOn]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: jerseyOn }}
                    accessibilityLabel={he.equipmentJerseys}
                    hitSlop={6}
                  >
                    <Ionicons
                      name={jerseyOn ? 'shirt' : 'shirt-outline'}
                      size={20}
                      color={jerseyOn ? '#FFFFFF' : colors.textMuted}
                    />
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={onSkip}
              style={[styles.btn, styles.btnSkip]}
              accessibilityRole="button"
            >
              <Text style={styles.btnSkipText}>{he.equipmentSkip}</Text>
            </Pressable>
            <Pressable
              onPress={() => onSave({ ballHolderIds: ball, jerseysHolderIds: jerseys })}
              style={[styles.btn, styles.btnSave]}
              accessibilityRole="button"
            >
              <Text style={styles.btnSaveText}>{he.equipmentSave}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    gap: spacing.sm,
    maxHeight: '82%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    flex: 1,
  },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  legendRow: { flexDirection: 'row-reverse', gap: spacing.lg, paddingHorizontal: spacing.xs },
  legendItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  legendText: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  list: { alignSelf: 'stretch' },
  listInner: { gap: spacing.xs, paddingVertical: spacing.xs },
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  nameCol: { flex: 1, minWidth: 0 },
  name: { ...typography.bodyBold, color: colors.text, textAlign: RTL_LABEL_ALIGN },
  lastTook: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, marginTop: 1 },
  toggle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBallOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleJerseyOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  footer: { flexDirection: 'row-reverse', gap: spacing.sm, marginTop: spacing.xs },
  btn: { flex: 1, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center' },
  btnSave: { backgroundColor: colors.primary },
  btnSaveText: { ...typography.bodyBold, color: '#FFFFFF', fontWeight: '800' },
  btnSkip: { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  btnSkipText: { ...typography.bodyBold, color: colors.textMuted, fontWeight: '700' },
});
