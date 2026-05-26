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
    const phone = v.contactPhone.trim();
    const parsedMaxMembers = parseInt(v.maxMembers, 10);
    try {
      const group = await createGroup({
        name: v.name.trim(),
        description: v.description.trim() || undefined,
        isOpen: v.isOpen,
        rules: v.rules.trim() || undefined,
        contactPhone: phone || undefined,
        city: cityVal || undefined,
        maxMembers: Number.isFinite(parsedMaxMembers)
          ? parsedMaxMembers
          : undefined,
        creator: user,
      });
      logEvent(AnalyticsEvent.GroupCreated, { groupId: group.id });
      nav.replace('CommunityDetails', { groupId: group.id });
    } catch (e) {
      // Surface a human-readable Hebrew message instead of dumping the
      // raw error text. The two practical failure modes:
      //   1. `unauthenticated` — the server-side App Check / Play
      //      Integrity gate rejected the request. Common when running
      //      on an emulator or before the production keystore's
      //      SHA-256 has been registered in Firebase App Check.
      //   2. `resource-exhausted` — daily rate limit (5/day) hit.
      // Anything else falls back to a generic create-failed toast.
      const err = e as { code?: string; message?: string };
      const code = String(err.code ?? '').replace(/^functions\//, '');
      let msg: string = he.createGroupGenericError;
      if (code === 'unauthenticated') {
        msg = he.createGroupAuthError;
      } else if (code === 'resource-exhausted') {
        msg = err.message || he.createGroupRateLimitError;
      } else if (err.message) {
        msg = err.message;
      }
      Alert.alert(he.error, msg);
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
