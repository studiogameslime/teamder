// TeamsEditModal — tap-to-swap editor for an EXISTING team split (כוחות).
//
// The admin TAPS a player chip; that chip locks with a highlighted ring and
// every player in the OTHER team(s) starts blinking as a "tap me to swap"
// affordance. Tapping one of the blinking chips exchanges the two players'
// teams; tapping the picked chip again (or the cancel banner) clears the
// selection. A "סיים" button persists the result via gameService.saveDraftTeams
// (which flags teamsEditedManually so the scheduled auto-generator won't clobber
// the manual edit).
//
// This mirrors the live-match "החלפה" interaction (RotationPanel/TeamScore) —
// same one-source-then-tap-target model, same pulsing-candidate cue — instead of
// the old PanResponder drag, which was fiddly on narrow screens.

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/Button';
import { toast } from '@/components/Toast';
import { gameService } from '@/services/gameService';
import { logError } from '@/services/errorLog';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { isGuestId, type DraftTeam, type Game } from '@/types';
import { teamName } from '@/utils/draft';
import { selectionHaptic, successHaptic } from '@/utils/haptics';

export interface RosterUser {
  id: string;
  name: string;
  avatarId?: string;
  photoUrl?: string;
}

interface Props {
  visible: boolean;
  game: Game;
  /** Resolve a roster id (uid or `guest:<id>`) → display identity. */
  resolve: (id: string) => RosterUser;
  onClose: () => void;
  /** Fired after a successful save so the parent can refresh + pop. */
  onSaved?: () => void;
}

// Per-team accent by index (0=red, 1=blue, 2=green, 3=yellow) — the SAME bib
// colours used everywhere else (draft, live match, round history). The old
// array had red/blue swapped, so "קבוצה א" showed a blue dot.
const TEAM_TINTS = [colors.team1, colors.team2, colors.team3, colors.team4];

/** Pulsing opacity — marks the swap-target candidates while a source is picked.
 *  Resets cleanly to opacity 1 on deactivate so a chip never stays dimmed. */
function Blink({ active, children }: { active: boolean; children: React.ReactNode }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) {
      op.stopAnimation();
      Animated.timing(op, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.3, duration: 450, useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 450, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, op]);
  return <Animated.View style={{ opacity: op }}>{children}</Animated.View>;
}

