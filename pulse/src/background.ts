// Background polling via expo-background-fetch + expo-task-manager. On
// Android this runs through WorkManager every ~15 min while the app is
// installed (even backgrounded), firing local notifications for new
// reviews with no server involved.

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { config } from './config';
import { runPoll } from './services/poller';
import { checkAndNotifyQuota } from './services/quota';

export const POLL_TASK = 'pulse-poll-task';
export const QUOTA_TASK = 'pulse-quota-task';

TaskManager.defineTask(POLL_TASK, async () => {
  try {
    const { newReviews } = await runPoll();
    return newReviews > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (e) {
    console.warn('[bg] poll failed:', (e as Error).message);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Background QUOTA watch — separate from the (disabled) review poll. This
// reads ONLY Google Cloud Monitoring (free; it does NOT touch Firestore), so
// running it ~every 15 min while the app is backgrounded burns no quota. It
// fires the local "crossed 50%" push even when Pulse is never opened.
TaskManager.defineTask(QUOTA_TASK, async () => {
  try {
    await checkAndNotifyQuota();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    console.warn('[bg] quota check failed:', (e as Error).message);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundQuota(): Promise<void> {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) {
      return;
    }
    if (await TaskManager.isTaskRegisteredAsync(QUOTA_TASK)) return;
    await BackgroundFetch.registerTaskAsync(QUOTA_TASK, {
      minimumInterval: 15 * 60, // WorkManager floors Android at ~15 min anyway
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } catch (e) {
    console.warn('[bg] quota register failed:', (e as Error).message);
  }
}

export async function registerBackgroundPoll(): Promise<void> {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) {
      return;
    }
    const already = await TaskManager.isTaskRegisteredAsync(POLL_TASK);
    if (already) return;
    await BackgroundFetch.registerTaskAsync(POLL_TASK, {
      minimumInterval: Math.max(15, config.pollIntervalMinutes) * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } catch (e) {
    console.warn('[bg] register failed:', (e as Error).message);
  }
}

// Tear down any previously-registered background poll. We now fetch only when
// the app is opened (no periodic background reads → no quota burn while idle).
export async function unregisterBackgroundPoll(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(POLL_TASK)) {
      await BackgroundFetch.unregisterTaskAsync(POLL_TASK);
    }
  } catch (e) {
    console.warn('[bg] unregister failed:', (e as Error).message);
  }
}
