// HomeHero — the top of the home screen.
//
// The screen used to open on a white bar: menu, bell, logo, avatar, and then
// straight into cards. It was tidy and it was silent — nothing about it said
// what the app is for. This hero puts the same controls on a floodlit pitch
// and adds the one line the screen was missing: who is looking at it, and
// what they are here for.
//
// Nothing was taken away. Every control the white bar carried is still here,
// in the same place, doing the same thing.
//
// ── Layering ───────────────────────────────────────────────────────────────
// The photograph is bright, and white chrome on a bright photograph is
// unreadable. So the contrast is put back exactly where it is needed and
// nowhere else: a dark band under the top row, a second under the greeting,
// and the pitch between them left alone. The controls that sit directly on
// the image get their own translucent plates rather than relying on the
// scrim — a bell against floodlights needs more than a wash.

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
import { SafeAreaView } from 'react-native-safe-area-context';

import { UserAvatar } from '@/components/UserAvatar';
import { spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { User } from '@/types';

const LOGO: ImageSourcePropType = require('../../assets/images/logo.png');

/**
 * The bright stadium, reused.
 *
 * `pair-stadium-bg.png` was shot for the two-player screen: blue sky,
 * floodlights, green pitch, 1600×586 and nothing drawn into it. That is
 * exactly what this hero wants, and a second near-identical photograph would
 * be a megabyte spent on a difference nobody can see. The night shot
 * (`stadium-bg.png`) stays where it belongs — on the dark banners.
 */
const HERO_BG: ImageSourcePropType = require('../../assets/images/pair-stadium-bg.png');

export function HomeHero({
  user,
  greeting,
  hasNotif,
  onMenu,
  onBell,
  onAvatar,
  coachLine,
}: {
  user: Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;
  /** Time-of-day word ("בוקר טוב") — the screen owns the clock, not this. */
  greeting: string;
  hasNotif: boolean;
  onMenu: () => void;
  onBell: () => void;
  onAvatar: () => void;
  /**
   * The coach's line, said in the greeting's own second row.
   *
   * It used to be a translucent plate of its own under the greeting, with its
   * own "הודעה מהמאמן" heading — which meant the hero carried a static
   * question ("מוכן למשחק הבא?") AND a sentence that actually knew something,
   * stacked. The owner asked for the one that knows something to take the
   * other's place and for the plate to go. So this IS the subtitle now, and
   * `homeHeroSub` is the fallback for a visit where no rule has anything to
   * say.
   */
  coachLine?: string | null;
}) {
  const firstName = (user.name ?? '').trim().split(/\s+/)[0] || '';

  return (
    <ImageBackground source={HERO_BG} style={styles.hero} resizeMode="cover">
      <LinearGradient
        colors={['rgba(5,16,40,0.52)', 'rgba(5,16,40,0.10)', 'rgba(5,16,40,0.00)']}
        locations={[0, 0.5, 1]}
        style={styles.scrimTop}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['rgba(5,16,40,0.00)', 'rgba(5,16,40,0.46)']}
        style={styles.scrimBottom}
        pointerEvents="none"
      />

      <SafeAreaView edges={['top']}>
        <View style={styles.bar}>
          {/* First child → visual RIGHT under forceRTL. The avatar keeps the
              corner it has always had. */}
          <Pressable
            style={styles.avatarWrap}
            onPress={onAvatar}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={he.profileEdit}
          >
            <UserAvatar user={user} size={40} ring />
            <Ionicons name="chevron-down" size={14} color="#FFFFFF" />
          </Pressable>

          {/* Last child → visual LEFT. Bell written FIRST so it sits to the
              RIGHT of the menu inside the cluster — the two were the other way
              round and the owner asked to swap them. */}
          <View style={styles.leftCluster}>
            <Pressable
              style={styles.iconBtn}
              onPress={onBell}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={he.profileSectionNotifications}
            >
              <Ionicons name="notifications-outline" size={20} color="#FFFFFF" />
              {hasNotif ? <View style={styles.notifDot} /> : null}
            </Pressable>
            <Pressable
              style={styles.iconBtn}
              onPress={onMenu}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={he.profileMenuSectionProfile}
            >
              <Ionicons name="menu" size={22} color="#FFFFFF" />
            </Pressable>
          </View>

          {/* Absolutely positioned so the brand is a TRUE centre whatever the
              two clusters weigh. `pointerEvents none` keeps it from eating
              the taps meant for the controls underneath it. */}
          <View style={styles.logoWrap} pointerEvents="none">
            <Image source={LOGO} style={styles.logoImg} resizeMode="contain" />
            <Text style={styles.logoText}>{he.homeBrandName}</Text>
          </View>
        </View>

        <View style={styles.greetWrap}>
          <Text
            style={styles.greet}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {he.homeHeroGreeting(greeting, firstName)}
          </Text>
          <Text style={styles.greetSub} numberOfLines={2}>
            {coachLine?.trim() || he.homeHeroSub}
          </Text>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  // A colour under the photograph, so a slow decode shows the pitch's own
  // blue rather than a white flash above white cards.
  hero: { backgroundColor: '#0B1B3A', paddingBottom: spacing.xxxl },
  scrimTop: { position: 'absolute', left: 0, right: 0, top: 0, height: 150 },
  scrimBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 120 },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    minHeight: 56,
  },
  avatarWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  leftCluster: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Translucent plates, not white ones. A white square on a photograph reads
  // as a hole punched in it; a dark plate reads as chrome laid over it.
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(10,22,48,0.34)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifDot: {
    position: 'absolute',
    top: 9,
    right: 11,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#38BDF8',
    borderWidth: 1.5,
    borderColor: 'rgba(10,22,48,0.9)',
  },
  logoWrap: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  logoImg: { width: 28, height: 28, borderRadius: 8 },
  logoText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    textShadowColor: 'rgba(5,16,40,0.6)',
    textShadowRadius: 6,
  },

  greetWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: 2 },
  greet: {
    fontSize: 25,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: RTL_LABEL_ALIGN,
    textShadowColor: 'rgba(5,16,40,0.65)',
    textShadowRadius: 8,
  },
  greetSub: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.92)',
    textAlign: RTL_LABEL_ALIGN,
    textShadowColor: 'rgba(5,16,40,0.6)',
    textShadowRadius: 6,
  },
});
