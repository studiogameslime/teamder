// AvailabilityRadiusMap — the "search area" map for the availability screen.
//
// Shows a draggable ball pin at the user's location with a translucent blue
// radius circle around it that grows/shrinks with the chosen km and a "{km}
// ק"מ" pill under the pin. The map auto-fits the circle into view so the
// radius always reads at a glance (matches the mockup).
//
// Same vector basemap (MapLibre GL + OpenFreeMap, no API key) and white-road
// recolour as the game LocationPickerMap, kept self-contained here because
// the circle layer + auto-fit behaviour is specific to this screen.

import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { colors, radius as rad } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  center: { lat: number; lng: number };
  radiusKm: number;
  /** Fired with coords when the user taps the map or drags the pin. */
  onPick?: (lat: number, lng: number) => void;
  /** Tap the expand badge → open the big, readable full-screen map. */
  onExpand?: () => void;
}

export function AvailabilityRadiusMap({ center, radiusKm, onPick, onExpand }: Props) {
  const ref = useRef<WebView>(null);
  // Build the HTML once from the initial center/radius; later updates are
  // injected imperatively so the map never reloads (and never flickers).
  const initial = useRef({ center, radiusKm });
  const html = useMemo(
    () => buildAvailabilityMapHtml(initial.current.center, initial.current.radiusKm),
    [],
  );

  // Redraw + refit the circle whenever the radius changes.
  useEffect(() => {
    ref.current?.injectJavaScript(
      `window.setRadius && window.setRadius(${radiusKm}); true;`,
    );
  }, [radiusKm]);

  // Recenter the pin + circle when the location changes (e.g. seeded from a
  // saved value that resolved after first render).
  useEffect(() => {
    ref.current?.injectJavaScript(
      `window.setCenter && window.setCenter(${center.lat}, ${center.lng}); true;`,
    );
  }, [center.lat, center.lng]);

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
        onPick?.(msg.lat, msg.lng);
      }
    } catch {
      /* ignore malformed bridge messages */
    }
  };

  return (
    <View style={styles.card}>
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
        scrollEnabled={false}
      />
      {/* km pill — the pin is auto-centred after each fit, so a centred
          overlay sits right under the ball. */}
      <View pointerEvents="none" style={styles.pillWrap}>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{radiusKm} ק"מ</Text>
        </View>
      </View>
      {/* Expand → full-screen readable map. A small badge (not the whole
          card) so the map keeps receiving tap/drag to move the pin. */}
      {onExpand ? (
        <Pressable
          onPress={onExpand}
          hitSlop={10}
          style={styles.expandBadge}
          accessibilityRole="button"
          accessibilityLabel={he.availabilityAreaTitle}
        >
          <Ionicons name="expand" size={15} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </View>
  );
}

export function buildAvailabilityMapHtml(
  center: { lat: number; lng: number },
  radiusKm: number,
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: #eef1f4; }
    .ballpin { width: 40px; height: 50px; }
    .ballpin .ball {
      width: 38px; height: 38px; border-radius: 50%;
      background: #2563EB; border: 3px solid #fff;
      box-shadow: 0 4px 12px rgba(37,99,235,.45);
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; line-height: 1;
    }
    .ballpin .stem {
      width: 0; height: 0; margin: -3px auto 0;
      border-left: 7px solid transparent;
      border-right: 7px solid transparent;
      border-top: 11px solid #2563EB;
      filter: drop-shadow(0 2px 2px rgba(37,99,235,.35));
    }
    .maplibregl-ctrl-attrib, .maplibregl-ctrl-bottom-right { display: none; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <script>
    (function () {
      function send(p) {
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(p));
      }
      try {
        maplibregl.setRTLTextPlugin(
          'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js',
          function () {}, false
        );
      } catch (e) {}

      var ISRAEL = [[34.10, 29.30], [35.95, 33.45]];
      var state = { lat: ${center.lat}, lng: ${center.lng}, km: ${radiusKm} };
      var map = new maplibregl.Map({
        container: 'map',
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [state.lng, state.lat],
        zoom: 11,
        minZoom: 7, maxZoom: 18,
        maxBounds: ISRAEL,
        attributionControl: false
      });

      // Build a geodesic circle polygon (64 points) around lat/lng.
      function circlePolygon(lat, lng, km) {
        var pts = [], n = 64;
        var dLat = km / 110.574; // deg latitude per km
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
      function makeEl() {
        var el = document.createElement('div');
        el.className = 'ballpin';
        el.innerHTML = '<div class="ball">⚽</div><div class="stem"></div>';
        return el;
      }
      function placePin() {
        if (!marker) {
          marker = new maplibregl.Marker({ element: makeEl(), draggable: true, anchor: 'bottom' })
            .setLngLat([state.lng, state.lat]).addTo(map);
          marker.on('dragend', function () {
            var p = marker.getLngLat();
            state.lat = p.lat; state.lng = p.lng;
            drawCircle(); fit();
            send({ type: 'pick', lat: p.lat, lng: p.lng });
          });
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
        // Tight fit so the map ZOOM tracks the radius: a small radius
        // zooms in to a neighbourhood (circle fills the map), a large one
        // zooms out to a region. This is what makes "5 km" actually read
        // as a small area instead of a city-spanning one.
        var b = bbox(state.lat, state.lng, state.km);
        map.fitBounds(b, { padding: 14, duration: 350, maxZoom: 16 });
      }

      window.setRadius = function (km) { state.km = km; drawCircle(); fit(); };
      window.setCenter = function (lat, lng) {
        state.lat = lat; state.lng = lng; placePin(); drawCircle(); fit();
      };

      map.on('load', function () {
        try { map.setLayoutProperty('building-3d', 'visibility', 'none'); } catch (e) {}
        try {
          map.setPaintProperty('building', 'fill-color', '#ece9e4');
          map.setPaintProperty('building', 'fill-opacity', 0.5);
        } catch (e) {}
        var ROAD = /(motorway|trunk|primary|secondary|tertiary|_link|road_minor|street|service|track|path|road_)/;
        (map.getStyle().layers || []).forEach(function (l) {
          if (l.type !== 'line') return;
          var id = l.id.toLowerCase();
          if (id.indexOf('rail') > -1 || id.indexOf('transit') > -1) return;
          if (!ROAD.test(id)) return;
          try { map.setPaintProperty(l.id, 'line-color', id.indexOf('casing') > -1 ? '#dcd8d2' : '#ffffff'); } catch (e) {}
        });
        var heField = ['coalesce', ['get', 'name:he'], ['get', 'name:hebrew'], ['get', 'name']];
        (map.getStyle().layers || []).forEach(function (l) {
          if (l.type === 'symbol' && l.layout) {
            // Hebrew text for any labelled symbol…
            if (l.layout['text-field']) {
              try { map.setLayoutProperty(l.id, 'text-field', heField); } catch (e) {}
            }
            // …and hide POI / shield ICONS (which render as broken white
            // squares when the style's sprite doesn't load in the WebView)
            // while keeping any text label on the same layer.
            if (l.layout['icon-image']) {
              try { map.setPaintProperty(l.id, 'icon-opacity', 0); } catch (e) {}
            }
          }
        });
        placePin(); drawCircle(); fit();
      });

      // Tap to move the location.
      map.on('click', function (e) {
        state.lat = e.lngLat.lat; state.lng = e.lngLat.lng;
        placePin(); drawCircle(); fit();
        send({ type: 'pick', lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
    })();
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  card: {
    height: 230,
    borderRadius: rad.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#eef1f4',
  },
  web: { flex: 1, backgroundColor: '#eef1f4' },
  pillWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    marginTop: 30,
    backgroundColor: colors.primary,
    borderRadius: rad.md,
    paddingHorizontal: 12,
    paddingVertical: 5,
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  expandBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(37,99,235,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
});
