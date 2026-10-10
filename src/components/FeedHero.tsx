import React from 'react';
import { ImageBackground, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { RTL_LABEL_ALIGN } from '@/theme';

export function FeedHero({ title, subtitle, actionLabel, background, onCreate }: {
  title: string; subtitle: string; actionLabel: string; background: ImageSourcePropType; onCreate: () => void;
}) {
  return <ImageBackground source={background} resizeMode="cover" style={styles.hero}>
    <LinearGradient colors={['rgba(14,49,152,0.3)', 'rgba(37,99,235,0.06)']} style={StyleSheet.absoluteFill} />
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <Pressable onPress={onCreate} accessibilityRole="button" accessibilityLabel={actionLabel} style={styles.create}>
        <Text style={styles.createText}>{actionLabel}</Text>
        <Ionicons name="add" size={18} color="#FFFFFF" />
      </Pressable>
    </View>
  </ImageBackground>;
}
const styles = StyleSheet.create({
  hero: { backgroundColor: '#1555DB', borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden' },
  row: { paddingHorizontal: 18, paddingTop: 25, paddingBottom: 32, minHeight: 128, flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, gap: 4 },
  title: { fontSize: 29, fontWeight: '900', color: '#FFFFFF', textAlign: RTL_LABEL_ALIGN },
  subtitle: { fontSize: 12, color: '#E4EDFF', textAlign: RTL_LABEL_ALIGN },
  create: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 44,
    paddingHorizontal: 11, paddingVertical: 8, maxWidth: '44%', borderWidth: 1, borderColor: '#CADBFF', borderRadius: 14, backgroundColor: '#FFFFFF10' },
  createText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF', flexShrink: 1, textAlign: 'center' },
});
