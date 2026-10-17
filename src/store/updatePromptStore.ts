import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateTargetKey, type StoreUpdate } from '@/services/updateService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';

const SNOOZE_KEY = 'storeUpdateSnooze:v2';
const DAY = 24 * 60 * 60 * 1000;
let revision = 0;
let sessionSnooze: { target: string; until: number } | null = null;

export const useUpdatePromptStore = create<{ update: StoreUpdate | null }>(() => ({ update: null }));

export async function applyStoreUpdate(update: StoreUpdate | null): Promise<void> {
  const current = ++revision;
  if (!update || update.kind === 'force') {
    useUpdatePromptStore.setState({ update });
    return;
  }
  let snooze = sessionSnooze;
  try {
    const raw = await AsyncStorage.getItem(SNOOZE_KEY);
    if (!snooze && raw) snooze = JSON.parse(raw);
  } catch { /* A storage failure must not hide a real store update. */ }
  if (current !== revision) return;
  const hidden = snooze?.target === updateTargetKey(update) && Number.isFinite(snooze.until) && Date.now() < snooze.until;
  useUpdatePromptStore.setState({ update: hidden ? null : update });
}

export function dismissStoreUpdate(): void {
  const update = useUpdatePromptStore.getState().update;
  if (!update || update.kind === 'force') return;
  ++revision;
  sessionSnooze = { target: updateTargetKey(update), until: Date.now() + DAY };
  useUpdatePromptStore.setState({ update: null });
  void AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify(sessionSnooze)).catch(() => {});
  logEvent(AnalyticsEvent.UpdatePromptDismissed, { target: updateTargetKey(update), source: 'home_banner' });
}
