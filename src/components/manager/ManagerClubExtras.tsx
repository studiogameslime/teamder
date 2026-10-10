import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { SafeModal } from '@/components/SafeModal';
import { ScrollSurface } from '@/components/ScrollSurface';
import { UserAvatar } from '@/components/UserAvatar';
import { UnverifiedEveningsCard } from '@/components/community/UnverifiedEveningsCard';
import { RTL_LABEL_ALIGN } from '@/theme';
import { clubRoundNumbers, managerNeedsAttention, type ClubResults } from '@/utils/managerClubInsights';
import type { ManagerData } from '@/services/managerDashboardService';
import type { Game, User } from '@/types';

const BLUE='#2467F5',GREEN='#13834A',AMBER='#A66709',PURPLE='#8052C8';
const date=(at:number)=>new Date(at).toLocaleDateString('he-IL',{day:'numeric',month:'numeric'});
function Label({children,style}:{children:React.ReactNode;style?:any}) {return <Text style={[s.text,style]}>{children}</Text>;}
function Card({title,icon,children}:{title:string;icon:keyof typeof Ionicons.glyphMap;children:React.ReactNode}) {
  return <View style={s.card}><View style={s.row}><Label style={s.heading}>{title}</Label><Ionicons name={icon} size={21} color={BLUE}/></View>{children}</View>;
}
export function ManagerRoundNumbers({games,results,loading,error,onRetry,onRound}:{games:Game[];results:ClubResults;loading:boolean;error:boolean;onRetry:()=>void;onRound:(id:string)=>void}) {
  const data=clubRoundNumbers(games,results);
  const max=data.maximum??0,axis=Math.max(2,Math.ceil(max/2)*2);
  const ordered=[...data.rounds].reverse();
  const width=280/Math.max(1,ordered.length),barWidth=Math.min(22,width*.65);
  return <Card title="המחזור במספרים" icon="bar-chart-outline">
    <Label style={s.muted}>{games.length===10?'10 המחזורים האחרונים':`${games.length} המחזורים האחרונים`} · מספר המשחקים בכל ערב</Label>
    {loading?<View style={s.loading}><ActivityIndicator color={BLUE}/><Label style={s.muted}>טוען את מספר המשחקים…</Label></View>:data.covered>0?<>
      <View style={s.metrics}>{[{n:data.average!.toLocaleString('he-IL',{maximumFractionDigits:1}),label:'משחקים בממוצע למחזור',color:BLUE},{n:max,label:'הכי הרבה במחזור',color:GREEN},{n:data.total,label:'משחקים בסך הכול',color:BLUE}].map(m=><View key={m.label} style={s.metric}><Label style={[s.number,{color:m.color}]}>{m.n}</Label><Label style={s.caption}>{m.label}</Label></View>)}</View>
      <Label style={s.muted}>{data.missing?`תיעוד זמין ל־${data.covered} מתוך ${games.length} מחזורים; הסיכום מחושב מהם בלבד.`:`מבוסס על ${games.length} מחזורים עם מספר משחקים מתועד.`}</Label>
      <Label style={s.chartTitle}>מספר המשחקים בכל מחזור</Label>
      <View accessible accessibilityLabel={`מספר המשחקים מהמחזור הישן לחדש: ${ordered.map(r=>r.count??'לא ידוע').join(', ')}`}>
        <Svg width="100%" height={145} viewBox="0 0 320 145">
          {[0,axis/2,axis].map(n=><React.Fragment key={n}><Line x1={30} x2={318} y1={112-n/axis*82} y2={112-n/axis*82} stroke="#E2EAF4"/><SvgText x={22} y={116-n/axis*82} textAnchor="end" fontSize={10} fill="#738099">{n}</SvgText></React.Fragment>)}
          {ordered.map((r,i)=>{const x=310-i*width-width/2,h=r.count===null?0:r.count/axis*82;return <React.Fragment key={r.game.id}>{r.count!==null&&r.count>0&&<Rect x={x-barWidth/2} y={112-h} width={barWidth} height={h} rx={3} fill={BLUE}/>}<SvgText x={x} y={r.count===null?104:104-h} textAnchor="middle" fontSize={10} fontWeight="700" fill={r.count===null?'#A66709':'#101B47'}>{r.count??'—'}</SvgText><SvgText x={x} y={132} textAnchor="middle" fontSize={9} fill="#738099">{i+1}</SvgText></React.Fragment>;})}
        </Svg>
      </View>
      <View style={[s.row,{justifyContent:'space-between'}]}><Label style={s.foot}>המחזור הישן ביותר</Label><Label style={s.foot}>המחזור האחרון</Label></View>
      {max>0&&<View style={s.highlight}><View style={{flex:1,gap:5}}><Label style={s.name}>{data.busiest.length===1?`המחזור העמוס ביותר: ${max} משחקים`:`${data.busiest.length} מחזורים בשיא משותף: ${max} משחקים`}</Label>{data.busiest.map(r=><Pressable key={r.game.id} accessibilityRole="button" accessibilityLabel={`פרטי המחזור העמוס ${date(r.game.startsAt)}`} onPress={()=>onRound(r.game.id)} style={s.row}><Label style={[s.muted,{color:BLUE,flex:1}]}>מחזור {date(r.game.startsAt)}</Label><Ionicons name="chevron-back" size={16} color={BLUE}/></Pressable>)}</View><Ionicons name="trophy-outline" size={26} color={BLUE}/></View>}
      <Label style={s.foot}>מחזור הוא ערב שלם; משחק הוא משחק אחד בתוך הערב. סימן — מציין שאין מספר משחקים מתועד.</Label>
    </>:<Label style={s.muted}>{error?'לא ניתן לטעון כרגע את מספר המשחקים.':'אין מספר משחקים מתועד למחזורי התקופה.'}</Label>}
    {!loading&&(error||data.missing>0)&&<Pressable accessibilityRole="button" onPress={onRetry} style={s.retry}><Label style={s.link}>נסה לטעון שוב</Label><Ionicons name="refresh" size={17} color={BLUE}/></Pressable>}
  </Card>;
}

