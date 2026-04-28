// NotificationsSettingsScreen — toggles for each push notification type.
//
// Saves to /users/{uid}.notificationPrefs. The Cloud Function consumer
// reads this map alongside fcmTokens before delivering an FCM payload,
// so a `false` here suppresses the corresponding type without touching
// the dispatch path on the writer side.

import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import {
  notificationsService,
  defaultNotificationPrefs,
} from '@/services/notificationsService';
import { NotificationPrefs } from '@/types';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';

interface Row {
  key: keyof NotificationPrefs;
  label: string;
  sub: string;
}

// Order is the user-facing display order — top items are the most
// useful day-to-day. "growthMilestone" lives at the bottom because
// it's optional and chatty.
const ROWS: Row[] = [
  {
    key: 'joinRequest',
    label: he.notifJoinRequest,
    sub: he.notifJoinRequestSub,
  },
  {
    key: 'approvedRejected',
    label: he.notifApprovedRejected,
    sub: he.notifApprovedRejectedSub,
  },
  {
    key: 'newGameInCommunity',
    label: he.notifNewGameInCommunity,
    sub: he.notifNewGameInCommunitySub,
  },
  {
    key: 'gameReminder',
    label: he.notifGameReminder,
    sub: he.notifGameReminderSub,
  },
  {
    key: 'gameCanceledOrUpdated',
    label: he.notifGameCanceledOrUpdated,
    sub: he.notifGameCanceledOrUpdatedSub,
  },
  {
    key: 'spotOpened',
    label: he.notifSpotOpened,
    sub: he.notifSpotOpenedSub,
  },
  {
    key: 'imLate',
    label: he.notifImLate,
    sub: he.notifImLateSub,
  },
  {
    key: 'inviteToGame',
    label: he.notifInviteToGame,
    sub: he.notifInviteToGameSub,
  },
  {
    key: 'growthMilestone',
    label: he.notifGrowthMilestone,
    sub: he.notifGrowthMilestoneSub,
  },
];

export function NotificationsSettingsScreen() {
  const nav = useNavigation();
  const user = useUserStore((s) => s.currentUser);
  const [prefs, setPrefs] = useState<NotificationPrefs>(
    user?.notificationPrefs ?? defaultNotificationPrefs
  );
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const toggle = (k: keyof NotificationPrefs) =>
    setPrefs((p) => ({ ...p, [k]: !p[k] }));

  const save = async () => {
    setBusy(true);
    try {
      await notificationsService.savePreferences(user.id, prefs);
      // Mirror locally so subsequent screens read the saved state without
      // a round-trip to Firestore.
      useUserStore.setState({
        currentUser: { ...user, notificationPrefs: prefs },
      });
      nav.goBack();
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.notificationsTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{he.notificationsIntro}</Text>
        <Card style={styles.card}>
          {ROWS.map((row, i) => (
            <View
              key={row.key}
              style={[styles.row, i > 0 && styles.rowDivider]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{row.label}</Text>
                <Text style={styles.sub}>{row.sub}</Text>
              </View>
              <Switch
                value={prefs[row.key]}
                onValueChange={() => toggle(row.key)}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
          ))}
        </Card>
      </ScrollView>
      <View style={{ padding: spacing.lg }}>
        <Button
          title={he.notifSave}
          variant="primary"
          size="lg"
          fullWidth
          loading={busy}
          onPress={save}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  intro: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'right',
  },
  card: { padding: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  label: { ...typography.body, color: colors.text, fontWeight: '600' },
  sub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
});
