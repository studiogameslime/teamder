// FilterRadiusMap — compact, NON-interactive MapLibre map for the games
// filter's "קרוב אליי" card. Draws a translucent radius circle around the
// viewer's location and auto-fits it, so the chosen km reads visually as
// an area. Same keyless OpenFreeMap basemap as AvailabilityRadiusMap, but
// stripped of all gestures (it sits inside a ScrollView and must never
// steal the scroll) — the radius is driven by the slider, not the map.

import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { colors, radius as rad } from '@/theme';

interface Props {
  center: { lat: number; lng: number };
  radiusKm: number;
  size?: number;
  /** Tap → open the big, readable map. Adds an expand affordance. */
  onPress?: () => void;
}

export function FilterRadiusMap({ center, radiusKm, size = 132, onPress }: Props) {
  const ref = useRef<WebView>(null);
  const initial = useRef({ center, radiusKm });
  const html = useMemo(
    () => buildHtml(initial.current.center, initial.current.radiusKm),
    [],
  );

  // Redraw + refit the circle whenever the radius changes — no reload.
  useEffect(() => {
    ref.current?.injectJavaScript(
      `window.setRadius && window.setRadius(${radiusKm}); true;`,
    );
  }, [radiusKm]);

  useEffect(() => {
    ref.current?.injectJavaScript(
      `window.setCenter && window.setCenter(${center.lat}, ${center.lng}); true;`,
    );
  }, [center.lat, center.lng]);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.card, { width: size, height: size }]}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      {/* WebView ignores touches so the Pressable above receives the tap. */}
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html }}
        style={styles.web}
        javaScriptEnabled
        domStorageEnabled
        androidLayerType="hardware"
        setSupportMultipleWindows={false}
        scrollEnabled={false}
        pointerEvents="none"
      />
      {onPress ? (
        <View style={styles.expandBadge} pointerEvents="none">
          <Ionicons name="expand" size={13} color="#FFFFFF" />
        </View>
      ) : null}
    </Pressable>
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
    .ballpin .ball {
      width: 26px; height: 26px; border-radius: 50%;
      background: #2563EB; border: 3px solid #fff;
      box-shadow: 0 2px 6px rgba(37,99,235,.45);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; line-height: 1;
    }
    .maplibregl-ctrl-attrib, .maplibregl-ctrl-bottom-right { display: none; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <script>
    (function () {
      var state = { lat: ${center.lat}, lng: ${center.lng}, km: ${radiusKm} };
      var map = new maplibregl.Map({
        container: 'map',
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [state.lng, state.lat],
        zoom: 11,
        interactive: false,
        attributionControl: false
      });
      function circlePolygon(lat, lng, km) {
        var pts = [], n = 64;
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
        el.className = 'ballpin';
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
          paint: { 'fill-color': '#2563EB', 'fill-opacity': 0.16 } });
        map.addLayer({ id: 'radius-line', type: 'line', source: 'radius',
          paint: { 'line-color': '#2563EB', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.9 } });
      }
      function fit() {
        var b = bbox(state.lat, state.lng, state.km);
        map.fitBounds(b, { padding: 10, duration: 300, maxZoom: 15 });
      }
      window.setRadius = function (km) { state.km = km; drawCircle(); fit(); };
      window.setCenter = function (lat, lng) {
        state.lat = lat; state.lng = lng; placePin(); drawCircle(); fit();
      };
      map.on('load', function () {
        var ROAD = /(motorway|trunk|primary|secondary|tertiary|_link|road_minor|street|service)/;
        (map.getStyle().layers || []).forEach(function (l) {
          if (l.type === 'line') {
            var id = l.id.toLowerCase();
            if (id.indexOf('rail') > -1) return;
            if (!ROAD.test(id)) return;
            try { map.setPaintProperty(l.id, 'line-color', id.indexOf('casing') > -1 ? '#dcd8d2' : '#ffffff'); } catch (e) {}
          }
          if (l.type === 'symbol' && l.layout) {
            try { map.setLayoutProperty(l.id, 'visibility', 'none'); } catch (e) {}
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
  card: {
    borderRadius: rad.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#eef1f4',
  },
  web: { flex: 1, backgroundColor: '#eef1f4' },
  expandBadge: {
    position: 'absolute',
    top: 6,
    // RTL-aware: `end` = visual LEFT under forceRTL, but the badge reads
    // fine in either top corner. Use `right` (physical) so it's pinned
    // to the corner consistently regardless of layout direction.
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(37,99,235,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
