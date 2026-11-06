import { observeCaughtError } from '../../utils/errorObservation';
// FillerInterestsSection — admin-only review surface for the
// cross-community filler matching flow.
//
// Loads `/games/{gameId}/fillerInterests` where status='pending',
// hydrates each candidate's user doc + trust score, and renders a
// card list with one-tap approve / decline actions.
//
// Mounting:
//   • Visible only when the viewer is the game admin AND the game's
//     `acceptsFillers === true`.
//   • Returns `null` when there are no pending interests so the
//     section doesn't take up vertical space on the typical
//     "no fillers needed" game.
//
// Re-fetches on every mount / focus. The admin typically lands here
// from a "filler interest received" push — that navigation triggers
// a fresh mount so the latest interests are pulled.

import { ArrivalMotion } from '@/components/anim/ArrivalMotion';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { Card } from '@/components/Card';
import { ReadStatusNotice } from '@/components/ReadStatusNotice';
// TrustMeter hidden from UI for now — still computed server-side.
// import { TrustMeter } from '@/components/TrustMeter';
import { Avatar } from '@/components/Avatar';
import { toast } from '@/components/Toast';
import { logError } from '@/services/errorLog';
import { trustService, type TrustSummary } from '@/services/trustService';
import { userService } from '@/services';
import { acceptsFillerApplications, actionableFillerIds, decideFiller, pendingFillerIds, type FillerRound } from '@/services/fillerReview';
import type { User } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  game: FillerRound;
  isClubAdmin: boolean;
  isAdmin: boolean;
}

interface CandidateRow {
  uid: string;
  user: User | null;
  trust: TrustSummary | null;
}

