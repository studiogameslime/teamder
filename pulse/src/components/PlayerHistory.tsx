import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Dropdown } from './Dropdown';
import { RTL_LABEL_ALIGN, colors, font  } from '../theme';
import type { UserActivity } from '../types';

export function PlayerHistory({data,onError}:{data:UserActivity;onError:(id:string)=>void}) {
 const [filter,setFilter]=useState('all');
 const [period,setPeriod]=useState('all');
 const [limit,setLimit]=useState(30);
 const start=new Date();start.setHours(0,0,0,0);
 const yesterday=new Date(start);yesterday.setDate(yesterday.getDate()-1);
 const cutoff=period==='today'?start.getTime():period==='week'?Date.now()-7*86400000:period==='month'?Date.now()-30*86400000:0;
 const rows=[
  ...data.timeline.filter(e=>e.kind!=='card').map((e,index)=>({id:`event:${index}`,at:e.at,title:e.action || e.title,subtitle:e.action?e.title:e.subtitle,kind:e.kind as string,errorId:''})),
  ...data.errors.map(e=>({id:`error:${e.id}`,at:e.lastSeen,title:e.category==='crash'?'האפליקציה קרסה':'תקלה באפליקציה',subtitle:e.title,kind:'error',errorId:e.id})),
 ].filter(e=>(!cutoff || e.at>=cutoff) && (filter==='all' || (filter==='errors'?e.kind==='error':filter==='support'?e.kind==='feedback':e.kind!=='error' && e.kind!=='feedback'))).sort((a,b)=>b.at-a.at);
 const day=(at:number)=>!at?'מועד לא תועד':new Date(at).toDateString();
 const heading=(at:number)=>!at?'מועד לא תועד':day(at)===day(start.getTime())?'היום':day(at)===day(yesterday.getTime())?'אתמול':new Date(at).toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'numeric'});
 return <View style={{gap:16}}>
  <View style={{flexDirection:'row',direction:'rtl',gap:10}}>
   <Dropdown outlined flex={1} title="סוג פעילות" value={filter} onSelect={v=>{setFilter(v);setLimit(30)}} options={[{value:'all',label:'כל הפעילות'},{value:'activity',label:'פעילות'},{value:'errors',label:'תקלות וקריסות'},{value:'support',label:'פניות'}]}/>
   <Dropdown outlined flex={1} title="תקופת הפעילות" value={period} onSelect={v=>{setPeriod(v);setLimit(30)}} options={[{value:'all',label:'כל התקופות'},{value:'today',label:'היום'},{value:'week',label:'שבוע אחרון'},{value:'month',label:'חודש אחרון'}]}/>
  </View>
  {rows.slice(0,limit).map((e,index)=> <View key={e.id}>
   {index===0 || day(rows[index-1].at)!==day(e.at)?<Text style={{ ...font.h2,textAlign: RTL_LABEL_ALIGN,paddingTop:16,paddingBottom:12,borderBottomWidth:1,borderBottomColor:colors.border,marginBottom:16}}>{heading(e.at)}</Text>:null}
   <View style={{flexDirection:'row',direction:'rtl',gap:12}}>
    <View style={{width:12,alignItems:'center'}}><View style={{width:9,height:9,borderRadius:5,backgroundColor:e.errorId?colors.red:colors.primary,marginTop:6}}/>{index<Math.min(rows.length,limit)-1 && day(rows[index+1].at)===day(e.at)?<View style={{width:1,flex:1,backgroundColor:colors.border,marginTop:5}}/>:null}</View>
    <View style={{flex:1,gap:7,paddingBottom:20}}><View style={{flexDirection:'row',direction:'rtl',gap:12}}><Text style={{ ...font.title,textAlign: RTL_LABEL_ALIGN,flex:1}}>{e.title}</Text><Text style={font.small}>{e.at?new Date(e.at).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'}):'—'}</Text></View>{e.subtitle?<Text style={{ ...font.small,textAlign: RTL_LABEL_ALIGN}}>{e.subtitle}</Text>:null}
     {e.errorId?<Pressable accessibilityRole="button" onPress={()=>onError(e.errorId)} style={{flexDirection:'row',direction:'rtl',gap:6,paddingVertical:6}}><Text style={{...font.body,color:colors.primary}}>לפרטי התקלה</Text><Ionicons name="chevron-back" size={18} color={colors.primary}/></Pressable>:null}
    </View>
   </View>
  </View>)}
  {!rows.length?<Text style={{ ...font.body,textAlign: RTL_LABEL_ALIGN}}>אין פעילות מתועדת בסינון שנבחר</Text>:null}
  {rows.length>limit?<Pressable onPress={()=>setLimit(n=>n+30)} style={{paddingVertical:12}}><Text style={{...font.body,color:colors.primary}}>הצגת פעילות נוספת</Text></Pressable>:null}
  {data.errors.length?<Text style={{ ...font.small,fontSize:11,textAlign: RTL_LABEL_ALIGN}}>שיוך התקלה מבוסס על המשתמש האחרון שתועד בה. המועד הוא מועד התצפית האחרון בתקלה.</Text>:null}
 </View>;
}
