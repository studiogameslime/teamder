import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { UserAvatar } from '@/components/UserAvatar';
import { StatisticsIllustration } from './StatisticsIllustration';
import { PersonalScoreChart } from './PersonalScoreChart';
import { RTL_LABEL_ALIGN, clubShadow } from '@/theme';
import type { NamedStat, PlayerStatsSummary } from '@/services/playerStatsService';
import type { User } from '@/types';
import { he } from '@/i18n/he';

export type StatisticsPerson = Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;
export interface PersonalPenalties {
  penTaken: number; penScored: number; penFaced: number; penSaved: number; ownGoals: number; ties: number;
}
const BLUE = '#2467F4';

export function StatisticsBrand() {
  return <View style={s.brand}>
    <Image source={require('@/assets/images/logo.png')} style={s.logo} />
    <Text style={s.brandName}>Teamder</Text>
  </View>;
}

/** Decorative only; figures and chart values always come from the caller. */
function PitchLines() {
  return <View pointerEvents="none" style={StyleSheet.absoluteFill} accessible={false} importantForAccessibility="no-hide-descendants">
    <Svg width="100%" height="100%" viewBox="0 0 340 120" preserveAspectRatio="none">
      <Rect x={12} y={8} width={316} height={104} rx={3} fill="none" stroke="#FFFFFF" strokeOpacity={0.16} strokeWidth={1.4} />
      <Path d="M170 8V112 M12 36H48V84H12 M328 36H292V84H328 M12 49H29V71H12 M328 49H311V71H328" fill="none" stroke="#FFFFFF" strokeOpacity={0.16} strokeWidth={1.4} />
      <Circle cx={170} cy={60} r={23} fill="none" stroke="#FFFFFF" strokeOpacity={0.16} strokeWidth={1.4}/>
    </Svg>
  </View>;
}

