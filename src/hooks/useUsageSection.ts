import { useEffect } from 'react';
import { useIsFocused, useRoute } from '@react-navigation/native';
import { setUsageSection } from '@/services/usageActivity';
import { UsageContext } from '@/utils/usageActivity';

/** Kept-mounted tabs are observed only while their navigation route is focused. */
export function useUsageSection(section: string, context: UsageContext): void {
  const focused = useIsFocused(), route = useRoute();
  const { groupId, gameId, playerId, seasonId } = context;
  useEffect(() => {
    if (focused) setUsageSection(route.key, route.name, { groupId, gameId, playerId, seasonId }, section);
  }, [focused, route.key, route.name, section, groupId, gameId, playerId, seasonId]);
}
