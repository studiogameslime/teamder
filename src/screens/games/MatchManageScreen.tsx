// MatchManageScreen — admin-only "ניהול משחק" surface, opened from
// the MatchDetails hamburger. Holds the rare-but-important admin
// affordances that don't deserve a permanent slot above the fold:
//   • visibility toggle (open ↔ community-only)
//   • delete game
//
// Designed to grow: future admin settings (require-approval, change
// roster cap, lock registration manually) plug into this same screen
// without touching MatchDetails.

import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { ConfirmDestructiveModal } from '@/components/ConfirmDestructiveModal';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { toast } from '@/components/Toast';
import { gameService } from '@/services/gameService';
import { isOpen, isTerminal as isTerminalGame } from '@/services/gameLifecycle';
import {
  colors,
  spacing,
  typography,
  RTL_LABEL_ALIGN,
} from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import type { Game } from '@/types';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList, 'MatchManage'>;
type Params = RouteProp<GameStackParamList, 'MatchManage'>;

export function MatchManageScreen() {
  const nav = useNavigation<Nav>();
  const { gameId } = useRoute<Params>().params;
  const me = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);

  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!gameId) {
      setGame(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const g = await gameService.getGameById(gameId);
      setGame(g);
    } catch {
      setGame(null);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    reload();
  }, [reload]);
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const isAdmin =
    !!game &&
    !!me &&
    (game.createdBy === me.id ||
      myCommunities.some(
        (g) => g.id === game.groupId && g.adminIds.includes(me.id),
      ));

  if (loading && !game) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.matchManageScreenTitle} />
        <View style={styles.center}>
          <SoccerBallLoader size={40} />
        </View>
      </SafeAreaView>
    );
  }
  if (!game) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.matchManageScreenTitle} />
        <View style={styles.center}>
          <Text style={styles.emptyText}>{he.matchDetailsNotFound}</Text>
        </View>
      </SafeAreaView>
    );
  }
  // Defence in depth — non-admins shouldn't reach this screen via
  // the hamburger (we hide the entry), but a stale deep link could.
  // Render a clean blocked state instead of exposing controls.
  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.matchManageScreenTitle} />
        <View style={styles.center}>
          <Ionicons
            name="lock-closed-outline"
            size={32}
            color={colors.textMuted}
          />
          <Text style={styles.emptyText}>{he.matchManageAdminOnly}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const flipVisibility = async (next: boolean) => {
    const target: 'public' | 'community' = next ? 'public' : 'community';
    if (target === game.visibility) return;
    setBusy(true);
    try {
      await gameService.setVisibility(game.id, target);
      await reload();
    } catch (err) {
      if (__DEV__) console.warn('[matchManage] setVisibility failed', err);
      toast.error(
        target === 'public'
          ? he.matchVisibilityErrorPublic
          : he.matchVisibilityErrorCommunity,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.matchManageScreenTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* ── Visibility ───────────────────────────────────────────── */}
        <Section title={he.matchManageSectionAccess}>
          <Card style={styles.cardBody}>
            <Pressable
              onPress={() =>
                isOpen(game) && !busy
                  ? flipVisibility(!(game.visibility === 'public'))
                  : undefined
              }
              disabled={!isOpen(game) || busy}
              style={({ pressed }) => [
                styles.row,
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="switch"
              accessibilityState={{ checked: game.visibility === 'public' }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{he.matchVisibilityToggle}</Text>
                <Text style={styles.rowHelper}>{he.matchVisibilityHelper}</Text>
              </View>
              <Switch
                value={game.visibility === 'public'}
                disabled={!isOpen(game) || busy}
                onValueChange={flipVisibility}
                trackColor={{
                  false: colors.surfaceMuted,
                  true: colors.primary,
                }}
              />
            </Pressable>
            {!isOpen(game) ? (
              <Text style={styles.lockedHint}>
                {he.matchManageVisibilityLocked}
              </Text>
            ) : null}
          </Card>
        </Section>

        {/* ── Danger ───────────────────────────────────────────────── */}
        {!isTerminalGame(game) ? (
          <Section title={he.matchManageSectionDanger}>
            <Card style={styles.cardBody}>
              <Pressable
                onPress={() => setDeleteOpen(true)}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={he.deleteGameAction}
              >
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color={colors.danger}
                />
                <Text style={styles.deleteText}>{he.deleteGameAction}</Text>
              </Pressable>
            </Card>
          </Section>
        ) : null}
      </ScrollView>

      <ConfirmDestructiveModal
        visible={deleteOpen}
        title={he.deleteGameTitle}
        body={he.deleteGameBody}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          try {
            await gameService.deleteGame(game.id);
            setDeleteOpen(false);
            toast.success(he.deleteGameSuccess);
            // Pop back twice — once to leave Manage, once to leave
            // the (now-deleted) MatchDetails. If the stack only has
            // one parent we just goBack() and the empty state takes
            // care of itself.
            if (nav.canGoBack()) nav.goBack();
            if (nav.canGoBack()) nav.goBack();
          } catch (err) {
            if (__DEV__) console.warn('[matchManage] delete failed', err);
            toast.error(he.error);
          }
        }}
      />
    </SafeAreaView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },
  section: { gap: spacing.sm },
  sectionTitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    marginHorizontal: spacing.sm,
  },
  cardBody: {
    padding: 0,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  rowHelper: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 2,
  },
  lockedHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    textAlign: RTL_LABEL_ALIGN,
  },
  deleteText: {
    ...typography.body,
    color: colors.danger,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    flex: 1,
  },
});
