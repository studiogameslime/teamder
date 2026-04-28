// LiveMatchScreen — single-screen, role-aware live match.
//
// No game states. No "I'm late" / "I've arrived" / "Start match" / "Finish".
// Coach has full control (drag, score, shuffle, undo, search, cancel).
// Player is view-only.
//
// Timer is local-only (per device) and not persisted to Firestore.
// Source duration: game.matchDurationMinutes (fallback: 8 min).
//
// Layout:
//   ┌──────────────────────────────────────────┐
//   │  [- score +]   MM:SS / 08:00   [- score +]│   compact header
//   ├──────────────────────────────────────────┤
//   │                                           │
//   │           Team A area (top)               │
//   │                                           │
//   │   ───────── center line ─────────         │
//   │                                           │
//   │           Team B area (bottom)            │
//   │                                           │
//   ├──────────────────────────────────────────┤
//   │   bench (horizontal scroll)               │
//   └──────────────────────────────────────────┘
//   FABs (coach only): right side = timer + search
//                       left side  = shuffle + undo + cancel

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type View as RNView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  GestureDetector,
  GestureHandlerRootView,
  Gesture,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  RouteProp,
  useNavigation,
  useRoute,
} from '@react-navigation/native';

import { PlayerIdentity } from '@/components/PlayerIdentity';
import { gameService } from '@/services/gameService';
import {
  Game,
  LiveMatchState,
  LiveMatchZone,
  UserId,
} from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGameStore } from '@/store/gameStore';
import { useGroupStore } from '@/store/groupStore';
import type { GameStackParamList } from '@/navigation/GameStack';

type Zone = LiveMatchZone;
type ZoneRect = { x: number; y: number; w: number; h: number };

