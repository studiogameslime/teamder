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

import { SeasonSummaryIcon, type SeasonSummaryIconName } from '@/components/summary/SeasonSummaryIcon';
import { InfoTip } from '@/components/InfoTip';
import Svg, { Rect, Line, Circle } from 'react-native-svg';
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
import { useUserStore } from '@/store/userStore';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { colors, spacing } from '@/theme';
import { RTL_LABEL_ALIGN } from '@/theme/rtl';
import { he } from '@/i18n/he';
import { SeasonAwardRows, SeasonClubSummary, seasonSummaryStyles } from '@/components/summary/SeasonClubSummary';
import { SeasonClubShareCard } from '@/components/summary/SeasonClubShareCard';
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
  artwork,
  rank = false,
}: {
  artwork?: SeasonSummaryIconName;
  rank?: boolean;
  label: string;
  value: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tint?: string;
}) {
  return (
    <View style={[styles.stat, artwork === 'goldTrophy' && { backgroundColor: '#FFFBEE' }]}>
      <View style={{ flex: 1, gap: 2 }}>
        {rank ? <Text style={[styles.statLabel, { fontWeight: '700' }]}>{label}</Text> : null}
        <Text style={rank ? styles.rankValue : styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
        {!rank ? <Text style={styles.statLabel}>{label}</Text> : null}
      </View>
      {icon ? <SeasonSummaryIcon name={artwork ?? icon} size={24} /> : null}
    </View>
  );
}

/** A section heading with an icon, matching the club stats screen so the two
 *  read as the same app rather than two different ones. */
function rankTint(_rank: number | null): string {
  return colors.primary;
}
function rankIcon(_rank: number | null): keyof typeof Ionicons.glyphMap {
  return 'trophy-outline';
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
    <View style={[styles.leadStat, { backgroundColor: tint + '0C' }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.leadValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</Text>
        <Text style={styles.leadLabel}>{label}</Text>
      </View>
      <SeasonSummaryIcon name={icon === 'football' ? 'goldGoal' : icon === 'flash-outline' ? 'contribution' : 'boot'} size={27} />
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
      {/* Label first under forceRTL, placing its icon on the left. */}
      <Text style={styles.cardTitle}>{text}</Text>
      <SeasonSummaryIcon name={icon} size={19} />
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
        size={29}
      />
      <Text style={styles.peerLabel}>{label}</Text>
      <View style={styles.peerText}>
        <Text style={styles.peerName}>{names[peer.userId] ?? '—'}</Text>
        <Text style={styles.peerDetail}>{detail(peer)}</Text>
      </View>
      <View style={styles.peerIcon}>
        <SeasonSummaryIcon name={icon === 'football-outline' ? 'boot' : icon === 'trophy-outline' ? 'goldTrophy' : icon} size={23} />
      </View>
    </View>
  );
}

export function SeasonSummaryScreen() {
  const params = useRoute<Params>().params;
  const groupId = params?.groupId ?? '';
  const currentUser = useUserStore((s) => s.currentUser);
  // The entry point owns season selection; switching tabs never changes it.
  const seasonId = params?.seasonId;
  const [tab, setTab] = useState<'personal' | 'club'>('personal');

  const [model, setModel] = useState<SeasonSummaryModel | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // A late response must not replace a newer route or refresh.
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
          tab,
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
  }, [groupId, model, sharing, tab]);

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
        key={tab}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        <View style={styles.hero}>
          <View pointerEvents="none" style={styles.pitchDecoration}>
            <Svg width="95" height="64" viewBox="0 0 95 64"><Rect x="2" y="2" width="91" height="60" stroke="#B6D6FF" fill="none" /><Line x1="47" x2="47" y1="2" y2="62" stroke="#B6D6FF" /><Circle cx="47" cy="32" r="10" stroke="#B6D6FF" fill="none" /><Rect x="2" y="17" width="15" height="30" stroke="#B6D6FF" fill="none" /><Rect x="78" y="17" width="15" height="30" stroke="#B6D6FF" fill="none" /></Svg>
          </View>
          <Text style={styles.heroSeason}>{model.groupName}</Text>
          {/* A season counted in evenings says where it has got to; one
              counted in months says when it runs. Printing a date over a
              rounds season answered a question nobody asked. */}
          <Text style={styles.heroRange}>
            {he.seasonNumberLabel(model.seasonNo)} · {model.roundsCadence
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

        <View style={styles.tabs} accessibilityRole="tablist">
          {([['personal', 'העונה שלי'], ['club', 'עונת המועדון']] as const).map(([key, label]) => <Pressable key={key}
            accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)}
            style={[styles.tab, tab === key && styles.activeTab]}>
            <Text style={[styles.tabText, tab === key && styles.activeTabText]}>{label}</Text>
          </Pressable>)}
        </View>
        {tab === 'club' ? <SeasonClubSummary model={model} /> : <>
          {me.hasData && currentUser ? <View style={styles.card}>
            <View style={styles.identity}>
              <UserAvatar user={currentUser} size={56} />
              <View style={{ flex: 1, gap: 2 }}><Text style={styles.identityName}>{currentUser.name}</Text><Text style={styles.identityCaption}>העונה שלי במספרים</Text></View>
            </View>
            <View style={styles.leadRow}>
              <LeadStat label={he.statGoals} value={String(me.goals)} icon="football" tint="#F5AC0B" />
              <LeadStat label={he.statAssists} value={String(me.assists)} icon="footsteps-outline" tint="#1479FF" />
              <LeadStat label={he.seasonStatContributions} value={String(me.contributions)} icon="flash-outline" tint="#0D9488" />
            </View>
          </View> : null}
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
            <CardTitle icon="sparkles-outline" text={he.seasonSectionTitles} />
            {model.myTitles.length === 0 ? (
              <Text style={styles.cardNote}>{he.seasonTitlesNone}</Text>
            ) : null}
            <SeasonAwardRows personal awards={model.myTitles.map(t => ({
              ...(model.seasonTitles.find(a => a.key === t.key) ?? { key: t.key, names: [currentUser?.name ?? 'אני'], value: t.value, mine: true }),
              coverage: t.coverage,
              valueUnit: t.valueUnit,
            }))} />
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

        {me.hasData ? (
          <>
            <View style={styles.card}>
              <CardTitle icon="stats-chart" text={he.seasonSectionNumbers} />
              <View style={styles.statGrid}>
                <Stat label={he.seasonStatWins} value={String(me.wins)} icon="trophy-outline" />
                <Stat label={he.seasonStatRounds} value={String(me.rounds)} icon="grid-outline" />
                <Stat label={he.seasonStatEvenings} value={String(me.evenings)} icon="calendar-outline" />
                <Stat label={he.seasonStatWinPct} value={pct(me.winPct)} icon="stats-chart-outline" />
                <Stat label={he.seasonStatTies} value={String(me.ties)} icon="remove-circle-outline" />
                <Stat label={he.seasonStatLosses} value={String(me.losses)} icon="close-circle-outline" />
                <Stat label={he.seasonStatGoalsPerRound} value={per(me.goalsPerRound)} icon="speedometer-outline" />
                <Stat label={he.seasonStatCleanSheetPct} value={pct(me.cleanSheetPct)} icon="shield-outline" />
                <Stat label={he.seasonStatCleanSheets} value={String(me.cleanSheets)} icon="shield-checkmark-outline" />
                {me.ownGoals > 0 ? <Stat label={he.seasonStatOwnGoals} value={String(me.ownGoals)} icon="return-down-back-outline" /> : null}
                {me.penTaken > 0 ? <Stat label={he.seasonStatPenalties} icon="locate-outline" value={`${me.penScored}/${me.penTaken}`} /> : null}
                <Stat label={he.seasonStatAssistsPerRound} value={per(me.assistsPerRound)} icon="git-network-outline" />
                {me.penFaced > 0 ? <Stat label={he.seasonStatPenSaves} icon="hand-left-outline" value={`${me.penSaved}/${me.penFaced}`} /> : null}
              </View>

            </View>

            <View style={styles.card}>
              <CardTitle icon="trending-up-outline" text={he.seasonSectionStanding} />
              <View style={styles.statGrid}>
                <Stat rank label={he.seasonStatWins} value={me.ranks.wins ? he.seasonRankOf(me.ranks.wins, me.ranks.of) : '—'} icon={rankIcon(me.ranks.wins)} tint={rankTint(me.ranks.wins)} artwork="goldTrophy" />
                <Stat rank label={he.statAssists} value={me.ranks.assists ? he.seasonRankOf(me.ranks.assists, me.ranks.of) : '—'} icon="footsteps-outline" tint={rankTint(me.ranks.assists)} artwork="purpleBoot" />
                <Stat rank label={he.statGoals} value={me.ranks.goals ? he.seasonRankOf(me.ranks.goals, me.ranks.of) : '—'} icon="football" tint={rankTint(me.ranks.goals)} />
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

        </>}

        {tab === 'club' || me.hasData ? (
          <Pressable
            onPress={onShare}
            disabled={sharing}
            style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel={tab === 'club' ? 'שיתוף סיכום המועדון' : 'שיתוף הסיכום האישי'}
          >
            {/* Label first → rightmost under forceRTL, so the icon lands to
                its LEFT, which is the side it reads on in an RTL row. */}
            <Text style={styles.shareText}>{tab === 'club' ? 'שיתוף סיכום המועדון' : 'שיתוף הסיכום האישי'}</Text>
            <Ionicons
              name={sharing ? 'hourglass-outline' : 'share-social'}
              size={18}
              color="#fff"
            />
          </Pressable>
        ) : null}

        <View style={styles.infoRow}><Text style={styles.footnote}>נתוני העונה שנבחרה בלבד</Text><InfoTip text={he.seasonSummaryFootnote} size={13} /></View>
      </ScrollView>

      {/* Off-screen, at a fixed width, so the captured image is the same from
          every phone. Positioned rather than hidden: a display:none subtree
          has no layout and captures blank. */}
      <View style={styles.shareStage} pointerEvents="none">
        <View ref={shareCardRef} collapsable={false}>
          {/* The name belongs on a card that leaves the app — without it the
              image is a set of numbers nobody can place. */}
          {tab === 'club' ? <SeasonClubShareCard model={model} /> : <SeasonShareCard model={model} playerName={currentUser?.name} />}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F2F8FF' },
  tabs: { flexDirection: 'row', backgroundColor: colors.surface, borderWidth: 1, borderColor: '#DFEAF8', borderRadius: 11, padding: 2 },
  tab: { flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  activeTab: { backgroundColor: '#1479FF' },
  tabText: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: colors.text },
  activeTabText: { color: '#fff' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  identityName: { fontSize: 19, lineHeight: 24, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  identityCaption: { fontSize: 11, lineHeight: 15, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  centerScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  content: { padding: 10, gap: 8, paddingBottom: spacing.xl },
  hero: { ...seasonSummaryStyles.card, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 74, overflow: 'hidden' },
  pitchDecoration: { position: 'absolute', left: 12, opacity: 0.45 },
  heroSeason: { fontSize: 18, lineHeight: 23, fontWeight: '800', color: colors.text, textAlign: 'center' },
  heroRange: { fontSize: 11, lineHeight: 15, color: colors.textMuted, textAlign: 'center' },
  heroClosed: { fontSize: 10, lineHeight: 14, fontWeight: '700', color: '#29466C', textAlign: 'center', backgroundColor: '#E3F0FF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 2 },
  card: { ...seasonSummaryStyles.card },
  cardTitle: { flex: 1, fontSize: 15, lineHeight: 20, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  cardNote: { fontSize: 10, lineHeight: 14, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  leadRow: { flexDirection: 'row', gap: 6 },
  leadStat: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 47, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 7, gap: 3 },
  leadLabel: { fontSize: 10, lineHeight: 13, color: colors.text, textAlign: RTL_LABEL_ALIGN },
  leadValue: { fontSize: 24, lineHeight: 27, fontWeight: '900', color: colors.text, textAlign: RTL_LABEL_ALIGN, fontVariant: ['tabular-nums'] },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stat: { flexDirection: 'row', alignItems: 'center', width: '32%', backgroundColor: '#F4F8FE', borderWidth: 1, borderColor: '#EAF1FC', borderRadius: 8, minHeight: 45, paddingVertical: 4, paddingHorizontal: 6, gap: 3 },
  statValue: { fontSize: 18, lineHeight: 22, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 10, lineHeight: 13, color: colors.text, textAlign: RTL_LABEL_ALIGN },
  rankValue: { fontSize: 11, lineHeight: 15, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  peerRow: { flexDirection: 'row', gap: 7, alignItems: 'center', minHeight: 44, paddingVertical: 4, borderTopWidth: 1, borderColor: '#EAF1FC' },
  peerIcon: { width: 25, alignItems: 'center', justifyContent: 'center' },
  peerText: { flex: 1.2, gap: 1 },
  peerLabel: { flex: 1, fontSize: 10, lineHeight: 14, color: colors.text, textAlign: RTL_LABEL_ALIGN },
  peerName: { fontSize: 12, lineHeight: 15, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  peerDetail: { fontSize: 10, lineHeight: 13, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  empty: { fontSize: 14, lineHeight: 20, color: colors.textMuted, textAlign: 'center' },
  shareBtn: { backgroundColor: '#1479FF', borderRadius: 10, minHeight: 42, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  shareText: { fontSize: 14, lineHeight: 20, color: '#fff', fontWeight: '700' },
  shareStage: { position: 'absolute', top: -10000, width: SHARE_CARD_WIDTH },
  footnote: { fontSize: 10, lineHeight: 14, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
});
