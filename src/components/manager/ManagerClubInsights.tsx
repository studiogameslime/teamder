import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import { SafeModal } from '@/components/SafeModal';
import { ScrollSurface } from '@/components/ScrollSurface';
import { ManagerAttention, ManagerRoundNumbers } from './ManagerClubExtras';
import { RTL_LABEL_ALIGN } from '@/theme';
import { clubBalance, managerClubInsights, type ClubResults } from '@/utils/managerClubInsights';
import { loadManagerClubResults } from '@/services/managerClubResultsService';
import type { ManagerData } from '@/services/managerDashboardService';
import type { User } from '@/types';

const BLUE='#2467F5',GREEN='#13834A',AMBER='#A66709';
const date=(at:number)=>new Date(at).toLocaleDateString('he-IL',{day:'numeric',month:'numeric'});
function Label({children,style}:{children:React.ReactNode;style?:any}) { return <Text style={[s.text,style]}>{children}</Text>; }
function Card({title,icon,children}:{title:string;icon:keyof typeof Ionicons.glyphMap;children:React.ReactNode}) {
  return <View style={s.card}><View style={s.headingRow}><Label style={s.heading}>{title}</Label><Ionicons name={icon} size={21} color={BLUE}/></View>{children}</View>;
}
export function ManagerClubInsights({data,viewerId,now,onRound,onApprovals,onRate,onResolved}:{data:ManagerData;viewerId:string;now:number;onRound:(id:string)=>void;onApprovals:()=>void;onRate:(user:User)=>void;onResolved:()=>void}) {
  const insights=useMemo(()=>managerClubInsights(data.group,data.games,now),[data,now]);
  const [results,setResults]=useState<ClubResults>({}),[loading,setLoading]=useState(true),[error,setError]=useState(false),[retry,setRetry]=useState(0),[details,setDetails]=useState(false);
  useEffect(()=>{
    let alive=true;setResults({});setLoading(true);setError(false);setDetails(false);
    loadManagerClubResults(data.group,data.games,viewerId,now).then(r=>{if(alive)setResults(r);}).catch(()=>{if(alive)setError(true);}).finally(()=>{if(alive)setLoading(false);});
    return ()=>{alive=false;};
  },[data,viewerId,now,retry]);
  const balance=clubBalance(insights.recent,results);
  const user=(id:string)=>data.users.find(u=>u.id===id)??{id,name:'שחקן ללא פרטים',createdAt:0};
  const open=(id:string)=>{setDetails(false);onRound(id);};
  const resultLabel=(id:string)=>loading?'התוצאות נטענות…':error||results[id]?.unavailable?'התוצאות לא נטענו':`${clubBalance(insights.recent.filter(g=>g.id===id),results).total} משחקים עם תוצאה תקפה`;
  return <>
    <Label style={s.pageTitle}>תמונת מועדון</Label>
    <Label style={s.muted}>נתונים ותובנות מהמחזורים שהתקיימו</Label>
    <ManagerAttention data={data} now={now} onApprovals={onApprovals} onRate={onRate} onResolved={onResolved}/>
    {insights.recent.length>0?<>
      <Card title={insights.recent.length===10?'סיכום 10 המחזורים האחרונים':`סיכום ${insights.recent.length} המחזורים האחרונים`} icon="stats-chart-outline">
        <Label style={s.muted}>{date(insights.recent[insights.recent.length-1].startsAt)} — {date(insights.recent[0].startsAt)}</Label>
        <View style={s.metrics}>{[{n:insights.unique,label:'שחקנים שונים',color:BLUE},{n:insights.average!.toLocaleString('he-IL',{maximumFractionDigits:1}),label:'רשומים בממוצע',color:BLUE},{n:insights.full,label:'מחזורים מלאים',color:GREEN}].map(m=><View key={m.label} style={s.metric}><Label style={[s.number,{color:m.color}]}>{m.n}</Label><Label style={s.caption}>{m.label}</Label></View>)}</View>
        {insights.previousAverage!==null&&<View style={s.insight}><Label style={s.insightText}>{insights.average!>insights.previousAverage?'יותר נרשמים':insights.average!<insights.previousAverage?'פחות נרשמים':'ממוצע הרשמה ללא שינוי'}: {insights.average!.toLocaleString('he-IL',{maximumFractionDigits:1})} לעומת {insights.previousAverage.toLocaleString('he-IL',{maximumFractionDigits:1})} בעשרת המחזורים הקודמים</Label><Ionicons name={insights.average!>insights.previousAverage?'trending-up':insights.average!<insights.previousAverage?'trending-down':'remove-outline'} size={22} color={BLUE}/></View>}
        {insights.returned.length>0&&<View style={s.insight}><Label style={s.insightText}>{insights.returned.length===1?'שחקן אחד נרשם שוב אחרי הפסקה':`${insights.returned.length} שחקנים נרשמו שוב אחרי הפסקה`}</Label><Ionicons name="refresh-outline" size={21} color={GREEN}/></View>}
        <Label style={s.foot}>לפי רשימות ההרשמה שנשמרו; אין אישור נוכחות. הממוצע והתפוסה כוללים אורחים פעילים. שחקנים שונים אינם כוללים אורחים ללא חשבון.</Label>
        <Pressable accessibilityRole="button" onPress={()=>setDetails(true)} style={s.link}><Label style={s.linkText}>לנתונים המלאים</Label><Ionicons name="chevron-back" size={18} color={BLUE}/></Pressable>
      </Card>
      <ManagerRoundNumbers games={insights.recent} results={results} loading={loading} error={error} onRetry={()=>setRetry(v=>v+1)} onRound={onRound}/>
      <Card title="איכות חלוקת הכוחות" icon="football-outline">
        {loading?<View style={s.loading}><ActivityIndicator color={BLUE}/><Label style={s.muted}>טוען תוצאות משחקים…</Label></View>:error?<><Label style={s.muted}>לא ניתן לטעון כרגע את התוצאות</Label><Pressable accessibilityRole="button" onPress={()=>setRetry(v=>v+1)}><Label style={s.linkText}>נסה שוב</Label></Pressable></>:<>
          <Label style={s.muted}>{balance.total} משחקים עם תוצאה תקפה מתוך {balance.covered} מחזורים · נבדקו {insights.recent.length} מחזורים אחרונים</Label>
          {balance.total>0?<>
            {[{label:'תיקו',n:balance.draws,color:BLUE},{label:'הפרש שער אחד',n:balance.oneGoal,color:GREEN},{label:'הפרש שני שערים ומעלה',n:balance.wide,color:AMBER}].map(r=><View key={r.label} style={s.barRow}><Label style={s.barLabel}>{r.label}</Label><Label style={[s.barNumber,{color:r.color}]}>{r.n}</Label><View style={s.track}><View style={[s.fill,{backgroundColor:r.color,width:`${r.n/balance.total*100}%`}]}/></View><Label style={[s.percent,{color:r.color}]}>{Math.round(r.n/balance.total*100)}%</Label></View>)}
            <View style={[s.insight,{backgroundColor:'#E9F8EF'}]}><Label style={[s.insightText,{color:GREEN}]}>{balance.closePercent}% מהמשחקים הסתיימו בתיקו או בהפרש שער אחד</Label><Ionicons name="stats-chart" size={23} color={GREEN}/></View>
          </>:<Label style={s.muted}>אין תוצאות משחקים מתועדות שניתן לנתח במחזורים האלה.</Label>}
          {(balance.unavailable>0||balance.missing>0||balance.invalid>0)&&<Label style={s.warning}>{balance.unavailable>0?`${balance.unavailable} מחזורים לא נטענו במלואם. `:''}{balance.missing>0?`${balance.missing} מחזורים ללא תוצאות תקפות. `:''}{balance.invalid>0?`${balance.invalid} תוצאות לא תקפות הושמטו. `:''}האחוזים מחושבים רק מהתוצאות התקפות שנטענו.</Label>}
          {balance.unavailable>0&&<Pressable accessibilityRole="button" onPress={()=>setRetry(v=>v+1)}><Label style={s.linkText}>נסה לטעון שוב</Label></Pressable>}
          <Label style={s.foot}>התוצאה לבדה אינה קובעת את איכות החלוקה. תיקו נקבע לפי השערים לפני הכרעת פנדלים.</Label>
        </>}
      </Card>
    </>:<Card title="הסיכומים יופיעו אחרי המחזור הראשון" icon="calendar-outline"><Label style={s.muted}>טרם נמצאו מחזורים שהתקיימו במועדון.</Label></Card>}
    {insights.returned.length>0&&<Card title="חזרו לעניינים" icon="refresh-outline"><Label style={s.muted}>נרשמו שוב אחרי לפחות 3 מחזורים ללא הרשמה</Label>{insights.returned.map(r=><View key={r.userId} style={s.person}><UserAvatar user={user(r.userId)} size={40}/><View style={s.personText}><Label style={s.name}>{user(r.userId).name}</Label><Label style={s.muted}>אחרי {r.gap} מחזורים ללא הרשמה</Label><Label style={s.green}>{r.upcoming?'נרשם למחזור הקרוב':`חזר במחזור ${date(r.at)}`}</Label></View></View>)}<Label style={s.foot}>חזרה בשלושת המחזורים האחרונים או הרשמה למחזור הקרוב, עם הרשמה קודמת מתועדת.</Label></Card>}
    {insights.newcomers.length>0&&<Card title="השתלבות חברים חדשים" icon="person-add-outline"><Label style={s.muted}>הצטרפו למועדון ב־30 הימים האחרונים</Label><View style={s.metrics}><View style={s.metric}><Label style={s.number}>{insights.newcomers.length}</Label><Label style={s.caption}>הצטרפו</Label></View><View style={s.metric}><Label style={[s.number,{color:GREEN}]}>{insights.newcomerRegistered}</Label><Label style={s.caption}>נרשמו למחזור ראשון</Label></View></View>{insights.newcomers.map(n=><View key={n.userId} style={s.person}><UserAvatar user={user(n.userId)} size={40}/><View style={s.personText}><Label style={s.name}>{user(n.userId).name}</Label><Label style={s.muted}>הצטרף ב־{date(n.joinedAt)}</Label><Label style={n.completed||n.next?s.green:s.amber}>{n.completed?`${n.completed===1?'נרשם למחזור אחד שהתקיים':`נרשם ל־${n.completed} מחזורים שהתקיימו`}${n.next?' ולמחזור נוסף':''}`:n.next?'כבר נרשם למחזור':'טרם נרשם למחזור'}</Label></View></View>)}<Label style={s.foot}>מוצגים רק חברים עם מועד הצטרפות מתועד. הרשמה אינה אישור נוכחות.</Label></Card>}
    <SafeModal visible={details} transparent animationType="fade" onRequestClose={()=>setDetails(false)}><Pressable style={s.backdrop} onPress={()=>setDetails(false)}><Pressable style={s.sheet} onPress={e=>e.stopPropagation()}><ScrollSurface contentContainerStyle={{gap:12}}><View style={s.headingRow}><Label style={s.heading}>המחזורים שמרכיבים את הסיכום</Label><Pressable accessibilityRole="button" accessibilityLabel="סגור" hitSlop={10} onPress={()=>setDetails(false)}><Ionicons name="close" color={BLUE} size={24}/></Pressable></View><Label style={s.foot}>עד עשרת המחזורים האחרונים שהתקיימו, לפי רשימות ההרשמה שנשמרו. כל שורה מובילה לפרטי המחזור.</Label>{insights.rounds.map(r=><Pressable key={r.game.id} accessibilityRole="button" accessibilityLabel={`פרטי מחזור ${date(r.game.startsAt)}`} onPress={()=>open(r.game.id)} style={s.detail}><View style={{flex:1,gap:4}}><Label style={s.name}>מחזור {date(r.game.startsAt)}</Label><Label style={s.muted}>{r.registered} רשומים · {r.accounts} עם חשבון · {r.guests} אורחים</Label><Label style={s.muted}>{r.game.maxPlayers>0?`קיבולת ${r.game.maxPlayers}${r.registered>=r.game.maxPlayers?' · מלא':''}`:'קיבולת לא מתועדת'} · {resultLabel(r.game.id)}</Label></View><Ionicons name="chevron-back" size={20} color={BLUE}/></Pressable>)}</ScrollSurface></Pressable></Pressable></SafeModal>
  </>;
}
const s=StyleSheet.create({
  text:{color:'#101B47',fontSize:14,textAlign:RTL_LABEL_ALIGN},pageTitle:{fontSize:20,fontWeight:'800'},muted:{fontSize:11,color:'#6C7893',lineHeight:18},card:{backgroundColor:'#FFF',borderRadius:16,padding:14,gap:12,borderWidth:1,borderColor:'#E9EEF5',shadowColor:'#17395D',shadowOpacity:.06,shadowRadius:6,shadowOffset:{width:0,height:3},elevation:1},headingRow:{flexDirection:'row',alignItems:'center',gap:8},heading:{flex:1,fontSize:17,fontWeight:'800'},metrics:{flexDirection:'row',gap:6},metric:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:'#F4F8FE',borderRadius:11,paddingVertical:12,paddingHorizontal:3,gap:4},number:{fontSize:26,fontWeight:'800',color:BLUE},caption:{fontSize:10,textAlign:'center'},insight:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:'#F0F5FC',borderRadius:10,padding:11},insightText:{flex:1,fontSize:12,lineHeight:19},foot:{fontSize:10,color:'#738099',lineHeight:16},link:{flexDirection:'row',alignItems:'center',gap:5,alignSelf:'flex-start',minHeight:38},linkText:{color:BLUE,fontSize:13,fontWeight:'700'},loading:{padding:15,gap:8,alignItems:'center'},barRow:{flexDirection:'row',alignItems:'center',gap:7},barLabel:{width:100,fontSize:11},barNumber:{width:23,fontSize:13,fontWeight:'700',textAlign:'center'},track:{flex:1,height:12,backgroundColor:'#EAF0F7',borderRadius:5,overflow:'hidden',alignItems:'flex-start'},fill:{height:12,borderRadius:5},percent:{width:36,fontSize:11,textAlign:'center',fontWeight:'700'},warning:{fontSize:10,color:AMBER,lineHeight:17,backgroundColor:'#FFF6E8',padding:10,borderRadius:8},person:{flexDirection:'row',alignItems:'center',gap:9,paddingVertical:10,borderBottomWidth:1,borderColor:'#EEF2F7'},personText:{flex:1,gap:3},name:{fontSize:14,fontWeight:'700'},green:{fontSize:11,fontWeight:'600',color:GREEN},amber:{fontSize:11,fontWeight:'600',color:AMBER},backdrop:{flex:1,backgroundColor:'#0007',justifyContent:'flex-end'},sheet:{maxHeight:'88%',backgroundColor:'#FFF',borderTopLeftRadius:22,borderTopRightRadius:22,padding:20},detail:{flexDirection:'row',gap:8,alignItems:'center',paddingVertical:12,borderBottomWidth:1,borderColor:'#E8EEF5'},
});
