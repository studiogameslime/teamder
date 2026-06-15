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

import React from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing } from '@/theme';
import { he } from '@/i18n/he';
import { formatDayDate, formatTime } from '@/utils/format';
import { skyForHour } from '@/utils/heroAtmosphere';
import { LiveCountdown } from './LiveCountdown';

interface Props {
  startsAt?: number;
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
  /** Unread message count for the game chat — renders a badge on the
   *  chat icon. 0/undefined → no badge. */
  chatUnread?: number;
}

const STADIUM_BG: ImageSourcePropType = require('../../assets/images/stadium-bg.png');

export function MatchStadiumHero({
  startsAt,
  onMenuPress,
  onBackPress,
  onSharePress,
  onChatPress,
  chatUnread = 0,
}: Props) {
  // Living sky: the gradient tint follows the kickoff hour (morning/day/
  // sunset/night), with floodlights at night.
  const hour = startsAt ? new Date(startsAt).getHours() : 12;
  const sky = skyForHour(hour);

  return (
    <View style={styles.wrap}>
      <ImageBackground
        source={STADIUM_BG}
        style={styles.bg}
        resizeMode="cover"
      >
        {/* Time-of-day sky. Bottom stop stays dark so the floating white
            time card keeps its contrast against the stadium photo. */}
        <LinearGradient colors={sky.gradient} style={StyleSheet.absoluteFill} />

        {/* Night-only floodlight washes in the top corners. */}
        {sky.floodlights ? <Floodlights /> : null}
        <SafeAreaView edges={['top']} style={styles.safe}>
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
              {startsAt ? <LiveCountdown startsAt={startsAt} /> : null}
            </View>
          </View>
        </SafeAreaView>
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
