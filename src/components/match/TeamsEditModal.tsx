// TeamsEditModal — drag-and-drop editor for an EXISTING team split (כוחות).
//
// The admin drags a player chip from one team onto a player in ANOTHER team;
// the chip under the finger ENLARGES to show who they'll swap with, and on
// release the two players exchange teams. A "סיים" button persists the result
// via gameService.saveDraftTeams (which flags teamsEditedManually so the
// scheduled auto-generator won't clobber the manual edit).
//
// Built on PanResponder + RN Animated (no Reanimated worklets) so the drag is
// driven from JS — fine for the ≤~24 chips a game ever has, and easy to drive
// from an adb swipe during testing. Hit-testing uses page coords
// (measureInWindow / gestureState.moveX|moveY), and the floating overlay is
// positioned in a full-screen absolute layer so page coords map 1:1.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/Button';
import { toast } from '@/components/Toast';
import { gameService } from '@/services/gameService';
import { logError } from '@/services/errorLog';
import { colors, radius, spacing, typography, shadows, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { isGuestId, type DraftTeam, type Game } from '@/types';
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

// The floating drag chip is a COMPACT pill (not the full column-width row) so
// it can sit centred on the finger — a full-width ghost put the RTL name far to
// the right of the touch point.
const GHOST_W = 176;
const TEAM_LETTERS = ['א', 'ב', 'ג', 'ד'];
// Per-team accent (index-based) — only used for the column header dot/tint.
const TEAM_TINTS = ['#2F6BFF', '#E5484D', '#1FA971', '#F5A524'];

type Rect = { x: number; y: number; w: number; h: number };

export function TeamsEditModal({ visible, game, resolve, onClose, onSaved }: Props) {
  // Working copy of the teams; reset every time the modal opens.
  const [teams, setTeams] = useState<DraftTeam[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const layouts = useRef<Record<string, Rect>>({});
  const chipRefs = useRef<Record<string, View | null>>({});
  const pan = useRef(new Animated.ValueXY()).current;
  const dragSize = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  // Live refs so the PanResponder (created once) always sees fresh state.
  const dragIdRef = useRef<string | null>(null);
  const hoverIdRef = useRef<string | null>(null);
  const teamsRef = useRef<DraftTeam[]>([]);
  teamsRef.current = teams;

  // (Re)measure every chip's page rect for hit-testing. measureInWindow inside
  // a freshly-opened Modal can return zeros on the first layout pass, so we
  // also call this on open (after the slide settles) and on each drag grab.
  const measureAll = () => {
    for (const [id, ref] of Object.entries(chipRefs.current)) {
      if (!ref) continue;
      ref.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) layouts.current[id] = { x, y, w, h };
      });
    }
  };

  useEffect(() => {
    if (!visible) return;
    const base = game.draftTeams?.teams ?? [];
    setTeams(
      [...base]
        .sort((a, b) => a.index - b.index)
        .map((t) => ({ ...t, playerIds: [...t.playerIds] })),
    );
    setDragId(null);
    setHoverId(null);
    setDirty(false);
    dragIdRef.current = null;
    hoverIdRef.current = null;
    layouts.current = {};
    const t = setTimeout(measureAll, 400);
    return () => clearTimeout(t);
  }, [visible, game.draftTeams]);

  // Which team a roster id currently sits in (working copy).
  const teamOf = (id: string): number =>
    teamsRef.current.findIndex((t) => t.playerIds.includes(id));

  const hitTest = (px: number, py: number): string | null => {
    const fromTeam = teamOf(dragIdRef.current ?? '');
    for (const [id, r] of Object.entries(layouts.current)) {
      if (id === dragIdRef.current) continue;
      if (teamOf(id) === fromTeam) continue; // only a DIFFERENT team swaps
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
        return id;
      }
    }
    return null;
  };

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

  // Drag lifecycle — each chip owns a PanResponder that calls these. Kept as
  // plain functions (re-read via the chip's cbRef each render) so they always
  // see fresh state through the refs above.
  const onDragStart = (id: string, x0: number, y0: number) => {
    const r = layouts.current[id];
    dragIdRef.current = id;
    dragSize.current = r ? { w: r.w, h: r.h } : { w: 140, h: 44 };
    // Centre the COMPACT ghost (GHOST_W) on the finger from the first frame,
    // even before measurement resolves — so the drag is always visible.
    pan.setValue({ x: x0 - GHOST_W / 2, y: y0 - dragSize.current.h / 2 });
    setDragId(id);
    selectionHaptic();
    // Refresh target rects in case the open-time measure was early/stale.
    measureAll();
  };
  const onDragMove = (px: number, py: number) => {
    if (!dragIdRef.current) return;
    pan.setValue({
      x: px - GHOST_W / 2,
      y: py - dragSize.current.h / 2,
    });
    const target = hitTest(px, py);
    if (target !== hoverIdRef.current) {
      hoverIdRef.current = target;
      setHoverId(target);
      if (target) selectionHaptic();
    }
  };
  const onDragEnd = () => {
    const from = dragIdRef.current;
    const to = hoverIdRef.current;
    if (from && to) {
      doSwap(from, to);
      successHaptic();
    }
    dragIdRef.current = null;
    hoverIdRef.current = null;
    setDragId(null);
    setHoverId(null);
  };
  const dragCallbacks = { onStart: onDragStart, onMove: onDragMove, onEnd: onDragEnd };

  const registerLayout = (id: string, viewRef: View | null) => {
    chipRefs.current[id] = viewRef;
    if (!viewRef) return;
    // measureInWindow → page coords, matching gestureState.moveX/moveY.
    viewRef.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) layouts.current[id] = { x, y, w, h };
    });
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

  const draggingUser = dragId ? resolve(dragId) : null;

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
          <Text style={styles.hint}>{he.teamsEditHint}</Text>

          <View style={styles.columns}>
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
                    {he.teamsEditTeamName(TEAM_LETTERS[t.index] ?? String(t.index + 1))}
                  </Text>
                </View>
                <View style={styles.chipList}>
                  {t.playerIds.map((pid, idx) => {
                    const u = resolve(pid);
                    return (
                      <Chip
                        key={pid}
                        id={pid}
                        user={u}
                        isCaptain={idx === 0}
                        dragging={dragId === pid}
                        hovered={hoverId === pid}
                        onLayoutRef={(ref) => registerLayout(pid, ref)}
                        callbacks={dragCallbacks}
                      />
                    );
                  })}
                </View>
              </View>
            ))}
          </View>

          <View style={styles.footer}>
            <Button
              title={he.teamsEditFinish}
              onPress={onFinish}
              loading={saving}
              fullWidth
              size="lg"
              iconLeft="checkmark-circle"
            />
          </View>
        </View>

        {/* Floating drag overlay — follows the finger, sits above everything.
            Wrapped in a `direction:'ltr'` layer so translateX is physical (the
            page coords from PanResponder); without it, RTL mirrors the X and
            the ghost lands far to the side of the finger. */}
        {draggingUser ? (
          <View pointerEvents="none" style={styles.overlayLayer}>
            <Animated.View
              style={[
                styles.dragGhost,
                {
                  width: GHOST_W,
                  transform: [
                    { translateX: pan.x },
                    { translateY: pan.y },
                    { scale: 1.08 },
                  ],
                },
              ]}
            >
              <ChipFace user={draggingUser} tone="drag" compact />
            </Animated.View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

interface DragCallbacks {
  onStart: (id: string, x0: number, y0: number) => void;
  onMove: (px: number, py: number) => void;
  onEnd: () => void;
}

function Chip({
  id,
  user,
  isCaptain,
  dragging,
  hovered,
  onLayoutRef,
  callbacks,
}: {
  id: string;
  user: RosterUser;
  isCaptain: boolean;
  dragging: boolean;
  hovered: boolean;
  onLayoutRef: (ref: View | null) => void;
  callbacks: DragCallbacks;
}) {
  const ref = useRef<View | null>(null);
  const scale = useRef(new Animated.Value(1)).current;
  // Keep the latest callbacks reachable from the once-created responder.
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  const responder = useRef(
    PanResponder.create({
      // Claim on touch-down so the drag always engages (there's no scroll
      // view to compete with inside the editor).
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (_e, g) => cbRef.current.onStart(id, g.x0, g.y0),
      onPanResponderMove: (_e, g) => cbRef.current.onMove(g.moveX, g.moveY),
      onPanResponderRelease: () => cbRef.current.onEnd(),
      onPanResponderTerminate: () => cbRef.current.onEnd(),
    }),
  ).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: hovered ? 1.18 : 1,
      useNativeDriver: true,
      friction: 6,
      tension: 140,
    }).start();
  }, [hovered, scale]);

  const onLayout = (_e: LayoutChangeEvent) => onLayoutRef(ref.current);

  return (
    <Animated.View
      ref={ref}
      onLayout={onLayout}
      collapsable={false}
      style={[
        styles.chip,
        hovered && styles.chipHovered,
        dragging && styles.chipDragging,
        { transform: [{ scale }] },
      ]}
      {...responder.panHandlers}
    >
      <ChipFace user={user} isCaptain={isCaptain} />
    </Animated.View>
  );
}

