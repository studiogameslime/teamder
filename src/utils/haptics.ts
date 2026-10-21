import { observeCaughtError } from './errorObservation';
// haptics — tiny shared wrapper over expo-haptics so the whole app
// speaks one vocabulary of tactile feedback:
//
//   success  — a discrete win the user caused (joined a game, sent a
//              rating, unlocked an achievement, created a group).
//   light    — a small acknowledgement (toggle flip, chip select,
//              star tap). Barely perceptible by design.
//   warning  — a soft "are you sure / something undone" (cancel
//              registration, leave group). NOT celebratory.
//
// All calls are fire-and-forget and never throw — a device without
// the haptics module (Expo Go, web) silently no-ops.

import * as Haptics from 'expo-haptics';

export function successHaptic(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
    (caughtError573d4e6601: unknown) => {
    observeCaughtError(caughtError573d4e6601, {"source":"src/utils/haptics.ts","handler":"successHaptic","site":"haptics:573d4e6601"});},
  );
}

export function warningHaptic(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
    (caughtError294219a338: unknown) => {
    observeCaughtError(caughtError294219a338, {"source":"src/utils/haptics.ts","handler":"warningHaptic","site":"haptics:294219a338"});},
  );
}

export function lightHaptic(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch((caughtErrorae97e9ae5f: unknown) => {
    observeCaughtError(caughtErrorae97e9ae5f, {"source":"src/utils/haptics.ts","handler":"lightHaptic","site":"haptics:ae97e9ae5f"});});
}

export function selectionHaptic(): void {
  Haptics.selectionAsync().catch((caughtError3724290c57: unknown) => {
    observeCaughtError(caughtError3724290c57, {"source":"src/utils/haptics.ts","handler":"selectionHaptic","site":"haptics:3724290c57"});});
}
