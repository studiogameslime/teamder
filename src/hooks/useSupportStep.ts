import { useCallback } from 'react';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { setSupportStep } from '@/services/supportChat';

/** Register only the focused form, since inactive navigation screens stay mounted. */
export function useSupportStep(step: number) {
  const route = useRoute();
  useFocusEffect(useCallback(() => {
    setSupportStep(route.name, step);
    return () => setSupportStep(route.name);
  }, [route.name, step]));
}