export function PersonalStatisticsCard({ user, stats, people, pen, highlightsLoading = false }: {
  user: StatisticsPerson | null;
  stats: PlayerStatsSummary;
  people: Record<string, StatisticsPerson>;
  pen: PersonalPenalties | null;
  highlightsLoading?: boolean;
}) {
  const relations: [keyof typeof Ionicons.glyphMap, string, NamedStat | null, (n: number) => string][] = [
    ['people-outline', he.statMostPlayedWith, stats.mostPlayedWith, he.statMostPlayedWithSub],
    ['trophy-outline', he.statMostWinsWith, stats.mostWinsWith, he.statMostWinsWithSub],
    ['hand-right-outline', he.statMostAssistedBy, stats.mostAssistedBy, he.statMostAssistedBySub],
    ['hand-left-outline', he.statMostAssistedTo, stats.mostAssistedTo, he.statMostAssistedToSub],
    ['thumbs-up-outline', he.statBiggestVictim, stats.biggestVictim, he.statBiggestVictimSub],
    ['flame-outline', he.statNemesis, stats.nemesis, he.statNemesisSub],
  ];
  return <View style={s.wrap}>
    <View style={[s.card, s.identity]}>
      <UserAvatar user={user} size={64} />
      <View style={s.identityCopy}>
        <Text style={s.name}>{user?.name || 'הכרטיס שלי'}</Text>
        <Text style={s.subtitle}>המספרים שלך על המגרש</Text>
      </View>
    </View>
    <LinearGradient colors={['#287BFF', '#1354DC']} start={{x:0,y:0}} end={{x:1,y:1}} style={s.numbers}>
      <PitchLines />
      <View style={s.heroFigures}>
      {([
        [stats.goals, 'שערים', 'soccer'],
        [stats.assists, 'בישולים', 'shoe-cleat'],
        [stats.attendedGames, 'מחזורים', 'calendar-month-outline'],
      ] as const).map(([value,label,icon],i)=><View key={label} style={[s.numberCell,i>0&&s.numberBorder]}>
        <MaterialCommunityIcons name={icon} size={25} color="#FFF"/>
        <Text style={s.bigNumber}>{value}</Text><Text style={s.metricText}>{label}</Text>
      </View>)}
      </View>
      <Text style={s.heroCaption}>{stats.attendedGames>0?stats.goalsPerEvening.toFixed(1):'—'} שערים למחזור · {stats.distinctPlayers} שחקנים ששיחקת איתם</Text>
    </LinearGradient>
    {pen && pen.ownGoals>0?<View style={s.ownGoals}><Text style={s.subtitle}>{pen.ownGoals} שערים עצמיים</Text><Ionicons name="football-outline" size={18} color="#657696"/></View>:null}
    <PersonalScoreChart points={stats.highlights?.points ?? []} recentCount={stats.highlights?.recentCount ?? Math.min(5,stats.attendedGames)} loading={highlightsLoading} />
    {highlightsLoading ? <Text style={s.subtitle}>טוען את נתוני המחזורים…</Text> : stats.highlights?.incomplete ? <Text style={s.subtitle}>חלק מנתוני המחזורים לא נטענו. מוצגים הנתונים הזמינים בלבד.</Text> : null}
    {stats.highlights && ((stats.highlights.bestGoals ?? 0)>0 || (stats.highlights.bestAssists ?? 0)>0) ? <>
      <Text style={s.section}>הרגעים הבולטים שלך</Text>
      <View style={s.highlights}>
        {(stats.highlights.bestGoals??0)>0&&<View style={[s.card,s.highlight,{backgroundColor:'#FFFCF4'}]}><View style={s.personCopy}><Text style={s.highlightNumber}>{stats.highlights.bestGoals}</Text><Text style={s.personTitle}>המחזור הכי פורה</Text><Text style={s.personSub}>שערים במחזור אחד</Text></View><StatisticsIllustration kind="trophy" size={55}/></View>}
        {(stats.highlights.bestAssists??0)>0&&<View style={[s.card,s.highlight,{backgroundColor:'#F3F9FF'}]}><View style={s.personCopy}><Text style={s.highlightNumber}>{stats.highlights.bestAssists}</Text><Text style={s.personTitle}>שיא בישולים</Text><Text style={s.personSub}>במחזור אחד</Text></View><StatisticsIllustration kind="boot" size={55}/></View>}
      </View><Text style={[s.subtitle,{fontSize:11}]}>לפי {stats.highlights.recordedRounds} מחזורים עם נתונים מתועדים</Text>
    </>:null}
    <View style={s.card}>
      <Text style={s.section}>עוד על המשחק שלך</Text>
      <View style={s.personalGrid}>
        <SmallStat value={stats.attendedGames>0?(stats.assists/stats.attendedGames).toFixed(1):'—'} label="בישולים למחזור" icon="shoe-cleat"/>
        <SmallStat value={stats.attendedGames>0?((stats.goals+stats.assists)/stats.attendedGames).toFixed(1):'—'} label="שערים ובישולים למחזור" icon="chart-bar"/>
        <SmallStat value={stats.totalRegistered>0?`${stats.attendanceRate}%`:'—'} label="השתתפות במחזורים שנרשמת אליהם" icon="account-group-outline"/>
      </View>
    </View>
    {stats.highlights?.results && <View style={s.card}>
      <Text style={s.section}>תוצאות המשחקים שלך</Text>
      <View style={s.personalGrid}><SmallStat value={stats.highlights.results.wins} label="ניצחונות" color="#139A55"/><SmallStat value={stats.highlights.results.losses} label="הפסדים" color="#DF4B50"/><SmallStat value={stats.highlights.results.ties} label="תיקו"/></View>
      <View style={s.resultBar} accessible accessibilityLabel="התפלגות תוצאות המשחקים">
        <View style={{flex:stats.highlights.results.wins,backgroundColor:'#3DC77B'}}/>
        <View style={{flex:stats.highlights.results.losses,backgroundColor:'#FF7768'}}/>
        <View style={{flex:stats.highlights.results.ties,backgroundColor:'#385B97'}}/>
      </View>
      <Text style={[s.subtitle,{textAlign:'center',marginTop:10}]}>{stats.highlights.results.games>0?`${Math.round(stats.highlights.results.wins/stats.highlights.results.games*100)}% ניצחונות · `:''}{stats.highlights.results.games} משחקים בתוך {stats.highlights.results.rounds} מחזורים מתועדים</Text>
    </View>}
    <View style={s.card}>
      <Text style={s.section}>החבר׳ה שלך</Text>
      {relations.map(([icon, title, stat, sub], index) => {
        const person = stat ? people[stat.uid] : null;
        return <View key={title} style={[s.person, index > 0 && s.divider]}>
          {person ? <UserAvatar user={person} size={42} /> : <View style={s.personPlaceholder}><Ionicons name="person-outline" size={23} color="#91A1BA" /></View>}
          <View style={s.personCopy}>
            <Text style={s.personTitle}>{title}</Text>
            <Text style={s.personSub}>{stat ? `${person?.name ? `${person.name} · ` : ''}${sub(stat.count)}` : he.statsPersonEmpty}</Text>
          </View>
          <View style={s.personIcon}><Ionicons name={icon} size={22} color="#244D90" /></View>

        </View>;
      })}
    </View>
    {pen?<View style={s.card}>
      <Text style={s.section}>פנדלים</Text>
      <View style={s.penaltyGrid}>
        <View style={[s.penaltySmall,s.penaltyDivider]}><View style={s.personCopy}><Text style={s.personTitle}>בועט</Text><Text style={s.smallNumber}>{pen.penScored} מתוך {pen.penTaken}</Text><Text style={s.personSub}>{pen.penTaken>0?`${Math.round(pen.penScored/pen.penTaken*100)}% הבקעה`:'טרם נבעטו פנדלים'}</Text></View><StatisticsIllustration kind="ball" size={37}/></View>
        <View style={s.penaltySmall}><View style={s.personCopy}><Text style={s.personTitle}>שוער</Text><Text style={s.smallNumber}>{pen.penSaved} מתוך {pen.penFaced}</Text><Text style={s.personSub}>{pen.penFaced>0?`${Math.round(pen.penSaved/pen.penFaced*100)}% עצירה`:'טרם עמדת בשער בפנדלים'}</Text></View><StatisticsIllustration kind="glove" size={37}/></View>
      </View>
    </View>:null}
  </View>;
}

