// AvailabilityRadiusMapModal — the big, readable version of the
// availability "search area" map. Opens from the expand badge on the
// inline AvailabilityRadiusMap. Unlike the games-filter modal this one is
// fully INTERACTIVE: the user can drag the ball pin / tap to move their
// search centre AND adjust the radius from the footer slider, all on a
// large map with Hebrew street labels — then close to apply.

import React, { useEffect, useMemo, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { RangeSlider } from '@/components/RangeSlider';
import { buildAvailabilityMapHtml } from './AvailabilityRadiusMap';

interface Props {
  visible: boolean;
  center: { lat: number; lng: number };
  radiusKm: number;
  minKm: number;
  maxKm: number;
  /** City label shown in the header, if known. */
  cityName?: string;
  onClose: () => void;
  onPick: (lat: number, lng: number) => void;
  onRadiusChange: (km: number) => void;
}

const ACCENT = '#2563EB';

export function AvailabilityRadiusMapModal({
  visible,
  center,
  radiusKm,
  minKm,
  maxKm,
  cityName,
  onClose,
  onPick,
  onRadiusChange,
}: Props) {
  const ref = useRef<WebView>(null);
  // Build the HTML once from the values the modal opened with; later
  // updates are injected imperatively so the map never reloads.
  const initial = useRef({ center, radiusKm });
  const html = useMemo(
    () => buildAvailabilityMapHtml(initial.current.center, initial.current.radiusKm),
    [],
  );

  // Re-seed the map with the latest values each time it opens (the pin or
  // radius may have changed on the inline map since it was first built).
  useEffect(() => {
    if (!visible) return;
    ref.current?.injectJavaScript(
      `window.setCenter && window.setCenter(${center.lat}, ${center.lng});` +
        `window.setRadius && window.setRadius(${radiusKm}); true;`,
    );
    // Only on open — subsequent center/radius effects below keep it live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    ref.current?.injectJavaScript(
      `window.setRadius && window.setRadius(${radiusKm}); true;`,
    );
  }, [radiusKm, visible]);

  useEffect(() => {
    if (!visible) return;
    ref.current?.injectJavaScript(
      `window.setCenter && window.setCenter(${center.lat}, ${center.lng}); true;`,
    );
  }, [center.lat, center.lng, visible]);

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as {
        type?: string;
        lat?: number;
        lng?: number;
      };
      if (
        msg.type === 'pick' &&
        typeof msg.lat === 'number' &&
        typeof msg.lng === 'number'
      ) {
        onPick(msg.lat, msg.lng);
      }
    } catch {
      /* ignore malformed bridge messages */
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
    >
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={he.close}
          >
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>{he.availabilityAreaTitle}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {cityName
                ? `${cityName} · ${he.availabilityRangeValue(radiusKm)}`
                : he.availabilityRangeValue(radiusKm)}
            </Text>
          </View>
          <View style={styles.closeBtn} />
        </View>

        <View style={styles.mapWrap}>
          <WebView
            ref={ref}
            originWhitelist={['*']}
            source={{ html }}
            style={styles.web}
            onMessage={handleMessage}
            javaScriptEnabled
            domStorageEnabled
            androidLayerType="hardware"
            setSupportMultipleWindows={false}
          />
          <View style={styles.legend} pointerEvents="none">
            <View style={styles.legendDot} />
            <Text style={styles.legendText}>{he.gameFiltersMyHome}</Text>
          </View>
        </View>

        {/* Radius slider — adjust the search area without leaving the map. */}
        <View style={styles.footer}>
          <View style={styles.rangeHeader}>
            <Text style={styles.rangeLabel}>{he.availabilityRangeTitle}</Text>
            <Text style={styles.rangeValue}>
              {he.availabilityRangeValue(radiusKm)}
            </Text>
          </View>
          <RangeSlider
            min={minKm}
            max={maxKm}
            step={1}
            value={radiusKm}
            onChange={onRadiusChange}
            accent={ACCENT}
          />
          <View style={styles.rangeEnds}>
            <Text style={styles.rangeEndText}>{minKm} ק"מ</Text>
            <Text style={styles.rangeEndText}>{maxKm} ק"מ</Text>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, alignItems: 'center' },
  title: { ...typography.h3, color: colors.text, fontWeight: '800' },
  subtitle: { ...typography.caption, color: colors.textMuted },
  mapWrap: { flex: 1 },
  web: { flex: 1, backgroundColor: '#eef1f4' },
  legend: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: ACCENT,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  legendText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  rangeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  rangeLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  rangeValue: { ...typography.body, color: ACCENT, fontWeight: '800' },
  rangeEnds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  rangeEndText: { ...typography.caption, color: colors.textMuted },
});
