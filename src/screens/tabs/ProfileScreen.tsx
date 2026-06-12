// ProfileScreen — redesigned player card.
//
// New structure (replaces the previous identity + nav + settings
// blob):
//   ① Compact identity header (jersey + name + role badge + community)
//   ② 2×2 stats grid — משחקים / הגעה % / הופעות / ביטולים
//   ③ Full-width referral card
//   ④ Discipline row (last 10 games)
//   ⑤ Next-game card (soonest game the user is in, or empty state)
//   ⑥ Primary CTA — "הזמן חברים לאפליקציה"
//
// Everything that used to live inline (settings, nav rows, support,
// sign-out, delete account) has moved into the HamburgerMenu opened
// from the ☰ button at the top-leading edge.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { appAlert } from '@/components/AppDialog';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useFocusEffect,
  useNavigation,
  useScrollToTop,
} from '@react-navigation/native';
import Constants from 'expo-constants';

import { Button } from '@/components/Button';
import {
  ProfileHeroCard,
  type HeroMetaItem,
} from '@/components/profile/ProfileHeroCard';
import { HeroStatsCard } from '@/components/profile/HeroStatsCard';
import { DeleteAccountSheet } from '@/components/profile/DeleteAccountSheet';
import { ProfileAvailabilityCard } from '@/components/profile/ProfileAvailabilityCard';
import {
  ProfileActivityCard,
  buildProfileActivity,
} from '@/components/profile/ProfileActivityCard';
// DisciplineRow (trust meter) hidden from UI for now — see render site below.
// import { DisciplineRow } from '@/components/profile/DisciplineRow';
import { ReferralCard } from '@/components/profile/ReferralCard';
import { rcBool, rcString, useRemoteConfig } from '@/services/remoteConfigService';
import { ProfileNextGameCard } from '@/components/profile/ProfileNextGameCard';
import {
  HamburgerMenu,
  type HamburgerSection,
} from '@/components/profile/HamburgerMenu';
import { gameService, userService } from '@/services';
import type { Game } from '@/types';
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

// Support email + store URLs are remotely overridable via Remote Config
// (keys support_email / store_url_ios / store_url_android, defaults in
// remoteConfigService.RC_DEFAULTS). Read at point of use via rcString().

