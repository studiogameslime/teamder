// NotificationsSettingsScreen — toggles for each push notification type,
// grouped by category under a hero explainer.
//
// Saves to /users/{uid}.notificationPrefs. The Cloud Function consumer
// reads this map alongside fcmTokens before delivering an FCM payload,
// so a `false` here suppresses the corresponding type without touching
// the dispatch path on the writer side.
//
// Per-type toggles are useless while the OS has notifications turned OFF
// for the app — nothing gets through regardless. So when device-level
// permission isn't granted we surface an "enable notifications" gate at
// the top, BEFORE the toggles, and let the user grant (or, if blocked,
// jump to Settings) first.

import React, { useEffect, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BallSwitch } from '@/components/anim/BallSwitch';
import { appAlert } from '@/components/AppDialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { lightHaptic } from '@/utils/haptics';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import {
  notificationsService,
  defaultNotificationPrefs,
} from '@/services/notificationsService';
import { NotificationPrefs } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';

interface Row {
  key: keyof NotificationPrefs;
  label: string;
  sub: string;
}

interface Category {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  rows: Row[];
}

// Grouped by what the notification is about. Within each group, the most
// useful day-to-day items come first; chatty/optional ones last.
const CATEGORIES: Category[] = [
  {
    title: he.notifCategoryGames,
    icon: 'football-outline',
    rows: [
      { key: 'joinRequest', label: he.notifJoinRequest, sub: he.notifJoinRequestSub },
      { key: 'approvedRejected', label: he.notifApprovedRejected, sub: he.notifApprovedRejectedSub },
      { key: 'gamePlayersJoined', label: he.notifGamePlayersJoined, sub: he.notifGamePlayersJoinedSub },
      { key: 'playerCancelled', label: he.notifPlayerCancelled, sub: he.notifPlayerCancelledSub },
      { key: 'gameShortageWarning', label: he.notifGameShortageWarning, sub: he.notifGameShortageWarningSub },
      { key: 'gameCanceledOrUpdated', label: he.notifGameCanceledOrUpdated, sub: he.notifGameCanceledOrUpdatedSub },
    ],
  },
  {
    title: he.notifCategoryCommunity,
    icon: 'people-outline',
    rows: [
      { key: 'newGameInCommunity', label: he.notifNewGameInCommunity, sub: he.notifNewGameInCommunitySub },
      { key: 'spotOpened', label: he.notifSpotOpened, sub: he.notifSpotOpenedSub },
      { key: 'gameFillingUp', label: he.notifGameFillingUp, sub: he.notifGameFillingUpSub },
      { key: 'inviteToGame', label: he.notifInviteToGame, sub: he.notifInviteToGameSub },
      { key: 'groupDeleted', label: he.notifGroupDeleted, sub: he.notifGroupDeletedSub },
    ],
  },
  {
    title: he.notifCategoryReminders,
    icon: 'alarm-outline',
    rows: [
      { key: 'gameReminder', label: he.notifGameReminder, sub: he.notifGameReminderSub },
      { key: 'gameRsvpNudge', label: he.notifGameRsvpNudge, sub: he.notifGameRsvpNudgeSub },
      { key: 'rateReminder', label: he.notifRateReminder, sub: he.notifRateReminderSub },
      { key: 'growthMilestone', label: he.notifGrowthMilestone, sub: he.notifGrowthMilestoneSub },
    ],
  },
];

