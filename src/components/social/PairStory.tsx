import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SocialPairSummary } from '@/types/social';
import { RTL_LABEL_ALIGN } from '@/theme';

export function PairStory({ summary, name }: { summary: SocialPairSummary; name: string }) {

  const block = (title: string, icon: keyof typeof Ionicons.glyphMap, data: SocialPairSummary['sameTeam'], against = false) => <View style={s.block}>
    <View style={s.heading}><Ionicons name={icon} size={20} color="#2563EB"/><Text style={s.title}>{title}</Text></View>
    {data ? <><Text style={s.total}>{data.games} <Text style={s.caption}>משחקים {against ? 'אחד מול השני' : 'באותה קבוצה'}</Text></Text>
      <View style={s.row}>{[[data.wins,against?'ניצחונות שלך':'ניצחונות','#15803D'],[data.losses,against?'ניצחונות שלו':'הפסדים','#DC4545'],[data.ties,'תיקו','#526785']].map(([n,label,color])=><View key={String(label)} style={s.metric}><Text style={[s.value,{color:String(color)}]}>{n}</Text><Text style={s.label}>{label}</Text></View>)}</View>
    </> : <Text style={s.copy}>אין עדיין תוצאות מתועדות לחלק הזה.</Text>}
  </View>;
  const noPlay = summary.sharedRounds === 0 && !summary.sameTeam?.games && !summary.against?.games;
  const noAssists = summary.assists && summary.assists.toOther + summary.assists.fromOther === 0;
  return <View style={s.card}>
    <View style={s.heading}><Ionicons name="people-outline" size={23} color="#2563EB"/><Text style={[s.title,{fontSize:19}]}>הסיפור שלכם על המגרש</Text></View>
    <Text style={s.copy}>{summary.sharedRounds} מחזורים שבהם שניכם השתתפתם</Text>
    {block('באותה קבוצה','shield-outline',summary.sameTeam)}
    {block('ראש בראש','flash-outline',summary.against,true)}
    <View style={[s.block,{backgroundColor:'#F5F2FF'}]}>
      <View style={s.heading}><Ionicons name="git-branch-outline" size={20} color="#7650B7"/><Text style={s.title}>מבשלים אחד לשני</Text></View>
      {summary.assists ? <><View style={s.row}><View style={s.metric}><Text style={[s.value,{color:'#7650B7'}]}>{summary.assists.toOther}</Text><Text style={s.label}>בישולים שלך אליו</Text></View><View style={s.metric}><Text style={[s.value,{color:'#7650B7'}]}>{summary.assists.fromOther}</Text><Text style={s.label}>בישולים שלו אליך</Text></View></View>
        {noAssists ? <Text style={s.copy}>{noPlay ? 'הסיפור שלכם עוד לא התחיל. קובעים מחזור ועולים יחד למגרש?' : 'הבישול הראשון ביניכם עוד מחכה. מי ימסור את המסירה לגול?'}</Text> : null}
      </> : <Text style={s.copy}>עדיין אין נתוני בישולים הדדיים מתועדים.</Text>}
    </View>
    {summary.lastSharedRoundAt ? <View style={s.heading}><Ionicons name="calendar-outline" size={17} color="#667796"/><Text style={s.copy}>נפגשתם לאחרונה במחזור ב־{new Date(summary.lastSharedRoundAt).toLocaleDateString('he-IL')}</Text></View> : null}
    <Text style={s.note}>תוצאות ובישולים לפי משחקים מתועדים · מכל המועדונים והעונות</Text>
  </View>;
}
const s=StyleSheet.create({card:{backgroundColor:'#FFF',borderRadius:15,padding:14,gap:10,borderWidth:1,borderColor:'#E5EDF6'},heading:{flexDirection:'row',alignItems:'center',gap:8},title:{flex:1,fontSize:15,fontWeight:'800',color:'#142653',textAlign:RTL_LABEL_ALIGN},copy:{fontSize:12,lineHeight:19,color:'#667796',textAlign:RTL_LABEL_ALIGN,flexShrink:1},block:{padding:12,borderRadius:12,backgroundColor:'#F0F6FF',gap:8},total:{fontSize:26,fontWeight:'800',color:'#2563EB',textAlign:RTL_LABEL_ALIGN},caption:{fontSize:12,fontWeight:'500',color:'#526785'},row:{flexDirection:'row',gap:8},metric:{flex:1,alignItems:'center',gap:4},value:{fontSize:23,fontWeight:'800'},label:{fontSize:11,lineHeight:16,color:'#526785',textAlign:'center'},note:{fontSize:10,lineHeight:16,color:'#8290A5',textAlign:RTL_LABEL_ALIGN}});
