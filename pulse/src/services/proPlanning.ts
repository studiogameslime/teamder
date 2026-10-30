import AsyncStorage from '@react-native-async-storage/async-storage';

// Planning only. This key is private to Pulse and is never read by Teamder.
export const PRO_PLAN_KEY = 'pulse.proPlanning.v1';
export type ProPlan = Record<string, boolean>;
export type ProFilter = 'all' | 'pro' | 'free';
export type PlanningFeature = { id: string; category: string; title: string; description: string; source: string };

export function parseProPlan(raw: string | null): ProPlan {
  if (raw === null) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.values(value).some(item => typeof item !== 'boolean')) {
    throw new Error('Invalid Pulse planning data');
  }
  return value as ProPlan;
}

export const loadProPlan = async (): Promise<ProPlan> => parseProPlan(await AsyncStorage.getItem(PRO_PLAN_KEY));
export const saveProPlan = (plan: ProPlan): Promise<void> => AsyncStorage.setItem(PRO_PLAN_KEY, JSON.stringify(plan));

export function filterPlanningFeatures(features: readonly PlanningFeature[], plan: ProPlan, filter: ProFilter, category: string, search: string) {
  const query = search.trim().toLocaleLowerCase('he');
  return features.filter(item => (category === 'all' || item.category === category) &&
    (filter === 'all' || (plan[item.id] === true) === (filter === 'pro')) &&
    `${item.title} ${item.description} ${item.category}`.toLocaleLowerCase('he').includes(query));
}
