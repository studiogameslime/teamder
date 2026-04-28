// Jersey identity. Pure View/Text — no SVG, no images.
//
// Shape (z-order, back → front):
//   1. Two sleeve caps (absolute, sit just below the shoulders)
//   2. Body (rounded rectangle filling most of the canvas)
//   3. Pattern layer (clipped to body via overflow:hidden)
//   4. Neck cutout (surface-colored notch at top center of body)
//   5. Number-safe-zone disc (solid shirt color, only on non-solid patterns)
//   6. Display-name above number, number below (printed-on-shirt look)
//
// At sizes < 40dp the pattern layer simplifies (or is skipped) so the
// number stays readable on cards and in-field jerseys. The on-shirt
// name is suppressed below 56dp regardless of `showName`.

import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import type { Jersey, JerseyPattern, User } from '@/types';
import { autoJersey, jerseyContrast } from '@/data/jerseys';
import { colors } from '@/theme';

interface Props {
  jersey?: Jersey;
  user?: Pick<User, 'id' | 'name'> | null;
  /** Outer width in dp. Height = width. Default 64. */
  size?: number;
  /**
   * Render the display name printed ON the shirt above the number,
   * like the back of a real football jersey. Auto-suppressed for very
   * small sizes where the text would be illegible.
   */
  showName?: boolean;
  /** Highlight ring around the body (used for picker preview). */
  showRing?: boolean;
  style?: ViewStyle;
}

export function Jersey({
  jersey,
  user,
  size = 64,
  showName = false,
  showRing = false,
  style,
}: Props) {
  const j = jersey ?? autoJersey(user?.id ?? '', user?.name ?? '');
  const fg = jerseyContrast(j.color);

  // Geometry — every dimension scales with `size`.
  const bodyW = Math.round(size * 0.7);
  const bodyH = Math.round(size * 0.86);
  const bodyTop = Math.round(size * 0.07);
  const bodyLeft = Math.round((size - bodyW) / 2);
  const bodyRadius = Math.round(size * 0.14);

  const sleeveW = Math.round(size * 0.24);
  const sleeveH = Math.round(size * 0.22);
  const sleeveTop = Math.round(size * 0.1);

  const neckW = Math.round(size * 0.26);
  const neckH = Math.round(size * 0.08);

  // Whether the display name is rendered ON the shirt. We need a
  // sensible minimum body height for a 1-line printed name to read;
  // below 56dp the shirt drops the name and centers the number alone.
  const showShirtName = showName && size >= 56 && (j.displayName || '').trim().length > 0;
  const nameFontSize = Math.round(bodyW * 0.16);
  const nameAreaH = showShirtName ? Math.round(bodyH * 0.22) : 0;
  const numberSize = Math.round(bodyW * (showShirtName ? 0.46 : 0.5));
  const safeZone = Math.round(numberSize * 1.3);
  // Number's vertical center inside the body; the safe-zone disc tracks
  // it so the disc stays centered behind the digit when the name area
  // pushes the number below the body's geometric center.
  const numberCenterY = nameAreaH + (bodyH - nameAreaH) / 2;
  const discTop = Math.round(numberCenterY - safeZone / 2);

  // White-ish jerseys need a hairline outline so they don't disappear
  // on a white card. Same logic for the sleeves and neck-edge.
  const isLight = fg === '#1F2937';
  const lightBorderColor = colors.border;

  // Number contrast: text-shadow opposite the foreground so the digit
  // pops over any pattern that bleeds past the safe zone.
  const shadowColor = isLight
    ? 'rgba(255,255,255,0.55)'
    : 'rgba(0,0,0,0.45)';

  // Patterns simplify at small size — the silhouette is the priority.
  const showPattern = j.pattern !== 'solid' && size >= 32;
  const simplePattern = showPattern && size < 40;

  return (
    <View style={[{ width: size, alignItems: 'center' }, style]}>
      <View style={{ width: size, height: size }}>
        {/* Sleeves (drawn first so the body overlaps their inner edge) */}
        <Sleeve
          color={j.color}
          width={sleeveW}
          height={sleeveH}
          top={sleeveTop}
          side="left"
          isLight={isLight}
          borderColor={lightBorderColor}
        />
        <Sleeve
          color={j.color}
          width={sleeveW}
          height={sleeveH}
          top={sleeveTop}
          side="right"
          isLight={isLight}
          borderColor={lightBorderColor}
        />

        {/* Body */}
        <View
          style={{
            position: 'absolute',
            top: bodyTop,
            left: bodyLeft,
            width: bodyW,
            height: bodyH,
            backgroundColor: j.color,
            borderRadius: bodyRadius,
            borderWidth: showRing ? 2 : isLight ? 1 : 0,
            borderColor: showRing ? colors.primary : lightBorderColor,
            overflow: 'hidden',
          }}
        >
          {/* Pattern (behind everything inside the body) */}
          {showPattern ? (
            <PatternLayer
              pattern={j.pattern}
              base={j.color}
              contrast={fg}
              width={bodyW}
              height={bodyH}
              simple={simplePattern}
            />
          ) : null}

          {/* Number safe zone — keeps the digit on a clean disc of the
              shirt color so the pattern never bleeds across it. Only
              needed when there's a pattern to bleed. */}
          {showPattern ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: discTop,
                left: (bodyW - safeZone) / 2,
                width: safeZone,
                height: safeZone,
                borderRadius: safeZone / 2,
                backgroundColor: j.color,
              }}
            />
          ) : null}

          {/* Content layer — printed name (when requested) above the
              big centered number. Mirrors the back of a real football
              shirt. */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {showShirtName ? (
              <View
                style={{
                  height: nameAreaH,
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingHorizontal: 4,
                }}
              >
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  style={{
                    color: fg,
                    fontSize: nameFontSize,
                    fontWeight: '800',
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                    maxWidth: bodyW * 0.86,
                    textAlign: 'center',
                    textShadowColor: shadowColor,
                    textShadowOffset: { width: 0, height: 1 },
                    textShadowRadius: 2,
                    includeFontPadding: false,
                  }}
                >
                  {j.displayName}
                </Text>
              </View>
            ) : null}
            <View style={styles.numberWrap}>
              <Text
                allowFontScaling={false}
                style={{
                  color: fg,
                  fontSize: numberSize,
                  fontWeight: '900',
                  letterSpacing: -1,
                  textAlign: 'center',
                  textShadowColor: shadowColor,
                  textShadowOffset: { width: 0, height: 1 },
                  textShadowRadius: 2,
                  includeFontPadding: false,
                }}
              >
                {clampNumber(j.number)}
              </Text>
            </View>
          </View>
        </View>

        {/* Neck cutout — drawn LAST so it sits on top of the body's top
            edge. Surface-colored so it reads as "punched out". */}
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: (size - neckW) / 2,
            width: neckW,
            height: neckH,
            backgroundColor: colors.surface,
            borderBottomLeftRadius: neckH,
            borderBottomRightRadius: neckH,
          }}
        />
      </View>

    </View>
  );
}

