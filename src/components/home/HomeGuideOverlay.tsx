import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeModal as Modal } from '@/components/SafeModal';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RTL_LABEL_ALIGN, typography } from '@/theme';
import { he } from '@/i18n/he';

export function HomeGuideOverlay({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { height, width } = useWindowDimensions();
  const characterHeight = Math.min(340, height * 0.43, width * 0.95);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={styles.backdrop} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={styles.stage} showsVerticalScrollIndicator={false}>
          <View style={styles.scene}>
            <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel={he.homeGuideClose}>
              <Ionicons name="close" size={23} color="#FFFFFF" />
            </Pressable>
            <View style={styles.speech}>
              <View style={styles.tail} pointerEvents="none" />
              <Text style={styles.title} accessibilityRole="header">{he.homeGuideTitle}</Text>
              <Text style={styles.message}>{he.homeGuideMessage}</Text>
              <Pressable onPress={onClose} style={styles.continue} accessibilityRole="button">
                <Text style={styles.continueText}>{he.homeGuideContinue}</Text>
                <Ionicons name="arrow-back" size={19} color="#FFFFFF" />
              </Pressable>
            </View>
            <Image source={require('@/assets/images/entry/home-guide.png')}
              style={{ height: characterHeight, width: characterHeight * 2 / 3 }} resizeMode="contain" accessible={false} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0B17366B' },
  stage: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  scene: { width: '100%', maxWidth: 360, alignItems: 'center' },
  close: { alignSelf: 'flex-end', width: 44, height: 44, marginBottom: 8, borderRadius: 22, backgroundColor: '#132858CC', alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  speech: { width: '100%', backgroundColor: '#FFFFFF', borderRadius: 24, padding: 22, marginBottom: 18, gap: 10, elevation: 6, shadowColor: '#0B1736', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  tail: { position: 'absolute', bottom: -8, alignSelf: 'center', width: 22, height: 22, backgroundColor: '#FFFFFF', transform: [{ rotate: '45deg' }] },
  title: { ...typography.h3, fontWeight: '800', color: '#183B91', textAlign: RTL_LABEL_ALIGN },
  message: { ...typography.body, lineHeight: 25, color: '#334155', textAlign: RTL_LABEL_ALIGN },
  continue: { minHeight: 44, backgroundColor: '#294EC3', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 11, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 4 },
  continueText: { ...typography.button, color: '#FFFFFF', fontWeight: '700' },
});
