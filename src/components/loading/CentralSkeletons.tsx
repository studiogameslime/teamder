import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SkeletonRegion, SkeletonBlock as Block } from './ScreenSkeletons';

function Lines({ width = '76%' }: { width?: ViewStyle['width'] }) {
  return <View style={s.copy}><Block style={{ width, height: 21 }} /><Block style={{ width: '88%', height: 16 }} /></View>;
}
function Portrait({ size }: { size: number }) {
  return <Block style={{ width: size, height: size, borderRadius: size / 2 }} />;
}
function Metrics({ count = 3 }: { count?: number }) {
  return <View style={s.row}>{Array.from({ length: count }, (_, i) => <View key={i} style={s.metric}>
    <Block style={{ width: 28, height: 28 }} /><Block style={{ width: 40, height: 35 }} /><Block style={{ width: '77%', height: 15 }} />
  </View>)}</View>;
}
function Heading() { return <Block style={{ width: '58%', height: 23 }} />; }
function AwardRows({ count = 3, minHeight = 61 }: { count?: number; minHeight?: number }) {
  return <View>{Array.from({ length: count }, (_, i) => <View key={i} style={[s.award, { minHeight }, i > 0 && s.divider]}>
    <Portrait size={36} /><Lines /><Block style={{ width: 34, height: 30 }} />
  </View>)}</View>;
}
function PitchSummary() {
  return <View style={[s.panel, { padding: 0, borderRadius: 12 }]}>
    <View style={[s.row, { padding: 13 }]}><Block style={{ flex: 1, height: 20 }} /><Block style={{ flex: 1, height: 20 }} /></View>
    <View style={s.pitch}><Metrics count={2} /></View>
  </View>;
}

/** Social cards do not promise access to private statistics before the profile answers. */
export function PlayerCardSkeleton({ variant = 'social' }: { variant?: 'own' | 'social' | 'legacy' }) {
  if (variant === 'legacy') return <SkeletonRegion label="טוענים את כרטיס השחקן" gap={16}>
    <View style={{ alignItems: 'center', gap: 4, paddingTop: 8, paddingBottom: 12, paddingHorizontal: 16, marginHorizontal: -16, marginTop: -16, backgroundColor: '#F4F6FB' }}><Portrait size={140} /><Block style={{ width: '64%', height: 28 }} /></View>
    <View style={s.panel}><Lines /></View><Block style={{ height: 44, borderRadius: 12 }} />
  </SkeletonRegion>;
  const own = variant === 'own';
  return <SkeletonRegion label="טוענים את כרטיס השחקן" gap={own ? 14 : 12}>
    <View style={[s.playerHero, own && { minHeight: 112, padding: 12, gap: 3, borderRadius: 18 }]}>
      <Portrait size={own ? 56 : 64} /><Block style={{ width: '58%', height: 28 }} /><Block style={{ width: '36%', height: 16 }} />
    </View>
    <View style={s.row}><Block style={s.action} /><Block style={s.action} /></View>
    {own ? <><View style={[s.panel, { padding: 12, gap: 8 }]}><OwnCardSectionSkeleton kind="upcoming" /></View><View style={s.panel}><Heading /><OwnCardSectionSkeleton kind="round" /></View></> : <View style={s.panel}><Heading /><Lines /><View style={s.row}><Block style={{ flex: 1, height: 30 }} /><Block style={{ flex: 1, height: 30 }} /></View></View>}
  </SkeletonRegion>;
}

