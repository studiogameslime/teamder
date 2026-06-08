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
    /* The dropped location — a football, the app's motif. White disc, green
       ring (matches the mockup), soft shadow, with a little stem so it
       points at the exact spot. */
    .ballpin { width: 40px; height: 48px; cursor: grab; }
    .ballpin .ball {
      width: 36px; height: 36px; border-radius: 50%;
      background: #fff; border: 3px solid #16A34A;
      box-shadow: 0 3px 10px rgba(15,23,42,.35);
      display: flex; align-items: center; justify-content: center;
      font-size: 21px; line-height: 1;
    }
    .ballpin .stem {
      width: 0; height: 0; margin: -2px auto 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 9px solid #16A34A;
      filter: drop-shadow(0 1px 1px rgba(15,23,42,.3));
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
      // RTL text shaping — without this MapLibre renders Hebrew/Arabic
      // labels reversed ("ופי-ביבא לת" instead of "תל-אביב-יפו"). Must be
      // set before the map renders labels. (lazy=false → load immediately
      // so the very first frame is shaped correctly.)
      try {
        maplibregl.setRTLTextPlugin(
          'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js',
          function () {},
          false
        );
      } catch (e) {}
      // Lock panning to Israel.
      var ISRAEL = [[34.10, 29.30], [35.95, 33.45]];
      var map = new maplibregl.Map({
        container: 'map',
        // 'liberty' = full-colour OSM style: green parks, light roads with
        // soft casing, blue water, POI icons + route shields — the clean,
        // readable Google-Maps-like look the owner asked for.
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [${center.lng}, ${center.lat}],
        zoom: ${zoom},
        minZoom: 7,
        maxZoom: 18,
        maxBounds: ISRAEL,
        attributionControl: true
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      // Pinch-zoom + double-tap zoom on by default in MapLibre.

      map.on('load', function () {
        // Flatten the map to the clean mockup look: drop the 3D building
        // extrusion and soften the flat building footprints (they read as
        // a busy grey mass otherwise) so parks/roads/water stand out.
        try { map.setLayoutProperty('building-3d', 'visibility', 'none'); } catch (e) {}
        try {
          map.setPaintProperty('building', 'fill-color', '#ece9e4');
          map.setPaintProperty('building', 'fill-opacity', 0.55);
          map.setPaintProperty('building', 'fill-outline-color', '#e2ded8');
        } catch (e) {}
        // Keep the rest of the style's natural colours — a clean light map
        // with green parks and soft road lines. No road recolouring.
        // Labels → Hebrew: prefer name:he, fall back to the default name.
        var heField = ['coalesce', ['get', 'name:he'], ['get', 'name:hebrew'], ['get', 'name']];
        (map.getStyle().layers || []).forEach(function (l) {
          if (l.type === 'symbol' && l.layout && l.layout['text-field']) {
            try { map.setLayoutProperty(l.id, 'text-field', heField); } catch (e) {}
          }
        });
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
