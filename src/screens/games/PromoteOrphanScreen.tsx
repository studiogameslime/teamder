// PromoteOrphanScreen — post-orphan-game "create a community from the
// people you just played with" flow. Reached two ways:
//
//   1. Tap on the `promotePrompt` push that fires ~30 minutes after
//      the orphan game finishes.
//   2. (Future) Inline CTA on the finished orphan game's details
//      screen.
//
// The screen takes the personal group id + the game id from route
// params, loads the participants, and lets the creator name the
// community + cherry-pick whom to invite. Submitting calls the
// `promoteOrphanToGroup` callable which un-hides the personal group,
// applies the new metadata, queues `groupInvitation` pushes to every
// invitee, and writes the /groupsPublic mirror.
//
// After success we navigate to the freshly-promoted CommunityDetails so
// the creator sees their new community right away.

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { groupService } from '@/services/groupService';
import { gameService } from '@/services/gameService';
import { logError } from '@/services/errorLog';
import { Game, UserId } from '@/types';
import { useUserStore } from '@/store/userStore';
import { useGameStore } from '@/store/gameStore';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList, 'PromoteOrphan'>;
type Params = RouteProp<GameStackParamList, 'PromoteOrphan'>;

export function PromoteOrphanScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Params>();
  const { groupId, gameId } = route.params;
  const me = useUserStore((s) => s.currentUser);
  const players = useGameStore((s) => s.players);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);

  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [includedIds, setIncludedIds] = useState<Record<UserId, boolean>>({});

  // Load the game once. It supplies the roster we'll let the user
  // cherry-pick from.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = await gameService.getGameById(gameId);
        if (!alive) return;
        setGame(g);
        if (g) {
          const roster = Array.from(
            new Set([
              ...(g.players ?? []),
              ...(g.waitlist ?? []),
              ...(g.pending ?? []),
            ]),
          ).filter((uid) => uid !== me?.id);
          // Hydrate names for the checklist.
          if (roster.length > 0) hydratePlayers(roster);
          // Default: invite everyone who participated.
          const init: Record<UserId, boolean> = {};
          roster.forEach((uid) => (init[uid] = true));
          setIncludedIds(init);
        }
      } catch (err) {
        logError('promoteOrphanLoad', err, {
          screen: 'PromoteOrphanScreen',
          gameId,
          groupId,
        });
        if (__DEV__) console.warn('[promoteOrphan] load failed', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId, hydratePlayers, me?.id]);

  const roster = useMemo<UserId[]>(() => {
    if (!game) return [];
    return Array.from(
      new Set([
        ...(game.players ?? []),
        ...(game.waitlist ?? []),
        ...(game.pending ?? []),
      ]),
    ).filter((uid) => uid !== me?.id);
  }, [game, me?.id]);

  const selectedCount = useMemo(
    () => roster.filter((uid) => includedIds[uid] === true).length,
    [roster, includedIds],
  );

  const togglePlayer = (uid: UserId) =>
    setIncludedIds((prev) => ({ ...prev, [uid]: !prev[uid] }));

  const submit = async () => {
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      Alert.alert(he.promoteOrphanNameTooShortTitle, he.promoteOrphanNameTooShortBody);
      return;
    }
    setSubmitting(true);
    try {
      const inviteUserIds = roster.filter((uid) => includedIds[uid] === true);
      const res = await groupService.promoteOrphanGroup({
        groupId,
        name: trimmedName,
        city: city.trim() || undefined,
        inviteUserIds,
      });
      Alert.alert(
        he.promoteOrphanSuccessTitle,
        he.promoteOrphanSuccessBody(res.invited),
        [
          {
            text: he.promoteOrphanGoToCommunity,
            onPress: () => {
              (nav as { replace: (s: string, p: unknown) => void }).replace(
                'CommunityDetails',
                { groupId },
              );
            },
          },
        ],
      );
    } catch (err) {
      logError('promoteOrphanGroup', err, {
        screen: 'PromoteOrphanScreen',
        groupId,
        gameId,
        inviteCount: roster.filter((uid) => includedIds[uid] === true).length,
      });
      const e = err as { code?: string; message?: string };
      Alert.alert(
        he.promoteOrphanErrorTitle,
        e.message ?? he.promoteOrphanErrorBody,
      );
      if (__DEV__) console.warn('[promoteOrphan] submit failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.promoteOrphanTitle} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.promoteOrphanTitle} />
      {/* KAV so the autoFocused name field's keyboard doesn't hide the
          bottom-pinned submit button. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.banner}>
          <Ionicons name="people" size={20} color="#1D4ED8" />
          <Text style={styles.bannerText}>{he.promoteOrphanBanner}</Text>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{he.promoteOrphanNameLabel}</Text>
          <TextInput
            value={name}
            onChangeText={(t) => setName(t.slice(0, 60))}
            placeholder={he.promoteOrphanNamePlaceholder}
            placeholderTextColor="#94A3B8"
            style={styles.input}
            maxLength={60}
            autoFocus
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{he.promoteOrphanCityLabel}</Text>
          <TextInput
            value={city}
            onChangeText={(t) => setCity(t.slice(0, 80))}
            placeholder={he.promoteOrphanCityPlaceholder}
            placeholderTextColor="#94A3B8"
            style={styles.input}
            maxLength={80}
          />
        </View>

        <Text style={styles.sectionHeader}>
          {he.promoteOrphanInviteHeader(selectedCount, roster.length)}
        </Text>

        {roster.length === 0 ? (
          <Text style={styles.empty}>{he.promoteOrphanNoOthers}</Text>
        ) : (
          roster.map((uid) => {
            const player = players[uid];
            const checked = includedIds[uid] === true;
            return (
              <Pressable
                key={uid}
                onPress={() => togglePlayer(uid)}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <View
                  style={[
                    styles.checkbox,
                    checked && styles.checkboxOn,
                  ]}
                >
                  {checked ? (
                    <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                  ) : null}
                </View>
                <Text style={styles.rowName}>
                  {player?.displayName ?? uid.slice(0, 6)}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={submit}
          disabled={submitting || name.trim().length < 2}
          style={({ pressed }) => [
            styles.submit,
            (submitting || name.trim().length < 2) && { opacity: 0.5 },
            pressed && { opacity: 0.88 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.submitText}>
              {he.promoteOrphanSubmit(selectedCount)}
            </Text>
          )}
        </Pressable>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginBottom: spacing.lg,
  },
  bannerText: {
    flex: 1,
    color: '#1D4ED8',
    fontSize: 14,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  fieldGroup: {
    marginBottom: spacing.md,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: 6,
    textAlign: RTL_LABEL_ALIGN,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  sectionHeader: {
    ...typography.h3,
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textAlign: RTL_LABEL_ALIGN,
  },
  empty: {
    color: colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: '#1D4ED8',
    borderColor: '#1D4ED8',
  },
  rowName: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  footer: {
    padding: spacing.lg,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  submit: {
    backgroundColor: '#1D4ED8',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
});