/** The real card already owns the heading and frame; only replace its pending body. */
export function OwnCardSectionSkeleton({ kind = 'round' }: { kind?: 'upcoming' | 'round' | 'numbers' | 'clubs' | 'referrals' | 'profile' }) {
  const label = { upcoming: 'טוענים את המחזור הקרוב שלך', round: 'טוענים את פרטי המחזור', numbers: 'טוענים את המספרים שלך', clubs: 'טוענים את המועדונים שלך', referrals: 'טוענים את ההזמנות שלך', profile: 'טוענים את התצוגה המקדימה' }[kind];
  return <SkeletonRegion label={label} gap={10}>
    {kind === 'upcoming' ? <><View style={{ minHeight: 116, flexDirection: 'row', gap: 8, alignItems: 'stretch' }}><View style={{ flex: 1, minWidth: 0, gap: 4 }}><Block style={{ width: '77%', height: 18 }} /><Block style={{ width: '93%', height: 22 }} /><Block style={{ width: '72%', height: 17 }} /><Block style={{ width: '88%', height: 17 }} /></View><Block style={{ width: '28%', minWidth: 80, maxWidth: 108, height: 'auto', borderRadius: 12 }} /></View><Block style={{ height: 44, borderRadius: 11 }} /></>
      : kind === 'profile' ? <View style={[s.playerHero, { minHeight: 186 }]}><Portrait size={82} /><Block style={{ width: '58%', height: 28 }} /></View>
      : kind === 'numbers' || kind === 'referrals' ? <View style={s.ownNumbers}><Metrics count={kind === 'referrals' ? 1 : 3} /></View>
      : kind === 'clubs' ? <View>{[0, 1].map(i => <View key={i} style={s.clubRow}><Block style={{ width: 48, height: 48, borderRadius: 10 }} /><Lines /><Block style={{ width: 16, height: 16 }} /></View>)}</View>
      : <><View style={{ gap: 6 }}><Block style={{ width: '82%', height: 22 }} /><Block style={{ width: '62%', height: 18 }} /><Block style={{ width: '74%', height: 18 }} /></View><Block style={{ height: 44, borderRadius: 11 }} /></>}
  </SkeletonRegion>;
}

/** Hero, season selector and tabs are already mounted by PlayerCompareScreen. */
export function PlayerCompareSkeleton({ tab }: { tab: 'together' | 'h2h' }) {
  return <SkeletonRegion label="טוענים את השוואת השחקנים" gap={16}>
    <View style={[s.panel, { padding: 16, borderRadius: 20 }]}>
      <Lines />
      {tab === 'together' ? <View style={s.row}>{[0, 1, 2].map(i => <View key={i} style={s.compareTile}><Block style={{ width: 24, height: 24 }} /><Block style={{ width: 40, height: 35 }} /><Block style={{ width: '77%', height: 15 }} /></View>)}</View>
        : <><View style={[s.row, { paddingVertical: 12 }]}>{[0, 1].map(i => <React.Fragment key={i}>{i === 1 ? <Block style={{ width: 12, height: 34 }} /> : null}<View style={s.metric}><Block style={{ width: 55, height: 53 }} /><Block style={{ width: '70%', height: 18 }} /></View></React.Fragment>)}</View><Block style={{ width: '75%', height: 17, alignSelf: 'center' }} /><View style={s.row}><Block style={{ flex: 1, height: 27, borderRadius: 14 }} /><Block style={{ flex: 1, height: 27, borderRadius: 14 }} /></View></>}
    </View>
    {tab === 'together' ? <View style={s.panel}><Heading /><Block style={{ height: 10 }} /><Block style={{ height: 10 }} /></View>
      : <View style={s.panel}><Heading /><AwardRows count={3} /></View>}
  </SkeletonRegion>;
}

export function RoundStatisticsSkeleton() {
  return <SkeletonRegion label="טוענים את נתוני המחזור">
    <Heading /><PitchSummary /><Heading /><View style={s.panel}><AwardRows minHeight={68} /></View>
  </SkeletonRegion>;
}

export function EveningSummarySkeleton() {
  return <SkeletonRegion label="טוענים את הסיכום שלך" gap={14}>
    <View style={[s.row, { paddingHorizontal: 6, paddingVertical: 6 }]}><Portrait size={62} /><Lines /></View>
    <View style={s.scoreHero}><Block style={{ width: '72%', height: 25 }} /><Block style={{ width: 104, height: 88 }} /><Block style={{ width: '56%', height: 18 }} /></View>
    <View style={[s.panel, { padding: 16, borderRadius: 21 }]}><Heading /><Metrics count={4} /><Block style={{ width: '88%', height: 17 }} /></View>
    <View style={[s.panel, { padding: 16, borderRadius: 21 }]}><Heading /><Block style={{ height: 54, borderRadius: 12 }} /></View>
  </SkeletonRegion>;
}