function ChipFace({
  user,
  isCaptain,
  tone,
  compact,
}: {
  user: RosterUser;
  isCaptain?: boolean;
  tone?: 'drag';
  compact?: boolean;
}) {
  return (
    <View
      style={[
        styles.chipFace,
        tone === 'drag' && styles.chipFaceDrag,
        compact && styles.chipFaceCompact,
      ]}
    >
      <UserAvatar user={user} size={32} />
      <Text
        style={[styles.chipName, compact && styles.chipNameCompact]}
        numberOfLines={1}
      >
        {user.name}
      </Text>
      {isCaptain ? (
        <Ionicons name="shield-checkmark" size={13} color={colors.primary} />
      ) : null}
      {isGuestId(user.id) ? (
        <Ionicons name="person-outline" size={12} color={colors.textMuted} />
      ) : null}
    </View>
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
  columns: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  column: {
    flex: 1,
    minWidth: 150,
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
  chip: { borderRadius: radius.pill },
  chipHovered: {},
  chipDragging: { opacity: 0.25 },
  chipFace: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  chipFaceDrag: {
    backgroundColor: colors.surface,
    ...shadows.card,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  // Compact face for the floating ghost: content hugs the centre so the name
  // sits under the finger rather than stretching to a column width.
  chipFaceCompact: { justifyContent: 'center' },
  chipNameCompact: { flex: 0, flexShrink: 1 },
  chipName: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  // LTR coordinate frame for the floating ghost so translateX maps to physical
  // page-X (matching the PanResponder coords) instead of being RTL-mirrored.
  overlayLayer: { ...StyleSheet.absoluteFillObject, direction: 'ltr', zIndex: 50 },
  dragGhost: { position: 'absolute', top: 0, left: 0 },
});
