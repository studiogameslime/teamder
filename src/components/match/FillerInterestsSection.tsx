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

import React, { useCallback, useEffect, useState } from 'react';
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
import { collection, getDocs, query, where } from 'firebase/firestore';

import { Card } from '@/components/Card';
import { TrustMeter } from '@/components/TrustMeter';
import { Avatar } from '@/components/Avatar';
import { toast } from '@/components/Toast';
import { logError } from '@/services/errorLog';
import { trustService, type TrustSummary } from '@/services/trustService';
import { userService } from '@/services';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { docs } from '@/firebase/firestore';
import type { User } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  gameId: string;
  isAdmin: boolean;
  acceptsFillers: boolean;
}

interface CandidateRow {
  uid: string;
  user: User | null;
  trust: TrustSummary | null;
}

export function FillerInterestsSection({
  gameId,
  isAdmin,
  acceptsFillers,
}: Props) {
  const [rows, setRows] = useState<CandidateRow[] | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  const load = useCallback(async () => {
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
    if (USE_MOCK_DATA) {
      setRows([]);
      return;
    }
    try {
      const { db } = getFirebase();
      const q = query(
        collection(db, 'games', gameId, 'fillerInterests'),
        where('status', '==', 'pending'),
      );
      const snap = await getDocs(q);
      const uids = snap.docs.map((d) => d.id);
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
            userService.getUserById(uid).catch(() => null),
            trustService.getSummary(uid).catch(() => null),
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
      logError('loadFillerInterests', err, {
        screen: 'FillerInterestsSection',
        gameId,
      });
      if (__DEV__) console.warn('[fillerInterests] load failed', err);
      setRows([]);
    }
  }, [gameId, isAdmin, acceptsFillers]);

  // Fetch on mount + every focus (admin returns from approving via
  // a different surface, push navigation, etc.).
  useEffect(() => {
    load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!isAdmin || !acceptsFillers) return null;
  if (rows === null) {
    return (
      <Card style={styles.card}>
        <View style={styles.loaderRow}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Card>
    );
  }
  if (rows.length === 0) return null;

  const handleApprove = async (candidateUid: string) => {
    setBusyUid(candidateUid);
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { httpsCallable } = require('firebase/functions');
      const { functions } = getFirebase();
      const fn = httpsCallable(functions, 'approveFiller');
      await fn({ gameId, candidateUid });
      toast.success(he.fillerApproveSuccess);
      await load();
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const msg = (e.code ?? '').replace(/^functions\//, '');
      logError('approveFiller', err, {
        screen: 'FillerInterestsSection',
        gameId,
        candidateUid,
      });
      toast.error(
        msg === 'failed-precondition'
          ? he.fillerApproveStale
          : he.error,
      );
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
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { httpsCallable } = require('firebase/functions');
              const { functions } = getFirebase();
              const fn = httpsCallable(functions, 'declineFiller');
              await fn({ gameId, candidateUid });
              await load();
            } catch (err) {
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
            {row.trust ? (
              <View style={styles.trustWrap}>
                <TrustMeter
                  score={row.trust.score}
                  tier={row.trust.tier}
                  size="sm"
                />
              </View>
            ) : null}
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
    </Card>
  );
}

// Defensive: keep `docs` referenced so the import doesn't get dropped
// by a future change. (We use it implicitly via firestore.ts barrel.)
const _ = docs;
void _;

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
