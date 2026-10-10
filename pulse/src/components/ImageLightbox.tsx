// Full-screen, pinch-zoomable image viewer.
//
// Every image in Pulse was rendered at 92px and stopped there. That is fine for
// a photo you only need to recognise, and useless for the ones that carry
// READABLE content: a user's bug-report screenshot, and — since Claude started
// attaching proof to what it finishes — a before/after table rendered ~900px
// wide and shown in a thumbnail a tenth of that size. You could see that an
// image was attached and not what it said.
//
// Zoom is done in a WebView rather than a ScrollView because RN's ScrollView
// pinch-zoom (`maximumZoomScale`) is iOS-only — on Android it silently does
// nothing, which is most of where Pulse actually runs. The WebView gives real
// pinch and double-tap zoom on both platforms, and react-native-webview is
// already a dependency (MapWebView), so this adds nothing to the bundle.
//
// The image is passed as a base64 data URI, which is how Pulse stores images
// everywhere (Firestore docs, no Storage bucket) — so there is no network
// fetch and nothing to fail.

import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors, font } from '../theme';

interface Props {
  /** Base64 JPEG WITHOUT the `data:` prefix — Pulse's storage convention. */
  image: string | null;
  onClose: () => void;
  /** Position within the set, when several images were opened together. */
  index?: number;
  total?: number;
  onPrev?: () => void;
  onNext?: () => void;
}

/** Fit-to-width on open, pinch and double-tap to go deeper, pan when zoomed. */
const page = (b64: string) => `<!doctype html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=6,user-scalable=yes">
<style>
  html,body{margin:0;padding:0;height:100%;background:#000;
    display:flex;align-items:center;justify-content:center;-webkit-text-size-adjust:100%}
  img{max-width:100%;max-height:100%;display:block}
</style></head>
<body><img src="data:image/jpeg;base64,${b64}"></body></html>`;

export function ImageLightbox({
  image,
  onClose,
  index,
  total,
  onPrev,
  onNext,
}: Props) {
  const { width, height } = useWindowDimensions();
  const many = typeof total === 'number' && total > 1;

  return (
    <Modal
      visible={image !== null}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={st.root}>
        {image ? (
          <WebView
            // Remount per image, so opening the next one resets the zoom
            // instead of inheriting where the last one was left.
            key={`${index ?? 0}:${image.length}`}
            source={{ html: page(image) }}
            style={{ width, height }}
            containerStyle={{ backgroundColor: '#000' }}
            scalesPageToFit
            originWhitelist={['*']}
            javaScriptEnabled={false}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          />
        ) : null}

        {/* Close sits ABOVE the WebView — inside it, a tap would be swallowed
            by the zoom gesture handler. */}
        <Pressable style={st.close} onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>

        {many ? (
          <View style={st.nav} pointerEvents="box-none">
            <Pressable
              onPress={onPrev}
              disabled={!onPrev}
              style={[st.navBtn, !onPrev && st.navOff]}
              hitSlop={10}
            >
              <Ionicons name="chevron-forward" size={22} color="#fff" />
            </Pressable>
            <Text style={st.count}>
              {(index ?? 0) + 1} / {total}
            </Text>
            <Pressable
              onPress={onNext}
              disabled={!onNext}
              style={[st.navBtn, !onNext && st.navOff]}
              hitSlop={10}
            >
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
          </View>
        ) : null}

        <Text style={st.hint}>צביטה להגדלה · הקשה כפולה לזום</Text>
      </View>
    </Modal>
  );
}

/**
 * Open-state for a set of images, so a screen can hand the viewer a whole
 * array and get prev/next for free.
 */
export function useLightbox() {
  const [set, setSet] = React.useState<string[]>([]);
  const [i, setI] = React.useState(0);
  return {
    open: (images: string[], at = 0) => {
      setSet(images);
      setI(at);
    },
    close: () => setSet([]),
    props: {
      image: set[i] ?? null,
      index: i,
      total: set.length,
      onPrev: i > 0 ? () => setI((v) => v - 1) : undefined,
      onNext: i < set.length - 1 ? () => setI((v) => v + 1) : undefined,
    },
  };
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  close: {
    position: 'absolute',
    top: 44,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  nav: {
    position: 'absolute',
    bottom: 54,
    left: 0,
    right: 0,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  navBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  navOff: { opacity: 0.25 },
  count: { ...font.small, color: '#fff', fontWeight: '700' },
  hint: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
  },
});
