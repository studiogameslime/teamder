import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, type ImageSourcePropType } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';

/** Keep the last loaded image visible until its replacement actually loads. */
export function CoverCrossfade({ source, imageKey }: { source: ImageSourcePropType; imageKey: string }) {
  const reduced = useReducedMotion();
  const [previous, setPrevious] = useState<ImageSourcePropType | null>(null);
  const loaded = useRef(source);
  const active = useRef(imageKey);
  active.current = imageKey;
  const loadedKey = useRef<string | null>(null);
  const changed = useRef(imageKey);
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (changed.current === imageKey) return;
    changed.current = imageKey;
    if (loadedKey.current === imageKey) return;
    setPrevious(loaded.current);
    cancelAnimation(opacity);
    opacity.value = 0;
  }, [imageKey, opacity]);
  useEffect(() => () => cancelAnimation(opacity), [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <>
    {previous && <Image source={previous} style={StyleSheet.absoluteFill} resizeMode="cover" />}
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Image key={imageKey} source={source} style={StyleSheet.absoluteFill} resizeMode="cover"
        onLoad={() => {
          if (active.current !== imageKey) return;
          loaded.current = source;
          loadedKey.current = imageKey;
          opacity.value = withTiming(1, { duration: reduced ? 0 : 250 });
        }}
        onError={() => {
          if (active.current !== imageKey) return;
          setPrevious(loaded.current);
          cancelAnimation(opacity);
          opacity.value = 0;
        }} />
    </Animated.View>
  </>;
}
