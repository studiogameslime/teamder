// SeasonSummaryScreen — "סיכום העונה שלי".
//
// The season's answer to סיכום הערב: everything that happened to ONE player
// between the season opening and now (or its closing), and nothing cumulative.
// The distinction is the whole feature — a career total is already on the
// profile, and a number that never resets tells you nothing about this year.
//
// Two halves. The counters come off the player's own club row; the people —
// who I played beside most, who I faced most, who I beat most — come out of
// the pair counters the round rollup has been filling all along. Both are
// zeroed when a season closes, which is exactly what makes them season-scoped.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { captureRef } from 'react-native-view-shot';

import { ScreenHeader } from '@/components/ScreenHeader';
import { UserAvatar } from '@/components/UserAvatar';
import { SeasonShareCard, SHARE_CARD_WIDTH } from '@/components/summary/SeasonShareCard';
import { toast } from '@/components/Toast';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import {
  seasonSummaryService,
  type SeasonSummaryModel,
} from '@/services/seasonSummaryService';
import type { SeasonPeer } from '@/utils/seasonPersonal';
import type {
  SeasonTitleAwarded,
  SeasonTitleWon,
} from '@/services/seasonSummaryService';
import { useUserStore } from '@/store/userStore';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import { RTL_LABEL_ALIGN } from '@/theme/rtl';
import { he } from '@/i18n/he';
import type { ProfileStackParamList } from '@/navigation/ProfileStack';

type Params = RouteProp<ProfileStackParamList, 'SeasonSummary'>;

/** A percentage, or a dash when the rate has no denominator. */
const pct = (v: number | null): string =>
  v === null ? '—' : `${Math.round(v * 100)}%`;
const per = (v: number | null): string => (v === null ? '—' : v.toFixed(2));

function formatRange(startsAt: number, endsAt: number | null): string {
  const f = (ms: number) =>
    new Date(ms).toLocaleDateString('he-IL', { month: 'short', year: 'numeric' });
  // Season 1 of a club that sealed its history has no start date — it began
  // whenever the club did, which nothing recorded. That is a real fact about
  // that season, and saying it beats rendering an empty line where every other
  // season shows a range.
  if (!startsAt) {
    return endsAt ? he.seasonRangeUntil(f(endsAt)) : he.seasonRangeUnknown;
  }
  return endsAt ? `${f(startsAt)} – ${f(endsAt)}` : `${f(startsAt)} – ${he.seasonNow}`;
}

/**
 * One number.
 *
 * Thirteen of these sat in a grid as identical grey squares, so nothing on the
 * screen was louder than anything else and the eye had nowhere to land —
 * "תעשה את המסך הזה קצת יותר חי וצבעוני". An icon and a tint give each one an
 * identity; the tint is applied at `1A` alpha, the idiom the club stats screen
 * already uses for exactly this, rather than a second colour helper.
 */
