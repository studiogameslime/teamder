// MapWebView — zero-cost interactive map (NO API key, NO billing, NO Google).
// MapLibre GL JS over the OpenFreeMap "liberty" vector style inside a WebView,
// locked to Israel, with date-coloured football points + numbered clusters.
// Uses the SAME basemap + palette as the availability "search area" map
// (liberty tiles, beige buildings, white roads, #2563EB accent) so all the
// app's maps look identical. Works on iOS + Android with nothing to configure.

import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  color?: string;
}

interface Props {
  markers: MapMarker[];
  center: { lat: number; lng: number };
  zoom?: number;
  onMarkerPress?: (id: string) => void;
  /** When set (and changed), fly the map to this point. Used by the
   *  "focus on my city" button without reloading the whole map. */
  focusOn?: { lat: number; lng: number; zoom?: number } | null;
  /** Picker mode: tapping the map (or dragging the pin) drops a single
   *  pin and reports its coords via `onPick`. Used by the location
   *  search sheet so the organiser can place a pitch that isn't in the
   *  search index — guaranteeing every game still gets real coords. */
  pickable?: boolean;
  /** The currently-picked point in `pickable` mode. Moved without a full
   *  map reload (via injectJavaScript) so tapping doesn't reset zoom/pan. */
  pin?: { lat: number; lng: number } | null;
  /** Fired with the picked coords on a map tap or pin drag-end. */
  onPick?: (lat: number, lng: number) => void;
  /** Strength of the blue brand wash over the basemap (0–1). The games
   *  map keeps the vivid default; the location picker passes 0 for a
   *  clean, readable map. */
  tintAlpha?: number;
  /** Glyph drawn inside each single pin — '⚽' for the games map, '👥'
   *  for the communities map. Rendered to a canvas image (so the emoji
   *  shows even though the vector style's fonts have no emoji glyphs). */
  pinEmoji?: string;
}

export function MapWebView({
  markers,
  center,
  zoom = 11,
  onMarkerPress,
  focusOn,
  pickable = false,
  pin,
  onPick,
  tintAlpha = 0.42,
  pinEmoji = '⚽',
}: Props) {
  const ref = useRef<WebView>(null);
  // `pickable` changes the baked-in script, so it's a memo dep. `pin` is
  // NOT — it's moved imperatively below so a tap never reloads the map.
  const html = useMemo(
    () => buildHtml(markers, center, zoom, pickable, tintAlpha, pinEmoji),
    [markers, center, zoom, pickable, tintAlpha, pinEmoji],
  );

  // Smoothly recenter without a full reload when `focusOn` changes.
  useEffect(() => {
    if (!focusOn) return;
    ref.current?.injectJavaScript(
      `window.tmap && window.tmap.flyTo([${focusOn.lat}, ${focusOn.lng}], ${
        focusOn.zoom ?? 13
      }); true;`,
    );
  }, [focusOn]);

  // Place / move the picker pin imperatively (no reload). Clearing it
  // (pin → null) removes the marker.
  useEffect(() => {
    if (!pickable) return;
    if (pin) {
      ref.current?.injectJavaScript(
        `window.setPickPin && window.setPickPin(${pin.lat}, ${pin.lng}); true;`,
      );
    } else {
      ref.current?.injectJavaScript(
        `window.clearPickPin && window.clearPickPin(); true;`,
      );
    }
  }, [pickable, pin?.lat, pin?.lng]);

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as {
        type?: string;
        id?: string;
        lat?: number;
        lng?: number;
      };
      if (msg.type === 'markerPress' && msg.id && onMarkerPress) {
        onMarkerPress(msg.id);
      } else if (
        msg.type === 'mapPress' &&
        typeof msg.lat === 'number' &&
        typeof msg.lng === 'number' &&
        onPick
      ) {
        onPick(msg.lat, msg.lng);
      }
    } catch {
      // Ignore malformed bridge messages.
    }
  };

  return (
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
  );
}

