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

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
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
import { PressableScale } from '@/components/PressableScale';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { StatTile } from '@/components/StatTile';
import { SectionTitle } from '@/components/SectionTitle';
import { AchievementBadge } from '@/components/AchievementBadge';
import { achievementsService } from '@/services/achievementsService';
import { gameService, userService } from '@/services';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useCurrentGroup, useGroupStore, useIsAdmin } from '@/store/groupStore';
import { getAttendanceRate, getCancelRate, type User } from '@/types';

const SUPPORT_EMAIL = 'support@hippocampus.me';
const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.studiogameslime.soccerapp';
const APP_STORE_URL = 'https://apps.apple.com/app/id000000000';

/**
 * Returns a one-line preview of the most recent terminal game in the
 * current community ("DD.MM.YY · המשחק הסתיים"). Used as the History
 * NavRow's subtitle so the user sees the entry has fresh content
 * without first navigating in. `null` while loading or when no
 * history exists — the row gracefully omits the subtitle then.
 */
function useLastHistoryPreview(groupId: string | undefined): string | null {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!groupId) {
      setPreview(null);
      return;
    }
    let alive = true;
    gameService
      .getHistory(groupId)
      .then((items) => {
        if (!alive) return;
        const top = items[0];
        if (!top) return setPreview(null);
        const d = new Date(top.date);
        const dateLabel = `${d.getDate()}.${d.getMonth() + 1}.${String(
          d.getFullYear(),
        ).slice(2)}`;
        const statusLabel =
          top.status === 'cancelled'
            ? he.matchDetailsAlreadyCancelled
            : he.matchDetailsAlreadyFinished;
        setPreview(`${dateLabel} · ${statusLabel}`);
      })
      .catch(() => {
        if (alive) setPreview(null);
      });
    return () => {
      alive = false;
    };
  }, [groupId]);
  return preview;
}

/**
 * Reads the count of users this profile invited via Firestore's count
 * aggregation. Returns 0 while loading or on error — the consumer
 * hides the tile when the value is 0 so a freshly-installed user
 * doesn't see a dead "0 שחקנים שהצטרפו דרכי".
 */
function useInvitedUsersCount(userId: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!userId) {
      setCount(0);
      return;
    }
    let alive = true;
    userService
      .getInvitedUsersCount(userId)
      .then((n) => {
        if (alive) setCount(n);
      })
      .catch(() => {
        if (alive) setCount(0);
      });
    return () => {
      alive = false;
    };
  }, [userId]);
  return count;
}

export function ProfileScreen() {
  const nav = useNavigation<any>();
  const localUser = useUserStore((s) => s.currentUser);
  const signOut = useUserStore((s) => s.signOut);
  const deleteOwnAccount = useUserStore((s) => s.deleteOwnAccount);
  const [deleting, setDeleting] = useState(false);

  const onDeleteAccount = () => {
    Alert.alert(
      he.profileDeleteAccountTitle,
      he.profileDeleteAccountMessage,
      [
        { text: he.profileDeleteAccountCancel, style: 'cancel' },
        {
          text: he.profileDeleteAccountConfirm,
          style: 'destructive',
          onPress: async () => {
            try {
              setDeleting(true);
              await deleteOwnAccount();
            } catch (err) {
              if (__DEV__) console.warn('[profile] delete failed', err);
              Alert.alert(he.profileDeleteAccountFailed);
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const currentGroup = useCurrentGroup();
  const isAdmin = useIsAdmin(localUser?.id);

  // Pull the freshest copy from /users so the stats / achievements
  // numbers are always current — the local store only holds the auth /
  // profile-edit slice and may be stale by minutes.
  const [user, setUser] = useState<User | null>(localUser);
  const [refreshing, setRefreshing] = useState(false);
  const refreshUser = React.useCallback(async () => {
    if (!localUser) return;
    setRefreshing(true);
    try {
      const u = await userService.getUserById(localUser.id);
      if (u) setUser(u);
    } finally {
      setRefreshing(false);
    }
  }, [localUser]);
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

  // Hook called unconditionally so the order stays stable across
  // renders even if the user briefly resolves to null while we're
  // hydrating /users/{uid}. Empty id → service returns 0 immediately.
  const invitedCount = useInvitedUsersCount(user?.id ?? '');
  const lastHistoryPreview = useLastHistoryPreview(currentGroup?.id);

  if (!user) return null;

  const totalGames = user.stats?.totalGames ?? 0;
  const attendedCount = user.stats?.attended ?? 0;
  const attended = getAttendanceRate(user.stats);
  const cancelRate = getCancelRate(user.stats);

  const achievements = achievementsService.list(user);
  const unlocked = achievements.filter((a) => a.unlocked);
  // Sum across every community where I'm an admin, not just the
  // currently-active one — otherwise an admin of multiple groups
  // misses requests outside their selected group.
  const myCommunities = useGroupStore((s) => s.groups);
  const pendingApprovals = useMemo(() => {
    if (!user) return 0;
    return myCommunities
      .filter((g) => g.adminIds.includes(user.id))
      .reduce((acc, g) => acc + g.pendingPlayerIds.length, 0);
  }, [myCommunities, user]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshUser}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
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

          {/* Invite attribution — only surfaced when the count is
              non-zero so a brand-new user isn't confronted with a
              dead "0" stat that adds no value. */}
          {invitedCount > 0 ? (
            <StatTile
              size="md"
              tone="primary"
              value={String(invitedCount)}
              label={he.profileStatInvited}
              icon="people-outline"
            />
          ) : null}

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
                subtitle={lastHistoryPreview ?? undefined}
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

          {/* Delete account — required for Play Store compliance */}
          <Pressable
            onPress={onDeleteAccount}
            disabled={deleting}
            style={({ pressed }) => [
              styles.deleteAccountRow,
              pressed && { opacity: 0.6 },
              deleting && { opacity: 0.5 },
            ]}
          >
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
            <Text style={styles.deleteAccountText}>
              {he.profileDeleteAccount}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── NavRow ──────────────────────────────────────────────────────────────

function NavRow({
  icon,
  label,
  subtitle,
  tint,
  onPress,
  isLast,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Optional one-line caption under the label (muted). */
  subtitle?: string;
  tint?: string;
  onPress: () => void;
  isLast?: boolean;
}) {
  return (
    <PressableScale
      onPress={onPress}
      style={!isLast ? styles.navRowDivider : undefined}
    >
      <View style={styles.navRow}>
        <Ionicons
          name={icon}
          size={22}
          color={tint ?? colors.primary}
          style={styles.navIcon}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.navLabel, tint ? { color: tint } : null]}>
            {label}
          </Text>
          {subtitle ? <Text style={styles.navSubtitle}>{subtitle}</Text> : null}
        </View>
        <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
      </View>
    </PressableScale>
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
    fontWeight: '500',
  },
  navSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  deleteAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  deleteAccountText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '600',
  },
});
