import { observeCaughtError } from '../utils/errorObservation';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, ReduceMotion, withTiming, type EntryAnimationsValues } from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { dismissStoreUpdate, useUpdatePromptStore } from '@/store/updatePromptStore';
import { useUserStore } from '@/store/userStore';
import { openTrackedUpdate } from '@/services/updateAttributionService';
import { updateTargetKey } from '@/services/updateService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { he } from '@/i18n/he';
import { RTL_LABEL_ALIGN } from '@/theme/rtl';

const enterFromTop = (values: EntryAnimationsValues) => {
  'worklet';
  return {
    // Start above the screen even when the safe area or font size changes.
    initialValues: { originY: values.targetOriginY - values.targetGlobalOriginY - values.targetHeight - 16 },
    animations: {
      originY: withTiming(values.targetOriginY, {
        duration: 420,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      }),
    },
  };
};

/** Inline home-header replacement, without a modal or dimmed backdrop. */
export function UpdateBanner() {
  const update = useUpdatePromptStore(s => s.update);
  const focused = useIsFocused();
  const shown = useRef(new Set<string>());
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!focused || update?.kind !== 'optional') return;
    const target = updateTargetKey(update);
    if (!shown.current.has(target)) {
      shown.current.add(target);
      logEvent(AnalyticsEvent.UpdatePromptShown, { source: 'home_banner', target, from_version: update.fromVersion, from_build: update.fromBuild });
    }
  }, [focused, update]);
  if (!focused || update?.kind !== 'optional') return null;
  const open = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setFailed(false);
    try { setFailed(!await openTrackedUpdate(update, useUserStore.getState().currentUser?.id ?? null, 'home_banner')); }
    catch (caughtErrorf6c0f13fd8) {
    observeCaughtError(caughtErrorf6c0f13fd8, {"source":"src/components/UpdateBanner.tsx","handler":"open","site":"UpdateBanner:f6c0f13fd8"}); setFailed(true); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <Animated.View entering={enterFromTop} style={styles.card} testID="store-update-banner">
    <View style={styles.watermark} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox="0 0 160 140" accessible={false}>
        <Rect x={14} y={10} width={110} height={122} rx={2} fill="none" stroke="#A8C7E5" strokeWidth={1.2}/>
        <Line x1={14} x2={124} y1={71} y2={71} stroke="#A8C7E5"/>
        <Circle cx={69} cy={71} r={18} fill="none" stroke="#A8C7E5"/>
        <Rect x={39} y={10} width={60} height={25} fill="none" stroke="#A8C7E5"/>
        <Rect x={39} y={107} width={60} height={25} fill="none" stroke="#A8C7E5"/>
      </Svg>
    </View>
    <View style={styles.heading}>
      <Ionicons name="download-outline" size={26} color="#2380E8" style={styles.download} accessible={false}/>
      <View style={styles.copy}>
        <Text style={styles.title}>{he.updateOptionalTitle}</Text>
        <Text style={styles.body}>{he.updateOptionalBody}</Text>
      </View>
      <Pressable onPress={dismissStoreUpdate} disabled={busy} hitSlop={6} style={styles.close} accessibilityRole="button" accessibilityLabel={he.updateDismiss}>
        <Ionicons name="close" size={19} color="#838C9C"/>
      </Pressable>
    </View>
    <View style={styles.actions}>
      <Pressable onPress={dismissStoreUpdate} disabled={busy} style={styles.later} accessibilityRole="button">
        <Text style={styles.laterText}>{he.updateLater}</Text>
      </Pressable>
      <Pressable onPress={open} disabled={busy} hitSlop={{ top: 7, bottom: 7 }} style={styles.updateButton} accessibilityRole="button" accessibilityLabel={he.updateNow} accessibilityState={{ busy, disabled: busy }}>
        {busy ? <ActivityIndicator color="#FFFFFF" size="small"/> : <Text style={styles.buttonText}>{he.updateNow}</Text>}
      </Pressable>
    </View>
    {failed ? <Text accessibilityRole="alert" style={styles.error}>{he.updateStoreFailed}</Text> : null}
  </Animated.View>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 15, marginTop: 7, paddingTop: 15, paddingHorizontal: 13, paddingBottom: 1, minHeight: 102, borderRadius: 20, backgroundColor: '#F5F8FF', borderWidth: 1, borderColor: '#C8EDFF', shadowColor: '#67C7FF', shadowOpacity: 0.24, shadowRadius: 9, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  watermark: { position: 'absolute', right: 25, top: -13, width: 124, height: 110, opacity: 0.08, transform: [{ rotate: '27deg' }], overflow: 'hidden' },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  download: { marginTop: 3 },
  copy: { flex: 1 },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '900', color: '#15244F', textAlign: RTL_LABEL_ALIGN, writingDirection: 'auto' },
  body: { marginTop: 1, fontSize: 13, lineHeight: 19, color: '#92969D', textAlign: RTL_LABEL_ALIGN, writingDirection: 'auto' },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginTop: -8, marginLeft: -7 },
  actions: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 9, marginTop: 1 },
  later: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' },
  laterText: { color: '#397BCF', fontSize: 14, textAlign: 'center' },
  updateButton: { minWidth: 96, minHeight: 30, paddingHorizontal: 21, paddingVertical: 4, borderRadius: 22, backgroundColor: '#0866FF', alignItems: 'center', justifyContent: 'center', marginVertical: 7 },
  buttonText: { fontSize: 14, lineHeight: 22, fontWeight: '700', color: '#FFFFFF', textAlign: 'center' },
  error: { fontSize: 12, color: '#A42B3A', textAlign: RTL_LABEL_ALIGN, writingDirection: 'auto', paddingBottom: 9 },
});
