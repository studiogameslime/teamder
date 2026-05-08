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
import { ProfileHeroCard } from '@/components/profile/ProfileHeroCard';
import { HeroStatsCard } from '@/components/profile/HeroStatsCard';
import { DisciplineRow } from '@/components/profile/DisciplineRow';
import { ReferralCard } from '@/components/profile/ReferralCard';
import { AchievementsRail } from '@/components/profile/AchievementsRail';
import {
  HamburgerMenu,
  type HamburgerSection,
} from '@/components/profile/HamburgerMenu';
import { achievementsService } from '@/services/achievementsService';
import type { UserAchievementState } from '@/types';
import { userService } from '@/services';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { deepLinkService } from '@/services/deepLinkService';
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

  // Mirror profile-edit changes (name / avatarId / photoUrl) back
  // into our local copy. Without this, ProfileEdit → goBack would
  // show the previous photo until the next server refetch landed:
  // the useEffect below only re-fetches on `id` change, which
  // doesn't fire for an edit of the same user.
  useEffect(() => {
    if (!localUser) return;
    setUser((prev) =>
      prev && prev.id === localUser.id ? { ...prev, ...localUser } : localUser,
    );
  }, [
    localUser,
    localUser?.name,
    localUser?.avatarId,
    localUser?.photoUrl,
  ]);
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
        {/* ① HERO. ImageBackground stadium + dark gradient + the
            top-bar buttons. Hamburger lives inside the hero so the
            background image fills behind it. */}
        <ProfileHeroCard
          user={user}
          name={user.name}
          subtitle={he.profileSubtitlePlayer}
          onMenuPress={() => setMenuOpen(true)}
          onEditProfile={() => nav.navigate('ProfileEdit')}
          onNotificationsPress={() => nav.navigate('NotificationsSettings')}
        />

        {/* ② Floating stats card overlapping the hero bottom. */}
        <View style={styles.statsWrap}>
          <HeroStatsCard
            totalGames={totalGames}
            attended={attendedCount}
            goals={user.stats?.goals ?? 0}
            attendancePct={attendance}
          />
        </View>

        <View style={styles.body}>
          {/* ③ Referral row */}
          <ReferralCard count={referralCount} />

          {/* ④ Discipline row (red/yellow indicators on leading edge) */}
          <DisciplineRow userId={user.id} />

          {/* ⑤ Achievements rail (circular ring + label) */}
          <AchievementsRail
            items={achievements}
            onSeeAll={() => nav.navigate('Achievements')}
          />

          {/* ⑥ PRIMARY CTA — invite friends. Blue accent (matches
              the new profile palette) but uses the brand-Button for
              consistency with the rest of the app. */}
          <Pressable
            onPress={handleShareInvite}
            style={({ pressed }) => [
              styles.inviteCta,
              pressed && { opacity: 0.9 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={he.profileInviteFriendsCta}
          >
            <Ionicons
              name="share-social-outline"
              size={18}
              color="#FFFFFF"
            />
            <Text style={styles.inviteCtaText}>
              {he.profileInviteFriendsCta}
            </Text>
          </Pressable>
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
  // Floating stats card — pulled UP via negative margin to overlap
  // the bottom edge of the hero gradient, then padded so its
  // shadow doesn't get clipped by the next section.
  statsWrap: {
    marginTop: -28,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  body: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  // Bespoke invite CTA — bright royal blue (matches the new
  // profile palette) with a subtle shadow. Hand-rolled instead of
  // the brand-green Button so the screen's accent stays cohesive.
  inviteCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    borderRadius: 999,
    backgroundColor: '#2563EB',
    marginTop: spacing.sm,
    shadowColor: '#1D4ED8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  inviteCtaText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  // Reserved aliases — keep so any straggling refs still resolve.
  _radius: { borderRadius: radius.lg },
});
