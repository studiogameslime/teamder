import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { PlayerDisclosure as Disclosure } from './PlayerDisclosure';
import { Card, SectionHeader } from './ui';
import { RecordFields } from './UserInformation';
import { RTL_LABEL_ALIGN, colors, font  } from '../theme';
import { playerSummary } from '../services/playerSummary';
import type { UserActivity } from '../types';

type Round = NonNullable<UserActivity['related']>['games'][number];
const date=(at:number)=>new Date(at).toLocaleString('he-IL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
const status:Record<string,string>={registered:'רשום למחזור',waiting:'ברשימת המתנה',pending:'ממתין לאישור',none:'אינו רשום'};
const text={ ...font.body,textAlign: RTL_LABEL_ALIGN};
function RoundEntry({round}:{round:Round}) {
 const [open,setOpen]=useState(false);
 return <View style={{borderBottomWidth:1,borderBottomColor:colors.border}}><Pressable accessibilityRole="button" accessibilityLabel={`פרטי המחזור ${round.title}`} onPress={()=>setOpen(v=>!v)} style={{flexDirection:'row',direction:'rtl',alignItems:'center',gap:10,paddingVertical:14}}><Ionicons name="calendar-outline" size={20} color={round.detail.registration==='registered'?colors.primary:colors.textMuted}/><View style={{flex:1,gap:5}}><Text style={{ ...font.title,textAlign: RTL_LABEL_ALIGN}}>{round.detail.attended?'שיחק ב':round.detail.registration==='registered'?'רשום ל':''}{round.title}</Text><Text style={{ ...font.small,textAlign: RTL_LABEL_ALIGN}}>{round.at?date(round.at):'מועד לא תועד'}{round.detail.fieldName?` · ${round.detail.fieldName}`:''}</Text>{!round.detail.attended && round.detail.registration!=='registered'?<Text style={{ ...font.small,textAlign: RTL_LABEL_ALIGN}}>{status[String(round.detail.registration)] ?? 'מצב הרשמה לא תועד'}</Text>:null}</View><Ionicons name={open?'chevron-down':'chevron-back'} size={18} color={colors.textSoft}/></Pressable>{open?<RecordFields value={{id:round.id,...round.detail}}/>:null}</View>;
}
export function PlayerRounds({rows}:{rows:Round[]}) {
 const [limit,setLimit]=useState(15);
 return <View>{rows.length?rows.slice(0,limit).map(round=><RoundEntry key={round.id} round={round}/>):<Text style={{...text,paddingVertical:12}}>לא נמצאו מחזורים מתאימים במידע שנטען</Text>}{rows.length>limit?<Pressable onPress={()=>setLimit(n=>n+15)} style={{padding:12}}><Text style={text}>הצגת מחזורים נוספים</Text></Pressable>:null}</View>;
}
function ClubEntry({club,next,partial,last}:{club:NonNullable<UserActivity['related']>['groups'][number];next?:Round;partial:boolean;last:boolean}) {
 const [open,setOpen]=useState(false);
 return <View style={{borderBottomWidth:last?0:1,borderBottomColor:colors.border,paddingVertical:16,gap:8}}><Pressable accessibilityRole="button" accessibilityLabel={`פרטי ${club.title}`} accessibilityState={{expanded:open}} onPress={()=>setOpen(v=>!v)} style={{flexDirection:'row',direction:'rtl',gap:10,alignItems:'center'}}><View style={{flex:1,gap:7}}><View style={{flexDirection:'row',direction:'rtl',alignItems:'center',gap:8}}><Text style={{ ...font.title,textAlign: RTL_LABEL_ALIGN,flex:1}}>{club.title}</Text><Text style={{...font.small,color:club.detail.manager?colors.primary:colors.textSoft,borderWidth:1,borderColor:club.detail.manager?colors.primary:colors.textMuted,borderRadius:12,paddingHorizontal:10,paddingVertical:3}}>{club.role}</Text></View><Text style={{ ...font.small,textAlign: RTL_LABEL_ALIGN}}>{typeof club.detail.joinedAt==='number'?`חבר מאז ${new Date(club.detail.joinedAt).toLocaleDateString('he-IL',{month:'long',year:'numeric'})}`:'מועד הצטרפות לא תועד'}</Text></View><Ionicons name={open?'chevron-down':'chevron-back'} size={18} color={colors.textSoft}/></Pressable>{open?<RecordFields value={{id:club.id,status:club.status,...club.detail}}/>:null}</View>;
}
export function PlayerClubs({data,heading=true}:{data:UserActivity;heading?:boolean}) {
 const summary=playerSummary(data);
 return <View style={{gap:12}}>{heading?<SectionHeader>מועדונים ותפקידים</SectionHeader>:null}{summary.partial?<Text style={text}>הרשימה חלקית — חלק מהמקורות לא נטענו במלואם</Text>:null}<View>{summary.clubs.length?summary.clubs.map((club,index)=><ClubEntry key={club.id} club={club} next={summary.registered.find(r=>r.detail.groupId===club.id)} partial={summary.partial} last={index===summary.clubs.length-1}/>):<Text style={{...text,paddingVertical:16}}>{summary.partial?'לא ניתן לקבוע חברות במועדונים':'לא נמצאו מועדונים שבהם הוא חבר או מנהל'}</Text>}</View></View>;
}
export function PlayerOverview({data,onInfo,onClubs,onHistory,onReport}:{data:UserActivity;onClubs:()=>void;onInfo:()=>void;onHistory:()=>void;onReport:(id:string)=>void}) {
 const s=playerSummary(data);const next=s.registered[0];const reports=data.related?.reports.filter(r=>!['done','resolved'].includes(r.status)) ?? [];
 const activity=data.timeline.filter(e=>e.kind!=='card').slice(0,2);
 return <View style={{gap:12}}>
 <Pressable accessibilityRole="button" accessibilityLabel="פירוט ההרשמות העתידיות" onPress={onInfo} style={{flexDirection:'row',direction:'rtl',alignItems:'center',gap:10,paddingVertical:16,borderBottomWidth:1,borderBottomColor:colors.border}}><View style={{width:8,height:8,borderRadius:4,backgroundColor:next?colors.primary:colors.textMuted}}/><Text style={{...text,flex:1}}>{next?`רשום ל${next.title} · ${date(next.at)}`:s.partial?'מידע חלקי על הרשמות עתידיות':'לא נמצאה הרשמה עתידית'}</Text><Ionicons name="chevron-back" size={18} color={colors.textSoft}/></Pressable>

 <View style={{paddingVertical:16}}><View style={{flexDirection:'row',direction:'rtl'}}>{[[s.attended.length,'מחזורים ששיחק','football-outline'],[s.registered.length,'הרשמות עתידיות','calendar-outline'],[s.clubs.length,'מועדונים','people-outline']].map(([n,label,icon],index)=><Pressable key={label} accessibilityRole="button" accessibilityLabel={String(label)} onPress={label==='מועדונים'?onClubs:onInfo} style={{flex:1,alignItems:'center',gap:7,borderEndWidth:index<2?1:0,borderEndColor:colors.border}}><Text style={{...font.h1,color:colors.text}}>{s.partial?'—':n}</Text><Text style={{...font.small,fontSize:11,textAlign:'center'}}>{label}</Text><Ionicons name={icon as never} size={19} color={colors.textSoft}/></Pressable>)}</View></View>
 {s.partial?<Text style={{ ...font.small,color:colors.amber,textAlign: RTL_LABEL_ALIGN}}>הספירות חלקיות; הפירוט מציג רק את המידע שנמצא.</Text>:null}
 <SectionHeader>חברים והזמנות</SectionHeader>
 {[
  {value:data.referralCount,label:'חברים שצירף',icon:'person-add-outline',source:'מוזמנים'},
  {value:data.inviteClicks,label:'לחיצות על הקישור האישי',icon:'link-outline',source:'כניסות לקישור'},
 ].map(metric=><Pressable key={metric.label} accessibilityRole="button" onPress={onInfo} style={{flexDirection:'row',direction:'rtl',alignItems:'center',gap:12,paddingVertical:16,borderBottomWidth:1,borderBottomColor:colors.border}}><Ionicons name={metric.icon as never} size={22} color={colors.textSoft}/><Text style={{...text,flex:1}}>{metric.label}</Text><Text style={font.h2}>{data.failedSources?.includes(metric.source)?'—':`${metric.value}${data.limitedSources?.includes(metric.source)?'+':''}`}</Text></Pressable>)}
 <Text style={{ ...font.small,fontSize:11,textAlign: RTL_LABEL_ALIGN}}>חברים שנרשמו דרך הקישור האישי · הלחיצות אינן בהכרח אנשים שונים</Text>
 <SectionHeader>פעילות אחרונה</SectionHeader><View style={{gap:12}}>{activity.length?activity.map((e,index)=><View key={index} style={{flexDirection:'row',direction:'rtl',alignItems:'center',gap:10,paddingVertical:12,borderBottomWidth:1,borderBottomColor:colors.border}}><Ionicons name="time-outline" size={18} color={colors.textMuted}/><View style={{flex:1,gap:4}}><Text style={text}>{e.title}</Text><Text style={{ ...font.small,textAlign: RTL_LABEL_ALIGN}}>{date(e.at)}</Text></View></View>):<Text style={text}>לא נמצאה פעילות במידע שנטען</Text>}<Pressable onPress={onHistory}><Text style={{...text,color:colors.primary}}>לכל ההיסטוריה ‹</Text></Pressable></View>
 {reports.length?<Disclosure title={`דיווחים מתועדים (${reports.length})`}>{reports.map(r=><Pressable key={r.id} onPress={()=>onReport(r.id)} style={{paddingVertical:10}}><Text style={text}>{r.message || 'דיווח פתוח'}</Text></Pressable>)}</Disclosure>:null}
 <Text style={{ ...font.small,fontSize:11,textAlign: RTL_LABEL_ALIGN}}>הספירה לפי מחזורים שנטענו עם השתתפות מתועדת, ולא לפי מספר המשחקים בתוכם.</Text>
 </View>;
}