const DEFAULT_DURATION_MIN = 8;

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function shuffle<T>(xs: T[]): T[] {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Fresh state — everyone on the bench in registration order. */
function makeFreshState(playerIds: UserId[]): LiveMatchState {
  const assignments: Record<UserId, Zone> = {};
  playerIds.forEach((uid) => {
    assignments[uid] = 'bench';
  });
  return {
    phase: 'organizing', // legacy field, no longer drives any UI
    assignments,
    benchOrder: [...playerIds],
    scoreA: 0,
    scoreB: 0,
    lateUserIds: [], // legacy field, never written by this screen
  };
}

/** Add new players to bench / drop departed ones. */
function reconcile(
  state: LiveMatchState,
  rosterIds: UserId[],
): LiveMatchState {
  const roster = new Set(rosterIds);
  const next: LiveMatchState = {
    ...state,
    assignments: { ...state.assignments },
    benchOrder: state.benchOrder.filter((id) => roster.has(id)),
    lateUserIds: state.lateUserIds.filter((id) => roster.has(id)),
  };
  for (const uid of Object.keys(next.assignments)) {
    if (!roster.has(uid)) delete next.assignments[uid];
  }
  for (const uid of rosterIds) {
    if (!next.assignments[uid]) {
      next.assignments[uid] = 'bench';
      if (!next.benchOrder.includes(uid)) next.benchOrder.push(uid);
    }
  }
  return next;
}

// ─── Screen ───────────────────────────────────────────────────────────────

type Params = RouteProp<GameStackParamList, 'LiveMatch'>;

export function LiveMatchScreen() {
  const route = useRoute<Params>();
  const nav = useNavigation();
  const gameId = route.params?.gameId ?? null;
  const me = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);

  const [game, setGame] = useState<Game | null>(null);
  const [live, setLive] = useState<LiveMatchState | null>(null);

  // Local timer (not synced).
  const [timerMs, setTimerMs] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);

  const [busyCancel, setBusyCancel] = useState(false);

  // 1-step undo for drag/shuffle.
  const undoStackRef = useRef<LiveMatchState[]>([]);
  const [hasUndo, setHasUndo] = useState(false);

  // Page-coord rectangles per zone for hit-testing during drag.
  const zoneRefs = useRef<Record<Zone, RNView | null>>({
    teamA: null,
    teamB: null,
    bench: null,
    gkA: null,
    gkB: null,
  });
  const zoneRectsRef = useRef<Record<Zone, ZoneRect | null>>({
    teamA: null,
    teamB: null,
    bench: null,
    gkA: null,
    gkB: null,
  });
  const remeasureZone = useCallback((z: Zone) => {
    const v = zoneRefs.current[z];
    if (!v) return;
    v.measureInWindow((x, y, w, h) => {
      zoneRectsRef.current[z] = { x, y, w, h };
    });
  }, []);
  const remeasureZones = useCallback(() => {
    (Object.keys(zoneRefs.current) as Zone[]).forEach((z) => remeasureZone(z));
  }, [remeasureZone]);

  // ─── Load the game once ────────────────────────────────────────────────
  useEffect(() => {
    if (!gameId || !me) return;
    let alive = true;
    (async () => {
      const myCommunityIds = myCommunities.map((g) => g.id);
      const [mine, community] = await Promise.all([
        gameService.getMyGames(me.id).catch(() => [] as Game[]),
        gameService
          .getCommunityGames(me.id, myCommunityIds)
          .catch(() => [] as Game[]),
      ]);
      const g =
        mine.find((x) => x.id === gameId) ??
        community.find((x) => x.id === gameId) ??
        null;
      if (alive) setGame(g);
    })();
    return () => {
      alive = false;
    };
  }, [gameId, me, myCommunities]);

  // ─── Hydrate user → display name / jersey lookup ───────────────────────
  useEffect(() => {
    if (!game) return;
    hydratePlayers(game.players);
  }, [game?.id, hydratePlayers]);

  // ─── Realtime sync of LiveMatchState ───────────────────────────────────
  useEffect(() => {
    if (!gameId || !game) return;
    const unsub = gameService.subscribeLiveMatch(gameId, (state) => {
      const initial = state ?? makeFreshState(game.players);
      setLive(reconcile(initial, game.players));
    });
    return unsub;
  }, [gameId, game]);

  // ─── Local timer tick ──────────────────────────────────────────────────
  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => setTimerMs((t) => t + 1000), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  // ─── Role detection ────────────────────────────────────────────────────
  const isAdmin = useMemo(() => {
    if (!me || !game) return false;
    if (game.createdBy === me.id) return true;
    const grp = myCommunities.find((g) => g.id === game.groupId);
    return !!grp && grp.adminIds.includes(me.id);
  }, [me, game, myCommunities]);

  // ─── Persist + commit helpers ──────────────────────────────────────────
  // `markEdited` propagates to the gameService write so the Game doc's
  // `teamsEditedManually` flag flips. Score-only commits leave the
  // flag alone — only assignment changes (drag, shuffle, undo) count
  // as manual team edits and lock out the auto-balance scheduler.
  const commit = useCallback(
    (
      next: LiveMatchState,
      opts: { undoable?: boolean; markEdited?: boolean } = {},
    ) => {
      if (!gameId) return;
      if (live && opts.undoable) {
        undoStackRef.current.push(live);
        if (undoStackRef.current.length > 1) {
          undoStackRef.current = undoStackRef.current.slice(-1);
        }
        setHasUndo(true);
      }
      setLive(next);
      gameService
        .setLiveMatch(gameId, next, {
          markTeamsEditedManually: !!opts.markEdited,
        })
        .catch((err) => {
          if (__DEV__) console.warn('[live] setLiveMatch failed', err);
        });
    },
    [gameId, live],
  );

  // ─── Mutations (admin-only) ────────────────────────────────────────────
  const place = useCallback(
    (uid: UserId, zone: Zone) => {
      if (!live || !isAdmin) return;
      const next: LiveMatchState = {
        ...live,
        assignments: { ...live.assignments },
        benchOrder: live.benchOrder.slice(),
      };
      // GK slots are single-occupancy — push displaced keeper back to team.
      if (zone === 'gkA') {
        const existing = (Object.keys(next.assignments) as UserId[]).find(
          (k) => next.assignments[k] === 'gkA' && k !== uid,
        );
        if (existing) next.assignments[existing] = 'teamA';
      } else if (zone === 'gkB') {
        const existing = (Object.keys(next.assignments) as UserId[]).find(
          (k) => next.assignments[k] === 'gkB' && k !== uid,
        );
        if (existing) next.assignments[existing] = 'teamB';
      }
      next.assignments[uid] = zone;
      next.benchOrder = next.benchOrder.filter((x) => x !== uid);
      if (zone === 'bench') next.benchOrder.push(uid);
      commit(next, { undoable: true, markEdited: true });
    },
    [live, isAdmin, commit],
  );

  const handleDrop = useCallback(
    (uid: UserId, pageX: number, pageY: number) => {
      if (!isAdmin) return;
      const rects = zoneRectsRef.current;
      // GK zones first so a drop near the goal line outranks the team body.
      const order: Zone[] = ['gkA', 'gkB', 'teamA', 'teamB', 'bench'];
      for (const z of order) {
        const r = rects[z];
        if (!r) continue;
        if (
          pageX >= r.x &&
          pageX <= r.x + r.w &&
          pageY >= r.y &&
          pageY <= r.y + r.h
        ) {
          place(uid, z);
          return;
        }
      }
    },
    [place, isAdmin],
  );

  const handleShuffle = useCallback(() => {
    if (!game || !live || !isAdmin) return;
    const shuffled = shuffle(game.players);
    const half = Math.ceil(shuffled.length / 2);
    const a = new Set(shuffled.slice(0, half));
    const b = new Set(shuffled.slice(half));
    const assignments: Record<UserId, Zone> = {};
    const benchOrder: UserId[] = [];
    game.players.forEach((uid) => {
      if (a.has(uid)) assignments[uid] = 'teamA';
      else if (b.has(uid)) assignments[uid] = 'teamB';
      else {
        assignments[uid] = 'bench';
        benchOrder.push(uid);
      }
    });
    commit(
      { ...live, assignments, benchOrder },
      { undoable: true, markEdited: true },
    );
  }, [game, live, isAdmin, commit]);

  const handleUndo = useCallback(() => {
    if (!isAdmin || !gameId) return;
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    setHasUndo(undoStackRef.current.length > 0);
    setLive(prev);
    gameService
      .setLiveMatch(gameId, prev, { markTeamsEditedManually: true })
      .catch((err) => {
        if (__DEV__) console.warn('[live] undo persist failed', err);
      });
  }, [isAdmin, gameId]);

  const handleScore = (team: 'A' | 'B', delta: number) => {
    if (!live || !isAdmin) return;
    commit({
      ...live,
      scoreA: team === 'A' ? Math.max(0, live.scoreA + delta) : live.scoreA,
      scoreB: team === 'B' ? Math.max(0, live.scoreB + delta) : live.scoreB,
    });
  };

  const handleCancelGame = () => {
    if (!game || !isAdmin || busyCancel) return;
    Alert.alert(he.liveCancelConfirmTitle, he.liveCancelConfirmBody, [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.liveCancelGame,
        style: 'destructive',
        onPress: async () => {
          if (busyCancel) return;
          setBusyCancel(true);
          try {
            await gameService.cancelGameByAdmin(game.id);
            nav.goBack();
          } catch (e) {
            Alert.alert(he.error, String((e as Error).message ?? e));
            setBusyCancel(false);
          }
        },
      },
    ]);
  };

  const goSearch = () => {
    if (!game) return;
    (
      nav as { navigate: (s: string, p: unknown) => void }
    ).navigate('AvailablePlayers', { gameId: game.id });
  };

  // ─── Derived lists ─────────────────────────────────────────────────────
  const inZone = useCallback(
    (z: Zone): UserId[] => {
      if (!live) return [];
      if (z === 'bench') {
        return live.benchOrder.filter((uid) => live.assignments[uid] === 'bench');
      }
      return (Object.keys(live.assignments) as UserId[]).filter(
        (uid) => live.assignments[uid] === z,
      );
    },
    [live],
  );
  const teamAPlayers = useMemo(() => inZone('teamA'), [inZone]);
  const teamBPlayers = useMemo(() => inZone('teamB'), [inZone]);
  const benchPlayers = useMemo(() => inZone('bench'), [inZone]);
  const gkA = useMemo(() => inZone('gkA')[0], [inZone]);
  const gkB = useMemo(() => inZone('gkB')[0], [inZone]);

  // Total match duration (ms) for the timer display.
  const totalMs =
    (game?.matchDurationMinutes ?? DEFAULT_DURATION_MIN) * 60 * 1000;

  // ─── Render ───────────────────────────────────────────────────────────
  if (!gameId || !game || !live) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{he.gameLoading}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {/* ─── HEADER ─── */}
        <View style={styles.header}>
          <ScoreBlock
            label={he.liveTeamA}
            value={live.scoreA}
            tint={colors.team1}
            isAdmin={isAdmin}
            onPlus={() => handleScore('A', 1)}
            onMinus={() => handleScore('A', -1)}
          />
          <View style={styles.timerWrap}>
            <Text style={styles.timer}>{formatTime(timerMs)}</Text>
            <Text style={styles.timerTotal}>/ {formatTime(totalMs)}</Text>
          </View>
          <ScoreBlock
            label={he.liveTeamB}
            value={live.scoreB}
            tint={colors.team2}
            isAdmin={isAdmin}
            onPlus={() => handleScore('B', 1)}
            onMinus={() => handleScore('B', -1)}
          />
        </View>

        {/* ─── FIELD ─── */}
        <View
          style={styles.field}
          onLayout={remeasureZones}
        >
          {/* Top half — Team A */}
          <View
            ref={(v) => {
              zoneRefs.current.teamA = v;
            }}
            onLayout={() => remeasureZone('teamA')}
            style={styles.halfTop}
          >
            <View
              ref={(v) => {
                zoneRefs.current.gkA = v;
              }}
              onLayout={() => remeasureZone('gkA')}
              style={[styles.gkSlot, styles.gkSlotTop]}
            >
              {gkA ? (
                <DraggablePlayer
                  uid={gkA}
                  isMe={gkA === me?.id}
                  isAdmin={isAdmin}
                  size={48}
                  onDrop={handleDrop}
                  remeasure={remeasureZones}
                  badge="🧤"
                />
              ) : null}
            </View>
            <View style={styles.teamArea}>
              {teamAPlayers.map((uid) => (
                <DraggablePlayer
                  key={uid}
                  uid={uid}
                  isMe={uid === me?.id}
                  isAdmin={isAdmin}
                  size={44}
                  onDrop={handleDrop}
                  remeasure={remeasureZones}
                />
              ))}
            </View>
          </View>

          {/* Center line */}
          <View style={styles.centerLine} />

          {/* Bottom half — Team B */}
          <View
            ref={(v) => {
              zoneRefs.current.teamB = v;
            }}
            onLayout={() => remeasureZone('teamB')}
            style={styles.halfBottom}
          >
            <View style={styles.teamArea}>
              {teamBPlayers.map((uid) => (
                <DraggablePlayer
                  key={uid}
                  uid={uid}
                  isMe={uid === me?.id}
                  isAdmin={isAdmin}
                  size={44}
                  onDrop={handleDrop}
                  remeasure={remeasureZones}
                />
              ))}
            </View>
            <View
              ref={(v) => {
                zoneRefs.current.gkB = v;
              }}
              onLayout={() => remeasureZone('gkB')}
              style={[styles.gkSlot, styles.gkSlotBottom]}
            >
              {gkB ? (
                <DraggablePlayer
                  uid={gkB}
                  isMe={gkB === me?.id}
                  isAdmin={isAdmin}
                  size={48}
                  onDrop={handleDrop}
                  remeasure={remeasureZones}
                  badge="🧤"
                />
              ) : null}
            </View>
          </View>
        </View>

        {/* ─── BENCH ─── */}
        <View
          ref={(v) => {
            zoneRefs.current.bench = v;
          }}
          onLayout={() => remeasureZone('bench')}
          style={styles.bench}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.benchRow}
          >
            {benchPlayers.length === 0 ? (
              <Text style={styles.benchEmpty}>{he.liveBench}</Text>
            ) : (
              benchPlayers.map((uid) => (
                <DraggablePlayer
                  key={uid}
                  uid={uid}
                  isMe={uid === me?.id}
                  isAdmin={isAdmin}
                  size={36}
                  onDrop={handleDrop}
                  remeasure={remeasureZones}
                />
              ))
            )}
          </ScrollView>
        </View>

        {/* ─── FABs (coach only) ─── */}
        {isAdmin ? (
          <>
            {/* Right column — primary controls (timer + search) */}
            <View style={[styles.fabColumn, styles.fabColumnRight]}>
              <FAB
                icon={timerRunning ? 'pause' : 'play'}
                tint={colors.primary}
                onPress={() => setTimerRunning((v) => !v)}
                onLongPress={() => {
                  setTimerRunning(false);
                  setTimerMs(0);
                }}
                accessibilityLabel="timer"
              />
              <FAB
                icon="search"
                onPress={goSearch}
                accessibilityLabel="search"
              />
            </View>
            {/* Left column — secondary controls */}
            <View style={[styles.fabColumn, styles.fabColumnLeft]}>
              <FAB
                icon="shuffle"
                onPress={handleShuffle}
                accessibilityLabel="shuffle"
              />
              <FAB
                icon="arrow-undo"
                onPress={handleUndo}
                disabled={!hasUndo}
                accessibilityLabel="undo"
              />
              <FAB
                icon="close"
                tint={colors.danger}
                onPress={handleCancelGame}
                disabled={busyCancel}
                accessibilityLabel="cancel-game"
              />
            </View>
          </>
        ) : null}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function ScoreBlock({
  label,
  value,
  tint,
  isAdmin,
  onPlus,
  onMinus,
}: {
  label: string;
  value: number;
  tint: string;
  isAdmin: boolean;
  onPlus: () => void;
  onMinus: () => void;
}) {
  return (
    <View style={styles.scoreBlock}>
      <Text style={[styles.scoreLabel, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.scoreRow}>
        {isAdmin ? (
          <Pressable onPress={onMinus} hitSlop={8} style={styles.scoreCtl}>
            <Ionicons name="remove" size={14} color={colors.textMuted} />
          </Pressable>
        ) : null}
        <Text style={[styles.scoreValue, { color: tint }]}>{value}</Text>
        {isAdmin ? (
          <Pressable onPress={onPlus} hitSlop={8} style={styles.scoreCtl}>
            <Ionicons name="add" size={14} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function FAB({
  icon,
  tint,
  onPress,
  onLongPress,
  disabled,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint?: string;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.fab,
        tint
          ? { backgroundColor: tint }
          : { backgroundColor: colors.surface },
        disabled && { opacity: 0.4 },
        pressed && !disabled && { transform: [{ scale: 0.95 }] },
      ]}
    >
      <Ionicons
        name={icon}
        size={20}
        color={tint ? '#fff' : colors.text}
      />
    </Pressable>
  );
}

interface DragProps {
  uid: UserId;
  isMe: boolean;
  isAdmin: boolean;
  size: number;
  onDrop: (uid: UserId, pageX: number, pageY: number) => void;
  remeasure: () => void;
  badge?: string;
}

function DraggablePlayer({
  uid,
  isMe,
  isAdmin,
  size,
  onDrop,
  remeasure,
  badge,
}: DragProps) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const z = useSharedValue(0);

  const playersMap = useGameStore((s) => s.players);
  const p = playersMap[uid];
  const name = p?.displayName ?? '';
  const jersey = p?.jersey;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
    zIndex: z.value,
  }));

  const handleEnd = (pageX: number, pageY: number) => {
    onDrop(uid, pageX, pageY);
    requestAnimationFrame(remeasure);
  };

  const pan = Gesture.Pan()
    .enabled(isAdmin)
    .onStart(() => {
      'worklet';
      scale.value = withSpring(1.15);
      z.value = 100;
    })
    .onUpdate((e) => {
      'worklet';
      tx.value = e.translationX;
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      'worklet';
      runOnJS(handleEnd)(e.absoluteX, e.absoluteY);
      tx.value = withSpring(0);
      ty.value = withSpring(0);
      scale.value = withSpring(1);
      z.value = 0;
    });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.draggable, animatedStyle]}>
        <View
          style={[
            styles.playerOuter,
            { width: size + 4 },
            isMe && styles.playerOuterMe,
          ]}
        >
          <PlayerIdentity
            user={{ id: uid, name: name || '?', jersey }}
            size={size}
          />
          {badge ? (
            <View style={styles.gkBadge}>
              <Text style={styles.gkBadgeText}>{badge}</Text>
            </View>
          ) : null}
          {name ? (
            <Text
              style={styles.playerName}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {name}
            </Text>
          ) : null}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const FAB_SIZE = 48;
