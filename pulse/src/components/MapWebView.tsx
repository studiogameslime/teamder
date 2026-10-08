// MapWebView — zero-cost interactive map (NO API key, NO billing). MapLibre GL
// JS over the OpenFreeMap "liberty" vector style inside a WebView, locked to
// Israel, with numbered clusters. Ported from the Teamder app so Pulse's maps
// match the app's. Works with nothing to configure beyond react-native-webview.

import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  /** Ring (stroke) colour. */
  color?: string;
  /** Disc fill colour. Defaults to white. */
  fill?: string;
}

interface Props {
  markers: MapMarker[];
  center: { lat: number; lng: number };
  zoom?: number;
  onMarkerPress?: (id: string) => void;
  /** Fired when a numbered cluster is tapped, with the ids of every marker
   *  inside it — lets the host show a "these N are here" list. */
  onClusterPress?: (ids: string[]) => void;
  /** When set (and changed), fly the map to this point without a reload. */
  focusOn?: { lat: number; lng: number; zoom?: number } | null;
  /** Glyph drawn inside each single pin. */
  pinEmoji?: string;
}

export function MapWebView({
  markers,
  center,
  zoom = 8,
  onMarkerPress,
  onClusterPress,
  focusOn,
  pinEmoji = '📍',
}: Props) {
  const ref = useRef<WebView>(null);
  const html = useMemo(
    () => buildHtml(markers, center, zoom, pinEmoji),
    [markers, center, zoom, pinEmoji],
  );

  useEffect(() => {
    if (!focusOn) return;
    ref.current?.injectJavaScript(
      `window.tmap && window.tmap.flyTo([${focusOn.lat}, ${focusOn.lng}], ${
        focusOn.zoom ?? 14
      }); true;`,
    );
  }, [focusOn]);

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as {
        type?: string;
        id?: string;
        ids?: string[];
      };
      if (msg.type === 'markerPress' && msg.id && onMarkerPress) {
        onMarkerPress(msg.id);
      } else if (
        msg.type === 'clusterPress' &&
        Array.isArray(msg.ids) &&
        onClusterPress
      ) {
        onClusterPress(msg.ids);
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
  pinEmoji: string,
): string {
  const markersJson = JSON.stringify(
    markers.map((m) => ({
      id: m.id,
      lat: m.lat,
      lng: m.lng,
      color: m.color ?? '#EF4444',
      fill: m.fill ?? '#ffffff',
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

      var ISRAEL = [[34.10, 29.30], [35.95, 33.45]];
      var map = new maplibregl.Map({
        container: 'map',
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [${center.lng}, ${center.lat}],
        zoom: ${zoom},
        minZoom: 6,
        maxZoom: 18,
        maxBounds: ISRAEL,
        attributionControl: false
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
      window.tmap = { flyTo: function (ll, z) { map.flyTo({ center: [ll[1], ll[0]], zoom: z || 14 }); } };

      var markers = ${markersJson};

      map.on('load', function () {
        try { map.setPaintProperty('building', 'fill-color', '#ece9e4'); } catch (e) {}

        map.addSource('pts', {
          type: 'geojson',
          cluster: true, clusterRadius: 45, clusterMaxZoom: 14,
          data: {
            type: 'FeatureCollection',
            features: markers.map(function (m) {
              return { type: 'Feature',
                properties: { id: m.id, color: m.color, fill: m.fill },
                geometry: { type: 'Point', coordinates: [m.lng, m.lat] } };
            })
          }
        });

        map.addLayer({ id: 'clusters', type: 'circle', source: 'pts',
          filter: ['has', 'point_count'],
          paint: { 'circle-color': '#EF4444', 'circle-radius': 17,
            'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });
        map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'pts',
          filter: ['has', 'point_count'],
          layout: { 'text-field': '{point_count_abbreviated}',
            'text-font': ['Noto Sans Regular'], 'text-size': 13 },
          paint: { 'text-color': '#ffffff' } });

        map.addLayer({ id: 'point', type: 'circle', source: 'pts',
          filter: ['!', ['has', 'point_count']],
          paint: { 'circle-color': ['get', 'fill'], 'circle-radius': 14,
            'circle-stroke-width': 3, 'circle-stroke-color': ['get', 'color'] } });
        ${pinEmoji
          ? `try {
          var s = 64, cv = document.createElement('canvas'); cv.width = s; cv.height = s;
          var cx = cv.getContext('2d');
          cx.font = '40px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
          cx.fillText('${pinEmoji}', s / 2, s / 2 + 2);
          if (!map.hasImage('pin')) map.addImage('pin', cx.getImageData(0, 0, s, s), { pixelRatio: 2 });
          map.addLayer({ id: 'point-icon', type: 'symbol', source: 'pts',
            filter: ['!', ['has', 'point_count']],
            layout: { 'icon-image': 'pin', 'icon-size': 0.5,
              'icon-allow-overlap': true, 'icon-ignore-placement': true } });
        } catch (e) {}`
          : ''}

        if (markers.length > 1) {
          var b = new maplibregl.LngLatBounds();
          markers.forEach(function (m) { b.extend([m.lng, m.lat]); });
          try { map.fitBounds(b, { padding: 50, maxZoom: 14, duration: 0 }); } catch (e) {}
        }

        map.on('click', 'point', function (e) {
          var f = e.features && e.features[0];
          if (f) send({ type: 'markerPress', id: f.properties.id });
        });
        map.on('click', 'clusters', function (e) {
          var f = e.features && e.features[0];
          if (!f) return;
          var src = map.getSource('pts');
          var cid = f.properties.cluster_id;
          var count = f.properties.point_count || 100;
          src.getClusterLeaves(cid, count, 0, function (err, leaves) {
            if (err || !leaves) return;
            var ids = leaves.map(function (l) { return l.properties.id; });
            send({ type: 'clusterPress', ids: ids });
          });
        });
        ['point', 'clusters'].forEach(function (l) {
          map.on('mouseenter', l, function () { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', l, function () { map.getCanvas().style.cursor = ''; });
        });
      });
    })();
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#eef1f4' },
});
