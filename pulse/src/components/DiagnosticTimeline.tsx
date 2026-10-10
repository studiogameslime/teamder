import React,{useEffect,useMemo,useState}from'react';
import{ActivityIndicator,Pressable,StyleSheet,Text,View}from'react-native';
import{Ionicons}from'@expo/vector-icons';
import*as Clipboard from'expo-clipboard';
import{colors}from'../theme';
import{getDoc}from'../services/firestoreRest';
import{parseJournal,stepLabel,stepTime,copyJournal,kindLabels,type Journal}from'../services/diagnosticTimeline';
import{screenHe}from'../services/screenNames';

/** Fetch large diagnostics only when requested, never in inbox list queries. */
export function DiagnosticTimeline({docPath}:{docPath:string}){
 const[open,setOpen]=useState(false),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false);
 const[data,setData]=useState<{current:Journal|null;previous:Journal|null;legacy:string}|null>(null);
 const[previous,setPrevious]=useState(false),[filter,setFilter]=useState('all'),[limit,setLimit]=useState(30),[copied,setCopied]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!open)return;let alive=true;setLoading(true);setFailed(false);setData(null);
  getDoc(docPath).then(d=>{if(alive)setData({current:parseJournal(d?.journal??d?.lastJournal),previous:parseJournal(d?.previousJournal),legacy:typeof(d?.trail??d?.lastTrail)==='string'?String(d?.trail??d?.lastTrail).slice(0,6000):''});})
   .catch(()=>{if(alive)setFailed(true);}).finally(()=>{if(alive)setLoading(false);});
  return()=>{alive=false;};
 },[open,docPath,retry]);
 useEffect(()=>{setPrevious(false);setFilter('all');setLimit(30);setCopied(false);},[docPath]);
 const journal=previous?data?.previous:data?.current;
 const filtered=useMemo(()=>journal?.entries.filter(e=>filter==='all'||(filter==='press'?(e.kind==='tap'||e.kind==='press'):e.kind===filter))??[],[journal,filter]);
 return <View style={s.card}>
  <Pressable accessibilityRole="button" accessibilityState={{expanded:open}} onPress={()=>setOpen(v=>!v)} style={s.head}>
   <View style={{flex:1}}><Text style={s.title}>רצף הפעולות</Text><Text style={s.sub}>מה קרה לפני הדיווח או השגיאה</Text></View>
   <Ionicons name={open?'chevron-up':'git-branch-outline'} size={22} color={colors.primary}/>
  </Pressable>
  {open?<View style={{gap:12}}>
   {loading?<ActivityIndicator color={colors.primary}/>:failed?<Pressable onPress={()=>setRetry(v=>v+1)}><Text style={s.warning}>טעינת הרצף נכשלה — נסה שוב</Text></Pressable>:<>
    {data?.previous?<View style={s.actions}>{[false,true].map(v=><Pressable key={String(v)} onPress={()=>{setPrevious(v);setLimit(30);setCopied(false);}} style={[s.chip,previous===v&&s.selected]}><Text style={s.text}>{v?'הפעלה קודמת':'הפעלה נוכחית'}</Text></Pressable>)}</View>:null}
    {journal?<>
     <Text style={s.sub}>{journal.entries.length} צעדים זמינים מתוך {journal.total}</Text>
     {journal.omitted>0?<Text style={s.warning}>הרצף חלקי: {journal.omitted} צעדים הושמטו בגלל מגבלת גודל.</Text>:null}
     <View style={s.actions}>{[['all','הכל'],['nav','מסכים'],['press','לחיצות'],['scroll','גלילות'],['err','שגיאות']].map(([key,label])=><Pressable key={key} onPress={()=>{setFilter(key);setLimit(30);}} style={[s.chip,filter===key&&s.selected]}><Text style={s.text}>{label}</Text></Pressable>)}</View>
     <Pressable accessibilityRole="button" onPress={()=>{void Clipboard.setStringAsync(copyJournal(journal)).then(()=>setCopied(true)).catch(()=>setCopied(false));}} style={s.copy}><Text style={s.text}>{copied?'הרצף הועתק':'העתק את כל הרצף לשחזור'}</Text><Ionicons name="copy-outline" size={16} color={colors.primary}/></Pressable>
     {filtered.slice(0,limit).map((e,i)=><View key={`${e.seq}-${i}`} style={[s.step,e.kind==='err'&&s.error]}>
      {filter==='all'&&e.seq>(i?filtered[i-1].seq:0)+1?<Text style={s.warning}>חסרות {e.seq-(i?filtered[i-1].seq:0)-1} פעולות ברצף</Text>:null}
      <View style={s.head}><Text style={[s.label,e.kind==='err'&&{color:colors.red}]}>{stepLabel(e)}</Text><Text style={s.clock}>#{e.seq} · {stepTime(e.ms)}</Text></View>
      {e.screen?<Text style={s.sub}>{screenHe(e.screen)}</Text>:null}
      <Text style={s.code} selectable>{e.name}</Text>
      {Object.entries(e.data??{}).map(([k,v])=><Text key={k} selectable style={s.code}>{k}: {String(v)}</Text>)}
     </View>)}
     {!filtered.length?<Text style={s.sub}>אין פעולות בסינון שנבחר</Text>:null}
     {filtered.length>limit?<Pressable style={s.copy} onPress={()=>setLimit(v=>v+30)}><Text style={s.text}>הצג עוד 30 צעדים ({filtered.length-limit} נותרו)</Text></Pressable>:null}
    </>:data?.legacy?<><Text style={s.warning}>תיעוד מהגרסה הקודמת — ללא רצף מובנה</Text><Text selectable style={s.code}>{data.legacy}</Text></>:<Text style={s.sub}>לא צורף רצף פעולות לפריט הזה. דיווחים מגרסאות ישנות עשויים לא לכלול אותו.</Text>}
   </>}
  </View>:null}
 </View>;
}
const s=StyleSheet.create({
 card:{backgroundColor:colors.surfaceAlt,borderColor:colors.border,borderWidth:1,borderRadius:16,padding:14,gap:14},
 head:{flexDirection:'row',alignItems:'center',gap:10},title:{color:colors.text,fontSize:16,fontWeight:'800',textAlign:'right'},sub:{color:colors.textSoft,fontSize:12,textAlign:'right'},
 text:{color:colors.text,fontSize:12,textAlign:'right'},label:{flex:1,color:colors.text,fontSize:13,fontWeight:'700',textAlign:'right'},
 clock:{color:colors.textMuted,fontSize:11,writingDirection:'ltr'},actions:{flexDirection:'row',flexWrap:'wrap',gap:7},
 chip:{borderRadius:8,paddingVertical:7,paddingHorizontal:10,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},selected:{borderColor:colors.primary,backgroundColor:colors.primarySoft},
 warning:{color:colors.amber,fontSize:12,textAlign:'right'},copy:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,padding:10,borderRadius:10,borderWidth:1,borderColor:colors.primary},
 step:{backgroundColor:colors.surface,borderRadius:10,padding:12,gap:5,borderRightWidth:3,borderRightColor:colors.primary},error:{borderRightColor:colors.red},
 code:{fontSize:11,color:colors.textSoft,writingDirection:'ltr',textAlign:'left',fontFamily:'monospace'},
});
