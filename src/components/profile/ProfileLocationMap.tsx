// ProfileLocationMap — small, NON-interactive circular map for the
// profile availability card. Reuses the same keyless MapLibre GL +
// OpenFreeMap basemap as AvailabilityRadiusMap, but stripped down: no
// drag, no tap, no radius layer — just the user's home location under a
// ball pin, recoloured to the soft white-road look so it reads as a
// pretty decorative disc (matching the mockup's centre map).
//
// `interactive: false` disables every map gesture, and the WebView sits
// under `pointerEvents="none"` so taps fall through to the card's
// onEdit handler instead of being swallowed by the map.

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

interface Props {
  lat: number;
  lng: number;
  /** Diameter of the circle in px. */
  size?: number;
}

export function ProfileLocationMap({ lat, lng, size = 96 }: Props) {
  // Build the HTML once — this map never changes after mount (the card
  // re-renders on focus, but the coords are stable within a session).
  const html = useMemo(() => buildHtml(lat, lng), [lat, lng]);
  const dim = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View style={[styles.ring, dim]} pointerEvents="none">
      <WebView
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
    </View>
  );
}

function buildHtml(lat: number, lng: number): string {
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
      box-shadow: 0 3px 8px rgba(37,99,235,.45);
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
      var map = new maplibregl.Map({
        container: 'map',
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [${lng}, ${lat}],
        zoom: 12.5,
        interactive: false,
        attributionControl: false
      });
      map.on('load', function () {
        try { map.setLayoutProperty('building-3d', 'visibility', 'none'); } catch (e) {}
        try {
          map.setPaintProperty('building', 'fill-color', '#ece9e4');
          map.setPaintProperty('building', 'fill-opacity', 0.5);
        } catch (e) {}
        var ROAD = /(motorway|trunk|primary|secondary|tertiary|_link|road_minor|street|service|track|path|road_)/;
        (map.getStyle().layers || []).forEach(function (l) {
          if (l.type === 'line') {
            var id = l.id.toLowerCase();
            if (id.indexOf('rail') > -1 || id.indexOf('transit') > -1) return;
            if (!ROAD.test(id)) return;
            try { map.setPaintProperty(l.id, 'line-color', id.indexOf('casing') > -1 ? '#dcd8d2' : '#ffffff'); } catch (e) {}
          }
          // Hide ALL text + icon labels — at 96px a label would just be
          // visual noise (and POI sprites render as broken squares).
          if (l.type === 'symbol' && l.layout) {
            try { map.setLayoutProperty(l.id, 'visibility', 'none'); } catch (e) {}
          }
        });
        var el = document.createElement('div');
        el.className = 'ballpin';
        el.innerHTML = '<div class="ball">⚽</div>';
        new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([${lng}, ${lat}]).addTo(map);
      });
    })();
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  ring: {
    overflow: 'hidden',
    backgroundColor: '#eef1f4',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    // Soft lift so the disc reads as a raised medallion in the card.
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 3,
  },
  web: { flex: 1, backgroundColor: '#eef1f4' },
});
