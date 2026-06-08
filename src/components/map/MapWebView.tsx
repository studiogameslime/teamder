// MapWebView — zero-cost interactive map (NO API key, NO billing, NO Google).
// Leaflet over Carto's free light basemap inside a WebView, tinted blue and
// locked to Israel, with football pins + numbered clusters. Works identically
// on iOS and Android with nothing for the app owner to configure.

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
}: Props) {
  const ref = useRef<WebView>(null);
  // `pickable` changes the baked-in script, so it's a memo dep. `pin` is
  // NOT — it's moved imperatively below so a tap never reloads the map.
  const html = useMemo(
    () => buildHtml(markers, center, zoom, pickable, tintAlpha),
    [markers, center, zoom, pickable, tintAlpha],
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
): string {
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
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: ${
      tintAlpha > 0 ? '#4f93e0' : '#e9eef3'
    }; }
    .leaflet-control-attribution { font-size: 9px; }
    /* Lighten the pale Carto tiles a touch before tinting. */
    .leaflet-tile-pane { filter: brightness(1.05) contrast(1.02); }
    /* Vivid azure wash (like the product mockup). A blue multiply layer sits
       ABOVE the tiles (z-index 450) but BELOW the markers (Leaflet markerPane
       is z-index 600), so the basemap reads saturated blue while pins keep
       their true colours. Decoupling the colour from the tile filter lets us
       dial the blue precisely by changing this one rgba alpha. Hidden
       entirely when tintAlpha is 0 (the location picker wants a clean map). */
    #tint {
      position: absolute; inset: 0; z-index: 450;
      background: rgba(37, 99, 235, ${tintAlpha});
      mix-blend-mode: multiply; pointer-events: none;
      display: ${tintAlpha > 0 ? 'block' : 'none'};
    }
    .tpin {
      width: 36px; height: 36px; background: #fff;
      border-radius: 50%; box-shadow: 0 2px 7px rgba(15,23,42,.32);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; line-height: 1; position: relative;
    }
    .tpin .badge {
      position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px;
      background: #2563EB; color: #fff; border: 2px solid #fff; border-radius: 9px;
      font-size: 11px; font-weight: 700; line-height: 14px; text-align: center;
      padding: 0 3px; font-family: -apple-system, system-ui, sans-serif;
    }
    /* Picker pin — a red teardrop so it reads as "the spot you chose",
       distinct from the white football pins. */
    .ppin {
      width: 30px; height: 30px; background: #EF4444;
      border: 3px solid #fff; border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      box-shadow: 0 3px 8px rgba(15,23,42,.4);
    }
  </style>
</head>
<body>
  <div id="map"><div id="tint"></div></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
  <script>
    (function () {
      // Lock the map to Israel — users can't pan/zoom away to other places.
      var ISRAEL = L.latLngBounds([29.30, 34.10], [33.45, 35.95]);
      var map = L.map('map', {
        zoomControl: true,
        attributionControl: true,
        maxBounds: ISRAEL,
        maxBoundsViscosity: 1.0,
        minZoom: 7,
        maxZoom: 18,
        // Explicitly enable every zoom gesture so pinch-to-zoom works
        // inside the WebView (page pinch is disabled via the viewport
        // meta; these are Leaflet's own touch handlers).
        touchZoom: true,
        bounceAtZoomLimits: true,
        doubleClickZoom: true,
        scrollWheelZoom: true,
        tap: true
      }).setView([${center.lat}, ${center.lng}], ${zoom});
      window.tmap = map; // exposed so RN can fly-to via injectJavaScript

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd', maxZoom: 20, bounds: ISRAEL,
        attribution: '&copy; OpenStreetMap, &copy; CARTO'
      }).addTo(map);

      function disc(ring, badge) {
        var b = badge ? '<span class="badge">' + badge + '</span>' : '';
        return '<div class="tpin" style="border:3px solid ' + ring + '">⚽' + b + '</div>';
      }
      function pinIcon(color) {
        return L.divIcon({ className: '', html: disc(color), iconSize: [36, 36], iconAnchor: [18, 18] });
      }

      function send(payload) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      }

      var markers = ${markersJson};
      var cluster = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 45,
        iconCreateFunction: function (c) {
          return L.divIcon({
            className: '',
            html: disc('#2563EB', String(c.getChildCount())),
            iconSize: [36, 36], iconAnchor: [18, 18]
          });
        }
      });
      var bounds = [];
      markers.forEach(function (m) {
        var mk = L.marker([m.lat, m.lng], { icon: pinIcon(m.color) });
        mk.on('click', function () { send({ type: 'markerPress', id: m.id }); });
        cluster.addLayer(mk);
        bounds.push([m.lat, m.lng]);
      });
      map.addLayer(cluster);
      if (bounds.length > 1) {
        try { map.fitBounds(bounds, { padding: [55, 80], maxZoom: 13 }); } catch (e) {}
      }

      // ── Picker mode ──────────────────────────────────────────────
      // A single draggable red pin the organiser places by tapping the
      // map. Tapping or dragging reports coords back to RN; RN also
      // drives the pin position via setPickPin (e.g. after a text search).
      if (${pickable ? 'true' : 'false'}) {
        var pickIcon = L.divIcon({ className: '', html: '<div class="ppin"></div>', iconSize: [30, 30], iconAnchor: [15, 28] });
        window.setPickPin = function (lat, lng) {
          if (!window.pickMarker) {
            window.pickMarker = L.marker([lat, lng], { icon: pickIcon, draggable: true }).addTo(map);
            window.pickMarker.on('dragend', function (e) {
              var p = e.target.getLatLng();
              send({ type: 'mapPress', lat: p.lat, lng: p.lng });
            });
          } else {
            window.pickMarker.setLatLng([lat, lng]);
          }
        };
        window.clearPickPin = function () {
          if (window.pickMarker) { map.removeLayer(window.pickMarker); window.pickMarker = null; }
        };
        map.on('click', function (e) {
          window.setPickPin(e.latlng.lat, e.latlng.lng);
          send({ type: 'mapPress', lat: e.latlng.lat, lng: e.latlng.lng });
        });
      }
    })();
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#bcdcf5' },
});
