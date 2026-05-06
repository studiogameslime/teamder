// CreateGroupScreen — thin shell over GroupWizardForm. Translates the
// wizard's GroupFormValues into a `createGroup` call. Same wizard
// surface as CommunityEditScreen — only the initial values + submit
// label differ.

import React from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import {
  GroupWizardForm,
  EMPTY_GROUP_FORM_VALUES,
  type GroupFormValues,
} from '@/screens/groups/GroupWizardForm';

export function CreateGroupScreen() {
  const nav = useNavigation<
    NativeStackNavigationProp<CommunitiesStackParamList, 'CommunitiesCreate'>
  >();
  const user = useUserStore((s) => s.currentUser);
  const createGroup = useGroupStore((s) => s.createGroup);

  const submit = async (v: GroupFormValues) => {
    if (!user) return;
    const cityVal = v.city.trim();
    const streetVal = v.street.trim();
    const note = v.addressNote.trim();
    const phone = v.contactPhone.trim();
    const composedAddress =
      [streetVal, cityVal].filter(Boolean).join(', ') +
      (note ? ` — ${note}` : '');
    const parsedMax = parseInt(v.maxPlayers, 10);
    const parsedMaxMembers = parseInt(v.maxMembers, 10);
    try {
      const group = await createGroup({
        name: v.name.trim(),
        fieldName: v.fieldName.trim(),
        fieldAddress: composedAddress.length > 0 ? composedAddress : undefined,
        city: cityVal || undefined,
        street: streetVal || undefined,
        addressNote: note || undefined,
        description: v.description.trim() || undefined,
        defaultMaxPlayers: Number.isFinite(parsedMax) ? parsedMax : 15,
        maxMembers: Number.isFinite(parsedMaxMembers)
          ? parsedMaxMembers
          : undefined,
        isOpen: v.isOpen,
        contactPhone: phone || undefined,
        preferredDays: v.preferredDays,
        preferredHour: v.preferredHour || undefined,
        rules: v.rules.trim() || undefined,
        recurringGameEnabled: v.recurringGameEnabled,
        creator: user,
      });
      logEvent(AnalyticsEvent.GroupCreated, { groupId: group.id });
      nav.replace('CommunityDetails', { groupId: group.id });
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
    }
  };

  return (
    <GroupWizardForm
      headerTitle={he.createGroupTitle}
      submitLabel={he.createGroupSubmit}
      initial={EMPTY_GROUP_FORM_VALUES}
      onSubmit={submit}
    />
  );
}
