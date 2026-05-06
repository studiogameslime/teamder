// MatchStadiumHero — full-bleed top section of MatchDetailsScreen.
//
// Visual:
//   • Stadium photo as ImageBackground
//   • Dark vertical gradient overlay (legibility)
//   • Top bar: ⋯ overflow on the leading edge, ← back on the
//     trailing edge
//   • Centered title "פרטי משחק" + "קהילה: X" subtitle
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing } from '@/theme';
import { he } from '@/i18n/he';
import { formatDayDate, formatTime } from '@/utils/format';

interface Props {
  startsAt?: number;
  onMenuPress: () => void;
  onBackPress: () => void;
}

const STADIUM_BG: ImageSourcePropType = require('../../assets/images/stadium-bg.png');

export function MatchStadiumHero({
  startsAt,
  onMenuPress,
  onBackPress,
}: Props) {
  return (
    <View style={styles.wrap}>
      <ImageBackground
        source={STADIUM_BG}
        style={styles.bg}
        resizeMode="cover"
      >
        {/* Stronger gradient — darker on top, fades into the
            content below. Boosts contrast against the floating
            time card so it really feels like it's lifting off the
            stadium photo. */}
        <LinearGradient
          colors={[
            'rgba(7,12,32,0.55)',
            'rgba(7,12,32,0.72)',
            'rgba(7,12,32,0.92)',
          ]}
          style={StyleSheet.absoluteFill}
        />
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
            </View>
          </View>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'visible',
  },
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
