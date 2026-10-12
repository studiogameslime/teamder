import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, AccessibilityInfo, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, Ellipse, Line, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { userService } from '@/services';
import { playerStatsService, type PlayerStatsSummary } from '@/services/playerStatsService';
import { StatisticsIllustration } from '@/components/stats/StatisticsIllustration';
import { UserAvatar } from '@/components/UserAvatar';
import { homeStatsSlides, nextPersonalMilestone } from '@/utils/homePersonalStats';
import { scoreTrend } from '@/utils/personalStatistics';
import { RTL_LABEL_ALIGN } from '@/theme';
import type { User } from '@/types';
import type { ScorePoint } from '@/utils/managerDashboard';

type Partner = Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;
type Preview = { stats: PlayerStatsSummary; partner?: Partner };
function FootballDataIllustration() {
  return <View style={s.dataArt} pointerEvents="none">
    <Text style={s.dataArtText}>משחקים טובים{ '\n' }יוצרים שחקנים טובים יותר</Text>
    <Image source={require('@/assets/images/football-data-v2.png')} style={{width:64,height:56}} resizeMode="contain" accessible={false}/>
  </View>;
}
function PitchWatermark() {
  return <View pointerEvents="none" style={s.pitch} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width="100%" height="100%" viewBox="0 0 240 150" accessible={false}>
      <Defs><RadialGradient id="homePitchGlow" cx="0%" cy="0%" rx="95%" ry="100%"><Stop offset="0" stopColor="#BED8FF" stopOpacity={0.8} /><Stop offset="0.48" stopColor="#E4EFFF" stopOpacity={0.5} /><Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} /></RadialGradient></Defs>
      <Rect width={240} height={150} fill="url(#homePitchGlow)" />
      <Path d="M68 -18L176 11L122 87L10 57Z M122 -3L66 72 M47 11L74 18L51 49L24 42 M159 6L184 13L165 40L148 35 M57 -2L87 6L55 61L23 53" stroke="#FFFFFF" strokeOpacity={0.8} strokeWidth={1.4} fill="none" strokeLinejoin="round" />
      <Ellipse cx={94} cy={35} rx={21} ry={15} rotation={-54} origin="94, 35" stroke="#FFFFFF" strokeOpacity={0.8} strokeWidth={1.4} fill="none" />
      <Circle cx={94} cy={35} r={1.6} fill="#FFFFFF" fillOpacity={0.8} />
    </Svg>
  </View>;
}
function PartnerResults({ results }: { results: NonNullable<PlayerStatsSummary['regularPartnerResults']> }) {
  return <View style={s.partnerResults}>
    <View style={s.resultRow}>{[{ label: 'ניצחונות', value: results.wins, color: '#148650' }, { label: 'הפסדים', value: results.losses, color: '#D55561' }, { label: 'תיקו', value: results.ties, color: '#65799C' }].map(item => <View key={item.label} style={s.resultCell}><Text style={[s.resultValue, { color: item.color }]}>{item.value}</Text><Text style={s.metricText}>{item.label}</Text></View>)}</View>
    <Text style={s.resultCaption}>{results.winRate}% ניצחונות · {results.games} משחקים באותה קבוצה</Text>
  </View>;
}
function MiniScores({ points }: { points: ScorePoint[] }) {
  const [width, setWidth] = useState(300);
  const { fontScale } = useWindowDimensions();
  const up = scoreTrend(points) === 'up';
  const coords = points.map((p, i) => ({ x: points.length === 1 ? width / 2 : width - 26 - i * (width - 52) / (points.length - 1), y: 95 - p.score * 6 }));
  const line = coords.map((p, i) => i ? `C${(coords[i - 1].x + p.x) / 2},${coords[i - 1].y} ${(coords[i - 1].x + p.x) / 2},${p.y} ${p.x},${p.y}` : `M${p.x},${p.y}`).join(' ');
  return <View onLayout={e => setWidth(Math.max(100, e.nativeEvent.layout.width))} accessible accessibilityLabel={`הציונים מהישן לחדש: ${points.map(p => p.score.toFixed(1)).join(', ')}`}>
    {fontScale > 1.5 ? <View style={{ gap: 6, marginTop: 10 }}>{points.map(p => <Text key={p.gameId} style={s.subtitle}>{new Date(p.at).toLocaleDateString('he-IL')}: {p.score.toFixed(1)} מתוך 10</Text>)}</View> : <Svg width={width} height={122} accessible={false}>
      {[35, 65, 95].map(y => <Line key={y} x1={20} x2={width - 20} y1={y} y2={y} stroke="#E5EDF9" strokeDasharray="3 4" />)}
      {coords.length > 1 && <><Path d={`${line} L${coords[coords.length - 1].x},100 L${coords[0].x},100 Z`} fill="#2870F4" opacity={0.08} /><Path d={line} fill="none" stroke="#2870F4" strokeWidth={3} strokeLinejoin="round" /></>}
      {coords.map((p, i) => <React.Fragment key={points[i].gameId}><Circle cx={p.x} cy={p.y} r={4.5} fill={up && i === coords.length - 1 ? '#139A55' : '#2870F4'} stroke="#FFF" strokeWidth={2} /><SvgText x={p.x} y={p.y - 12} textAnchor="middle" fontSize={14} fontWeight="700" fill="#15244F">{points[i].score.toFixed(1)}</SvgText><SvgText x={p.x} y={117} textAnchor="middle" fontSize={10} fill="#7484A2">{new Date(points[i].at).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}</SvgText></React.Fragment>)}
    </Svg>}
  </View>;
}

