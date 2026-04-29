// ProfileScreen — premium player hub.
//
// Layout:
//   ① Hero card — green-gradient backdrop, big jersey, name, email
//   ② BIG headline stat (games played) — single tile
//   ③ Three secondary stat tiles in a row (attended / win-rate / cancel)
//   ④ Achievements horizontal rail (most-recent unlocks)
//   ⑤ Settings sections grouped under SectionTitle headers
//
// Hierarchy: hero > main stat > secondary stats > nav rows > footer
// actions. Each band sits inside cards with the standard card shadow,
// separated by 24dp gaps.

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';

import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { StatTile } from '@/components/StatTile';
import { SectionTitle } from '@/components/SectionTitle';
import { AchievementBadge } from '@/components/AchievementBadge';
import { achievementsService } from '@/services/achievementsService';
import { userService } from '@/services';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useCurrentGroup, useIsAdmin } from '@/store/groupStore';
import { getAttendanceRate, getCancelRate, type User } from '@/types';

const SUPPORT_EMAIL = 'support@hippocampus.me';
const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.studiogameslime.soccerapp';
const APP_STORE_URL = 'https://apps.apple.com/app/id000000000';

export function ProfileScreen() {
  const nav = useNavigation<any>();
  const localUser = useUserStore((s) => s.currentUser);
  const signOut = useUserStore((s) => s.signOut);

  const currentGroup = useCurrentGroup();
  const isAdmin = useIsAdmin(localUser?.id);

  // Pull the freshest copy from /users so the stats / achievements
  // numbers are always current — the local store only holds the auth /
  // profile-edit slice and may be stale by minutes.
  const [user, setUser] = useState<User | null>(localUser);
  useEffect(() => {
    if (!localUser) return;
    let alive = true;
    userService
      .getUserById(localUser.id)
      .then((u) => {
        if (alive && u) setUser(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [localUser?.id]);

  if (!user) return null;

  const totalGames = user.stats?.totalGames ?? 0;
  const attendedCount = user.stats?.attended ?? 0;
  const attended = getAttendanceRate(user.stats);
  const cancelRate = getCancelRate(user.stats);

  const achievements = achievementsService.list(user);
  const unlocked = achievements.filter((a) => a.unlocked);
  const pendingApprovals =
    isAdmin && currentGroup ? currentGroup.pendingPlayerIds.length : 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ① HERO — full-bleed green gradient with the jersey + name. */}
        <View style={styles.heroWrap}>
          <LinearGradient
            colors={['#16A34A', '#15803D', '#0F5F2C']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroContent}>
            <PlayerIdentity user={user} size="xl" showShirtName />
            <Text style={styles.heroName} numberOfLines={1}>
              {user.name}
            </Text>
            {user.email ? (
              <Text style={styles.heroEmail} numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
            <View style={styles.heroBadgeRow}>
              {currentGroup ? (
                <Badge
                  label={currentGroup.name}
                  tone="primary"
                  icon="people-outline"
                />
              ) : null}
              {isAdmin ? (
                <Badge
                  label={he.profileBadgeAdmin}
                  tone="warning"
                  icon="shield-checkmark"
                />
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {/* ② BIG headline stat */}
          <StatTile
            size="lg"
            tone="primary"
            value={String(totalGames)}
            label={he.profileStatTotalGames}
            icon="football"
          />

          {/* ③ Secondary stat row */}
          <View style={styles.statsRow}>
            <StatTile
              size="md"
              tone="info"
              value={`${attended}%`}
              label={he.profileStatAttendance}
              icon="checkmark-circle-outline"
            />
            <StatTile
              size="md"
              tone="accent"
              value={String(attendedCount)}
              label={he.profileStatAttended}
              icon="trophy-outline"
            />
            <StatTile
              size="md"
              tone={cancelRate > 30 ? 'danger' : 'neutral'}
              value={`${cancelRate}%`}
              label={he.profileStatCancelRate}
              icon="close-circle-outline"
            />
          </View>

          {/* ④ Achievements rail */}
          {achievements.length > 0 ? (
            <View>
              <SectionTitle
                title={he.achievementsTitle}
                action={`${unlocked.length} / ${achievements.length}`}
                onActionPress={() =>
                  nav.navigate('PlayerCard', { userId: user.id })
                }
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.achievementsRail}
              >
                {achievements.slice(0, 10).map((a) => (
                  <View key={a.def.id} style={styles.achievementCell}>
                    <AchievementBadge
                      def={a.def}
                      unlocked={a.unlocked}
                      size={68}
                    />
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* Approvals — high-priority callout when admin has pending */}
          {pendingApprovals > 0 ? (
            <Pressable onPress={() => nav.navigate('AdminApproval')}>
              <Card style={styles.approvalsCard}>
                <View style={styles.approvalsRow}>
                  <View style={styles.approvalsIcon}>
                    <Ionicons
                      name="alert-circle"
                      size={22}
                      color="#C2410C"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.approvalsTitle}>
                      {he.profileSectionApprovals}
                    </Text>
                    <Text style={styles.approvalsSub}>
                      {he.profileApprovalsCount(pendingApprovals)}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-back"
                    size={20}
                    color="#C2410C"
                  />
                </View>
              </Card>
            </Pressable>
          ) : null}

          {/* ⑤ Settings — Account section */}
          <View>
            <SectionTitle title={he.profileSectionAccount} />
            <Card style={styles.linksCard}>
              <NavRow
                icon="person-circle-outline"
                label={he.profileSectionPlayerCard}
                onPress={() =>
                  nav.navigate('PlayerCard', { userId: user.id })
                }
              />
              <NavRow
                icon="create-outline"
                label={he.profileEdit}
                onPress={() => nav.navigate('ProfileEdit')}
              />
              <NavRow
                icon="shirt-outline"
                label={he.jerseyOpenPicker}
                onPress={() => nav.navigate('JerseyPicker')}
                isLast
              />
            </Card>
          </View>

          {/* Matches & schedule */}
          <View>
            <SectionTitle title={he.profileSectionMatches} />
            <Card style={styles.linksCard}>
              <NavRow
                icon="calendar-outline"
                label={he.profileSectionAvailability}
                onPress={() => nav.navigate('AvailabilityEdit')}
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
                isLast
              />
            </Card>
          </View>

          {/* Notifications + social */}
          <View>
            <SectionTitle title={he.profileSectionPreferences} />
            <Card style={styles.linksCard}>
              <NavRow
                icon="notifications-outline"
                label={he.profileSectionNotifications}
                onPress={() => nav.navigate('NotificationsSettings')}
                isLast
              />
            </Card>
          </View>

          {/* Help / feedback */}
          <View>
            <SectionTitle title={he.profileSectionSupport} />
            <Card style={styles.linksCard}>
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
                isLast
              />
            </Card>
          </View>

          {/* Sign out */}
          <Button
            title={he.profileSignOut}
            variant="outline"
            iconLeft="log-out-outline"
            fullWidth
            onPress={signOut}
            style={{ marginTop: spacing.sm }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── NavRow ──────────────────────────────────────────────────────────────

function NavRow({
  icon,
  label,
  tint,
  onPress,
  isLast,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint?: string;
  onPress: () => void;
  isLast?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.navRow,
        !isLast && styles.navRowDivider,
        pressed && { opacity: 0.6 },
      ]}
    >
      <Ionicons
        name={icon}
        size={22}
        color={tint ?? colors.primary}
        style={styles.navIcon}
      />
      <Text style={[styles.navLabel, tint ? { color: tint } : null]}>
        {label}
      </Text>
      <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

// ─── Settings link helpers ─────────────────────────────────────────────

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
    isBug ? AnalyticsEvent.ReportBugClicked : AnalyticsEvent.SuggestFeatureClicked,
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

// ─── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: spacing.xxxxl },

  // Hero
  heroWrap: {
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxxl,
    alignItems: 'center',
    overflow: 'hidden',
    borderBottomLeftRadius: radius.xxl,
    borderBottomRightRadius: radius.xxl,
    ...shadows.hero,
  },
  heroContent: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  heroName: {
    ...typography.h1,
    color: '#fff',
    marginTop: spacing.md,
    fontWeight: '800',
  },
  heroEmail: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.85)',
  },
  heroBadgeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },

  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    gap: spacing.xl,
  },

  // Stat row
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },

  // Achievements
  achievementsRail: {
    paddingVertical: spacing.xs,
    gap: spacing.md,
    paddingEnd: spacing.lg,
  },
  achievementCell: {
    width: 84,
    alignItems: 'center',
  },

  // Approvals callout
  approvalsCard: {
    backgroundColor: '#FFEDD5',
    paddingVertical: spacing.md,
  },
  approvalsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  approvalsIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalsTitle: {
    ...typography.bodyBold,
    color: '#9A3412',
  },
  approvalsSub: {
    ...typography.caption,
    color: '#9A3412',
  },

  // Settings link list
  linksCard: {
    padding: 0,
    overflow: 'hidden',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  navRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  navIcon: {
    width: 24,
    textAlign: 'center',
  },
  navLabel: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    fontWeight: '500',
  },
});
