// DraftBoardScreen — Step 2 of חלוקת כוחות (the heart of the feature).
//
// Captains pick players in turns. Tapping an available player assigns them
// to the team whose turn it is and auto-advances — no confirm button. The
// top shows whose turn it is + the pick path; teams are horizontal cards
// (so 2–4 never get cramped); available players are a clean photo+name
// list. When everyone is placed it flips to a summary with "סיים".

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TEAM_PALETTE } from '@/components/match/rotationView';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/Button';
import { appAlert } from '@/components/AppDialog';
import { DraftOrderPath } from '@/components/draft/DraftOrderPath';
import { DraftTeamCard } from '@/components/draft/DraftTeamCard';
import { GrowIn, ShrinkOut } from '@/components/draft/DraftScalePop';
import { Breathing } from '@/components/anim/Breathing';
import { useGameStore } from '@/store/gameStore';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { gameService } from '@/services';
import { toast } from '@/components/Toast';
import { logError } from '@/services/errorLog';
import { colors, radius, spacing, typography, shadows, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { DraftTeamsResult, Game } from '@/types';
import { toGuestRosterId, isGuestId } from '@/types';
import { buildPickOrder, reconstructPicks } from '@/utils/draft';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList>;
type Params = RouteProp<GameStackParamList, 'DraftBoard'>;

export function DraftBoardScreen() {
  const nav = useNavigation<Nav>();
  const { gameId, captainIds, method, resume, readOnly } =
    useRoute<Params>().params;

  const playersMap = useGameStore((s) => s.players);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  const currentUser = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);

  const [game, setGame] = useState<Game | null>(null);
  /** uids in the order they were picked; team = order[k]. Captains excluded. */
  const [picks, setPicks] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  /** Admin-chosen colour key per team index ("red" → "האדומים"). */
  const [teamColors, setTeamColors] = useState<Record<number, string>>({});
  /** Team index whose colour picker is open (null = closed). */
  const [pickerTeam, setPickerTeam] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = await gameService.getGameById(gameId);
        if (!alive) return;
        // Editing teams is manager-only; viewing (readOnly) stays open to
        // everyone. Bounce a non-manager who reaches the editable board.
        if (g && !readOnly) {
          const grp = myCommunities.find((c) => c.id === g.groupId);
          const isAdmin =
            !!currentUser &&
            (g.createdBy === currentUser.id ||
              (!!grp && grp.adminIds.includes(currentUser.id)));
          if (!isAdmin) {
            toast.info(he.draftAdminOnly);
            if (nav.canGoBack()) nav.goBack();
            return;
          }
        }
        setGame(g);
        if (g?.players?.length) hydratePlayers(g.players);
        // Resuming a saved draft → reconstruct the picks so we land on the
        // summary (and can still step back to edit).
        if (resume && g?.draftTeams) {
          // Drop anyone who left the game AFTER the draft was saved — the saved
          // roster can drift from the live one, and a stale id would otherwise
          // resume as a ghost member (or push a real player out of alignment).
          // Newly-joined players simply stay in the draftable pool to assign
          // (B19).
          const live = new Set<string>([
            ...(g.players ?? []),
            ...(g.guests ?? []).map((gu) => toGuestRosterId(gu.id)),
          ]);
          setPicks(reconstructPicks(g.draftTeams).filter((id) => live.has(id)));
          // Restore any colours chosen on the saved draft.
          const restored: Record<number, string> = {};
          for (const t of g.draftTeams.teams) {
            if (t.colorKey) restored[t.index] = t.colorKey;
          }
          if (Object.keys(restored).length) setTeamColors(restored);
        }
      } catch (err) {
        logError('draftBoardLoad', err, { gameId });
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId, hydratePlayers, readOnly, currentUser, myCommunities, nav]);

  // Roster = registered players (from the store) + per-game guests.
  const participants = useMemo<
    { id: string; name: string; avatarId?: string; photoUrl?: string }[]
  >(() => {
    if (!game) return [];
    const players = (game.players ?? []).map((uid) => {
      const p = playersMap[uid];
      return {
        id: uid,
        name: p?.displayName ?? '…',
        avatarId: p?.avatarId,
        photoUrl: p?.photoUrl,
      };
    });
    // Guests MUST carry the `guest:` roster-id prefix here — same as every
    // other surface (MatchDetails, live rotation). Using the raw guest id let
    // it leak through the `guest:`-prefix filters into per-player win/goal
    // stats, which created phantom /users docs (and spurious "new user"
    // pushes) keyed on the raw guest id. See toGuestRosterId.
    const guests = (game.guests ?? []).map((g) => ({
      id: toGuestRosterId(g.id),
      name: g.name,
    }));
    return [...players, ...guests];
  }, [game, playersMap]);
  const byId = useMemo(
    () => new Map(participants.map((p) => [p.id, p])),
    [participants],
  );
  const resolve = useCallback(
    (id: string) => byId.get(id) ?? { id, name: '…' },
    [byId],
  );
  // Tap a player chip → their card (guests have no card → skip).
  const openCard = useCallback(
    (id: string) => {
      if (isGuestId(id)) return; // guests have no player card
      nav.navigate('PlayerCard', { userId: id, groupId: game?.groupId });
    },
    [game?.guests, game?.groupId, nav],
  );

  const numTeams = captainIds.length;
  const draftable = useMemo(
    () => participants.filter((p) => !captainIds.includes(p.id)).map((p) => p.id),
    [participants, captainIds],
  );
  const order = useMemo(
    () => buildPickOrder(numTeams, draftable.length, method),
    [numTeams, draftable.length, method],
  );

  const assigned = useMemo(() => new Set(picks), [picks]);
  const pickIndex = picks.length;
  const done = order.length > 0 && pickIndex >= order.length;
  const currentTeam = done ? null : order[pickIndex] ?? 0;

  /** Drafted member uids for a given team, in pick order. */
  const membersOf = useCallback(
    (team: number) => picks.filter((_, k) => order[k] === team),
    [picks, order],
  );

  // ── Pick / undo with a shrink↔grow transition ───────────────────────
  // `ghost` is the item currently shrinking away IN PLACE after it moved:
  //   • where:'list' — a picked player shrinking out of the available list
  //     (it has already grown into its team card).
  //   • where:'team' — an un-picked player shrinking out of its team card
  //     (it has already grown back into the available list).
  // One at a time; taps are ignored while a ghost is animating.
  const [ghost, setGhost] = useState<
    { uid: string; where: 'list' | 'team'; team?: number } | null
  >(null);

  const pick = useCallback(
    (uid: string) => {
      if (done || ghost) return;
      setPicks((prev) => [...prev, uid]);
      setGhost({ uid, where: 'list' });
    },
    [done, ghost],
  );

  const undo = useCallback(() => {
    if (ghost) return;
    setPicks((prev) => {
      if (prev.length === 0) return prev;
      const removed = prev[prev.length - 1];
      const removedTeam = order[prev.length - 1];
      setGhost({ uid: removed, where: 'team', team: removedTeam });
      return prev.slice(0, -1);
    });
  }, [ghost, order]);

  // When the last pick completes the draft we flip to the summary and the
  // board (with its shrinking ghost) unmounts — clear the ghost so it can't
  // block a later undo ("חזרה לתיקון").
  useEffect(() => {
    if (done && ghost) setGhost(null);
  }, [done, ghost]);

  // Rows to render in the available list — `available` plus, when a picked
  // player is still shrinking out, that player held in its ORIGINAL slot.
  const ghostListUid = ghost?.where === 'list' ? ghost.uid : null;
  const listUids = useMemo(
    () => draftable.filter((p) => !assigned.has(p) || p === ghostListUid),
    [draftable, assigned, ghostListUid],
  );

  const finish = useCallback(async () => {
    if (!currentUser) return;
    const result: DraftTeamsResult = {
      method,
      numTeams,
      createdAt: Date.now(),
      createdBy: currentUser.id,
      teams: Array.from({ length: numTeams }, (_, t) => ({
        index: t,
        captainId: captainIds[t],
        playerIds: [captainIds[t], ...membersOf(t)],
        ...(teamColors[t] ? { colorKey: teamColors[t] } : {}),
      })),
      // A fresh split starts as a DRAFT — visible only to the organiser until
      // they tap "פרסם כוחות". No push fires on save.
      published: false,
    };
    setSaving(true);
    try {
      await gameService.saveDraftTeams(gameId, result);
      appAlert(he.draftTitle, he.draftSaved);
      nav.navigate('MatchDetails', { gameId });
    } catch (err) {
      logError('draftSave', err, { gameId });
      appAlert(he.draftTitle, he.draftSaveError);
    } finally {
      setSaving(false);
    }
    // teamColors MUST be here — the summary screen sets colours AFTER this
    // callback was memoised, so without it `finish` saved the stale (empty)
    // colours and the user's picks silently vanished.
  }, [currentUser, method, numTeams, captainIds, membersOf, gameId, nav, teamColors]);

  // ── Summary view ────────────────────────────────────────────────────
  if (done) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.draftTitle} />
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.summaryHead}>
            <View style={styles.summaryIcon}>
              <Ionicons name="trophy" size={26} color={colors.primary} />
            </View>
            <Text style={styles.summaryTitle}>{he.draftSummaryTitle}</Text>
            <Text style={styles.summarySub}>{he.draftSummarySubtitle}</Text>
          </View>
          <View style={styles.summaryList}>
            {Array.from({ length: numTeams }, (_, t) => (
              <DraftTeamCard
                key={t}
                index={t}
                captain={resolve(captainIds[t])}
                members={membersOf(t).map(resolve)}
                onPressUser={openCard}
                colorKey={teamColors[t]}
                onPickColor={readOnly ? undefined : () => setPickerTeam(t)}
              />
            ))}
          </View>
        </ScrollView>
        {readOnly ? (
          // Players just view the teams — back via the header.
          <View style={styles.footer}>
            <Button
              title={he.close}
              onPress={() => nav.goBack()}
              variant="outline"
              size="lg"
              fullWidth
            />
          </View>
        ) : (
          <View style={styles.footer}>
            <View style={styles.summaryActions}>
              {/* Go back one pick to fix a mistake before finalizing. */}
              <Button
                title={he.draftBackToEdit}
                onPress={undo}
                variant="outline"
                size="lg"
                iconLeft="arrow-undo-outline"
                style={styles.flexBtn}
              />
              <Button
                title={he.draftFinish}
                onPress={finish}
                loading={saving}
                size="lg"
                iconLeft="checkmark-circle"
                style={styles.flexBtn}
              />
            </View>
          </View>
        )}

        {/* Team colour picker — names the team by its colour in plural. */}
        <Modal
          visible={pickerTeam !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setPickerTeam(null)}
        >
          <Pressable style={styles.pickerBackdrop} onPress={() => setPickerTeam(null)}>
            <Pressable style={styles.pickerSheet} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.pickerTitle}>{he.teamColorTitle}</Text>
              <View style={styles.pickerGrid}>
                {TEAM_PALETTE.map((c) => {
                  const taken = Object.entries(teamColors).some(
                    ([idx, k]) => k === c.key && Number(idx) !== pickerTeam,
                  );
                  const selected = pickerTeam !== null && teamColors[pickerTeam] === c.key;
                  return (
                    <Pressable
                      key={c.key}
                      disabled={taken}
                      onPress={() => {
                        if (pickerTeam === null) return;
                        setTeamColors((prev) => ({ ...prev, [pickerTeam]: c.key }));
                        setPickerTeam(null);
                      }}
                      style={styles.pickerItem}
                    >
                      <View
                        style={[
                          styles.pickerSwatch,
                          { backgroundColor: c.hex, opacity: taken ? 0.3 : 1 },
                          selected && styles.pickerSwatchSel,
                          c.light && styles.pickerSwatchLight,
                        ]}
                      >
                        {selected ? (
                          <Ionicons name="checkmark" size={20} color={c.light ? '#111' : '#fff'} />
                        ) : null}
                      </View>
                      <Text style={styles.pickerLabel}>{c.plural}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {pickerTeam !== null && teamColors[pickerTeam] ? (
                <Pressable
                  style={styles.pickerClear}
                  onPress={() => {
                    setTeamColors((prev) => {
                      const next = { ...prev };
                      if (pickerTeam !== null) delete next[pickerTeam];
                      return next;
                    });
                    setPickerTeam(null);
                  }}
                >
                  <Text style={styles.pickerClearTxt}>{he.teamColorClear}</Text>
                </Pressable>
              ) : null}
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    );
  }

  // ── Draft board ─────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.draftTitle} />
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.stepChip}>
          <Text style={styles.stepText}>{he.draftStepLabel(2, 2)}</Text>
        </View>

        {/* Pick path — captain avatars; the active pick is enlarged + ringed.
            No "whose turn" text: the team card itself pulses below. */}
        <View style={styles.pathWrap}>
          <DraftOrderPath
            order={order}
            activeIndex={pickIndex}
            captains={captainIds.map(resolve)}
          />
        </View>

        {/* Teams — one full-width card per row, stacked. The team whose
            turn it is pulses (big↔small) instead of a text banner. */}
        <View style={styles.teamsCol}>
          {Array.from({ length: numTeams }, (_, t) => (
            <Breathing
              key={t}
              active={currentTeam === t}
              amount={0.02}
              periodMs={1050}
            >
              <DraftTeamCard
                index={t}
                captain={resolve(captainIds[t])}
                members={membersOf(t).map(resolve)}
                highlight={currentTeam === t}
                onPressUser={openCard}
                // Newly-drafted chips grow in; an un-picked one shrinks out.
                growMembers
                ghostMember={
                  ghost?.where === 'team' && ghost.team === t
                    ? resolve(ghost.uid)
                    : undefined
                }
                onGhostDone={() => setGhost(null)}
              />
            </Breathing>
          ))}
        </View>

        {/* Undo last pick — for an accidental tap. */}
        {pickIndex > 0 ? (
          <PressableScale style={styles.undoBtn} onPress={undo}>
            {/* Inner row — PressableScale stacks its children in a column,
                so icon+text must share an explicit flex-row wrapper. */}
            <View style={styles.undoInner}>
              <Ionicons name="arrow-undo-outline" size={16} color={colors.primary} />
              <Text style={styles.undoText}>{he.draftUndo}</Text>
            </View>
          </PressableScale>
        ) : null}

        {/* Available players */}
        <Text style={styles.availTitle}>{he.draftAvailableTitle}</Text>
        <View style={styles.availList}>
          {listUids.map((uid) => {
            const u = resolve(uid);
            const row = (
              <View style={styles.availRow}>
                {/* Avatar + name grouped on the right; בחר alone on the left. */}
                <View style={styles.availIdentity}>
                  <UserAvatar user={u} size={42} />
                  <Text style={styles.availName} numberOfLines={1}>
                    {u.name}
                  </Text>
                </View>
                <PressableScale style={styles.pickBtn} onPress={() => pick(uid)}>
                  <Text style={styles.pickBtnText}>{he.draftPick}</Text>
                </PressableScale>
              </View>
            );
            // The just-picked player shrinks out of its slot; everyone else
            // grows in (on board open, or when an undo returns them).
            return uid === ghostListUid ? (
              <ShrinkOut key={uid} onDone={() => setGhost(null)}>
                {row}
              </ShrinkOut>
            ) : (
              <GrowIn key={uid}>{row}</GrowIn>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  pickerSheet: { width: '100%', maxWidth: 380, backgroundColor: colors.bg, borderRadius: 22, padding: spacing.lg, gap: spacing.md },
  pickerTitle: { ...typography.h3, color: colors.text, fontWeight: '800', textAlign: 'center' },
  pickerGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md },
  pickerItem: { alignItems: 'center', gap: 6, width: 76 },
  pickerSwatch: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  pickerSwatchSel: { borderColor: colors.text },
  pickerSwatchLight: { borderWidth: 1, borderColor: colors.border },
  pickerLabel: { ...typography.caption, color: colors.text, fontWeight: '700' },
  pickerClear: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  pickerClearTxt: { ...typography.body, color: colors.textMuted, fontWeight: '700' },
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  stepChip: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    marginBottom: spacing.md,
  },
  stepText: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  pathWrap: { marginBottom: spacing.lg },
  // One full-width team card per row, stacked vertically.
  teamsCol: { gap: spacing.md, paddingHorizontal: 2, paddingVertical: 4 },
  // Light, compact "undo" chip — a secondary action, not a heavy outline.
  undoBtn: {
    alignSelf: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryLight,
  },
  undoInner: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  undoText: {
    ...typography.caption,
    fontSize: 13,
    color: colors.primary,
    fontWeight: '800',
  },
  availTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  availList: { gap: spacing.xs },
  availRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  availIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 1,
  },
  availName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  pickBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pickBtnText: { ...typography.button, color: '#FFFFFF', fontWeight: '800' },
  // summary
  summaryHead: { alignItems: 'center', marginBottom: spacing.lg },
  summaryIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  summaryTitle: {
    ...typography.h2,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'center',
  },
  summarySub: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
  summaryList: { gap: spacing.md },
  footer: {
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  summaryActions: { flexDirection: 'row', gap: spacing.md },
  flexBtn: { flex: 1 },
});
