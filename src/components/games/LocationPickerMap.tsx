// LocationPickerMap — a clean, readable vector map for the location picker.
//
// Why vector (MapLibre GL) and not the raster MapWebView: the owner wants
// the ROAD LINES themselves in blue on an otherwise light/readable map.
// Raster basemaps bake road colour into the tile image, so CSS filters
// can only tint the whole picture (washing it out) — they can't recolour
// just the roads. A vector style lets us repaint the highway layers blue
// directly while leaving land white and labels dark.
//
// Tiles: OpenFreeMap (free, no API key, no billing) — same "nothing to
// configure" spirit as the Carto raster map. Text search remains the
// always-available fallback if the GL map ever fails to load.

import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

interface Props {
  center: { lat: number; lng: number };
  zoom?: number;
  /** The currently-picked point. Moved imperatively (no reload). */
  pin?: { lat: number; lng: number } | null;
  /** Fired with coords on a map tap or pin drag-end. */
  onPick?: (lat: number, lng: number) => void;
  /** When set (and changed), fly the map to this point. */
  focusOn?: { lat: number; lng: number; zoom?: number } | null;
}

export function LocationPickerMap({
  center,
  zoom = 13,
  pin,
  onPick,
  focusOn,
}: Props) {
  const ref = useRef<WebView>(null);
  const html = useMemo(() => buildHtml(center, zoom), [center, zoom]);

  // Fly to a searched result without reloading the map.
  useEffect(() => {
    if (!focusOn) return;
    ref.current?.injectJavaScript(
      `window.flyTo && window.flyTo(${focusOn.lat}, ${focusOn.lng}, ${
        focusOn.zoom ?? 15
      }); true;`,
    );
  }, [focusOn]);

  // Place / move / clear the ball pin imperatively.
  useEffect(() => {
    if (pin) {
      ref.current?.injectJavaScript(
        `window.setPin && window.setPin(${pin.lat}, ${pin.lng}); true;`,
      );
    } else {
      ref.current?.injectJavaScript(`window.clearPin && window.clearPin(); true;`);
    }
  }, [pin?.lat, pin?.lng]);

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
        typeof msg.lng === 'number' &&
        onPick
      ) {
        onPick(msg.lat, msg.lng);
      }
    } catch {
      /* ignore malformed bridge messages */
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

function buildHtml(center: { lat: number; lng: number }, zoom: number): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: #f4f6f8; }
    /* The dropped location — a football, the app's motif. White disc, blue
       ring, soft shadow, with a little stem so it points at the exact spot. */
    .ballpin { width: 38px; height: 46px; cursor: grab; }
    .ballpin .ball {
      width: 34px; height: 34px; border-radius: 50%;
      background: #fff; border: 3px solid #2563EB;
      box-shadow: 0 3px 9px rgba(15,23,42,.35);
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; line-height: 1;
    }
    .ballpin .stem {
      width: 2px; height: 10px; margin: -1px auto 0; background: #2563EB;
      box-shadow: 0 1px 2px rgba(15,23,42,.3);
    }
    .maplibregl-ctrl-attrib { font-size: 9px; }
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
      // Lock panning to Israel.
      var ISRAEL = [[34.10, 29.30], [35.95, 33.45]];
      var map = new maplibregl.Map({
        container: 'map',
        style: 'https://tiles.openfreemap.org/styles/positron',
        center: [${center.lng}, ${center.lat}],
        zoom: ${zoom},
        minZoom: 7,
        maxZoom: 18,
        maxBounds: ISRAEL,
        attributionControl: true
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
      // Pinch-zoom + double-tap zoom on by default in MapLibre.

      // Road colours by hierarchy so the map reads as blue lines WITH
      // depth, not a flat wall of one blue. Motorways strongest, residential
      // streets a lighter blue, casings palest.
      function roadColor(id) {
        if (id.indexOf('casing') > -1) return '#cdddfb';        // outer stroke
        if (id.indexOf('motorway') > -1) return '#1d4ed8';      // highways
        if (id.indexOf('major') > -1) return '#2563EB';         // main roads
        if (id.indexOf('minor') > -1) return '#7aa7f5';         // residential
        if (id.indexOf('path') > -1 || id.indexOf('pier') > -1) return '#aac8fb';
        return '#3b82f6';
      }
      function paintRoadsBlue() {
        var layers = map.getStyle().layers || [];
        layers.forEach(function (l) {
          if (l.type !== 'line') return;
          var id = l.id.toLowerCase();
          if (id.indexOf('highway') === -1 && id.indexOf('motorway') === -1) return;
          try {
            map.setPaintProperty(l.id, 'line-color', roadColor(id));
          } catch (e) {}
        });
      }
      map.on('load', function () {
        paintRoadsBlue();
        send({ type: 'ready' });
      });

      // ── Ball pin + picking ──────────────────────────────────────
      var marker = null;
      function makeEl() {
        var el = document.createElement('div');
        el.className = 'ballpin';
        el.innerHTML = '<div class="ball">⚽</div><div class="stem"></div>';
        return el;
      }
      window.setPin = function (lat, lng) {
        if (!marker) {
          marker = new maplibregl.Marker({ element: makeEl(), draggable: true, anchor: 'bottom' })
            .setLngLat([lng, lat]).addTo(map);
          marker.on('dragend', function () {
            var p = marker.getLngLat();
            send({ type: 'pick', lat: p.lat, lng: p.lng });
          });
        } else {
          marker.setLngLat([lng, lat]);
        }
      };
      window.clearPin = function () {
        if (marker) { marker.remove(); marker = null; }
      };
      window.flyTo = function (lat, lng, z) {
        map.flyTo({ center: [lng, lat], zoom: z || 15 });
      };
      map.on('click', function (e) {
        window.setPin(e.lngLat.lat, e.lngLat.lng);
        send({ type: 'pick', lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
    })();
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#f4f6f8' },
});
