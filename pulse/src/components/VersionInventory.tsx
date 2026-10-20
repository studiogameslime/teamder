import { Dropdown } from './Dropdown';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { RtlTextInput as TextInput } from './RtlTextInput';
import { Card, Disclosure } from './ui';
import { RTL_LABEL_ALIGN, colors, font  } from '../theme';
import { latestPlatformVersions, type UserVersions } from '../services/deviceVersions';
import { timeAgo } from '../format';
import { navRef } from '../navigation/navRef';

const text={ ...font.body,textAlign: RTL_LABEL_ALIGN};
export function VersionInventory({rows,busy,failed,loadedAt,load,targets,compact=false,onUsers,platform,setPlatform}:{rows:UserVersions[]|null;busy:boolean;failed:boolean;loadedAt:number;load:()=>void;targets:{android?:string;ios?:string};compact?:boolean;onUsers?:()=>void;platform:'android'|'ios';setPlatform:(value:'android'|'ios')=>void}) {
 const [oldest,setOldest]=useState(false);
 const [search,setSearch]=useState('');const [filter,setFilter]=useState('all');const [limit,setLimit]=useState(30);
 useEffect(()=>{setFilter('all');setLimit(30)},[platform]);
 const summary=rows?latestPlatformVersions(rows,platform,targets[platform]):null;
 const filtered=(summary?.entries.filter(row=>(`${row.user.name} ${row.user.userId} ${row.device?.version ?? ''}`).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (filter==='all' || (filter==='missing'?!row.device:row.device?.version===filter))) ?? []).sort((a,b)=>oldest?(a.device?.observedAt ?? 0)-(b.device?.observedAt ?? 0):(b.device?.observedAt ?? 0)-(a.device?.observedAt ?? 0));
 const versions=[...new Set(summary?.entries.flatMap(row=>row.device?[row.device.version]:[]) ?? [])].sort();
 return <View style={{gap:14}}>
  <View style={{flexDirection:'row',direction:'rtl',gap:0,backgroundColor:colors.surface,borderRadius:12,padding:4}}>{(['android','ios'] as const).map(p=><Pressable key={p} accessibilityRole="button" accessibilityState={{selected:p===platform}} onPress={()=>{setPlatform(p);setFilter('all');setLimit(30)}} style={{flex:1,padding:10,borderRadius:9,borderWidth:0,backgroundColor:p===platform?colors.primarySoft:colors.surface}}><Text style={{...text,textAlign:'center',color:p===platform?colors.primary:colors.text}}>⁦{p==='android'?'Android':'iOS'}⁩</Text></Pressable>)}</View>
  {!compact?<><Text style={{...text,fontSize:18,fontWeight:'700'}}>גרסה אחרונה שנצפתה לכל משתמש</Text><Text style={font.small}>מכשיר בעל דיווח הגרסה העדכני ביותר</Text></>:null}
  {!rows?<Pressable accessibilityRole="button" disabled={busy} onPress={load} style={{padding:rows?4:12,borderRadius:10,backgroundColor:rows?'transparent':colors.primarySoft,alignSelf:rows?'flex-start':'stretch',flexDirection:'row',direction:'rtl',gap:6,alignItems:'center'}}><Ionicons name="refresh-outline" size={16} color={colors.primary}/><Text style={{...text,color:colors.primary}}>{busy?'טוען רישומי מכשירים…':rows?'רענון נתוני הגרסאות':'טעינת נתוני הגרסאות'}</Text></Pressable>:null}
  {!rows?<Text style={font.small}>הטעינה יזומה וכוללת קריאת רישומי מכשירים לחשבונות שנבדקים. מעבר בין הלשוניות אינו מפעיל סריקה נוספת.</Text>:null}
  {busy?<ActivityIndicator color={colors.primary}/>:null}
  {failed?<Text style={{...text,color:colors.amber}}>העדכון נכשל. מוצגים הנתונים הקודמים אם נטענו.</Text>:null}
  {summary?<>
   {compact?<Card style={{gap:10}}><Text style={{...text,fontSize:32,fontWeight:'800',color:colors.primary}}>{summary.percent===null?'—':`${summary.percent}%`}</Text><Text style={text}>{targets[platform]?`בגרסה ⁦${targets[platform]}⁩ מתוך בעלי גרסה ידועה במערכת שנבחרה`:'גרסת החנות לא ידועה — לא ניתן לחשב אימוץ'}</Text>{summary.percent!==null?<View style={{height:8,backgroundColor:colors.border,borderRadius:4,overflow:'hidden',direction:'rtl'}}><View style={{width:`${summary.percent}%`,height:8,backgroundColor:colors.primary}}/></View>:null}<Text style={font.small}>{targets[platform]?`${summary.current} מתוך ${summary.known}`:`${summary.known} בעלי מידע`} · ללא דיווח במערכת הזו: {summary.missing} · קריאה נכשלה: {summary.failed}</Text><Pressable onPress={onUsers} style={{paddingVertical:10}}><Text style={{...text,color:colors.primary}}>לפירוט המשתמשים</Text></Pressable></Card>:<>
    <View style={{flexDirection:'row',direction:'rtl',gap:8}}>{[[targets[platform]?summary.current:'—','בגרסת החנות'],[targets[platform]?summary.other:'—','בגרסה אחרת'],[summary.missing,'ללא דיווח']].map(([n,label])=><View key={label} style={{flex:1,paddingVertical:14,backgroundColor:colors.surface,borderRadius:12,alignItems:'center',gap:6}}><Text style={{...font.h1,color:colors.primary}}>{n}</Text><Text style={{...font.small,textAlign:'center'}}>{label}</Text></View>)}</View>
    <Text style={{...font.small,textAlign:'center'}}>הנתונים עשויים להיות ישנים{summary.failed?` · ${summary.failed} קריאות נכשלו`:''}</Text>
    <View style={{flexDirection:'row',direction:'rtl',alignItems:'center',gap:8,paddingHorizontal:12,borderRadius:12,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border}}><Ionicons name="search-outline" size={19} color={colors.textMuted}/><TextInput accessibilityLabel="חיפוש משתמש בגרסאות" placeholder="חיפוש משתמש או גרסה" placeholderTextColor={colors.textMuted} value={search} onChangeText={value=>{setSearch(value);setLimit(30)}} style={{...text,flex:1,minWidth:0,minHeight:46}}/></View>
    <View style={{flexDirection:'row',direction:'rtl',gap:8}}><Dropdown flex={1} title="סינון גרסאות" value={filter} options={[{value:'all',label:'כל הגרסאות'},{value:'missing',label:'ללא מידע'},...versions.map(v=>({value:v,label:v}))]} onSelect={v=>{setFilter(v);setLimit(30)}}/><Dropdown flex={1} title="מועד דיווח" value={oldest?'old':'new'} options={[{value:'new',label:'חדש תחילה'},{value:'old',label:'ישן תחילה'}]} onSelect={v=>{setOldest(v==='old');setLimit(30)}}/></View>
    <Text style={font.small}>{filtered.length} משתמשים בסינון · הנתונים עשויים להיות ישנים</Text>
    {filtered.slice(0,limit).map(({user,device})=><Pressable key={user.userId} accessibilityRole="button" onPress={()=>(navRef as any).navigate('Users',{screen:'UserDetail',params:{userId:user.userId}})}><Card style={{gap:7}}><View style={{flexDirection:'row',direction:'rtl',gap:10,alignItems:'center'}}><Text style={{ ...font.title,flex:1,textAlign: RTL_LABEL_ALIGN}}>{user.name || 'משתמש'}</Text><Text style={{...font.small,fontWeight:'700',paddingHorizontal:8,paddingVertical:5,borderRadius:7,backgroundColor:device?.version===targets[platform]?colors.primary:'#BAC0C5',color:colors.onPrimary}}>⁦{device?.version ?? 'לא ידועה'}⁩</Text><Ionicons name="chevron-back" size={15} color={colors.textMuted}/></View><Text style={font.small}>{user.failed?'קריאת המכשירים נכשלה':device?`${device.device || 'מכשיר'} · נצפתה ${timeAgo(device.observedAt)}`:'לא התקבל דיווח במערכת ההפעלה הזו'}</Text>{device && Date.now()-device.observedAt>30*86400000?<Text style={{...font.small,color:colors.amber}}>דיווח בן יותר מ־30 יום</Text>:null}</Card></Pressable>)}
    {!filtered.length?<Text style={text}>לא נמצאו משתמשים בסינון שנבחר</Text>:null}
    {filtered.length>limit?<Pressable onPress={()=>setLimit(n=>n+30)} style={{padding:14}}><Text style={{...text,color:colors.primary}}>הצגת משתמשים נוספים</Text></Pressable>:null}
   </>}
   <Pressable accessibilityRole="button" disabled={busy} onPress={load} style={{padding:rows?4:12,borderRadius:10,backgroundColor:rows?'transparent':colors.primarySoft,alignSelf:rows?'flex-start':'stretch',flexDirection:'row',direction:'rtl',gap:6,alignItems:'center'}}><Ionicons name="refresh-outline" size={16} color={colors.primary}/><Text style={{...text,color:colors.primary}}>{busy?'טוען רישומי מכשירים…':rows?'רענון נתוני הגרסאות':'טעינת נתוני הגרסאות'}</Text></Pressable>
   <Text style={font.small}>עודכן {timeAgo(loadedAt)} · ללא חשבונות בדיקה ומחוקים. הספירה מתייחסת לחשבונות שנבדקו.</Text>
   <Disclosure title="מקור הנתונים ומשמעות הספירה"><Text style={font.small}>המידע נשמר ברישום להתראות ועשוי להיות ישן. ללא דיווח במערכת זו אינו בהכרח משתמש במערכת הזו. קריאות שנכשלו אינן נספרות כחסרות. {targets[platform]?`גרסת החנות: ⁦${targets[platform]}⁩`:'גרסת החנות לא ידועה'}</Text></Disclosure>
  </>:null}
 </View>;
}
