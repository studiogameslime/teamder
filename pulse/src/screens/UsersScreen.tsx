import { observeCaughtError } from '../services/errorObservation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { RtlTextInput as TextInput } from '../components/RtlTextInput';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Screen } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import { isolateText, RTL_LABEL_ALIGN, colors, font  } from '../theme';
import { timeAgo } from '../format';
import { fetchUserPage, type UserPageFilter } from '../services/userPages';
import type { DocumentPageCursor } from '../services/firestoreRest';
import type { AppUser } from '../types';

export function UsersScreen(){
 const nav=useNavigation<any>();
 const [pages,setPages]=useState<Awaited<ReturnType<typeof fetchUserPage>>[]>([]);
 const [page,setPage]=useState(0);const [loading,setLoading]=useState(false);const [failed,setFailed]=useState(false);
 const [search,setSearch]=useState('');const [query,setQuery]=useState('');const [filter,setFilter]=useState<UserPageFilter>('all');const [range,setRange]=useState('all');const [legacy,setLegacy]=useState(false);
 const generation=useRef(0);
 const lastRequest=useRef<{cursor?:DocumentPageCursor;index:number}>({index:0});
 useEffect(()=>{const t=setTimeout(()=>setQuery(search.trim()),350);return()=>clearTimeout(t)},[search]);
 const asOf=useMemo(()=>Date.now(),[query,filter,range,legacy]);
 const since=range==='today'?new Date(new Date(asOf).setHours(0,0,0,0)).getTime():range==='7d'?asOf-7*86400000:range==='30d'?asOf-30*86400000:undefined;
 const load=async(cursor?:DocumentPageCursor,index=0,force=false)=>{
  const request=++generation.current;lastRequest.current={cursor,index};setLoading(true);setFailed(false);
  try{const result=await fetchUserPage({cursor,search:query,filter,since,legacy,now:asOf,force});if(request===generation.current){setPages(old=>index===0?[result]:[...old.slice(0,index),result]);setPage(index)}}catch (caughtErrorbd3315a31e){
    observeCaughtError(caughtErrorbd3315a31e, {"source":"pulse/src/screens/UsersScreen.tsx","handler":"load","site":"UsersScreen:bd3315a31e"});if(request===generation.current)setFailed(true)}finally{if(request===generation.current)setLoading(false)}
 };
 useEffect(()=>{setPages([]);setPage(0);void load();return()=>{generation.current++}},[query,filter,range,legacy]);
 const current=pages[page];
 return <Screen title="משתמשים" subtitle="חיפוש וניהול שחקנים" scroll={false} right={<Pressable accessibilityLabel="רענון משתמשים" onPress={()=>void load(undefined,0,true)} style={{padding:12}}><Ionicons name="refresh-outline" size={23} color={colors.textSoft}/></Pressable>}>
  <FlatList style={{flex:1,minHeight:0}} data={current?.rows ?? []} keyExtractor={u=>u.id} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading && !!current} onRefresh={()=>void load(undefined,0,true)} tintColor={colors.primary}/>}
   ListHeaderComponent={<View style={{gap:14,paddingBottom:10}}>
    <Text style={{ ...font.small,textAlign: RTL_LABEL_ALIGN}}>20 משתמשים בכל עמוד · {query?'חיפוש לפי תחילת שם או דוא״ל':legacy?'עיון לפי מזהה':'לפי הפעילות האחרונה'}</Text>
    <View style={{flexDirection:'row',direction:'rtl',gap:10,alignItems:'center',borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,borderRadius:12,paddingHorizontal:12}}><Ionicons name="search-outline" size={21} color={colors.textSoft}/><TextInput accessibilityLabel="חיפוש משתמשים" value={search} onChangeText={setSearch} placeholder="תחילת שם או דוא״ל" placeholderTextColor={colors.textMuted} style={{ ...font.body,flex:1,minHeight:48,textAlign: RTL_LABEL_ALIGN,minWidth:0}}/></View>
    <View style={{flexDirection:'row',direction:'rtl',gap:10}}><Dropdown outlined flex={1} title="סינון משתמשים" value={filter} onSelect={v=>setFilter(v as UserPageFilter)} options={[{value:'all',label:'כל המשתמשים'},{value:'online',label:'פעילים עכשיו'},{value:'inactive7',label:'לא פעילים 7 ימים'},{value:'inactive30',label:'לא פעילים 30 ימים'}]}/><Dropdown outlined flex={1} title="תקופת המשתמשים" value={range} onSelect={setRange} options={[{value:'all',label:'כל התקופות'},{value:'today',label:'היום'},{value:'7d',label:'7 ימים'},{value:'30d',label:'30 ימים'}]}/></View>
    <View style={{flexDirection:'row',direction:'rtl',justifyContent:'space-between',paddingVertical:10,borderBottomWidth:1,borderBottomColor:colors.border}}><Text style={font.small}>רשימת משתמשים</Text><Text style={font.small}>{query?'לפי שם ↓':legacy?'לפי מזהה ↓':'פעילות אחרונה ↓'}</Text></View>
    {failed?<Pressable onPress={()=>void load(lastRequest.current.cursor,lastRequest.current.index,true)}><Text style={{...font.body,color:colors.amber}}>הטעינה נכשלה. לחצו לניסיון חוזר.</Text></Pressable>:null}
    {(query || legacy) && (filter!=='all' || range!=='all')?<Text style={font.small}>בחיפוש ובעיון לפי מזהה מוצגים חשבונות מכל התקופות, ללא סינון פעילות.</Text>:null}
   </View>}
   renderItem={({item:u})=><Pressable accessibilityRole="button" accessibilityLabel={`פרטי ${u.name}`} onPress={()=>nav.navigate('UserDetail',{userId:u.id})} style={{flexDirection:'row',direction:'rtl',alignItems:'center',gap:12,paddingVertical:18,borderBottomWidth:1,borderBottomColor:colors.border}}><View style={{width:45,height:45,borderRadius:23,backgroundColor:colors.surfaceAlt,alignItems:'center',justifyContent:'center'}}><Text style={font.title}>{u.name.split(/\s+/).slice(0,2).map(n=>n[0]).join('')}</Text></View><View style={{flex:1,minWidth:0,gap:5}}><Text numberOfLines={2} style={{ ...font.title,textAlign: RTL_LABEL_ALIGN}}>{isolateText(u.name)}</Text><Text style={{ ...font.small,textAlign: RTL_LABEL_ALIGN}}>{u.city || 'עיר לא תועדה'}</Text></View><View style={{gap:7,alignItems:'center',maxWidth:'34%'}}><Text style={{ ...font.small,textAlign: RTL_LABEL_ALIGN}}>{u.lastActiveAt?Date.now()-u.lastActiveAt<5*60000?'● פעיל עכשיו':`פעיל ${timeAgo(u.lastActiveAt)}`:'פעילות לא תועדה'}</Text>{u.isTest || u.deleted?<Text style={{...font.small,color:colors.textSoft}}>{u.deleted?'חשבון מחוק':'חשבון בדיקה'}</Text>:null}{u.qa?<Text style={{...font.small,color:colors.textSoft,borderWidth:1,borderColor:colors.border,borderRadius:8,paddingHorizontal:7}}>בודק</Text>:null}</View><Ionicons name="chevron-back" size={18} color={colors.textMuted}/></Pressable>}
   ListEmptyComponent={loading?<ActivityIndicator color={colors.primary}/>:!failed?<Text style={{ ...font.body,textAlign: RTL_LABEL_ALIGN,paddingVertical:20}}>אין משתמשים להצגה בעמוד הזה</Text>:null}
   ListFooterComponent={<View style={{gap:18,paddingVertical:20}}><View style={{flexDirection:'row',direction:'rtl',alignItems:'center',justifyContent:'space-between'}}><Pressable accessibilityRole="button" disabled={page===0 || loading} onPress={()=>setPage(p=>p-1)} style={{opacity:page===0?.35:1,padding:8}}><Text style={{...font.body,color:colors.primary}}>הקודם</Text></Pressable><Text style={font.small}>עמוד {page+1}</Text><Pressable accessibilityRole="button" disabled={!current?.next || loading} onPress={()=>pages[page+1]?setPage(p=>p+1):void load(current?.next,page+1)} style={{opacity:current?.next?1:.35,padding:8}}><Text style={{...font.body,color:colors.primary}}>הבא</Text></Pressable></View>{loading && current?<ActivityIndicator color={colors.primary}/>:null}<Pressable onPress={()=>setLegacy(v=>!v)}><Text style={{ ...font.small,color:colors.primary,textAlign: RTL_LABEL_ALIGN}}>{legacy?'חזרה למיון לפי פעילות':'עיון בכל החשבונות, כולל ללא פעילות מתועדת'}</Text></Pressable><Text style={{ ...font.small,fontSize:11,textAlign: RTL_LABEL_ALIGN}}>{legacy?'בעיון לפי מזהה נכללים גם חשבונות בדיקה ומחוקים.':'המיון לפי זמן הפעילות שנשמר באפליקציה. חשבונות בדיקה ומחוקים מוסתרים; ייתכנו פחות מ־20 שורות בעמוד.'}</Text></View>}/>
 </Screen>;
}
