import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { GrowthAction, GrowthAvatar, GrowthBadge, GrowthShell, GrowthStatus, growthColors as c, growthStyles as s, useGrowthData } from '../components/GrowthUI';
import { GrowthNotes } from '../components/GrowthNotes';
import { fetchGrowthJourney, fetchGrowthPerson } from '../services/growthData';
import { journeySessions, personInsight, text, millis } from '../services/growthInsights';
import { ONBOARDING_ACTIONS } from '../services/onboardingActivityCatalog';
import { observeSettledErrors } from '../services/errorObservation';
import type { FsDoc } from '../services/firestoreRest';
import { isolateText } from '../theme';

const when=(value:unknown)=>millis(value)?new Date(millis(value)).toLocaleString('he-IL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):'זמן לא תועד';
export function PersonJourneyScreen(){
 const nav=useNavigation<any>();const route=useRoute<any>();const uid=String(route.params.userId);const shared=useGrowthData();
 const [user,setUser]=useState<FsDoc|null>(null);const [events,setEvents]=useState<FsDoc[]>([]);const [busy,setBusy]=useState(true);const [errors,setErrors]=useState<string[]>([]);const [selected,setSelected]=useState<string|null>(null);const generation=useRef(0);
 const load=useCallback(async(force=false)=>{const request=++generation.current;setBusy(true);setErrors([]);
  const results=await Promise.allSettled([fetchGrowthPerson(uid,force),fetchGrowthJourney(uid,force)]).then(results=>observeSettledErrors(results,{source:'pulse/src/screens/PersonJourneyScreen.tsx',handler:'load',site:'PersonJourney:sources'}));
  if(request!==generation.current)return;
  const missing:string[]=[];
  if(results[0].status==='fulfilled')setUser(results[0].value as FsDoc|null);else missing.push('פרטי האדם');
  if(results[1].status==='fulfilled')setEvents(results[1].value as FsDoc[]);else missing.push('רצף הפעולות');
  setErrors(missing);setBusy(false);
 },[uid]);
 useEffect(()=>{setUser(null);setEvents([]);setSelected(null);void load();return()=>{generation.current++}},[load]);
 const sessions=useMemo(()=>journeySessions(events,uid),[events,uid]);const session=sessions.find(v=>v.id===selected)??sessions[0];
 const entry=events.filter(e=>e.action==='entry_source_resolved'&&e.params).sort((a,b)=>millis(b.occurredAt)-millis(a.occurredAt))[0];
 const attributedUser=user&&entry?{...user,entryAttribution:{entrySource:entry.params.entry_source,channel:entry.params.entry_channel,campaign:entry.params.entry_campaign}}:user;
 const insight=attributedUser&&shared.data?personInsight(attributedUser,shared.data,shared.data.at):null;
 const refresh=()=>{void load(true);void shared.reload()};
 return <GrowthShell loading={busy||shared.loading} onRefresh={refresh} onBack={()=>nav.goBack()} label="הסיפור שמאחורי ההצטרפות">
  {user?<><View style={[s.row,{paddingVertical:12}]}><GrowthAvatar name={text(user.name,'משתמש')}/><View style={{flex:1,gap:5}}><Text style={s.title}>{isolateText(text(user.name,'משתמש'))}</Text><Text style={s.small}>הצטרף {when(user.createdAt)}</Text></View></View>{insight?<><Text style={s.body}>{insight.summary}</Text><GrowthBadge warm={insight.pending.length>0}>{insight.stage}</GrowthBadge><Text style={s.small}>{isolateText(insight.source)}</Text></>:null}</>:!busy&&!errors.includes('פרטי האדם')?<Text style={s.error}>החשבון לא נמצא. אין מידע להציג עבור המזהה הזה.</Text>:null}
  <GrowthStatus data={shared.data} failed={shared.failed} retry={shared.reload}/>
  {errors.length?<Pressable accessibilityRole="button" onPress={()=>void load(true)} style={s.note}><Text style={s.error}>לא נטענו: {errors.join(' · ')}. לחצו לניסיון חוזר. מידע קודם עשוי להיות לא מעודכן.</Text></Pressable>:null}
  <View style={s.card}><Text style={s.heading}>מסלול הכניסה שנשמר</Text><Text style={s.small}>{sessions.length} רצפים מתועדים · {events.length} פעולות שנקראו</Text><Text style={s.small}>זהו תיעוד הכניסה וההצטרפות הקיים, ולא הקלטת מסך או רשימה מלאה של כל המסכים. רצף עשוי לכלול יותר מביקור אחד.</Text>
   {events.length>=2000?<Text style={s.error}>הקריאה מוגבלת ל־2,000 פעולות. ייתכן שהרצפים אינם שלמים.</Text>:null}
   {sessions.length>1?<View style={s.tabs}>{sessions.map((entry,index)=><Pressable key={entry.id} accessibilityRole="button" accessibilityState={{selected:entry.id===session?.id}} onPress={()=>setSelected(entry.id)} style={[s.tab,entry.id===session?.id&&s.selected]}><Text style={[s.small,entry.id===session?.id&&{color:c.onAccent}]}>רצף {index+1} · {when(entry.at)}</Text></Pressable>)}</View>:null}
   {session?.rows.map((event,index)=><View key={event.id} style={[s.row,{alignItems:'flex-start',paddingVertical:10}]}><View style={{alignItems:'center',alignSelf:'stretch',width:13}}><View style={{width:9,height:9,borderRadius:5,backgroundColor:c.accent,marginTop:6}}/>{index<session.rows.length-1?<View style={{flex:1,width:1,backgroundColor:c.line,marginTop:6}}/>:null}</View><View style={{flex:1,gap:4}}><Text style={s.body}>{ONBOARDING_ACTIONS[text(event.action)]??'פעולה שנרשמה'}</Text><Text style={s.small}>{when(event.occurredAt)}</Text>{['auth_failed','sign_in_failed','pending_action_failed','profile_save_failed','game_save_blocked','game_wizard_submit_failed'].includes(event.action)?<GrowthBadge warm>הפעולה לא הושלמה — נדרשת בדיקה</GrowthBadge>:null}</View></View>)}
   {!busy&&!events.length&&!errors.includes('רצף הפעולות')?<Text style={s.body}>לא נמצאו פעולות כניסה משויכות לחשבון. אין להסיק מכך שלא ביקר באפליקציה.</Text>:null}
   {session?<Pressable accessibilityRole="button" onPress={()=>nav.getParent()?.navigate('OnboardingActivity',{sessionId:session.id})} style={{paddingVertical:10}}><Text style={s.link}>פתיחת הרצף במסך האבחון ←</Text></Pressable>:null}
  </View>
  {insight?<View style={s.note}><Text style={[s.heading,s.accent]}>כיוון למעקב אישי</Text><Text style={s.body}>{insight.next}</Text></View>:null}
  <GrowthNotes key={uid} subject={`person:${uid}`}/>
  <GrowthAction label="כרטיס המשתמש ושיחת תמיכה" onPress={()=>nav.navigate('UserDetail',{userId:uid})}/>
 </GrowthShell>;
}
