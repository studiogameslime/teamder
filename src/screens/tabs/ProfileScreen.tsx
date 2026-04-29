import React from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';

import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore, useCurrentGroup, useIsAdmin } from '@/store/groupStore';
import { Group } from '@/types';

const SUPPORT_EMAIL = 'support@hippocampus.me';
const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.studiogameslime.soccerapp';
const APP_STORE_URL = 'https://apps.apple.com/app/id000000000';

export function ProfileScreen() {
  const nav = useNavigation<any>();
  const user = useUserStore((s) => s.currentUser);
  const signOut = useUserStore((s) => s.signOut);

  const currentGroup = useCurrentGroup();
  const isAdmin = useIsAdmin(user?.id);

  if (!user) return null;

  const handleInvite = async () => {
    if (!currentGroup) return;
    const link = `https://footy.app/join/${currentGroup.inviteCode}`;
    try {
      await Share.share({
        message: he.inviteShareBody(currentGroup.name, link),
        title: he.inviteShareSubject,
      });
      logEvent(AnalyticsEvent.InviteShared, { groupId: currentGroup.id });
    } catch (err) {
      if (__DEV__) console.warn('[invite] share failed', err);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Identity — read-only on the main profile. Editing routes
            through "ערוך פרופיל" below; the jersey is no longer
            tappable here so there's a single, unambiguous edit entry
            point. */}
        <View style={styles.header}>
          <PlayerIdentity user={user} size="lg" />
          <Text style={styles.name}>{user.name}</Text>
          {user.email && <Text style={styles.email}>{user.email}</Text>}
        </View>


        {/* Quick links: Player Card / Availability / Stats / History / Admin */}
        <View style={styles.linksGroup}>
          <NavRow
            icon="person-circle-outline"
            label={he.profileSectionPlayerCard}
            onPress={() =>
              nav.navigate('PlayerCard', { userId: user.id })
            }
          />
          <NavRow
            icon="calendar-outline"
            label={he.profileSectionAvailability}
            onPress={() => nav.navigate('AvailabilityEdit')}
          />
          <NavRow
            icon="notifications-outline"
            label={he.profileSectionNotifications}
            onPress={() => nav.navigate('NotificationsSettings')}
          />
          <NavRow
            icon="stats-chart-outline"
            label={he.profileSectionStats}
            onPress={() => nav.navigate('Stats')}
          />
          <NavRow
            icon="time-outline"
            label={he.profileSectionHistory}
            onPress={() => nav.navigate('History')}
          />
          {isAdmin && currentGroup && currentGroup.pendingPlayerIds.length > 0 && (
            <NavRow
              icon="alert-circle-outline"
              label={`${he.profileSectionApprovals} (${currentGroup.pendingPlayerIds.length})`}
              tint={colors.warning}
              onPress={() => nav.navigate('AdminApproval')}
            />
          )}
        </View>

        {/* Settings actions */}
        <View style={styles.linksGroup}>
          <NavRow
            icon="bug-outline"
            label={he.settingsReportBug}
            onPress={() => openMailto(he.settingsBugSubject, user.id)}
          />
          <NavRow
            icon="bulb-outline"
            label={he.settingsSuggestFeature}
            onPress={() => openMailto(he.settingsSuggestSubject, user.id)}
          />
          <NavRow
            icon="star-outline"
            label={he.settingsRateApp}
            onPress={openStore}
          />
        </View>

        <Button
          title={he.profileEdit}
          variant="outline"
          iconLeft="create-outline"
          fullWidth
          onPress={() => nav.navigate('ProfileEdit')}
          style={{ marginTop: spacing.md }}
        />
        <Button
          title={he.profileSignOut}
          variant="outline"
          iconLeft="log-out-outline"
          fullWidth
          onPress={signOut}
          style={{ marginTop: spacing.sm }}
        />

        <View style={{ marginTop: spacing.lg }}>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function GroupRow({
  group,
  isActive,
  onSelect,
}: {
  group: Group;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => [
        styles.groupRow,
        isActive && styles.groupRowActive,
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.groupName}>{group.name}</Text>
        <Text style={styles.groupSub}>{group.fieldName}</Text>
      </View>
      {isActive ? (
        <View style={styles.activeBadge}>
          <Ionicons name="checkmark" size={14} color="#fff" />
          <Text style={styles.activeBadgeText}>{he.profileGroupActive}</Text>
        </View>
      ) : (
        <Text style={styles.switchLink}>{he.profileGroupSwitch}</Text>
      )}
    </Pressable>
  );
}

function NavRow({
  icon,
  label,
  tint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.navRow, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icon} size={22} color={tint ?? colors.textMuted} />
      <Text style={[styles.navLabel, tint ? { color: tint } : null]}>{label}</Text>
      <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

// ─── Settings link helpers ────────────────────────────────────────────────

function debugInfoBlock(uid: string): string {
  const v = Constants.expoConfig?.version ?? 'unknown';
  return [
    '\n\n— מידע טכני —',
    `App version: ${v}`,
    `Platform: ${Platform.OS} ${Platform.Version}`,
    `User: ${uid}`,
  ].join('\n');
}

async function openMailto(subject: string, uid: string): Promise<void> {
  const isBug = subject === he.settingsBugSubject;
  logEvent(
    isBug ? AnalyticsEvent.ReportBugClicked : AnalyticsEvent.SuggestFeatureClicked
  );
  const url =
    `mailto:${SUPPORT_EMAIL}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(debugInfoBlock(uid))}`;
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else Alert.alert(he.error, he.settingsEmailUnavailable);
  } catch {
    Alert.alert(he.error, he.settingsEmailUnavailable);
  }
}

async function openStore(): Promise<void> {
  logEvent(AnalyticsEvent.RateAppClicked);
  const url = Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else Alert.alert(he.error, he.settingsRateUnavailable);
  } catch {
    if (__DEV__) Alert.alert(he.error, he.settingsRateUnavailable);
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },

  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    gap: spacing.xs,
  },
  avatarWrap: { position: 'relative' },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    end: 2,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  name: { ...typography.h2, color: colors.text, marginTop: spacing.sm },
  email: { ...typography.caption, color: colors.textMuted },
  changeHint: {
    ...typography.caption,
    color: colors.primary,
    marginTop: 2,
    fontWeight: '600',
  },

  section: { gap: spacing.sm, marginBottom: spacing.lg },
  sectionLabel: {
    ...typography.label,
    color: colors.textMuted,
    paddingHorizontal: spacing.xs,
  },
  groupsList: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  groupRowActive: { backgroundColor: colors.primaryLight },
  groupName: { ...typography.bodyBold, color: colors.text },
  groupSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  activeBadgeText: { ...typography.caption, color: '#fff', fontWeight: '600' },
  switchLink: { ...typography.label, color: colors.primary },

  inviteCard: { gap: spacing.xs },
  cardLabel: { ...typography.caption, color: colors.textMuted },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    marginTop: spacing.xs,
  },
  code: { ...typography.h3, color: colors.text, letterSpacing: 3 },

  linksGroup: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  navLabel: { ...typography.body, color: colors.text, flex: 1 },
});
