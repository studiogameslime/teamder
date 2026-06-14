// ScreenshotAnnotator — full-screen markup over a captured screenshot. The
// tester draws red freehand strokes ("circle what's wrong") with a finger;
// "שמירה" flattens the image + strokes into a fresh base64 JPEG via
// captureRef. Pure overlay capture (no GL surfaces) so view-shot is the right
// tool here — unlike the live screen grab which prefers native PixelCopy.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  visible: boolean;
  /** Base64 JPEG (no data: prefix). */
  image: string | null;
  onCancel: () => void;
  onDone: (annotatedBase64: string) => void;
}

const STROKE = '#FF3B30';
const STROKE_WIDTH = 4;

export function ScreenshotAnnotator({ visible, image, onCancel, onDone }: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [paths, setPaths] = useState<string[]>([]);
  const [current, setCurrent] = useState('');
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const currentRef = useRef('');
  const shotRef = useRef<View>(null);

  const uri = image ? `data:image/jpeg;base64,${image}` : null;

  // Fit the screenshot into the available area, preserving aspect ratio, so
  // touch coordinates (relative to the framed view) map 1:1 onto the SVG.
  useEffect(() => {
    if (!visible || !uri) {
      setPaths([]);
      setCurrent('');
      currentRef.current = '';
      setBox(null);
      return;
    }
    let alive = true;
    const maxW = winW - spacing.lg * 2;
    const maxH = winH * 0.68;
    Image.getSize(
      uri,
      (iw, ih) => {
        if (!alive) return;
        const scale = Math.min(maxW / iw, maxH / ih);
        setBox({ w: Math.round(iw * scale), h: Math.round(ih * scale) });
      },
      () => {
        if (alive) setBox({ w: maxW, h: Math.round(maxW * 1.6) });
      },
    );
    return () => {
      alive = false;
    };
  }, [visible, uri, winW, winH]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          currentRef.current = `M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
          setCurrent(currentRef.current);
        },
        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          currentRef.current += ` L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
          setCurrent(currentRef.current);
        },
        onPanResponderRelease: () => {
          if (currentRef.current) {
            const finished = currentRef.current;
            setPaths((p) => [...p, finished]);
          }
          currentRef.current = '';
          setCurrent('');
        },
      }),
    [],
  );

  const undo = () => setPaths((p) => p.slice(0, -1));
  const clear = () => {
    setPaths([]);
    setCurrent('');
    currentRef.current = '';
  };

  const done = async () => {
    if (!image) {
      onCancel();
      return;
    }
    // Nothing drawn → keep the original untouched (avoids a needless re-encode).
    if (paths.length === 0 && !current) {
      onDone(image);
      return;
    }
    setBusy(true);
    try {
      const out = await captureRef(shotRef, {
        format: 'jpg',
        quality: 0.6,
        result: 'base64',
      });
      onDone(out);
    } catch {
      onDone(image); // fall back to the un-annotated shot
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.backdrop}>
        <View style={s.titleRow}>
          <Ionicons name="brush-outline" size={20} color="#FFFFFF" />
          <Text style={s.title}>{he.screenshotAnnotateTitle}</Text>
        </View>
        <Text style={s.hint}>{he.screenshotAnnotateHint}</Text>

        {uri && box ? (
          <View
            ref={shotRef}
            collapsable={false}
            style={[s.canvas, { width: box.w, height: box.h }]}
            {...pan.panHandlers}
          >
            <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
            <Svg style={StyleSheet.absoluteFill} width={box.w} height={box.h}>
              {paths.map((d, i) => (
                <Path
                  key={i}
                  d={d}
                  stroke={STROKE}
                  strokeWidth={STROKE_WIDTH}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              ))}
              {current ? (
                <Path
                  d={current}
                  stroke={STROKE}
                  strokeWidth={STROKE_WIDTH}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              ) : null}
            </Svg>
          </View>
        ) : (
          <View style={[s.canvas, { width: 200, height: 200, alignItems: 'center', justifyContent: 'center' }]}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        )}

        <View style={s.toolbar}>
          <ToolBtn icon="arrow-undo" label={he.screenshotAnnotateUndo} onPress={undo} disabled={paths.length === 0} />
          <ToolBtn icon="trash-outline" label={he.screenshotAnnotateClear} onPress={clear} disabled={paths.length === 0} />
        </View>

        <View style={s.actions}>
          <Pressable onPress={onCancel} hitSlop={8} style={[s.actionBtn, s.cancelBtn]}>
            <Text style={s.cancelTxt}>{he.cancel}</Text>
          </Pressable>
          <Pressable onPress={done} disabled={busy} style={[s.actionBtn, s.doneBtn]}>
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={s.doneTxt}>{he.screenshotAnnotateDone}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ToolBtn({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.tool, disabled && { opacity: 0.4 }]}>
      <Ionicons name={icon} size={18} color="#FFFFFF" />
      <Text style={s.toolTxt}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  titleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  title: { ...typography.h3, color: '#FFFFFF', fontWeight: '800' },
  hint: { ...typography.caption, color: 'rgba(255,255,255,0.7)', textAlign: 'center' },
  canvas: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  toolbar: { flexDirection: 'row-reverse', gap: spacing.md },
  tool: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  toolTxt: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  actions: { flexDirection: 'row-reverse', gap: spacing.md, alignSelf: 'stretch', marginTop: spacing.sm },
  actionBtn: {
    flex: 1,
    height: 50,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: { backgroundColor: 'rgba(255,255,255,0.14)' },
  cancelTxt: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  doneBtn: { backgroundColor: colors.primary },
  doneTxt: { color: colors.textOnPrimary, fontWeight: '800', fontSize: 16 },
});