// ─── Sleeves ────────────────────────────────────────────────────────────

function Sleeve({
  color,
  width,
  height,
  top,
  side,
  isLight,
  borderColor,
}: {
  color: string;
  width: number;
  height: number;
  top: number;
  side: 'left' | 'right';
  isLight: boolean;
  borderColor: string;
}) {
  // Asymmetric corner radii give the sleeve a "shoulder cap" feel:
  // strongly rounded outer/upper corners, gentler inner corners where it
  // meets the body.
  const r = Math.round(height * 0.6);
  const sm = Math.round(height * 0.18);
  return (
    <View
      style={{
        position: 'absolute',
        top,
        [side === 'left' ? 'left' : 'right']: 0,
        width,
        height,
        backgroundColor: color,
        borderTopLeftRadius: side === 'left' ? r : sm,
        borderTopRightRadius: side === 'right' ? r : sm,
        borderBottomLeftRadius: side === 'left' ? sm : 0,
        borderBottomRightRadius: side === 'right' ? sm : 0,
        borderWidth: isLight ? 1 : 0,
        borderColor,
      }}
    />
  );
}

// ─── Patterns ───────────────────────────────────────────────────────────

function PatternLayer({
  pattern,
  base,
  contrast,
  width,
  height,
  simple,
}: {
  pattern: JerseyPattern;
  base: string;
  contrast: string;
  width: number;
  height: number;
  simple: boolean;
}) {
  if (pattern === 'stripes') {
    // Simple vertical bars. Three contrast bands + four base gaps; at
    // small size we drop to two bands so the shirt doesn't look noisy.
    const bands = simple ? 1 : 2;
    return (
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.stripesRow]}
      >
        {Array.from({ length: bands * 2 + 1 }, (_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              backgroundColor: i % 2 === 1 ? contrast : 'transparent',
            }}
          />
        ))}
      </View>
    );
  }

  if (pattern === 'split') {
    // Clean half/half. Right half gets the contrast; left stays base.
    return (
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}
      >
        <View style={{ flex: 1 }} />
        <View style={{ flex: 1, backgroundColor: contrast }} />
      </View>
    );
  }

  if (pattern === 'dots') {
    // A sparse 3×2 dot grid that purposely skips the center area. The
    // safe-zone disc still covers the number; this just keeps the
    // shirt from feeling crowded.
    const cols = simple ? 2 : 3;
    const rows = simple ? 1 : 2;
    const cellW = width / cols;
    const cellH = height / (rows + 1.4); // leave breathing room top + bottom
    const dotR = Math.max(2, Math.min(cellW, cellH) * 0.18);
    const positions: { x: number; y: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Skip the center dot to leave the safe zone undisturbed.
        if (cols >= 3 && c === 1 && r === Math.floor(rows / 2)) continue;
        positions.push({
          x: cellW * c + cellW / 2 - dotR,
          y: cellH * r + cellH * 0.7,
        });
      }
    }
    return (
      <View
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      >
        {positions.map((p, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: p.x,
              top: p.y,
              width: dotR * 2,
              height: dotR * 2,
              borderRadius: dotR,
              backgroundColor: contrast,
              opacity: 0.85,
            }}
          />
        ))}
      </View>
    );
  }

  return null;
}

function clampNumber(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 99) return 99;
  return Math.floor(n);
}

const styles = StyleSheet.create({
  numberWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stripesRow: {
    flexDirection: 'row',
  },
});