function buildHtml(
  markers: MapMarker[],
  center: { lat: number; lng: number },
  zoom: number,
  pickable: boolean,
  tintAlpha: number,
  pinEmoji: string,
): string {
  // tintAlpha is accepted for API compatibility but no longer used — the
  // liberty basemap has its own (untinted) look shared with the other maps.
  void tintAlpha;
  const markersJson = JSON.stringify(
    markers.map((m) => ({
      id: m.id,
      lat: m.lat,
      lng: m.lng,
      color: m.color ?? '#2563EB',
    })),
  );
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: #eef1f4; }
    .maplibregl-ctrl-attrib { font-size: 9px; }
    /* Picker pin — a red teardrop so it reads as "the spot you chose". */
    .ppin {
      width: 30px; height: 30px; background: #EF4444;
      border: 3px solid #fff; border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      box-shadow: 0 3px 8px rgba(15,23,42,.4);
    }
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
          null, true);
      } catch (e) {}

      function send(payload) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      }

      // Lock to Israel ([sw],[ne] as lng,lat).
      var ISRAEL = [[34.10, 29.30], [35.95, 33.45]];
      var map = new maplibregl.Map({
        container: 'map',
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [${center.lng}, ${center.lat}],
        zoom: ${zoom},
        minZoom: 7,
        maxZoom: 18,
        maxBounds: ISRAEL,
        attributionControl: false
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
      // RN flies the camera here via injectJavaScript: window.tmap.flyTo([lat,lng], z).
      window.tmap = { flyTo: function (ll, z) { map.flyTo({ center: [ll[1], ll[0]], zoom: z || 13 }); } };

      var markers = ${markersJson};

      map.on('load', function () {
        // Same warm palette as the availability map.
        try { map.setPaintProperty('building', 'fill-color', '#ece9e4'); } catch (e) {}

        map.addSource('pts', {
          type: 'geojson',
          cluster: true, clusterRadius: 45, clusterMaxZoom: 13,
          data: {
            type: 'FeatureCollection',
            features: markers.map(function (m) {
              return { type: 'Feature',
                properties: { id: m.id, color: m.color },
                geometry: { type: 'Point', coordinates: [m.lng, m.lat] } };
            })
          }
        });

        // Clusters — blue accent discs with a white ring + count.
        map.addLayer({ id: 'clusters', type: 'circle', source: 'pts',
          filter: ['has', 'point_count'],
          paint: { 'circle-color': '#2563EB', 'circle-radius': 17,
            'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });
        map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'pts',
          filter: ['has', 'point_count'],
          layout: { 'text-field': '{point_count_abbreviated}',
            'text-font': ['Noto Sans Regular'], 'text-size': 13 },
          paint: { 'text-color': '#ffffff' } });

        // Single points — a white disc with a coloured ring + an emoji glyph
        // (⚽ on the games map, 👥 on the communities map). The emoji is
        // baked to a canvas image because the vector fonts carry no emoji.
        map.addLayer({ id: 'point', type: 'circle', source: 'pts',
          filter: ['!', ['has', 'point_count']],
          paint: { 'circle-color': '#ffffff', 'circle-radius': 15,
            'circle-stroke-width': 3, 'circle-stroke-color': ['get', 'color'] } });
        try {
          var s = 64, cv = document.createElement('canvas'); cv.width = s; cv.height = s;
          var cx = cv.getContext('2d');
          cx.font = '44px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
          cx.fillText('${pinEmoji}', s / 2, s / 2 + 2);
          if (!map.hasImage('pin')) map.addImage('pin', cx.getImageData(0, 0, s, s), { pixelRatio: 2 });
          map.addLayer({ id: 'point-icon', type: 'symbol', source: 'pts',
            filter: ['!', ['has', 'point_count']],
            layout: { 'icon-image': 'pin', 'icon-size': 0.55,
              'icon-allow-overlap': true, 'icon-ignore-placement': true } });
        } catch (e) {}

        if (markers.length > 1) {
          var b = new maplibregl.LngLatBounds();
          markers.forEach(function (m) { b.extend([m.lng, m.lat]); });
          try { map.fitBounds(b, { padding: 60, maxZoom: 13, duration: 0 }); } catch (e) {}
        }

        map.on('click', 'point', function (e) {
          var f = e.features && e.features[0];
          if (f) send({ type: 'markerPress', id: f.properties.id });
        });
        map.on('click', 'clusters', function (e) {
          var f = e.features && e.features[0];
          if (!f) return;
          map.getSource('pts').getClusterExpansionZoom(f.properties.cluster_id, function (err, z) {
            if (err) return;
            map.easeTo({ center: f.geometry.coordinates, zoom: z });
          });
        });
        ['point', 'clusters'].forEach(function (l) {
          map.on('mouseenter', l, function () { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', l, function () { map.getCanvas().style.cursor = ''; });
        });
      });

      // ── Picker mode — a single draggable red pin. ─────────────────
      if (${pickable ? 'true' : 'false'}) {
        window.setPickPin = function (lat, lng) {
          if (!window.pickMarker) {
            var el = document.createElement('div'); el.className = 'ppin';
            window.pickMarker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' })
              .setLngLat([lng, lat]).addTo(map);
            window.pickMarker.on('dragend', function () {
              var p = window.pickMarker.getLngLat();
              send({ type: 'mapPress', lat: p.lat, lng: p.lng });
            });
          } else {
            window.pickMarker.setLngLat([lng, lat]);
          }
        };
        window.clearPickPin = function () {
          if (window.pickMarker) { window.pickMarker.remove(); window.pickMarker = null; }
        };
        map.on('click', function (e) {
          window.setPickPin(e.lngLat.lat, e.lngLat.lng);
          send({ type: 'mapPress', lat: e.lngLat.lat, lng: e.lngLat.lng });
        });
      }
    })();
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#eef1f4' },
});
