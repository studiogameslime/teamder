// ProfileScreen — redesigned player card.
//
// New structure (replaces the previous identity + nav + settings
// blob):
//   ① Compact identity header (jersey + name + role badge + community)
//   ② 2×2 stats grid — משחקים / הגעה % / הופעות / ביטולים
//   ③ Full-width referral card
//   ④ Discipline row (last 10 games)
//   ⑤ Achievements rail (optional)
//   ⑥ Primary CTA — "הזמן חברים לאפליקציה"
//
// Everything that used to live inline (settings, nav rows, support,
// sign-out, delete account) has moved into the HamburgerMenu opened
// from the ☰ button at the top-leading edge.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useFocusEffect,
  useNavigation,
  useScrollToTop,
} from '@react-navigation/native';
import Constants from 'expo-constants';

import { Button } from '@/components/Button';
import { AchievementBadge } from '@/components/AchievementBadge';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { StatsGrid } from '@/components/profile/StatsGrid';
import { DisciplineRow } from '@/components/profile/DisciplineRow';
import { ReferralCard } from '@/components/profile/ReferralCard';
import {
  HamburgerMenu,
  type HamburgerSection,
} from '@/components/profile/HamburgerMenu';
import { achievementsService } from '@/services/achievementsService';
import type { UserAchievementState } from '@/types';
import { userService } from '@/services';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { deepLinkService } from '@/services/deepLinkService';
import { autoJersey } from '@/data/jerseys';
import {
  colors,
  radius,
  spacing,
  typography,
  RTL_LABEL_ALIGN,
} from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore, useIsAdmin } from '@/store/groupStore';
import { getAttendanceRate, type User } from '@/types';

const SUPPORT_EMAIL = 'support@hippocampus.me';
const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.studiogameslime.soccerapp';
const APP_STORE_URL = 'https://apps.apple.com/app/id000000000';

