// CommunityStadiumHero — full-bleed stadium hero for the redesigned
// CommunityDetailsScreen.
//
// Visual:
//   • Stadium photo as ImageBackground (same asset the match-details
//     hero uses; consistent visual language across the app)
//   • Dark blue vertical gradient overlay for legibility
//   • Top bar (mirrors MatchStadiumHero exactly):
//       [back ←]  פרטי קבוצה  [☰ menu]
//       (back is FIRST child → trailing/right edge under RTL,
//        menu is LAST child → leading/left edge)
//   • Centered huge community name
//   • Member-count pill badge under the name

import React from 'react';
import {
  ActivityIndicator,
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
import { getCoverSource } from '@/data/coverImages';

interface Props {
  name: string;
  /** Number of approved community members. Drives the pill badge. */
  memberCount: number;
  /**
   * Admin-uploaded cover photo (Storage download URL). When present it
   * replaces the bundled default stadium image. Falls back to the
   * default when undefined/empty.
   */
  coverUrl?: string;
  /** Built-in gallery cover id (used when there's no uploaded coverUrl). */
  coverImageId?: string;
  /** Show the camera edit affordance (coaches only). */
  canEditCover?: boolean;
  /** Spinner over the edit button while an upload is in flight. */
  uploadingCover?: boolean;
  onBackPress: () => void;
  onMenuPress: () => void;
  onEditCoverPress?: () => void;
}

const STADIUM_BG: ImageSourcePropType = require('../../assets/images/stadium-bg.png');

export function CommunityStadiumHero({
  name,
  memberCount,
  coverUrl,
  coverImageId,
  canEditCover = false,
  uploadingCover = false,
  onBackPress,
  onMenuPress,
  onEditCoverPress,
}: Props) {
  // Priority: uploaded photo → built-in gallery pick → bundled default.
  const source: ImageSourcePropType = coverUrl
    ? { uri: coverUrl }
    : getCoverSource(coverImageId) ?? STADIUM_BG;
  return (
    <View style={styles.wrap}>
      <ImageBackground
        source={source}
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

            {canEditCover ? (
              <Pressable
                onPress={onEditCoverPress}
                disabled={uploadingCover}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.coverEditPill,
                  (pressed || uploadingCover) && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={he.communityCoverChange}
              >
                {uploadingCover ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="camera" size={15} color="#FFFFFF" />
                )}
                <Text style={styles.coverEditText}>
                  {uploadingCover
                    ? he.communityCoverUploading
                    : he.communityCoverChange}
                </Text>
              </Pressable>
            ) : null}
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
  // Admin-only "change cover photo" affordance. Slightly stronger fill
  // than the member pill so it reads as a tappable action, not a badge.
  coverEditPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.32)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  coverEditText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
