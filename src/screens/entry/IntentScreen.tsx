// IntentScreen — "איך בא לך להתחיל?"
//
// The one question worth asking a new person. Every answer routes into an
// EXISTING flow; nothing on this screen is a new destination.
//
//   מקים מועדון  → CommunitiesCreate   (the club wizard)
//   מחפש משחק    → GamesList           (the open-matches feed)
//   חד־פעמי      → GameCreate quick    (the orphan match wizard)
//   ההזמנה       → the game, the club, or "איפה X משחק?"
//
// ─── The invitation is a FOURTH card, not a different screen ────────────
//
// Somebody who arrived on a friend's link used to be sent straight to the
// match or club. That trapped them in the inviter's path: a person who
// downloaded Teamder because Eliran shared a match, but who actually wants to
// start their own club, had to back out of a match screen to find the way.
//
// So the invitation is offered, at the top, with the inviter's name on it —
// and the three standing cards below are UNCHANGED. Not reordered, not
// restyled, not removed. That is the whole point: the invitation is an extra
// door, not a narrower corridor.
//
// ─── Why the screen cannot navigate ─────────────────────────────────────
//
// All the destinations live inside MainTabs, and MainTabs is not mounted while
// this screen is: the gate renders one or the other. So the answer is recorded
// in `entryStore` and the flag is flipped; the next render mounts the tabs and
// RootNavigator performs the navigation. Choosing anything other than the
// invitation also sets `suppressAutoConsume`, which is what stops the
// deep-link consumer dragging the person to the target they just declined.

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContextualAuthSheet } from '@/components/auth/ContextualAuthSheet';
import { PressableScale } from '@/components/PressableScale';
import { AppearItem } from '@/components/anim/AppearItem';
import {
  CardArt,
  CARD_GUTTER,
  CARD_HEIGHT,
  type CardArtKind,
} from '@/components/entry/EntryArt';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { resolveInviter } from '@/services/personalInvite';
import { useEntryStore, type EntryIntent } from '@/store/entryStore';
import { useUserStore } from '@/store/userStore';
import { colors, radius, shadows, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

/**
 * The reference's ground is a pale BLUE, not the app's neutral `colors.bg`
 * (#F9FAFB). Against a neutral grey the white cards barely separated and the
 * screen read as a settings list; against this the same cards lift.
 */
const SKY = '#EAF3FD';

interface Choice {
  intent: EntryIntent;
  art: CardArtKind;
  title: string;
  body: string;
  /** Present only on the invitation. */
  tag?: string;
}

/** The three standing cards. Constant — the invitation never alters them. */
const STANDING: Choice[] = [
  {
    intent: 'create_club',
    art: 'create_club',
    title: he.entryIntentClubTitle,
    body: he.entryIntentClubBody,
  },
  {
    intent: 'find_game',
    art: 'find_game',
    title: he.entryIntentFindTitle,
    body: he.entryIntentFindBody,
  },
  {
    intent: 'one_off_game',
    art: 'one_off_game',
    title: he.entryIntentOneOffTitle,
    body: he.entryIntentOneOffBody,
  },
];

export function IntentScreen() {
  const isGuest = useUserStore((s) => s.currentUser?.isGuest === true);
  const chooseIntent = useEntryStore((s) => s.chooseIntent);
  const invite = useEntryStore((s) => s.invite);
  const beginExistingAccountAttempt = useEntryStore(
    (s) => s.beginExistingAccountAttempt,
  );
  const endExistingAccountAttempt = useEntryStore(
    (s) => s.endExistingAccountAttempt,
  );

  /**
   * "כבר השתמשת ב-Teamder? התחברות לחשבון קיים".
   *
   * The sheet is opened DIRECTLY rather than through `useAuthenticatedAction`,
   * and that is the whole design of this action. The hook is for "run this,
   * but sign the person in first", and it parks a PendingAction to remember
   * the work — which here would overwrite an invitation already sitting on the
   * disk, the one thing FLOW 3 must never do. There is no work to remember:
   * this is authentication and nothing else.
   *
   * It is also NOT an intent. `chooseIntent` is never called, so nothing
   * writes `pendingIntent`, nothing raises `suppressAutoConsume`, and
   * `organicCompleted` stays exactly as it was. A person who taps this and
   * backs out has changed nothing at all.
   *
   * What happens next is decided by the EXISTING gates, not here:
   *   • an account that has finished onboarding → RootNavigator renders the
   *     tabs, and the pending-action consumer resumes the invitation;
   *   • one that has not → the profile screen, and `existingAccountWasNew`
   *     brings them back to this question afterwards.
   */
  const [authOpen, setAuthOpen] = useState(false);
  const openExistingAccount = () => {
    logEvent(AnalyticsEvent.EntryExistingAccountTapped, { is_guest: isGuest });
    beginExistingAccountAttempt();
    setAuthOpen(true);
  };

  // The inviter's NAME is not in the stash — the link carries a uid. It is
  // resolved here from `/usersPublic`, the same four-field mirror the invite
  // landing reads, and the card renders without a name until it lands rather
  // than holding the whole screen on one `get`.
  const [resolvedName, setResolvedName] = useState<{ id: string; name: string } | null>(null);
  const inviterName = resolvedName?.id === invite?.invitedBy ? resolvedName?.name ?? null : null;
  useEffect(() => {
    if (!invite?.invitedBy) return;
    let alive = true;
    void resolveInviter(invite.invitedBy).then(({ inviter }) => {
      if (alive && inviter?.name) setResolvedName({ id: invite!.invitedBy!, name: inviter.name.trim() });
    });
    return () => {
      alive = false;
    };
  }, [invite?.invitedBy]);

  useEffect(() => {
    logEvent(AnalyticsEvent.EntryIntentViewed, {
      is_guest: isGuest,
      invite_kind: invite?.kind ?? 'none',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite?.kind]);

  const inviteChoice = buildInviteChoice(invite, inviterName);
  const choices = inviteChoice ? [inviteChoice, ...STANDING] : STANDING;

  const pick = (intent: EntryIntent) => {
    logEvent(AnalyticsEvent.EntryIntentSelected, {
      intent,
      is_guest: isGuest,
      invite_kind: invite?.kind ?? 'none',
    });
    // Fire-and-forget: the state flip inside `chooseIntent` is synchronous, so
    // the gate opens on this render. Only the AsyncStorage write is awaited
    // there, and holding the UI on a disk write would add a stall to the one
    // tap that has to feel instant.
    void chooseIntent(intent);
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.head}>
        <Text style={styles.wordmark}>Teamder</Text>
        <Text style={styles.title}>{he.entryIntentTitle}</Text>
        <Text style={styles.body}>{he.entryIntentBody}</Text>
      </SafeAreaView>

      {/* Four cards do not fit a small phone, and squeezing them would break
          the minimum proportion every card shares. Scrolling keeps the
          choices reachable even with large text and long names. */}
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {choices.map((c, i) => (
          <AppearItem key={c.intent} index={i}>
            <PressableScale
              onPress={() => pick(c.intent)}
              accessibilityRole="button"
              accessibilityLabel={[c.title.replace('\n', ' '), c.tag, c.body].filter(Boolean).join('. ')}
              style={[styles.card, c.tag !== undefined && styles.cardInvite]}
            >
              {/* One child. PressableScale stacks its children vertically, so
                  the row lives in an inner View. */}
              {/* Child ORDER, not left/right. forceRTL lays a row out
                  right-to-left, so [art, text, chevron] renders as
                  art-on-the-right, copy beside it, chevron at the far left —
                  the reference's arrangement, with no coordinate that can
                  flip out from under it. */}
              <View style={styles.cardRow}>
                <CardArt kind={c.art} />
                <View style={styles.cardText}>
                  {c.tag !== undefined ? (
                    <View style={styles.tag}>
                      <Text style={styles.tagText}>{c.tag}</Text>
                      <Ionicons name="heart" size={12} color={colors.primary} />
                    </View>
                  ) : null}
                  <Text style={styles.cardTitle}>
                    {c.title}
                  </Text>
                  <Text style={styles.cardBody}>
                    {c.body}
                  </Text>
                </View>
                <View style={styles.chevWrap}>
                  <Ionicons name="chevron-back" size={18} color={colors.primary} />
                </View>
              </View>
            </PressableScale>
          </AppearItem>
        ))}

        {/* A tertiary action, and shaped like one: no card, no button, no
            surface of its own. The question is muted and the answer is the
            tappable half in Teamder blue — one line, closing the list without
            competing with the three cards above it.

            Inside the ScrollView on purpose. With the invitation on screen
            there are four cards, and the reason this screen scrolls at all is
            that four do not fit a small phone; a row pinned outside the
            scroller would be the one thing a short screen cuts off. */}
        <View style={styles.existing}>
          <Text style={styles.existingPrompt}>{he.entryExistingPrompt}</Text>
          <Pressable
            onPress={openExistingAccount}
            accessibilityRole="button"
            accessibilityLabel={he.entryExistingCta}
            hitSlop={10}
          >
            {({ pressed }) => (
              <Text style={[styles.existingCta, pressed && styles.existingCtaOn]}>
                {he.entryExistingCta}
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>

      <ContextualAuthSheet
        visible={authOpen}
        kind="account_upgrade"
        // The kind is right — this is the same authentication the generic wall
        // runs — but its line offers to OPEN an account, and this person has
        // just said they have one. Only the two lines change; everything below
        // them is the shared sheet.
        copy={{
          title: he.entryExistingSheetTitle,
          body: he.entryExistingSheetBody,
        }}
        onEmailTransition={() => setAuthOpen(false)}
        onCancel={() => {
          // Backing out changes nothing: no intent, no pending action, and the
          // invitation — which was never touched — is still on the disk and
          // still on the card above.
          setAuthOpen(false);
          endExistingAccountAttempt();
        }}
        onAuthenticated={async ({ uid }) => {
          // Deliberately empty of routing. Whether this identity has a Teamder
          // account behind it is not ours to judge from the auth result —
          // `isNewAccount` describes the Firebase credential, not the account —
          // and RootNavigator's gates read the refreshed user's profile.
          setAuthOpen(false);
          // This direct sheet bypasses useAuthenticatedAction. Firebase has
          // changed identity, but the navigator still sees the guest until we
          // refresh the store. Close first so iOS can present the next screen.
          try {
            await useUserStore.getState().refreshFromSession(uid);
          } catch {
            // The root now shows the saved-account retry gate.
          }
        }}
      />
    </View>
  );
}

/**
 * Which invite card to render, if any.
 *
 * Exported so the mapping is assertable directly. The `kind` decides the
 * artwork and the copy; the NAME only decides whether the card can claim
 * somebody sent it. A game or club link with no inviter still gets a card —
 * without it the person has no way back to the thing they tapped, because the
 * entry flow no longer skips ahead to it.
 */
export function buildInviteChoice(
  invite: { kind: 'game' | 'club' | 'referral' } | null,
  name: string | null,
): Choice | null {
  if (!invite) return null;
  const displayName = name ? `⁨${name}⁩` : null;
  const tag = displayName ? he.entryInviteTag(displayName) : he.entryInviteTagAnon;
  if (invite.kind === 'game') {
    return {
      intent: 'invite',
      art: 'invite_game',
      tag,
      title: displayName ? he.entryInviteGameTitle(displayName) : he.entryInviteGameTitleAnon,
      body: he.entryInviteGameBody,
    };
  }
  if (invite.kind === 'club') {
    return {
      intent: 'invite',
      art: 'invite_club',
      tag,
      title: displayName ? he.entryInviteClubTitle(displayName) : he.entryInviteClubTitleAnon,
      body: he.entryInviteClubBody,
    };
  }
  // A general referral names no target, so without a name there is nothing to
  // offer and nowhere to go — `inviteFromPending` already refuses that case.
  if (!name) return null;
  return {
    intent: 'invite',
    art: 'invite_referral',
    tag,
    title: he.entryInviteReferralTitle(displayName!),
    body: he.entryInviteReferralBody(displayName!),
  };
}

const styles = StyleSheet.create({
  existing: {
    // `row` puts the first child on the RIGHT under forceRTL, so the question
    // leads and the action follows it leftwards — one sentence, read in order.
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    // The content container already puts `spacing.lg` between children; this
    // is the extra air that separates a tertiary action from the cards it
    // must not compete with. `paddingBottom: spacing.xxl` below keeps it
    // clear of the bottom edge on a short screen.
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  existingPrompt: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  existingCta: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  existingCtaOn: { opacity: 0.6 },
  root: { flex: 1, backgroundColor: SKY },
  head: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    // ~12% off the vertical air between the wordmark, the question and the
    // first card, so the header and the choices read as one run rather than
    // two blocks. The TYPE is untouched — only the whitespace.
    paddingBottom: spacing.md,
  },
  wordmark: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h1,
    fontSize: 30,
    fontWeight: '800',
    color: colors.primaryDark,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 23,
  },
  scroll: {
    paddingHorizontal: CARD_GUTTER,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    // No border. The reference holds its cards with shadow alone on the pale
    // ground; a hairline on top of that reads as a form field.
    ...shadows.card,
    overflow: 'hidden',
  },
  cardInvite: {
    // Same card, differentiated by a whisper: a thin blue hairline and a tint
    // barely above white. Anything stronger and it stops belonging to the
    // family the three standing cards form.
    borderWidth: 1,
    borderColor: 'rgba(30,64,175,0.20)',
    backgroundColor: '#FBFDFF',
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', minHeight: CARD_HEIGHT },
  cardText: {
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    // Horizontal breathing room on BOTH sides: `paddingHorizontal` is
    // direction-agnostic, so it cannot land on the wrong edge under forceRTL
    // the way a `paddingLeft` would.
    paddingHorizontal: spacing.sm,
  },
  tag: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: spacing.xs,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  tagText: { flexShrink: 1, textAlign: RTL_LABEL_ALIGN, ...typography.caption, fontSize: 12, fontWeight: '700', color: colors.primary },
  cardTitle: {
    ...typography.h3,
    fontSize: 20,
    lineHeight: 26,
    color: colors.primaryDark,
    textAlign: RTL_LABEL_ALIGN,
  },
  cardBody: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    lineHeight: 18,
  },
  chevWrap: { width: 34, alignItems: 'center', justifyContent: 'center' },
});
