// Two players, one club — "יחד" and "ראש בראש" on a single screen.
//
// This screen replaces two surfaces that said different things about the same
// two people:
//
//   • the old PlayerCompareScreen — per-club totals, no pair record, no season
//   • PairStatsSection inside the player card — a full pair record, but read
//     from the GLOBAL `pairStats` document: a pair who play in two clubs
//     carried one club's numbers onto the other's screen, and nothing on it
//     could be filtered by season because that document has neither a club nor
//     a season on it.
//
// Everything here is ONE club and ONE slice of its history, because the hero
// names a club and a season and every number below has to belong to them.
//
// ── Which side is which ────────────────────────────────────────────────────
// The viewer is BLUE and sits on the visual LEFT; the other player is RED on
// the RIGHT. Under `forceRTL` the first child of a row lands on the RIGHT, so
// the other player is written FIRST everywhere — hero, bars, tiles. That looks
// backwards in the source and is the only way to get the reference's layout.
// The pairing never changes between sections: a colour that meant "you" in the
// hero cannot mean the opponent four cards down.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { captureRef } from 'react-native-view-shot';

import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { PlayerCompareCard } from '@/components/compare/PlayerCompareCard';
import {
  SeasonScopeBar,
  buildScopeOptions,
  clubHasScopes,
  scopeTitleOf,
  type ScopeSeason,
  type StatsScope,
} from '@/components/stats/SeasonScopeBar';
import {
  pairCompareService,
  type CompareRow,
  type PairCompareModel,
} from '@/services/pairCompareService';
import { groupService } from '@/services/groupService';
import { seasonHistoryService } from '@/services/seasonHistoryService';
import { useUserStore } from '@/store/userStore';
import { toast } from '@/components/Toast';
import { logEvent, AnalyticsEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { clubShadow, clubSurface } from '@/theme/clubAccents';
import { he } from '@/i18n/he';
import type { GroupSeasons } from '@/types';
import type { GameStackParamList } from '@/navigation/GameStack';

/**
 * This screen's own stadium — a bright, wide, empty pitch.
 *
 * NOT the shared `stadium-bg.png`: that one is a night shot and six other
 * surfaces use it (the match hero, the club hero, the profile card, two card
 * components). Swapping it would have redecorated all of them.
 *
 * The file is 1600×586 — 2.7:1, far wider than any hero box — so `cover`
 * crops the SIDES and keeps the centre circle centred, which is the whole
 * reason it was shot that wide. Nothing is drawn into it: the avatars, the
 * rings, the VS and the names are all layers above.
 */
const STADIUM_BG: ImageSourcePropType = require('../../assets/images/pair-stadium-bg.png');

/** You, and them. Fixed for the life of the screen. */
const BLUE = '#2563EB';
const RED = '#DC2626';
const RED_SOFT = '#FEE2E2';
const GREEN = '#16A34A';

type Params = RouteProp<GameStackParamList, 'PlayerCompare'>;
type Tab = 'together' | 'h2h';

export function PlayerCompareScreen() {
  const { groupId, otherUid } = useRoute<Params>().params;
  const nav = useNavigation<{ goBack: () => void }>();
  const viewerId = useUserStore((s) => s.currentUser?.id ?? '');
  const shareRef = useRef<View>(null);

  const [tab, setTab] = useState<Tab>('together');
  const [scope, setScope] = useState<StatsScope>({ k: 'current' });
  const [scopeOpen, setScopeOpen] = useState(false);
  const [seasons, setSeasons] = useState<GroupSeasons | undefined>(undefined);
  const [pastSeasons, setPastSeasons] = useState<ScopeSeason[]>([]);
  // Whether the archive list has come back. An empty list is a real answer for
  // a club that has closed nothing, and an unfinished fetch for one that has —
  // and "כל העונות" cannot be summed before the difference is known.
  const [seasonsLoaded, setSeasonsLoaded] = useState(false);
  const [model, setModel] = useState<PairCompareModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

  // ── The club, and what slices it has ──────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      const g = await groupService.get(groupId).catch(() => null);
      if (!alive) return;
      setSeasons(g?.seasons);
      // Only a club that has actually closed one pays for the list.
      if ((g?.seasons?.count ?? 0) > 0) {
        const list = await seasonHistoryService.list(groupId).catch(() => 'error' as const);
        if (!alive) return;
        if (list !== 'error') {
          setPastSeasons(list.map((s) => ({ seasonId: s.seasonId, no: s.no })));
        }
      }
      if (alive) setSeasonsLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [groupId]);

  // ── The numbers, for the slice on screen ──────────────────────────────────
  useEffect(() => {
    if (!viewerId || !seasonsLoaded) return;
    let alive = true;
    setLoading(true);
    (async () => {
      const m = await pairCompareService.load({
        groupId,
        viewerId,
        otherId: otherUid,
        scope,
        pastSeasonIds: pastSeasons.map((s) => s.seasonId),
        seasons,
      });
      if (!alive) return;
      // A slice that will not load is not an empty one. Falling back to the
      // running season beats printing one scope's numbers under another's
      // heading — the same refusal the club stats screen makes.
      if (!m && scope.k !== 'current') {
        setScope({ k: 'current' });
        return;
      }
      setModel(m);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [groupId, viewerId, otherUid, scope, pastSeasons, seasons, seasonsLoaded]);

  const scopeOptions = useMemo(
    () => buildScopeOptions(seasons, pastSeasons, scope),
    [seasons, pastSeasons, scope],
  );
  const showScopeBar = clubHasScopes(seasons, pastSeasons);

  const onShare = useCallback(async () => {
    if (!shareRef.current || sharing || !model) return;
    setSharing(true);
    try {
      const uri = await captureRef(shareRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: he.compareShareTitle,
        });
        logEvent(AnalyticsEvent.SummaryShared, { compare: otherUid });
      } else {
        toast.error(he.summaryShareUnavailable);
      }
    } catch (err) {
      logError('sharePlayerCompare', err, { groupId, otherUid });
      toast.error(he.summaryShareFailed);
    } finally {
      setSharing(false);
    }
  }, [groupId, otherUid, sharing, model]);

  return (
    <View style={styles.root}>
      <Hero
        model={model}
        onBack={() => nav.goBack()}
        onShare={model ? onShare : undefined}
        sharing={sharing}
      />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* A row of its OWN, above the tabs — it scopes both of them. */}
        {showScopeBar ? (
          <SeasonScopeBar
            options={scopeOptions}
            open={scopeOpen}
            onToggle={() => setScopeOpen((v) => !v)}
            onSelect={(s) => {
              setScope(s);
              setScopeOpen(false);
            }}
          />
        ) : null}

        <Segmented
          tab={tab}
          onChange={(t) => {
            setTab(t);
            logEvent(AnalyticsEvent.PlayerCompareOpened, {
              groupId,
              otherUid,
              tab: t,
              scope: scope.k,
            });
          }}
        />

        {loading ? (
          <View style={styles.center}>
            <SoccerBallLoader />
          </View>
        ) : !model ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>{he.compareUnavailable}</Text>
          </Card>
        ) : tab === 'together' ? (
          <TogetherTab model={model} />
        ) : (
          <HeadToHeadTab model={model} />
        )}
      </ScrollView>

      {/* The share asset, rendered off-screen.
          A single flat image is the only shape that makes sense as a PNG — it
          has no tabs and no scope control — but it is built from THIS screen's
          model and wears this screen's clothes, so the PNG is recognisably the
          page it came from. The scope title rides along because a shared image
          outlives the screen, and a number without its window says nothing. */}
      {model ? (
        <View style={styles.offscreen} pointerEvents="none">
          <PlayerCompareCard
            ref={shareRef}
            model={model}
            scopeLabel={showScopeBar ? scopeTitleOf(scopeOptions) : undefined}
          />
        </View>
      ) : null}
    </View>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────

function Hero({
  model,
  onBack,
  onShare,
  sharing,
}: {
  model: PairCompareModel | null;
  onBack: () => void;
  onShare?: () => void;
  sharing: boolean;
}) {
  const a = model?.a;
  const b = model?.b;
  return (
    <ImageBackground source={STADIUM_BG} style={styles.hero} resizeMode="cover">
      {/* Two scrims, not one flat wash.
          The pitch is bright and the UI on it is white, so the contrast has
          to be put back exactly where the text sits: a soft dark band under
          the top bar, and a second under the names. The middle — the pitch
          and the floodlights the photo was chosen for — stays clear. */}
      <LinearGradient
        colors={['rgba(5,16,40,0.58)', 'rgba(5,16,40,0.12)', 'rgba(5,16,40,0.00)']}
        locations={[0, 0.45, 1]}
        style={styles.scrimTop}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['rgba(5,16,40,0.00)', 'rgba(5,16,40,0.45)']}
        style={styles.scrimBottom}
        pointerEvents="none"
      />
      <SafeAreaView edges={['top']}>
        <View style={styles.heroBar}>
          {/* Back FIRST → the leading (right) edge. `chevron-forward` auto-flips
              under RTL so it points the way back. */}
          <Pressable
            onPress={onBack}
            hitSlop={14}
            style={({ pressed }) => [styles.heroBtn, pressed && { opacity: 0.65 }]}
            accessibilityRole="button"
            accessibilityLabel={he.back}
          >
            <Ionicons name="chevron-forward" size={21} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.heroClub} numberOfLines={1}>
            {model?.club.name || he.compareTitle}
          </Text>
          {onShare ? (
            <Pressable
              onPress={onShare}
              hitSlop={14}
              disabled={sharing}
              style={({ pressed }) => [styles.heroBtn, pressed && { opacity: 0.65 }]}
              accessibilityRole="button"
              accessibilityLabel={he.compareShareCta}
            >
              {sharing ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Ionicons name="share-social" size={19} color="#FFFFFF" />
              )}
            </Pressable>
          ) : (
            <View style={styles.heroBtn} />
          )}
        </View>

        <View style={styles.heroPair}>
          {/* OTHER player first → visual RIGHT, red. See the note at the top. */}
          <HeroSide side={b} tint={RED} />
          <View style={styles.vsWrap}>
            {/* A soft disc behind the letters rather than a glowing badge: it
                is a separator between two faces, not a third element. */}
            <View style={styles.vsDisc} />
            <Text style={styles.vs}>VS</Text>
          </View>
          <HeroSide side={a} tint={BLUE} />
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

