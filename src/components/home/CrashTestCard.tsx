import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { appAlert } from '@/components/AppDialog';
import { he } from '@/i18n/he';
import { triggerCrashlyticsTest } from '@/services/crashlyticsTestService';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

/** Temporary test control: remove before promoting the internal build publicly. */
export function CrashTestCard({ userId }: { userId: string }) {
  const confirmCrash = () => appAlert(he.crashTestTitle, he.crashTestConfirm, [
    { text: he.cancel, style: 'cancel' },
    { text: he.crashTestConfirmButton, style: 'destructive', onPress: () => {
      void triggerCrashlyticsTest(userId).then(result => {
        if (result === 'triggered') return;
        const message = result === 'development' ? he.crashTestDevelopment
          : result === 'session-changed' ? he.crashTestSessionChanged
          : result === 'collection-disabled' ? he.crashTestCollectionDisabled
          : he.crashTestUnavailable;
        appAlert(he.crashTestTitle, message);
      });
    } },
  ]);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{he.crashTestTitle}</Text>
      <Text style={styles.body}>{he.crashTestBody}</Text>
      <Button title={he.crashTestButton} variant="danger" iconLeft="warning-outline" fullWidth onPress={confirmCrash} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm, borderRadius: radius.lg, backgroundColor: '#FFF1F2', borderWidth: 1, borderColor: '#FECDD3' },
  title: { ...typography.h3, color: colors.danger, textAlign: RTL_LABEL_ALIGN },
  body: { ...typography.body, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
});
