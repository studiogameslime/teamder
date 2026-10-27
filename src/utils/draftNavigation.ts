import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { GameStackParamList } from '@/navigation/GameStack';

/** Return to the actual source entry, removing all intermediate draft steps. */
export function returnFromDraft(
  nav: Pick<NativeStackNavigationProp<GameStackParamList>, 'getState' | 'pop' | 'navigate'>,
  gameId: string,
  returnRouteKey?: string,
) {
  const state = nav.getState();
  const sourceIndex = returnRouteKey ? state.routes.findIndex(route => route.key === returnRouteKey) : -1;
  if (sourceIndex >= 0 && sourceIndex < state.index) {
    nav.pop(state.index - sourceIndex);
    return;
  }
  nav.navigate('MatchDetails', { gameId });
}