function Stat({
  label,
  value,
  icon,
  tint = colors.primary,
}: {
  label: string;
  value: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tint?: string;
}) {
  return (
    <View style={styles.stat}>
      {icon ? (
        <View style={[styles.statIcon, { backgroundColor: tint + '1A' }]}>
          <Ionicons name={icon} size={14} color={tint} />
        </View>
      ) : null}
      {/* The VALUE stays ink. The tint belongs to the icon disc above it,
          where it sits on its own 10%-opacity wash and is a decoration; used
          as text colour on the tile's #F3F4F6 it measured 1.6:1 for gold and
          1.9:1 for amber — nine of the thirteen accents on this screen fell
          under 3:1, and the number a player came here to read was the least
          legible thing on it. */}
      {/* One line, always. "1 מתוך 12" does not fit 68pt at this size, and a
          rank that wraps onto a second line pushed its own label out of the
          tile. */}
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** A section heading with an icon, matching the club stats screen so the two
 *  read as the same app rather than two different ones. */
/** Gold, silver and bronze for the top three; the muted podium otherwise.
 *  A rank of null (did not play) gets no medal at all — an empty season is
 *  not a fourth place. */
const MEDAL_TINTS = ['#F4B73E', '#9AA4B2', '#CD7F32'];
function rankTint(rank: number | null): string {
  return rank && rank <= 3 ? MEDAL_TINTS[rank - 1] : colors.textMuted;
}
function rankIcon(rank: number | null): keyof typeof Ionicons.glyphMap {
  return rank && rank <= 3 ? 'medal' : 'podium-outline';
}

/** The three numbers a player came for, one step above the other ten.
 *
 *  The card was thirteen identical tiles: goals sat beside clean-sheet
 *  percentage at the same size, in the same grey, with the same disc — so the
 *  card had no entry point and nothing to read first. These three keep the
 *  tile shape and take the headline weight. */
function LeadStat({
  label,
  value,
  icon,
  tint,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
}) {
  return (
    <View style={[styles.leadStat, { borderColor: tint + '33', backgroundColor: tint + '0F' }]}>
      <View style={styles.leadHead}>
        <Ionicons name={icon} size={14} color={tint} />
        <Text style={styles.leadLabel}>{label}</Text>
      </View>
      <Text style={styles.leadValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {value}
      </Text>
    </View>
  );
}

function CardTitle({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.cardTitleRow}>
      {/* Icon first → rightmost under forceRTL, beside the words. */}
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={styles.cardTitle}>{text}</Text>
    </View>
  );
}

function PeerRow({
  icon,
  label,
  peer,
  names,
  avatars,
  detail,
  tint = colors.primary,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  peer: SeasonPeer | null;
  names: Record<string, string>;
  avatars: Record<string, { avatarId?: string; photoUrl?: string }>;
  detail: (p: SeasonPeer) => string;
  tint?: string;
}) {
  // A line with no answer is left out rather than shown empty: in a first
  // season half of these are genuinely unanswerable, and six greyed-out rows
  // read as a broken screen instead of a young one.
  if (!peer) return null;
  return (
    <View style={styles.peerRow}>
      {/* A face, not just a name. Every other person-row in the app shows one,
          and these six are the most human thing on the screen.

          THEIR face. Built from `{id, name}` alone this fell through to the
          deterministic fallback disc every time, so the six people of your
          season were the only six people in the app without their own picture
          — on a running season, where the user document had already been
          fetched and the avatar dropped on the floor. A closed season has only
          the frozen name, and there the fallback is the honest answer. */}
      <UserAvatar
        user={{
          id: peer.userId,
          name: names[peer.userId] ?? '',
          ...avatars[peer.userId],
        }}
        size={38}
      />
      <View style={[styles.peerIcon, { backgroundColor: tint + '1A' }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <View style={styles.peerText}>
        <Text style={styles.peerLabel}>{label}</Text>
        <Text style={styles.peerName}>{names[peer.userId] ?? '—'}</Text>
        <Text style={styles.peerDetail}>{detail(peer)}</Text>
      </View>
    </View>
  );
}

function TitleRow({ title }: { title: SeasonTitleWon }) {
  return (
    <View style={styles.titleRow}>
      {/* A gold disc rather than a 22px emoji. This is the loudest thing the
          screen can say about a season, and it was the quietest element on it. */}
      <View style={styles.titleMedalDisc}>
        <Ionicons name="trophy" size={18} color="#fff" />
      </View>
      <View style={styles.titleText}>
        <Text style={styles.titleName}>
          {he.seasonTitleNames[title.key]} · {he.seasonTitleValue(title.key, title.value)}
        </Text>
        {title.sharedWith > 0 ? (
          <Text style={styles.titleShared}>
            {he.seasonTitleSharedWith(title.sharedWith)}
          </Text>
        ) : null}
        {/* What the rating covers, on the reader's own title. The number is
            the loudest claim this row makes and it is an average; on this
            club's only closed season it is an average of nine evenings out of
            twenty-two. Absent on every title that carries no coverage. */}
        {title.coverage ? (
          <Text style={styles.titleShared}>
            {he.seasonTitleCoverage(title.coverage.rated, title.coverage.of)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ChampionRow({ title }: { title: SeasonTitleAwarded }) {
  return (
    <View style={styles.championRow}>
      <Text style={styles.championTitle} numberOfLines={1}>
        {he.seasonTitleNames[title.key]}
      </Text>
      {/* The name is the variable-length part — a duo title is two names
          joined — so it is the one that shrinks and wraps, not the label
          beside it and not the number after it. */}
      <Text
        style={[styles.championName, title.mine && styles.championMine]}
        numberOfLines={2}
      >
        {title.names.join(' · ')}
      </Text>
      {/* The number it was won on. Fetched all along and thrown away — and it
          is what makes a title an argument rather than a label. */}
      <View>
        <Text style={styles.championValue}>
          {he.seasonTitleValue(title.key, title.value)}
        </Text>
        {title.coverage ? (
          <Text style={styles.championCoverage} numberOfLines={2}>
            {he.seasonTitleCoverage(title.coverage.rated, title.coverage.of)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function SeasonSummaryScreen() {
  const params = useRoute<Params>().params;
  const groupId = params?.groupId ?? '';
  const currentUser = useUserStore((s) => s.currentUser);
  // Which season is on screen. Starts at whatever opened the screen — the club
  // card sends none (meaning "the one running"), the end-of-season push sends
  // the one that just closed — and the picker moves it from there.
  const [seasonId, setSeasonId] = useState<string | undefined>(params?.seasonId);

  const [model, setModel] = useState<SeasonSummaryModel | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Only the newest load may write. Tapping through three season chips quickly
  // starts three loads, and without this the slowest one wins — which on the
  // picker means the screen settles on a season you already moved off.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = (loadSeq.current += 1);
    if (!currentUser?.id || !groupId) {
      setModel(null);
      setFailed(false);
      setLoading(false);
      return;
    }
    const m = await seasonSummaryService.load({
      groupId,
      userId: currentUser.id,
      seasonId,
    });
    if (seq !== loadSeq.current) return; // a newer load is already in flight
    setFailed(m === 'error');
    setModel(m === 'error' ? null : m);
    setLoading(false);
    if (m && m !== 'error') {
      logEvent(AnalyticsEvent.SeasonSummaryViewed, {
        groupId,
        seasonNo: m.seasonNo,
        closed: m.closed,
        titles: m.myTitles.length,
      });
    }
  }, [currentUser?.id, groupId, seasonId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const shareCardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const onShare = useCallback(async () => {
    if (!shareCardRef.current || sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(shareCardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      // Lazy-required so the screen still loads on a binary that predates
      // expo-sharing — the require only runs on a share tap. Same arrangement
      // the evening summary uses.
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: he.seasonShareTitle,
        });
        logEvent(AnalyticsEvent.SeasonSummaryShared, {
          groupId,
          seasonNo: model?.seasonNo ?? 0,
          titles: model?.myTitles.length ?? 0,
        });
      } else {
        toast.error(he.summaryShareUnavailable);
      }
    } catch (err) {
      logError('shareSeasonSummary', err, { groupId });
      toast.error(he.summaryShareFailed);
    } finally {
      setSharing(false);
    }
  }, [groupId, model, sharing]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={he.seasonSummaryTitle} />
        <View style={styles.center}>
          <SoccerBallLoader />
        </View>
      </SafeAreaView>
    );
  }

  if (!model) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={he.seasonSummaryTitle} />
        {/* Pull-to-refresh even here: a failed load is the one empty state a
            person has a reason to retry, and without a scroll view there is
            nothing to pull. */}
        <ScrollView
          contentContainerStyle={styles.centerScroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
        >
          <Text style={styles.empty}>
            {failed ? he.seasonSummaryLoadFailed : he.seasonSummaryUnavailable}
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const { me, names, peerAvatars } = model;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={he.seasonSummaryTitle} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        <View style={styles.hero}>
          <Text style={styles.heroSeason}>
            {he.seasonNumberLabel(model.seasonNo)} · {model.groupName}
          </Text>
          {/* A season counted in evenings says where it has got to; one
              counted in months says when it runs. Printing a date over a
              rounds season answered a question nobody asked. */}
          <Text style={styles.heroRange}>
            {model.roundsCadence
              ? he.seasonsProgressRounds(
                  model.roundsCadence.played,
                  model.roundsCadence.target,
                )
              : formatRange(model.startsAt, model.endsAt)}
          </Text>
          {model.closed ? (
            <Text style={styles.heroClosed}>{he.seasonClosedBadge}</Text>
          ) : null}
        </View>

        {/* Seasons never mix: each closed one is its own sealed record and
            nothing is ever summed across them. This is where that becomes
            visible — one club has had more than one season, and switching
            between them replaces every number on the screen. */}
        {model.available.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {model.available.map((c) => {
              const active = c.id === model.seasonId;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setSeasonId(c.closed ? c.id : undefined)}
                  style={[styles.chip, active && styles.chipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {c.closed
                      ? he.seasonNumberLabel(c.no)
                      : he.seasonChipCurrent(c.no)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {/* MY half and the CLUB's half are two different questions, and one
            ternary on `me.hasData` used to answer both with "no".

            Somebody who missed the season got a single card reading "לא שיחקת
            בעונה הזאת" — and lost "אלופי העונה" with it, which is the same
            list for every reader, is the reason the end-of-season push sends
            the whole club here, and is the only place the champions are ever
            named. It was fetched and thrown away on the way to the render. So
            the personal cards stay behind `hasData` and the club's do not. */}

        {/* Titles first when there are any: it is the one thing on this screen
            a person tells someone else about. A running season has none by
            design — they are decided when the numbers stop. */}
        {me.hasData && model.closed ? (
          <View style={styles.card}>
            <CardTitle icon="medal" text={he.seasonSectionTitles} />
            {model.myTitles.length === 0 ? (
              <Text style={styles.cardNote}>{he.seasonTitlesNone}</Text>
            ) : null}
            {model.myTitles.map((t) => (
              <TitleRow key={t.key} title={t} />
            ))}
          </View>
        ) : null}

        {/* Said before the champions, not instead of them: it explains why the
            personal cards below are missing, and the club's season carries on
            underneath it. */}
        {!me.hasData ? (
          <View style={styles.card}>
            <Text style={styles.empty}>
              {model.closed
                ? he.seasonSummaryNoRoundsClosed
                : he.seasonSummaryNoRounds}
            </Text>
          </View>
        ) : null}

        {/* Every title the season decided, and who took it. The push sends
            every player who played to this screen, so it is where the club
            gathers the day a season ends — nine champions were being crowned
            in private, each told only about their own. */}
        {model.closed && model.seasonTitles.length > 0 ? (
          <View style={styles.card}>
            <CardTitle icon="trophy" text={he.seasonSectionChampions} />
            {model.seasonTitles.map((t) => (
              <ChampionRow key={t.key} title={t} />
            ))}
          </View>
        ) : null}

        {me.hasData ? (
          <>
            <View style={styles.card}>
              <CardTitle icon="stats-chart" text={he.seasonSectionNumbers} />
              <View style={styles.leadRow}>
                <LeadStat label={he.statGoals} value={String(me.goals)} icon="football" tint={colors.primary} />
                <LeadStat label={he.statAssists} value={String(me.assists)} icon="footsteps-outline" tint="#7C3AED" />
                <LeadStat label={he.seasonStatContributions} value={String(me.contributions)} icon="flash-outline" tint="#F59E0B" />
              </View>
              <View style={styles.statGrid}>
                <Stat label={he.seasonStatEvenings} value={String(me.evenings)} icon="calendar-outline" tint={colors.success} />
                <Stat label={he.seasonStatRounds} value={String(me.rounds)} icon="grid-outline" tint="#0EA5E9" />
                <Stat label={he.seasonStatWins} value={String(me.wins)} icon="trophy-outline" tint={colors.success} />
                <Stat label={he.seasonStatLosses} value={String(me.losses)} icon="close-circle-outline" tint={colors.danger} />
                <Stat label={he.seasonStatTies} value={String(me.ties)} icon="remove-circle-outline" tint={colors.textMuted} />
                <Stat label={he.seasonStatWinPct} value={pct(me.winPct)} icon="stats-chart-outline" tint={colors.success} />
                <Stat label={he.seasonStatCleanSheets} value={String(me.cleanSheets)} icon="shield-checkmark-outline" tint={colors.info} />
                <Stat label={he.seasonStatCleanSheetPct} value={pct(me.cleanSheetPct)} icon="shield-outline" tint={colors.info} />
                <Stat label={he.seasonStatGoalsPerRound} value={per(me.goalsPerRound)} icon="speedometer-outline" tint={colors.primary} />
                <Stat label={he.seasonStatAssistsPerRound} value={per(me.assistsPerRound)} icon="git-network-outline" tint="#7C3AED" />
              </View>
              {me.penTaken > 0 || me.penFaced > 0 || me.ownGoals > 0 ? (
                <View style={styles.statGrid}>
                  {me.penTaken > 0 ? (
                    <Stat
                      label={he.seasonStatPenalties}
                      value={`${me.penScored}/${me.penTaken}`}
                    />
                  ) : null}
                  {me.penFaced > 0 ? (
                    <Stat
                      label={he.seasonStatPenSaves}
                      value={`${me.penSaved}/${me.penFaced}`}
                    />
                  ) : null}
                  {me.ownGoals > 0 ? (
                    <Stat label={he.seasonStatOwnGoals} value={String(me.ownGoals)} />
                  ) : null}
                </View>
              ) : null}
              {/* Why the tiles above do not divide into each other.
                  Clean sheets have only been recorded since 17.08 and assists
                  since 21.06, both later than the club — so for a veteran both
                  rates are measured over a shorter window than the "משחקונים"
                  tile two along. Four clean sheets in twenty-two is 18%, and
                  the tile beside it says 24%, because 24% is the honest answer
                  over the seventeen that were measured. The club's efficiency
                  table already prints this note under the same numbers; this
                  grid was the one place a reader could watch the arithmetic
                  fail with nothing to explain it. */}
              {me.partialCoverage ? (
                <Text style={styles.cardNote}>{he.seasonPartialCoverageNote}</Text>
              ) : null}
            </View>

            <View style={styles.card}>
              <CardTitle icon="podium" text={he.seasonSectionStanding} />
              <View style={styles.statGrid}>
                {/* A medal for a podium finish, the plain icon otherwise. The
                    three tiles here are the only ones on the screen that are a
                    PLACE rather than a count, so they are allowed to celebrate
                    when the place is worth celebrating. */}
                <Stat
                  label={he.statGoals}
                  value={me.ranks.goals ? he.seasonRankOf(me.ranks.goals, me.ranks.of) : '—'}
                  icon={rankIcon(me.ranks.goals)}
                  tint={rankTint(me.ranks.goals)}
                />
                <Stat
                  label={he.statAssists}
                  value={me.ranks.assists ? he.seasonRankOf(me.ranks.assists, me.ranks.of) : '—'}
                  icon={rankIcon(me.ranks.assists)}
                  tint={rankTint(me.ranks.assists)}
                />
                <Stat
                  label={he.seasonStatWins}
                  value={me.ranks.wins ? he.seasonRankOf(me.ranks.wins, me.ranks.of) : '—'}
                  icon={rankIcon(me.ranks.wins)}
                  tint={rankTint(me.ranks.wins)}
                />
              </View>
              <Text style={styles.cardNote}>
                {he.seasonClubRounds(model.completedRounds)}
              </Text>
            </View>

            <View style={styles.card}>
              <CardTitle icon="people" text={he.seasonSectionPeople} />
              <PeerRow
                icon="people-outline"
                label={he.seasonPeerPartner}
                tint={colors.success}
                peer={me.partner}
                names={names}
                avatars={peerAvatars}
                // winsTogether, not myWins: this line is about the two of us
                // on the SAME side, and myWins counts the opposite.
                detail={(p) => he.seasonPeerPartnerDetail(p.count, p.winsTogether)}
              />
              <PeerRow
                icon="flame-outline"
                label={he.seasonPeerNemesis}
                tint={colors.danger}
                peer={me.nemesis}
                names={names}
                avatars={peerAvatars}
                detail={(p) => he.seasonPeerNemesisDetail(p.count, p.myWins, p.theirWins)}
              />
              <PeerRow
                icon="trophy-outline"
                label={he.seasonPeerVictim}
                tint={"#F59E0B"}
                peer={me.victim}
                names={names}
                avatars={peerAvatars}
                detail={(p) => he.seasonPeerVictimDetail(p.count)}
              />
              <PeerRow
                icon="skull-outline"
                label={he.seasonPeerTormentor}
                tint={"#7C3AED"}
                peer={me.tormentor}
                names={names}
                avatars={peerAvatars}
                detail={(p) => he.seasonPeerTormentorDetail(p.count)}
              />
              <PeerRow
                icon="football-outline"
                label={he.seasonPeerAssistedMost}
                tint={colors.info}
                peer={me.assistedMost}
                names={names}
                avatars={peerAvatars}
                detail={(p) => he.seasonPeerAssistsDetail(p.count)}
              />
              <PeerRow
                icon="hand-left-outline"
                label={he.seasonPeerAssistedBy}
                tint={colors.primary}
                peer={me.assistedBy}
                names={names}
                avatars={peerAvatars}
                detail={(p) => he.seasonPeerAssistsDetail(p.count)}
              />
              {!me.partner && !me.nemesis ? (
                <Text style={styles.cardNote}>
                  {model.closed ? he.seasonPeersEmptyClosed : he.seasonPeersEmpty}
                </Text>
              ) : null}
            </View>
          </>
        ) : null}

        {me.hasData ? (
          <Pressable
            onPress={onShare}
            disabled={sharing}
            style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel={he.seasonShareCta}
          >
            {/* Label first → rightmost under forceRTL, so the icon lands to
                its LEFT, which is the side it reads on in an RTL row. */}
            <Text style={styles.shareText}>{he.seasonShareCta}</Text>
            <Ionicons
              name={sharing ? 'hourglass-outline' : 'share-social'}
              size={18}
              color="#fff"
            />
          </Pressable>
        ) : null}

        <Text style={styles.footnote}>{he.seasonSummaryFootnote}</Text>
      </ScrollView>

      {/* Off-screen, at a fixed width, so the captured image is the same from
          every phone. Positioned rather than hidden: a display:none subtree
          has no layout and captures blank. */}
      <View style={styles.shareStage} pointerEvents="none">
        <View ref={shareCardRef} collapsable={false}>
          {/* The name belongs on a card that leaves the app — without it the
              image is a set of numbers nobody can place. */}
          <SeasonShareCard model={model} playerName={currentUser?.name} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  centerScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  hero: { gap: spacing.xs },
  // First child renders rightmost under forceRTL, so the running season — the
  // first entry — sits on the right where reading starts.
  chipRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    // 44pt of touch target, not 26. The season picker is the one control on
    // this screen and it was smaller than a thumb.
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.text },
  chipTextActive: { color: colors.surface, fontWeight: '700' },
  heroSeason: {
    ...typography.h2,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  heroRange: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  heroClosed: {
    ...typography.caption,
    color: colors.primary,
    textAlign: RTL_LABEL_ALIGN,
  },
  card: {
    backgroundColor: colors.surface,
    // The app's own token and the app's own shadow, like every other card in
    // the app. #FFFFFF on #F9FAFB is 1.05:1 and #11161D on #0B0F14 is 1.06:1 —
    // with no border and no elevation nothing on this screen had an edge, and
    // the tiles inside were worse in the direction that matters.
    borderRadius: radius.xl,
    ...shadows.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: {
    // A heading, one step above its contents. It was typography.h3 and so was
    // statValue — the card's title and its data competed at the same size and
    // the same weight, so nothing on the screen led.
    ...typography.label,
    color: colors.textMuted,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  cardNote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  leadRow: { flexDirection: 'row', gap: spacing.sm },
  leadStat: {
    flexGrow: 0,
    flexBasis: '31%',
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: 2,
  },
  // Icon first in source order → rightmost under forceRTL, beside its word.
  leadHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leadLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  leadValue: {
    // Pushed to the bottom of the tile. The three tiles stretch to the tallest,
    // and "שערים + בישולים" is a two-line label — so without this its number
    // sat a line lower than the two beside it and the row had no baseline.
    marginTop: 'auto',
    ...typography.h1,
    fontWeight: '900',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    fontVariant: ['tabular-nums'],
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  stat: {
    // No minWidth. On a 360dp phone the card's inner width is 296, so 31% is
    // 91.8 — under the 96 this used to set. flexShrink defaults to 0, so the
    // basis lost and three tiles could not fit: the grid dropped to two
    // columns and every row ended in a tile-wide hole.
    //
    // NOT flexGrow either. Thirteen tiles in rows of three leave one on the
    // last row, and letting it grow stretched a single number across the whole
    // width — the screen ended on a slab. A fixed basis leaves the last row
    // short, which is what a grid is supposed to look like.
    flexGrow: 0,
    flexBasis: '31%',
    // Sits ON a card, so it needs the muted surface — the page background
    // would be invisible against white in light mode.
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: 2,
  },
  statValue: {
    // Bigger than the heading above it, not equal to it — this is the number
    // the screen exists for.
    ...typography.h2,
    fontWeight: '900',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  // Medal first in source order → rightmost under forceRTL, where the eye
  // starts.
  titleRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  titleMedal: { fontSize: 22 },
  titleText: { flex: 1, gap: 1 },
  titleName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  // Label first in source order → rightmost under forceRTL, name beside it.
  championRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingVertical: 2,
  },
  championTitle: {
    ...typography.caption,
    color: colors.textMuted,
    // Enough for the longest of the nine names, and no more: the label is
    // fixed-length, the winner is not.
    flexShrink: 0,
    textAlign: RTL_LABEL_ALIGN,
  },
  championName: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  championMine: { color: colors.primary },
  championValue: {
    ...typography.caption,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  // The coverage note beside a champion's number. Quieter than the value, and
  // allowed to wrap — it is a sentence, not a figure.
  championCoverage: {
    ...typography.caption,
    fontSize: 9,
    lineHeight: 12,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
    maxWidth: 120,
    marginTop: 2,
  },
  titleShared: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  // Icon first in source order: under forceRTL the first child renders
  // rightmost, which puts the icon on the right of the Hebrew text.
  peerRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  peerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peerText: { flex: 1, gap: 1 },
  peerLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  peerName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  peerDetail: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  titleMedalDisc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F4B73E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: spacing.md,
    // A row now, because the label has an icon beside it.
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  shareText: { ...typography.body, color: colors.surface, fontWeight: '700' },
  // Parked ABOVE the screen rather than beside it.
  //
  // Either works — the captured PNG was verified complete both ways. Vertical
  // is preferred only because a negative `left` is flipped by forceRTL, so the
  // offset it produces depends on the app's language rather than on this file.
  shareStage: {
    position: 'absolute',
    top: -10000,
    width: SHARE_CARD_WIDTH,
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
});
