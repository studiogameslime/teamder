// RotationPanel — the live "winner stays" surface on LiveMatchScreen.
// A live-scoreboard card (the two teams on the pitch: trophies + win streak +
// player count + a single avatar row, fillers starred) plus the waiting-teams
// queue below it. Declaring a winner happens via the WinnerPickerModal, so this
// surface is display-only. All math lives in rotationEngine.

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { TeamScore } from '@/components/match/TeamScore';
import {
  PlayerActionMenu,
  MeasurablePressable,
  type PlayerMenuTarget,
  type PlayerMenuItem,
} from '@/components/match/PlayerActionMenu';
import {
  buildRoster,
  draftRoster,
  firstName,
  makeResolver,
  teamName,
  teamColor,
  type PlayerLite,
  type RosterMember,
} from '@/components/match/rotationView';
import type { DraftTeamsResult, MatchRotation } from '@/types';
import { colors, spacing, radius, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

/** ms epoch → "HH:MM" for the "went home" departure time. */
function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface Props {
  draftTeams?: DraftTeamsResult;
  rotation?: MatchRotation;
  playersMap: Record<string, PlayerLite>;
  guests?: { id: string; name: string }[];
  /** Goals per player this round — shown in each roster row's badge. */
  goalsByPlayer?: Record<string, number>;
  /** Admin can open the per-player action menu (went-home / restore). */
  isAdmin?: boolean;
  /** Marking "went home" is only allowed BETWEEN rounds — false while the
   *  match clock is running. */
  canMarkHome?: boolean;
  /** Open a player's card. */
  onPlayerCard?: (playerId: string) => void;
  /** Mark a player as having left for the evening. */
  onPlayerWentHome?: (player: { id: string; name: string }) => void;
  /** Restore a player who had gone home. */
  onRestorePlayer?: (player: { id: string; name: string }) => void;
  /** Swap two on-field players ("החלפה"). */
  onSwapPlayers?: (aId: string, bId: string) => void;
}

type MenuTarget = PlayerMenuTarget & { kind: 'active' | 'left' };

export function RotationPanel({
  draftTeams,
  rotation,
  playersMap,
  guests,
  goalsByPlayer,
  isAdmin,
  canMarkHome,
  onPlayerCard,
  onPlayerWentHome,
  onRestorePlayer,
  onSwapPlayers,
}: Props) {
  const [openTeam, setOpenTeam] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  // Non-null while "החלפה" is active: the id of the picked source player.
  const [swapSource, setSwapSource] = useState<string | null>(null);
  const handleSwapTap = (id: string) => {
    if (!swapSource) return;
    if (id !== swapSource) onSwapPlayers?.(swapSource, id);
    setSwapSource(null);
  };

  if (!draftTeams || draftTeams.teams.length < 2 || !rotation) return null;

  const resolve = makeResolver(playersMap, guests);
  const teams = draftTeams.teams.map((t) => ({ index: t.index, playerIds: t.playerIds }));
  const [aIdx, bIdx] = rotation.playing;
  // "Filler" only applies to TEMPORARY fill mode (a borrowed player who returns
  // home). In PERMANENT mode a player who completed a team has actually moved
  // there — they're not a filler, so never star them.
  const temporary = (draftTeams.fillMode ?? 'temporary') === 'temporary';
  const clean = (r: RosterMember[]) =>
    temporary ? r : r.map((m) => ({ ...m, isFiller: false, fromTeam: undefined }));
  const rosterA = clean(buildRoster(aIdx, teams, rotation, resolve));
  const rosterB = clean(buildRoster(bIdx, teams, rotation, resolve));
  const winsOf = (i: number) => rotation.wins?.[String(i)] ?? 0;

  // Filler legend — name the specific player(s) + their home team, so it's
  // clear WHO is completing the team.
  const fillers = [...rosterA, ...rosterB].filter((m) => m.isFiller && m.fromTeam != null);

  const openRoster: RosterMember[] =
    openTeam != null ? draftRoster(openTeam, teams, resolve) : [];

  // Players who left for the evening — resolved to display cards.
  const leftHomeList = (draftTeams.leftHome ?? []).map((l) => {
    const r = resolve(l.playerId);
    return {
      id: l.playerId,
      name: r.displayName ?? '…',
      avatarId: r.avatarId,
      photoUrl: r.photoUrl,
      at: l.at,
    };
  });

  const isRegistered = (id: string) => !!playersMap[id];
  const openMenu = (m: RosterMember | typeof leftHomeList[number], rect: PlayerMenuTarget['anchor'], kind: MenuTarget['kind']) =>
    setMenu({
      player: { id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl },
      anchor: rect,
      kind,
    });

  // Build the menu items for whoever is currently tapped (action depends on
  // whether they're on the field or already in the "went home" list).
  const menuItems: PlayerMenuItem[] = (() => {
    if (!menu) return [];
    const p = menu.player;
    const cardItem: PlayerMenuItem | null = isRegistered(p.id)
      ? {
          key: 'card',
          icon: 'person-circle-outline',
          label: he.playerMenuCard,
          onPress: () => onPlayerCard?.(p.id),
        }
      : null;
    const out: PlayerMenuItem[] = [];
    if (menu.kind === 'left') {
      if (isAdmin) {
        out.push({
          key: 'restore',
          icon: 'arrow-undo',
          label: he.playerMenuRestore,
          sublabel: canMarkHome ? undefined : he.playerMenuWentHomeHint,
          disabled: !canMarkHome,
          color: colors.primary,
          onPress: () => onRestorePlayer?.({ id: p.id, name: p.name }),
        });
      }
      if (cardItem) out.push(cardItem);
    } else {
      if (cardItem) out.push(cardItem);
      if (isAdmin && onSwapPlayers) {
        out.push({
          key: 'swap',
          icon: 'swap-horizontal',
          label: he.playerMenuSwap,
          color: colors.primary,
          onPress: () => setSwapSource(p.id),
        });
      }
      if (isAdmin) {
        out.push({
          key: 'home',
          icon: 'exit-outline',
          label: he.playerMenuWentHome,
          sublabel: canMarkHome ? undefined : he.playerMenuWentHomeHint,
          disabled: !canMarkHome,
          color: colors.danger,
          onPress: () => onPlayerWentHome?.({ id: p.id, name: p.name }),
        });
      }
    }
    return out;
  })();

  return (
    <View style={styles.wrap}>
      {/* ── Scoreboard: the two teams on the pitch ───────────────────────── */}
      <View style={styles.scoreWrap}>
        <View style={styles.sectionHeader}>
          {/* Text first → icon lands on the visual LEFT under forceRTL. */}
          <Text style={styles.sectionHeaderText}>{he.rotationPlayingTeams}</Text>
          <Ionicons name="football" size={16} color={colors.primary} />
        </View>
        {swapSource ? (
          <Pressable onPress={() => setSwapSource(null)} style={styles.swapBanner}>
            <Ionicons name="swap-horizontal" size={16} color="#1D4ED8" />
            <Text style={styles.swapBannerText}>{he.swapPickTarget}</Text>
            <View style={styles.swapCancelBtn}>
              <Text style={styles.swapCancelText}>{he.swapCancel}</Text>
            </View>
          </Pressable>
        ) : null}
        <Card style={styles.scoreCard}>
          <View style={styles.scoreRow}>
            <View style={styles.scoreCol}>
              <TeamScore
                teamIdx={aIdx}
                teams={draftTeams.teams}
                roster={rosterA}
                wins={winsOf(aIdx)}
                align="right"
                variant="list"
                goalsByPlayer={goalsByPlayer}
                onPlayerPress={
                  swapSource
                    ? (m) => handleSwapTap(m.id)
                    : onPlayerCard
                      ? (m, rect) => openMenu(m, rect, 'active')
                      : undefined
                }
                swapMode={!!swapSource}
                swapSourceId={swapSource}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.scoreCol}>
              <TeamScore
                teamIdx={bIdx}
                teams={draftTeams.teams}
                roster={rosterB}
                wins={winsOf(bIdx)}
                align="left"
                variant="list"
                goalsByPlayer={goalsByPlayer}
                onPlayerPress={
                  swapSource
                    ? (m) => handleSwapTap(m.id)
                    : onPlayerCard
                      ? (m, rect) => openMenu(m, rect, 'active')
                      : undefined
                }
                swapMode={!!swapSource}
                swapSourceId={swapSource}
              />
            </View>
          </View>
          {fillers.length > 0 ? (
            <View style={styles.legend}>
              {fillers.map((m) => (
                <View key={m.id} style={styles.legendRow}>
                  <Ionicons name="star" size={12} color="#1D4ED8" />
                  <Text style={styles.legendText}>
                    {he.rotationFillerNamed(m.name, teamName(m.fromTeam as number, draftTeams?.teams))}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      </View>

      {/* ── Waiting queue ────────────────────────────────────────────────── */}
      {rotation.waiting.length > 0 ? (
        <>
          <View style={styles.waitHeader}>
            <Text style={styles.waitHeaderText}>{he.rotationWaitingTeams}</Text>
            <Ionicons name="people" size={16} color={colors.primary} />
          </View>
          {rotation.waiting.map((idx, i) => {
            const roster = draftRoster(idx, teams, resolve);
            const next = i === 0;
            return (
              <Pressable
                key={idx}
                onPress={() => setOpenTeam(idx)}
                style={({ pressed }) => [
                  styles.waitCard,
                  next && styles.waitCardNext,
                  pressed && { opacity: 0.9 },
                ]}
              >
                {/* Corner tab — "הבאה בתור" (blue) / "אחריה" (gray). */}
                <View style={[styles.waitTab, next ? styles.waitTabNext : styles.waitTabAfter]}>
                  <Text
                    style={[
                      styles.waitTabText,
                      next ? styles.waitTabTextNext : styles.waitTabTextAfter,
                    ]}
                  >
                    {next ? he.rotationNextUp : he.rotationAfter}
                  </Text>
                </View>

                <View style={styles.waitTop}>
                  <View style={[styles.waitBadge, next && styles.waitBadgeNext]}>
                    <Ionicons name="people" size={20} color={next ? colors.primary : '#94A3B8'} />
                  </View>
                  <View style={styles.waitText}>
                    <Text style={[styles.waitName, { color: teamColor(idx, draftTeams?.teams) }]}>{teamName(idx, draftTeams?.teams)}</Text>
                    <Text style={styles.waitCount}>
                      {he.rotationPlayersCount(roster.length)}
                      {winsOf(idx) > 0
                        ? ` · ⁦🏆 ${he.rotationWinsShort(winsOf(idx))}⁩`
                        : ''}
                    </Text>
                  </View>
                  <View style={styles.waitSpacer} />
                  <Ionicons name="chevron-back" size={20} color="#94A3B8" />
                </View>

                <View style={styles.waitRoster}>
                  {roster.slice(0, 6).map((m) => (
                    <View key={m.id} style={styles.waitMini}>
                      {onPlayerCard ? (
                        <MeasurablePressable
                          onMeasured={(rect) => openMenu(m, rect, 'active')}
                          hitSlop={4}
                          accessibilityLabel={m.name}
                        >
                          <UserAvatar
                            user={{ id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl }}
                            size={32}
                            ring
                          />
                        </MeasurablePressable>
                      ) : (
                        <UserAvatar
                          user={{ id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl }}
                          size={32}
                          ring
                        />
                      )}
                      <Text style={styles.waitMiniName} numberOfLines={1}>
                        {firstName(m.name)}
                      </Text>
                    </View>
                  ))}
                </View>
              </Pressable>
            );
          })}
        </>
      ) : null}

      {/* ── הלכו הביתה — players who left the evening ─────────────────────── */}
      {leftHomeList.length > 0 ? (
        <View style={styles.leftWrap}>
          <View style={styles.waitHeader}>
            <Text style={styles.waitHeaderText}>{he.wentHomeSectionTitle}</Text>
            <Ionicons name="walk-outline" size={16} color={colors.textMuted} />
          </View>
          <Card style={styles.leftCard}>
            {isAdmin ? (
              <Text style={styles.leftHint}>{he.wentHomeTapHint}</Text>
            ) : null}
            <View style={styles.leftRoster}>
              {leftHomeList.map((m) => (
                <View key={m.id} style={styles.waitMini}>
                  {onPlayerCard ? (
                    <MeasurablePressable
                      onMeasured={(rect) => openMenu(m, rect, 'left')}
                      hitSlop={4}
                      accessibilityLabel={m.name}
                    >
                      <View style={styles.leftAvatar}>
                        <UserAvatar
                          user={{ id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl }}
                          size={32}
                        />
                      </View>
                    </MeasurablePressable>
                  ) : (
                    <View style={styles.leftAvatar}>
                      <UserAvatar
                        user={{ id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl }}
                        size={32}
                      />
                    </View>
                  )}
                  <Text style={styles.waitMiniName} numberOfLines={1}>
                    {firstName(m.name)}
                  </Text>
                  {m.at ? (
                    <Text style={styles.wentHomeTime}>{hhmm(m.at)}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          </Card>
        </View>
      ) : null}

      {/* Anchored per-player menu (כרטיס שחקן / הלך הביתה / החזר). */}
      <PlayerActionMenu target={menu} items={menuItems} onClose={() => setMenu(null)} />

      {/* ── Waiting-team roster peek ─────────────────────────────────────── */}
      <Modal
        visible={openTeam != null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenTeam(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpenTeam(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            {openTeam != null ? (
              <>
                <Text style={styles.sheetTitle}>{teamName(openTeam, draftTeams?.teams)}</Text>
                <TeamScore
                  teamIdx={openTeam}
                  teams={draftTeams.teams}
                  roster={openRoster}
                  wins={0}
                  align="right"
                  avatarSize={50}
                />
                <Pressable style={styles.sheetClose} onPress={() => setOpenTeam(null)}>
                  <Text style={styles.sheetCloseText}>{he.close}</Text>
                </Pressable>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: spacing.md },
  scoreWrap: { width: '100%', gap: spacing.sm },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  sectionHeaderText: { ...typography.body, color: colors.text, fontWeight: '800' },
  scoreCard: { padding: spacing.md, gap: spacing.sm },
  swapBanner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    backgroundColor: '#EAF1FF',
    borderWidth: 1,
    borderColor: '#BFD3FF',
  },
  swapBannerText: {
    flex: 1,
    ...typography.caption,
    color: '#1D4ED8',
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  swapCancelBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#1D4ED8',
  },
  swapCancelText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  scoreRow: { flexDirection: 'row', alignItems: 'stretch' },
  scoreCol: { flex: 1, minWidth: 0 },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: '#E2E8F0',
    marginHorizontal: 8,
  },
  legend: {
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-start' },
  legendText: { ...typography.caption, color: '#475569', fontWeight: '700', textAlign: RTL_LABEL_ALIGN },

  waitHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  waitHeaderText: { ...typography.body, color: colors.text, fontWeight: '800' },
  waitCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    overflow: 'hidden',
  },
  waitCardNext: {
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
  },
  // Corner tab (top-start). RN flips physical right→visual-left under RTL, so
  // `right: 0` pins it to the visual top-LEFT corner like the design.
  waitTab: {
    position: 'absolute',
    top: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderBottomLeftRadius: 10,
    borderTopRightRadius: 15,
  },
  waitTabNext: { backgroundColor: colors.primary },
  waitTabAfter: { backgroundColor: '#E2E8F0' },
  waitTabText: { fontSize: 11, fontWeight: '800' },
  waitTabTextNext: { color: '#FFFFFF' },
  waitTabTextAfter: { color: '#64748B' },
  waitTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  waitBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitBadgeNext: { backgroundColor: 'rgba(29,78,216,0.10)' },
  waitText: { gap: 1 },
  waitName: { ...typography.body, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  waitCount: { ...typography.caption, color: colors.textMuted, fontWeight: '600', textAlign: RTL_LABEL_ALIGN },
  waitSpacer: { flex: 1 },
  waitRoster: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  waitMini: { alignItems: 'center', gap: 3, width: 52 },

  // ── הלכו הביתה section ──
  leftWrap: { width: '100%', gap: spacing.sm },
  leftCard: { padding: spacing.md, gap: spacing.sm },
  leftHint: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  leftRoster: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // Faded avatar so a departed player reads as "off" without losing identity.
  leftAvatar: { opacity: 0.55 },
  wentHomeTime: { fontSize: 10, fontWeight: '600', color: colors.textMuted },

  waitMiniName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
    textAlign: 'center',
    width: '100%',
  },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.bg,
    borderRadius: 22,
    padding: spacing.lg,
    gap: spacing.md,
    alignItems: 'center',
  },
  sheetTitle: { ...typography.h3, color: colors.text, fontWeight: '800' },
  sheetClose: { paddingVertical: 10, paddingHorizontal: 24 },
  sheetCloseText: { color: '#1D4ED8', fontSize: 15, fontWeight: '700' },
});