export function FillerInterestsSection({
  game,
  isClubAdmin,
  isAdmin,
}: Props) {
  const gameId = game.id;
  const acceptsFillers = acceptsFillerApplications(game);
  const [result, setResult] = useState<{ gameId: string; rows: CandidateRow[] } | null>(null);
  const [failedGame, setFailedGame] = useState<string | null>(null);
  const fetched = result?.gameId === gameId ? result.rows : null;
  const actionable = new Set(actionableFillerIds(game, fetched?.map(row => row.uid) ?? []));
  const rows = fetched?.filter(row => actionable.has(row.uid)) ?? null;
  const generation = useRef(0);
  const [approved, setApproved] = useState<{ row: CandidateRow; at: number; message: string } | null>(null);
  const activeGame = useRef<string | null>(gameId);
  useEffect(() => { activeGame.current = gameId; setApproved(null); return () => { activeGame.current = null; }; }, [gameId]);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  const load = useCallback(async () => {
    const version = ++generation.current;
    const setRows = (rows: CandidateRow[]) => { if (version === generation.current) { setResult({ gameId, rows }); setFailedGame(null); } };
    if (!gameId) return;
    // Read rule on /games/{id}/fillerInterests/{uid} grants access
    // only to the doc owner OR a group admin. Non-admin viewers
    // would 403 the query (the early-return below hides the
    // section anyway). Bail before hitting the wire so the console
    // stays clean.
    if (!isAdmin || !acceptsFillers) {
      setRows([]);
      return;
    }
    try {
      const uids = await pendingFillerIds(gameId, isClubAdmin);
      if (uids.length === 0) {
        setRows([]);
        return;
      }
      // Hydrate users + trust in parallel. The trust query reads
      // each user's recent games — N round-trips per candidate.
      // With small candidate counts (≤10 typically) this is fine.
      const hydrated: CandidateRow[] = await Promise.all(
        uids.map(async (uid) => {
          const [user, trust] = await Promise.all([
            userService.getUserById(uid).catch((caughtErrord1f3b79ed5: unknown) => { observeCaughtError(caughtErrord1f3b79ed5, {"source":"src/components/match/FillerInterestsSection.tsx","handler":"FillerInterestsSection","site":"FillerInterestsSection:d1f3b79ed5"}); return null; }),
            trustService.getSummary(uid).catch((caughtError78fcfa31b0: unknown) => { observeCaughtError(caughtError78fcfa31b0, {"source":"src/components/match/FillerInterestsSection.tsx","handler":"FillerInterestsSection","site":"FillerInterestsSection:78fcfa31b0"}); return null; }),
          ]);
          return { uid, user, trust };
        }),
      );
      // Sort: highest trust first, then "new" users last.
      hydrated.sort((a, b) => {
        const sa = a.trust?.score ?? -1;
        const sb = b.trust?.score ?? -1;
        return sb - sa;
      });
      setRows(hydrated);
    } catch (err) {
    observeCaughtError(err, {"source":"src/components/match/FillerInterestsSection.tsx","handler":"FillerInterestsSection","site":"FillerInterestsSection:7751f8cec2"});
      logError('loadFillerInterests', err, {
        screen: 'FillerInterestsSection',
        gameId,
      });
      if (__DEV__) console.warn('[fillerInterests] load failed', err);
      if (version === generation.current) setFailedGame(gameId);
    }
  }, [gameId, isAdmin, isClubAdmin, acceptsFillers]);

  // Fetch on mount + every focus (admin returns from approving via
  // a different surface, push navigation, etc.).
  useFocusEffect(
    useCallback(() => {
      setApproved(null);
      void load();
      return () => { ++generation.current; };
    }, [load]),
  );

  if (!isAdmin || !acceptsFillers) return null;
  if (failedGame === gameId) return <ReadStatusNotice loading={false} failed hasData={false} scope={gameId} onRetry={() => void load()} />;
  if (rows === null) {
    return (
      <Card style={styles.card}>
        <View style={styles.loaderRow}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Card>
    );
  }
  if (rows.length === 0 && !approved) return null;

  const handleApprove = async (candidateUid: string) => {
    setBusyUid(candidateUid);
    try {
      const { data } = await decideFiller(gameId, candidateUid, true);
      if (data?.alreadyHandled) {
        toast.info('השחקן כבר מופיע במחזור');
        await load();
        return;
      }
      if (activeGame.current === gameId) {
        const row = rows.find(r => r.uid === candidateUid);
        if (row) setApproved({ row, at: Date.now(), message: data?.bucket === 'waitlist' ? he.requestsApprovedToWaitlist : he.fillerApproveSuccess });
      }
      if (data?.bucket === 'waitlist') toast.info(he.requestsApprovedToWaitlist);
      else toast.success(he.fillerApproveSuccess);
      await load();
    } catch (err) {
    observeCaughtError(err, {"source":"src/components/match/FillerInterestsSection.tsx","handler":"handleApprove","site":"FillerInterestsSection:21dcb6c49d"});
      const e = err as { code?: string; message?: string };
      const msg = (e.code ?? '').replace(/^functions\//, '');
      // `failed-precondition` means the game closed or filled while the admin
      // was looking at the list. That is an ordinary outcome with its own
      // Hebrew message below — not a defect, and reporting it only buried the
      // real errors underneath it.
      if (msg !== 'failed-precondition') {
        logError('approveFiller', err, {
          screen: 'FillerInterestsSection',
          gameId,
          candidateUid,
        });
      }
      toast.error(
        msg === 'failed-precondition'
          ? he.fillerApproveStale
          : he.error,
      );
      if (msg === 'failed-precondition') await load();
      if (__DEV__) console.warn('[fillerInterests] approve failed', err);
    } finally {
      setBusyUid(null);
    }
  };

  const handleDecline = async (candidateUid: string, name: string) => {
    appAlert(
      he.fillerDeclineConfirmTitle,
      he.fillerDeclineConfirmBody(name || he.fillerDefaultName),
      [
        { text: he.cancel, style: 'cancel' },
        {
          text: he.fillerDeclineConfirm,
          style: 'destructive',
          onPress: async () => {
            setBusyUid(candidateUid);
            try {
              await decideFiller(gameId, candidateUid, false);
              await load();
            } catch (err) {
    observeCaughtError(err, {"source":"src/components/match/FillerInterestsSection.tsx","handler":"onPress","site":"FillerInterestsSection:5a89bd6f91"});
              if ((err as { code?: string }).code === 'functions/failed-precondition') {
                toast.info('הבקשה כבר אינה ממתינה לאישור');
                await load();
                return;
              }
              logError('declineFiller', err, {
                screen: 'FillerInterestsSection',
                gameId,
                candidateUid,
              });
              if (__DEV__)
                console.warn('[fillerInterests] decline failed', err);
              toast.error(he.error);
            } finally {
              setBusyUid(null);
            }
          },
        },
      ],
    );
  };

  return (
    <Card style={styles.card}>
      {approved ? <ArrivalMotion at={approved.at}>
        <View style={[styles.row, { backgroundColor: '#ECFDF3', borderRadius: 12, paddingHorizontal: spacing.sm }]} accessibilityLiveRegion="polite">
          <Avatar avatarId={approved.row.user?.avatarId} uri={approved.row.user?.photoUrl} name={approved.row.user?.name ?? ''} size={40} />
          <View style={styles.rowBody}><Text style={styles.rowName}>{approved.row.user?.name ?? he.fillerDefaultName}</Text><Text style={styles.subtitle}>{approved.message}</Text></View>
          <Ionicons name="checkmark-circle" size={24} color={colors.success} />
        </View>
      </ArrivalMotion> : null}
      {rows.length > 0 ? <>
      <View style={styles.headerRow}>
        <Ionicons name="people-outline" size={18} color={colors.primary} />
        <Text style={styles.title}>{he.fillerSectionTitle}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{rows.length}</Text>
        </View>
      </View>
      <Text style={styles.subtitle}>{he.fillerSectionSubtitle}</Text>
      {rows.map((row) => (
        <View key={row.uid} style={styles.row}>
          <Avatar
            avatarId={row.user?.avatarId}
            uri={row.user?.photoUrl}
            name={row.user?.name ?? ''}
            size={48}
          />
          <View style={styles.rowBody}>
            <Text style={styles.rowName} numberOfLines={1}>
              {row.user?.name ?? he.fillerDefaultName}
            </Text>
            {/* Trust meter hidden from UI for now — still computed server-side. */}
          </View>
          <View style={styles.actions}>
            <Pressable
              onPress={() => handleApprove(row.uid)}
              disabled={busyUid !== null}
              style={({ pressed }) => [
                styles.actionBtn,
                styles.actionApprove,
                pressed && { opacity: 0.85 },
                busyUid === row.uid && { opacity: 0.5 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={he.fillerApprove}
            >
              <Ionicons name="checkmark" size={20} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() =>
                handleDecline(row.uid, row.user?.name ?? '')
              }
              disabled={busyUid !== null}
              style={({ pressed }) => [
                styles.actionBtn,
                styles.actionDecline,
                pressed && { opacity: 0.85 },
                busyUid === row.uid && { opacity: 0.5 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={he.fillerDecline}
            >
              <Ionicons name="close" size={20} color={colors.danger} />
            </Pressable>
          </View>
        </View>
      ))}
      </> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
  },
  loaderRow: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    ...typography.bodyBold,
    color: colors.text,
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xs,
  },
  rowName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  trustWrap: {
    alignItems: 'flex-start',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionApprove: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  actionDecline: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
});