function HeroSide({
  side,
  tint,
}: {
  side: PairCompareModel['a'] | undefined;
  tint: string;
}) {
  return (
    <View style={styles.heroSide}>
      <View style={[styles.heroRing, { borderColor: tint }]}>
        <UserAvatar
          user={
            side
              ? {
                  id: side.uid,
                  name: side.name,
                  avatarId: side.avatarId,
                  photoUrl: side.photoUrl,
                }
              : null
          }
          size={78}
        />
      </View>
      {/* One line, shrinking before it truncates: a long Latin name is common
          here and "Eliran Tza…" reads worse than the same name a point
          smaller. `adjustsFontSizeToFit` is the pattern the club tab bar
          already uses for the same reason. */}
      <Text
        style={styles.heroName}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {side?.name ?? ''}
      </Text>
    </View>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────

function Segmented({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  // "יחד" is the first tab, so it is written first and lands on the visual
  // RIGHT — the leading position in Hebrew.
  const opts: { key: Tab; label: string }[] = [
    { key: 'together', label: he.pairTabTogether },
    { key: 'h2h', label: he.pairTabH2H },
  ];
  return (
    <View style={styles.segWrap}>
    <View style={styles.segTrack}>
      {opts.map((o) => {
        const on = tab === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[styles.segItem, on && styles.segItemOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.segLabel, on && styles.segLabelOn]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
    </View>
  );
}

// ── "יחד" ───────────────────────────────────────────────────────────────────

function TogetherTab({ model }: { model: PairCompareModel }) {
  const { pair, together, a, b } = model;

  // Never shared a mini-game in this slice. Six cards of zeros would say the
  // pair is bad at playing together; they have not played together.
  if (pair.roundsTogether === 0) {
    return (
      <Card style={styles.emptyCard}>
        <Ionicons name="people-outline" size={30} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>{he.pairTogetherEmpty}</Text>
        {pair.roundsAgainst > 0 ? (
          <Text style={styles.emptyText}>{he.pairTogetherEmptyButRivals}</Text>
        ) : null}
        <SinceNote at={model.chemistrySince} />
      </Card>
    );
  }

  return (
    <>
      <Card style={styles.card}>
        <SectionTitle
          icon="people"
          text={he.pairTogetherTitle}
          sub={he.pairTogetherSub(a.name, b.name)}
        />
        <View style={styles.tiles}>
          {/* Right to left: the headline count, then the two outcomes. */}
          <Tile
            icon="football"
            tint={colors.primary}
            value={pair.roundsTogether}
            label={he.pairRoundsTogether}
          />
          <Tile
            icon="trophy"
            tint={GREEN}
            value={pair.winsTogether}
            label={he.pairWinsTogether}
          />
          <Tile
            icon="close-circle"
            tint={RED}
            value={pair.lossesTogether}
            label={he.pairLossesTogether}
          />
        </View>
        {/* Draws get a quieter line rather than a fourth tile: they are the
            leftover of the three above, not a fourth outcome to weigh. */}
        {pair.tiesTogether > 0 ? (
          <Text style={styles.tilesNote}>
            {he.pairTiesTogetherNote(pair.tiesTogether)}
          </Text>
        ) : null}
      </Card>

      <Card style={styles.card}>
        <SectionTitle icon="stats-chart" text={he.pairTogetherFormTitle} />
        {together.winPct !== null ? (
          <SoloBar
            icon="trophy"
            label={he.pairWinPctTogether}
            value={`${together.winPct}%`}
            fill={together.winPct / 100}
          />
        ) : (
          <Text style={styles.rowNote}>{he.pairWinPctUndecided}</Text>
        )}
        <CleanSheetRow
          value={pair.cleanSheetsTogether}
          pct={together.cleanSheetPct}
        />
      </Card>

      {/* Direct assists — the one attacking fact the per-club rollup actually
          stores, and the only one on this tab that has a direction. */}
      {together.assistsTotal > 0 ? (
        <Card style={styles.card}>
          <SectionTitle icon="git-network" text={he.pairAssistsTitle} />
          <AssistFlow
            from={a.name}
            to={b.name}
            fromTint={BLUE}
            value={pair.assistsViewerToOther}
          />
          <AssistFlow
            from={b.name}
            to={a.name}
            fromTint={RED}
            value={pair.assistsOtherToViewer}
          />
        </Card>
      ) : null}

      <SinceNote at={model.chemistrySince} />
    </>
  );
}

// ── "ראש בראש" ──────────────────────────────────────────────────────────────

function HeadToHeadTab({ model }: { model: PairCompareModel }) {
  const { pair, h2h, a, b, comparison, verdict, rankA, rankB, rankTotal } = model;
  const bothPlayed = a.played && b.played;

  return (
    <>
      {/* ── 1. The direct record ──────────────────────────────────────────
          A SCOREBOARD, not three tiles. The "יחד" tab already uses tiles for
          a snapshot of one shared record; this is two people against each
          other, and the shape should say so before the numbers do. */}
      <Card style={styles.card}>
        <SectionTitle icon="git-compare" text={he.pairH2HTitle} />
        {pair.roundsAgainst === 0 ? (
          <Text style={styles.rowNote}>{he.pairH2HEmpty}</Text>
        ) : (
          <>
            <View style={styles.board}>
              {/* Other player first → visual RIGHT, red. */}
              <View style={styles.boardSide}>
                <Text style={[styles.boardScore, { color: RED }]}>
                  {String(pair.winsOther)}
                </Text>
                <Text style={styles.boardName} numberOfLines={1}>
                  {b.name}
                </Text>
              </View>
              <Text style={styles.boardColon}>:</Text>
              <View style={styles.boardSide}>
                <Text style={[styles.boardScore, { color: BLUE }]}>
                  {String(pair.winsViewer)}
                </Text>
                <Text style={styles.boardName} numberOfLines={1}>
                  {a.name}
                </Text>
              </View>
            </View>
            <Text style={styles.boardCaption}>{he.pairH2HWinsCaption}</Text>

            <View style={styles.boardMeta}>
              <View style={styles.boardChip}>
                <Ionicons name="football" size={13} color={colors.textMuted} />
                <Text style={styles.boardChipText}>
                  {he.pairRoundsAgainstChip(pair.roundsAgainst)}
                </Text>
              </View>
              {pair.tiesAgainst > 0 ? (
                <View style={styles.boardChip}>
                  <Ionicons name="remove" size={13} color={colors.textMuted} />
                  <Text style={styles.boardChipText}>
                    {he.pairTiesAgainstChip(pair.tiesAgainst)}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.leadRow}>
              <Ionicons
                name={h2h.leader === 'tie' ? 'remove-circle' : 'ribbon'}
                size={16}
                color={
                  h2h.leader === 'tie'
                    ? colors.textMuted
                    : h2h.leader === 'a'
                      ? BLUE
                      : RED
                }
              />
              <Text style={styles.leadText}>
                {h2h.leader === 'tie'
                  ? he.pairSeriesLevel
                  : he.pairSeriesLeader(h2h.leader === 'a' ? a.name : b.name)}
              </Text>
            </View>
          </>
        )}
      </Card>

      {/* ── 2. The general comparison ─────────────────────────────────────
          A separate card, because it is a separate question: not how these
          two did against each other, but how each did in the club. */}
      <Card style={styles.card}>
        <SectionTitle icon="bar-chart" text={he.pairCompareTitle} />

        {!bothPlayed ? (
          <Text style={styles.rowNote}>
            {he.pairDidNotPlayScope(a.played ? b.name : a.name)}
          </Text>
        ) : null}

        {/* Who is ahead, in one line.
            The share card has carried this verdict since it was written; the
            SCREEN did not, so a reader had to tally eleven rows by eye to
            answer the first question they arrive with — "am I ahead?"
            (Pulse, מתן לוי). Same `verdict` the card uses, so the two cannot
            disagree. Hidden when only one of them played the slice: there is
            no contest to call. */}
        {bothPlayed && verdict.total > 0 ? (
          <View style={styles.verdictRow}>
            <Ionicons
              name={verdict.leader === 'tie' ? 'swap-horizontal' : 'trophy'}
              size={15}
              color={
                verdict.leader === 'a' ? BLUE : verdict.leader === 'b' ? RED : colors.textMuted
              }
            />
            <Text style={styles.verdictText} numberOfLines={2}>
              {verdict.leader === 'tie'
                ? he.pairVerdictTie(verdict.aLeads, verdict.total)
                : verdict.leader === 'a'
                  ? he.pairVerdictYou(verdict.aLeads, verdict.total)
                  : he.pairVerdictThem(b.name, verdict.bLeads, verdict.total)}
            </Text>
          </View>
        ) : null}

        {/* Rank leads the section and carries NO bar.
            Every other row's bar is a share of a total and the longer side is
            the better one. A position is the opposite — #1 beats #5 — so a
            proportional bar would draw the leader with the shorter stripe. */}
        {rankA != null && rankB != null ? (
          <View style={styles.rankRow}>
            <View style={styles.rankSide}>
              <Text
                style={[
                  styles.rankValue,
                  { color: RED },
                  rankB < rankA && styles.cmpWin,
                ]}
              >{`#${rankB}`}</Text>
            </View>
            <View style={styles.rankMid}>
              <Ionicons name="trophy" size={15} color={colors.textMuted} />
              <Text style={styles.rankLabel}>{he.pairRankLabelShort}</Text>
              <Text style={styles.rankOf}>{he.pairRankOf(rankTotal)}</Text>
            </View>
            <View style={styles.rankSide}>
              <Text
                style={[
                  styles.rankValue,
                  { color: BLUE },
                  rankA < rankB && styles.cmpWin,
                ]}
              >{`#${rankA}`}</Text>
            </View>
          </View>
        ) : null}

        {comparison.map((r) => (
          <CompareBar key={r.key} row={r} />
        ))}
      </Card>
    </>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function SectionTitle({
  icon,
  text,
  sub,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  sub?: string;
}) {
  return (
    <View style={styles.sectionHead}>
      {/* Icon first → visual RIGHT, matching every other heading in the app. */}
      <Ionicons name={icon} size={18} color={colors.primary} />
      <View style={styles.sectionTexts}>
        <Text style={styles.sectionTitle}>{text}</Text>
        {sub ? (
          <Text style={styles.sectionSub} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Tile({
  icon,
  tint,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  value: number;
  label: string;
}) {
  return (
    <View style={styles.tile}>
      {/* The tint lives on the disc and the number. The card stays neutral —
          three fully coloured cards side by side read as a warning. */}
      <View style={[styles.tileIcon, { backgroundColor: `${tint}1A` }]}>
        <Ionicons name={icon} size={15} color={tint} />
      </View>
      <Text style={[styles.tileValue, { color: tint }]}>{String(value)}</Text>
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

/**
 * One number that belongs to BOTH of them — a rate, a count — with a thin
 * rail under it.
 *
 * Label and value share the top line so the value can be the biggest thing
 * in the row; the rail sits under both, full width, and stays thin. A bar
 * that is as loud as its number competes with it.
 */
function SoloBar({
  icon,
  label,
  value,
  fill,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  fill: number;
}) {
  const pct = Math.max(0, Math.min(1, fill));
  return (
    <View style={styles.soloRow}>
      <View style={styles.soloHead}>
        <Ionicons name={icon} size={16} color={colors.primary} />
        <Text style={styles.soloLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.soloValue}>{value}</Text>
      </View>
      <View style={styles.soloTrack}>
        <View style={[styles.soloFill, { width: `${pct * 100}%` }]} />
      </View>
    </View>
  );
}

/**
 * Clean sheets, given their own shape.
 *
 * It is the most interesting number on this tab and it is NOT another
 * percentage: shown as a third rail beside the win rate it read as one. A
 * shield, the count, and the share underneath.
 */
function CleanSheetRow({ value, pct }: { value: number; pct: number | null }) {
  return (
    <View style={styles.csRow}>
      <View style={styles.csIcon}>
        <Ionicons name="shield-checkmark" size={19} color={colors.primary} />
      </View>
      <View style={styles.csTexts}>
        <Text style={styles.csValue}>{he.pairCleanSheetsValue(value)}</Text>
        {pct !== null ? (
          <Text style={styles.csCaption}>{he.pairCleanSheetPct(pct)}</Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Who set up whom, and how often — as a flow, not a settings row.
 *
 * The two names with an arrow between them say the direction at a glance;
 * the count is the loudest thing in the card. `chevron-back` is used rather
 * than a literal "←" because an arrow GLYPH is bidi-neutral and flips with
 * the surrounding text, while the icon is mirrored by the layout itself and
 * always points the way the row reads.
 */
function AssistFlow({
  from,
  to,
  fromTint,
  value,
}: {
  from: string;
  to: string;
  fromTint: string;
  value: number;
}) {
  const toTint = fromTint === BLUE ? RED : BLUE;
  return (
    <View style={styles.assistCard}>
      <View style={styles.assistFlow}>
        {/* Source first → visual RIGHT, where the sentence starts. */}
        <View style={styles.assistNames}>
          <Text style={[styles.assistName, { color: fromTint }]} numberOfLines={1}>
            {from}
          </Text>
          <Ionicons name="chevron-back" size={14} color={colors.textMuted} />
          <Text style={[styles.assistName, { color: toTint }]} numberOfLines={1}>
            {to}
          </Text>
        </View>
        <Text style={styles.assistUnit}>{he.pairAssistsUnit(value)}</Text>
      </View>
      <Text style={[styles.assistValue, { color: fromTint }]}>{String(value)}</Text>
    </View>
  );
}

function fmt(v: number | null, format: CompareRow['format']): string {
  if (v === null) return '—';
  if (format === 'pct') return `${v}%`;
  if (format === 'avg1') return v.toFixed(1);
  return String(v);
}

/**
 * One comparison row: a value on each side, the label between them, and a
 * two-coloured bar whose split is the TRUE ratio of the two numbers.
 *
 * No minimum visual length. A 0 is drawn as nothing, because a sliver of
 * colour under a zero reads as "a little" and the answer is "none".
 */
function CompareBar({ row }: { row: CompareRow }) {
  const av = row.a ?? 0;
  const bv = row.b ?? 0;
  const total = av + bv;
  // Both at zero → a neutral track, split down nobody's middle.
  const aShare = total > 0 ? av / total : 0;
  const known = row.a !== null && row.b !== null;
  const aWins = known && av > bv && total > 0;
  const bWins = known && bv > av && total > 0;

  return (
    <View style={styles.cmpRow}>
      {/* OTHER player first → visual RIGHT, red.
          The leading side also gets a soft disc behind its number: weight
          alone was too quiet to find at a glance down eleven rows (asked for
          directly). The disc is the side's OWN colour at low opacity, so the
          number never leaves the colour that identifies whose it is. */}
      <Text
        style={[
          styles.cmpValue,
          styles.cmpValueB,
          bWins && styles.cmpWin,
          bWins && styles.cmpLeadB,
        ]}
      >
        {fmt(row.b, row.format)}
      </Text>
      <View style={styles.cmpMid}>
        <Text style={styles.cmpLabel} numberOfLines={1}>
          {row.label}
        </Text>
        <View style={styles.cmpTrack}>
          {total > 0 ? (
            <>
              {/* Written first → fills from the RIGHT, which is the other
                  player's side. The two widths always sum to the full track. */}
              <View
                style={[
                  styles.cmpFill,
                  { width: `${(1 - aShare) * 100}%`, backgroundColor: RED_SOFT },
                ]}
              />
              <View
                style={[
                  styles.cmpFill,
                  { width: `${aShare * 100}%`, backgroundColor: BLUE },
                ]}
              />
            </>
          ) : null}
        </View>
      </View>
      <Text
        style={[
          styles.cmpValue,
          styles.cmpValueA,
          aWins && styles.cmpWin,
          aWins && styles.cmpLeadA,
        ]}
      >
        {fmt(row.a, row.format)}
      </Text>
    </View>
  );
}

/**
 * When the club's pair counters start.
 *
 * Without it "26 משחקונים יחד" reads as a lifetime, and for every club in the
 * app it is not one: the per-club pair rollup began in mid-2026. The date is
 * read from the club's own `chemistrySince`, never written here.
 */
function SinceNote({ at }: { at: number | null }) {
  if (!at) return null;
  const d = new Date(at).toLocaleDateString('he-IL', {
    month: 'long',
    year: 'numeric',
  });
  return <Text style={styles.sinceNote}>{he.pairSince(d)}</Text>;
}

/**
 * One spacing system, one radius system.
 *
 *   SCREEN   the gutter every card sits inside
 *   BLOCK    the gap between two cards — the biggest gap on the page
 *   ROW      the gap between two rows inside one card
 *   R        the card radius. Exactly two values exist on this screen: this
 *            one for cards, and `pill` for the things that are pills.
 */
const SCREEN = spacing.lg;   // 16
const BLOCK = spacing.lg;    // 16
const ROW = spacing.md;      // 12
const R = radius.xl;         // 20

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  // Bottom padding clears the tab bar and leaves the footnote room to sit
  // under the last card rather than against it.
  scroll: {
    paddingHorizontal: SCREEN,
    paddingTop: BLOCK,
    paddingBottom: spacing.xxxl,
    gap: BLOCK,
  },
  center: { paddingVertical: spacing.xxxl, alignItems: 'center' },
  offscreen: { position: 'absolute', left: -10000, top: 0, width: 360 },

  // ── hero ──
  hero: { backgroundColor: '#0B1B3A' },
  // Contrast only where text sits; the middle of the photo stays clear.
  scrimTop: { position: 'absolute', left: 0, right: 0, top: 0, height: 150 },
  scrimBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 110 },
  heroBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    gap: spacing.sm,
  },
  heroBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,22,48,0.34)',
  },
  heroClub: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    textShadowColor: 'rgba(5,16,40,0.55)',
    textShadowRadius: 6,
  },
  // Room to breathe: the pair sits in the middle of the photo rather than
  // crowding the top bar, and the gap between the two faces is wide enough
  // for the VS to belong to neither of them.
  heroPair: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  heroSide: { alignItems: 'center', gap: spacing.sm, width: 112 },
  heroRing: {
    borderWidth: 3,
    borderRadius: 999,
    padding: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
    // A soft drop, so the circle lifts off the grass instead of sitting in it.
    shadowColor: '#07122D',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  heroName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    textShadowColor: 'rgba(5,16,40,0.6)',
    textShadowRadius: 6,
  },
  vsWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  vsDisc: {
    ...StyleSheet.absoluteFillObject,
    margin: -9,
    borderRadius: 999,
    backgroundColor: 'rgba(37,99,235,0.30)',
  },
  vs: {
    fontSize: 19,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1.5,
    textShadowColor: 'rgba(5,16,40,0.7)',
    textShadowRadius: 8,
  },

  // ── segmented ──
  // Sits a little closer to the season bar than to the content below it:
  // the two are controls, what follows is the answer.
  segWrap: { marginTop: -spacing.xs },
  segTrack: {
    flexDirection: 'row',
    backgroundColor: clubSurface.divider,
    borderRadius: radius.pill,
    padding: 4,
    gap: 4,
  },
  segItem: {
    flex: 1,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segItemOn: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  segLabel: { fontSize: 14.5, fontWeight: '700', color: '#475569' },
  segLabelOn: { color: '#FFFFFF', fontWeight: '800' },

  // ── cards ──
  card: { gap: ROW, borderRadius: R, paddingVertical: spacing.lg },
  emptyCard: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    borderRadius: R,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  emptyText: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  sectionHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  sectionTexts: { flex: 1, minWidth: 0 },
  sectionTitle: {
    fontSize: 16.5,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  sectionSub: {
    fontSize: 12.5,
    fontWeight: '500',
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 1,
  },

  // ── KPI tiles ──
  // The tint is on the ICON and the NUMBER, never on the card. Three fully
  // coloured cards in a row read as a warning, not as a snapshot.
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: spacing.md,
    paddingHorizontal: 4,
    borderRadius: radius.lg,
    backgroundColor: '#F6F8FC',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E7ECF4',
  },
  tileIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileValue: { fontSize: 25, fontWeight: '900', fontVariant: ['tabular-nums'] },
  tileLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
  },
  tilesNote: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: -2,
  },

  // ── single-value rows ──
  soloRow: { gap: spacing.xs, paddingVertical: 2 },
  soloHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  soloLabel: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  // The value outweighs its label — it is what the row is for.
  soloValue: {
    fontSize: 21,
    fontWeight: '900',
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  soloTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EDF1F7',
    overflow: 'hidden',
    flexDirection: 'row',
  },
  soloFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  soloCaption: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },

  // ── clean sheets: its own small card, not a third percentage ──
  csRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#F2F7FF',
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  csIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE9FF',
  },
  csTexts: { flex: 1, minWidth: 0 },
  csValue: {
    fontSize: 17,
    fontWeight: '900',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  csCaption: {
    fontSize: 12.5,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },

  // ── direct assists: a pair card, not a settings row ──
  assistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: '#F6F8FC',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E7ECF4',
  },
  assistFlow: { flex: 1, minWidth: 0, gap: 3 },
  assistNames: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  assistName: { fontSize: 13.5, fontWeight: '800', flexShrink: 1 },
  assistUnit: { fontSize: 12, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  assistValue: { fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] },

  // ── head-to-head scoreboard ──
  board: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  boardSide: { flex: 1, alignItems: 'center', gap: 2 },
  boardScore: { fontSize: 40, fontWeight: '900', fontVariant: ['tabular-nums'] },
  boardName: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.textMuted,
    textAlign: 'center',
  },
  boardColon: { fontSize: 26, fontWeight: '800', color: '#C7D0DD', marginBottom: 14 },
  boardCaption: {
    fontSize: 12.5,
    color: colors.textMuted,
    textAlign: 'center',
  },
  boardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  boardChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F6F8FC',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  boardChipText: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },

  leadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: spacing.xs,
  },
  leadText: { fontSize: 14, fontWeight: '800', color: colors.text },

  // ── rank: its own row, never a bar ──
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F6F8FC',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rankSide: { flex: 1, alignItems: 'center', gap: 1 },
  rankValue: { fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] },
  rankMid: { alignItems: 'center', gap: 1, paddingHorizontal: spacing.sm },
  rankLabel: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },
  rankOf: { fontSize: 11.5, color: colors.textMuted },

  // ── comparison ──
  cmpRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 3 },
  cmpMid: { flex: 1, minWidth: 0, gap: 5, alignItems: 'center' },
  cmpLabel: { fontSize: 12.5, color: colors.textMuted, fontWeight: '600' },
  cmpTrack: {
    width: '100%',
    height: 5,
    borderRadius: 3,
    backgroundColor: '#EDF1F7',
    overflow: 'hidden',
    flexDirection: 'row',
  },
  cmpFill: { height: 5 },
  // The values outweigh the label they sit beside.
  // The padding lives HERE, on every value, not on the lead styles below.
  // When only the leading number carried it, its disc pushed those digits a
  // few points off the edge the rest of the column was flush with, and the
  // numbers stopped lining up (reported). The disc is a background now; it
  // changes colour, never position.
  cmpValue: {
    fontSize: 18.5,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    minWidth: 58,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  // Under forceRTL `textAlign:'left'` renders on the VISUAL RIGHT. The viewer
  // sits on the visual LEFT, so their number pushes to the visual left edge —
  // which is `textAlign:'right'`. Written out because it reads backwards.
  cmpValueA: { color: BLUE, textAlign: 'right' },
  cmpValueB: { color: RED, textAlign: 'left' },
  cmpWin: { fontWeight: '900' },
  // The lead disc, in the side's OWN colour at low opacity — the number never
  // leaves the colour that says whose it is. `overflow:'hidden'` is what makes
  // a radius apply to a <Text> on Android; without it the corners stay square.
  cmpLeadA: {
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: '#E8EFFE',
  },
  cmpLeadB: {
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: RED_SOFT,
  },

  // The verdict line. A tinted strip rather than a card of its own: it is a
  // one-line summary of the rows directly beneath it, not a separate finding.
  verdictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#F6F8FC',
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  verdictText: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  rowNote: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  // A footnote, not a section: smallest type on the page, muted, with just
  // enough air above it to separate it from the last card.
  sinceNote: {
    fontSize: 11.5,
    color: '#94A3B8',
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    marginTop: -spacing.xs,
  },
});
