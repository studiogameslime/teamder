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
import { logError } from '@/services/errorLog';
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

  // Pre-fill the wizard from the live group. Only the fields the
  // refactored wizard exposes are hydrated. Legacy fields on the
  // existing doc (fieldName, recurringTime, etc.) are left untouched
  // — they stay on the stored doc but are no longer editable through
  // this surface, matching the new responsibility split (community
  // owns identity + membership; per-event details live on each Game).
  const initial = useMemo<GroupFormValues>(() => {
    if (!original) return EMPTY_GROUP_FORM_VALUES;
    return {
      name: original.name ?? '',
      description: original.description ?? '',
      isOpen: original.isOpen ?? false,
      rules: original.rules ?? '',
      contactPhone: original.contactPhone ?? '',
      city: original.city ?? '',
      maxMembers:
        typeof original.maxMembers === 'number'
          ? String(original.maxMembers)
          : '40',
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
    const parsedMembers = parseInt(v.maxMembers, 10);
    try {
      await groupService.updateGroupMetadata(original.id, me.id, {
        name: v.name.trim(),
        description: v.description.trim() || undefined,
        isOpen: v.isOpen,
        rules: v.rules.trim() || undefined,
        contactPhone: v.contactPhone.trim() || undefined,
        city: v.city.trim() || undefined,
        maxMembers: Number.isFinite(parsedMembers) && parsedMembers > 0
          ? parsedMembers
          : undefined,
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
      logError('updateGroupMetadata', e, {
        screen: 'CommunityEditScreen',
        groupId: original.id,
      });
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