export function NotificationsSettingsScreen() {
  const nav = useNavigation();
  const user = useUserStore((s) => s.currentUser);
  // Merge defaults under saved prefs so a legacy user whose stored
  // `notificationPrefs` predates the latest fields still gets sensible
  // values for the new toggles instead of an unchecked switch.
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    ...defaultNotificationPrefs,
    ...(user?.notificationPrefs ?? {}),
  });
  const [busy, setBusy] = useState(false);

  // OS-level push permission. `null` = unknown/not-checked (e.g. Expo Go,
  // mock mode) — we hide the gate entirely so we never show a misleading
  // "blocked" message where we can't actually do anything about it.
  const [permGranted, setPermGranted] = useState<boolean | null>(null);
  const [permCanAsk, setPermCanAsk] = useState(true);
  const [permBusy, setPermBusy] = useState(false);

  const refreshPermission = async () => {
    const s = await notificationsService.getPushPermissionStatus();
    setPermGranted(s.available ? s.granted : null);
    setPermCanAsk(s.canAskAgain);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await notificationsService.getPushPermissionStatus();
      if (cancelled) return;
      setPermGranted(s.available ? s.granted : null);
      setPermCanAsk(s.canAskAgain);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Hydrate the toggles from the SELF-ONLY private/push doc — the source of
  // truth savePreferences writes to. currentUser.notificationPrefs (root doc)
  // no longer carries them, so without this the screen would show stale
  // defaults and every save would look like it reverted. Also mirror into the
  // store so the isDirty comparison baseline matches what's persisted.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const saved = await notificationsService.loadPreferences(user.id);
      if (cancelled || !saved) return;
      const merged = { ...defaultNotificationPrefs, ...saved };
      setPrefs(merged);
      useUserStore.setState((s) =>
        s.currentUser
          ? { currentUser: { ...s.currentUser, notificationPrefs: merged } }
          : {},
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Unsaved-changes guard: leaving with un-persisted toggle changes now
  // prompts (save / discard / cancel) instead of silently dropping them,
  // matching ProfileEdit. isDirty compares the draft to the saved store
  // value, so it clears automatically after a successful save.
  const isDirty =
    JSON.stringify(prefs) !==
    JSON.stringify({
      ...defaultNotificationPrefs,
      ...(user?.notificationPrefs ?? {}),
    });
  const savingRef = useUnsavedChangesGuard({ isDirty, onSave: () => save() });

  if (!user) return null;

  // The OS won't show the system prompt again once permanently denied —
  // jump straight to the app's settings page in that case.
  const handleEnablePermission = async () => {
    if (permBusy) return;
    if (!permCanAsk) {
      Linking.openSettings().catch(() => {});
      return;
    }
    setPermBusy(true);
    try {
      await notificationsService.requestAndRegisterPushToken(user.id);
      await refreshPermission();
    } catch (e) {
      if (__DEV__) console.warn('[notifications] enable failed', e);
    } finally {
      setPermBusy(false);
    }
  };

  const toggle = (k: keyof NotificationPrefs) =>
    setPrefs((p) => {
      const nextVal = !p[k];
      lightHaptic();
      // Per-toggle analytics — finer-grained than the aggregate
      // `NotificationsToggled` event fired on save. Lets us see
      // which specific notifications users actually disable.
      logEvent(AnalyticsEvent.NotificationPrefChanged, {
        pref: String(k),
        enabled: nextVal,
      });
      return { ...p, [k]: nextVal };
    });

  const save = async () => {
    setBusy(true);
    try {
      await notificationsService.savePreferences(user.id, prefs);
      // Mirror locally so subsequent screens read the saved state without
      // a round-trip to Firestore.
      useUserStore.setState({
        currentUser: { ...user, notificationPrefs: prefs },
      });
      logEvent(AnalyticsEvent.NotificationsToggled, {
        enabledCount: String(Object.values(prefs).filter(Boolean).length),
      });
      // Let the guard's beforeRemove pass through this programmatic leave.
      savingRef.current = true;
      nav.goBack();
    } catch (e) {
      // savePreferences is a Firestore write with no logging of its own;
      // a failed save would otherwise only surface as a transient Alert
      // and vanish. Record it so the dashboard sees the failure.
      logError('saveNotificationPrefs', e, {
        screen: 'NotificationsSettingsScreen',
        userId: user.id,
      });
      appAlert(he.error, String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  // While permission is off, the per-type toggles can't deliver anything —
  // dim them so the gate above reads as the necessary first step.
  const gated = permGranted === false;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.notificationsTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Hero explainer */}
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>{he.notifHeroTitle}</Text>
          <Text style={styles.heroBody}>{he.notifHeroBody}</Text>
        </View>

        {/* OS-permission gate — only when notifications are off on device */}
        {gated ? (
          <View style={styles.permCard}>
            <View style={styles.permIcon}>
              <Ionicons
                name="notifications-off-outline"
                size={24}
                color={colors.warning}
              />
            </View>
            <View style={styles.permTextWrap}>
              <Text style={styles.permTitle}>
                {permCanAsk ? he.notifPermTitle : he.notifPermDeniedTitle}
              </Text>
              <Text style={styles.permBody}>
                {permCanAsk ? he.notifPermBody : he.notifPermDeniedBody}
              </Text>
              <Pressable
                onPress={handleEnablePermission}
                disabled={permBusy}
                style={({ pressed }) => [
                  styles.permBtn,
                  pressed && { opacity: 0.9 },
                  permBusy && { opacity: 0.6 },
                ]}
                accessibilityRole="button"
              >
                <Ionicons
                  name={permCanAsk ? 'notifications-outline' : 'settings-outline'}
                  size={16}
                  color="#FFFFFF"
                />
                <Text style={styles.permBtnText}>
                  {permCanAsk ? he.notifPermEnable : he.notifPermOpenSettings}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Per-type toggles, grouped by category */}
        <View style={gated && styles.gatedGroup} pointerEvents={gated ? 'none' : 'auto'}>
          {CATEGORIES.map((cat) => (
            <View key={cat.title} style={styles.categoryBlock}>
              <View style={styles.categoryHeader}>
                <Ionicons name={cat.icon} size={16} color={colors.primary} />
                <Text style={styles.categoryTitle}>{cat.title}</Text>
              </View>
              <Card style={styles.card}>
                {cat.rows.map((row, i) => (
                  <Pressable
                    key={row.key}
                    onPress={() => toggle(row.key)}
                    style={[styles.row, i > 0 && styles.rowDivider]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>{row.label}</Text>
                      <Text style={styles.sub}>{row.sub}</Text>
                    </View>
                    <BallSwitch
                      value={!!prefs[row.key]}
                      onValueChange={() => toggle(row.key)}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor="#fff"
                    />
                  </Pressable>
                ))}
              </Card>
            </View>
          ))}
        </View>
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
  // ── Hero ──
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: 6,
  },
  heroTitle: {
    ...typography.h3,
    color: '#FFFFFF',
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  heroBody: {
    ...typography.body,
    color: 'rgba(255,255,255,0.88)',
    textAlign: RTL_LABEL_ALIGN,
    lineHeight: 21,
  },
  // ── Permission gate ──
  // `row` flips under forceRTL → icon (first child) lands on the visual
  // RIGHT, the text block to its left.
  permCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: '#FFFBEB',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: spacing.md,
  },
  permIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permTextWrap: { flex: 1, gap: 4 },
  permTitle: {
    ...typography.body,
    color: '#92400E',
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  permBody: {
    ...typography.caption,
    color: '#B45309',
    textAlign: RTL_LABEL_ALIGN,
    lineHeight: 18,
  },
  // `row-reverse` so icon sits to the right of the label, centred together.
  permBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.warning,
  },
  permBtnText: {
    ...typography.body,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  // ── Categories ──
  gatedGroup: { opacity: 0.45 },
  categoryBlock: { gap: 6, marginTop: spacing.xs },
  // `row` → icon (first child) on the visual RIGHT under forceRTL.
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    marginTop: spacing.sm,
    marginBottom: 2,
    paddingHorizontal: spacing.xs,
  },
  categoryTitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
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
  label: { ...typography.body, color: colors.text, fontWeight: '600', textAlign: RTL_LABEL_ALIGN },
  sub: { ...typography.caption, color: colors.textMuted, marginTop: 2, textAlign: RTL_LABEL_ALIGN },
});
