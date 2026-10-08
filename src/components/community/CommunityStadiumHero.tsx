// CommunityStadiumHero — full-bleed stadium hero for the redesigned
// CommunityDetailsScreen.
//
// Visual:
//   • Stadium photo as ImageBackground (same asset the match-details
//     hero uses; consistent visual language across the app)
//   • Dark blue vertical gradient overlay for legibility
//   • Top bar (mirrors MatchStadiumHero exactly):
//       [back ←]  פרטי מועדון  [☰ menu]
//       (back is FIRST child → trailing/right edge under RTL,
//        menu is LAST child → leading/left edge)
//   • Centered huge community name
//   • Member-count pill badge under the name

import React from 'react';
import {
  ActivityIndicator,
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
import { CoverCrossfade } from '@/components/anim/CoverCrossfade';

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
  /**
   * Omitted for a visitor: every item in that menu is a member or admin
   * action, so the button would open an empty sheet. A control that does
   * nothing is worse than no control.
   */
  onMenuPress?: () => void;
  onEditCoverPress?: () => void;
  /** Members only — opens the community chat. Hidden when undefined. */
  onChatPress?: () => void;
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
  onChatPress,
}: Props) {
  // Priority: uploaded photo → built-in gallery pick → bundled default.
  const source: ImageSourcePropType = coverUrl
    ? { uri: coverUrl }
    : getCoverSource(coverImageId) ?? STADIUM_BG;
  return (
    <View style={styles.wrap}>
      <View style={styles.bg}>
        <CoverCrossfade source={source} imageKey={coverUrl || coverImageId || 'default'} />
        <LinearGradient
          // The reference photo stays bright: the darkening is a scrim behind
          // the TEXT, not a wash over the whole image. The old stops
          // (0.55 → 0.95) turned a sunset pitch into a grey rectangle.
          colors={[
            'rgba(4,10,25,0.45)',
            'rgba(4,10,25,0.12)',
            'rgba(4,10,25,0.58)',
          ]}
          locations={[0, 0.42, 1]}
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
            {/* No title strip. The reference puts nothing between the two
                round buttons — the club's own name, three lines down, is the
                title, and "פרטי מועדון" above it said the same thing twice in
                a smaller font. */}
            <View style={styles.topSpacer} />
            {/* Trailing action group: chat (members) sits just before the
                menu so both share the hero's leading (left under RTL) edge. */}
            <View style={styles.actions}>
              {onChatPress ? (
                <Pressable
                  onPress={onChatPress}
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.iconBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={he.chatOpenCommunity}
                >
                  <Ionicons name="chatbubble-ellipses" size={22} color="#FFFFFF" />
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
                  <Ionicons name="menu" size={24} color="#FFFFFF" />
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={styles.identity}>
            <Text style={styles.name} numberOfLines={2}>
              {name}
            </Text>
            <View style={styles.memberPill}>
              <Text style={styles.memberPillText}>
                {he.communityMembersCount(memberCount)}
              </Text>
              <Ionicons name="people" size={14} color="#FFFFFF" />
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
                <Text style={styles.coverEditText}>
                  {uploadingCover
                    ? he.communityCoverUploading
                    : he.communityCoverChange}
                </Text>
                {uploadingCover ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="camera" size={15} color="#FFFFFF" />
                )}
              </Pressable>
            ) : null}
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'visible',
  },
  bg: {
    width: '100%',
    // The tab strip below overlaps the hero by its own corner radius, so the
    // photo needs a little room under the badge for that overlap to fall on
    // the image rather than on a card.
    paddingBottom: 44,
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
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  // Groups the chat + menu icons together on the trailing edge.
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  topSpacer: { flex: 1 },
  identity: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  // Community name — the loudest thing on the screen.
  name: {
    color: '#FFFFFF',
    fontSize: 31,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.2,
    width: '100%',
    // The scrim alone does not carry white type over a bright sky; the
    // reference name has a soft shadow under it.
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  // Member-count badge — small frosted pill that hugs the name from
  // below. White-on-translucent so it reads cleanly over the dark
  // gradient without competing with the title.
  memberPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(8,14,30,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  memberPillText: {
    color: '#FFFFFF',
    fontSize: 14,
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
