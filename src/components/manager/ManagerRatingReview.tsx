import React,{useEffect,useRef,useState} from 'react';
import {Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {RTL_LABEL_ALIGN} from '@/theme/rtl';
import type {User} from '@/types';
import type {RatingReview} from '@/utils/ratingReview';
import {loadRatingReview,decideRatingReview,type ReviewResponse} from '@/services/ratingReviewService';
import {observeCaughtError} from '@/utils/errorObservation';

const labels={collecting:'אוספים נתונים',missing:'חסר מידע להשוואה',watch:'במעקב',conflict:'המדדים אינם מסכימים',up:'לבחון העלאה',down:'לבחון הורדה',unrated:'טרם נקבע דירוג',disabled:'דירוג מנהל כבוי'};
const reasons:Record<string,string>={'appearance-coverage':'חסר מידע ביותר מחמישית מההופעות האחרונות','historical-rating':'חסר דירוג שנשמר בתחילת המחזור','incomplete-history':'תיעוד המשחקים אינו מלא','match-coverage':'אין מספיק משחקים עם הרכבים ודירוגים מלאים',role:'חסר תפקיד להשוואה','personal-comparison':'אין מספיק ציונים של שחקנים בעלי תפקיד ודירוג דומים',teammates:'נדרשים ביצועים עקביים גם עם הרכבים אחרים',unstable:'המסקנה רגישה למחזור בודד או להנחת החישוב','rating-limit':'הדירוג נמצא בקצה הסולם'};
const signed=(n:number)=>`⁦${n>0?'+':''}${n.toFixed(1)}⁩`;
function Button({title,onPress,disabled=false}:{title:string;onPress:()=>void;disabled?:boolean}){return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[s.button,disabled&&{opacity:.45}]}><Text style={s.buttonText}>{title}</Text></Pressable>;}
export function RatingReviewCard({row,name,busy,onDecision,onEdit,onRound,renderTrend}:{row:RatingReview;name:string;busy:boolean;onDecision:(action:'accept'|'keep')=>void;onEdit:()=>void;onRound:(id:string)=>void;renderTrend?:(points:RatingReview['points'])=>React.ReactNode}){
  const [expanded,setExpanded]=useState(false);
  const advice=row.status==='up'||row.status==='down';
  const color=row.status==='up'?'#13834A':row.status==='down'?'#A66709':'#2467F5';
  return <View style={s.card} testID={`rating-review-${row.userId}`}>
    <View style={s.top}><View style={{flex:1}}><Text style={s.name}>{name}</Text><Text style={s.copy}>דירוג מנהל: {row.rating===null?'טרם נקבע':`⁦${row.rating.toFixed(1)}/5⁩`}</Text></View><Text style={[s.badge,{color}]}>{labels[row.status]}</Text></View>
    {advice&&<Text style={[s.proposed,{color}]}>דירוג מוצע: {row.proposed?.toFixed(1)} מתוך 5</Text>}
    {!!row.points.length&&<View style={{gap:6}}><Text style={s.caption}>ציוני מחזור אחרונים מתוך 10</Text>{renderTrend?.(row.points)}<View style={s.actions}>{row.points.map(p=><Button key={p.gameId} title={`${new Date(p.at).toLocaleDateString('he-IL',{day:'numeric',month:'numeric'})}, ציון ${p.score.toFixed(1)}`} onPress={()=>onRound(p.gameId)}/>)}</View></View>}
    <Text style={s.copy}>{row.eligible} מתוך {row.appearances} מחזורים מתאימים להשוואה. נדרשים לפחות {row.minimum}.</Text>
    {row.since>0&&<Text style={s.copy}>הנתונים נספרים מחדש מאז ההחלטה על הדירוג.</Text>}
    {row.teamDelta!==null&&row.personalDelta!==null&&<View style={s.metrics}>
      <View style={s.metric}><Text style={s.caption}>תוצאות קבוצתיות מול הציפייה</Text><Text style={s.value}>{signed(row.teamDelta*100)} נקודות אחוז</Text></View>
      <View style={s.metric}><Text style={s.caption}>ציון מול שחקנים דומים</Text><Text style={s.value}>{signed(row.personalDelta)} נקודות</Text></View>
    </View>}
    {advice?<Text style={s.copy}>שני המדדים תומכים בשינוי, גם בבדיקת רגישות למחזור בודד ולחוזק היריבים. זו הצעה לבדיקה שלך.</Text>:<Text style={s.copy}>{row.status==='collecting'?'נדרשים מחזורים חדשים עם דירוגים שמורים. נתוני העבר אינם מושלמים בדיעבד.':row.status==='conflict'?'התוצאות הקבוצתיות והציונים האישיים מצביעים לכיוונים שונים. אין המלצה לשינוי.':row.status==='watch'?'אין כרגע פער עקבי שעומד בכל תנאי ההמלצה.':row.status==='unrated'?'אפשר לקבוע דירוג ראשוני לפי ההיכרות שלך עם השחקן.':'לא מסיקים מהמידע החסר שהדירוג מתאים או שאינו מתאים.'}</Text>}
    {!!row.reasons.length&&<Text style={s.note}>{[...new Set(row.reasons.map(r=>reasons[r]??'חסר מידע אמין'))].join('. ')}.</Text>}
    <View style={s.actions}>{advice&&<><Button title={busy?'שומר...':`עדכן ל-${row.proposed?.toFixed(1)}`} disabled={busy} onPress={()=>onDecision('accept')}/><Button title="הדירוג מתאים" disabled={busy} onPress={()=>onDecision('keep')}/></>}<Button title="ערוך דירוג" disabled={busy} onPress={onEdit}/>{!!row.evidence.length&&<Button title={expanded?'הסתר נתונים':'הצג נתונים'} onPress={()=>setExpanded(v=>!v)}/>}</View>
    {expanded&&<View style={{gap:10}}><Text style={s.note}>לכל מחזור משקל שווה. הציון האישי מושווה לחציון של לפחות שלושה שחקנים בעלי תפקיד ודירוג דומים באותו מחזור.</Text>{row.evidence.map(e=><Pressable key={e.gameId} accessibilityRole="button" onPress={()=>onRound(e.gameId)} style={s.evidence}><Text style={s.copy}>מחזור {new Date(e.at).toLocaleDateString('he-IL')} · {e.used} מתוך {e.played} משחקים</Text><Text style={s.copy}>תוצאות: {signed(e.team*100)} נקודות אחוז. ציון: {signed(e.personal)} מול {e.peers} שחקנים.</Text></Pressable>)}</View>}
  </View>;
}
export function ManagerRatingReview({groupId,viewerId,users,enabled,onEdit,onSaved,onRound,renderTrend}:{groupId:string;viewerId:string;users:User[];enabled:boolean;onEdit:(user:User)=>void;onSaved:()=>void;onRound:(id:string)=>void;renderTrend?:(points:RatingReview['points'])=>React.ReactNode}){
  const owner=JSON.stringify([groupId,viewerId,enabled]),current=useRef(owner);current.current=owner;
  const [state,setState]=useState<{owner:string;data?:ReviewResponse;error?:string}|null>(null),[refresh,setRefresh]=useState(0);
  const [search,setSearch]=useState(''),[filter,setFilter]=useState<'all'|'up'|'down'>('all'),[busy,setBusy]=useState(false);
  const pending=useRef(false),live=useRef(false),request=useRef<{key:string;id:string}|null>(null);
  useEffect(()=>{let alive=true;live.current=true;setState(null);setFilter('all');setSearch('');
    loadRatingReview(groupId).then(data=>{if(alive&&current.current===owner)setState({owner,data});}).catch(error=>{if(alive&&current.current===owner){observeCaughtError(error,{source:'src/components/manager/ManagerRatingReview.tsx',handler:'load',site:'rating-review-load'});setState({owner,error:'המלצות הדירוג לא נטענו. ייתכן שהשירות עדיין לא הופעל. אפשר לנסות שוב.'});}});
    return()=>{alive=false;live.current=false;};
  },[owner,refresh]);
  const data=state?.owner===owner?state.data:undefined,error=state?.owner===owner?state.error:undefined;
  async function decide(row:RatingReview,action:'accept'|'keep'){
    if(!data||pending.current)return;pending.current=true;setBusy(true);
    const key=JSON.stringify([owner,data.basis,row.userId,action]);
    if(request.current?.key!==key)request.current={key,id:`review_${Date.now()}_${Math.random().toString(36).slice(2)}`};
    try{await decideRatingReview(groupId,row,data.basis,action,request.current.id);if(live.current&&current.current===owner){setRefresh(v=>v+1);onSaved();}}
    catch(error){if(live.current&&current.current===owner){observeCaughtError(error,{source:'src/components/manager/ManagerRatingReview.tsx',handler:'decide',site:'rating-review-decision'});setState({owner,error:'העדכון לא אושר. רענן את הנתונים לפני ניסיון נוסף.'});}}
    finally{pending.current=false;if(live.current)setBusy(false);}
  }
  const byId=new Map(users.map(u=>[u.id,u]));
  const rows=(data?.rows??[]).filter(r=>(filter==='all'||r.status===filter)&&(byId.get(r.userId)?.name??'').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a,b)=>Number(['up','down'].includes(b.status))-Number(['up','down'].includes(a.status))||(byId.get(a.userId)?.name??'').localeCompare(byId.get(b.userId)?.name??'','he'));
  return <View style={{gap:12}}><Text style={s.heading}>התאמת דירוגים</Text><Text style={s.copy}>עד עשר הופעות ב-120 הימים האחרונים. המלצה דורשת תוצאות קבוצתיות וציונים אישיים שתומכים באותו כיוון.</Text>
    {!enabled&&<Text style={s.copy}>להצגת המלצות יש להפעיל דירוג מנהל בהגדרות המועדון.</Text>}{error?<View style={s.card}><Text style={s.copy}>{error}</Text><Button title="נסה שוב" onPress={()=>setRefresh(v=>v+1)}/></View>:!data?<Text accessibilityRole="alert" style={s.copy}>טוענים נתונים להשוואה...</Text>:<>
      <TextInput style={s.search} value={search} onChangeText={setSearch} placeholder="חיפוש שחקן" accessibilityLabel="חיפוש שחקן"/>
      <View style={s.actions}>{(['all','up','down'] as const).map(f=><Button key={f} title={`${f==='all'?'הכול':f==='up'?'העלאה':'הורדה'} (${data.rows.filter(r=>f==='all'||r.status===f).length})`} onPress={()=>setFilter(f)}/>)}</View>
      {!rows.length&&<Text style={s.copy}>אין שחקנים בסינון שנבחר.</Text>}
      {rows.map(row=><RatingReviewCard key={`${row.userId}:${row.revision}`} row={row} name={byId.get(row.userId)?.name??'שחקן ללא פרטים'} busy={busy||!enabled||!byId.has(row.userId)} onDecision={action=>void decide(row,action)} onEdit={()=>{const u=byId.get(row.userId);if(u&&enabled)onEdit(u);}} onRound={onRound} renderTrend={renderTrend}/>)}
      <Text style={s.note}>החישוב הוא כלי עזר למנהל. תוצאות הקבוצה אינן הוכחה לתרומה של שחקן יחיד, וציוני המחזור אינם מתארים את כל התרומה ההגנתית. דירוג לא משתנה בלי בחירה שלך.</Text>
    </>}</View>;
}
const s=StyleSheet.create({heading:{fontSize:22,fontWeight:'800',color:'#101B47',textAlign:RTL_LABEL_ALIGN},card:{backgroundColor:'white',borderRadius:16,padding:16,gap:12,borderWidth:1,borderColor:'#E1E7F0'},top:{flexDirection:'row',gap:10,alignItems:'center'},name:{fontSize:18,fontWeight:'800',color:'#101B47',textAlign:RTL_LABEL_ALIGN},copy:{fontSize:14,lineHeight:22,color:'#344562',textAlign:RTL_LABEL_ALIGN},note:{fontSize:13,lineHeight:21,color:'#62728A',textAlign:RTL_LABEL_ALIGN},badge:{fontSize:13,fontWeight:'700',maxWidth:'42%',textAlign:RTL_LABEL_ALIGN},proposed:{fontSize:20,fontWeight:'800',textAlign:RTL_LABEL_ALIGN},metrics:{gap:10,backgroundColor:'#F2F6FC',padding:12,borderRadius:12},metric:{gap:4},caption:{fontSize:13,color:'#536680',textAlign:RTL_LABEL_ALIGN},value:{fontSize:17,fontWeight:'700',color:'#101B47',textAlign:RTL_LABEL_ALIGN},actions:{flexDirection:'row',flexWrap:'wrap',gap:8},button:{minHeight:48,paddingHorizontal:12,paddingVertical:10,borderWidth:1,borderColor:'#CBD9EF',borderRadius:10,justifyContent:'center'},buttonText:{fontSize:14,fontWeight:'700',color:'#2467F5',textAlign:RTL_LABEL_ALIGN},search:{backgroundColor:'white',borderWidth:1,borderColor:'#CBD9EF',minHeight:48,borderRadius:10,paddingHorizontal:12,textAlign:RTL_LABEL_ALIGN,color:'#101B47'},evidence:{paddingVertical:10,borderTopWidth:1,borderColor:'#E1E7F0',minHeight:48}});
