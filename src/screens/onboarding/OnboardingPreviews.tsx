// In-app "screenshots" for the pre-sign-in onboarding. These are REAL
// captures of the live app (games feed, club detail, live match + rotation),
// cropped to app content and shown inside a clean phone frame so the product
// sells itself before sign-up. Source PNGs live in
// assets/images/onboarding/ (600px wide, status bar / gesture bar stripped).

import React from 'react';
import {
  Dimensions,
  Image,
  type ImageSourcePropType,
  StyleSheet,
  View,
} from 'react-native';

const { width: SCREEN_W } = Dimensions.get('window');

// Frame sized to the real screenshot aspect so each image fills edge-to-edge
// with no letterboxing. Capped so it stays inside the slide gutters on small
// phones while never getting comically large on tablets.
const FRAME_W = Math.min(236, SCREEN_W * 0.62);
const BEZEL = 6;
const INNER_W = FRAME_W - BEZEL * 2;
const IMG_ASPECT = 1253 / 600; // captured + cropped screenshot ratio (h/w)
const INNER_H = INNER_W * IMG_ASPECT;
const FRAME_H = INNER_H + BEZEL * 2;

function PhoneFrame({ source }: { source: ImageSourcePropType }) {
  return (
    <View style={styles.frame}>
      <Image source={source} style={styles.screen} resizeMode="cover" />
    </View>
  );
}

export function PreviewMatches() {
  return <PhoneFrame source={require('../../assets/images/onboarding/games.png')} />;
}

export function PreviewClub() {
  return <PhoneFrame source={require('../../assets/images/onboarding/club.png')} />;
}

export function PreviewLive() {
  return <PhoneFrame source={require('../../assets/images/onboarding/live.png')} />;
}

const styles = StyleSheet.create({
  frame: {
    width: FRAME_W,
    height: FRAME_H,
    borderRadius: 30,
    backgroundColor: '#0B1220',
    padding: BEZEL,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.35,
    shadowRadius: 22,
    elevation: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  screen: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
  },
});