export function TeamsEditModal({ visible, game, resolve, onClose, onSaved }: Props) {
  // Working copy of the teams; reset every time the modal opens.
  const [teams, setTeams] = useState<DraftTeam[]>([]);
  // Non-null while a first player is picked: the roster id to swap FROM.
  const [swapSource, setSwapSource] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const base = game.draftTeams?.teams ?? [];
    setTeams(
      [...base]
        .sort((a, b) => a.index - b.index)
        .map((t) => ({ ...t, playerIds: [...t.playerIds] })),
    );
    setSwapSource(null);
    setDirty(false);
  }, [visible, game.draftTeams]);

  // Which team index a roster id currently sits in (working copy).
  const teamOf = (id: string): number =>
    teams.findIndex((t) => t.playerIds.includes(id));

  const doSwap = (aId: string, bId: string) => {
    setTeams((prev) => {
      const next = prev.map((t) => ({ ...t, playerIds: [...t.playerIds] }));
      let aT = -1,
        aI = -1,
        bT = -1,
        bI = -1;
      next.forEach((t, ti) =>
        t.playerIds.forEach((p, pi) => {
          if (p === aId) {
            aT = ti;
            aI = pi;
          }
          if (p === bId) {
            bT = ti;
            bI = pi;
          }
        }),
      );
      if (aT < 0 || bT < 0) return prev;
      next[aT].playerIds[aI] = bId;
      next[bT].playerIds[bI] = aId;
      // Captain is always the first player in the list.
      next.forEach((t) => {
        t.captainId = t.playerIds[0];
      });
      return next;
    });
    setDirty(true);
  };

  // Tap flow: first tap picks a source; a second tap on a DIFFERENT team swaps;
  // tapping within the same team re-picks the source; tapping the source clears.
  const onChipTap = (id: string) => {
    if (!swapSource) {
      setSwapSource(id);
      selectionHaptic();
      return;
    }
    if (id === swapSource) {
      setSwapSource(null);
      return;
    }
    if (teamOf(id) === teamOf(swapSource)) {
      setSwapSource(id); // re-pick a different source within the same team
      selectionHaptic();
      return;
    }
    doSwap(swapSource, id);
    successHaptic();
    setSwapSource(null);
  };

  const onFinish = async () => {
    if (saving) return;
    const base = game.draftTeams;
    if (!base) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await gameService.saveDraftTeams(game.id, {
        ...base,
        teams,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      logError('teamsEditSave', err, { gameId: game.id });
      toast.error(he.autoBalanceError);
    } finally {
      setSaving(false);
    }
  };

  const sourceTeam = swapSource ? teamOf(swapSource) : -1;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.fill}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
            <Text style={styles.title}>{he.teamsEditTitle}</Text>
            <View style={styles.closeBtn} />
          </View>

          {/* Instruction — swaps to an active "pick a target / cancel" banner
              once a source is chosen. */}
          {swapSource ? (
            <Pressable
              onPress={() => setSwapSource(null)}
              style={styles.pickBanner}
            >
              <Ionicons name="swap-horizontal" size={16} color={colors.primary} />
              <Text style={styles.pickBannerText}>{he.teamsEditPickTarget}</Text>
            </Pressable>
          ) : (
            <Text style={styles.hint}>{he.teamsEditHint}</Text>
          )}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.columns}
            showsVerticalScrollIndicator
            persistentScrollbar
          >
            {teams.map((t) => (
              <View key={t.index} style={styles.column}>
                <View style={styles.columnHead}>
                  <View
                    style={[
                      styles.teamDot,
                      { backgroundColor: TEAM_TINTS[t.index % TEAM_TINTS.length] },
                    ]}
                  />
                  <Text style={styles.columnTitle} numberOfLines={1}>
                    {teamName(t.index)}
                  </Text>
                </View>
                <View style={styles.chipList}>
                  {t.playerIds.map((pid, idx) => {
                    const u = resolve(pid);
                    const isSource = pid === swapSource;
                    // A candidate blinks only when a source is picked AND this
                    // chip is on a DIFFERENT team (a legal swap partner).
                    const isCandidate =
                      swapSource != null && !isSource && t.index !== sourceTeam;
                    return (
                      <Chip
                        key={pid}
                        user={u}
                        isCaptain={idx === 0}
                        isSource={isSource}
                        isCandidate={isCandidate}
                        onPress={() => onChipTap(pid)}
                      />
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <Button
              title={he.teamsEditFinish}
              onPress={onFinish}
              loading={saving}
              disabled={!dirty}
              fullWidth
              size="lg"
              iconLeft="checkmark-circle"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Chip({
  user,
  isCaptain,
  isSource,
  isCandidate,
  onPress,
}: {
  user: RosterUser;
  isCaptain: boolean;
  isSource: boolean;
  isCandidate: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <Blink active={isCandidate}>
        <View
          style={[
            styles.chipFace,
            isCandidate && styles.chipFaceCandidate,
            isSource && styles.chipFaceSource,
          ]}
        >
          <UserAvatar user={user} size={32} />
          <Text style={styles.chipName} numberOfLines={1}>
            {user.name}
          </Text>
          {isCaptain ? (
            <Ionicons name="shield-checkmark" size={13} color={colors.primary} />
          ) : null}
          {isGuestId(user.id) ? (
            <Ionicons name="person-outline" size={12} color={colors.textMuted} />
          ) : null}
        </View>
      </Blink>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h3, color: colors.text, fontWeight: '800' },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  // Active "now pick a target" banner shown while a source is selected.
  pickBanner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: spacing.lg,
    marginTop: 2,
    marginBottom: spacing.md,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  pickBannerText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },
  // Teams scroll between the fixed header and the pinned "סיים" footer — with
  // 3–4 teams stacked full-width the list overflows the sheet, so without this
  // the lower teams AND the finish button were unreachable. flexShrink lets the
  // scroll area collapse to the space left inside the 92%-max sheet.
  scroll: { flexShrink: 1 },
  // One team per row, full width, stacked top-to-bottom — every team gets the
  // same size regardless of team count (2/3/4), instead of a wrapping grid that
  // left the 3rd team stretched full-width under two narrow columns.
  columns: {
    flexDirection: 'column',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  column: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  columnHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  teamDot: { width: 12, height: 12, borderRadius: 6 },
  columnTitle: {
    ...typography.label,
    color: colors.text,
    fontWeight: '800',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  chipList: { gap: spacing.xs },
  chipFace: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  // A blinking swap candidate — soft tinted background so it reads as tappable.
  chipFaceCandidate: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  // The picked source — solid ring, no blink.
  chipFaceSource: {
    borderColor: colors.primary,
    borderWidth: 2.5,
    backgroundColor: colors.surface,
  },
  chipName: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    flex: 1,
    minWidth: 0, // let a long one-line name ellipsize instead of forcing the column wider
    textAlign: RTL_LABEL_ALIGN,
  },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
});
