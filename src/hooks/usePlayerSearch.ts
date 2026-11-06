import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { socialPlayersService } from '@/services/socialPlayersService';
import { useUserStore } from '@/store/userStore';
import { observeCaughtError } from '@/utils/errorObservation';
import type { PlayerSearch, SocialPlayer } from '@/types/social';

interface Result { scope: string; players: SocialPlayer[]; cursor: string | null; pages: number }
const unique = (players: SocialPlayer[]) => [...new Map(players.map(player => [player.id, player])).values()];

/** A cursor describes examined accounts. Empty intermediate pages are not a negative answer. */
export function usePlayerSearch(options: PlayerSearch, active: boolean, preview?: SocialPlayer[]) {
  const owner = useUserStore(s => s.currentUser?.id);
  const guest = useUserStore(s => s.currentUser?.isGuest);
  const focused = useIsFocused();
  const enabled = active && focused && !!owner && !guest && !preview;
  const key = JSON.stringify(options);
  const scope = JSON.stringify([owner, guest, key]);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const current = useRef<Result | null>(null);
  const [state, setState] = useState<{scope: string; busy: boolean; error?: 'refresh'|'more'} | null>(null);
  const generation = useRef(0);
  const paging = useRef(false);
  const previous = useRef<{enabled: boolean; owner?: string; text?: string; filters: string; revision: number} | null>(null);
  const run = async (append: boolean, epoch: number) => {
    const search: PlayerSearch = JSON.parse(key);
    const saved = current.current?.scope === scope ? current.current : null;
    let cursor = append ? saved?.cursor : null;
    if (append && !cursor) return;
    let rows = append ? saved!.players : [];
    let pages = append ? saved!.pages : 0;
    let retryPage = append;
    const targetPages = append ? pages + 1 : saved?.pages ?? 1;
    setState({scope, busy: true});
    try {
      // Restore the previously visible range on return, using fresh server cursors.
      do {
        const page = await socialPlayersService.search({...search, ...(cursor ? {cursor} : {})});
        if (epoch !== generation.current || useUserStore.getState().currentUser?.id !== owner) return;
        rows = unique([...rows, ...page.players]);
        cursor = page.cursor;
        pages++;
        // A later-page failure must retry that page, including during an initial empty scan.
        if (!rows.length && cursor && !saved?.players.length) {
          current.current = {scope, players: rows, cursor, pages};
          setResult(current.current);
          retryPage=true;
        }
      } while (cursor && (!rows.length || pages < targetPages));
      current.current = {scope, players: rows, cursor: cursor ?? null, pages};
      setResult(current.current);
      setState({scope, busy: false});
    } catch (error) {
      observeCaughtError(error, {source:'src/hooks/usePlayerSearch.ts',handler:'run',site:'usePlayerSearch:read'});
      if (epoch === generation.current) setState({scope, busy:false, error:retryPage?'more':'refresh'});
    } finally {
      if (epoch === generation.current) paging.current = false;
    }
  };
  useEffect(() => {
    const epoch = ++generation.current;
    paging.current = false;
    const {text, ...rest}: PlayerSearch = JSON.parse(key);
    const filters = JSON.stringify(rest);
    const prior = previous.current;
    previous.current = {enabled, owner, text, filters, revision};
    if (current.current?.scope !== scope) {current.current=null; setResult(null);}
    if (!enabled) return;
    paging.current=true;
    const typing = !!text && prior?.enabled && prior.owner===owner && prior.text!==text && prior.filters===filters && prior.revision===revision;
    setState({scope,busy:true});
    const timer = setTimeout(() => { void run(false,epoch); }, typing ? 300 : 0);
    return () => {clearTimeout(timer); ++generation.current;};
  }, [scope, enabled, revision]);
  const saved = result?.scope === scope ? result : null;
  const busy = enabled && (state?.scope !== scope || state.busy);
  const error = state?.scope === scope ? state.error : undefined;
  const more = () => {
    if (!enabled || !saved?.cursor || busy || paging.current) return;
    paging.current=true;
    void run(true,generation.current);
  };
  const update = (id: string, patch: Partial<SocialPlayer>) => {
    if (current.current?.scope!==scope || useUserStore.getState().currentUser?.id!==owner) return;
    current.current={...current.current,players:current.current.players.map(p=>p.id===id?{...p,...patch}:p)};
    setResult(current.current);
    if (paging.current) {
      // A read that started before this confirmed action may contain the old relationship.
      ++generation.current;
      paging.current=false;
      setRevision(n=>n+1);
    }
  };
  return {players:preview ?? saved?.players ?? [], cursor:saved?.cursor, busy, failed:!!error, confirmed:!!preview || !!saved,
    scope, more, retry:()=>error==='more'?more():setRevision(n=>n+1), update};
}
