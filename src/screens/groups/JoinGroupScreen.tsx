import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { colors, radius, spacing, typography } from '@/theme';
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
        Alert.alert(he.groupJoinSuccess, he.groupPendingBody);
      } else if (status === 'already_member') {
        Alert.alert(he.groupAlreadyMember);
      } else if (status === 'not_found') {
        Alert.alert(he.groupNotFound);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.groupJoinTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>{he.groupJoinCodeLabel}</Text>
        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder={he.groupJoinCodePlaceholder}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          textAlign="center"
          autoCapitalize="characters"
          autoFocus
          maxLength={12}
        />
      </ScrollView>
      <View style={{ padding: spacing.lg }}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.sm },
  label: { ...typography.label, color: colors.textMuted },
  input: {
    ...typography.h2,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    letterSpacing: 4,
  },
});
