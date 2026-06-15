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
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { InputField } from '@/components/InputField';
import { AutocompleteInput } from '@/components/AutocompleteInput';
import { InfoTip } from '@/components/InfoTip';
import { RichRulesInput } from '@/components/community/RichRulesInput';
import { BallSwitch } from '@/components/anim/BallSwitch';
import { searchCities } from '@/services/israelLocationService';
import { isValidIsraeliPhone } from '@/services/whatsappService';
import { groupService } from '@/services/groupService';
import { gameService } from '@/services/gameService';
import { logError } from '@/services/errorLog';
import { Game, UserId } from '@/types';
import { useUserStore } from '@/store/userStore';
import { useGameStore } from '@/store/gameStore';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN, shadows } from '@/theme';
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
  const [description, setDescription] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [rules, setRules] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [city, setCity] = useState('');
  const [includedIds, setIncludedIds] = useState<Record<UserId, boolean>>({});

  // Phone is OPTIONAL here (the community chat covers contact now), but if
  // typed it must be a valid Israeli number.
  const phoneEntered = contactPhone.trim().length > 0;
  const phoneError = phoneEntered && !isValidIsraeliPhone(contactPhone);

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
      appAlert(he.promoteOrphanNameTooShortTitle, he.promoteOrphanNameTooShortBody);
      return;
    }
    if (phoneError) {
      appAlert(he.error, he.createGroupContactPhoneInvalid);
      return;
    }
    setSubmitting(true);
    try {
      const inviteUserIds = roster.filter((uid) => includedIds[uid] === true);
      const res = await groupService.promoteOrphanGroup({
        groupId,
        name: trimmedName,
        description: description.trim() || undefined,
        isOpen,
        rules: rules.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        city: city.trim() || undefined,
        inviteUserIds,
      });
      appAlert(
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
      appAlert(
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

        {/* Same field set as the regular "create community" form, so a
            community made from a game is just as complete. All optional
            except the name. */}
        <View style={styles.fields}>
          <InputField
            label={he.promoteOrphanNameLabel}
            value={name}
            onChangeText={(t) => setName(t.slice(0, 60))}
            placeholder={he.promoteOrphanNamePlaceholder}
            maxLength={60}
            required
          />
          <InputField
            label={he.createGroupDescription}
            value={description}
            onChangeText={setDescription}
            multiline
          />
          {/* Open vs admin-approved join. */}
          <Pressable
            onPress={() => setIsOpen((v) => !v)}
            style={styles.toggleCard}
          >
            <View style={styles.toggleText}>
              <View style={styles.toggleLabelRow}>
                <Text style={styles.toggleLabel}>{he.createGroupIsOpen}</Text>
                <InfoTip title={he.createGroupIsOpen} text={he.createGroupIsOpenHint} />
              </View>
            </View>
            <BallSwitch
              value={isOpen}
              onValueChange={setIsOpen}
              trackColor={{ false: colors.border, true: '#3B82F6' }}
              thumbColor="#fff"
            />
          </Pressable>
          <RichRulesInput
            label={he.communityDetailsRules}
            value={rules}
            onChangeText={setRules}
            placeholder={'לדוגמה:\n- מגיעים בזמן\n- **אסור** לעשן במגרש'}
          />
          <View>
            <InputField
              label={he.createGroupContactPhone}
              info={{ title: he.createGroupContactPhone, text: he.createGroupContactPhoneHint }}
              value={contactPhone}
              onChangeText={setContactPhone}
              placeholder={he.createGroupContactPhonePlaceholder}
              keyboardType="phone-pad"
            />
            {phoneError ? (
              <Text style={styles.hintError}>{he.createGroupContactPhoneInvalid}</Text>
            ) : null}
          </View>
          <AutocompleteInput
            label={he.promoteOrphanCityLabel}
            value={city}
            onChange={setCity}
            onSelect={setCity}
            placeholder={he.createGroupCityPlaceholder}
            fetchSuggestions={(q) => searchCities(q)}
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
  fields: { gap: spacing.md },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  toggleText: { flexShrink: 1, alignItems: 'flex-start' },
  toggleLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  toggleLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  hintError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
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
