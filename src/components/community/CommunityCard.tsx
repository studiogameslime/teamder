// CommunityCard — premium card for the redesigned communities feed.
//
// Layout under forceRTL (visual):
//
//   ┌──────────────────────────────────────────────┐
//   │ ╔══════════════════════════════════════════╗ │
//   │ ║  [cover photo or brand gradient]         ║ │
//   │ ║                              [⭐ מנהל]    ║ │  ← status badge
//   │ ╚══════════════════════════════════════════╝ │     overlays cover
//   │                              שם הקבוצה  ›   │
//   │  תיאור קצר של הקהילה — שורת tagline           │
//   │  📍 מגרש · עיר          👥 23 שחקנים          │
//   │  ┌────────────────────────────────────────┐  │
//   │  │              הצטרף לקבוצה              │  │  ← only when status='none'
//   │  └────────────────────────────────────────┘  │
//   └──────────────────────────────────────────────┘
//
// Design notes:
//   • The status badge no longer competes with the title text — it sits
//     on the cover photo overlay so a long title can use the full row
//     width without an absolute child clipping into it.
//   • Cover photo falls back to a brand-blue gradient with a faded
//     soccer ball so empty communities still feel inviting.
//   • Description is bounded to 2 lines and falls away gracefully when
//     missing so the card height adapts.
//   • Join CTA appears only for non-members ('none' status); members /
//     admins / pending see the card as a navigation tile.

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
import { spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { PressableScale } from '@/components/PressableScale';

// Default stadium photo — same asset CommunityStadiumHero uses on the
// details screen. Keeping one source of truth means the card preview
// and the full-page hero never disagree on what an "unbranded
// community" looks like.
const STADIUM_BG: ImageSourcePropType =
  require('../../assets/images/stadium-bg.png');

export type CommunityCardStatus =
  | 'admin'
  | 'member'
  | 'pending'
  | 'none';

interface Props {
  name: string;
  /** "עיר · מגרש" — pre-joined by the caller, falsy → hidden line. */
  locationLine: string;
  /** Short tagline / community description. Falsy → line hidden. */
  description?: string;
  /** Optional remote URL for the community cover photo. When absent we
   *  render a brand-blue gradient with a faded ball icon. */
  coverPhotoUrl?: string;
  memberCount: number;
  status: CommunityCardStatus;
  /** Tap whole card → details. */
  onPress: () => void;
  /** Tap the "הצטרף" CTA (only rendered when status='none'). When
   *  omitted the CTA is hidden — caller hasn't wired the action. */
  onJoinPress?: () => void;
  /** Disable the join CTA while a network request is in flight. */
  joinBusy?: boolean;
}

export function CommunityCard({
  name,
  locationLine,
  description,
  coverPhotoUrl,
  memberCount,
  status,
  onPress,
  onJoinPress,
  joinBusy,
}: Props) {
  const palette = paletteFor(status);
  const showJoin = status === 'none' && !!onJoinPress;

  return (
    <PressableScale
      onPress={onPress}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={name}
    >
      {/* Cover — uses the admin-uploaded cover when present, otherwise
          the bundled stadium photo (same image the details-screen hero
          falls back to). A dark gradient overlay keeps badge contrast
          high regardless of which photo surfaces. */}
      <ImageBackground
        source={coverPhotoUrl ? { uri: coverPhotoUrl } : STADIUM_BG}
        style={styles.cover}
        resizeMode="cover"
      >
        <LinearGradient
          colors={[
            'rgba(7,12,32,0.20)',
            'rgba(7,12,32,0.55)',
            'rgba(7,12,32,0.78)',
          ]}
          style={StyleSheet.absoluteFillObject}
        />
        {palette ? (
          <View style={[styles.badge, { backgroundColor: palette.badgeBg }]}>
            <Ionicons name={palette.icon} size={12} color={palette.badgeFg} />
            <Text style={[styles.badgeText, { color: palette.badgeFg }]}>
              {palette.label}
            </Text>
          </View>
        ) : null}
      </ImageBackground>

      {/* Body — title, description, info row, optional CTA. */}
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Ionicons
            name="chevron-back"
            size={18}
            color="#94A3B8"
            style={styles.titleChevron}
          />
        </View>

        {description ? (
          <Text style={styles.description} numberOfLines={2}>
            {description}
          </Text>
        ) : null}

        <View style={styles.infoRow}>
          {locationLine ? (
            <View style={styles.metaInline}>
              <Ionicons name="location" size={13} color="#94A3B8" />
              <Text style={styles.metaText} numberOfLines={1}>
                {locationLine}
              </Text>
            </View>
          ) : null}
          <View style={styles.playersChip}>
            <Ionicons name="people" size={12} color="#3B82F6" />
            <Text style={styles.playersText}>
              {he.groupsSearchMembers(memberCount)}
            </Text>
          </View>
        </View>

        {showJoin ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              onJoinPress!();
            }}
            disabled={joinBusy}
            style={({ pressed }) => [
              styles.joinBtn,
              (pressed || joinBusy) && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={he.communitiesCardJoin}
          >
            <Text style={styles.joinText}>{he.communitiesCardJoin}</Text>
            <Ionicons name="add-circle" size={16} color="#FFFFFF" />
          </Pressable>
        ) : null}
      </View>
    </PressableScale>
  );
}

interface Palette {
  badgeBg: string;
  badgeFg: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

function paletteFor(status: CommunityCardStatus): Palette | null {
  if (status === 'admin') {
    return {
      badgeBg: '#1D4ED8',
      badgeFg: '#FFFFFF',
      label: he.communityDetailsAdminBadge,
      icon: 'star',
    };
  }
  if (status === 'member') {
    return {
      badgeBg: '#16A34A',
      badgeFg: '#FFFFFF',
      label: he.communitiesCardMemberBadge,
      icon: 'checkmark-circle',
    };
  }
  if (status === 'pending') {
    return {
      badgeBg: '#64748B',
      badgeFg: '#FFFFFF',
      label: he.groupsActionPending,
      icon: 'time',
    };
  }
  return null;
}

const COVER_HEIGHT = 110;

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  cover: {
    height: COVER_HEIGHT,
    backgroundColor: '#0F172A',   // dark fallback while image loads
    position: 'relative',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  badge: {
    position: 'absolute',
    bottom: spacing.sm,
    end: spacing.sm,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'stretch',
    justifyContent: 'flex-start',
  },
  name: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  titleChevron: {
    opacity: 0.6,
  },
  description: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
  },
  infoRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
    marginTop: 2,
  },
  metaInline: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  metaText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  playersChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(59,130,246,0.10)',
    marginStart: 'auto',
  },
  playersText: {
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '700',
  },
  joinBtn: {
    marginTop: spacing.sm,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1D4ED8',
    paddingVertical: 10,
    borderRadius: 12,
    alignSelf: 'stretch',
  },
  joinText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