export function ManagerAttention({data,now,onApprovals,onRate,onResolved}:{data:ManagerData;now:number;onApprovals:()=>void;onRate:(user:User)=>void;onResolved:()=>void}) {
  const attention=managerNeedsAttention(data.group,data.games,now);
  const [verify,setVerify]=useState(false),[ratings,setRatings]=useState(false);
  const users=new Map(data.users.map(u=>[u.id,u]));
  const topics=[
    {n:attention.pending.length,title:'בקשות הצטרפות ממתינות',description:'לפתיחת תור האישורים של המועדונים שבניהולך',icon:'people-outline' as const,color:BLUE,onPress:onApprovals},
    {n:attention.unverified.length,title:'מחזורים שממתינים לאימות',description:'צריך לאשר אם התקיימו · 90 הימים האחרונים',icon:'calendar-outline' as const,color:AMBER,onPress:()=>setVerify(v=>!v)},
    {n:attention.unrated.length,title:'שחקנים ללא דירוג מנהל',description:'דירוג פנימי במועדון · אפשר לדרג מכאן',icon:'person-outline' as const,color:PURPLE,onPress:()=>setRatings(true)},
  ].filter(t=>t.n>0);
  return <>
    <Card title="מה דורש טיפול?" icon="list-outline">
      {topics.length?<><Label style={s.muted}>{topics.length===1?'נושא אחד פתוח לניהול המועדון':`${topics.length} נושאים פתוחים לניהול המועדון`}</Label>{topics.map(t=><Pressable key={t.title} accessibilityRole="button" accessibilityLabel={`${t.title}: ${t.n}`} accessibilityState={t.icon==='calendar-outline'?{expanded:verify}:undefined} onPress={t.onPress} style={s.task}><View style={[s.count,{backgroundColor:t.color+'15'}]}><Label style={[s.countText,{color:t.color}]}>{t.n}</Label></View><View style={{flex:1,gap:4}}><Label style={s.name}>{t.title}</Label><Label style={s.muted}>{t.description}</Label></View><Ionicons name={t.icon} size={21} color={t.color}/><Ionicons name={t.icon==='calendar-outline'&&verify?'chevron-down':'chevron-back'} size={18} color={BLUE}/></Pressable>)}<Label style={s.foot}>הספירות מתייחסות למועדון הזה. נושאים שאין בהם דבר לטיפול מוסתרים.</Label></>:<View style={s.highlight}><Label style={[s.name,{flex:1,color:GREEN}]}>הכול מטופל כרגע</Label><Ionicons name="checkmark-circle-outline" size={24} color={GREEN}/></View>}
    </Card>
    {verify&&attention.unverified.length>0&&<UnverifiedEveningsCard groupId={data.group.id} groupName={data.group.name} isAdmin onResolved={onResolved}/>}
    <SafeModal visible={ratings} transparent animationType="fade" onRequestClose={()=>setRatings(false)}><Pressable style={s.backdrop} onPress={()=>setRatings(false)}><Pressable style={s.sheet} onPress={e=>e.stopPropagation()}><ScrollSurface contentContainerStyle={{gap:12}}><View style={s.row}><Label style={s.heading}>שחקנים ללא דירוג מנהל</Label><Pressable accessibilityRole="button" accessibilityLabel="סגור" hitSlop={10} onPress={()=>setRatings(false)}><Ionicons name="close" size={24} color={BLUE}/></Pressable></View><Label style={s.foot}>בחר שחקן כדי לקבוע את הדירוג הפנימי שלו במועדון.</Label>{attention.unrated.map(id=>{const user=users.get(id);return <Pressable key={id} disabled={!user} accessibilityRole="button" accessibilityLabel={`קבע דירוג ל־${user?.name??'שחקן ללא פרטים'}`} onPress={()=>{if(user){setRatings(false);onRate(user);}}} style={s.task}><UserAvatar user={user??{id,name:'שחקן ללא פרטים',createdAt:0}} size={38}/><View style={{flex:1,gap:4}}><Label style={s.name}>{user?.name??'שחקן ללא פרטים'}</Label><Label style={s.muted}>{user?'טרם נקבע דירוג':'פרטי השחקן לא נטענו; יש לרענן את הלוח'}</Label></View><Ionicons name="chevron-back" size={18} color={BLUE}/></Pressable>;})}</ScrollSurface></Pressable></Pressable></SafeModal>
  </>;
}
const s=StyleSheet.create({
  text:{fontSize:14,color:'#101B47',textAlign:RTL_LABEL_ALIGN},card:{backgroundColor:'#FFF',borderRadius:16,padding:14,gap:12,borderWidth:1,borderColor:'#E9EEF5',shadowColor:'#17395D',shadowOpacity:.06,shadowRadius:6,shadowOffset:{width:0,height:3},elevation:1},row:{flexDirection:'row',alignItems:'center',gap:8},heading:{flex:1,fontSize:17,fontWeight:'800'},muted:{fontSize:11,color:'#6C7893',lineHeight:18},foot:{fontSize:10,color:'#738099',lineHeight:16},name:{fontSize:13,fontWeight:'700'},metrics:{flexDirection:'row',gap:6},metric:{flex:1,alignItems:'center',justifyContent:'center',padding:9,gap:4,backgroundColor:'#F4F8FE',borderRadius:11},number:{fontSize:25,fontWeight:'800'},caption:{fontSize:10,textAlign:'center'},chartTitle:{fontSize:12,fontWeight:'700'},highlight:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:'#EDF5FF',borderRadius:10,padding:12},loading:{padding:15,gap:8,alignItems:'center'},retry:{flexDirection:'row',gap:6,alignItems:'center',minHeight:38,alignSelf:'flex-start'},link:{color:BLUE,fontSize:12,fontWeight:'700'},task:{flexDirection:'row',alignItems:'center',gap:9,paddingVertical:12,borderBottomWidth:1,borderColor:'#EBF0F7',minHeight:58},count:{minWidth:30,minHeight:34,padding:6,borderRadius:9,alignItems:'center',justifyContent:'center'},countText:{fontSize:19,fontWeight:'800'},backdrop:{flex:1,backgroundColor:'#0007',justifyContent:'flex-end'},sheet:{maxHeight:'88%',backgroundColor:'#FFF',borderTopLeftRadius:22,borderTopRightRadius:22,padding:20},
});
