// RadiusMapModal — the big, readable version of the filter's radius map.
// Opens when the user taps the small preview. Shows their home location
// (🏠 marker) inside the chosen radius circle on a large, zoom/pan-able
// map with Hebrew street labels, so they can actually read where they
// are and how far the search reaches.

import React, { useEffect, useMemo, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  visible: boolean;
  center: { lat: number; lng: number };
  radiusKm: number;
  /** City label shown in the header, if known. */
  cityName?: string;
  onClose: () => void;
}

export function RadiusMapModal({
  visible,
  center,
  radiusKm,
  cityName,
  onClose,
}: Props) {
  const ref = useRef<WebView>(null);
  const initial = useRef({ center, radiusKm });
  const html = useMemo(
    () => buildHtml(initial.current.center, initial.current.radiusKm),
    [],
  );

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
            <Text style={styles.title}>{he.gameFiltersNearbyTitle}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {cityName
                ? `${cityName} · ${he.gameFiltersKm(radiusKm)}`
                : he.gameFiltersKm(radiusKm)}
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
      </SafeAreaView>
    </Modal>
  );
}

function buildHtml(center: { lat: number; lng: number }, radiusKm: number): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: #eef1f4; }
    .homepin .ball {
      width: 40px; height: 40px; border-radius: 50%;
      background: #2563EB; border: 3px solid #fff;
      box-shadow: 0 4px 12px rgba(37,99,235,.45);
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; line-height: 1;
    }
    .maplibregl-ctrl-attrib { display: none; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <script>
    (function () {
      try {
        maplibregl.setRTLTextPlugin(
          'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js',
          function () {}, false
        );
      } catch (e) {}
      var state = { lat: ${center.lat}, lng: ${center.lng}, km: ${radiusKm} };
      var map = new maplibregl.Map({
        container: 'map',
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [state.lng, state.lat],
        zoom: 12,
        attributionControl: false
      });
      function circlePolygon(lat, lng, km) {
        var pts = [], n = 72;
        var dLat = km / 110.574;
        var dLng = km / (111.320 * Math.cos(lat * Math.PI / 180));
        for (var i = 0; i <= n; i++) {
          var a = (i / n) * 2 * Math.PI;
          pts.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
        }
        return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } };
      }
      function bbox(lat, lng, km) {
        var dLat = km / 110.574;
        var dLng = km / (111.320 * Math.cos(lat * Math.PI / 180));
        return [[lng - dLng, lat - dLat], [lng + dLng, lat + dLat]];
      }
      var marker = null;
      function placePin() {
        var el = document.createElement('div');
        el.className = 'homepin';
        el.innerHTML = '<div class="ball">🏠</div>';
        if (!marker) {
          marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([state.lng, state.lat]).addTo(map);
        } else {
          marker.setLngLat([state.lng, state.lat]);
        }
      }
      function drawCircle() {
        var data = circlePolygon(state.lat, state.lng, state.km);
        var src = map.getSource('radius');
        if (src) { src.setData(data); return; }
        map.addSource('radius', { type: 'geojson', data: data });
        map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius',
          paint: { 'fill-color': '#2563EB', 'fill-opacity': 0.14 } });
        map.addLayer({ id: 'radius-line', type: 'line', source: 'radius',
          paint: { 'line-color': '#2563EB', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.9 } });
      }
      function fit() {
        var b = bbox(state.lat, state.lng, state.km);
        map.fitBounds(b, { padding: 60, duration: 350, maxZoom: 16 });
      }
      window.setRadius = function (km) { state.km = km; drawCircle(); fit(); };
      window.setCenter = function (lat, lng) {
        state.lat = lat; state.lng = lng; placePin(); drawCircle(); fit();
      };
      map.on('load', function () {
        var heField = ['coalesce', ['get', 'name:he'], ['get', 'name:hebrew'], ['get', 'name']];
        (map.getStyle().layers || []).forEach(function (l) {
          if (l.type === 'symbol' && l.layout) {
            if (l.layout['text-field']) {
              try { map.setLayoutProperty(l.id, 'text-field', heField); } catch (e) {}
            }
            // Hide broken POI/shield icons (sprite often fails in WebView)
            // but keep the text labels for readability.
            if (l.layout['icon-image']) {
              try { map.setPaintProperty(l.id, 'icon-opacity', 0); } catch (e) {}
            }
          }
        });
        placePin(); drawCircle(); fit();
      });
    })();
  </script>
</body>
</html>`;
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
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  legendText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
});
