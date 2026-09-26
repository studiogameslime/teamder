// GuestHomeScreen — the home of a RETURNING guest.
//
// ─── It is no longer the onboarding ─────────────────────────────────────
//
// The header on this file used to read "the Home IS the onboarding", which was
// the decision of the round that built it: no carousel, no wall, land a fresh
// install straight on a screen that asks what you want. That decision has been
// reversed. A first run now meets Welcome → Intent (`src/screens/entry`), and
// the intent is what routes somebody into one of the flows below rather than
// this screen having to carry all four at once.
//
// What this screen IS, unchanged: where a guest lands on every launch AFTER
// that first one — they have answered the question, they do not have an
// account, and this is their app. Nothing in the file needed to change for the
// new flow; the routing above it did. See `entryGate.ts`.
//
// It still offers all four, in the product's own order of value:
//
//   1  הקם מועדון   — the organiser, who brings everyone else
//   2  צור מחזור    — the one-off, for somebody not ready to run a club
//   3  מחפש איפה לשחק? — discovery, for somebody who just wants to play
//   4  מתי נוח לך?  — availability, so organisers can find THEM
//
// Nothing here asks for an account. Every one of those four routes into a flow
// a guest can walk all the way to Save, where the contextual sheet takes over
// (rounds 5–7). That is the whole point: the account is the price of a WRITE,
// not of looking.
//
// ─── What this is not ────────────────────────────────────────────────────
//
// Not a design system. Every colour, radius, shadow, type ramp, card and
// button below is the one the app already ships; what changed is hierarchy and
// composition. And not a replacement for the established-user Home — see
// ProfileStack for who lands where and why.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { Card } from '@/components/Card';
import { PressableScale } from '@/components/PressableScale';
import { MatchListCard } from '@/components/match/MatchListCard';
import { MatchCardSkeleton } from '@/components/anim/MatchCardSkeleton';
import { AppearItem } from '@/components/anim/AppearItem';
import { gameService } from '@/services/gameService';
import { draftStore } from '@/services/draftStore';
import { getEntrySource } from '@/services/entrySource';
import { logError } from '@/services/errorLog';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { colors, radius, shadows, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { Game } from '@/types';

/** How many matches Home shows before handing off to the real feed. Home is a
 *  starting point, not a feed — an endless list here would bury the actions
 *  that are the reason the screen exists. */
const DISCOVERY_LIMIT = 3;

type Nav = {
  navigate: (screen: string, params?: unknown) => void;
};

type DiscoveryState =
  | { status: 'loading' }
  | { status: 'ready'; games: Game[] }
  | { status: 'error' };

export function GuestHomeScreen() {
  const nav = useNavigation<Nav>();
  const user = useUserStore((s) => s.currentUser);
  const isGuest = user?.isGuest === true;
  const myCommunities = useGroupStore((s) => s.groups);

  const [discovery, setDiscovery] = useState<DiscoveryState>({ status: 'loading' });
  const [resume, setResume] = useState<'club' | 'game' | null>(null);

  // ── Discovery ────────────────────────────────────────────────────────────
  //
  // The same call the games feed makes, and deliberately the ONLY server read
  // this screen adds: the feed runs four (mine / community / open / scheduled)
  // and a guest has no answer for three of them. So a guest's first screen is
  // now cheaper than the one they used to land on, not more expensive.
  const load = useCallback(async () => {
    if (!user) return;
    setDiscovery({ status: 'loading' });
    try {
      const ids = myCommunities.map((g) => g.id);
      const games = await gameService.getOpenGames(user.id, ids);
      setDiscovery({ status: 'ready', games: games.slice(0, DISCOVERY_LIMIT) });
    } catch (err) {
      // Local failure only. The hero and the two actions stay exactly where
      // they are — the reason somebody opened the app does not depend on
      // whether a query answered.
      logError('guestHomeDiscovery', err, { screen: 'GuestHomeScreen' });
      setDiscovery({ status: 'error' });
    }
  }, [user, myCommunities]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── A draft that outlived its sign-in ────────────────────────────────────
  //
  // Somebody filled the club wizard, met the auth sheet, backed out, and came
  // back later. The draft is still on disk (7-day TTL) and the wizard would
  // restore it silently — which visual QA flagged as a surprise. Saying so on
  // Home turns the same fact into an offer. Checked on focus because the
  // interesting moment is RETURNING to this screen.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        try {
          // Club first: it is the higher-value intent, and offering two
          // continuations at once would be a menu, not a nudge.
          const club = await draftStore.read('club');
          if (!alive) return;
          if (club) {
            setResume('club');
            return;
          }
          const game = await draftStore.read('game');
          if (!alive) return;
          setResume(game ? 'game' : null);
        } catch {
          // A draft we cannot read is a draft there is nothing to offer about.
          if (alive) setResume(null);
        }
      })();
      return () => {
        alive = false;
      };
    }, []),
  );

  // ── Reporting ────────────────────────────────────────────────────────────
  //
  // Once per mount, and only once the discovery query has RESOLVED — the whole
  // reason this event carries `has_open_games` is to separate "nobody tapped"
  // from "there was nothing to tap", and firing while still loading would
  // record the second as the first.
  const reportedRef = useRef(false);
  useEffect(() => {
    if (reportedRef.current || discovery.status === 'loading') return;
    reportedRef.current = true;
    logEvent(AnalyticsEvent.GuestHomeViewed, {
      is_guest: isGuest,
      // The launch's REAL source, from the one place that resolves it.
      //
      // This used to be hardcoded `'organic'`, on the reasoning that a deep
      // link goes straight to its target and never renders this stack. It
      // does render it: `navigatePersonalInvite` addresses ProfileTab with
      // `initial: false` so the Home sits beneath the landing as a back
      // target, and the Home mounts and reports. A device run logged
      // `entry_source_resolved{personal_invite}` and then
      // `guest_home_viewed{organic}` for the same launch.
      entry_source: getEntrySource(),
      has_open_games: discovery.status === 'ready' && discovery.games.length > 0,
      availability_state: availabilityState(user?.availability?.preferredDays?.length ?? 0),
    });
  }, [discovery, isGuest, user]);

  // ── Actions ──────────────────────────────────────────────────────────────
  //
  // Every one of these opens an EXISTING flow. No new form is introduced by
  // this screen, and no gate is added in front of one: the guest walks the
  // wizard and meets the sheet at Save, which is the architecture rounds 5–7
  // built and verified.

  const openCreateClub = () => {
    logEvent(AnalyticsEvent.CommunityCreateStarted, { source: 'guest_home' });
    nav.navigate('CommunitiesCreate');
  };

  const openCreateGame = (source: 'primary' | 'empty_state') => {
    logEvent(AnalyticsEvent.GameCreateStarted, {
      stage: 'wizard',
      source: source === 'primary' ? 'guest_home' : 'guest_home_empty',
      mode: 'quick',
      prefilled: false,
      communityCount: myCommunities.length,
    });
    // `quick: true` skips the chooser. Home has already asked the question the
    // chooser asks, and a guest administers no club, so the other branch is
    // locked anyway.
    nav.navigate('GameCreate', { quick: true });
  };

  const openAvailability = () => {
    logEvent(AnalyticsEvent.AvailabilityPromptTapped, { source: 'guest_home' });
    nav.navigate('AvailabilityEdit');
  };

  const openAllGames = () => {
    // The real feed, which is a TAB — so this is the one action that leaves
    // the Home stack, and correctly: "all matches" is that tab's whole job.
    nav.navigate('GameTab');
  };

  const openAccount = () => {
    nav.navigate('Profile');
  };

  const continueDraft = () => {
    if (resume === 'club') {
      logEvent(AnalyticsEvent.CommunityCreateStarted, { source: 'guest_home_resume' });
      nav.navigate('CommunitiesCreate');
      return;
    }
    logEvent(AnalyticsEvent.GameCreateStarted, {
      stage: 'wizard',
      source: 'guest_home_resume',
      mode: 'quick',
      prefilled: true,
      communityCount: myCommunities.length,
    });
    nav.navigate('GameCreate', { quick: true });
  };

  const hasAvailability = (user?.availability?.preferredDays?.length ?? 0) > 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Header — deliberately light. A wordmark and a way to the account,
            and nothing else: this screen's job is the four actions below it,
            and a row of controls above them would compete for the same
            attention. */}
        <View style={styles.header}>
          <Text style={styles.wordmark}>Teamder</Text>
          <Pressable
            onPress={openAccount}
            hitSlop={10}
            style={({ pressed }) => [styles.accountBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={he.guestHomeAccountA11y}
          >
            <Ionicons name="person-circle-outline" size={30} color={colors.primary} />
          </Pressable>
        </View>

        {/* Hero — two lines. Anything longer is a paragraph somebody skips on
            the way to the buttons. */}
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>{he.guestHomeTitle}</Text>
          <Text style={styles.heroSub}>{he.guestHomeSubtitle}</Text>
        </View>

        {resume ? (
          <Card style={styles.resume} onPress={continueDraft}>
            {/* Inner row for the same reason as ActionCard: a tappable Card is
                a PressableScale, and a flexDirection on it does not reach the
                children. */}
            <View style={styles.resumeRow}>
              <Ionicons name="time-outline" size={20} color={colors.primary} />
              <Text style={styles.resumeText}>
                {resume === 'club' ? he.guestHomeResumeClub : he.guestHomeResumeGame}
              </Text>
              <Text style={styles.resumeCta}>{he.guestHomeResumeCta}</Text>
            </View>
          </Card>
        ) : null}

        {/* The two creates. They are NOT two of the same button: the primary
            is filled brand blue, the secondary a white card with a border —
            the app's own primary/outline pairing, borrowed from Button. The
            one-line hints exist because "מועדון" vs "מחזור" is the single
            thing a new person cannot guess. */}
        <ActionCard
          tone="primary"
          icon="people"
          label={he.guestHomeCreateClubCta}
          hint={he.guestHomeCreateClubHint}
          onPress={openCreateClub}
        />
        <ActionCard
          tone="secondary"
          icon="football-outline"
          label={he.guestHomeCreateGameCta}
          hint={he.guestHomeCreateGameHint}
          onPress={() => openCreateGame('primary')}
        />

        {/* ── Discovery ─────────────────────────────────────────────────── */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{he.guestHomeDiscoveryTitle}</Text>
          <View style={styles.sectionRule} />
        </View>

        {discovery.status === 'loading' ? (
          <View style={styles.list}>
            <MatchCardSkeleton count={2} />
          </View>
        ) : discovery.status === 'error' ? (
          <Card style={styles.notice}>
            <Text style={styles.noticeText}>{he.guestHomeDiscoveryError}</Text>
            <Pressable
              onPress={() => void load()}
              style={({ pressed }) => [styles.noticeCta, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={he.guestHomeDiscoveryRetry}
            >
              <Text style={styles.noticeCtaText}>{he.guestHomeDiscoveryRetry}</Text>
            </Pressable>
          </Card>
        ) : discovery.games.length === 0 ? (
          // Not an empty section — a sentence and a way forward. And
          // deliberately quiet: an empty discovery must not out-shout the
          // primary action two rows above it.
          <Card style={styles.notice}>
            <Text style={styles.noticeText}>{he.guestHomeDiscoveryEmpty}</Text>
            <Pressable
              onPress={() => openCreateGame('empty_state')}
              style={({ pressed }) => [styles.noticeCta, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={he.guestHomeDiscoveryEmptyCta}
            >
              <Text style={styles.noticeCtaText}>{he.guestHomeDiscoveryEmptyCta}</Text>
            </Pressable>
          </Card>
        ) : (
          <View style={styles.list}>
            {discovery.games.map((g, i) => (
              <AppearItem key={g.id} index={i}>
                <MatchListCard
                  game={g}
                  userId={user?.id ?? ''}
                  // The card's own tap already opens MatchDetails; this is its
                  // CTA. Both go to the same place on purpose — joining lives
                  // on the game screen, where the roster, the conflict checks
                  // and the contextual sheet already are. A second join
                  // implementation on Home is how the two would drift.
                  onPrimary={() => nav.navigate('MatchDetails', { gameId: g.id })}
                />
              </AppearItem>
            ))}
            <Pressable
              onPress={openAllGames}
              style={({ pressed }) => [styles.allRow, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={he.guestHomeDiscoveryAll}
            >
              <Text style={styles.allText}>{he.guestHomeDiscoveryAll}</Text>
              <Ionicons name="chevron-back" size={16} color={colors.primary} />
            </Pressable>
          </View>
        )}

        {/* ── Availability ──────────────────────────────────────────────── */}
        <Card style={styles.availability} onPress={openAvailability}>
          <View style={styles.availIcon}>
            <Ionicons name="calendar-outline" size={22} color={colors.primary} />
          </View>
          <Text style={styles.availTitle}>{he.guestHomeAvailabilityTitle}</Text>
          <Text style={styles.availBody}>{he.guestHomeAvailabilityBody}</Text>
          <View style={styles.availCta}>
            <Text style={styles.availCtaText}>
              {hasAvailability ? he.guestHomeAvailabilityUpdateCta : he.availFeedPromptCta}
            </Text>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

/** 'set' | 'unset' — kept as a named function so the analytics vocabulary has
 *  exactly one definition. A guest is always 'unset': availability lives on
 *  the /users document, and a guest has none. */
function availabilityState(dayCount: number): 'set' | 'unset' {
  return dayCount > 0 ? 'set' : 'unset';
}

// ─── The two creates ──────────────────────────────────────────────────────

function ActionCard({
  tone,
  icon,
  label,
  hint,
  onPress,
}: {
  tone: 'primary' | 'secondary';
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint: string;
  onPress: () => void;
}) {
  const primary = tone === 'primary';
  return (
    <PressableScale
      onPress={onPress}
      style={[styles.action, primary ? styles.actionPrimary : styles.actionSecondary]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {/* The row lives on an INNER View, not on the Pressable above it.
          PressableScale puts its children inside one wrapper, so a
          `flexDirection` on the Pressable never reaches them — they stack, and
          the chevron ends up on a line of its own under the hint. The
          component warns about this in __DEV__; the warning was earned. */}
      <View style={styles.actionRow}>
        <View style={[styles.actionIcon, primary ? styles.actionIconPrimary : null]}>
          <Ionicons
            name={icon}
            size={22}
            color={primary ? colors.textOnPrimary : colors.primary}
          />
        </View>
        <View style={styles.actionText}>
          <Text style={[styles.actionLabel, primary ? styles.onPrimary : null]}>
            {label}
          </Text>
          <Text style={[styles.actionHint, primary ? styles.onPrimaryMuted : null]}>
            {hint}
          </Text>
        </View>
        <Ionicons
          name="chevron-back"
          size={18}
          color={primary ? 'rgba(255,255,255,0.75)' : colors.textMuted}
        />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wordmark: {
    ...typography.h3,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: 0.2,
  },
  accountBtn: { padding: spacing.xs },

  hero: { gap: spacing.xs, marginTop: spacing.xs, marginBottom: spacing.xs },
  heroTitle: {
    ...typography.h1,
    fontWeight: '900',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  heroSub: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },

  resume: { paddingVertical: spacing.md },
  resumeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  resumeText: { ...typography.label, color: colors.text, flex: 1, textAlign: RTL_LABEL_ALIGN },
  resumeCta: { ...typography.label, fontWeight: '800', color: colors.primary },

  action: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actionPrimary: { backgroundColor: colors.primary },
  actionSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  actionIconPrimary: { backgroundColor: 'rgba(255,255,255,0.18)' },
  actionText: { flex: 1, gap: 2 },
  actionLabel: {
    ...typography.h3,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  actionHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  onPrimary: { color: colors.textOnPrimary },
  onPrimaryMuted: { color: 'rgba(255,255,255,0.85)' },

  sectionHead: { marginTop: spacing.md, gap: spacing.xs },
  sectionTitle: {
    ...typography.h3,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  sectionRule: {
    width: 56,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.info,
    alignSelf: 'flex-start',
  },

  list: { gap: spacing.md },

  notice: { gap: spacing.sm, paddingVertical: spacing.lg },
  noticeText: { ...typography.body, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  noticeCta: { alignSelf: 'flex-start' },
  noticeCtaText: { ...typography.label, fontWeight: '800', color: colors.primary },

  allRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  allText: { ...typography.label, fontWeight: '700', color: colors.primary },

  availability: { gap: spacing.xs, marginTop: spacing.md, paddingVertical: spacing.lg },
  availIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
    marginBottom: spacing.xs,
  },
  availTitle: {
    ...typography.h3,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  availBody: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    lineHeight: 21,
  },
  availCta: { alignSelf: 'flex-start', marginTop: spacing.sm },
  availCtaText: { ...typography.label, fontWeight: '800', color: colors.primary },
});
