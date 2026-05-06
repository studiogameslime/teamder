// MatchesHero — top banner of the redesigned GamesListScreen.
//
// Visual:
//   • `gamesTabBackground.png` as ImageBackground.
//   • Dark→light blue gradient overlay for legibility.
//   • Soft curved bottom corners.
//   • Title "משחקים" + subtitle, right-aligned (RTL leading edge).
//
// The hero is purely presentational — no controls. The screen owns
// the filter button + segmented control row that floats over the
// bottom of this banner.

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

const HERO_BG: ImageSourcePropType = require('../../assets/images/gamesTabBackground.png');

export function MatchesHero() {
  return (
    <View style={styles.wrap}>
      <ImageBackground
        source={HERO_BG}
        style={styles.bg}
        imageStyle={styles.bgImage}
        resizeMode="cover"
      >
        <LinearGradient
          colors={[
            'rgba(15,23,73,0.78)',
            'rgba(30,64,175,0.82)',
            'rgba(59,130,246,0.78)',
          ]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView edges={['top']} style={styles.safe}>
          <View style={styles.row}>
            {/* Frosted disc with a football icon — same chrome as the
                people disc on CommunitiesHero so the two tab heroes
                read as a pair. First child → visual LEFT under
                space-between (matches the CommunitiesHero pattern). */}
            <View style={styles.iconDisc}>
              <Ionicons name="football" size={26} color="#FFFFFF" />
            </View>
            <View style={styles.text}>
              <Text style={styles.title} numberOfLines={1}>
                {he.gamesListTitle}
              </Text>
              <Text style={styles.subtitle} numberOfLines={2}>
                {he.matchesHeroSubtitle}
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
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    shadowColor: '#1E40AF',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 6,
  },
  bg: {
    width: '100%',
    // Generous bottom padding leaves room for the screen's pinned
    // controls row to float over the hero's bottom edge (the row
    // is positioned via negative marginTop in the screen styles).
    paddingBottom: spacing.xxl + spacing.xl,
  },
  // Mirror the hero image horizontally so its dominant features land
  // on the opposite side from the source asset — the right edge gets
  // the busier silhouette, balancing the right-aligned Hebrew title.
  bgImage: {
    transform: [{ scaleX: -1 }],
  },
  safe: {
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  text: {
    flex: 1,
    gap: 4,
  },
  // Frosted circle, identical chrome to CommunitiesHero's iconDisc so
  // the two tabs feel like part of the same family.
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
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0.3,
    textAlign: RTL_LABEL_ALIGN,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
  },
});