const FAB_GAP = 10;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { ...typography.body, color: colors.textMuted },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  scoreBlock: {
    alignItems: 'center',
    minWidth: 90,
  },
  scoreLabel: {
    ...typography.caption,
    fontWeight: '700',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  scoreValue: {
    ...typography.h1,
    fontWeight: '900',
    minWidth: 28,
    textAlign: 'center',
  },
  scoreCtl: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  timerWrap: {
    alignItems: 'center',
    flex: 1,
  },
  timer: {
    ...typography.h2,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  timerTotal: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: -2,
  },

  // Field
  field: {
    flex: 1,
    backgroundColor: colors.field,
    margin: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  halfTop: {
    flex: 1,
    alignItems: 'center',
    paddingTop: spacing.md,
  },
  halfBottom: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: spacing.md,
  },
  centerLine: {
    height: 2,
    backgroundColor: colors.fieldLine,
    opacity: 0.7,
    marginVertical: spacing.xs,
  },
  gkSlot: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  gkSlotTop: { marginTop: 0, marginBottom: spacing.sm },
  gkSlotBottom: { marginTop: spacing.sm, marginBottom: 0 },
  teamArea: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  // Bench
  bench: {
    height: 76,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  benchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  benchEmpty: {
    ...typography.caption,
    color: colors.textMuted,
    paddingVertical: spacing.md,
  },

  // FABs
  fabColumn: {
    position: 'absolute',
    bottom: 76 + spacing.lg,
    gap: FAB_GAP,
  },
  fabColumnRight: { right: spacing.md },
  fabColumnLeft: { left: spacing.md },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    // soft drop shadow
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },

  // Players
  draggable: {
    margin: 2,
  },
  playerOuter: {
    alignItems: 'center',
    padding: 2,
    borderRadius: radius.md,
  },
  playerOuterMe: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  playerName: {
    ...typography.caption,
    color: '#fff',
    marginTop: 2,
    maxWidth: 60,
    textAlign: 'center',
  },
  gkBadge: {
    position: 'absolute',
    top: -4,
    end: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  gkBadgeText: { fontSize: 11 },
});
