import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ImageBackground, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { ScrollSurface } from '@/components/ScrollSurface';
import { ManagerClubInsights } from '@/components/manager/ManagerClubInsights';
import { UserAvatar } from '@/components/UserAvatar';
import { AdminRatingSheet } from '@/components/AdminRatingSheet';
import { SafeModal } from '@/components/SafeModal';
import { appAlert } from '@/components/AppDialog';
import { toast } from '@/components/Toast';
import { RTL_LABEL_ALIGN } from '@/theme';
import { useUserStore } from '@/store/userStore';
import { groupService } from '@/services/groupService';
import { loadManagerDashboard, managerLoadErrorMessage, watchManagerAccess, type ManagerData } from '@/services/managerDashboardService';
import { logError } from '@/services/errorLog';
import { equipmentCounts, managerOverview, ratingAdvice, ratingSeries, registrationState, type RatingSeries, type ScorePoint } from '@/utils/managerDashboard';
import { inSeason } from '@/utils/seasonScope';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { canJoinGame } from '@/services/gameLifecycle';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';
import type { User } from '@/types';

const BLUE='#2467F5', NAVY='#101B47', GREEN='#13834A', AMBER='#A66709';
type Tab='overview'|'club'|'ratings'|'equipment';
type Period=30|90|'season';
const date=(at:number)=>new Date(at).toLocaleDateString('he-IL',{day:'numeric',month:'numeric'});
function Label({children,style}:{children:React.ReactNode;style?:any}) {return <Text style={[s.text,style]}>{children}</Text>;}
function Action({title,icon,onPress,disabled=false}:{title:string;icon:keyof typeof Ionicons.glyphMap;onPress:()=>void;disabled?:boolean}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} accessibilityState={{disabled}} onPress={onPress} style={[s.action,disabled&&{opacity:0.45}]}><Label style={s.actionText}>{title}</Label><Ionicons name={icon} color={BLUE} size={17}/></Pressable>;
}
function Box({title,icon,children}:{title?:string;icon?:keyof typeof Ionicons.glyphMap;children:React.ReactNode}) {
 return <View style={s.box}>{title&&<View style={s.sectionHeading}><Label style={s.heading}>{title}</Label>{icon&&<Ionicons name={icon} color={BLUE} size={20}/>}</View>}{children}</View>;
}
/** Physical SVG coordinates: oldest right, newest left, matching Hebrew reading order. */
export function ManagerTrend({points,direction}:{points:ScorePoint[];direction:'up'|'down'|'neutral'}) {
 const color=direction==='up'?GREEN:direction==='down'?AMBER:BLUE;
 const low=Math.max(0,Math.floor(Math.min(...points.map(p=>p.score))-0.5));
 const high=Math.min(10,Math.ceil(Math.max(...points.map(p=>p.score))+0.5));
 const y=(score:number)=>65-(score-low)/Math.max(1,high-low)*42;
 const coords=points.map((p,i)=>({x:points.length===1?150:278-i*256/(points.length-1),y:y(p.score)}));
 const line=coords.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join(' ');
 return <View accessible accessibilityLabel={`ציוני המחזורים מהישן לחדש: ${points.map(p=>p.score.toFixed(1)).join(', ')}`}>
 <Svg width="100%" height={82} viewBox="0 0 300 82">
 {[low,(low+high)/2,high].map(v=><Line key={v} x1="12" x2="290" y1={y(v)} y2={y(v)} stroke="#E6EDF5"/>)}
 <Path d={`${line} L${coords[coords.length-1].x},65 L${coords[0].x},65 Z`} fill={color} opacity={0.07}/>
 <Path d={line} stroke={color} strokeWidth={2.5} fill="none"/>
 {coords.map((p,i)=><React.Fragment key={points[i].gameId}><Circle cx={p.x} cy={p.y} r="3.5" fill={color}/><SvgText x={p.x} y={p.y-9} fontSize="13" fontWeight="700" fill={NAVY} textAnchor="middle">{points[i].score.toFixed(1)}</SvgText><SvgText x={p.x} y="80" fontSize="13" fill="#72809B" textAnchor="middle">{date(points[i].at)}</SvgText></React.Fragment>)}
 </Svg><Label style={{fontSize:13,color:'#7B87A0',textAlign:'center'}}>טווח הגרף: {low}–{high} · ציון מתוך 10</Label></View>;
}
export function ManagerDashboardScreen() {
 const nav=useNavigation<any>();
 const route=useRoute<RouteProp<CommunitiesStackParamList,'ManagerDashboard'>>();
 const groupId=route.params.groupId;
 const me=useUserStore(st=>st.currentUser);
 const [snapshot,setSnapshot]=useState<{owner:string;data:ManagerData}|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const [tab,setTab]=useState<Tab>(route.params.initialTab??'overview');
 const [period,setPeriod]=useState<Period>(90),[filter,setFilter]=useState<'all'|'up'|'down'>(route.params.initialFilter??'all');
 const [ratingTarget,setRatingTarget]=useState<User|null>(null),[saving,setSaving]=useState(false);
 const [details,setDetails]=useState<RatingSeries|null>(null);
 const [allEquipment,setAllEquipment]=useState(false);
 const [playerSearch,setPlayerSearch]=useState('');
 useEffect(()=>setPlayerSearch(''),[groupId,me?.id]);
 const [now,setNow]=useState(Date.now());
 const data=snapshot?.owner===me?.id && snapshot?.data.group.id===groupId?snapshot.data:null;
 useFocusEffect(useCallback(()=>{
   let active=true;setLoading(true);setError('');setSnapshot(null);setNow(Date.now());setRatingTarget(null);setDetails(null);
   if(!me) {setLoading(false);setError('לוח המנהל זמין למנהלי המועדון בלבד');return;}
   const stopAccess=watchManagerAccess(groupId,me.id,allowed=>{if(!allowed){active=false;setSnapshot(null);setLoading(false);setError('לוח המנהל זמין למנהלי המועדון בלבד');setRatingTarget(null);setDetails(null);}});
   loadManagerDashboard(groupId,me.id).then(value=>{if(active)setSnapshot({owner:me.id,data:value});}).catch(err=>{if(active){logError('loadManagerDashboard',err,{groupId});setError(managerLoadErrorMessage(err));}}).finally(()=>{if(active)setLoading(false);});
   return ()=>{active=false;stopAccess();};
 },[groupId,me?.id,refresh]));
 useEffect(()=>{setTab(route.params.initialTab??'overview');setFilter(route.params.initialFilter??'all');},[groupId,route.params.initialTab,route.params.initialFilter]);
 const since=period==='season'?(data?.group.seasons?.startedAt??now):now-period*86400000;
 const scoped=useMemo(()=>data?.games.filter(g=>g.startsAt<now&&(period==='season'?inSeason(g,data.group.seasons):g.startsAt>=since))??[],[data,since,now,period]);
 const overview=useMemo(()=>data?managerOverview(data.group,data.games,now):null,[data,now]);
 const cancellations=useMemo(()=>data?managerOverview(data.group,scoped,now):null,[data,scoped,now]);
 const advice=useMemo(()=>data&&!data.scoresIncomplete?ratingAdvice(data.group,scoped,data.scores):[],[data,scoped]);
 const series=useMemo(()=>data?ratingSeries(data.group,scoped,data.scores):[],[data,scoped]);
 const recommendations=new Map(advice.map(a=>[a.userId,a]));
 const equipment=useMemo(()=>data?equipmentCounts(data.group,data.events,since,now):[],[data,since,now]);
 const users=useMemo(()=>Object.fromEntries(data?.users.map(u=>[u.id,u])??[]),[data]);
 const user=(id:string)=>users[id]??{id,name:'שחקן ללא פרטים',createdAt:0};
 const search=playerSearch.trim().toLocaleLowerCase();
 const visibleSeries=series.filter(a=>(filter==='all'||recommendations.get(a.userId)?.direction===filter)&&user(a.userId).name.toLocaleLowerCase().includes(search)).sort((a,b)=>Number(recommendations.has(b.userId))-Number(recommendations.has(a.userId))||a.userId.localeCompare(b.userId));
 const saveRating=async(value:number|null)=>{
   if(!data||!me||!ratingTarget||saving)return;
   setSaving(true);
   try {await groupService.setAdminRating(groupId,me.id,ratingTarget.id,value);logEvent(value===null?AnalyticsEvent.RatingCleared:AnalyticsEvent.PlayerRated,{groupId,rating:value,wasRated:true});setRatingTarget(null);setRefresh(v=>v+1);toast.success('הדירוג עודכן');}
   catch {toast.error('לא ניתן לעדכן את הדירוג');}finally{setSaving(false);}
 };
 const periodPicker=<View style={s.period}>{([30,90,...(data?.group.seasons?.enabled?['season']:[])] as Period[]).map(p=><Pressable key={p} accessibilityRole="button" accessibilityState={{selected:period===p}} onPress={()=>setPeriod(p)} style={[s.periodItem,period===p&&s.periodActive]}><Label style={[s.periodLabel,period===p&&{color:'#FFF'}]}>{p===30?'חודש':p===90?'3 חודשים':'עונה'}</Label></Pressable>)}</View>;
 const person=(id:string,subtitle:string)=><View key={id} style={s.person}>
   <UserAvatar user={user(id)} size={38}/><View style={{flex:1,gap:4}}><Label style={s.name}>{user(id).name}</Label><Label style={s.muted}>{subtitle}</Label></View>
 </View>;
 const up=advice.filter(a=>a.direction==='up').length,down=advice.length-up;
 return <SafeAreaView edges={['top']} style={s.root}>
 <ImageBackground source={require('../../assets/images/groupImages/daylight-pitch.jpg')} resizeMethod="resize" style={s.hero}>
 <LinearGradient colors={['#15428BB0','#164D9999']} style={StyleSheet.absoluteFill}/>
 <View style={s.heroLine}><Pressable accessibilityRole="button" accessibilityLabel="חזרה" onPress={()=>nav.goBack()} style={s.back}><Ionicons name="chevron-forward" size={25} color="white"/></Pressable><Label style={s.heroTitle}>לוח מנהל</Label></View>
 <Label style={s.heroSubtitle}>{data?.group.name??'ניהול המועדון'}</Label>
 </ImageBackground>
 {data&&<View style={s.tabs}>{([{key:'overview',label:'סקירה'},{key:'club',label:'תמונת מועדון'},{key:'ratings',label:'דירוגים'},{key:'equipment',label:'ציוד'}] as const).map(t=><Pressable key={t.key} accessibilityRole="tab" accessibilityState={{selected:tab===t.key}} onPress={()=>{setTab(t.key);setDetails(null);}} style={[s.tab,tab===t.key&&s.tabActive]}><Label style={[s.tabLabel,tab===t.key&&{color:BLUE}]}>{t.label}</Label></Pressable>)}</View>}
 {loading?<View style={s.center}><ActivityIndicator color={BLUE}/><Label style={s.muted}>טוען את נתוני המועדון…</Label></View>:!data?<View style={s.center}><Label>{error}</Label><Action title="נסה שוב" icon="refresh" onPress={()=>setRefresh(v=>v+1)}/></View>:
 <ScrollSurface keyboardShouldPersistTaps="handled" key={tab} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={()=>setRefresh(v=>v+1)}/>}>
 {data.truncated&&<Label style={s.notice}>מוצגים עד 200 מחזורים ו־1,000 רישומי ציוד אחרונים. ייתכן שהתקופה אינה מלאה.</Label>}
 {tab==='club'&&me&&<ManagerClubInsights data={data} viewerId={me.id} now={now} onRound={id=>nav.navigate('MatchDetails',{gameId:id})} onApprovals={()=>nav.navigate('AdminApproval')} onRate={setRatingTarget} onResolved={()=>setRefresh(v=>v+1)}/>}
 {tab==='overview'&&overview&&<>
 <Box title="המחזור הקרוב" icon="calendar-outline">
 {overview.upcoming?<><Pressable accessibilityRole="button" onPress={()=>nav.navigate('MatchDetails',{gameId:overview.upcoming!.id})}><Label style={s.muted}>{date(overview.upcoming.startsAt)} · {new Date(overview.upcoming.startsAt).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}</Label><Label style={s.big}>{overview.total} מתוך {overview.upcoming.maxPlayers} רשומים</Label></Pressable>
 <View style={s.progress}><View style={[s.fill,{width:`${Math.min(100,overview.total/Math.max(1,overview.upcoming.maxPlayers)*100)}%`}]}/></View>
 <View style={s.metrics}>{([{n:overview.regularCount,label:'קבועים',color:BLUE},{n:overview.guests+overview.externalCount,label:'אורחים וחיצוניים',color:'#8052C8'}]).map(({n,label,color})=><View key={label} style={s.metric}><Label style={[s.metricN,{color}]}>{n}</Label><Label style={s.metricL}>{label}</Label></View>)}</View>
 <Label style={s.foot}>{overview.clubCount} חברי מועדון רשומים · {overview.upcoming.waitlist.length} ברשימת המתנה</Label>
 {(overview.upcoming.pending?.length??0)>0&&<Label style={s.foot}>{overview.upcoming.pending!.length} ממתינים לאישור מנהל</Label>}
 {!canJoinGame(overview.upcoming)&&<Label style={s.foot}>ההרשמה סגורה כרגע</Label>}
 {overview.upcoming.registrationOpensAt&&overview.upcoming.registrationOpensAt>now?<Label style={s.foot}>ההרשמה תיפתח ב־{date(overview.upcoming.registrationOpensAt)}</Label>:null}
 </>:<Label style={s.muted}>אין מחזור עתידי מתוכנן</Label>}
 </Box>
 {overview.upcoming&&<Box title="הקבועים שעדיין חסרים" icon="people-outline">
 {overview.missing.length?overview.missing.map(m=>{const state=registrationState(overview.upcoming!,m.userId);const status={none:'טרם נרשם',waitlist:'ברשימת המתנה',pending:'ממתין לאישור',cancelled:'ביטל הרשמה',rejected:'בקשתו נדחתה',registered:'רשום'}[state];return person(m.userId,`נרשם ל־${m.count} מתוך ${m.sample} המחזורים האחרונים · ${status}`);}):<Label style={s.muted}>כל השחקנים הקבועים רשומים למחזור הקרוב</Label>}
 <Label style={s.foot}>קבוע: נרשם לפחות ל־7 מתוך 10 המחזורים האחרונים. הנתונים מתייחסים להרשמה.</Label>
 </Box>}
 <Box title="לא נרשמו לאחרונה" icon="time-outline">{overview.absent.length?overview.absent.map(m=>person(m.userId,`${m.wasRegular?'קבוע בדרך כלל · ':''}לא נרשם ל־${m.missed} מחזורים ברצף`)):<Label style={s.muted}>אין היעדרויות מהרשמה לפי הסף שנקבע</Label>}</Box>
 <Box title="ביטולי הרשמה" icon="close-circle-outline">{periodPicker}<View style={s.cancellationTotal}><Label style={s.cancellationN}>{cancellations?.cancellationCount??0}</Label><Label style={s.muted}>ביטולים מתועדים בתקופה</Label></View>{cancellations?.members.filter(m=>m.cancellations).sort((a,b)=>b.cancellations-a.cancellations).map(m=>person(m.userId,`${m.cancellations} ביטולים`))}<Label style={s.foot}>ביטול שבוטל בהרשמה מחדש אינו נשמר בהיסטוריה הקיימת. הסרה בידי מנהל אינה ביטול של שחקן.</Label></Box>
 </>}
 {tab==='ratings'&&<>
 <Label style={s.pageHeading}>ציונים ומגמות</Label>{periodPicker}
 <Label style={s.subtitle}>ציוני המחזורים האחרונים והמלצות לדירוג המנהל</Label>
 <View style={{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:'#FFF',borderWidth:1,borderColor:'#DCE5F2',borderRadius:12,paddingHorizontal:12}}>
 <TextInput value={playerSearch} onChangeText={setPlayerSearch} placeholder="חיפוש שחקן לפי שם" accessibilityLabel="חיפוש שחקן לפי שם" placeholderTextColor="#77849B" autoCorrect={false} style={{flex:1,minHeight:42,color:NAVY,fontSize:14,textAlign:'right',writingDirection:'rtl'}}/>
 {playerSearch?<Pressable accessibilityRole="button" accessibilityLabel="נקה חיפוש" onPress={()=>setPlayerSearch('')} hitSlop={10}><Ionicons name="close-circle" size={20} color="#77849B"/></Pressable>:<Ionicons name="search-outline" size={20} color="#77849B"/>}
 </View>
 <View style={s.filters}>{([{key:'all',label:`הכול (${series.length})`},{key:'up',label:`העלאה (${up})`},{key:'down',label:`הורדה (${down})`}] as const).map(f=><Pressable key={f.key} accessibilityRole="button" accessibilityState={{selected:filter===f.key}} onPress={()=>setFilter(f.key)} style={[s.filter,filter===f.key&&{backgroundColor:f.key==='down'?'#FFF0D6':BLUE}]}><Label style={[s.filterText,filter===f.key&&{color:f.key==='down'?AMBER:'#FFF'}]}>{f.label}</Label>{f.key!=='all'&&<Ionicons name={f.key==='up'?'arrow-up':'arrow-down'} size={13} color={filter===f.key?(f.key==='down'?AMBER:'#FFF'):NAVY}/>}</Pressable>)}</View>
 {data.scoresIncomplete&&<Box><Label>חלק מהציונים לא נטענו. הציונים שנטענו מוצגים; המלצות יתחדשו לאחר טעינה מלאה.</Label><Action title="נסה שוב" icon="refresh" onPress={()=>setRefresh(v=>v+1)}/></Box>}
 {!data.group.internalRating&&<Label style={s.foot}>ציוני המחזור מוצגים גם ללא דירוג מנהל. להפעלת המלצות יש להפעיל דירוג מנהל בהגדרות המועדון.</Label>}
 {!visibleSeries.length&&<Box><Label>{search?'לא נמצאו שחקנים שתואמים לחיפוש ולסינון שנבחר.':filter==='all'?'אין ציוני מחזור שמורים בתקופה שנבחרה.':'אין המלצות בסינון שנבחר. אפשר לראות את הציונים בלחיצה על הכול.'}</Label></Box>}
 {visibleSeries.map(a=>{const recommendation=recommendations.get(a.userId),direction=recommendation?.direction??'neutral',rising=direction==='up',color=rising?GREEN:direction==='down'?AMBER:BLUE,bg=rising?'#E9F8EF':direction==='down'?'#FFF3DF':'#EDF3FF',last=a.points[a.points.length-1];return <View key={a.userId} style={s.ratingCard}>
 <View style={s.ratingTop}><UserAvatar user={user(a.userId)} size={42}/><View style={{flex:1}}><Label style={s.ratingName}>{user(a.userId).name}</Label><Label style={s.muted}>דירוג מנהל {a.rating===null?'טרם נקבע':`⁦${a.rating.toFixed(1)}/5⁩`}</Label></View><View style={[s.badge,{backgroundColor:bg}]}><Label style={{fontSize:13,color,fontWeight:'700'}}>{recommendation?`לבחון ${rising?'העלאה':'הורדה'}`:'נתוני ביצוע'}</Label><Ionicons name={recommendation?(rising?'arrow-up':'arrow-down'):'stats-chart-outline'} size={16} color={color}/></View></View>
 <Label style={s.chartTitle}>ציונים מ־{a.points.length} מחזורים אחרונים</Label><ManagerTrend points={a.points} direction={direction}/>
 <View style={[s.lastScore,{backgroundColor:bg}]}><View style={s.scoreNumber}><Label style={s.scoreCaption}>ציון אחרון</Label><Label style={s.lastNumber}>{`⁦${last.score.toFixed(1)}/10⁩`}</Label></View><View style={{flex:1}}><Label style={s.reason}>{recommendation?`מגמת ${rising?'עלייה':'ירידה'} לאורך 5 מחזורים`:a.points.length<5?'מוצגים כל הציונים הקיימים; המלצה נבחנת מחמישה ציונים.':'הציונים זמינים לצפייה, ללא המלצה לשינוי דירוג.'}</Label></View></View>
 <View style={s.cardActions}><Action title="הצג נתונים" icon="stats-chart-outline" onPress={()=>setDetails(a)}/>{data.group.internalRating&&<Pressable accessibilityRole="button" onPress={()=>{logEvent(AnalyticsEvent.RatingSheetOpened,{groupId,hasRating:a.rating!==null});setRatingTarget(user(a.userId));}} style={s.edit}><Label style={s.editText}>ערוך דירוג</Label><Ionicons name="chevron-back" size={19} color={BLUE}/></Pressable>}</View>
 </View>;})}
 <Label style={s.foot}>ציוני המחזור מתוך 10 ודירוג המנהל מתוך 5. המלצה אינה משנה דירוג אוטומטית.</Label>
 </>}
 {tab==='equipment'&&<><Label style={s.pageHeading}>כדור וגופיות</Label>{periodPicker}{data.equipmentUnavailable?<Box><Label>רישומי הציוד לא נטענו. לא ניתן להציג ספירה.</Label><Action title="נסה שוב" icon="refresh" onPress={()=>setRefresh(v=>v+1)}/></Box>:<>
 <View style={s.equipmentTiles}>{(['ball','jerseys'] as const).map((kind,i)=><View key={kind} style={[s.equipmentTile,{backgroundColor:i?'#ECFAF1':'#EAF2FF'}]}><View style={{flex:1}}><Label style={s.name}>{i?'גופיות':'כדור'}</Label><Label style={[s.metricN,{color:i?GREEN:BLUE}]}>{equipment.reduce((n,e)=>n+e[kind],0)}</Label><Label style={s.muted}>לקיחות מתועדות</Label></View><Ionicons name={i?'shirt-outline':'football-outline'} size={34} color={i?GREEN:BLUE}/></View>)}</View>
 <Box title="מי לקח ציוד?" icon="people-outline"><View style={s.tableHeader}><Label style={{flex:1,fontWeight:'700'}}>שחקן</Label><Label style={s.tableNum}>כדור</Label><Label style={s.tableNum}>גופיות</Label></View>{(allEquipment?equipment:equipment.slice(0,10)).map(e=><View key={e.userId} style={s.tableRow}><UserAvatar user={user(e.userId)} size={30}/><Label style={{flex:1,fontWeight:'600'}}>{user(e.userId).name}</Label><Label style={s.tableNum}>{e.ball}</Label><Label style={s.tableNum}>{e.jerseys}</Label></View>)}
 {equipment.length>10&&<Action title={allEquipment?'הצג פחות':`כל השחקנים (${equipment.length})`} icon={allEquipment?'chevron-up':'chevron-down'} onPress={()=>setAllEquipment(v=>!v)}/>}
 {(['ball','jerseys'] as const).map(kind=>{const max=Math.max(0,...equipment.map(e=>e[kind]));const leaders=equipment.filter(e=>e[kind]===max);return max>0?<View key={kind} style={[s.leader,{backgroundColor:kind==='ball'?'#EAF2FF':'#FFF3DF'}]}><Label style={{flex:1,fontSize:13}}>{leaders.map(e=>user(e.userId).name).join(', ')} לקח{leaders.length>1?'ו':''} הכי הרבה {kind==='ball'?'כדור':'גופיות'} · {max} פעמים</Label><Ionicons name={kind==='ball'?'football-outline':'shirt-outline'} size={23} color={kind==='ball'?BLUE:AMBER}/></View>:null;})}</Box>
 <Box title="ללא לקיחת ציוד מתועדת" icon="time-outline">{equipment.filter(e=>e.ball===0&&e.jerseys===0).map(e=>person(e.userId,'אין לקיחת ציוד ברישומים שנטענו לתקופה'))}{!equipment.some(e=>e.ball===0&&e.jerseys===0)&&<Label style={s.muted}>לכל השחקנים יש לקיחת ציוד מתועדת</Label>}</Box><Label style={s.foot}>לפי הרישומים הקיימים בלבד. החזרת ציוד אינה נספרת; רישום חוזר לאותו מחזור ופריט נספר פעם אחת. שינוי ידני ללא מחזור נספר כרישום לקיחה.</Label>
 </>}</>}
 </ScrollSurface>}
 <AdminRatingSheet target={data?ratingTarget:null} current={ratingTarget?data?.group.adminRatings?.[ratingTarget.id]??0:0} saving={saving} onClose={()=>!saving&&setRatingTarget(null)} onSave={saveRating}/>
 <SafeModal visible={!!details&&!!data} transparent animationType="fade" onRequestClose={()=>setDetails(null)}><Pressable style={s.backdrop} onPress={()=>setDetails(null)}><Pressable style={s.detailSheet} onPress={e=>e.stopPropagation()}><ScrollSurface style={{flexShrink:1}} contentContainerStyle={{gap:14}}><Label style={s.heading}>{details?user(details.userId).name:''} · ציוני המחזורים</Label><Label style={s.muted}>כל הציונים הזמינים בתקופה מוצגים כאן, עד חמשת האחרונים. המלצה לשינוי דירוג נבחנת רק כשיש חמישה ציונים ושינוי מתמשך; ציון חריג בודד אינו מספיק.</Label>{details?.points.map(p=><Pressable key={p.gameId} accessibilityRole="button" onPress={()=>{setDetails(null);nav.navigate('MatchDetails',{gameId:p.gameId});}} style={s.detailRow}><Label style={{flex:1}}>מחזור {date(p.at)}</Label><Label style={s.name}>{p.score.toFixed(1)} מתוך 10</Label><Ionicons name="chevron-back" color={BLUE} size={18}/></Pressable>)}<Label style={s.muted}>ציונים חסרים אינם אפס. הסטטיסטיקה אינה מתארת את כל התרומה ההגנתית או את יכולת השוער.</Label><Action title="סגור" icon="close" onPress={()=>setDetails(null)}/></ScrollSurface></Pressable></Pressable></SafeModal>
 </SafeAreaView>;
}
const s=StyleSheet.create({
 cancellationTotal:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:'#FFF3F3',padding:12,borderRadius:12},cancellationN:{fontSize:30,fontWeight:'800',color:'#D84F50'},
 ratingHeading:{flexDirection:'row',alignItems:'center',gap:8},compactPeriod:{flexDirection:'row',gap:4,alignItems:'center',padding:5,borderRadius:8,borderWidth:1,borderColor:'#D8E3F3'},root:{flex:1,backgroundColor:'#F3F6FA'},text:{color:NAVY,fontSize:14,textAlign:RTL_LABEL_ALIGN},hero:{minHeight:112,paddingVertical:12,justifyContent:'center',paddingHorizontal:18},heroLine:{flexDirection:'row',alignItems:'center',gap:8},heroTitle:{fontSize:28,fontWeight:'900',color:'#FFF'},back:{width:48,height:48,justifyContent:'center'},heroSubtitle:{fontSize:13,color:'#FFF',marginStart:40,marginTop:1},lock:{flexDirection:'row',gap:5,alignItems:'center',alignSelf:'flex-start',marginStart:40,marginTop:6,paddingHorizontal:9,paddingVertical:4,borderRadius:12,backgroundColor:'#FFFFFF20',borderWidth:1,borderColor:'#FFFFFF88'},lockText:{fontSize:13,color:'white',fontWeight:'700'},tabs:{flexDirection:'row',backgroundColor:'#FFF',paddingHorizontal:12,borderBottomWidth:1,borderColor:'#E3EAF4'},tab:{flex:1,minHeight:48,justifyContent:'center',alignItems:'center',paddingVertical:10,borderBottomWidth:3,borderColor:'transparent'},tabActive:{borderColor:BLUE},tabLabel:{fontSize:14,fontWeight:'700'},content:{padding:12,gap:10,paddingBottom:28},center:{flex:1,padding:25,alignItems:'center',justifyContent:'center',gap:18},box:{backgroundColor:'white',borderRadius:16,padding:14,gap:10,borderWidth:1,borderColor:'#E9EEF5',shadowColor:'#17395D',shadowOpacity:0.06,shadowRadius:6,shadowOffset:{width:0,height:3},elevation:1},sectionHeading:{flexDirection:'row',gap:7,alignItems:'center'},heading:{fontSize:17,fontWeight:'800',flex:1},pageHeading:{fontSize:20,fontWeight:'800',marginTop:4},subtitle:{fontSize:13,color:'#63718D',marginTop:-6},muted:{fontSize:13,color:'#6C7893'},big:{fontSize:20,fontWeight:'800',marginTop:8},progress:{height:8,backgroundColor:'#DFE7F3',borderRadius:8,overflow:'hidden',alignItems:'flex-start'},fill:{height:8,backgroundColor:BLUE,borderRadius:8},metrics:{flexDirection:'row'},metric:{flex:1,alignItems:'center',justifyContent:'center',gap:3,paddingHorizontal:3},metricN:{fontSize:23,fontWeight:'800',color:BLUE},metricL:{fontSize:13,textAlign:'center'},foot:{fontSize:13,color:'#738099',lineHeight:20},person:{flexDirection:'row',gap:8,alignItems:'center',paddingVertical:10,borderBottomWidth:1,borderColor:'#EEF2F7'},name:{fontSize:14,fontWeight:'700'},actions:{gap:4},action:{flexDirection:'row',gap:5,alignItems:'center',justifyContent:'center',minHeight:48,paddingHorizontal:9,paddingVertical:6,borderRadius:9,borderWidth:1,borderColor:'#C8DAFF'},actionText:{color:BLUE,fontSize:14,flexShrink:1,fontWeight:'700'},period:{flexDirection:'row',backgroundColor:'#EAF0F7',borderRadius:11,padding:3,gap:4},periodItem:{flex:1,alignItems:'center',justifyContent:'center',minHeight:48,borderRadius:9},periodActive:{backgroundColor:BLUE},periodLabel:{fontSize:13,fontWeight:'600'},filters:{flexDirection:'row',gap:6},filter:{flex:1,flexDirection:'row',gap:4,alignItems:'center',justifyContent:'center',backgroundColor:'#E6ECF5',borderRadius:11,minHeight:48,paddingHorizontal:3},filterText:{fontSize:13,fontWeight:'700'},ratingCard:{backgroundColor:'#FFF',borderRadius:16,padding:12,gap:6,borderWidth:1,borderColor:'#E4EBF4',shadowColor:'#18324C',shadowOpacity:0.08,shadowRadius:7,shadowOffset:{width:0,height:3},elevation:2},ratingTop:{flexDirection:'row',alignItems:'center',gap:9},ratingName:{fontSize:16,fontWeight:'800'},ratingValue:{fontSize:15,fontWeight:'800'},badge:{flexDirection:'row',alignItems:'center',gap:3,paddingHorizontal:8,paddingVertical:8,borderRadius:10},chartTitle:{fontSize:13,fontWeight:'600',textAlign:'center',marginTop:1},lastScore:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:12,paddingVertical:5,borderRadius:11},scoreNumber:{borderEndWidth:1,borderColor:'#CDDCD4',paddingEnd:12,minWidth:78},scoreCaption:{fontSize:13,fontWeight:'600'},lastNumber:{fontSize:20,fontWeight:'800'},reason:{fontSize:13,lineHeight:18},cardActions:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:2},edit:{minHeight:48,flexDirection:'row',gap:6,alignItems:'center',paddingHorizontal:4},editText:{fontSize:14,fontWeight:'700',color:BLUE},notice:{fontSize:13,color:AMBER,backgroundColor:'#FFF0D8',padding:10,borderRadius:9},equipmentTiles:{flexDirection:'row',gap:10},equipmentTile:{flex:1,borderRadius:14,padding:12,flexDirection:'row',gap:9,alignItems:'center'},tableHeader:{flexDirection:'row',gap:7,paddingVertical:9,paddingHorizontal:10,backgroundColor:'#EDF2F9',borderRadius:7},tableRow:{flexDirection:'row',paddingHorizontal:10,gap:7,alignItems:'center',paddingVertical:11,borderBottomWidth:1,borderColor:'#EDF2F7'},tableNum:{width:49,textAlign:'center',fontSize:13},leader:{flexDirection:'row',alignItems:'center',gap:8,padding:10,borderRadius:9},backdrop:{flex:1,backgroundColor:'#0007',justifyContent:'flex-end'},detailSheet:{maxHeight:'90%',backgroundColor:'white',borderTopLeftRadius:22,borderTopRightRadius:22,padding:22,gap:14},detailRow:{flexDirection:'row',gap:10,paddingVertical:11,borderBottomWidth:1,borderColor:'#E8EEF5',alignItems:'center'},
});