function SmallStat({value,label,color='#142653',icon}:{value:string|number;label:string;color?:string;icon?:keyof typeof MaterialCommunityIcons.glyphMap}) {
 return <View style={s.smallStat}>{icon&&<MaterialCommunityIcons name={icon} size={23} color="#244D90"/>}<Text style={[s.smallNumber,{color}]}>{value}</Text><Text style={[s.personSub,{textAlign:'center',fontSize:11}]}>{label}</Text></View>;
}

export function PersonalStatisticsWelcome({ onFind }: { onFind?: () => void }) {
  return <View style={s.wrap}>
    <View style={s.card}>
      <View style={s.welcomeArt} accessible={false} importantForAccessibility="no-hide-descendants">
        <Image source={require('@/assets/images/personal-statistics-welcome.png')} resizeMode="contain" resizeMethod="resize" style={{width: '100%', height: 156}} />
      </View>
      <Text style={s.welcomeTitle}>הסיפור שלך על המגרש מתחיל כאן</Text>
      <Text style={s.welcomeBody}>אחרי המחזור הראשון, המספרים והשותפים שלך יופיעו כאן</Text>
    </View>
    <View style={s.preview}>
      <View style={s.previewHeading}><Text style={s.previewTitle}>הצצה לנתונים · דוגמה בלבד</Text><Ionicons name="information-circle-outline" size={18} color={BLUE} /></View>
      <View style={s.previewNumbers}>
        {([[12, 'מחזורים', 'soccer-field'], [8, 'שערים', 'soccer'], [5, 'בישולים', 'shoe-cleat']] as const).map(([n,label,icon], index) => <View style={[s.previewCell,index > 0 && s.previewDivider]} key={label}>
          <View style={s.metricLabel}><Text style={s.previewNumber}>{n}</Text><MaterialCommunityIcons name={icon} size={25} color="#142653" /></View><Text style={s.previewCaption}>{label}</Text>
        </View>)}
      </View>
      <Text style={s.demoDisclaimer}>הנתונים להמחשה בלבד</Text>
    </View>
    {onFind ? <StatisticsAction title="מצא מחזור לשחק בו" icon="arrow-back" onPress={onFind} /> : null}
    <View style={s.card}>
      <Text style={s.section}>מה מחכה לך כאן?</Text>
      {([
        ['bar-chart-outline', 'המספרים שלך', 'מחזורים, שערים ובישולים'],
        ['analytics-outline', 'הציונים והרגעים שלך', 'מגמת ציונים ושיאים במחזורים מתועדים'],
        ['people-outline', 'החבר׳ה שאיתך', 'השותפים והצמדים שלך'],
      ] as const).map(([icon,title,body],index) => <View key={title} style={[s.feature,index > 0 && s.divider]}>
        <View style={s.personCopy}><Text style={s.personTitle}>{title}</Text><Text style={s.personSub}>{body}</Text></View>
        <View style={s.featureIcon}><Ionicons name={icon} size={26} color="#142653" /></View>
      </View>)}
    </View>
  </View>;
}

export function StatisticsAction({ title, icon, onPress, disabled }: { title: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled: !!disabled}} disabled={disabled} onPress={onPress} style={({pressed})=>[s.action, (pressed || disabled) && {opacity:0.65}]}>
    <Text style={s.actionText}>{title}</Text><Ionicons name={icon} size={23} color="#FFF" />
  </Pressable>;
}

