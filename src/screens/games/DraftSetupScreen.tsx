import { observeCaughtError } from '../../utils/errorObservation';
// DraftSetupScreen — Step 1 of חלוקת כוחות.
//
// The manager taps players to mark them captains (selection ORDER sets the
// team order: 1st captain → קבוצה א, 2nd → ב, …), then picks the draft
// order (snake / regular). "המשך" carries the captain ids + method to the
// draft board. Fully dynamic for 2–4 teams.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Rect, Line, Circle } from 'react-native-svg';
import { USE_MOCK_DATA } from '@/firebase/config';
import { gameFormatLabel } from '@/utils/format';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  useFocusEffect,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/Button';
import { ManualAllocation } from '@/components/draft/ManualAllocation';
import { DraftGenerationPreview } from '@/components/draft/DraftGenerationPreview';
import { playersPerTeam } from '@/utils/draft';
import { activeDraftRosterIds } from '@/utils/draftIntegrity';
import { DraftOrderPath } from '@/components/draft/DraftOrderPath';
import { useGameStore } from '@/store/gameStore';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { gameService } from '@/services';
import { toast } from '@/components/Toast';
import { logError } from '@/services/errorLog';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { colors, radius, spacing, typography, shadows, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { toGuestRosterId, type Game } from '@/types';
import {
  previewPath,
  balanceTeams,
  MIN_TEAMS,
  MAX_TEAMS,
  type DraftMethod,
} from '@/utils/draft';
import { balanceTiming } from '@/components/anim/game/triggerLogic';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList>;
type Params = RouteProp<GameStackParamList, 'DraftSetup'>;

export function DraftSetupScreen() {
  const nav = useNavigation<Nav>();
  const params = useRoute<Params>().params;
  const { gameId } = params;
  const requestedPreview = (params as typeof params & {manualPreview?:number}).manualPreview;
  const previewCount = __DEV__ && USE_MOCK_DATA && process.env.EXPO_PUBLIC_QA_ROUTES === '1' && (requestedPreview===3||requestedPreview===4) ? requestedPreview : 0;

  const playersMap = useGameStore((s) => s.players);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  const currentUser = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);

  const [game, setGame] = useState<Game | null>(null);
  const [loadingGame,setLoadingGame]=useState(true);
  const [loadFailed,setLoadFailed]=useState(false);
  const [retryLoad,setRetryLoad]=useState(0);
  const [captainIds, setCaptainIds] = useState<string[]>([]);
  const [captainStep, setCaptainStep] = useState<'captains' | 'order'>('captains');
  // No default: the manager MUST actively pick an order. With a pre-selected
  // default they often hit "המשך" without ever scrolling to the order options
  // below a long captain list. Null → "המשך" stays disabled until chosen.
  const [method, setMethod] = useState<DraftMethod | null>(null);
  // Step 0: which split METHOD. null = the method picker is showing.
  //   'auto'   → balanced by internal rating (internal-rating communities only)
  //   'manual' → the captain draft (the classic flow)
  //   'random' → random even split, no ratings
  const [splitMode, setSplitMode] = useState<'auto' | 'manual' | 'random' | 'free' | null>(
    params.resumeManual || params.editExisting ? 'free' : null,
  );
  // Team count for auto/random (the manual flow derives it from #captains).
  const [autoNumTeams, setAutoNumTeams] = useState(MIN_TEAMS);
  const [generating, setGenerating] = useState(false);
  const [useCompletions, setUseCompletions] = useState(true);
  // DnD "edit existing teams" modal (only when teams already exist).
  const [editSavedTeams, setEditSavedTeams] = useState(params.editExisting === true);
  const [openingExisting, setOpeningExisting] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'auto' | 'manual' | 'random' | 'free' | null>(null);
  const loadRevision = useRef(0);

  useEffect(() => {
    if (!params.resumeManual && !params.editExisting) return;
    let alive=true;
    const revision=++loadRevision.current;
    const preferSaved=params.editExisting === true;
    setSplitMode(null);setOpeningExisting(true);setLoadingGame(true);setLoadFailed(false);
    (async()=>{
      try {
        const latest=await gameService.getGameById(gameId);
        if (!alive || revision!==loadRevision.current) return;
        if (!latest) throw new Error('GAME_NOT_FOUND');
        setGame(latest);setEditSavedTeams(preferSaved);setSplitMode('free');
      } catch(error) {
    observeCaughtError(error, {"source":"src/screens/games/DraftSetupScreen.tsx","handler":"DraftSetupScreen","site":"DraftSetupScreen:8657bd7994"});
        if(alive && revision===loadRevision.current){setLoadFailed(true);logError('manualEntryLoad',error,{gameId});toast.error('לא הצלחנו לטעון את הכוחות המעודכנים. נסו שוב.');}
      } finally {
        if(alive && revision===loadRevision.current){setLoadingGame(false);setOpeningExisting(false);nav.setParams({resumeManual:undefined,editExisting:undefined});}
      }
    })();
    return()=>{alive=false;};
  }, [params.resumeManual, params.editExisting, nav, gameId]);

  useFocusEffect(useCallback(() => {
    // Entry loading owns the screen until the saved split has arrived.
    if (params.resumeManual || params.editExisting) return;
    let alive = true;
    const revision=++loadRevision.current;
    setLoadingGame(true);setLoadFailed(false);
    (async () => {
      try {
        const g = await gameService.getGameById(gameId);
        if (!alive || revision!==loadRevision.current) return;
        if(!g)throw new Error('GAME_NOT_FOUND');
        // Teams (כוחות) are a manager-only action. Guard the screen itself
        // — not just the menu entry — so a non-manager who reaches it via a
        // stale nav state or deep link is bounced out instead of editing.
        if (g) {
          const grp = myCommunities.find((c) => c.id === g.groupId);
          const isAdmin =
            !!currentUser &&
            (g.createdBy === currentUser.id ||
              (!!grp && grp.adminIds.includes(currentUser.id)));
          if (!isAdmin) {
            toast.info(he.draftAdminOnly);
            if (nav.canGoBack()) nav.goBack();
            return;
          }
        }
        setGame(g);
        // Seed the auto/random team count from the game's configured
        // numberOfTeams (clamped to the supported range). Without this it stuck
        // at 2 unless the admin tapped a pill, so a 4-team game silently split
        // into 2 (B09).
        if (typeof g?.numberOfTeams === 'number') {
          setAutoNumTeams(
            Math.min(MAX_TEAMS, Math.max(MIN_TEAMS, g.numberOfTeams)),
          );
        }
        if (g?.players?.length) hydratePlayers(g.players);
      } catch (err) {
    observeCaughtError(err, {"source":"src/screens/games/DraftSetupScreen.tsx","handler":"DraftSetupScreen","site":"DraftSetupScreen:2deaee4396"});
        if(alive && revision===loadRevision.current){setLoadFailed(true);logError('draftSetupLoad', err, { gameId });}
      } finally {
        if(alive && revision===loadRevision.current)setLoadingGame(false);
      }
    })();
    return () => {
      alive = false;
      setLoadingGame(true);
    };
  }, [gameId, hydratePlayers, currentUser, myCommunities, nav, params.resumeManual, params.editExisting,retryLoad]));

  // Draftable roster = registered players (uid → name/avatar from the
  // store) PLUS per-game guests (name only; avatar falls back to a
  // deterministic disc from the guest id).
  const participants = useMemo<
    { id: string; name: string; avatarId?: string; photoUrl?: string }[]
  >(() => {
    if (!game) return [];
    const players = (game.players ?? []).map((uid) => {
      const p = playersMap[uid];
      return {
        id: uid,
        name: p?.displayName ?? '…',
        avatarId: p?.avatarId,
        photoUrl: p?.photoUrl,
      };
    });
    // Use the PREFIXED `guest:` roster id — the same id DraftBoard (and every
    // other surface) uses. With the raw id, a guest picked as captain didn't
    // match DraftBoard's prefixed roster: their name showed blank in the
    // captain slot AND they leaked back into the player pool (user report).
    const guests = (game.guests ?? []).filter((g) => !g.waitlisted).map((g) => ({
      id: toGuestRosterId(g.id),
      name: g.name,
    }));
    const active = new Set(activeDraftRosterIds(game));
    return [...players, ...guests].filter(player => active.has(player.id));
  }, [game, playersMap]);

  useEffect(() => {
    if (!game || game.id !== gameId || loadingGame) return;
    const registered = new Set(participants.map(player => player.id));
    const retained = captainIds.filter(id => registered.has(id));
    if (retained.length !== captainIds.length) {
      setCaptainIds(retained);
      setCaptainStep('captains');
    }
  }, [game, gameId, loadingGame, participants, captainIds]);

  // Resolve any roster id (uid or guest:<id>) → display identity for the
  // DnD editor. Falls back to a placeholder while the store hydrates.
  const resolveRoster = useCallback(
    (id: string) => participants.find((p) => p.id === id) ?? { id, name: '…' },
    [participants],
  );
  const hasTeams = !!game?.draftTeams?.teams?.length;

  // Step 0 — record which split method the manager picked, then advance.
  const chooseSplitMode = useCallback(
    (m: 'auto' | 'manual' | 'random' | 'free') => {
      logEvent(AnalyticsEvent.TeamsSplitMethodChosen, { gameId, method: m });
      if (m === 'manual') setCaptainStep('captains');
      setSplitMode(m);
    },
    [gameId],
  );

  const toggleCaptain = useCallback((uid: string) => {
    setCaptainIds((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid],
    );
  }, []);

  const numTeams = captainIds.length;
  // The number of captains is fixed by the team count chosen at game creation
  // (user request) — pick exactly this many, one per team. Clamp to the
  // supported range as a guard for legacy/missing values.
  const expectedCaptains = Math.min(
    MAX_TEAMS,
    Math.max(MIN_TEAMS, game?.numberOfTeams ?? MIN_TEAMS),
  );
  const previewTeams = expectedCaptains;

  // Validation: exactly `expectedCaptains` captains, and at least one
  // non-captain left to draft.
  const tooFew = numTeams < expectedCaptains;
  const tooMany = numTeams > expectedCaptains;
  const noPlayersLeft = numTeams >= participants.length && participants.length > 0;
  const captainsOk = numTeams === expectedCaptains && !noPlayersLeft
    && captainIds.every(id => participants.some(player => player.id === id));
  const canContinue = captainsOk && method !== null;

  const hint = noPlayersLeft
    ? he.draftNotEnoughPlayers
    : tooFew || tooMany
      ? he.draftPickExactCaptains(expectedCaptains)
      : method === null
        ? he.draftChooseOrder
        : null;

  const onContinue = () => {
    if (!canContinue || !method) return;
    logEvent(AnalyticsEvent.DraftBoardStarted, {
      gameId,
      numTeams,
      order: method,
      participants: participants.length,
    });
    nav.navigate('DraftBoard', { gameId, captainIds, method });
  };

  // "אוטומטי לפי דירוג" only makes sense where the admins keep internal
  // ratings; elsewhere it would score everyone neutral (= random anyway).
  const internalRating =
    myCommunities.find((c) => c.id === game?.groupId)?.internalRating === true;
  // Each team needs ≥1 player → cap the offered count at the roster size.
  const maxTeams = Math.min(MAX_TEAMS, participants.length);

  // Run an auto (rating) or random split, save it, and land on the editable
  // draft summary so the admin can tweak before it's final.
  const runGenerate = useCallback(async () => {
    if (!game || !currentUser || generating) return;
    if (participants.length < autoNumTeams) {
      toast.info(`נדרש לפחות שחקן אחד לכל קבוצה. חסרים ${autoNumTeams-participants.length} שחקנים.`);
      return;
    }
    const grp = myCommunities.find((c) => c.id === game.groupId);
    const activeGuests = (game.guests ?? []).filter((gu) => !gu.waitlisted);
    const playerIds = activeDraftRosterIds(game);
    // 'random' → no ratings (balanceTeams shuffles + splits evenly).
    const ratings: Record<string, number> = {};
    if (splitMode === 'auto') {
      for (const uid of game.players ?? []) {
        const r = grp?.adminRatings?.[uid];
        if (typeof r === 'number' && r > 0) ratings[uid] = r;
      }
      for (const gu of activeGuests) {
        if (typeof gu.estimatedRating === 'number' && gu.estimatedRating > 0) {
          ratings[toGuestRosterId(gu.id)] = gu.estimatedRating;
        }
      }
    }
    setGenerating(true);
    try {
      const computeStart = Date.now();
      // Recent splits drive the "don't rebuild last week's teams" half of the
      // balance. A failure or an empty history is fine — the split then falls
      // back to rating alone. 'random' mode ignores ratings AND history: it is
      // meant to be a genuine draw.
      const history =
        splitMode === 'auto'
          ? await gameService.getRecentSplits(game.groupId, {
              excludeGameId: game.id,
            })
          : [];
      const { result, unratedCount, gap, band, repeat, fallback, teamAverages } =
        balanceTeams({
          playerIds,
          ratings,
          numTeams: autoNumTeams,
          format: game.format,
          createdBy: currentUser.id,
          history,
          ...(splitMode === 'auto' && useCompletions ? {completionMode: 'balanced' as const} : {}),
        });
      // Auto/random balance is saved as a DRAFT (published:false) too — the
      // admin then reviews it in DraftBoard and publishes from MatchDetails.
      // Recorded on the game so a split can be explained after the fact: how
      // balanced it was, which tolerance band that put it in, how much of the
      // recent weeks it rebuilt, and whether the fallback had to run. No UI
      // reads this — it exists so the parameters get calibrated from real
      // weeks rather than from a feeling.
      await gameService.saveDraftTeams(
        game.id,
        { ...result, published: false },
        {
          generatedAt: Date.now(),
          algorithm: splitMode === 'random' ? 'random_even_v1' : 'rating_balanced_v2',
          unratedCount,
          teamRatings: teamAverages,
          gap: Math.round(gap * 1000) / 1000,
          band,
          repeat: Math.round(repeat * 100) / 100,
          fallback,
          historyGames: history.length,
        },
        true,
        game,
      );
      logEvent(AnalyticsEvent.TeamsGenerated, {
        gameId: game.id,
        method: splitMode ?? 'auto',
        numTeams: autoNumTeams,
        players: playerIds.length,
        unratedCount,
        gap: Math.round(gap * 1000) / 1000,
        band,
        fallback,
        historyGames: history.length,
        regenerate: hasTeams,
      });
      if (__DEV__) {
        console.log(
          `[autoBalance] gap=${gap.toFixed(3)} band=${band} repeat=${repeat.toFixed(2)}` +
            ` fallback=${fallback} history=${history.length} unrated=${unratedCount}`,
        );
      }
      // Anim 13 — the balance is computed locally (instant), so pad to a
      // minimal "computing" phase (spec floor ≥300ms) via the existing
      // `generating` loader, so the result never pops in. Capped, never padded
      // past the floor — the effect must not add real latency beyond that.
      const elapsed = Date.now() - computeStart;
      const floorMs = balanceTiming().minComputeMs;
      if (elapsed < floorMs) {
        await new Promise((r) => setTimeout(r, floorMs - elapsed));
      }
      if (splitMode === 'auto' && unratedCount > 0) {
        toast.info(he.autoBalanceUnrated(unratedCount));
      }
      nav.navigate('DraftBoard', {
        gameId: game.id,
        captainIds: result.teams.map((t) => t.captainId),
        method: 'snake',
        resume: true,
        expectedDraftCreatedAt: result.createdAt,
      });
    } catch (err) {
    observeCaughtError(err, {"source":"src/screens/games/DraftSetupScreen.tsx","handler":"DraftSetupScreen","site":"DraftSetupScreen:34c88f44e6"});
      logError('draftGenerate', err, { gameId: game.id, splitMode });
      logEvent(AnalyticsEvent.TeamsGenerateFailed, {
        gameId: game.id,
        method: splitMode ?? 'auto',
      });
      if (err instanceof Error && err.message === 'DRAFT_ROSTER_CHANGED') {
        const latest = await gameService.getGameById(game.id).catch((caughtError6a6b76580f: unknown) => { observeCaughtError(caughtError6a6b76580f, {"source":"src/screens/games/DraftSetupScreen.tsx","handler":"DraftSetupScreen","site":"DraftSetupScreen:6a6b76580f"}); return null; });
        if (latest) setGame(latest);
        toast.info('סגל המחזור השתנה בזמן החלוקה. בדקו את הנתונים וצרו כוחות מחדש.');
      } else toast.error(err instanceof Error && err.message === 'ROUND_CLOSED' ? 'לא ניתן ליצור כוחות במחזור שהסתיים או בוטל.' : he.autoBalanceError);
    } finally {
      setGenerating(false);
    }
  }, [
    game,
    currentUser,
    generating,
    participants.length,
    myCommunities,
    splitMode,
    autoNumTeams,
    hasTeams,
    useCompletions,
    nav,
  ]);

  if(loadingGame || openingExisting || loadFailed || !game || game.id!==gameId) return <SafeAreaView style={styles.root} edges={['top','bottom']}><ScreenHeader title={he.draftTitle}/><View style={{flex:1,alignItems:'center',justifyContent:'center',padding:24,gap:16}}>{loadFailed ? <><Text style={{color:colors.text,textAlign:'center'}}>לא הצלחנו לטעון את נתוני הכוחות</Text><Button title={he.retry} onPress={()=>setRetryLoad(value=>value+1)}/></> : <><ActivityIndicator color={colors.primary}/><Text style={{color:colors.textMuted,textAlign:'center'}}>טוענים את נתוני הכוחות</Text></>}</View></SafeAreaView>;

  if (previewCount && game && currentUser) {
    const {mockPlayers}=require('@/data/mockData') as typeof import('@/data/mockData');
    const previewPlayers=mockPlayers.slice(0,previewCount===3?21:25).map(p=>({id:p.id,name:p.displayName,avatarId:p.avatarId}));
    return <SafeAreaView style={styles.root} edges={['top','bottom']}><ManualAllocation key={`preview-${previewCount}`} preview game={{...game,id:`manual-preview-${previewCount}`,numberOfTeams:previewCount,format:'7v7'}} userId={currentUser.id} players={previewPlayers} count={previewCount} onBack={()=>nav.goBack()} onSaved={()=>undefined}/></SafeAreaView>;
  }

  if (splitMode === 'free' && game && currentUser) return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ManualAllocation key={`${currentUser.id}:${gameId}:${game.draftTeams?.createdAt ?? 0}:${editSavedTeams}`} game={game} userId={currentUser.id} players={participants} preferSaved={editSavedTeams} count={editSavedTeams ? game.draftTeams?.teams.length || expectedCaptains : expectedCaptains}
        onBack={() => {setEditSavedTeams(false);setSplitMode(null);}} onSaved={() => nav.navigate('MatchDetails', {gameId})}/>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={splitMode === 'auto' ? 'כוחות אוטומטיים' : splitMode === 'random' ? 'חלוקה אקראית' : he.draftTitle}
        onBack={splitMode === 'manual' ? () => captainStep === 'order' ? setCaptainStep('captains') : setSplitMode(null) : splitMode === 'auto' || splitMode === 'random' ? () => setSplitMode(null) : undefined} />
      <ScrollView
        key={`${splitMode ?? 'methods'}-${captainStep}`}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* Step 0 — pick a split METHOD. */}
        {splitMode === null ? (
          <>
            {game && <View style={styles.summaryCard}>
              <View pointerEvents="none" accessible={false} style={styles.summaryPitch}>
                <Svg width={120} height={85} viewBox="0 0 140 100"><Rect x={4} y={4} width={132} height={92} fill="none" stroke="#DEEBFC" strokeWidth={1.5}/><Line x1={70} y1={4} x2={70} y2={96} stroke="#DEEBFC"/><Circle cx={70} cy={50} r={19} fill="none" stroke="#DEEBFC"/><Rect x={4} y={30} width={20} height={40} fill="none" stroke="#DEEBFC"/><Rect x={116} y={30} width={20} height={40} fill="none" stroke="#DEEBFC"/></Svg>
              </View>
              <Text style={styles.summaryTitle}>נתוני הכוחות</Text>
              <View style={styles.summaryChips}>
                <View style={styles.summaryChip}><Ionicons name="people-outline" size={19} color="#315AAF"/><Text style={styles.summaryValue}>{participants.length} רשומים</Text></View>
                <View style={styles.summaryChip}><Ionicons name="shirt-outline" size={19} color="#315AAF"/><Text style={styles.summaryValue}>{expectedCaptains} קבוצות</Text></View>
                <View style={styles.summaryChip}><Ionicons name="football-outline" size={19} color="#315AAF"/><Text style={styles.summaryValue}>{game.format ? gameFormatLabel(game.format).replace(/\s*×\s*/, ' על ') : 'פורמט לא הוגדר'}</Text></View>
              </View>
            </View>}
            {hasTeams && <PressableScale style={styles.editExisting} accessibilityRole="button" accessibilityLabel={he.draftEditExistingTitle} disabled={openingExisting} onPress={async () => {
              logEvent(AnalyticsEvent.TeamsSplitMethodChosen, {gameId, method:'edit', numTeams:game?.draftTeams?.teams?.length ?? 0});
              setOpeningExisting(true);
              try {
                const latest = await gameService.getGameById(gameId);
                if (!latest) throw new Error('GAME_NOT_FOUND');
                setGame(latest);
                setEditSavedTeams(true);
                setSplitMode('free');
              } catch (error) {
    observeCaughtError(error, {"source":"src/screens/games/DraftSetupScreen.tsx","handler":"DraftSetupScreen","site":"DraftSetupScreen:9cbb95921b"});
                logError('openManualEdit', error, {gameId});
                toast.error('לא הצלחנו לטעון את הכוחות. נסו שוב.');
              } finally { setOpeningExisting(false); }
            }}><View style={styles.editExistingRow}><View style={styles.editExistingIcon}><Ionicons name="git-compare-outline" size={22} color="#2D68FF"/></View><Text style={styles.editExistingText}>{he.draftEditExistingTitle}</Text><Ionicons name="chevron-back" size={18} color="#6C80A5"/></View></PressableScale>}
            <Text style={styles.methodHeading}>איך נחלק היום?</Text>
            <MethodCard icon="shield-outline" title="כוחות אוטומטיים"
              subtitle="חלוקה לפי הדירוג הפנימי של המועדון"
              selected={selectedMode === 'auto' && internalRating} disabled={!game || !internalRating}
              badge={internalRating ? 'דירוג פנימי פעיל' : 'להפעלה, הפעילו דירוג פנימי בהגדרות המועדון'}
              onPress={() => setSelectedMode('auto')} />
            <MethodCard icon="people-outline" title="בחירת קפטנים"
              subtitle="בוחרים קפטנים ומחלקים שחקנים בתורות"
              selected={selectedMode === 'manual'} disabled={!game}
              onPress={() => setSelectedMode('manual')} />
            <MethodCard icon="hand-left-outline" title="חלוקה ידנית"
              subtitle="משבצים ומעבירים שחקנים בחופשיות בין הקבוצות"
              selected={selectedMode === 'free'} disabled={!game}
              onPress={() => setSelectedMode('free')} />
            <MethodCard icon="shuffle-outline" title="חלוקה אקראית"
              subtitle="חלוקה אקראית ומאוזנת בגודל, ללא דירוג"
              selected={selectedMode === 'random'} disabled={!game}
              onPress={() => setSelectedMode('random')} />

          </>
        ) : splitMode === 'manual' ? (
          <>
            <BackToMethods onPress={() => setSplitMode(null)} />
            <View style={styles.stepChip}>
              <Text style={styles.stepText}>{he.draftStepLabel(captainStep === 'captains' ? 1 : 2, 3)}</Text>
            </View>
            {captainStep === 'captains' ? <>
            <Text style={styles.sectionTitle}>{he.draftSetupSubtitle}</Text>

            {/* Players — tap to toggle captain */}
            <View style={styles.list}>
              {participants.map((u) => {
                const capIndex = captainIds.indexOf(u.id);
                const isCap = capIndex >= 0;
                return (
                  <PressableScale
                    key={u.id}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${u.name} · ${he.draftCaptainBadge}`}
                    accessibilityState={{ checked: isCap }}
                    onPress={() => toggleCaptain(u.id)}
                    style={[styles.playerRow, isCap && styles.playerRowActive]}
                  >
                    <View style={styles.playerRowInner}>
                      <View style={styles.playerIdentity}>
                        <UserAvatar user={u} size={44} />
                        <Text style={styles.playerName} numberOfLines={1}>
                          {u.name}
                        </Text>
                        {isCap ? (
                          <View style={styles.capBadge}>
                            <Ionicons name="shield-checkmark" size={13} color={colors.primary} />
                            <Text style={styles.capBadgeText}>{he.draftCaptainBadge}</Text>
                          </View>
                        ) : null}
                      </View>
                      <View style={[styles.check, isCap && styles.checkOn]}>
                        {isCap ? (
                          <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                        ) : null}
                      </View>
                    </View>
                  </PressableScale>
                );
              })}
              {participants.length === 0 ? (
                <Text style={styles.emptyHint}>{he.draftNotEnoughPlayers}</Text>
              ) : null}
            </View>

            </> : <>
            {/* Draft order */}
            <Text style={[styles.sectionTitle, styles.orderTitle]}>
              {he.draftOrderTitle}
            </Text>
            <Text style={styles.orderSubtitle}>{he.draftOrderSubtitle}</Text>

            <OrderOption
              selected={method === 'snake'}
              onPress={() => setMethod('snake')}
              order={previewPath(previewTeams, 'snake')}
              recommended
            />
            <OrderOption
              selected={method === 'regular'}
              onPress={() => setMethod('regular')}
              order={previewPath(previewTeams, 'regular')}
            />

            </>}
            {/* Teams-to-create info */}
            <View style={styles.teamsInfo}>
              <Ionicons name="people" size={18} color={colors.primary} />
              <Text style={styles.teamsInfoText}>
                {he.draftTeamsToCreate(numTeams || MIN_TEAMS)}
              </Text>
            </View>
          </>
        ) : (
          /* The configured team count is shared; each mode explains its own algorithm. */
          <>
            <DraftGenerationPreview mode={splitMode === 'auto' ? 'auto' : 'random'} players={participants.length} teams={autoNumTeams} format={game?.format}>
            {splitMode === 'auto' && autoNumTeams > 2 && participants.length < autoNumTeams * playersPerTeam(game?.format) ? (
              <PressableScale onPress={() => setUseCompletions(v => !v)} accessibilityRole="checkbox" accessibilityState={{checked: useCompletions}}
                style={{padding:20, marginTop:16, borderRadius:20, backgroundColor:'#EAF2FF', borderWidth:1, borderColor:'#C8DCFF'}}>
                <View style={{flexDirection:'row', alignItems:'center', gap:10}}>
                  <Ionicons name={useCompletions ? 'checkbox' : 'square-outline'} color={colors.primary} size={24}/>
                  <Text style={{fontSize:18, fontWeight:'800', color:colors.text, textAlign:RTL_LABEL_ALIGN}}>קבוצות עם השלמות</Text>
                </View>
                <Text style={[styles.autoHint,{marginTop:10}]}>מאזנים את קבוצות הבסיס וגם את ההרכבים האפשריים לאחר השלמה. לפני כל משחק בוחרים ידנית משלימים מהקבוצות שממתינות.</Text>
                <Text style={[styles.autoHint,{marginTop:8}]}>קבוצות הבסיס נשמרות. ההשלמה למשחק אחד בלבד.</Text>
              </PressableScale>
            ) : null}
            </DraftGenerationPreview>
          </>
        )}
      </ScrollView>

      {/* Sticky CTA — depends on the chosen method. The method picker itself
          has no footer (the cards are the action). */}
      {splitMode === 'manual' ? (
        <View style={styles.footer}>
          {(captainStep === 'captains' ? !captainsOk : !canContinue) && hint ? <Text style={styles.footerHint}>{hint}</Text> : null}
          <Button
            title={he.draftContinue}
            onPress={captainStep === 'captains' ? () => { if(captainsOk) setCaptainStep('order'); } : onContinue}
            disabled={captainStep === 'captains' ? !captainsOk : !canContinue}
            fullWidth
            size="lg"
          />
        </View>
      ) : splitMode ? (
        <View style={[styles.footer,styles.generateFooter]}>
          {participants.length < autoNumTeams && <Text style={styles.footerHint}>נדרש לפחות שחקן אחד לכל אחת מ־{autoNumTeams} הקבוצות</Text>}
          <Button
            title={he.draftGenerateCta}
            iconLeft={splitMode === 'random' ? 'shuffle-outline' : 'sparkles-outline'}
            style={styles.generateCta}
            onPress={runGenerate}
            disabled={participants.length < autoNumTeams || generating || openingExisting}
            loading={generating}
            fullWidth
            size="lg"
          />
        </View>
      ) : (
        <View style={styles.methodFooter}>
          <View style={styles.methodInfo}><Ionicons name="information-circle-outline" size={21} color="#526CA1"/><Text style={styles.methodInfoText}>אפשר לערוך את הקבוצות לפני שמתחילים</Text></View>
          <Button title="לחלוקת הקבוצות" iconLeft="arrow-back" size="lg" fullWidth style={styles.methodCta}
            disabled={!game || openingExisting || !selectedMode || (selectedMode === 'auto' && !internalRating)}
            onPress={() => { if (selectedMode && game && (selectedMode !== 'auto' || internalRating)) chooseSplitMode(selectedMode); }} />
        </View>
      )}


    </SafeAreaView>
  );
}

/** A single-choice card; selection stays local until the footer is pressed. */
function MethodCard({ icon, title, subtitle, onPress, selected, disabled, badge }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  selected: boolean;
  disabled?: boolean;
  badge?: string;
}) {
  return <PressableScale onPress={onPress} disabled={disabled}
    style={[styles.methodCard, selected && styles.methodSelected, disabled && styles.methodDisabled]}
    accessibilityRole="radio" accessibilityLabel={`${title}. ${subtitle}${badge ? `. ${badge}` : ''}`}
    accessibilityState={{checked:selected, disabled:!!disabled}}>
    <View style={styles.methodInner}>
      <View style={styles.methodIcon}><Ionicons name={icon} size={26} color={disabled ? '#8795AF' : '#12234D'}/></View>
      <View style={styles.methodText}>
        <Text style={styles.methodTitle}>{title}</Text>
        <Text style={styles.methodSub}>{subtitle}</Text>
        {!!badge && <View style={[styles.ratingBadge, disabled && styles.ratingDisabled]}><Text style={[styles.ratingText, disabled && styles.ratingDisabledText]}>{badge}</Text></View>}
      </View>
      <View style={[styles.radio, selected && styles.radioOn]}>{selected && <View style={styles.radioDot}/>}</View>
    </View>
  </PressableScale>;
}

/** "‹ חזרה לבחירת שיטה" link shown above a chosen method's content. */
function BackToMethods({ onPress }: { onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} style={styles.backRow}>
      {/* Row on the inner View — see HomeRoundCards. */}
      <View style={styles.backRowInner}>
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        <Text style={styles.backText}>{he.draftMethodBack}</Text>
      </View>
    </PressableScale>
  );
}

function OrderOption({
  selected,
  onPress,
  order,
  recommended,
}: {
  selected: boolean;
  onPress: () => void;
  order: number[];
  recommended?: boolean;
}) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={`${recommended ? he.draftRecommended + '. ' : ''}${he.draftOrderTitle}: ${order.map(n => n + 1).join(', ')}`}
      style={[styles.option, selected && styles.optionActive]}
    >
      <View style={styles.optionInner}>
        <View style={styles.optionBody}>
          {/* Fixed-height line reserved on BOTH options (badge or empty) so
              the two cards stay exactly the same height. */}
          <View style={styles.badgeLine}>
            {recommended ? (
              <View style={styles.recBadge}>
                <Ionicons name="star" size={11} color="#FFFFFF" />
                <Text style={styles.recBadgeText}>{he.draftRecommended}</Text>
              </View>
            ) : null}
          </View>
          <DraftOrderPath order={order} compact />
        </View>
        <View style={[styles.radio, selected && styles.radioOn]}>
          {selected ? <View style={styles.radioDot} /> : null}
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F8FF' },
  body: { padding: spacing.lg, paddingBottom: spacing.lg },
  stepChip: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    marginBottom: spacing.sm,
  },
  stepText: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  orHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  list: { gap: spacing.sm },
  playerRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  playerRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  playerIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
    minWidth: 0,
  },
  playerRowActive: { borderColor: colors.primary },
  playerName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
    textAlign: RTL_LABEL_ALIGN,
  },
  capBadge: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  capBadgeText: { ...typography.caption, color: colors.primary, fontWeight: '800' },
  check: {
    flexShrink: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  emptyHint: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  orderTitle: { marginTop: spacing.xxl },
  orderSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  option: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  optionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  optionActive: { borderColor: colors.primary },
  optionBody: { flex: 1 },
  // Reserved top line (same height on both cards) that holds the מומלץ
  // badge on the right — keeps the two options exactly the same height.
  badgeLine: {
    height: 22,
    flexDirection: 'row',
    justifyContent: 'flex-start', // right under RTL
    marginBottom: spacing.sm,
  },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  recBadgeText: { ...typography.caption, color: '#FFFFFF', fontWeight: '800' },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.primary },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  teamsInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  teamsInfoText: { ...typography.body, color: colors.primary, fontWeight: '800' },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  footerHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  generateFooter: {backgroundColor:'#F3F8FF',borderTopWidth:0,paddingTop:8},
  generateCta: {borderRadius:20,backgroundColor:'#2D68FF',borderColor:'#2D68FF',minHeight:58},
  // ── Method picker ──────────────────────────────────────────────────
  summaryCard: {padding:16,backgroundColor:'#FFF',borderRadius:24,borderWidth:1,borderColor:'#E2EDFC',marginBottom:22,overflow:'hidden'},
  summaryPitch: {position:'absolute',end:-8,top:-15,transform:[{rotate:'12deg'}]},
  summaryTitle: {fontSize:18,fontWeight:'700',color:'#12234D',textAlign:RTL_LABEL_ALIGN,marginBottom:14},
  summaryChips: {flexDirection:'row',flexWrap:'wrap',gap:8},
  summaryChip: {flexDirection:'row',alignItems:'center',gap:6,backgroundColor:'#EAF3FF',borderRadius:18,paddingHorizontal:11,paddingVertical:9},
  summaryValue: {fontSize:14,color:'#183A77'},
  methodHeading: {fontSize:26,fontWeight:'800',color:'#0C1942',textAlign:'center',marginBottom:18},
  methodCard: {backgroundColor:'#FFF',borderRadius:24,borderWidth:1.5,borderColor:'#E1EBFA',padding:18,marginBottom:12,minHeight:104},
  methodSelected: {borderColor:'#2D68FF',backgroundColor:'#F7FAFF'},
  methodDisabled: {backgroundColor:'#F0F3F8'},
  methodInner: {flexDirection:'row',alignItems:'center',gap:12},
  methodIcon: {width:44,height:44,borderRadius:22,backgroundColor:'#E8F1FF',alignItems:'center',justifyContent:'center'},
  methodText: {flex:1,gap:6},
  methodTitle: {fontSize:19,fontWeight:'800',color:'#0C1942',textAlign:RTL_LABEL_ALIGN},
  methodSub: {fontSize:14,lineHeight:21,color:'#6C7EA0',textAlign:RTL_LABEL_ALIGN},
  ratingBadge: {alignSelf:'flex-start',backgroundColor:'#DCF4EC',paddingHorizontal:10,paddingVertical:6,borderRadius:14,marginTop:4},
  ratingText: {fontSize:12,color:'#216D54',textAlign:RTL_LABEL_ALIGN},
  ratingDisabled: {backgroundColor:'#E2E8F2'},
  ratingDisabledText: {color:'#66758E'},
  editExisting: {padding:14,marginBottom:22,borderRadius:20,backgroundColor:'#FFFFFF',borderWidth:1,borderColor:'#D8E7FB'},
  editExistingIcon: {width:40,height:40,borderRadius:20,backgroundColor:'#E8F1FF',alignItems:'center',justifyContent:'center'},
  editExistingRow: {flexDirection:'row',alignItems:'center',gap:8},
  editExistingText: {flex:1,fontSize:15,fontWeight:'700',color:'#183A77',textAlign:RTL_LABEL_ALIGN},
  methodFooter: {paddingHorizontal:16,paddingBottom:8,gap:10},
  methodInfo: {flexDirection:'row',alignItems:'center',gap:9,padding:12,borderRadius:16,backgroundColor:'#E6F0FF'},
  methodInfoText: {flex:1,fontSize:13,color:'#315080',textAlign:RTL_LABEL_ALIGN},
  methodCta: {borderRadius:18,backgroundColor:'#2D68FF',borderColor:'#2D68FF'},
  backRow: {
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },
  backRowInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { ...typography.caption, color: colors.primary, fontWeight: '800' },
  // ── Team-count pills (auto/random) ─────────────────────────────────
  countRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  countPill: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPillOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  countPillText: { ...typography.h2, color: colors.text, fontWeight: '800' },
  countPillTextOn: { color: colors.primary },
  autoHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
