// ProfileHeroCard — full-bleed stadium hero at the top of the
// profile screen.
//
// Visual:
//   • Stadium photo as ImageBackground (cover)
//   • Dark vertical gradient overlay so the white text + jersey
//     read against any frame of the photo
//   • Top bar: ☰ left (RTL: visually right), 🔔 right
//   • Centered: large jersey + edit overlay + name + subtitle
//
// The stats card on the parent screen overlaps this hero's bottom
// edge — we leave deliberate padding-bottom here so the stats
// card has visible-but-not-cropped overlap territory.

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
import { Jersey as JerseyView } from '@/components/Jersey';
import type { Jersey } from '@/types';
import { spacing } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  jersey: Jersey;
  name: string;
  subtitle?: string;
  onEditJersey?: () => void;
  onMenuPress: () => void;
  onNotificationsPress?: () => void;
  hasUnreadNotifications?: boolean;
}

const STADIUM_BG: ImageSourcePropType = require('../../assets/images/stadium-bg.png');

export function ProfileHeroCard({
  jersey,
  name,
  subtitle,
  onEditJersey,
  onMenuPress,
  onNotificationsPress,
  hasUnreadNotifications,
}: Props) {
  return (
    <View style={styles.wrap}>
      <ImageBackground
        source={STADIUM_BG}
        style={styles.bg}
        imageStyle={styles.bgImage}
        resizeMode="cover"
      >
        {/* Top→bottom dark gradient — keeps the photo's mood while
            guaranteeing legibility for the white name/subtitle and
            the floating stats card that overlaps below. */}
        <LinearGradient
          colors={[
            'rgba(7,12,32,0.35)',
            'rgba(7,12,32,0.55)',
            'rgba(7,12,32,0.85)',
          ]}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView edges={['top']} style={styles.safe}>
          <View style={styles.topBar}>
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
              <Ionicons name="menu" size={26} color="#FFFFFF" />
            </Pressable>
            <Pressable
              onPress={onNotificationsPress}
              hitSlop={10}
              style={({ pressed }) => [
                styles.iconBtn,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={he.profileSectionNotifications}
            >
              <Ionicons
                name="notifications-outline"
                size={24}
                color="#FFFFFF"
              />
              {hasUnreadNotifications ? (
                <View style={styles.notifDot} />
              ) : null}
            </Pressable>
          </View>

          <View style={styles.center}>
            <View style={styles.jerseyRing}>
              <JerseyView jersey={jersey} size={96} />
              {onEditJersey ? (
                <Pressable
                  onPress={onEditJersey}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.editBtn,
                    pressed && { opacity: 0.8 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={he.jerseyOpenPicker}
                >
                  <Ionicons name="pencil" size={14} color="#FFFFFF" />
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
  },
  bg: {
    width: '100%',
    // Tighter than the original 60 — leaves enough overlap for the
    // floating stats card without forcing the user to scroll on
    // smaller screens.
    paddingBottom: 44,
  },
  bgImage: {
    // Cover the full hero — the gradient takes care of legibility.
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
    position: 'relative',
  },
  notifDot: {
    position: 'absolute',
    top: 8,
    end: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3B82F6',
  },
  center: {
    alignItems: 'center',
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
    gap: 6,
  },
  jerseyRing: {
    width: 116,
    height: 116,
    borderRadius: 58,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(7,12,32,0.4)',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.95)',
    position: 'relative',
  },
  editBtn: {
    position: 'absolute',
    bottom: 2,
    start: 4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#1F2937',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  name: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 4,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    textAlign: 'center',
  },
});
