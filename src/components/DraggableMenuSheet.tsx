import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Modal, PanResponder, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';

/** Drag only the header, so scrolling a long menu never dismisses it. */
export function DraggableMenuSheet({ visible, onClose, children }: {
  visible: boolean; onClose: () => void; children: React.ReactNode;
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const { height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  useEffect(() => () => translateY.stopAnimation(), [translateY]);
  useEffect(() => {
    translateY.stopAnimation();
    translateY.setValue(0);
    closing.current = false;
  }, [visible, translateY]);
  const dismiss = () => {
    if (closing.current) return;
    closing.current = true;
    if (reducedMotion) {
      closeRef.current();
      return;
    }
    Animated.timing(translateY, { toValue: height, duration: 190, useNativeDriver: true }).start(({ finished }) => {
      if (finished) closeRef.current();
    });
  };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => translateY.stopAnimation(),
    onPanResponderMove: (_, g) => translateY.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_, g) => {
      if (g.dy > 70 || (g.dy > 18 && g.vy > 0.65)) dismiss();
      else Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 100, friction: 16 }).start();
    },
    onPanResponderTerminate: () => Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start(),
  }), [translateY, height, reducedMotion]);
  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? 'fade' : 'slide'} onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="סגור תפריט" />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <SafeAreaView edges={['bottom']} style={styles.safe}>
            <View style={styles.header}>
              <View style={styles.dragArea} {...pan.panHandlers} accessibilityLabel="גרור למטה לסגירת התפריט">
                <View style={styles.handle} />
              </View>
              <Pressable onPress={dismiss} style={styles.close} accessibilityRole="button" accessibilityLabel="סגור תפריט">
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            {children}
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.42)' },
  sheet: { maxHeight: '88%', backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  safe: { flexShrink: 1 },
  header: { height: 48, justifyContent: 'flex-start', alignItems: 'center', paddingTop: 12 },
  dragArea: { position: 'absolute', top: 0, bottom: 0, start: 56, end: 56, alignItems: 'center', paddingTop: 12 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.textMuted, opacity: 0.4 },
  // Logical end is the physical left under forceRTL.
  close: { position: 'absolute', end: 12, top: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
