// ClubCard — the communities feed card.
//
// Layout (visual, under forceRTL):
//
//   ┌───────────────────────────────────────────────┐
//   │ ┌─────────────┐              שם המועדון        │
//   │ │  [👑 מנהל]  │              📍 עיר            │
//   │ │   cover     │              👥 42 שחקנים      │
//   │ │  [🟢 פעיל]  │        ┌──────────────────┐   │
//   │ └─────────────┘        │   ✓ חבר במועדון  │   │
//   └───────────────────────────────────────────────┘
//
// The cover sits on the visual LEFT and carries at most two badges — one per
// corner. Everything else is text, right-aligned, reading order first.
//
// This component paints; it does not decide. What the button says, which badge
// appears and whether the friends row exists all arrive resolved in the
// ClubCardViewModel (see utils/clubCard.ts). That split exists because those
// rules have seven inputs and were previously spread through JSX.
//
// Deliberately NOT shown here, per spec: distance in km, and anything at all
// about the club's games beyond the activity badge — no title, date, pitch or
// headcount. A club's fixtures are private to its members.

import React from 'react';
import {
  Image,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { PressableScale } from '@/components/PressableScale';
import { getCoverSource } from '@/data/coverImages';
import { he } from '@/i18n/he';
import { spacing } from '@/theme';
import type { ClubCardViewModel } from '@/utils/clubCard';

const STADIUM_BG: ImageSourcePropType =
  require('../../assets/images/stadium-bg.png');

const CTA_STYLE = {
  member: { bg: 'transparent', border: '#15803D', fg: '#15803D', icon: 'checkmark' },
  join: { bg: '#1E40AF', border: '#1E40AF', fg: '#FFFFFF', icon: 'person-add' },
  request: { bg: 'transparent', border: '#EA8C1F', fg: '#C2710C', icon: 'time-outline' },
  requested: { bg: 'transparent', border: '#EA8C1F', fg: '#C2710C', icon: 'time-outline' },
} as const;

const CTA_LABEL: Record<string, string> = {
  member: he.clubCardMember,
  join: he.clubCardJoin,
  request: he.clubCardRequest,
  requested: he.clubCardRequested,
};

const ACTIVITY = {
  veryActive: { dot: '#22C55E', label: he.clubCardVeryActive },
  active: { dot: '#22C55E', label: he.clubCardActive },
  inactive: { dot: '#EF4444', label: he.clubCardInactive },
} as const;

interface Props {
  vm: ClubCardViewModel;
  name: string;
  /** City ONLY. No pitch, no address, no distance. */
  city?: string;
  coverPhotoUrl?: string;
  coverImageId?: string;
  onPress: () => void;
  /** Fires for the join / request states. Absent → the button is inert. */
  onCtaPress?: () => void;
  ctaBusy?: boolean;
}

export function ClubCard({
  vm,
  name,
  city,
  coverPhotoUrl,
  coverImageId,
  onPress,
  onCtaPress,
  ctaBusy,
}: Props) {
  const cta = CTA_STYLE[vm.cta];
  const activity = vm.activity ? ACTIVITY[vm.activity] : null;
  // The member state is a status, not an action — tapping it should open the
  // club like the rest of the card, not fire a join.
  const ctaActs = vm.cta === 'join' || vm.cta === 'request';

  return (
    <PressableScale
      onPress={onPress}
      style={styles.card}
      haptic={false}
      accessibilityRole="button"
      accessibilityLabel={name}
    >
      <View style={styles.row}>
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={2}>
            {name}
          </Text>

          {city ? (
            <View style={styles.metaRow}>
              <Ionicons name="location" size={15} color="#64748B" />
              <Text style={styles.metaTxt} numberOfLines={1}>
                {city}
              </Text>
            </View>
          ) : null}

          <View style={styles.metaRow}>
            <Ionicons name="people" size={15} color="#64748B" />
            <Text style={styles.metaTxt}>{he.clubCardPlayers(vm.playerCount)}</Text>
            {/* Friends ride on the players row so a card with friends doesn't
                grow a whole extra line for three small circles. */}
            {vm.friends.length > 0 ? (
              <View style={styles.friends}>
                {vm.friends.map((f, i) => (
                  <View key={f.id} style={[styles.avatarWrap, i > 0 && styles.avatarOverlap]}>
                    {f.photoUrl ? (
                      <Image source={{ uri: f.photoUrl }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, styles.avatarFallback]}>
                        <Text style={styles.avatarLetter}>
                          {f.name.trim().charAt(0) || '?'}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
                {vm.friendsOverflow > 0 ? (
                  <View style={[styles.avatarWrap, styles.avatarOverlap, styles.more]}>
                    <Text style={styles.moreTxt}>+{vm.friendsOverflow}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* A member has nothing to press. Rendering their state as a
              full-width outlined button made "חבר במועדון" read as an action
              — people tap it and nothing happens. It's a STATUS, so it's a
              small filled chip that hugs its text and never spans the card;
              the shape itself says "label", not "button". */}
          {ctaActs ? (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onCtaPress?.();
              }}
              disabled={ctaBusy}
              style={({ pressed }) => [
                styles.cta,
                { backgroundColor: cta.bg, borderColor: cta.border },
                (pressed || ctaBusy) && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={CTA_LABEL[vm.cta]}
            >
              <Ionicons name={cta.icon as never} size={16} color={cta.fg} />
              <Text style={[styles.ctaTxt, { color: cta.fg }]}>
                {CTA_LABEL[vm.cta]}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.status,
                  vm.cta === 'requested' && { backgroundColor: '#FFF7ED' },
                ]}
              >
                <Ionicons
                  name={cta.icon as never}
                  size={14}
                  color={vm.cta === 'requested' ? '#C2710C' : '#15803D'}
                />
                <Text
                  style={[
                    styles.statusTxt,
                    { color: vm.cta === 'requested' ? '#C2710C' : '#15803D' },
                  ]}
                >
                  {CTA_LABEL[vm.cta]}
                </Text>
              </View>
            </View>
          )}
        </View>
        <ImageBackground
          source={
            coverPhotoUrl
              ? { uri: coverPhotoUrl }
              : (getCoverSource(coverImageId) ?? STADIUM_BG)
          }
          style={styles.cover}
          resizeMode="cover"
        >
          <LinearGradient
            colors={['rgba(7,12,32,0.35)', 'rgba(7,12,32,0.10)', 'rgba(7,12,32,0.55)']}
            style={StyleSheet.absoluteFillObject}
          />
          {/* The cover is space-between, so with only ONE child the activity
              badge floated to the TOP. An explicit empty top slot keeps it
              pinned to the bottom corner where the spec puts it. */}
          {vm.topBadge === 'manager' ? (
            <View style={[styles.topBadge, { backgroundColor: '#F0A03C' }]}>
              <Ionicons name="ribbon" size={11} color="#FFF" />
              <Text style={styles.topBadgeTxt}>{he.clubCardManager}</Text>
            </View>
          ) : vm.topBadge === 'recommended' ? (
            <View style={[styles.topBadge, { backgroundColor: '#2563EB' }]}>
              <Ionicons name="star" size={11} color="#FFF" />
              <Text style={styles.topBadgeTxt}>{he.clubCardRecommended}</Text>
            </View>
          ) : (
            <View />
          )}

          {activity ? (
            <View style={styles.activityBadge}>
              <View style={[styles.dot, { backgroundColor: activity.dot }]} />
              <Text style={styles.activityTxt}>{activity.label}</Text>
            </View>
          ) : (
            <View />
          )}
        </ImageBackground>

      </View>
    </PressableScale>
  );
}

const COVER = 132;

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    marginBottom: spacing.md,
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  // `row` under forceRTL puts the FIRST child on the visual RIGHT. The body
  // is therefore declared first (text starts at the right, where Hebrew
  // reading begins) and the cover second, so it lands on the left as spec'd.
  //
  // NO padding on the row: the cover is full-bleed against the card's left
  // edge. It used to sit inside 10px of white with a 14px radius of its own,
  // which left a grey square-cornered plate showing through behind a rounded
  // photo. The card already clips (overflow:hidden + borderRadius), so the
  // cover simply inherits the card's corners instead of fighting them.
  row: { flexDirection: 'row', alignItems: 'stretch' },
  cover: {
    width: COVER,
    alignSelf: 'stretch',
    minHeight: COVER,
    justifyContent: 'space-between',
    // Not the container's job to round anything — the card does it.
    overflow: 'hidden',
  },
  topBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    // flex-END under forceRTL is the visual LEFT — the corner the spec puts
    // the badge in, and the corner it sits in on the mockup.
    alignSelf: 'flex-end',
    paddingHorizontal: 9,
    paddingVertical: 5,
    // Fully rounded and inset. Clipping it into the corner (as the first cut
    // did) made it look like a torn sticker rather than a badge sitting on
    // the photo — the reference floats it.
    margin: 7,
    borderRadius: 10,
  },
  topBadgeTxt: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  activityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.82)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    margin: 7,
    borderRadius: 99,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  activityTxt: { color: '#FFF', fontSize: 10.5, fontWeight: '700' },

  body: { flex: 1, justifyContent: 'center', gap: 6, padding: 12 },
  name: { fontSize: 17.5, fontWeight: '800', color: '#0F172A' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaTxt: { fontSize: 14, color: '#475569', fontWeight: '600' },

  friends: { flexDirection: 'row', alignItems: 'center', marginRight: 'auto' },
  avatarWrap: { borderRadius: 14, borderWidth: 2, borderColor: '#FFFFFF' },
  avatarOverlap: { marginRight: -10 },
  avatar: { width: 24, height: 24, borderRadius: 12 },
  avatarFallback: { backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 11, fontWeight: '800', color: '#1E40AF' },
  more: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreTxt: { fontSize: 10.5, fontWeight: '800', color: '#475569' },

  statusRow: { flexDirection: 'row', marginTop: 6 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF3',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 99,
  },
  statusTxt: { fontSize: 13.5, fontWeight: '800' },

  cta: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 10,
  },
  ctaTxt: { fontSize: 14.5, fontWeight: '800' },
});
