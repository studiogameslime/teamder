import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { Card } from '@/components/Card';
import { InputField } from '@/components/InputField';
import { Button } from '@/components/Button';
import { toast } from '@/components/Toast';
import { spacing } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';

export function JoinGroupScreen() {
  const user = useUserStore((s) => s.currentUser);
  const requestJoin = useGroupStore((s) => s.requestJoin);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!user || !code.trim()) return;
    setBusy(true);
    try {
      const status = await requestJoin(code.trim(), user.id);
      if (status === 'pending') {
        toast.success(he.toastJoinRequestSent);
      } else if (status === 'already_member') {
        toast.info(he.groupAlreadyMember);
      } else if (status === 'not_found') {
        toast.error(he.groupNotFound);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenContainer title={he.groupJoinTitle}>
      <Card>
        <InputField
          label={he.groupJoinCodeLabel}
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder={he.groupJoinCodePlaceholder}
          icon="key-outline"
          autoCapitalize="characters"
          autoFocus
          maxLength={12}
        />
      </Card>

      <View style={styles.actions}>
        <Button
          title={he.groupJoinSubmit}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!code.trim() || busy}
          loading={busy}
          onPress={submit}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  actions: {
    marginTop: 'auto',
    paddingTop: spacing.lg,
  },
});
