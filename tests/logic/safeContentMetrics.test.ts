import fs from 'fs';
import path from 'path';
import { safeContentMetrics } from '../../src/utils/safeContentMetrics';

describe('system safe viewport', () => {
  it.each([
    ['Android buttons', 24, 48, 0, 0],
    ['Android gestures', 24, 24, 0, 0],
    ['iPhone notch/home indicator', 59, 34, 0, 0],
    ['landscape cutout', 0, 21, 59, 59],
  ])('%s consumes each system inset once', (_, top, bottom, left, right) => {
    const result = safeContentMetrics({ x: 0, y: 0, width: 800, height: 600 }, { top, bottom, left, right });
    expect(result.frame).toEqual({ x: left, y: top, width: 800 - left - right, height: 600 - top - bottom });
    // A screen/tab consuming the remaining insets must not add them again.
    expect(safeContentMetrics(result.frame, result.insets)).toEqual(result);
  });
  it('keeps window offsets for anchored menus and clamps a small resized viewport', () => {
    expect(safeContentMetrics({ x: 5, y: 7, width: 10, height: 20 }, { top: 24, bottom: 34, left: 12, right: 0 })).toEqual({
      frame: { x: 17, y: 31, width: 0, height: 0 }, insets: { top: 0, bottom: 0, left: 0, right: 0 },
    });
  });
  it('does not let an application modal bypass its separate-window boundary', () => {
    const root = path.resolve(__dirname, '../../src');
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory() ? files(file) : file.endsWith('.tsx') ? [file] : [];
    });
    const bypasses = files(root).filter(file => !file.endsWith(`${path.sep}SafeModal.tsx`)).filter(file => {
      const source = fs.readFileSync(file, 'utf8');
      return /import\s*\{[^{}]*\bModal\b[^{}]*\}\s*from\s*['"]react-native['"]/.test(source);
    });
    expect(bypasses).toEqual([]);
  });
});