/** Read-only home entry to lifetime statistics; never turns a failed read into an empty player. */
export function HomePersonalStats({ user, onOpen, preview }: { user: User; onOpen: () => void; preview?: Preview }) {
  const [result, setResult] = useState<{ owner: string; stats: PlayerStatsSummary; partner?: Partner } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [index, setIndex] = useState(0);
  const [reduced, setReduced] = useState(false);
  const list = useRef<FlatList<string>>(null);
  const [width, setWidth] = useState(330);
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  const visibleRef = useRef(({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => { if (viewableItems[0]?.index != null) setIndex(viewableItems[0].index); }).current;
  useEffect(() => { let alive = true; void AccessibilityInfo.isReduceMotionEnabled().then(v => { if (alive) setReduced(v); }); const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced); return () => { alive = false; sub.remove(); }; }, []);
  useFocusEffect(React.useCallback(() => {
    let alive = true;
    setFailed(false);
    if (preview) return () => { alive = false; };
    void (async () => {
      try {
        const fresh = await userService.getUserById(user.id);
        if (!alive) return;
        const stats = await playerStatsService.compute(user.id, { goals: fresh?.stats?.goals ?? user.stats?.goals ?? 0, assists: fresh?.stats?.assists ?? user.stats?.assists ?? 0, isCurrent: () => alive, recentHighlightsOnly: true });
        if (!alive) return;
        setResult({ owner: user.id, stats });
        if (stats.mostPlayedWith) {
          const partner = await userService.getUserById(stats.mostPlayedWith.uid).catch(() => null);
          if (alive && partner) setResult({ owner: user.id, stats, partner });
        }
      } catch { if (alive) setFailed(true); }
    })();
    return () => { alive = false; };
  }, [user.id, user.stats?.goals, user.stats?.assists, retry, preview]));
  const data = preview ?? (result?.owner === user.id ? result : null);
  const slides = data ? homeStatsSlides(data.stats).filter(s => s !== 'partner' || data.partner) : [];
  const current = Math.min(index, Math.max(0, slides.length - 1));
  const select = (next: number) => { list.current?.scrollToIndex({ index: next, animated: !reduced }); };
  useEffect(() => { setIndex(0); list.current?.scrollToOffset({ offset: 0, animated: false }); }, [user.id, preview]);
  const stats = data?.stats;
  const milestone = stats ? nextPersonalMilestone(stats.goals) : null;
  const renderCard = (slide: string) => <Pressable onLayout={e => { const height = e.nativeEvent.layout.height; setCardHeights(old => Math.abs((old[slide] ?? 0) - height) < 0.5 ? old : { ...old, [slide]: height }); }} onPress={onOpen} accessibilityRole="button" accessibilityLabel="פתיחת הסטטיסטיקה האישית" style={[s.card, { alignSelf: 'flex-start', width: slides.length > 1 ? width - 14 : width }]}>
        <PitchWatermark />
        <View>
          {!stats ? <View style={s.loading}>{failed ? <Text style={s.subtitle}>לא הצלחנו לטעון את הנתונים שלך</Text> : <ActivityIndicator color="#2467F4" />}</View> : !slides.length ? <>
            <Text style={s.title}>הכדורגל שלך מתחיל כאן</Text><Text style={s.subtitle}>אחרי המחזור הראשון יתחילו להצטבר הציונים, השערים והבישולים שלך</Text>
            <View style={s.art}><StatisticsIllustration kind="boot" size={58} /><StatisticsIllustration kind="ball" size={68} /><StatisticsIllustration kind="trophy" size={54} /></View>
            <View style={s.labels}>{['ציונים', 'שערים', 'בישולים'].map(t => <Text key={t} style={s.label}>{t}</Text>)}</View>
          </> : slide === 'scores' ? <><Text style={s.title}>הכושר האחרון שלך</Text><Text style={s.subtitle}>הציונים שלך ב־{stats.highlights!.recentCount} המחזורים האחרונים</Text><MiniScores points={stats.highlights!.points.slice(-5)} /><View style={s.scoreFoot}><Text style={[s.trend, { color: scoreTrend(stats.highlights!.points) === 'up' ? '#139A55' : '#607292' }]}>{stats.highlights!.points.length < 2 ? 'ציון מחזור מתוך 10' : { up: 'במגמת עלייה', down: 'במגמת ירידה', mixed: 'מגמה מעורבת', stable: 'ללא שינוי' }[scoreTrend(stats.highlights!.points)]}</Text><FootballDataIllustration /></View></> : slide === 'numbers' ? <>
            <Text style={s.title}>המספרים שלך על המגרש</Text><Text style={s.subtitle}>כל שער, כל בישול וכל ערב של כדורגל</Text><View style={s.numbers}>{[{ n: stats.goals, t: 'שערים', k: 'ball' }, { n: stats.assists, t: 'בישולים', k: 'boot' }, { n: stats.attendedGames, t: 'מחזורים', k: 'trophy' }].map(v => <View style={s.metric} key={v.t}><StatisticsIllustration kind={v.k as 'ball' | 'boot' | 'trophy'} size={34} /><Text style={s.value}>{v.n}</Text><Text style={s.metricText}>{v.t}</Text></View>)}</View>
          </> : slide === 'partner' ? <><Text style={s.title}>השותף הקבוע שלך</Text><Text style={s.subtitle}>יש אנשים שהכדורגל פשוט מחבר ביניהם</Text><View style={s.partner}><UserAvatar user={data!.partner!} size={64} /><View><Text style={s.title}>{data!.partner!.name}</Text><Text style={s.subtitle}>{stats.mostPlayedWith!.count} מחזורים יחד</Text></View></View>{stats.regularPartnerResults && <PartnerResults results={stats.regularPartnerResults} />}</> : <><Text style={s.title}>היעד הבא שלך קרוב</Text><View style={s.partner}><StatisticsIllustration kind="trophy" size={72} /><View style={{ flex: 1 }}><Text style={s.value}>עוד {milestone!.remaining}</Text><Text style={s.subtitle}>שערים עד ל־{milestone!.target} שערים</Text></View></View></>}
        </View>
      </Pressable>;
  return <View style={s.section}>
    <View style={s.header}><Text style={s.heading}>הכדורגל שלך</Text><Pressable onPress={onOpen} accessibilityRole="button" style={s.link}><Text style={s.linkText}>לסטטיסטיקה שלך</Text><Ionicons name="chevron-back" size={16} color="#2467F4" /></Pressable></View>
    <View onLayout={e => setWidth(Math.max(100, e.nativeEvent.layout.width))}>
      <FlatList ref={list} horizontal data={slides.length ? slides : ['empty']} keyExtractor={item => item}
        style={{ height: cardHeights[slides[current] ?? 'empty'] }}
        renderItem={({ item }) => renderCard(item)} showsHorizontalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
        snapToInterval={width - 4} decelerationRate="fast" disableIntervalMomentum
        getItemLayout={(_, i) => ({ length: width - 4, offset: (width - 4) * i, index: i })}
        onViewableItemsChanged={visibleRef} viewabilityConfig={{ itemVisiblePercentThreshold: 70 }}
        extraData={{ stats, width }} />
    </View>
    {failed && <Pressable onPress={() => setRetry(n => n + 1)} style={s.retry} accessibilityRole="button"><Text style={s.linkText}>נסה שוב</Text></Pressable>}
    {slides.length > 1 && <View style={s.dots}>{slides.map((item, i) => <Pressable key={item} onPress={() => select(i)} accessibilityRole="button" accessibilityLabel={`הצגת ${['המספרים שלך', 'הציונים שלך', 'השותף שלך', 'היעד הבא'][['numbers', 'scores', 'partner', 'milestone'].indexOf(item)]}`} accessibilityState={{ selected: i === current }} style={s.dotTarget}><View style={[s.dot, i === current && s.activeDot]} /></Pressable>)}</View>}
  </View>;
}
const s = StyleSheet.create({
  partnerResults: { marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EAF0F9' }, resultRow: { flexDirection: 'row', gap: 8 }, resultCell: { flex: 1, alignItems: 'center', gap: 2 }, resultValue: { fontSize: 22, fontWeight: '800' }, resultCaption: { textAlign: 'center', fontSize: 11, color: '#65799C', marginTop: 8 },
  dataArt: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 }, dataArtText: { fontSize: 9, lineHeight: 14, color: '#7588A4', textAlign: RTL_LABEL_ALIGN, flexShrink: 1 },
  scoreFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }, trend: { fontSize: 12, fontWeight: '700' },
  section: { marginBottom: 18 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }, heading: { fontSize: 21, fontWeight: '800', color: '#15244F', textAlign: RTL_LABEL_ALIGN }, link: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 3 }, linkText: { fontSize: 13, fontWeight: '700', color: '#2467F4' },
  card: { padding: 16, minHeight: 204, borderRadius: 21, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4ECF9', overflow: 'hidden' }, title: { fontSize: 18, fontWeight: '800', color: '#15244F', textAlign: RTL_LABEL_ALIGN }, subtitle: { fontSize: 12, lineHeight: 19, color: '#7583A0', textAlign: RTL_LABEL_ALIGN, marginTop: 4 }, pitch: { position: 'absolute', right: 0, top: 0, width: 220, height: 138 },
  loading: { minHeight: 170, justifyContent: 'center', alignItems: 'center' }, numbers: { flexDirection: 'row', marginTop: 16 }, metric: { flex: 1, alignItems: 'center', gap: 2 }, value: { fontSize: 30, fontWeight: '800', color: '#2467F4', textAlign: RTL_LABEL_ALIGN }, metricText: { fontSize: 13, color: '#607292' }, art: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12, gap: 5 }, labels: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 8 }, label: { color: '#3B5D9B', backgroundColor: '#F1F6FE', paddingHorizontal: 14, paddingVertical: 5, borderRadius: 9, fontSize: 12 }, partner: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 20, marginBottom: 8 }, dots: { flexDirection: 'row', justifyContent: 'center' }, dotTarget: { width: 30, height: 32, justifyContent: 'center', alignItems: 'center' }, dot: { width: 6, height: 6, borderRadius: 4, backgroundColor: '#D5DEEE' }, activeDot: { width: 19, backgroundColor: '#2467F4' }, retry: { alignSelf: 'center', padding: 12 },
});
