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
    () => {},
  );
}

export function warningHaptic(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
    () => {},
  );
}

export function lightHaptic(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function selectionHaptic(): void {
  Haptics.selectionAsync().catch(() => {});
}
