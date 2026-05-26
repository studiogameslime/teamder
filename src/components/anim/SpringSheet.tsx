// SpringSheet — wraps the inner content of a Modal-based bottom sheet
// in a Reanimated spring entry so the panel rises with a satisfying
// bounce instead of the default abrupt slide-up. Backdrop fades in
// alongside.
//
// Usage:
//   <Modal transparent visible={open} onRequestClose={close}>
//     <SpringSheet visible={open} onBackdropPress={close}>
//       <YourSheetBody />
//     </SpringSheet>
//   </Modal>
//
// We KEEP the native <Modal/> for accessibility (focus capture, back
// button on Android) but replace its `animationType="slide"` /
// `"fade"` with our own Reanimated transitions on the inner panel.
// Pass `animationType="none"` to the parent <Modal/> so the two don't
// fight.

import React, { useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  /** Drives the entry/exit animation. Pass the same flag you'd give
   *  to `<Modal visible/>`. Keep the Modal mounted until your local
   *  exit animation finishes if you want a smooth disappear too —
   *  the easiest pattern is to set Modal's `animationType="none"`
   *  and unmount on the same flag.*/
  visible: boolean;
  children: React.ReactNode;
  /** Tap-outside handler. Optional — if not provided the backdrop
   *  is non-interactive (use this when you have explicit cancel
   *  controls and the backdrop tap should be a no-op). */
  onBackdropPress?: () => void;
  /** Pixels the panel travels from. Default 240. */
  fromOffsetY?: number;
  /** Override the panel container style — e.g. centred dialog vs
   *  bottom sheet. */
  panelStyle?: ViewStyle;
  /** Vertically positions the panel within the modal. `bottom`
   *  (default) for sheets that rise from the bottom edge; `center`
   *  for dialog-style modals. */
  position?: 'bottom' | 'center';
}

export function SpringSheet({
  visible,
  children,
  onBackdropPress,
  fromOffsetY = 240,
  panelStyle,
  position = 'bottom',
}: Props) {
  const backdrop = useSharedValue(0);
  const translateY = useSharedValue(fromOffsetY);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      backdrop.value = withTiming(1, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      });
      opacity.value = withTiming(1, { duration: 180 });
      translateY.value = withSpring(0, {
        damping: 18,
        stiffness: 240,
        mass: 0.9,
      });
    } else {
      backdrop.value = withTiming(0, { duration: 180 });
      opacity.value = withTiming(0, { duration: 140 });
      translateY.value = withTiming(fromOffsetY, {
        duration: 200,
        easing: Easing.in(Easing.cubic),
      });
    }
  }, [visible, backdrop, opacity, translateY, fromOffsetY]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdrop.value,
  }));
  const panelAnimStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <View style={styles.host} pointerEvents="box-none">
      <Animated.View
        pointerEvents={onBackdropPress ? 'auto' : 'none'}
        style={[styles.backdrop, backdropStyle]}
      >
        {onBackdropPress ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={onBackdropPress} />
        ) : null}
      </Animated.View>
      <Animated.View
        pointerEvents="box-none"
        style={[
          position === 'bottom' ? styles.panelBottom : styles.panelCenter,
          panelStyle,
          panelAnimStyle,
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  panelBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // `top: '10%'` gives the panel a DEFINED height range — 90% of
    // the host. Children using `flex:1` or `minHeight/maxHeight: %`
    // now resolve correctly against this. Earlier we only set
    // `maxHeight: 90%` with no `top`, which left the panel sized to
    // intrinsic content; children declaring `height: 85%` then
    // computed against an undefined parent and collapsed to zero.
    top: '10%',
  },
  panelCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