export function ProfileScreen() {
  useRemoteConfig(); // re-render when feature flags / config activate
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
  // Full referral list (who joined through the user + when) — powers
  // both the count tile and the recent-activity feed.
  const [referrals, setReferrals] = useState<
    Awaited<ReturnType<typeof userService.listInvitedUsers>>
  >([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
  // The soonest game the user is registered for — drives the
  // next-game card that replaced the achievements rail. Null = none
  // upcoming (or still loading on first paint).
  const [nextGame, setNextGame] = useState<Game | null>(null);
  // Live "games played" count — games the user was placed in the teams for
  // and that have passed. Replaces the dead user.stats.totalGames (never
  // incremented by any flow). null = not loaded yet.
  const [playedCount, setPlayedCount] = useState<number | null>(null);

  // Scroll-to-top: react-navigation hook listens for tab re-press.
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef as React.RefObject<ScrollView>);

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

  // Referral list — refreshes on focus so a new attribution lands in
  // both the count tile and the activity feed the next time the user
  // returns to the screen. We list (rather than just count) because the
  // activity feed needs each joiner's name + timestamp; the count is
  // simply the list length.
  useFocusEffect(
    React.useCallback(() => {
      const uid = user?.id;
      if (!uid) {
        setReferralCount(null);
        setReferrals([]);
        return;
      }
      let alive = true;
      userService
        .listInvitedUsers(uid)
        .then((list) => {
          if (!alive) return;
          setReferrals(list);
          setReferralCount(list.length);
        })
        .catch(() => {
          // Leave the previous values visible — flicker-back-to-loading
          // on every focus would be worse UX than a slightly stale 0.
        });
      return () => {
        alive = false;
      };
    }, [user?.id]),
  );

  // Load the user's soonest upcoming game. Refreshes on focus so a
  // game the user just joined (or one that filled/cancelled) is
  // reflected when they return to the profile tab.
  useFocusEffect(
    React.useCallback(() => {
      const uid = localUser?.id;
      if (!uid) {
        setNextGame(null);
        return;
      }
      let alive = true;
      gameService
        .getMyGames(uid)
        .then((mine) => {
          if (!alive) return;
          // getMyGames already returns the user's open, non-stale games
          // sorted by startsAt ascending — the first IS the soonest
          // (a game that just kicked off but isn't stale still counts
          // as "the game to show"; its kickoff chip simply hides).
          setNextGame(mine[0] ?? null);
        })
        .catch(() => {
          // Leave the previous value — a transient fetch error
          // shouldn't blank an already-shown game.
        });
      return () => {
        alive = false;
      };
    }, [localUser?.id]),
  );

  // Live "games played" count — refreshed on focus so it reflects a game
  // that just passed / got teams drawn.
  useFocusEffect(
    React.useCallback(() => {
      const uid = localUser?.id;
      if (!uid) {
        setPlayedCount(null);
        return;
      }
      let alive = true;
      gameService
        .getPlayedGames(uid)
        .then((list) => {
          if (alive) setPlayedCount(list.length);
        })
        .catch(() => {
          // Keep the previous count on a transient error.
        });
      return () => {
        alive = false;
      };
    }, [localUser?.id]),
  );

  // Admin-only: pending approvals across ALL the user's admin groups.
  // Surfaced as a badge on the hamburger row so it's still visible
  // without sitting in the focused player card.
  const pendingApprovals = useMemo(() => {
    if (!user) return 0;
    return myCommunities
      .filter((g) => g.adminIds.includes(user.id))
      .reduce((acc, g) => acc + g.pendingPlayerIds.length, 0);
  }, [myCommunities, user]);

  const onSignOut = () => {
    // Confirm before signing out — matches the delete-account guard and
    // prevents a stray tap from logging the user out.
    appAlert(
      he.profileSignOutConfirmTitle,
      he.profileSignOutConfirmBody,
      [
        { text: he.cancel, style: 'cancel' },
        { text: he.profileSignOut, style: 'destructive', onPress: signOut },
      ],
      { cancelable: true },
    );
  };

  // Open the typed-confirmation sheet (user must type בטוח) instead of a
  // one-tap destructive alert — deletion is irreversible.
  const onDeleteAccount = () => setDeleteSheetOpen(true);

  const confirmDeleteAccount = async () => {
    try {
      setDeleting(true);
      await deleteOwnAccount();
      setDeleteSheetOpen(false);
    } catch (err) {
      if (__DEV__) console.warn('[profile] delete failed', err);
      appAlert(he.profileDeleteAccountFailed);
    } finally {
      setDeleting(false);
    }
  };

  if (!user) return null;

  // Live played-games count (teams-drawn + game passed). Falls back to the
  // legacy stat only while the live count is still loading.
  const totalGames = playedCount ?? user.stats?.totalGames ?? 0;
  const attendance = getAttendanceRate(user.stats);

  // Hero meta row (under the name): communities · trust · location.
  // Each entry is only shown when its data actually exists — no
  // placeholder "0 קהילות" or a trust score for a user who never
  // played. Order matches the mockup reading right-to-left.
  const heroMeta: HeroMetaItem[] = [];
  if (myCommunities.length > 0) {
    heroMeta.push({
      icon: 'people-outline',
      text: he.profileHeroCommunities(myCommunities.length),
    });
  }
  if (totalGames > 0) {
    heroMeta.push({
      icon: 'shield-checkmark-outline',
      text: he.profileHeroTrust(attendance),
    });
  }
  if (user.availability?.homeCity) {
    heroMeta.push({
      icon: 'location-outline',
      text: user.availability.homeCity,
    });
  }

  // Recent-activity feed — merged from achievements unlocked + the
  // people who joined through the user. Pure, recomputed on render.
  const activityItems = buildProfileActivity(user, referrals);

  // Pre-compute the share invite handler once.
  const handleShareInvite = async () => {
    if (!user) return;
    // Generic "invite to the app" — lands on the home/download page and
    // credits the inviter (invitedBy), WITHOUT pushing a specific
    // community/game. The old behaviour shared the user's first community.
    const link = deepLinkService.buildAppInviteUrl(user.id);
    try {
      const result = await Share.share({
        title: he.inviteShareSubject,
        message: he.profileInviteShareBody(link),
      });
      if (result.action !== 'dismissedAction') {
        logEvent(AnalyticsEvent.InviteShared, { source: 'profile' });
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
        ...(rcBool('feature_friends')
          ? [
              {
                id: 'friends',
                label: he.friendsTitle,
                icon: 'people-outline' as const,
                onPress: () => nav.navigate('Friends'),
              },
            ]
          : []),
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
        // Stats screen removed (2026-06-12) — its games/clubs/friends now
        // live on the profile hero card itself, so the separate page was
        // redundant.
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
        ...(rcBool('feature_feedback')
          ? [
              {
                id: 'bug',
                label: he.settingsReportBug,
                icon: 'bug-outline' as const,
                onPress: () => nav.navigate('Feedback', { type: 'bug' }),
              },
              {
                id: 'feature',
                label: he.settingsSuggestFeature,
                icon: 'bulb-outline' as const,
                onPress: () => nav.navigate('Feedback', { type: 'suggestion' }),
              },
            ]
          : []),
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
          onPress: onSignOut,
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
          meta={heroMeta}
          onMenuPress={() => setMenuOpen(true)}
          onEditProfile={() => nav.navigate('ProfileEdit')}
        />

        {/* ② Floating stats card overlapping the hero bottom. */}
        <View style={styles.statsWrap}>
          <HeroStatsCard
            totalGames={totalGames}
            clubs={myCommunities.length}
            friends={user.friends?.length ?? 0}
          />
        </View>

        <View style={styles.body}>
          {/* ③ Referral row — tap → list of who joined through you */}
          {rcBool('feature_referrals') ? (
            <ReferralCard
              count={referralCount}
              onPress={() => nav.navigate('Referrals')}
            />
          ) : null}

          {/* ④ Trust/discipline meter hidden from UI for now — still computed
              server-side, just not shown to users. */}
          {/* <DisciplineRow userId={user.id} /> */}

          {/* ⑤ Next-game card — the soonest game the user is in,
              or an empty state that jumps to the Games tab. Replaced
              the achievements rail (titles still live in the menu →
              Achievements screen). */}
          <ProfileNextGameCard
            game={nextGame}
            userId={user.id}
            onOpenGame={(gameId) => nav.navigate('MatchDetails', { gameId })}
            onFindGame={() => nav.navigate('GameTab')}
          />

          {/* ⑥ Availability summary — tap → AvailabilityEdit. */}
          <ProfileAvailabilityCard
            availability={user.availability}
            onEdit={() => nav.navigate('AvailabilityEdit')}
          />

          {/* ⑦ Recent activity — achievements unlocked + referrals,
              merged newest-first (no fabricated game rows). */}
          <ProfileActivityCard items={activityItems} />

          {/* ⑧ PRIMARY CTA — invite friends. Blue accent (matches
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

      <DeleteAccountSheet
        visible={deleteSheetOpen}
        loading={deleting}
        onCancel={() => setDeleteSheetOpen(false)}
        onConfirm={confirmDeleteAccount}
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
  const subjectEnc = encodeURIComponent(subject);
  const bodyEnc = encodeURIComponent(debugInfoBlock(uid));
  // Remotely overridable support address (rcString); falls back to the
  // in-code default until a value is published in Remote Config.
  const supportEmail = rcString('support_email');

  // 1) Native mail composer. We deliberately do NOT gate on
  //    Linking.canOpenURL('mailto:…') — on Android 11+ it returns false
  //    unless the `mailto` scheme is declared in the manifest <queries>,
  //    which produced a false "no mail app" even on phones with Gmail
  //    installed. Firing the intent and catching the rejection is the
  //    reliable check.
  const mailto = `mailto:${supportEmail}?subject=${subjectEnc}&body=${bodyEnc}`;
  try {
    await Linking.openURL(mailto);
    return;
  } catch {
    /* no app handled the mailto intent — fall through to web */
  }

  // 2) Gmail web composer in the browser — works with no configured
  //    mail client (a browser is effectively always present).
  const gmailWeb =
    `https://mail.google.com/mail/?view=cm&fs=1` +
    `&to=${encodeURIComponent(supportEmail)}&su=${subjectEnc}&body=${bodyEnc}`;
  try {
    await Linking.openURL(gmailWeb);
    return;
  } catch {
    /* extremely unlikely — fall through to showing the address */
  }

  // 3) Last resort: surface the address so the user can still reach us.
  appAlert(
    he.settingsEmailUnavailable,
    `${he.settingsEmailUnavailableHint}\n\n${supportEmail}`,
  );
}

async function openStore(): Promise<void> {
  logEvent(AnalyticsEvent.RateAppClicked);
  // Explicit "rate us" tap → open the store listing's review screen
  // directly. We deliberately do NOT use StoreReview.requestReview here:
  // Apple (and Google) rate-limit the in-app prompt and may show nothing,
  // which on a button tap looks broken. The contextual auto-prompt after
  // a game fills (storeReviewService) keeps using requestReview — that's
  // the API's intended, non-button use.
  // Store URLs are remotely overridable (rcString); fall back to the
  // in-code constants until a value is published.
  const url =
    Platform.OS === 'ios'
      ? `${rcString('store_url_ios')}?action=write-review`
      : rcString('store_url_android');
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else appAlert(he.error, he.settingsRateUnavailable);
  } catch {
    if (__DEV__) appAlert(he.error, he.settingsRateUnavailable);
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
  // Hero ↔ stats overlap tightened (-28 → -36) and bottom gap
  // bumped a touch so the card sits closer to the hero (more "lifted
  // and connected") and breathes more towards the next section.
  statsWrap: {
    marginTop: -36,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
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