export function SeasonSummarySkeleton({ tab }: { tab: 'personal' | 'club' }) {
  return <SkeletonRegion label="טוענים את סיכום העונה" gap={8}>
    <View style={s.seasonHero}><Block style={{ width: '63%', height: 23 }} /><Block style={{ width: '79%', height: 17 }} /></View>
    <View style={[s.row, { padding: 2, borderRadius: 11, backgroundColor: 'white', borderWidth: 1, borderColor: '#DFEAF8' }]}><Block style={{ flex: 1, height: 34 }} /><Block style={{ flex: 1, height: 34 }} /></View>
    {tab === 'personal' ? <View style={s.panel}><View style={s.row}><Portrait size={56} /><Lines /></View><Metrics /></View> : <PitchSummary />}
    <View style={s.panel}><Heading /><AwardRows /></View>
    <View style={s.panel}><Heading /><Metrics /></View>
  </SkeletonRegion>;
}

export function AchievementsSkeleton({ kind }: { kind: 'season' | 'personal' }) {
  return <SkeletonRegion label={kind === 'season' ? 'טוענים את תארי העונה' : 'טוענים את ההישגים האישיים'} gap={12}>
    {kind === 'season' ? [0, 1].map(i => <View key={i} style={[s.panel, { padding: 12, borderRadius: 14, gap: 4 }]}><Lines /><AwardRows count={2} /></View>)
      : <View style={s.achievementGrid}>{[0, 1, 2, 3, 4, 5].map(i => <View key={i} style={s.achievementTile}><View style={[s.row, { gap: 6 }]}><View style={s.copy}><Block style={{ width: '94%', height: 18 }} /><Block style={{ width: '69%', height: 15 }} /></View><Block style={{ width: 38, height: 38, borderRadius: 11 }} /></View><Block style={{ width: '78%', height: 14 }} /><Block style={{ height: 5, borderRadius: 8 }} /></View>)}</View>}
  </SkeletonRegion>;
}

export function ManagerDashboardSkeleton({ tab }: { tab: 'club' | 'ratings' | 'equipment' }) {
  return <SkeletonRegion label="טוענים את לוח המנהל" gap={12}>
    <Heading />
    {tab === 'ratings' ? <><View style={s.row}><Block style={{ flex: 1, height: 36 }} /><Block style={{ flex: 1, height: 36 }} /></View><Block style={{ height: 42, borderRadius: 12 }} /><View style={s.panel}><View style={s.row}><Portrait size={42} /><Lines /></View><Block style={{ height: 124 }} /></View></>
      : tab === 'equipment' ? <View style={s.panel}><Heading /><AwardRows count={4} /></View>
      : <><View style={s.panel}><Lines /><View style={s.row}><Block style={{ flex: 1, height: 76 }} /><Block style={{ flex: 1, height: 76 }} /></View></View><View style={s.panel}><Heading /><Lines /><Metrics /><Block style={{ height: 44, borderRadius: 12 }} /></View><View style={s.panel}><Heading /><Metrics /></View></>}
  </SkeletonRegion>;
}

export function ClubHistorySkeleton() {
  return <SkeletonRegion label="טוענים את היסטוריית המועדון" gap={8}>
    {[0, 1, 2, 3].map(i => <View key={i} style={[s.panel, { padding: 12, gap: 4 }]}>
      <View style={s.row}><Block style={{ flex: 1, height: 24 }} /><Block style={{ width: 56, height: 20, borderRadius: 10 }} /></View>
      <Block style={{ width: '76%', height: 22 }} /><Block style={{ width: '60%', height: 18 }} />
      <View style={[s.row, { marginTop: 4 }]}><View style={{ flex: 1, gap: 4 }}><View style={s.row}><Block style={{ flex: 1, height: 15 }} /><Block style={{ flex: 1, height: 15 }} /></View><View style={s.row}><Block style={{ flex: 1, height: 15 }} /><Block style={{ flex: 1, height: 15 }} /></View></View><Block style={{ width: 42, height: 22, borderRadius: 11 }} /></View>
    </View>)}
  </SkeletonRegion>;
}

export function PlayerTimelineSkeleton() {
  return <SkeletonRegion label="טוענים את ציר הזמן" gap={0}>
    <View style={[s.panel, { padding: 16, borderRadius: 24, marginBottom: 17 }]}>
      <View style={[s.row, { gap: 13 }]}><Portrait size={78} /><Lines /></View>
      <View style={[s.row, { marginTop: 6 }]}><Block style={{ flex: 1, height: 32, borderRadius: 16 }} /><Block style={{ flex: 1, height: 32, borderRadius: 16 }} /></View>
    </View>
    <View style={[s.row, { gap: 9, marginBottom: 16 }]}>{[0, 1, 2].map(i => <Block key={i} style={{ width: '28%', height: 36, borderRadius: 18 }} />)}</View>
    {[0, 1, 2].map(i => <View key={i} style={[s.row, { alignItems: 'flex-start', marginBottom: 12 }]}><Block style={{ width: 28, height: 28, borderRadius: 14 }} /><View style={[s.panel, { flex: 1, padding: 13, borderRadius: 20 }]}><Heading /><Lines /></View></View>)}
  </SkeletonRegion>;
}

