import { colors, isDarkTheme } from './colors';
import { shadows } from './spacing';

/** Shared visual language only. Each host retains its own sizing, gestures,
 * keyboard handling, focus and dismissal policy. Never use this to turn a
 * full-screen editor or map into a dismissible dialog. */
export const overlayTheme = {
  backdrop: 'rgba(15,23,42,0.44)',
  popoverBackdrop: 'rgba(15,23,42,0.22)',
  surface: colors.surface,
  border: isDarkTheme ? colors.border : '#E2EAF6',
  dialogRadius: 24,
  sheetRadius: 28,
  popoverRadius: 18,
  shadow: shadows.raised,
} as const;

export const overlaySurfaces = {
  dialog: {
    backgroundColor: overlayTheme.surface,
    borderRadius: overlayTheme.dialogRadius,
    borderWidth: 1,
    borderColor: overlayTheme.border,
    ...overlayTheme.shadow,
  },
  sheet: {
    backgroundColor: overlayTheme.surface,
    borderTopLeftRadius: overlayTheme.sheetRadius,
    borderTopRightRadius: overlayTheme.sheetRadius,
    borderTopWidth: 1,
    borderColor: overlayTheme.border,
    ...overlayTheme.shadow,
  },
  popover: {
    backgroundColor: overlayTheme.surface,
    borderRadius: overlayTheme.popoverRadius,
    borderWidth: 1,
    borderColor: overlayTheme.border,
    ...overlayTheme.shadow,
  },
} as const;
