import { observeCaughtError } from '../services/errorObservation';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { PlayerDisclosure as Disclosure } from './PlayerDisclosure';
import { Card, SectionHeader } from './ui';
import { RTL_LABEL_ALIGN, colors, font  } from '../theme';
import { fetchUserPushRecord } from '../services/deviceVersions';
import { fetchUserAuthRecord } from '../services/userAuth';
import { fetchPublicUserRecord, fetchPlayerStatsRecord, userRecord, fetchUserRecords, USER_RECORD_LIMIT, USER_SOURCES, type UserSource } from '../services/userDetails';
import type { UserActivity } from '../types';

const LABELS: Record<string,string> = {
 roundId:'מזהה משחק',roundNumber:'מספר משחק',scoreA:'שערי קבוצה א׳',scoreB:'שערי קבוצה ב׳',teamA:'שחקני קבוצה א׳',teamB:'שחקני קבוצה ב׳',teamAIndex:'צבע קבוצה א׳',teamBIndex:'צבע קבוצה ב׳',teamAPlayerIds:'שחקני קבוצה א׳',teamBPlayerIds:'שחקני קבוצה ב׳',winnerSide:'הצד המנצח',penalties:'בעיטות פנדל',scorerId:'מבקיע',assisterId:'מבשל',ownGoal:'שער עצמי',minute:'דקה',team:'קבוצה',at:'מועד',playerIds:'שחקנים',roundHistory:'היסטוריית משחקים',playerStats:'נתוני שחקנים במחזור',summary:'סיכום המחזור',retroGoals:'תיקוני שערים',liveGoals:'שערים חיים',eveningStats:'נתוני השחקן במחזור',cancellation:'מועד ביטול',adminRemoval:'הסרה בידי מנהל',removedBy:'המנהל שהסיר',draftTeams:'חלוקת כוחות',teams:'קבוצות',assignments:'שיבוצים',rotation:'רוטציה',timerRunning:'הטיימר פועל',timerAccumulatedMs:'זמן שנצבר באלפיות שנייה',startedAt:'מועד התחלה',endedAt:'מועד סיום',phase:'שלב',goalTally:'ספירת שערים',shootout:'סדרת פנדלים',rounds:'משחקים ששיחק',cleanSheets:'משחקים ללא ספיגה',revoked:'כרטיס שבוטל',expiresAt:'תוקף עד',issuedBy:'הונפק בידי',detail:'הערה',

 registration:'מצב הרשמה',managed:'יוצר המחזור',member:'חבר במועדון',manager:'מנהל במועדון',adminSince:'מנהל מאז',
 emailVerified:'כתובת מאומתת',disabled:'חשבון מושבת',phoneNumber:'מספר טלפון',sessionsValidSince:'חיבורים תקפים מאז',providers:'ספקי התחברות',providerId:'ספק',id:'מזהה',name:'שם',email:'דואר אלקטרוני',avatarId:'דמות',photoUrl:'תמונה קודמת',createdAt:'נוצר',updatedAt:'עודכן',lastSeenAt:'נראה לאחרונה באפליקציה',onboardingCompleted:'השלים הצטרפות',position:'עמדה',personalGroupId:'מועדון אישי',platform:'מערכת הפעלה',qa:'בודק',stats:'נתוני משחק',totalGames:'מחזורים שננעלו בהרשמה',attended:'הגיע',cancelled:'ביטל הרשמה',wins:'ניצחונות',goals:'שערים',assists:'בישולים',ownGoals:'שערים עצמיים',penTaken:'פנדלים שנבעטו',penScored:'פנדלים שהובקעו',penMissed:'פנדלים שהוחמצו',penFaced:'פנדלים כשוער',penSaved:'פנדלים שנעצרו',penConceded:'פנדלים שספג',availability:'זמינות',homeCity:'עיר מגורים',preferredCity:'עיר מועדפת קודמת',homeCityLat:'קו רוחב של העיר',homeCityLng:'קו אורך של העיר',preferredDays:'ימים מועדפים',preferredTimes:'שעות מועדפות',availabilitySlots:'זמינות לפי יום',availabilityRadiusKm:'רדיוס בקילומטרים',isAvailableForInvites:'זמין להזמנות',acceptsFillerPush:'מסכים להתראות השלמה',timeFrom:'משעה',timeTo:'עד שעה',friends:'חברים',notificationPrefs:'העדפות התראות',newGameSubscriptions:'מועדונים במעקב להתראות',socialPrivacy:'פרטיות',discoverable:'ניתן לאיתור',statistics:'חשיפת סטטיסטיקות',dmFriendsOnly:'העדפת הודעות קודמת',achievements:'הישגים',unlocked:'הישגים שנפתחו',events:'אירועים',invitedBy:'הוזמן בידי',invitedByType:'סוג הזמנה',invitedByTargetId:'יעד ההזמנה',invitedAt:'מועד ההזמנה',acquisition:'מקור הגעה',source:'מקור',campaign:'קמפיין',linkId:'קישור',gameId:'מחזור',groupId:'מועדון',lastBroadcastAt:'התראה יזומה אחרונה',registeredAt:'רישום מכשיר',appVersion:'גרסת אפליקציה',device:'מכשיר',devices:'מכשירים',provider:'ספק התחברות',lastLoginAt:'התחברות אחרונה',lastActiveAt:'רענון חיבור אחרון',status:'מצב',type:'סוג',title:'כותרת',body:'תוכן',message:'הודעה',recipientId:'נמען',screen:'מסך',action:'פעולה',sessionId:'ביקור',occurredAt:'מועד הפעולה',sequence:'סדר',fromUserId:'נשלח בידי',toUserId:'נמען',fieldName:'מגרש',joinedAt:'מועד הצטרפות',arrival:'מצב הגעה',visibility:'חשיפה',read:'נקרא',delivered:'נמסר',sentAt:'נשלח',pushStatus:'מצב התראה',reason:'סיבה',count:'כמות',tier:'דרגה',unlockedAt:'נפתח',gamesJoined:'הרשמות למחזור',teamsCreated:'מועדונים שנוצרו',teamsJoined:'הצטרפויות למועדונים',invitesSent:'הזמנות שנשלחו',friendsCount:'מספר חברים',playersCoached:'שחקנים שאומנו',a:'שחקן ראשון',b:'שחקן שני',played:'שיחקו יחד',won:'ניצחו יחד',isPersonal:'אישי',hidden:'מוסתר',fcmTokens:'אסימוני התראות',notificationPermissions:'הרשאת התראות',tokenCount:'רישומי התראות',
};
const VALUES: Record<string,string> = {red:'אדום',yellow:'צהוב',A:'קבוצה א׳',B:'קבוצה ב׳',tie:'תיקו',goal:'שער',save:'עצירה',miss:'החטאה',roundRunning:'משחק פעיל',registered:'רשום למחזור',waiting:'ברשימת המתנה',none:'אינו רשום',finished:'הסתיים',open:'פתוח',arrived:'הגיע',late:'הגיע באיחור',no_show:'לא הגיע',gk:'שוער',def:'הגנה',mid:'קישור',att:'התקפה',approved:'אושר',rejected:'נדחה',active:'פעיל',public:'ציבורי',private:'פרטי',morning:'בוקר',afternoon:'צהריים',evening:'ערב',night:'לילה',everyone:'כולם',friends:'חברים',onlyMe:'רק המשתמש',pending:'ממתין',accepted:'אושר',declined:'נדחה',new:'חדש',done:'טופל',reviewed:'בבדיקה',goalkeeper:'שוער',defender:'הגנה',midfielder:'קישור',forward:'התקפה'};
const txt = {  ...font.body, textAlign: RTL_LABEL_ALIGN };
const date = (value:number) => new Date(value).toLocaleString('he-IL');
function scalar(value: unknown, key: string) {
  if (value == null) return 'לא תועד';
  if (typeof value === 'boolean') return value ? 'כן' : 'לא';
  if (typeof value === 'number' && /At$|^(at|createdAt|updatedAt|sessionsValidSince)$/.test(key) && value > 0) return date(value);
  return VALUES[String(value)] ?? String(value);
}
export function RecordFields({ value }: {value: Record<string,unknown>}) {
  const [limit,setLimit] = useState(25);
  const entries=Object.entries(value).filter(([key,v])=>v!==undefined && !['discipline','yellowCards','redCards'].includes(key));
  if (!entries.length) return <Text style={txt}>לא תועד מידע בסעיף הזה</Text>;
  return <View style={{gap:10}}>{entries.slice(0,limit).map(([key,v]) => v && typeof v === 'object' ? <Disclosure key={key} title={`${LABELS[key] ?? key}${Array.isArray(v) ? ` · ${v.length}` : ''}`}><Card><RecordFields value={Array.isArray(v) ? Object.fromEntries(v.map((item,i)=>[String(i+1),item])) : v as Record<string,unknown>} /></Card></Disclosure> : <View key={key} style={{gap:3}}><Text style={{ ...font.small,textAlign: RTL_LABEL_ALIGN}}>{LABELS[key] ?? key}</Text><Text selectable style={txt}>{scalar(v,key)}</Text></View>)}{entries.length>limit?<Pressable accessibilityRole="button" onPress={()=>setLimit(n=>n+25)} style={{padding:14}}><Text style={{...txt,color:colors.primary}}>הצגת פרטים נוספים ({entries.length-limit})</Text></Pressable>:null}</View>;
}
const GROUPS: [string,string[]][] = [
 ['פרטי חשבון',['id','email','position','avatarId','photoUrl','createdAt','updatedAt','lastSeenAt','platform','onboardingCompleted','qa','personalGroupId']],
 ['זמינות והעדפות',['availability']], ['נתוני משחק והישגים',['stats','achievements']],
 ['פרטיות והתראות',['notificationPrefs','newGameSubscriptions','socialPrivacy','dmFriendsOnly']],
 ['מקור הגעה והזמנות',['invitedBy','invitedByType','invitedByTargetId','invitedAt','acquisition','lastBroadcastAt']],
];
export function UserProfileInformation({data,compact=false}:{data:UserActivity;compact?:boolean}) {
 const record=data.record ?? {};
 const known=new Set(['name','friends','discipline','yellowCards','redCards',...GROUPS.flatMap(([,keys])=>keys)]);
 const rest=Object.fromEntries(Object.entries(record).filter(([key])=>!known.has(key)));
 return <View style={{gap:12}}>
  {!compact?<Card><Text style={txt}>נראה לאחרונה: {typeof record.lastSeenAt==='number' ? date(record.lastSeenAt) : 'לא תועד'}</Text><Text style={{ ...font.small,textAlign: RTL_LABEL_ALIGN}}>הנתונים מוצגים כפי שנשמרו; מועד עדכון הפרופיל אינו מועד התחברות.</Text></Card>:null}
  {GROUPS.map(([title,keys])=><Disclosure key={title} title={title}><Card><RecordFields value={Object.fromEntries(keys.filter(key=>key in record).map(key=>[key,record[key]]))}/></Card></Disclosure>)}
  <Disclosure title="שדות נוספים ברשומת המשתמש"><Card><RecordFields value={rest}/></Card></Disclosure>
  <Disclosure title="רשומת סטטיסטיקות השחקן"><PublicInformation userId={data.user.id} source="stats"/></Disclosure>
  <Disclosure title="נתוני התחברות"><AuthInformation userId={data.user.id}/></Disclosure>
  <Disclosure title="הפרופיל הציבורי שמוצג לאחרים"><PublicInformation userId={data.user.id}/></Disclosure>
 </View>;
}
function AuthInformation({userId}:{userId:string}) {
 const [state,setState]=useState<{loading:boolean;record?:Record<string,unknown>;error?:boolean}>({loading:false});
 const load=async()=>{setState({loading:true});try {const u=await fetchUserAuthRecord(userId,!!state.error || !!state.record);setState({loading:false,record:u ?? {status:'לא נמצאה רשומת התחברות'}});}catch (caughtError9036e0c8c7){
    observeCaughtError(caughtError9036e0c8c7, {"source":"pulse/src/components/UserInformation.tsx","handler":"load","site":"UserInformation:9036e0c8c7"});setState({loading:false,error:true});}};
 return <Card><Text style={txt}>השלמת פרטי ההתחברות דורשת סנכרון של רשימת החשבונות. המידע עשוי להיות חסר בחשבון שנמחק.</Text><Pressable accessibilityRole="button" disabled={state.loading} onPress={load} style={{padding:14}}><Text style={{...txt,color:colors.primary}}>{state.loading?'טוען…':'השלמת נתוני התחברות'}</Text></Pressable>{state.error?<Text style={{...txt,color:colors.amber}}>טעינת ההתחברות נכשלה</Text>:state.record?<RecordFields value={state.record}/>:null}</Card>;
}
export function PublicInformation({userId,source='public'}:{userId:string;source?:'public'|'stats'|'push'}) {
 const [record,setRecord]=useState<Record<string,unknown>|null>();const [failed,setFailed]=useState(false);const [retry,setRetry]=useState(0);
 useEffect(()=>{let alive=true;setFailed(false);(source==='stats' ? fetchPlayerStatsRecord(userId,retry>0) : source==='push' ? fetchUserPushRecord(userId,retry>0).then(value=>userRecord(value) as Record<string,unknown>|null) : fetchPublicUserRecord(userId,retry>0)).then(r=>{if(alive)setRecord(r)}).catch((caughtError12b54aec3f: unknown) =>{
    observeCaughtError(caughtError12b54aec3f, {"source":"pulse/src/components/UserInformation.tsx","handler":"PublicInformation","site":"UserInformation:12b54aec3f"});if(alive)setFailed(true)});return()=>{alive=false}},[userId,retry,source]);
 return <Card>{record !== undefined && !failed ? <Pressable accessibilityRole="button" onPress={()=>{setRecord(undefined);setRetry(n=>n+1)}} style={{padding:12}}><Text style={{...txt,color:colors.primary}}>רענון סעיף</Text></Pressable> : null}{failed?<Pressable onPress={()=>setRetry(n=>n+1)}><Text style={txt}>הטעינה נכשלה. ניסיון חוזר</Text></Pressable>:record===undefined?<ActivityIndicator color={colors.primary}/>:record?<RecordFields value={record}/>:<Text style={txt}>לא נמצאה רשומה במקור הזה</Text>}</Card>;
}
export function UserRelatedRecords({userId,source,onOpen}:{userId:string;source:UserSource;onOpen?:(id:string)=>void}) {
 const [rows,setRows]=useState<Record<string,unknown>[]|null>(null);const [failed,setFailed]=useState(false);const [retry,setRetry]=useState(0);
 useEffect(()=>{let alive=true;setRows(null);setFailed(false);fetchUserRecords(userId,source,retry>0).then(r=>{if(alive)setRows(r)}).catch((caughtError9e165e4260: unknown) =>{
    observeCaughtError(caughtError9e165e4260, {"source":"pulse/src/components/UserInformation.tsx","handler":"UserRelatedRecords","site":"UserInformation:9e165e4260"});if(alive)setFailed(true)});return()=>{alive=false}},[userId,source,retry]);
 return <Card style={{gap:12}}>{rows !== null && !failed ? <Pressable accessibilityRole="button" onPress={()=>setRetry(n=>n+1)} style={{padding:12}}><Text style={{...txt,color:colors.primary}}>רענון סעיף</Text></Pressable> : null}{failed?<Pressable onPress={()=>setRetry(n=>n+1)}><Text style={{...txt,color:colors.amber}}>טעינת {USER_SOURCES[source].label} נכשלה. לחצו לניסיון חוזר.</Text></Pressable>:rows===null?<ActivityIndicator color={colors.primary}/>:<><Text style={font.small}>{rows.length} רשומות נטענו · חלון של עד {USER_RECORD_LIMIT}; אינו מבטיח את הרשומות האחרונות או היסטוריה מלאה</Text>{!rows.length?<Text style={txt}>לא נמצאו רשומות עבור המשתמש במקור הזה</Text>:rows.map(row=><Disclosure key={String(row.id)} title={String(row.title ?? row.type ?? row.action ?? row.id)}><RecordFields value={row}/>{onOpen?<Pressable onPress={()=>onOpen(String(row.sessionId ?? row.id))} style={{padding:12}}><Text style={{...txt,color:colors.primary}}>פתיחת הרצף המלא</Text></Pressable>:null}</Disclosure>)}</>}</Card>;
}
export function UserRelationships({data,onUser}:{data:UserActivity;onUser:(id:string)=>void}) {
 const friends=Array.isArray(data.record?.friends)?data.record!.friends.filter((id):id is string=>typeof id==='string'):[];
 return <View style={{gap:12}}>
  <Text style={font.small}>הרשימות מתייחסות לנתונים שנטענו. פירוט הרשמה ותפקיד נשמר עם הרשומה.</Text>
  <Disclosure title={`חברים · ${friends.length}`}><Card>{friends.length?friends.map(id=><Pressable key={id} accessibilityRole="button" onPress={()=>onUser(id)} style={{paddingVertical:14}}><Text style={{...txt,color:colors.primary}}>{id} · פתיחת משתמש</Text></Pressable>):<Text style={txt}>לא רשומים חברים ברשומת המשתמש</Text>}</Card></Disclosure>
  <Disclosure title="מועדונים שיצר ללא חברות נוכחית">{data.related?.groups.filter(g=>!g.detail.member && !g.detail.manager).map(g=><Card key={g.id}><Text style={font.title}>{g.title}</Text><RecordFields value={{id:g.id,...g.detail}}/></Card>)}</Disclosure>
  <Disclosure title={`משתמשים שהוזמנו · ${data.related?.referred.length ?? 0}`}><Card>{data.related?.referred.map(u=><Pressable key={u.id} onPress={()=>onUser(u.id)} style={{padding:12}}><Text style={{...txt,color:colors.primary}}>{u.name}</Text><Text style={font.small}>{date(u.joinedAt)}</Text></Pressable>)}</Card></Disclosure>
  {(['friendsSent','friendsReceived','joinRequests','pairsA','pairsB'] as const).map(source=><Disclosure key={source} title={USER_SOURCES[source].label}><UserRelatedRecords userId={data.user.id} source={source}/></Disclosure>)}
 </View>;
}
