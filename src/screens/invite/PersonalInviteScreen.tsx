// PersonalInviteScreen — somebody's friend sent them here, and the app says so.
//
// A personal link used to land on whatever the app happened to show: the games
// feed, then the guest Home. Both are right for somebody who just opened
// Teamder and wrong for somebody who was INVITED — the one thing they know is
// that a specific person wanted them here, and the app was the only party in
// the conversation that did not mention it.
//
// So: who invited you, then what that person actually plays, then a way on.
// Nothing here asks for an account. Opening a club or a match is browsing;
// joining one is a write, and the contextual sheet on those screens owns it.
//
// ─── What it is allowed to know ──────────────────────────────────────────
//
// Everything comes from `personalInvite.ts`, which is the file that argues the
// privacy boundary: `/usersPublic` for the name and face, the public discovery
// query for matches, `/groupsPublic` for the clubs behind them. No `/users`
// read — a guest cannot make one, and attempting it is a permission error for
// every invited person on earth.
//
// ─── What it must not do ─────────────────────────────────────────────────
//
// Consume the invite. The stash is what `applyInviteAttributionIfFresh` reads
// at SIGNUP, which happens long after this screen — see `inviteLanding.ts`.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';

import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { MatchListCard } from '@/components/match/MatchListCard';
import { MatchCardSkeleton } from '@/components/anim/MatchCardSkeleton';
import { AppearItem } from '@/components/anim/AppearItem';
import {
  resolveInviter,
  resolveInviteActivity,
  type InviteContext,
} from '@/services/personalInvite';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { useUserStore } from '@/store/userStore';
import { colors, radius, shadows, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { Game, GroupPublic } from '@/types';
import type { PublicUser } from '@/firebase/firestore';

type Nav = { navigate: (s: string, p?: unknown) => void; goBack: () => void };
type Params = { PersonalInvite: { invitedBy?: string; source?: string } | undefined };

type ActivityState =
  | { status: 'loading' }
  | { status: 'ready'; games: Game[]; clubs: GroupPublic[] }
  | { status: 'error' };

export function PersonalInviteScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<Params, 'PersonalInvite'>>();
  const invitedBy = route.params?.invitedBy;
  const me = useUserStore((s) => s.currentUser);

  // Two independent loads, deliberately. The hero is the reason the screen
  // exists and resolves from a single get; the activity below is a query and a
  // few more gets. Making the hero wait for them would put a spinner over the
  // one sentence somebody actually came for.
  const [inviter, setInviter] = useState<PublicUser | null>(null);
  const [inviterLoading, setInviterLoading] = useState(!!invitedBy);
  const [unresolved, setUnresolved] = useState<InviteContext['unresolvedReason']>(
    invitedBy ? undefined : 'no_inviter',
  );
  const [activity, setActivity] = useState<ActivityState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { inviter: found, reason } = await resolveInviter(invitedBy);
      if (!alive) return;
      setInviter(found);
      setUnresolved(reason);
      setInviterLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [invitedBy]);

  const loadActivity = useCallback(async () => {
    if (!me) return;
    setActivity({ status: 'loading' });
    try {
      const { games, clubs } = await resolveInviteActivity(invitedBy, me.id);
      setActivity({ status: 'ready', games, clubs });
    } catch {
      // `resolveInviteActivity` already swallows its own failures; this is the
      // belt to its braces. Either way the hero above stays exactly where it is.
      setActivity({ status: 'error' });
    }
  }, [invitedBy, me]);

  useEffect(() => {
    void loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, invitedBy]);

  // Reported once, and only once BOTH loads have settled: the whole value of
  // `has_clubs` / `has_games` is telling "nobody tapped" apart from "there was
  // nothing to tap", and firing early records the second as the first.
  const reportedRef = useRef(false);
  useEffect(() => {
    if (reportedRef.current || inviterLoading || activity.status === 'loading') return;
    reportedRef.current = true;
    logEvent(AnalyticsEvent.PersonalInviteViewed, {
      is_guest: me?.isGuest === true,
      entry_source: 'personal_invite',
      // The uid, never the name: one is a join key, the other is a person's
      // identity sitting in an analytics property forever.
      inviter_uid: invitedBy,
      inviter_resolved: !!inviter,
      unresolved_reason: unresolved,
      has_clubs: activity.status === 'ready' && activity.clubs.length > 0,
      has_games: activity.status === 'ready' && activity.games.length > 0,
      source: route.params?.source,
    });
  }, [inviterLoading, activity, inviter, unresolved, invitedBy, me, route.params]);

  const openClub = (club: GroupPublic) => {
    logEvent(AnalyticsEvent.PersonalInviteTargetOpened, {
      target_type: 'club',
      target_id: club.id,
      inviter_uid: invitedBy,
    });
    // The PUBLIC club screen, always — it is the one that reads
    // `/groupsPublic` and carries the join path, including the request flow
    // for a club that is not open. Sending a non-member to the members' screen
    // would be a rules denial dressed up as a broken page.
    nav.navigate('CommunityDetailsPublic', { groupId: club.id });
  };

  const openGame = (game: Game) => {
    logEvent(AnalyticsEvent.PersonalInviteTargetOpened, {
      target_type: 'game',
      target_id: game.id,
      inviter_uid: invitedBy,
    });
    // MatchDetails owns joining — including the membership question. A match
    // inside a club the viewer is not in renders its own blocked-access view
    // there rather than a join button this screen has no business offering.
    nav.navigate('MatchDetails', { gameId: game.id });
  };

  const explore = () => {
    logEvent(AnalyticsEvent.PersonalInviteExploreTapped, { inviter_uid: invitedBy });
    nav.navigate('GuestHome');
  };

  const named = inviter?.name?.trim();
  const ready = activity.status === 'ready' ? activity : null;
  const nothingToShow =
    !!ready && ready.clubs.length === 0 && ready.games.length === 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── The hero ──────────────────────────────────────────────────
            Warmer than the organic Home — a tinted card and a face — but the
            same palette, the same radii, the same type ramp. */}
        <View style={styles.topRow}>
          <Text style={styles.wordmark}>Teamder</Text>
          <Pressable
            onPress={explore}
            hitSlop={10}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel={he.personalInviteCloseA11y}
          >
            <Ionicons name="close" size={24} color={colors.textMuted} />
          </Pressable>
        </View>

        <View style={styles.hero}>
          {inviterLoading ? (
            // A short, quiet placeholder. The shell is already on screen, so
            // this is a line settling rather than a screen arriving.
            <>
              <View style={styles.avatarSkeleton} />
              <View style={styles.lineSkeleton} />
            </>
          ) : named ? (
            <>
              <UserAvatar user={inviter} size={72} ring />
              <Text style={styles.heroTitle}>{he.personalInviteVia(named)}</Text>
              <Text style={styles.heroBody}>{he.personalInviteViaBody}</Text>
            </>
          ) : (
            // No inviter, no mirror, a deleted account, a read that failed —
            // all one state for the person looking at it. The invitation is
            // still true; we just cannot name who sent it.
            <>
              <View style={styles.genericBadge}>
                <Ionicons name="mail-open-outline" size={30} color={colors.primary} />
              </View>
              <Text style={styles.heroTitle}>{he.personalInviteGenericTitle}</Text>
              <Text style={styles.heroBody}>{he.personalInviteGenericBody}</Text>
            </>
          )}
        </View>

        {/* ── Clubs ─────────────────────────────────────────────────────── */}
        {activity.status === 'loading' ? (
          <View style={styles.list}>
            <MatchCardSkeleton count={2} />
          </View>
        ) : activity.status === 'error' ? (
          <Card style={styles.notice}>
            <Text style={styles.noticeText}>{he.personalInviteGamesError}</Text>
            <Pressable
              onPress={() => void loadActivity()}
              style={({ pressed }) => [styles.noticeCta, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={he.personalInviteRetry}
            >
              <Text style={styles.noticeCtaText}>{he.personalInviteRetry}</Text>
            </Pressable>
          </Card>
        ) : nothingToShow && named ? (
          // Only when there IS a name. Without one the hero has already said
          // the generic line, and repeating it in a card underneath is the
          // same paragraph twice — which is exactly how it rendered before
          // visual QA caught it.
          <Card style={styles.notice}>
            <Text style={styles.emptyTitle}>{he.personalInviteEmptyTitle(named)}</Text>
            <Text style={styles.noticeText}>{he.personalInviteEmptyBody}</Text>
          </Card>
        ) : nothingToShow ? null : (
          <>
            {ready!.clubs.length > 0 ? (
              <>
                <SectionHead title={he.personalInviteClubsTitle} />
                <View style={styles.list}>
                  {ready!.clubs.map((c, i) => (
                    <AppearItem key={c.id} index={i}>
                      <ClubRow
                        club={c}
                        inviterName={named}
                        onPress={() => openClub(c)}
                      />
                    </AppearItem>
                  ))}
                </View>
              </>
            ) : null}

            {ready!.games.length > 0 ? (
              <>
                <SectionHead title={he.personalInviteGamesTitle} />
                <View style={styles.list}>
                  {ready!.games.map((g, i) => (
                    <AppearItem key={g.id} index={i}>
                      <MatchListCard
                        game={g}
                        userId={me?.id ?? ''}
                        // Tap and CTA both open the match. Joining lives there,
                        // with the roster, the membership check and the
                        // contextual sheet — a second join path on a landing
                        // screen is how the two would drift.
                        onPrimary={() => openGame(g)}
                      />
                    </AppearItem>
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}

        {/* ── The way on ────────────────────────────────────────────────
            Always present, whatever resolved. Somebody who came from a
            friend and found nothing to join still came to play. */}
        <Pressable
          onPress={explore}
          style={({ pressed }) => [styles.explore, pressed && { opacity: 0.92 }]}
          accessibilityRole="button"
          accessibilityLabel={he.personalInviteExploreCta}
        >
          <Text style={styles.exploreText}>{he.personalInviteExploreCta}</Text>
          <Ionicons name="chevron-back" size={18} color={colors.textOnPrimary} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHead({ title }: { title: string }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionRule} />
    </View>
  );
}

/** A club, from its public mirror. `memberCount` and `isOpen` are the only two
 *  facts shown, and both are already on the public card in the clubs feed. */
function ClubRow({
  club,
  inviterName,
  onPress,
}: {
  club: GroupPublic;
  inviterName?: string;
  onPress: () => void;
}) {
  return (
    <Card style={styles.clubCard} onPress={onPress}>
      <View style={styles.clubRow}>
        <View style={styles.clubIcon}>
          <Ionicons name="shield-outline" size={22} color={colors.primary} />
        </View>
        <View style={styles.clubText}>
          <Text style={styles.clubName} numberOfLines={1}>
            {club.name}
          </Text>
          <Text style={styles.clubMeta} numberOfLines={1}>
            {[club.city, he.personalInviteClubMembers(club.memberCount)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {inviterName ? (
            <Text style={styles.clubInviter} numberOfLines={1}>
              {he.personalInviteInThis(inviterName)}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },

  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordmark: {
    ...typography.h3,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: 0.2,
  },
  closeBtn: { padding: spacing.xs },

  hero: {
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  heroTitle: {
    ...typography.h2,
    fontWeight: '900',
    color: colors.text,
    textAlign: 'center',
  },
  heroBody: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  genericBadge: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  avatarSkeleton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    opacity: 0.7,
  },
  lineSkeleton: {
    width: '70%',
    height: 22,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    opacity: 0.7,
  },

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

  clubCard: { paddingVertical: spacing.md },
  clubRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  clubIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  clubText: { flex: 1, gap: 2 },
  clubName: {
    ...typography.body,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  clubMeta: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  clubInviter: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.primary,
    textAlign: RTL_LABEL_ALIGN,
  },

  notice: { gap: spacing.sm, paddingVertical: spacing.lg },
  emptyTitle: {
    ...typography.body,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  noticeText: { ...typography.body, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  noticeCta: { alignSelf: 'flex-start' },
  noticeCtaText: { ...typography.label, fontWeight: '800', color: colors.primary },

  explore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    ...shadows.card,
  },
  exploreText: {
    ...typography.body,
    fontWeight: '800',
    color: colors.textOnPrimary,
    textAlign: 'center',
  },
});
