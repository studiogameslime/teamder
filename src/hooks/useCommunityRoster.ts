import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { groupService, communityEventsService } from '@/services';
import { gameService } from '@/services/gameService';
import { logError } from '@/services/errorLog';
import { observeCaughtError } from '@/utils/errorObservation';
import type { CardCountsMap } from '@/services/communityEventsService';
import type { Group, User, UserId } from '@/types';

interface RosterData {
  group: Group | null;
  members: User[];
  stats: Record<UserId, { gamesPlayed: number }> | null;
  cardCounts: CardCountsMap;
}
const EMPTY_MEMBERS: User[] = [];
const EMPTY_COUNTS: CardCountsMap = {};

/** Refresh the same roster in place; another club/account never inherits it. */
export function useCommunityRoster(groupId: string, viewer: Pick<User, 'id' | 'isGuest'> | null) {
  const owner = JSON.stringify([groupId, viewer?.id, !!viewer?.isGuest]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const generation = useRef(0);
  const focused = useRef(false);
  const [snapshot, setSnapshot] = useState<{ owner: string; data: RosterData } | null>(null);
  const [request, setRequest] = useState({ owner, loading: true, failed: false });
  const reload = useCallback(async () => {
    // An action can finish after navigation/account change and retain this callback.
    if (!focused.current || currentOwner.current !== owner) return;
    const ticket = ++generation.current;
    const current = () => generation.current === ticket && currentOwner.current === owner;
    setRequest({ owner, loading: true, failed: false });
    try {
      const group = await groupService.get(groupId);
      if (!current()) return;
      if (!group) {
        setSnapshot({ owner, data: { group: null, members: [], stats: {}, cardCounts: {} } });
        return;
      }
      const ids = Array.from(new Set([...group.adminIds, ...group.playerIds]));
      const isAdmin = !!viewer && group.adminIds.includes(viewer.id);
      let detailsFailed = false;
      const [members, stats, cardCounts] = await Promise.all([
        groupService.hydrateUsers(ids),
        gameService.getCommunityPlayerStats(group.id, ids).catch((error: unknown) => {
          detailsFailed = true;
          observeCaughtError(error, { source: 'src/hooks/useCommunityRoster.ts', handler: 'reload', site: 'rosterStats' });
          return null;
        }),
        isAdmin && group.cardsEnabled
          ? communityEventsService.getActiveCardCounts(group.id, group.yellowCardValidityDays, group.redCardValidityDays).catch((error: unknown) => {
            detailsFailed = true;
            observeCaughtError(error, { source: 'src/hooks/useCommunityRoster.ts', handler: 'reload', site: 'rosterCards' });
            return null;
          }) : Promise.resolve({}),
      ]);
      if (current()) {
        setSnapshot(previous => {
          const confirmed = previous?.owner === owner ? previous.data : null;
          return { owner, data: { group, members, stats: stats ?? confirmed?.stats ?? null, cardCounts: cardCounts ?? confirmed?.cardCounts ?? EMPTY_COUNTS } };
        });
        setRequest({ owner, loading: false, failed: detailsFailed });
      }
    } catch (error) {
      if (!current()) return;
      observeCaughtError(error, { source: 'src/hooks/useCommunityRoster.ts', handler: 'reload', site: 'rosterLoad' });
      logError('communityPlayersLoad', error, { screen: 'CommunityPlayersScreen', groupId });
      setRequest({ owner, loading: false, failed: true });
    } finally {
      if (current()) setRequest(previous => ({ ...previous, loading: false }));
    }
  }, [groupId, owner, viewer?.id]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    void reload();
    return () => { focused.current = false; generation.current += 1; };
  }, [reload]));

  const data = snapshot?.owner === owner ? snapshot.data : null;
  const loading = request.owner !== owner || request.loading;
  const failed = request.owner === owner && request.failed;
  const setGroup = useCallback((update: (group: Group | null) => Group | null) => {
    setSnapshot(previous => previous?.owner === owner
      ? { owner, data: { ...previous.data, group: update(previous.data.group) } } : previous);
  }, [owner]);
  return {
    group: data?.group ?? null, members: data?.members ?? EMPTY_MEMBERS,
    stats: data?.stats ?? null, cardCounts: data?.cardCounts ?? EMPTY_COUNTS,
    loading, failed, initialLoading: !data && loading, reload, setGroup,
  };
}
