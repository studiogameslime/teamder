import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {UserAvatar} from '@/components/UserAvatar';
import {RTL_LABEL_ALIGN} from '@/theme';
import {MatchResultPanel} from './MatchResultPanel';
import {TeamShirtIllustration} from './TeamShirt';
import {teamColor, teamName, type PlayerLite} from './rotationView';
import {winnerRotationPreview} from '@/utils/winnerRotationPreview';
import type {DraftTeamsResult, LiveMatchState, MatchRotation} from '@/types';

type Kick = NonNullable<LiveMatchState['shootout']>['kicks'][number];
export function shootoutOutcome(kick: Kick) {
  if (kick.outcome === 'goal' || (!kick.outcome && kick.scored)) return {label: 'גול', icon: 'football-outline' as const, ink: '#166534', bg: '#DCFCE7'};
  if (kick.outcome === 'save') return {label: 'עצירה', icon: 'hand-left-outline' as const, ink: '#1D4ED8', bg: '#DBEAFE'};
  if (kick.outcome === 'miss') return {label: 'החטאה', icon: 'close-outline' as const, ink: '#475569', bg: '#E2E8F0'};
  // A legacy non-goal did not distinguish a keeper save from an off-target shot.
  return {label: 'לא הובקע', icon: 'remove-outline' as const, ink: '#475569', bg: '#E2E8F0'};
}

export function ShootoutScorePanel({draftTeams, rotation, kicks, compact, caption, showDots = true}: {
  draftTeams: DraftTeamsResult; rotation: MatchRotation; kicks: Kick[]; compact: boolean; caption?: string; showDots?: boolean;
}) {
  const details = (side: 'A' | 'B') => {
    const taken = kicks.filter(kick => kick.team === side);
    return <View style={s.attempts}>
      <Text style={s.attemptText}>{taken.length === 1 ? 'בעיטה אחת' : `${taken.length} בעיטות`}</Text>
      {showDots && <View style={s.dots}>{taken.map((kick, index) => <View key={kick.id || index} style={[s.dot, {backgroundColor: kick.scored ? '#BBF7D0' : '#E2E8F0'}]} accessibilityLabel={`בעיטה ${index + 1}: ${shootoutOutcome(kick).label}`}>
        <Ionicons name={kick.scored ? 'checkmark' : kick.outcome === 'save' ? 'hand-left-outline' : kick.outcome === 'miss' ? 'close' : 'remove'} size={10} color={kick.scored ? '#166534' : '#475569'}/>
      </View>)}</View>}
    </View>;
  };
  return <MatchResultPanel draftTeams={draftTeams} rotation={rotation}
    live={{scoreA: kicks.filter(k => k.team === 'A' && k.scored).length, scoreB: kicks.filter(k => k.team === 'B' && k.scored).length} as LiveMatchState}
    compact={compact} compactIdentity heading="תוצאת הפנדלים" teamDetails={details} caption={caption}/>;
}

export function ShootoutLogRow({kick, index, draftTeams, rotation, resolve, compact}: {
  kick: Kick; index: number; draftTeams: DraftTeamsResult; rotation: MatchRotation;
  resolve: (id: string) => PlayerLite; compact: boolean;
}) {
  const side = kick.team === 'A' ? 0 : 1;
  const team = rotation.playing[side], other = rotation.playing[side === 0 ? 1 : 0];
  const kicker = resolve(kick.kickerId), keeper = resolve(kick.keeperId);
  const result = shootoutOutcome(kick);
  return <View style={s.logRow} testID={`shootout-log-${kick.id}`}>
    <Text style={s.index}>{index + 1}</Text>
    <UserAvatar user={{...kicker, id: kick.kickerId, name: kicker.displayName ?? 'שחקן'}} size={compact ? 32 : 40}/>
    <View style={s.identity}>
      <View style={s.nameRow}><TeamShirtIllustration color={teamColor(team, draftTeams.teams)} width={20}/>{compact
        ? <View style={s.identity}><Text style={s.name}>{kicker.displayName ?? 'שחקן'}</Text><Text style={s.team}>{teamName(team, draftTeams.teams)}</Text></View>
        : <><Text style={s.name}>{kicker.displayName ?? 'שחקן'}</Text><Text style={s.team}>{teamName(team, draftTeams.teams)}</Text></>}</View>
      <View style={s.keeper}><UserAvatar user={{...keeper, id: kick.keeperId, name: keeper.displayName ?? 'שוער'}} size={20}/><Text style={s.detail}>{`מול ⁨${keeper.displayName ?? 'שוער'}⁩ · ${teamName(other, draftTeams.teams)}`}</Text></View>
    </View>
    <View style={[s.result, {backgroundColor: result.bg}]}><Ionicons name={result.icon} size={17} color={result.ink}/><Text style={[s.resultText, {color: result.ink}]}>{result.label}</Text></View>
  </View>;
}

