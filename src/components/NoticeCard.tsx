import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RTL_LABEL_ALIGN } from '@/theme';

type Props = {
  message: string;
  type: 'success' | 'error' | 'info';
  icon?: keyof typeof Ionicons.glyphMap;
  onClose: () => void;
};

const palettes = {
  success: { accent: '#17643D', tint: '#EBF8F0', icon: 'checkmark-circle-outline' },
  error: { accent: '#9E3030', tint: '#FFF1F1', icon: 'alert-circle-outline' },
  info: { accent: '#465261', tint: '#F0F2F5', icon: 'information-circle-outline' },
} as const;

/** Shared visual language for transient in-app feedback. First child is on the right under forceRTL. */
export function NoticeCard({ message, type, icon, onClose }: Props) {
  const palette = palettes[type];
  // A caller can explicitly separate a heading and detail with a newline.
  // Single-line messages remain intact; never guess a title from punctuation.
  const [heading, ...details] = message.split('\n');
  return <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={`${message}. סגור הודעה`} style={[s.card, { backgroundColor: palette.tint }]}>
    <View style={s.icon}>
      <Ionicons name={icon ?? palette.icon} size={28} color={palette.accent} accessible={false} />
    </View>
    <Text accessibilityRole="alert" accessibilityLiveRegion={type === 'error' ? 'assertive' : 'polite'} style={[s.text, { color: palette.accent }]}>
      {heading}{details.length ? <Text style={s.detail}>{'\n'}{details.join('\n')}</Text> : null}
    </Text>
  </Pressable>;
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, minHeight: 64, paddingVertical: 14, paddingHorizontal: 16, shadowColor: '#14213D', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  icon: { width: 30, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  text: { flex: 1, fontSize: 15, lineHeight: 23, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  detail: { fontSize: 13, lineHeight: 22, fontWeight: '400', color: '#56616E' },
});
