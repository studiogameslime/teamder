import { useCallback, useContext, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { useReducedMotion } from './useReducedMotion';
import { useScrollActivity } from '@/components/ScrollSurface';

/** Kept stack screens stay mounted. Their endless loops must not stay active. */
export function useAmbientMotion(): boolean {
  const navigation = useContext(NavigationContext);
  const subscribeFocus = useCallback((notify: () => void) => {
    if (!navigation) return () => {};
    const focus = navigation.addListener('focus', notify);
    const blur = navigation.addListener('blur', notify);
    return () => { focus(); blur(); };
  }, [navigation]);
  const readFocus = useCallback(() => navigation?.isFocused() ?? true, [navigation]);
  const focused = useSyncExternalStore(subscribeFocus, readFocus, readFocus);
  const subscribeApp = useCallback((notify: () => void) => {
    const subscription = AppState.addEventListener('change', notify);
    return () => subscription.remove();
  }, []);
  const readApp = useCallback(() => AppState.currentState == null || AppState.currentState === 'active', []);
  const foreground = useSyncExternalStore(subscribeApp, readApp, readApp);
  const reduced = useReducedMotion();
  const moving = useScrollActivity();
  return focused && foreground && !reduced && !moving;
}