const s = StyleSheet.create({
  heroFigures:{flexDirection:'row'},heroCaption:{color:'#EDF5FF',fontSize:11,textAlign:'center',borderTopWidth:1,borderColor:'#FFFFFF40',marginTop:10,paddingTop:8,marginHorizontal:12},
  highlights:{flexDirection:'row',gap:10},highlight:{flex:1,flexDirection:'row',alignItems:'center',gap:4,padding:10},highlightNumber:{fontSize:29,fontWeight:'900',color:'#111B40',textAlign:RTL_LABEL_ALIGN},
  penaltyGrid:{flexDirection:'row',gap:10,marginTop:5},penaltySmall:{flex:1,flexDirection:'row',alignItems:'center',gap:4,paddingVertical:2},penaltyDivider:{borderEndWidth:1,borderColor:'#E5ECF5',paddingEnd:8},
  personalGrid:{flexDirection:'row',gap:10,marginTop:8},smallStat:{flex:1,alignItems:'center',gap:4},smallNumber:{fontSize:23,fontWeight:'800',color:'#111B40',textAlign:RTL_LABEL_ALIGN},
  resultBar:{flexDirection:'row',height:7,borderRadius:5,overflow:'hidden',marginTop:12,backgroundColor:'#E5ECF5'},
  wrap: { gap: 12 },
  card: { backgroundColor: '#FFF', borderRadius: 17, padding: 14, ...clubShadow },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 5 }, logo: { width: 25, height: 25, borderRadius: 6 }, brandName: { fontSize: 15, color: '#111B40', fontWeight: '800' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 6, backgroundColor: 'transparent',shadowOpacity:0,elevation:0 },
  identityCopy: { flex: 1, gap: 5 }, name: { fontSize: 22, fontWeight: '800', color: '#111B40', textAlign: RTL_LABEL_ALIGN }, subtitle: { fontSize: 13, color: '#657696', textAlign: RTL_LABEL_ALIGN },
  numbers: { borderRadius: 15, paddingVertical: 13, paddingHorizontal: 8, overflow: 'hidden' },
  numberCell: { flex: 1, alignItems: 'center', gap: 6 }, numberBorder: { borderStartWidth: 1, borderColor: '#FFFFFF33' }, bigNumber: { color: '#FFF', fontSize: 36, fontWeight: '900' },
  metricLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }, metricText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  ownGoals: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 },
  moment: { borderRadius: 13, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }, momentCopy: { flex: 1 }, momentTitle: { color: '#F1C66C', fontSize: 18, fontWeight: '800', textAlign: RTL_LABEL_ALIGN }, momentBody: { color: '#FFF', fontSize: 12, marginTop: 3, textAlign: RTL_LABEL_ALIGN },
  penalties: { flexDirection: 'row', gap: 10, alignItems: 'stretch' }, penalty: { flex: 1, alignItems: 'center', gap: 6, paddingHorizontal: 8 }, penaltyTitle: { color: '#111B40', fontSize: 14, fontWeight: '800', textAlign: 'center' }, penaltyValue: { color: '#111B40', fontWeight: '800', fontSize: 20, textAlign: 'center' }, penaltyCaption: { color: '#657696', fontSize: 12, lineHeight: 18, textAlign: 'center' }, penaltyEmpty: { flex: 1, justifyContent: 'center', paddingVertical: 12 },
  section: { color: '#111B40', fontSize: 19, fontWeight: '800', textAlign: RTL_LABEL_ALIGN, marginBottom: 4 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9 }, personCopy: { flex: 1, minWidth: 0, gap: 4 }, personTitle: { color: '#111B40', fontSize: 15, fontWeight: '800', textAlign: RTL_LABEL_ALIGN }, personSub: { color: '#526C93', fontSize: 12, lineHeight: 18, textAlign: RTL_LABEL_ALIGN }, personIcon: { width: 35, height: 35, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, personPlaceholder: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' }, divider: { borderTopWidth: 1, borderColor: '#E5ECF5' },
  welcomeArt: { alignItems: 'center', marginVertical: 8 }, welcomeTitle: { color: '#111B40', fontSize: 23, lineHeight: 30, textAlign: 'center', fontWeight: '800', paddingHorizontal: 10 }, welcomeBody: { color: '#657696', fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: 10, marginBottom: 8 },
  preview: { borderRadius: 15, borderWidth: 1, borderColor: '#D8E9FF', backgroundColor: '#E8F3FF', padding: 12 }, previewHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }, previewTitle: { color: BLUE, fontSize: 14, fontWeight: '800', flexShrink: 1 }, previewNumbers: { flexDirection: 'row', paddingVertical: 15, backgroundColor: '#F5FAFF', borderRadius: 12, marginVertical: 12 }, previewCell: { flex: 1, alignItems: 'center', gap: 5 }, previewDivider: { borderStartWidth: 1, borderColor: '#D7E6FA' }, previewNumber: { color: '#111B40', fontSize: 27, fontWeight: '900' }, previewCaption: { color: '#344D79', fontSize: 13, fontWeight: '700' }, demoDisclaimer: { color: '#728CB1', textAlign: 'center', fontSize: 12 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 }, featureIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EDF5FF' },
  action: { borderRadius: 13, backgroundColor: BLUE, minHeight: 49, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, actionText: { color: '#FFF', fontSize: 16, fontWeight: '700', flexShrink: 1 },
});