export function ProfileScreen() {
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const localUser = useUserStore((s) => s.currentUser);
  const signOut = useUserStore((s) => s.signOut);
  const deleteOwnAccount = useUserStore((s) => s.deleteOwnAccount);
  const isAdmin = useIsAdmin(localUser?.id);
  const myCommunities = useGroupStore((s) => s.groups);

  // Pull a fresher copy of /users so stats stay current — the local
  // store only holds the auth/profile-edit slice and may be stale.
  const [user, setUser] = useState<User | null>(localUser);
  const [refreshing, setRefreshing] = useState(false);
  const [referralCount, setReferralCount] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Derived achievement counters — drives the inline achievements rail
  // so it can't show a "5-games-played" badge while the stats grid
  // shows 0 games. Null while computing.
  const [achievementCounters, setAchievementCounters] =
    useState<UserAchievementState | null>(null);

  // Scroll-to-top: react-navigation hook listens for tab re-press.
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

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
      .catch(() => {
        // Silent — we keep showing the cached store value.
      });
    return () => {
      alive = false;
    };
  }, [localUser?.id]);

  // Referral count — refreshes on focus so a new attribution lands
  // in the metric the next time the user returns to the screen.
  useFocusEffect(
    React.useCallback(() => {
      const uid = user?.id;
      if (!uid) {
        setReferralCount(null);
        return;
      }
      let alive = true;
      userService
        .getInvitedUsersCount(uid)
        .then((n) => {
          if (alive) setReferralCount(n);
        })
        .catch(() => {
          // Leave the previous count visible — flicker-back-to-loading
          // on every focus would be worse UX than a slightly stale 0.
        });
      return () => {
        alive = false;
      };
    }, [user?.id]),
  );

  // Recompute achievement counters from real data when the user or
  // their groups change. Fires once on mount and any time the
  // surrounding state shifts. We also persist the reconciled
  // unlocked list so legacy bump-driven entries get pruned.
  useEffect(() => {
    const uid = localUser?.id;
    if (!uid) return;
    let alive = true;
    achievementsService
      .deriveCounters(uid, { groups: myCommunities })
      .then((c) => {
        if (!alive) return;
        setAchievementCounters(c);
        achievementsService.persistDerivedUnlocks(uid, c);
      })
      .catch(() => {
        // Leave null — rail just hides until next refresh.
      });
    return () => {
      alive = false;
    };
  }, [localUser?.id, myCommunities]);

  // Admin-only: pending approvals across ALL the user's admin groups.
  // Surfaced as a badge on the hamburger row so it's still visible
  // without sitting in the focused player card.
  const pendingApprovals = useMemo(() => {
    if (!user) return 0;
    return myCommunities
      .filter((g) => g.adminIds.includes(user.id))
      .reduce((acc, g) => acc + g.pendingPlayerIds.length, 0);
  }, [myCommunities, user]);

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

  if (!user) return null;

  const totalGames = user.stats?.totalGames ?? 0;
  const attendedCount = user.stats?.attended ?? 0;
  const cancelledCount = user.stats?.cancelled ?? 0;
  const attendance = getAttendanceRate(user.stats);
  // Strict derivation when ready; while computing we render nothing
  // rather than risk showing stale stored counters.
  const achievements = achievementCounters
    ? achievementsService.listFromCounters(user, achievementCounters)
    : [];

  // Pre-compute the share invite handler once.
  const handleShareInvite = async () => {
    if (!user) return;
    const firstCommunity = myCommunities[0];
    const link = firstCommunity
      ? deepLinkService.buildInviteUrl({
          type: 'team',
          id: firstCommunity.id,
          invitedBy: user.id,
        })
      : PLAY_STORE_URL;
    try {
      const result = await Share.share({
        title: he.inviteShareSubject,
        message: he.profileInviteShareBody(link),
      });
      if (result.action !== 'dismissedAction') {
        logEvent(AnalyticsEvent.InviteShared, {
          source: 'profile',
          hasCommunity: !!firstCommunity,
        });
      }
    } catch (err) {
      if (__DEV__) console.warn('[profile] invite share failed', err);
    }
  };

  // Build the hamburger sections. We do it inline rather than a
  // separate function so the closures over `nav` + `user` stay
  // type-safe without prop drilling.
  const sections: HamburgerSection[] = [
    {
      id: 'profile',
      title: he.profileMenuSectionProfile,
      items: [
        {
          id: 'achievements',
          label: he.profileSectionMyAchievements,
          icon: 'trophy-outline',
          // Dedicated achievements view — shows ONLY the badge grid
          // and detail popover, none of the rest of the player card.
          onPress: () => nav.navigate('Achievements'),
        },
        {
          id: 'edit',
          label: he.profileEdit,
          icon: 'create-outline',
          onPress: () => nav.navigate('ProfileEdit'),
        },
        {
          id: 'jersey',
          label: he.jerseyOpenPicker,
          icon: 'shirt-outline',
          onPress: () => nav.navigate('JerseyPicker'),
        },
      ],
    },
    {
      id: 'games',
      title: he.profileMenuSectionGames,
      items: [
        {
          id: 'availability',
          label: he.profileSectionAvailability,
          icon: 'calendar-outline',
          onPress: () => nav.navigate('AvailabilityEdit'),
        },
        {
          id: 'history',
          label: he.profileSectionHistory,
          icon: 'time-outline',
          onPress: () => nav.navigate('History'),
        },
        // Stats screen exists — keep accessible from menu under games
        // so we don't drop functionality the previous design exposed.
        {
          id: 'stats',
          label: he.profileSectionStats,
          icon: 'stats-chart-outline',
          onPress: () => nav.navigate('Stats'),
        },
      ],
    },
    // Admin-only: pending approvals. Rendered as its own section so
    // the badge is impossible to miss without bloating other sections.
    ...(isAdmin && pendingApprovals > 0
      ? [
          {
            id: 'admin',
            title: he.profileMenuSectionSystem,
            items: [
              {
                id: 'approvals',
                label: he.profileSectionApprovals,
                icon: 'shield-checkmark-outline' as const,
                onPress: () => nav.navigate('AdminApproval'),
                badge: pendingApprovals,
              },
            ],
          },
        ]
      : []),
    {
      id: 'system',
      title: isAdmin && pendingApprovals > 0 ? undefined : he.profileMenuSectionSystem,
      items: [
        {
          id: 'notifications',
          label: he.profileSectionNotifications,
          icon: 'notifications-outline',
          onPress: () => nav.navigate('NotificationsSettings'),
        },
      ],
    },
    {
      id: 'support',
      title: he.profileMenuSectionSupport,
      items: [
        {
          id: 'bug',
          label: he.settingsReportBug,
          icon: 'bug-outline',
          onPress: () => openMailto(he.settingsBugSubject, user.id),
        },
        {
          id: 'feature',
          label: he.settingsSuggestFeature,
          icon: 'bulb-outline',
          onPress: () => openMailto(he.settingsSuggestSubject, user.id),
        },
        {
          id: 'rate',
          label: he.settingsRateApp,
          icon: 'star-outline',
          onPress: openStore,
        },
      ],
    },
    {
      id: 'account',
      title: he.profileMenuSectionAccount,
      items: [
        {
          id: 'signout',
          label: he.profileSignOut,
          icon: 'log-out-outline',
          onPress: signOut,
        },
        {
          id: 'delete',
          label: he.profileDeleteAccount,
          icon: 'trash-outline',
          onPress: onDeleteAccount,
          tone: 'danger',
        },
      ],
    },
  ];

  // Effective jersey for the header — falls back to the deterministic
  // auto-jersey so brand-new users see a real visual instead of a
  // blank shirt.
  const headerJersey = user.jersey ?? autoJersey(user.id, user.name);

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
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
        {/* ① HEADER. Hamburger button floats inside the gradient at
            the top-leading edge — RTL flips so it lands on the right
            visually, which is the natural spot for a back/menu
            affordance in Hebrew. */}
        <SafeAreaView edges={['top']} style={styles.headerArea}>
          <ProfileHeader jersey={headerJersey} name={user.name} />
          <Pressable
            onPress={() => setMenuOpen(true)}
            hitSlop={10}
            style={({ pressed }) => [
              styles.menuButton,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityLabel={he.profileMenuOpen}
            accessibilityRole="button"
          >
            <Ionicons name="menu" size={24} color="#FFFFFF" />
          </Pressable>
        </SafeAreaView>

        {/* ② STATS GRID */}
        <View style={styles.body}>
          <StatsGrid
            stats={[
              {
                label: he.profileStatTotalGames,
                value: String(totalGames),
                icon: 'football-outline',
              },
              {
                label: he.profileStatAttendance,
                value: `${attendance}%`,
                tint: colors.primary,
                icon: 'checkmark-circle-outline',
              },
              {
                label: he.profileStatAttended,
                value: String(attendedCount),
                icon: 'trophy-outline',
              },
              {
                label: he.profileStatCancelRate,
                value: String(cancelledCount),
                tint:
                  cancelledCount > 0 && totalGames > 0
                    ? colors.textMuted
                    : undefined,
                icon: 'close-circle-outline',
              },
            ]}
          />

          {/* ③ Referral metric — full width, single line */}
          <ReferralCard count={referralCount} />

          {/* ④ Discipline snapshot — compact row */}
          <DisciplineRow userId={user.id} />

          {/* ⑤ Achievements rail — kept lightweight, optional */}
          {achievements.length > 0 ? (
            <View style={styles.achievementsBlock}>
              <Text style={styles.sectionTitle}>{he.achievementsTitle}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.achievementsRail}
              >
                {achievements.slice(0, 12).map((a) => (
                  <View key={a.def.id} style={styles.achievementCell}>
                    <AchievementBadge
                      def={a.def}
                      unlocked={a.unlocked}
                      size={56}
                    />
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* ⑥ PRIMARY CTA — sole call-to-action on this screen */}
          <Button
            title={he.profileInviteFriendsCta}
            variant="primary"
            size="lg"
            iconLeft="share-social-outline"
            fullWidth
            onPress={handleShareInvite}
            style={{ marginTop: spacing.sm }}
          />
        </View>
      </ScrollView>

      <HamburgerMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        sections={sections}
      />
    </View>
  );
}

// ─── Side-effect helpers (preserved from previous implementation) ───────

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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    paddingBottom: spacing.xxl,
  },
  // SafeAreaView wraps the gradient so the status bar area is part
  // of the green band — looks more polished than a status bar floating
  // over the content. The hamburger button sits absolutely on top.
  headerArea: {
    backgroundColor: '#15803D', // matches gradient end colour
    position: 'relative',
  },
  menuButton: {
    position: 'absolute',
    top: 0,
    // RN flips `start`/`end` at runtime under RTL. The spec asks for
    // top-left (the actual leading visual edge in our left-running
    // gesture model), so under forceRTL=true the leading edge is the
    // right side of the screen — `start` lands there. If we ever
    // disable forceRTL the same code lands on the visual left.
    start: spacing.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    // Push well below the status-bar / safe-area inset so the icon
    // doesn't fight for space with the time/network indicators.
    // ~32 px is enough on every notch/punch-hole Android we test on.
    marginTop: spacing.xl,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.xs,
  },
  achievementsBlock: {
    gap: spacing.xs,
  },
  achievementsRail: {
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  achievementCell: {
    alignItems: 'center',
  },
  // Reserved tokens for future visual tweaks.
  _radius: { borderRadius: radius.lg },
});
