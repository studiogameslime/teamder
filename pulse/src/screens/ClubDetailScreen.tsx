import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { GrowthBadge, GrowthFact, GrowthShell, GrowthStatus, growthColors as c, growthStyles as s, useGrowthData } from '../components/GrowthUI';
import { GrowthNotes } from '../components/GrowthNotes';
import { fetchGrowthClub } from '../services/growthData';
import { clubInsight, ids, millis, text } from '../services/growthInsights';
import { getDoc, type FsDoc } from '../services/firestoreRest';
import { observeCaughtError, observeSettledErrors } from '../services/errorObservation';
import { isolateText } from '../theme';

export function ClubDetailScreen(){
 const nav=useNavigation<any>();const route=useRoute<any>();const groupId=String(route.params.groupId);const shared=useGrowthData();
 const [group,setGroup]=useState<FsDoc|null>(null);const [busy,setBusy]=useState(true);const [failed,setFailed]=useState(false);const [names,setNames]=useState<Record<string,string>>({});const [namesFailed,setNamesFailed]=useState(false);const generation=useRef(0);
 const load=useCallback(async(force=false)=>{const request=++generation.current;setBusy(true);setFailed(false);try{const result=await fetchGrowthClub(groupId,force);if(request===generation.current)setGroup(result)}catch(error){observeCaughtError(error,{source:'pulse/src/screens/ClubDetailScreen.tsx',handler:'load',site:'ClubDetail:load'});if(request===generation.current)setFailed(true)}finally{if(request===generation.current)setBusy(false)}},[groupId]);
 useEffect(()=>{setGroup(null);setNames({});void load();return()=>{generation.current++}},[load]);
 const club=useMemo(()=>group&&shared.data?clubInsight(group,shared.data,shared.data.at):null,[group,shared.data]);
 const requested=useMemo(()=>club?[...new Set([...club.managers,...club.creators.slice(0,6).map(p=>p.id),...club.recruiters.slice(0,6).map(p=>p.id)])].filter(id=>!shared.data?.users?.rows.some(u=>u.id===id)).slice(0,20):[],[club,shared.data?.users]);
 const requestedKey=requested.join('|');
 useEffect(()=>{let alive=true;setNamesFailed(false);if(!requested.length)return;
  void Promise.allSettled(requested.map(id=>getDoc(`users/${id}`,['name']))).then(results=>observeSettledErrors(results,{source:'pulse/src/screens/ClubDetailScreen.tsx',handler:'names',site:'ClubDetail:names'})).then(results=>{if(!alive)return;const next:Record<string,string>={};let incomplete=false;results.forEach((result,index)=>{if(result.status==='fulfilled'&&result.value)next[requested[index]]=text(result.value.name,'שם לא תועד');else incomplete=true;});setNames(next);setNamesFailed(incomplete)});
  return()=>{alive=false};
 },[requestedKey,shared.data?.at]);
 const userName=(id:string)=>text(shared.data?.users?.rows.find(u=>u.id===id)?.name)||names[id]||'שם לא נטען';
 const person=(id:string)=>nav.getParent()?.navigate('Users',{screen:'UserDetail',params:{userId:id}});
 const refresh=()=>{void load(true);void shared.reload()};
 return <GrowthShell label="המועדון מבפנים" onBack={()=>nav.goBack()} loading={busy||shared.loading} onRefresh={refresh}>
  {group?<View style={s.hero}><Text style={s.title}>{isolateText(text(group.name,'מועדון ללא שם'))}</Text><Text style={s.body}>{text(group.city,'עיר לא תועדה')}{millis(group.createdAt)?` · נוצר ב־${new Date(millis(group.createdAt)).toLocaleDateString('he-IL')}`:''}</Text>{club?<GrowthBadge warm={!club.played.length}>{club.stage}</GrowthBadge>:null}</View>:!busy&&!failed?<Text style={s.error}>המועדון לא נמצא.</Text>:null}
  {failed?<Pressable accessibilityRole="button" onPress={()=>void load(true)}><Text style={s.error}>טעינת המועדון נכשלה. לחצו לניסיון חוזר.</Text></Pressable>:null}
  <GrowthStatus data={shared.data} failed={shared.failed} retry={shared.reload}/>
  {club&&group?<>
   <View style={s.card}><Text style={s.heading}>מי מקדם את המועדון</Text><Text style={s.small}>מנהלי המועדון</Text>{club.managers.map(id=><Pressable key={id} onPress={()=>person(id)} accessibilityRole="button" style={{paddingVertical:8,minHeight:44}}><Text style={s.link}>{isolateText(userName(id))} ←</Text></Pressable>)}{!club.managers.length?<Text style={s.body}>לא תועדו מנהלים ברשימה שנקראה.</Text>:null}
    <View style={s.rule}><GrowthFact label="חברים ומנהלים ייחודיים" value={club.members.length}/><GrowthFact label="בקשות שממתינות" value={ids(group.pendingPlayerIds).length}/><GrowthFact label="מחזורים שהתקיימו ב־30 יום" value={shared.data?.games?club.played.length:'לא נטען'}/><GrowthFact label="מחזורים קרובים" value={shared.data?.games?club.upcoming.length:'לא נטען'}/><GrowthFact label="מחזורים שממתינים לאימות קיום" value={shared.data?.games?club.unverified.length:'לא נטען'}/></View>
    <Text style={s.small}>מחזור הוא ערב משחקים שלם. מספר משחקים בתוך הערב אינו נוסף למונה המחזורים.</Text>
   </View>
   <View style={s.card}><Text style={s.heading}>מי פתח מחזורים</Text>{club.creators.map(p=><Pressable key={p.id} onPress={()=>person(p.id)} accessibilityRole="button" style={{paddingVertical:7,minHeight:44}}><GrowthFact label={userName(p.id)} value={`${p.count} מחזורים`}/></Pressable>)}{!club.creators.length?<Text style={s.body}>{shared.data?.games?'לא נמצא יוצר מחזור במידע שנטען.':'המחזורים לא נטענו; אין להסיק שאיש לא פתח מחזור.'}</Text>:null}<Text style={s.small}>השיוך הוא ליוצר הרשום של המחזור, בכל חלון המחזורים שנטען; אינו מוכיח שהערב התקיים.</Text></View>
   <View style={s.card}><Text style={s.heading}>מי הביא חברים למועדון</Text>{club.recruiters.map(p=><Pressable key={p.id} onPress={()=>person(p.id)} accessibilityRole="button" style={{paddingVertical:7,minHeight:44}}><GrowthFact label={userName(p.id)} value={`${p.count} הצטרפו דרכו`}/></Pressable>)}{!club.recruiters.length?<Text style={s.body}>{shared.data?.users?'לא נמצא שיוך הזמנה למועדון בחשבונות שנטענו. אין להסיק שאיש לא גייס.':'מקור המשתמשים לא נטען.'}</Text>:null}<Text style={s.small}>נספרים חברים נוכחיים עם שיוך שמור להזמנת המועדון, רק מתוך עד 100 החשבונות החדשים שנטענו. אין ספירה של הודעות או קישורים שנשלחו.</Text></View>
   {namesFailed?<Text style={s.error}>חלק משמות המנהלים או המארגנים לא נטענו. המספרים נשמרים לפי המזהים המקוריים.</Text>:null}
   <View style={s.card}><Text style={s.heading}>מה הוגדר למועדון</Text><GrowthFact label="נראות באפליקציה" value={group.hidden===true?'מוסתר':'רגיל'}/><GrowthFact label="הצטרפות למועדון" value={group.isOpen===true?'הצטרפות אוטומטית':'באישור מנהל'}/><GrowthFact label="מגבלת חברים שנשמרה" value={typeof group.maxMembers==='number'?group.maxMembers:'לא תועדה'}/><GrowthFact label="דירוג פנימי" value={typeof group.internalRating==='boolean'?group.internalRating?'פעיל':'כבוי':'לא תועד'}/>{group.internalRating===true?<GrowthFact label="הצגת דירוג פנימי" value={group.hideInternalRating===true?'מוסתר מהשחקנים':'גלוי לשחקנים'}/>:null}{text(group.description)?<><Text style={s.small}>תיאור המועדון</Text><Text style={s.body}>{text(group.description)}</Text></>:null}{text(group.rules)?<><Text style={s.small}>כללי המועדון</Text><Text style={s.body}>{text(group.rules)}</Text></>:null}<Text style={s.small}>מועד המשחק, מספר המשתתפים וכללי ההרשמה למחזור נקבעים בכל מחזור בנפרד.</Text></View>
   <View style={s.card}><Text style={s.heading}>מחזורים קרובים ואחרונים</Text>{[...club.upcoming,...club.games.filter(g=>!club.upcoming.some(p=>p.id===g.id))].slice(0,12).map(g=><Pressable key={g.id} onPress={()=>nav.getParent()?.navigate('Games',{screen:'GameDetail',params:{gameId:g.id}})} accessibilityRole="button" style={[s.rule,{paddingVertical:9,minHeight:48}]}><Text style={s.body}>{isolateText(text(g.title,'מחזור ללא שם'))}</Text><Text style={s.small}>{millis(g.startsAt)?new Date(millis(g.startsAt)).toLocaleString('he-IL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):'מועד לא תועד'} · פתיחה לפירוט ←</Text></Pressable>)}{!club.games.length?<Text style={s.body}>{shared.data?.games?'לא נמצאו מחזורים במידע שנטען.':'מידע המחזורים לא נטען.'}</Text>:null}</View>
   <View style={s.note}><Text style={[s.heading,s.accent]}>הצעד הבא</Text><Text style={s.body}>{club.next}</Text></View><GrowthNotes subject={`club:${groupId}`}/>
  </>:null}
 </GrowthShell>;
}
