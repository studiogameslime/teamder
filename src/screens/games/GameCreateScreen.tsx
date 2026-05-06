// Create-game screen — thin shell over GameWizardForm. Handles
// community selection (when the user belongs to more than one) and
// translates the wizard's GameFormValues into a `createGameV2` call.

import React, { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { gameService } from '@/services/gameService';
import { Group } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import type { GameStackParamList } from '@/navigation/GameStack';
import {
  GameWizardForm,
  type GameFormValues,
} from '@/screens/games/GameWizardForm';

type Nav = NativeStackNavigationProp<GameStackParamList, 'GameCreate'>;
type Params = RouteProp<GameStackParamList, 'GameCreate'>;

function nextThursday20(): number {
  const d = new Date();
  const delta = (4 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  d.setHours(20, 0, 0, 0);
  return d.getTime();
}

function buildInitial(
  g: Group,
  overrides?: {
    startsAt?: number;
    format?: GameFormValues['format'];
    numberOfTeams?: number;
  },
): GameFormValues {
  // Pre-fill location from the community's address+city when available.
  const baseLocation = [g.fieldAddress, g.city].filter((s) => !!s).join(', ');
  return {
    title: g.name,
    startsAt: overrides?.startsAt ?? nextThursday20(),
    fieldName: g.fieldName ?? '',
    location: baseLocation,
    // Strict: never infer "selected from list" from a pre-filled
    // string. The flag flips to true only when the user actively
    // taps a city in the autocomplete dropdown. This guarantees the
    // saved fieldAddress always corresponds to a real city pick.
    locationFromList: false,
    format: overrides?.format ?? '5v5',
    numberOfTeams: overrides?.numberOfTeams ?? 2,
    matchDurationMinutes: '8',
    extraTimeMinutes: '',
    hasReferee: false,
    hasPenalties: false,
    hasHalfTime: false,
    // Open communities default to public games (anyone can discover
    // and join). Closed/private communities default to community-only
    // — matches user expectation that a private group's games stay
    // inside the group unless the admin explicitly opens them.
    visibility: g.isOpen === true ? 'public' : 'community',
    fieldType: undefined,
    cancelDeadlineHours: undefined,
    requiresApproval: false,
    notes: '',
    bringBall: true,
    bringShirts: true,
    minPlayers: '',
    // 0 = unset. The wizard surfaces a default when it renders the
    // recurring-only picker; standard mode never reads this field.
    registrationOpensAt: 0,
  };
}

export function GameCreateScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Params>();
  const params = route.params ?? {};
  const user = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);

  if (myCommunities.length === 0) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.createGameTitle} />
        <View style={styles.emptyAll}>
          <Ionicons name="people-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText}>{he.createGameNoCommunities}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isRecurring = params.recurring === true;
  // In recurring mode the route locks us to the originating community
  // (passed via params). In standard mode the user can pick from a
  // dropdown across all their communities.
  const lockedGroupId = isRecurring && params.groupId ? params.groupId : null;
  const initialGroupId = lockedGroupId ?? myCommunities[0].id;

  const [groupId, setGroupId] = useState<string>(initialGroupId);
  const selectedGroup = useMemo<Group | undefined>(
    () => myCommunities.find((g) => g.id === groupId),
    [myCommunities, groupId],
  );

  // Reset the form whenever the user picks a different community so the
  // pre-filled values (title, fieldName, address) match.
  const [initialKey, setInitialKey] = useState(0);
  const initial = useMemo(
    () =>
      buildInitial(selectedGroup ?? myCommunities[0], {
        startsAt: params.startsAt,
        format: params.format,
        numberOfTeams: params.numberOfTeams,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedGroup?.id, initialKey],
  );

  const handleGroupChange = (id: string) => {
    setGroupId(id);
    setInitialKey((n) => n + 1);
  };

  const submit = async (v: GameFormValues) => {
    if (!user || !selectedGroup) return;
    const parsedMin = parseInt(v.minPlayers, 10);
    const parsedDuration = parseInt(v.matchDurationMinutes, 10);
    const parsedExtra = parseInt(v.extraTimeMinutes, 10);
    const playersPerTeam =
      v.format === '6v6' ? 6 : v.format === '7v7' ? 7 : 5;
    // In recurring mode the wizard exposes a `registrationOpensAt`
    // picker. Past values are allowed (they fall through to immediate
    // open below) — the inline hint warns the admin that the push
    // will fire right away. Standard mode has no field, so the value
    // stays at 0 and we simply omit it from the create payload.
    const regOpensAt =
      isRecurring && v.registrationOpensAt > 0
        ? v.registrationOpensAt
        : undefined;
    try {
      const created = await gameService.createGameV2({
        groupId: selectedGroup.id,
        title: v.title.trim() || selectedGroup.name,
        startsAt: v.startsAt,
        fieldName: v.fieldName.trim(),
        maxPlayers: playersPerTeam * v.numberOfTeams,
        minPlayers:
          Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin : undefined,
        format: v.format,
        numberOfTeams: v.numberOfTeams,
        cancelDeadlineHours: v.cancelDeadlineHours,
        fieldType: v.fieldType,
        matchDurationMinutes:
          Number.isFinite(parsedDuration) && parsedDuration > 0
            ? parsedDuration
            : undefined,
        autoTeamGenerationMinutesBeforeStart: 60,
        visibility: v.visibility,
        requiresApproval: v.requiresApproval,
        bringBall: v.bringBall,
        bringShirts: v.bringShirts,
        notes: v.notes.trim() || undefined,
        fieldAddress: v.location.trim() || undefined,
        hasReferee: v.hasReferee || undefined,
        hasPenalties: v.hasPenalties || undefined,
        hasHalfTime: v.hasHalfTime || undefined,
        extraTimeMinutes:
          Number.isFinite(parsedExtra) && parsedExtra > 0
            ? parsedExtra
            : undefined,
        registrationOpensAt: regOpensAt,
        createdBy: user.id,
      });
      (nav as { replace: (s: string, p: unknown) => void }).replace(
        'MatchDetails',
        { gameId: created.id },
      );
    } catch (err) {
      // Overlap guard hit — show the user the existing game's title +
      // time so they understand WHY we blocked the create. Other
      // errors fall through to the wizard's generic error alert.
      const e = err as Error & {
        code?: string;
        conflict?: { title: string; startsAt: number };
      };
      if (e.code === 'GAME_OVERLAP' && e.conflict) {
        const ts = new Date(e.conflict.startsAt);
        const when = `${ts.getDate()}.${ts.getMonth() + 1} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
        Alert.alert(
          he.createGameOverlapTitle,
          he.createGameOverlapBody(e.conflict.title || he.createGameOverlapUnknownTitle, when),
        );
        return;
      }
      if (e.code === 'GAME_REG_AFTER_KICKOFF') {
        Alert.alert(
          he.editGameRegAfterKickoffTitle,
          he.editGameRegAfterKickoffBody,
        );
        return;
      }
      throw err;
    }
  };

  // Multi-community: render the picker as the wizard's top slot so the
  // whole page (header, picker, step indicator, form) shares one scroll.
  // Compact dropdown variant (rather than expanded card list) — keeps
  // step 1 short and scannable when the user has multiple groups.
  // Recurring mode hides the picker entirely — the route param locks
  // the community.
  const extraTopSlot =
    !lockedGroupId && myCommunities.length > 1 ? (
      <CommunityDropdown
        options={myCommunities}
        selected={selectedGroup}
        onSelect={handleGroupChange}
      />
    ) : null;

  return (
    <GameWizardForm
      // Force a remount whenever the user picks a different community
      // from the dropdown. Without this, GameWizardForm's internal
      // `useState(initial)` only seeds on first mount and never re-
      // syncs when `initial` changes — so the form fields kept showing
      // the FIRST community's pre-fill (title/fieldName/address) even
      // after the user picked a different community. Visually this
      // looked like "I picked X but it created a game on Y", because
      // the title displayed was Y's name (the original community's).
      key={`${selectedGroup?.id ?? 'none'}-${initialKey}`}
      headerTitle={
        isRecurring ? he.createGameRecurringTitle : he.createGameTitle
      }
      submitLabel={he.createGameSubmit}
      initial={initial}
      onSubmit={submit}
      extraTopSlot={extraTopSlot}
      mode={isRecurring ? 'recurring' : 'standard'}
    />
  );
}

function CommunityDropdown({
  options,
  selected,
  onSelect,
}: {
  options: Group[];
  selected: Group | undefined;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.communityPickerWrap}>
      <Text style={styles.communityPickerLabel}>{he.createGameCommunity}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.dropdownTrigger,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={styles.dropdownValue} numberOfLines={1}>
          {selected?.name ?? '—'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={styles.dropdownBackdrop}
          onPress={() => setOpen(false)}
        >
          <Pressable
            style={styles.dropdownCard}
            onPress={(e) => e.stopPropagation()}
          >
            {options.map((g) => {
              const isSelected = g.id === selected?.id;
              return (
                <Pressable
                  key={g.id}
                  onPress={() => {
                    onSelect(g.id);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.dropdownOption,
                    isSelected && styles.dropdownOptionSelected,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text
                    style={[
                      styles.dropdownOptionText,
                      isSelected && styles.dropdownOptionTextSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {g.name}
                  </Text>
                  {isSelected ? (
                    <Ionicons
                      name="checkmark"
                      size={18}
                      color={colors.primary}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  emptyAll: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  communityPickerWrap: {
    gap: spacing.xs,
    alignItems: 'stretch',
  },
  communityPickerLabel: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
    width: '100%',
  },
  // Dropdown trigger — compact pill that opens a modal list. Same
  // visual language as InputField (light surface, rounded corners) so
  // it sits naturally next to the form fields.
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F5F5F5',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 52,
  },
  dropdownValue: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
    fontWeight: '600',
  },
  dropdownBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  dropdownCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xs,
    gap: 2,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  dropdownOptionSelected: {
    backgroundColor: colors.primaryLight,
  },
  dropdownOptionText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  dropdownOptionTextSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
});
