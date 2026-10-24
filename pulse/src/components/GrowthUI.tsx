import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { RTL_LABEL_ALIGN, isolateText } from '../theme';
import { fetchGrowthData } from '../services/growthData';
import { type GrowthData, type GrowthSource } from '../services/growthInsights';
import { observeCaughtError } from '../services/errorObservation';

export const growthColors = {bg:'#0C2625',surface:'#183533',raised:'#254439',line:'#31504A',ink:'#F3F4E9',muted:'#B0C7BE',accent:'#C8EC91',onAccent:'#153126',warm:'#443F2C',amber:'#F2D69B'};
export const growthStyles = StyleSheet.create({
  safe:{flex:1,backgroundColor:growthColors.bg}, content:{paddingHorizontal:22,paddingBottom:30,gap:14},
  row:{flexDirection:'row',direction:'rtl',alignItems:'center',gap:12}, spread:{flexDirection:'row',direction:'rtl',alignItems:'center',justifyContent:'space-between',gap:10},
  brand:{paddingHorizontal:23,paddingTop:17,paddingBottom:13}, brandText:{color:growthColors.ink,fontSize:24,fontWeight:'800',textAlign:RTL_LABEL_ALIGN},
  title:{color:growthColors.ink,fontSize:34,lineHeight:42,fontWeight:'800',textAlign:RTL_LABEL_ALIGN}, accent:{color:growthColors.accent},
  heading:{color:growthColors.ink,fontSize:18,fontWeight:'700',textAlign:RTL_LABEL_ALIGN}, name:{color:growthColors.ink,fontSize:19,fontWeight:'700',textAlign:RTL_LABEL_ALIGN},
  body:{color:growthColors.muted,fontSize:14,lineHeight:24,textAlign:RTL_LABEL_ALIGN}, small:{color:growthColors.muted,fontSize:12,lineHeight:20,textAlign:RTL_LABEL_ALIGN},
  hero:{paddingTop:9,paddingBottom:8,gap:12},card:{padding:18,borderRadius:22,borderWidth:1,borderColor:growthColors.line,backgroundColor:growthColors.surface,gap:13},
  avatar:{width:48,height:48,borderRadius:16,alignItems:'center',justifyContent:'center',backgroundColor:'#D8BDA0'},avatarText:{color:'#493823',fontSize:17,fontWeight:'700'},
  badge:{alignSelf:'flex-start',paddingHorizontal:10,paddingVertical:5,borderRadius:8,backgroundColor:growthColors.raised},badgeText:{color:growthColors.accent,fontSize:12,fontWeight:'600',textAlign:RTL_LABEL_ALIGN},
  tabs:{flexDirection:'row',direction:'rtl',gap:8,flexWrap:'wrap'},tab:{paddingHorizontal:13,paddingVertical:10,borderRadius:12,borderWidth:1,borderColor:growthColors.line,minHeight:44,justifyContent:'center'},selected:{backgroundColor:growthColors.accent,borderColor:growthColors.accent},
  button:{paddingVertical:12,paddingHorizontal:16,borderRadius:13,backgroundColor:growthColors.accent,alignItems:'center',justifyContent:'center',minHeight:46},buttonText:{color:growthColors.onAccent,fontSize:14,fontWeight:'700',textAlign:RTL_LABEL_ALIGN},
  note:{padding:17,borderRadius:18,backgroundColor:growthColors.raised,gap:7},link:{color:growthColors.accent,fontSize:13,fontWeight:'600',textAlign:RTL_LABEL_ALIGN},
  rule:{borderTopWidth:1,borderTopColor:growthColors.line,paddingTop:13,gap:9},fact:{flexDirection:'row',direction:'rtl',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'},
  metric:{fontSize:28,color:growthColors.ink,fontWeight:'800',textAlign:RTL_LABEL_ALIGN},error:{color:growthColors.amber,fontSize:13,lineHeight:23,textAlign:RTL_LABEL_ALIGN},
});
export function useGrowthData() {
  const [data,setData]=useState<GrowthData|null>(null); const [loading,setLoading]=useState(true); const [failed,setFailed]=useState(false); const generation=useRef(0);
  const load=useCallback(async(force=false)=>{
    const request=++generation.current;setLoading(true);setFailed(false);
    try {const next=await fetchGrowthData(force);if(request===generation.current)setData(next);}
    catch(error){observeCaughtError(error,{source:'pulse/src/components/GrowthUI.tsx',handler:'load',site:'GrowthUI:load'});if(request===generation.current)setFailed(true);}
    finally{if(request===generation.current)setLoading(false);}
  },[]);
  useFocusEffect(useCallback(()=>{void load();return()=>{generation.current++};},[load]));
  return {data,loading,failed,reload:()=>load(true)};
}
export function GrowthShell({children,loading=false,onRefresh,onBack,label='מעקב אישי'}:{children:React.ReactNode;loading?:boolean;onRefresh?:()=>void;onBack?:()=>void;label?:string}) {
  const s=growthStyles;
  return <SafeAreaView style={s.safe} edges={['top']}>
    <View style={[s.spread,s.brand]}><View style={s.row}>{onBack?<Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="חזרה" style={{padding:8,minHeight:44}}><Ionicons name="chevron-forward" size={24} color={growthColors.ink}/></Pressable>:null}<Text style={s.brandText}>פולס <Text style={s.accent}>●</Text></Text></View><Text style={s.small}>{label}</Text></View>
    <ScrollView contentContainerStyle={s.content} refreshControl={onRefresh?<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={growthColors.accent}/>:undefined} keyboardShouldPersistTaps="handled">
      {loading?<ActivityIndicator color={growthColors.accent} accessibilityLabel="טוען מידע"/>:null}{children}
    </ScrollView>
  </SafeAreaView>;
}
export function GrowthBadge({children,warm=false}:{children:React.ReactNode;warm?:boolean}){const s=growthStyles;return <View style={[s.badge,warm&&{backgroundColor:growthColors.warm}]}><Text style={[s.badgeText,warm&&{color:growthColors.amber}]}>{children}</Text></View>}
export function GrowthAvatar({name,index=0}:{name:string;index?:number}){return <View style={[growthStyles.avatar,{backgroundColor:['#D8BDA0','#AEB8D5','#B4CDB2'][index%3]}]}><Text style={growthStyles.avatarText}>{name.trim().split(/\s+/).slice(0,2).map(v=>v[0]).join('') || '•'}</Text></View>}
export function GrowthAction({label,onPress}:{label:string;onPress:()=>void}){return <Pressable accessibilityRole="button" onPress={onPress} style={growthStyles.button}><Text style={growthStyles.buttonText}>{label}</Text></Pressable>}
export function GrowthFact({label,value}:{label:string;value:string|number}){return <View style={growthStyles.fact}><Text style={growthStyles.small}>{label}</Text><Text style={[growthStyles.body,{color:growthColors.ink,flexShrink:1}]}>{isolateText(String(value))}</Text></View>}
export function GrowthStatus({data,failed,retry}:{data:GrowthData|null;failed?:boolean;retry:()=>void}){
 const names={users:'אנשים',groups:'מועדונים',games:'מחזורים'};
 const limited=data?(['users','groups','games'] as const).filter(name=>data[name]?.limited):[];
 return <>{failed||data?.failed.length?<Pressable accessibilityRole="button" onPress={retry} style={growthStyles.note}><Text style={growthStyles.error}>מידע חלקי — {data?.failed.map(k=>names[k]).join(' · ') || 'הטעינה נכשלה'}. לחצו לניסיון חוזר. אין להסיק שהמידע החסר הוא אפס.</Text></Pressable>:null}
 {limited.length?<Text style={growthStyles.error}>חלון קריאה מוגבל: {limited.map(k=>names[k]).join(' · ')}. הספירות והתובנות מתייחסות רק לרשומות שנטענו.</Text>:null}
 {data?<Text style={growthStyles.small}>{(['users','groups','games'] as const).map(key=>`${names[key]}: ${sourceAge(data[key])}`).join(' · ')}{ '\n' }טעינות חוזרות משותפות לשלוש דקות</Text>:null}</>;
}
export function sourceAge(source:GrowthSource|null){return source?new Date(source.at).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'}):'לא נטען'}
