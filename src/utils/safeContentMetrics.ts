import type { EdgeInsets, Metrics, Rect } from 'react-native-safe-area-context';

/** Initial metrics only; the nested native provider tracks layout/rotation. */
export function safeContentMetrics(frame: Rect, insets: EdgeInsets): Metrics {
  return {
    frame: {
      x: frame.x + insets.left,
      y: frame.y + insets.top,
      width: Math.max(0, frame.width - insets.left - insets.right),
      height: Math.max(0, frame.height - insets.top - insets.bottom),
    },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
}
