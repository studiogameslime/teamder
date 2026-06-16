// RotationPanel — the live "winner stays" surface on LiveMatchScreen.
// A live-scoreboard card (the two teams on the pitch, trophies + win streak +
// rosters, filler stars) plus the "waiting teams" queue below it. Declaring a
// winner happens via the WinnerPickerModal (opened from the bottom controls),
// so this surface is display-only. All math lives in rotationEngine.

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { TeamScore } from '@/components/match/TeamScore';
import {
  buildRoster,
  draftRoster,
  fillerSources,
  makeResolver,
  teamName,
  type PlayerLite,
  type RosterMember,
} from '@/components/match/rotationView';
import type { DraftTeamsResult, MatchRotation } from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  draftTeams?: DraftTeamsResult;
  rotation?: MatchRotation;
  playersMap: Record<string, PlayerLite>;
  guests?: { id: string; name: string }[];
}

export function RotationPanel({ draftTeams, rotation, playersMap, guests }: Props) {
  const [openTeam, setOpenTeam] = useState<number | null>(null);

  if (!draftTeams || draftTeams.teams.length < 2 || !rotation) return null;

  const resolve = makeResolver(playersMap, guests);
  const teams = draftTeams.teams.map((t) => ({ index: t.index, playerIds: t.playerIds }));
  const [aIdx, bIdx] = rotation.playing;
  const rosterA = buildRoster(aIdx, teams, rotation, resolve);
  const rosterB = buildRoster(bIdx, teams, rotation, resolve);
  const winsOf = (i: number) => rotation.wins?.[String(i)] ?? 0;

  // One combined filler legend line from both on-pitch rosters.
  const fillerTeams = Array.from(
    new Set([...fillerSources(rosterA), ...fillerSources(rosterB)]),
  );
  const legend =
    fillerTeams.length === 1
      ? he.rotationFillerStar(fillerTeams[0])
      : fillerTeams.length > 1
        ? he.rotationFillerStarMulti(fillerTeams.join(', '))
        : null;

  const openRoster: RosterMember[] =
    openTeam != null ? draftRoster(openTeam, teams, resolve) : [];

  return (
    <View style={styles.wrap}>
      {/* ── Scoreboard: the two teams on the pitch ───────────────────────── */}
      <Card style={styles.scoreCard}>
        <View style={styles.scoreRow}>
          <View style={styles.scoreCol}>
            <TeamScore teamIdx={aIdx} roster={rosterA} wins={winsOf(aIdx)} align="right" />
          </View>
          <View style={styles.vsCol}>
            <View style={styles.vLine} />
            <View style={styles.vsCircle}>
              <Text style={styles.vsText}>{he.vs}</Text>
            </View>
          </View>
          <View style={styles.scoreCol}>
            <TeamScore teamIdx={bIdx} roster={rosterB} wins={winsOf(bIdx)} align="left" />
          </View>
        </View>
        {legend ? (
          <View style={styles.legendRow}>
            <Ionicons name="star" size={13} color="#1D4ED8" />
            <Text style={styles.legendText}>{legend}</Text>
          </View>
        ) : null}
      </Card>

      {/* ── Waiting queue ────────────────────────────────────────────────── */}
      {rotation.waiting.length > 0 ? (
        <>
          <View style={styles.waitHeader}>
            <Ionicons name="people" size={16} color={colors.primary} />
            <Text style={styles.waitHeaderText}>{he.rotationWaitingTeams}</Text>
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
                {next ? (
                  <View style={styles.nextTag}>
                    <Text style={styles.nextTagText}>{he.rotationNextUp}</Text>
                  </View>
                ) : null}
                <View style={styles.waitBadge}>
                  <Ionicons name="people" size={20} color={colors.primary} />
                </View>
                <View style={styles.waitText}>
                  <Text style={styles.waitName}>{teamName(idx)}</Text>
                  <Text style={styles.waitCount}>
                    {he.rotationPlayersCount(roster.length)}
                  </Text>
                </View>
                <View style={styles.waitAvatars}>
                  {roster.slice(0, 5).map((m) => (
                    <View key={m.id} style={styles.waitAvatarWrap}>
                      <UserAvatar
                        user={{ id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl }}
                        size={34}
                        ring
                      />
                    </View>
                  ))}
                </View>
                <Ionicons name="chevron-back" size={20} color="#94A3B8" />
              </Pressable>
            );
          })}
        </>
      ) : null}

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
                <Text style={styles.sheetTitle}>{teamName(openTeam)}</Text>
                <TeamScore
                  teamIdx={openTeam}
                  roster={openRoster}
                  wins={0}
                  align="right"
                  avatarSize={52}
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
  scoreCard: { padding: spacing.md, gap: spacing.sm },
  scoreRow: { flexDirection: 'row', alignItems: 'stretch' },
  // minWidth:0 lets each column shrink to an equal half — without it a long
  // streak pill / name keeps its min-content width and shoves the other team
  // off the card's clipped edge.
  scoreCol: { flex: 1, minWidth: 0 },
  vsCol: { width: 46, alignItems: 'center', justifyContent: 'center' },
  vLine: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    width: StyleSheet.hairlineWidth,
    backgroundColor: '#E2E8F0',
  },
  vsCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vsText: { fontSize: 13, fontWeight: '800', color: '#64748B' },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
  },
  legendText: { ...typography.caption, color: '#475569', fontWeight: '700', textAlign: RTL_LABEL_ALIGN },

  waitHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  waitHeaderText: { ...typography.body, color: colors.text, fontWeight: '800' },
  waitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  waitCardNext: {
    borderColor: '#16A34A',
    backgroundColor: '#F0FDF4',
  },
  nextTag: {
    position: 'absolute',
    top: -1,
    left: 14,
    backgroundColor: '#16A34A',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  nextTagText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  waitBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(29,78,216,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitText: { gap: 2 },
  waitName: { ...typography.body, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  waitCount: { ...typography.caption, color: colors.textMuted, fontWeight: '600', textAlign: RTL_LABEL_ALIGN },
  waitAvatars: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 2 },
  waitAvatarWrap: { marginHorizontal: -1 },

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
