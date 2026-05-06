// CommunityStadiumHero — full-bleed stadium hero for the redesigned
// CommunityDetailsScreen.
//
// Visual:
//   • Stadium photo as ImageBackground (same asset the match-details
//     hero uses; consistent visual language across the app)
//   • Dark blue vertical gradient overlay for legibility
//   • Top bar (mirrors MatchStadiumHero exactly):
//       [back ←]  פרטי קהילה  [☰ menu]
//       (back is FIRST child → trailing/right edge under RTL,
//        menu is LAST child → leading/left edge)
//   • Centered huge community name
//   • Member-count pill badge under the name

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

interface Props {
  name: string;
  /** Number of approved community members. Drives the pill badge. */
  memberCount: number;
  onBackPress: () => void;
  onMenuPress: () => void;
}

const STADIUM_BG: ImageSourcePropType = require('../../assets/images/stadium-bg.png');

export function CommunityStadiumHero({
  name,
  memberCount,
  onBackPress,
  onMenuPress,
}: Props) {
  return (
    <View style={styles.wrap}>
      <ImageBackground
        source={STADIUM_BG}
        style={styles.bg}
        resizeMode="cover"
      >
        <LinearGradient
          colors={[
            'rgba(7,12,32,0.55)',
            'rgba(7,12,32,0.78)',
            'rgba(7,12,32,0.95)',
          ]}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView edges={['top']} style={styles.safe}>
          <View style={styles.topBar}>
            {/* Back is FIRST → renders on the leading edge under our
                flex flow, which under forceRTL is the visual RIGHT.
                chevron-forward auto-flips to ← under RTL so the icon
                points "back" the right way. */}
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
              {he.communityHeroDetailsTitle}
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
              <Ionicons name="menu" size={24} color="#FFFFFF" />
            </Pressable>
          </View>

          <View style={styles.identity}>
            <Text style={styles.name} numberOfLines={2}>
              {name}
            </Text>
            <View style={styles.memberPill}>
              <Ionicons name="people" size={14} color="#FFFFFF" />
              <Text style={styles.memberPillText}>
                {he.communityMembersCount(memberCount)}
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
    // Leaves a strip of stadium photo below the title so the floating
    // stats grid (pulled up via negative margin in the screen) lands
    // ON the photo, not on the white body.
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
  // Inline title sandwiched between the two icon buttons — same
  // pattern as MatchStadiumHero's "פרטי משחק".
  titleInline: {
    flex: 1,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  identity: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  // Community name — the loudest thing on the screen.
  name: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.3,
    width: '100%',
  },
  // Member-count badge — small frosted pill that hugs the name from
  // below. White-on-translucent so it reads cleanly over the dark
  // gradient without competing with the title.
  memberPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  memberPillText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
