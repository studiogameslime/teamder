// CommunityEditScreen — thin shell over GroupWizardForm. The form
// surface is identical to the create flow; only the initial values
// (hydrated from the existing community) and the submit label differ.

import React, { useMemo, useState } from 'react';
import { Alert, Text, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { groupService } from '@/services';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import {
  GroupWizardForm,
  EMPTY_GROUP_FORM_VALUES,
  type GroupFormValues,
} from '@/screens/groups/GroupWizardForm';

type RouteParams = { CommunityEdit: { groupId: string } };

export function CommunityEditScreen() {
  const route = useRoute<RouteProp<RouteParams, 'CommunityEdit'>>();
  const nav = useNavigation<
    NativeStackNavigationProp<CommunitiesStackParamList, 'CommunityEdit'>
  >();
  const { groupId } = route.params;
  const me = useUserStore((s) => s.currentUser);
  const groups = useGroupStore((s) => s.groups);
  const reloadGroups = useGroupStore((s) => s.hydrate);
  const original = groups.find((g) => g.id === groupId);
  // Bumped each time the server rejects with GROUP_MAX_BELOW_CURRENT,
  // signalling the wizard to revert the maxMembers field back to the
  // canonical value (otherwise the user is stuck looking at the
  // rejected number).
  const [revertSignal, setRevertSignal] = useState(0);

  // Pre-fill the wizard from the live group. Memoized so swapping
  // between the create wizard and this one doesn't reset the form
  // mid-edit.
  const initial = useMemo<GroupFormValues>(() => {
    if (!original) return EMPTY_GROUP_FORM_VALUES;
    return {
      name: original.name ?? '',
      fieldName: original.fieldName ?? '',
      city: original.city ?? '',
      street: original.street ?? '',
      addressNote: original.addressNote ?? '',
      isOpen: original.isOpen ?? false,
      preferredDays: original.preferredDays ?? [],
      preferredHour: original.preferredHour ?? '',
      recurringGameEnabled: original.recurringGameEnabled ?? false,
      maxPlayers:
        typeof original.defaultMaxPlayers === 'number'
          ? String(original.defaultMaxPlayers)
          : '15',
      maxMembers:
        typeof original.maxMembers === 'number'
          ? String(original.maxMembers)
          : '40',
      contactPhone: original.contactPhone ?? '',
      description: original.description ?? '',
      rules: original.rules ?? '',
    };
  }, [original]);

  if (!me || !original) {
    return (
      <SafeAreaView style={styles.empty} edges={['top', 'bottom']}>
        <ScreenHeader title={he.communityEditTitle} />
        <View style={styles.emptyBody}>
          <Text style={styles.emptyText}>{he.communityEditNoPermission}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!original.adminIds.includes(me.id)) {
    return (
      <SafeAreaView style={styles.empty} edges={['top', 'bottom']}>
        <ScreenHeader title={he.communityEditTitle} />
        <View style={styles.emptyBody}>
          <Text style={styles.emptyText}>{he.communityEditNoPermission}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const submit = async (v: GroupFormValues) => {
    const parsedMax = parseInt(v.maxPlayers, 10);
    const parsedMembers = parseInt(v.maxMembers, 10);
    try {
      await groupService.updateGroupMetadata(original.id, me.id, {
        name: v.name.trim(),
        fieldName: v.fieldName.trim(),
        city: v.city.trim() || undefined,
        street: v.street.trim() || undefined,
        addressNote: v.addressNote.trim() || undefined,
        contactPhone: v.contactPhone.trim() || undefined,
        description: v.description.trim() || undefined,
        rules: v.rules.trim() || undefined,
        preferredDays: v.preferredDays,
        preferredHour: v.preferredHour || undefined,
        defaultMaxPlayers: Number.isFinite(parsedMax) && parsedMax > 0
          ? parsedMax
          : undefined,
        maxMembers: Number.isFinite(parsedMembers) && parsedMembers > 0
          ? parsedMembers
          : undefined,
        isOpen: v.isOpen,
        recurringGameEnabled: v.recurringGameEnabled,
      });
      logEvent(AnalyticsEvent.GroupSettingsEdited, { groupId: original.id });
      await reloadGroups(me.id);
      nav.replace('CommunityDetails', { groupId: original.id });
    } catch (e) {
      const code =
        typeof (e as { code?: unknown })?.code === 'string'
          ? ((e as { code: string }).code)
          : '';
      if (code === 'GROUP_MAX_BELOW_CURRENT') {
        const current =
          (e as { currentCount?: number }).currentCount ?? 0;
        Alert.alert(
          he.groupMaxBelowCurrentTitle,
          he.groupMaxBelowCurrentBody(current),
        );
        // Bump the signal so the wizard reverts the maxMembers field
        // (and only that field) and jumps to the step where it lives,
        // so the user can see the corrected value immediately.
        setRevertSignal((n) => n + 1);
        return;
      }
      Alert.alert(he.error, String((e as Error).message ?? e));
    }
  };

  return (
    <GroupWizardForm
      headerTitle={he.communityEditTitle}
      submitLabel={he.save}
      initial={initial}
      onSubmit={submit}
      revertSignal={revertSignal}
      revertToStep={2}
      revertFields={['maxMembers']}
    />
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, backgroundColor: colors.bg },
  emptyBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
});