export function ShootoutNextMatch({draftTeams, rotation, winner}: {draftTeams: DraftTeamsResult; rotation: MatchRotation; winner: 'A' | 'B'}) {
  const plan = winnerRotationPreview(rotation, rotation.playing[winner === 'A' ? 0 : 1]);
  if (!plan) return null;
  const name = (index: number) => teamName(index, draftTeams.teams);
  return <View style={s.nextSection} testID="shootout-next-match">
    <Text style={s.sectionTitle}>במשחק הבא</Text>
    <View style={s.nextCard}>{plan.playing.map((index, position) => <React.Fragment key={index}>
      {position === 1 && <Text style={s.versus}>מול</Text>}
      <View style={s.nextTeam}><TeamShirtIllustration color={teamColor(index, draftTeams.teams)} width={28}/>
        <Text style={s.nextName}>{name(index)}</Text>
        <View style={[s.badge, index === plan.incoming && s.incoming]}><Text style={[s.badgeText, index === plan.incoming && s.incomingText]}>{index === plan.incoming ? 'עולים' : 'נשארים'}</Text></View>
      </View>
    </React.Fragment>)}</View>
    {plan.outgoing != null ? <View style={s.waiting}><TeamShirtIllustration color={teamColor(plan.outgoing, draftTeams.teams)} width={26}/><Text style={s.waitingText}>{`${name(plan.outgoing)} עוברים להמתנה`}</Text><Ionicons name="swap-horizontal-outline" size={20} color="#64748B"/></View>
      : <Text style={s.detail}>אין קבוצה ממתינה — שתי הקבוצות נשארות במגרש</Text>}
  </View>;
}

const s = StyleSheet.create({
  attempts: {alignItems: 'center', gap: 5}, attemptText: {fontSize: 11, lineHeight: 16, color: '#FFFFFF', textAlign: 'center'},
  dots: {flexDirection: 'row', flexWrap: 'wrap', gap: 3, justifyContent: 'center'}, dot: {width: 15, height: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center'},
  logRow: {flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 16, padding: 10, backgroundColor: '#FFFFFF'},
  index: {fontSize: 11, color: '#64748B', fontWeight: '700'}, identity: {flex: 1, minWidth: 0, gap: 3},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 5}, name: {flexShrink: 1, color: '#12234D', fontSize: 15, fontWeight: '800', textAlign: RTL_LABEL_ALIGN},
  team: {color: '#64748B', fontSize: 11, textAlign: RTL_LABEL_ALIGN}, keeper: {flexDirection: 'row', alignItems: 'center', gap: 4},
  detail: {fontSize: 11, lineHeight: 17, color: '#64748B', textAlign: RTL_LABEL_ALIGN, flexShrink: 1}, result: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 7, borderRadius: 10, maxWidth: '33%', flexWrap: 'wrap'},
  resultText: {fontSize: 12, fontWeight: '800', textAlign: 'center', flexShrink: 1},
  nextSection: {gap: 7}, sectionTitle: {fontSize: 18, fontWeight: '800', color: '#12234D', textAlign: RTL_LABEL_ALIGN},
  nextCard: {flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#EAF3FF', borderRadius: 16, padding: 6},
  nextTeam: {flex: 1, minWidth: 0, alignItems: 'center', gap: 3}, nextName: {fontSize: 14, fontWeight: '800', color: '#12234D', textAlign: 'center'},
  versus: {fontSize: 13, color: '#94A3B8'}, badge: {borderRadius: 14, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: '#DBEAFE'}, badgeText: {fontSize: 12, fontWeight: '700', color: '#1D4ED8'},
  incoming: {backgroundColor: '#D1FAE5'}, incomingText: {color: '#065F46'}, waiting: {flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#F1F5F9', borderRadius: 12, padding: 6}, waitingText: {flex: 1, fontSize: 12, color: '#475569', textAlign: RTL_LABEL_ALIGN},
});
