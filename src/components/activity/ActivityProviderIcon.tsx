import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
const icons: Record<string, number> = {
  fit: require('../../../assets/activity/fit.png'), samsung: require('../../../assets/activity/samsung.png'),
  garmin: require('../../../assets/activity/garmin.png'), fitbit: require('../../../assets/activity/fitbit.png'),
  strava: require('../../../assets/activity/strava.png'), polar: require('../../../assets/activity/polar.png'),
};
export function ActivityProviderIcon({ icon, size = 44 }: { icon: string; size?: number }) {
  return <View accessible={false} style={[s.box, { width: size, height: size, borderRadius: size * 0.28 }]}>
    {icons[icon] ? <Image source={icons[icon]} style={{ width: size * 0.8, height: size * 0.8 }} resizeMode="contain" />
      : <Ionicons name={icon === 'phone' ? 'phone-portrait-outline' : icon === 'watch' ? 'watch-outline' : 'fitness-outline'} size={size * 0.55} color="#17775F" />}
  </View>;
}
const s = StyleSheet.create({ box: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' } });
