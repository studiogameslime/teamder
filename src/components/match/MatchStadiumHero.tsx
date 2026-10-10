// MatchStadiumHero — full-bleed top section of MatchDetailsScreen.
//
// Visual:
//   • Stadium photo as ImageBackground
//   • Dark vertical gradient overlay (legibility)
//   • Top bar: ⋯ overflow on the leading edge, ← back on the
//     trailing edge
//   • Centered title "פרטי משחק" + "קבוצה: X" subtitle
//   • Floating dark card overlapping the bottom: small date row,
//     huge time, location with pin
//   • Optional small floating Waze chip on the leading side of the
//     hero — a one-tap nav affordance that's visible without taking
//     a full row in the body

import React, { useState } from 'react';
import {
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { formatDayDate, formatTime } from '@/utils/format';
import { skyForHour } from '@/utils/heroAtmosphere';
import { LiveCountdown } from './LiveCountdown';

interface Props {
  groupId?: string;
  coverLoading?: boolean;
  startsAt?: number;
  /** Game name — shown above the date/time inside the floating card. */
  title?: string;
  /**
   * Which season this evening belongs to — "עונה 2" — under the title.
   *
   * Absent for a club that runs no seasons, and for an evening that has not
   * been stamped yet. The stamp is written when the game goes ACTIVE, so a
   * game that has not kicked off shows the season it WILL be counted in,
   * which is the running one: the header answers "which season is this",
   * not "which season did this turn out to be".
   */
  seasonLabel?: string;
  /** Omit to hide the ⋯ button entirely — e.g. a viewer with no
   *  applicable menu actions (would otherwise open an empty sheet). */
  onMenuPress?: () => void;
  onBackPress: () => void;
  /** Optional share entry-point. When passed, a small share icon
   *  renders next to the overflow menu so the share affordance has
   *  a permanent home in the header — even when the sticky CTA at
   *  the bottom is showing a different action (cancel, start, etc.). */
  onSharePress?: () => void;
  /** Registered players only — opens the game chat. Hidden when undefined. */
  onChatPress?: () => void;
  /** Hide the kickoff countdown chip. A game can leave the "waiting to
   *  start" state BEFORE its scheduled time — finished early, started
   *  early, cancelled — and the chip only knows about the clock, so it
   *  happily kept ticking "עוד 2:45" under a game that was already over
   *  (Eliran's report). The screen knows the status; it decides. */
  countdownHidden?: boolean;
  /** Show "המחזור התחיל" under the hour. The caller decides — see the note at
   *  the render site. */
  showStarted?: boolean;
  /** Unread message count for the game chat — renders a badge on the
   *  chat icon. 0/undefined → no badge. */
  chatUnread?: number;
  /**
   * The pitch, under the time — "מגרש אלמוג, אור יהודה".
   *
   * Part of the header in the four-tab design: the three facts a person opens
   * this screen for are WHEN, WHERE and who. The first two now live together
   * in the card instead of the where being four sections down the page.
   */
  locationLine?: string;
  /**
   * The parent club's cover, so an evening looks like the club it belongs to.
   *
   * Same two fields and the same precedence the club's own hero uses — an
   * uploaded photo first, then a pick from the built-in gallery — because a
   * second way of resolving the same image is how the two screens end up
   * showing different pictures for one club. Both absent (a one-off game with
   * no club) falls through to the bundled stadium, which is what every evening
   * showed before this.
   */
  coverUrl?: string;
  coverImageId?: string;
  /**
   * Drop the strip of stadium the hero used to leave below its card.
   *
   * That padding existed for one thing: the match stats strip floated onto it with
   * a negative margin. The four-tab screen has no strip — the tab bar sits
   * directly under the hero — and without this the header carries 56 points of
   * empty photo above the tabs.
   */
  compact?: boolean;
}

import { getCoverSource } from '@/data/coverImages';
import { clubDefaultCoverId } from '@/utils/clubDefaultCoverId';


export function MatchStadiumHero({
  groupId,
  coverLoading = false,
  startsAt,
  title,
  seasonLabel,
  onMenuPress,
  onBackPress,
  onSharePress,
  onChatPress,
  countdownHidden = false,
  showStarted = false,
  chatUnread = 0,
  locationLine,
  coverUrl,
  coverImageId,
  compact = false,
}: Props) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  // Living sky: the gradient tint follows the kickoff hour (morning/day/
  // sunset/night), with floodlights at night.
  const hour = startsAt ? new Date(startsAt).getHours() : 12;
  const sky = skyForHour(hour);
  // Priority mirrors `CommunityStadiumHero` exactly.
  const bg: ImageSourcePropType | undefined = coverLoading ? undefined : coverUrl && coverUrl !== failedPhoto
    ? { uri: coverUrl }
    : getCoverSource(coverImageId) ?? getCoverSource(clubDefaultCoverId(groupId))!;

  return (
    <View style={styles.wrap}>
      <ImageBackground
        resizeMethod="resize"
        source={bg}
        onError={() => { if (coverUrl) setFailedPhoto(coverUrl); }}
        style={[styles.bg, compact && styles.bgCompact]}
        resizeMode="cover"
      >
        {/* Time-of-day sky. Bottom stop stays dark so the floating white
            time card keeps its contrast against the stadium photo. */}
        <LinearGradient colors={sky.gradient} style={StyleSheet.absoluteFill} />

        {/* Night-only floodlight washes in the top corners. */}
        {sky.floodlights ? <Floodlights /> : null}
        {/* No top inset here any more. The SCREEN reserves the status-bar
            strip above this hero, because the tab bar below it becomes sticky:
            pinned at the scroll's y=0, a bar whose inset lived inside the hero
            would draw under the system clock the moment the hero scrolled off.
            Reserving it one level up is the only place that holds in both
            states. */}
        <View style={styles.safe}>
          <View style={styles.topBar}>
            {/* Back is now first → renders on the leading edge under
                our flex flow. Title sits centered between the two
                icons; menu (⋯) is last → trailing edge. */}
            <Pressable
              onPress={onBackPress}
              hitSlop={10}
              style={({ pressed }) => [
                styles.iconBtn,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="חזור"
            >
              <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.titleInline} numberOfLines={1}>
              {he.matchHeroTitle}
            </Text>
            <View style={styles.topBarTrailing}>
              {onChatPress ? (
                <Pressable
                  onPress={onChatPress}
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.iconBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={he.chatOpenGame}
                >
                  <Ionicons name="chatbubble-ellipses" size={20} color="#FFFFFF" />
                  {chatUnread > 0 ? (
                    <View style={styles.chatBadge}>
                      <Text style={styles.chatBadgeText}>
                        {chatUnread > 99 ? '99+' : chatUnread}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              ) : null}
              {onSharePress ? (
                <Pressable
                  onPress={onSharePress}
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.iconBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={he.profileInviteFriendsCta}
                >
                  <Ionicons
                    name="share-social-outline"
                    size={20}
                    color="#FFFFFF"
                  />
                </Pressable>
              ) : null}
              {onMenuPress ? (
                <Pressable
                  onPress={onMenuPress}
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.iconBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={he.profileMenuOpen}
                >
                  <Ionicons
                    name="ellipsis-horizontal"
                    size={22}
                    color="#FFFFFF"
                  />
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Floating dark card — date row + huge time. Location
              moved to the details grid below so the hero stays
              tight and the user only reads two pieces of info up
              top: WHAT screen + WHEN the game is. */}
          <View style={styles.floatingWrap}>
            <View style={styles.floating}>
              {title ? (
                <Text style={styles.floatingTitle} numberOfLines={1}>
                  {title}
                </Text>
              ) : null}
              {seasonLabel ? (
                <Text style={styles.floatingSeason} numberOfLines={1}>
                  {seasonLabel}
                </Text>
              ) : null}
              {startsAt ? (
                <View style={styles.floatingDateRow}>
                  <Ionicons
                    name="calendar-outline"
                    size={13}
                    color="rgba(255,255,255,0.85)"
                  />
                  <Text style={styles.floatingDate}>
                    {formatDayDate(startsAt, {
                      separator: ' | ',
                      withYear: true,
                    })}
                  </Text>
                </View>
              ) : null}
              <Text style={styles.floatingTime}>
                {startsAt ? formatTime(startsAt) : '—'}
              </Text>
              {startsAt && !countdownHidden ? (
                <LiveCountdown startsAt={startsAt} />
              ) : null}
              {/* Kickoff has passed. The countdown only counts DOWN, so at
                  zero it vanishes and left the hour standing alone — a person
                  opening the screen at 20:30 saw "20:00" and nothing to say
                  which side of it they were on. Whether to show this is the
                  CALLER's call, not a time comparison here: a finished or
                  cancelled evening must not announce that it is starting, and
                  only the screen knows the status. */}
              {showStarted ? (
                <View style={styles.startedRow}>
                  {/* Text FIRST → rightmost under forceRTL, the play mark
                      closing it on the left (owner, 01.10). Deliberately
                      UNLIKE the pin and the calendar below, which stay
                      leading: those label a value, this one is a state. */}
                  <Text style={styles.startedText}>{he.gdHeroStarted}</Text>
                  <Ionicons name="play-circle" size={13} color="#86EFAC" />
                </View>
              ) : null}
              {locationLine ? (
                <View style={styles.floatingPlaceRow}>
                  {/* Pin FIRST in source order → rightmost under forceRTL,
                      matching the calendar on the date row above it. */}
                  <Ionicons name="location" size={13} color="rgba(255,255,255,0.82)" />
                  <Text style={styles.floatingPlace} numberOfLines={1}>
                    {locationLine}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </ImageBackground>
    </View>
  );
}

/** Two soft white floodlight washes in the top corners — night only. */
function Floodlights() {
  return (
    <View pointerEvents="none" style={styles.floodWrap}>
      {[styles.floodLeft, styles.floodRight].map((pos, i) => (
        <View key={i} style={[styles.flood, pos]}>
          <Svg width={160} height={160}>
            <Defs>
              <RadialGradient id={`fl${i}`} cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.32} />
                <Stop offset="55%" stopColor="#E8F0FF" stopOpacity={0.1} />
                <Stop offset="100%" stopColor="#E8F0FF" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={80} cy={80} r={80} fill={`url(#fl${i})`} />
          </Svg>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'visible',
  },
  // The strip below the card existed only for the floating stats row. Without
  // one, `compact` reclaims it — see the prop's note.
  bgCompact: { paddingBottom: spacing.lg },
  startedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  startedText: {
    ...typography.caption,
    color: '#86EFAC',
    fontWeight: '800',
  },
  floatingPlaceRow: {
    // `row` puts the first child on the RIGHT under forceRTL: pin, then place.
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
    maxWidth: '100%',
  },
  floatingPlace: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  floodWrap: { ...StyleSheet.absoluteFillObject },
  flood: { position: 'absolute', top: -56 },
  floodLeft: { left: -40 },
  floodRight: { right: -40 },
  bg: {
    width: '100%',
    // Leaves a strip of stadium below the time card so the floating
    // stats strip (which uses marginTop: -36 in the screen) lands
    // ON TOP of the photo, not on the white body. Tunable; bump
    // both this and the screen's negative margin together.
    paddingBottom: 56,
  },
  safe: {
    paddingHorizontal: spacing.lg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  chatBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  // Trailing-edge group for the overflow menu (and the optional
  // share icon when provided). flex-direction:row + small gap so the
  // two icons sit together without crowding the title.
  topBarTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // Inline title sandwiched between the two icon buttons.
  titleInline: {
    flex: 1,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  floatingWrap: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  // Floating time card. Slight transparency + a thin hairline
  // border + a generous soft shadow lift it off the stadium
  // gradient, no blur library required.
  floating: {
    minWidth: 240,
    maxWidth: '88%',
    backgroundColor: 'rgba(10,20,40,0.78)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.32,
    shadowRadius: 22,
    elevation: 10,
  },
  floatingTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
    maxWidth: 260,
  },
  /** The season, under the club's name. Quieter than the title and louder
   *  than the date — it qualifies the title, it is not a detail of the
   *  fixture. */
  floatingSeason: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    // The title reserves 6pt below itself; the season sits inside that gap
    // rather than adding to it, so the hero does not grow.
    marginTop: -4,
    marginBottom: 6,
    maxWidth: 260,
  },
  floatingDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  floatingDate: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  // Time gets the heaviest weight + biggest size in the entire
  // screen — it's the answer to "when is the game".
  floatingTime: {
    color: '#FFFFFF',
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginTop: 4,
  },
});