export function MiniGamesSkeleton({ filters = false }: { filters?: boolean }) {
  return <SkeletonRegion label="טוענים את המשחקונים" gap={12}>
    <Block style={{ width: '43%', height: 28, borderRadius: 14 }} />
    {filters ? <View style={s.row}>{[0, 1, 2].map(i => <Block key={i} style={{ width: '28%', height: 34, borderRadius: 17 }} />)}</View> : null}
    {[0, 1, 2].map(i => <View key={i} style={s.miniGame}>
      <View style={s.miniHead}><Block style={{ flex: 1, height: 20 }} /><Block style={{ width: 56, height: 24, borderRadius: 12 }} /></View>
      <View style={s.miniScore}><View style={s.metric}><Block style={{ width: '76%', height: 18 }} /><Block style={{ width: 42, height: 34 }} /></View><Block style={{ width: 12, height: 24 }} /><View style={s.metric}><Block style={{ width: '76%', height: 18 }} /><Block style={{ width: 42, height: 34 }} /></View></View>
    </View>)}
  </SkeletonRegion>;
}

/** Public previews expose club information and public rounds, without member statistics. */
export function PublicClubSkeleton() {
  return <SkeletonRegion label="טוענים את פרטי המועדון" gap={0}>
    <View style={{ minHeight: 230, padding: 16, borderRadius: 20, justifyContent: 'flex-end', gap: 10, backgroundColor: '#E7EEF8' }}><Block style={{ width: '76%', height: 32 }} /><View style={s.row}><Block style={{ flex: 1, height: 20 }} /><Block style={{ width: 102, height: 27, borderRadius: 18 }} /></View></View>
    <View style={[s.row, { gap: 0, backgroundColor: 'white', borderTopLeftRadius: 22, borderTopRightRadius: 22 }]}>{[0, 1, 2].map(i => <View key={i} style={{ flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center' }}><Block style={{ width: '65%', height: 18 }} /></View>)}</View>
    <View style={{ padding: 16, gap: 12 }}><View style={s.panel}><Heading /><Lines /></View><View style={s.panel}><Heading /><View style={s.row}><Block style={{ flex: 1, height: 18 }} /><Block style={{ flex: 1, height: 18 }} /></View><Block style={{ height: 44, borderRadius: 12 }} /></View></View>
  </SkeletonRegion>;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  metric: { flex: 1, alignItems: 'center', gap: 6, minWidth: 0 },
  panel: { padding: 14, gap: 10, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5ECF7' },
  playerHero: { minHeight: 142, alignItems: 'center', justifyContent: 'center', padding: 8, gap: 2, borderRadius: 14, backgroundColor: '#E8F2FB' },
  action: { flex: 1, height: 44, borderRadius: 12 },
  ownNumbers: { paddingVertical: 16, backgroundColor: '#EFF6FF', borderRadius: 14 },
  clubRow: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  award: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 61, paddingVertical: 8 },
  divider: { borderTopWidth: 1, borderTopColor: '#ECF2FC' },
  pitch: { height: 118, marginHorizontal: 5, marginBottom: 4, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: '#F1F8F5' },
  scoreHero: { paddingVertical: 20, paddingHorizontal: 24, alignItems: 'center', gap: 8, borderRadius: 23, backgroundColor: '#DDEAFE' },
  seasonHero: { minHeight: 74, padding: 12, gap: 2, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#FFFFFF' },
  achievementGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between' },
  achievementTile: { width: '49%', minHeight: 82, padding: 8, gap: 4, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DDEAFB' },
  compareTile: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 16, backgroundColor: '#F6F8FC', borderWidth: StyleSheet.hairlineWidth, borderColor: '#E7ECF4' },
  miniGame: { borderWidth: 1, borderColor: '#E5ECF7', borderRadius: 18, backgroundColor: '#FFFFFF', overflow: 'hidden' },
  miniHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#F4F7FB' },
  miniScore: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
});
