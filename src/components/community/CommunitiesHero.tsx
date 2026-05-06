// CommunitiesHero — top banner of the redesigned PublicGroupsFeedScreen.
//
// Visual:
//   • LinearGradient — top is the deeper blue, fading to the lighter
//     accent at the bottom. Curved bottom-corners read as a soft wave.
//   • Right side (RTL leading): big "קבוצות" title + subtitle.
//   • Left side (RTL trailing): a frosted circle with a people icon.
//
// The hero is a presentational shell — no business logic. The screen
// floats the search row over the bottom of this banner via a negative
// marginTop on the row.

import React from 'react';
import {
  ImageBackground,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

const HERO_BG: ImageSourcePropType = require('../../assets/images/communitiesTabBackground.png');

export function CommunitiesHero() {
  return (
    <View style={styles.wrap}>
      <ImageBackground
        source={HERO_BG}
        style={styles.bg}
        resizeMode="cover"
      >
        {/* Heavier blue overlay along the TOP for the right-aligned
            title to read cleanly; near-transparent toward the BOTTOM
            so the players in the source image actually show through.
            Without this taper the entire hero washed out behind a
            uniform blue veil. */}
        <LinearGradient
          colors={[
            'rgba(15,23,73,0.72)',
            'rgba(30,64,175,0.40)',
            'rgba(30,64,175,0.10)',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView edges={['top']} style={styles.safe}>
          <View style={styles.row}>
          {/* Icon disc — first child → renders on the leading
              (right) edge under RTL by default. We WANT it on the
              left, so we flip its alignment with marginEnd:auto via
              the row's space-between. */}
          <View style={styles.iconDisc}>
            <Ionicons name="people" size={26} color="#FFFFFF" />
          </View>
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1}>
              {he.communitiesTitle}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {he.communitiesHeroSubtitle}
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
    overflow: 'hidden',
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    // Soft shadow so the hero feels lifted off the page background
    // and the search row sitting under it has visual depth.
    shadowColor: '#1E40AF',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 6,
  },
  bg: {
    width: '100%',
  },
  safe: {
    paddingHorizontal: spacing.lg,
  },
  // Bottom padding leaves room for the screen's pinned search/
  // filter row to overlap the hero's curved bottom (the row pulls
  // up via negative marginTop in the screen styles).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl + spacing.lg,
    gap: spacing.md,
  },
  text: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0.3,
    textAlign: RTL_LABEL_ALIGN,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 13,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
  },
  iconDisc: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },
});
