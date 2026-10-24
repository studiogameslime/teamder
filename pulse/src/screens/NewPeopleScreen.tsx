import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { GrowthAvatar, GrowthBadge, GrowthShell, GrowthStatus, growthColors as c, growthStyles as s, useGrowthData } from '../components/GrowthUI';
import { GROWTH_DAY, millis, personInsight, text } from '../services/growthInsights';
import { isTestAccount } from '../services/firebase';
import { isolateText } from '../theme';
import { timeAgo } from '../format';

export function NewPeopleScreen(){
 const nav=useNavigation<any>();const {data,loading,failed,reload}=useGrowthData();const [period,setPeriod]=useState(30);const [follow,setFollow]=useState(false);
 const rows=useMemo(()=>{if(!data)return [];const now=data.at;return (data.users?.rows??[]).filter(u=>!isTestAccount(u.email,u.name)&&u.name!=='משתמש שהוסר'&&millis(u.createdAt)>0&&millis(u.createdAt)<=now&&now-millis(u.createdAt)<=period*GROWTH_DAY).map(u=>personInsight(u,data,now));},[data,period]);
 const visible=rows.filter(p=>!follow||p.follow);
 return <GrowthShell loading={loading} onRefresh={reload} label="האנשים שמתחילים איתנו">
  <View style={s.hero}><Text style={s.small}>● {period} הימים האחרונים</Text><Text style={s.title}>אנשים חדשים.{ '\n' }<Text style={s.accent}>סיפורים שמתחילים.</Text></Text><Text style={s.body}>{rows.length} אנשים חדשים במידע שנטען · {rows.filter(p=>p.follow).length} עם כיוון למעקב אישי</Text></View>
  <View style={s.spread}><View style={s.tabs}>{[7,30].map(days=><Pressable key={days} accessibilityRole="button" accessibilityState={{selected:period===days}} onPress={()=>setPeriod(days)} style={[s.tab,period===days&&s.selected]}><Text style={[s.small,period===days&&{color:c.onAccent}]}>{days} ימים</Text></Pressable>)}</View><Pressable onPress={()=>nav.navigate('UsersList')} accessibilityRole="button" style={{padding:9,minHeight:44}}><Text style={s.link}>כל המשתמשים ←</Text></Pressable></View>
  <View style={s.tabs}>{[{label:'כל האנשים',value:false},{label:'למעקב אישי',value:true}].map(tab=><Pressable key={tab.label} onPress={()=>setFollow(tab.value)} accessibilityRole="button" accessibilityState={{selected:follow===tab.value}} style={[s.tab,follow===tab.value&&s.selected]}><Text style={[s.small,follow===tab.value&&{color:c.onAccent}]}>{tab.label}</Text></Pressable>)}</View>
  <GrowthStatus data={data} failed={failed} retry={reload}/>
  {visible.map((p,index)=><Pressable key={p.user.id} accessibilityRole="button" accessibilityLabel={`הסיפור של ${text(p.user.name,'משתמש')}`} onPress={()=>nav.navigate('PersonJourney',{userId:p.user.id})} style={s.card}>
    <View style={s.row}><GrowthAvatar name={text(p.user.name,'משתמש')} index={index}/><View style={{flex:1,gap:3}}><Text style={s.name}>{isolateText(text(p.user.name,'משתמש ללא שם'))}</Text><Text style={s.small}>הצטרף {timeAgo(millis(p.user.createdAt))} · {isolateText(p.source)}</Text></View><Ionicons name="arrow-undo-outline" size={20} color={c.muted}/></View>
    <Text style={s.body}>{p.summary}</Text><View style={s.spread}><GrowthBadge warm={p.pending.length>0}>{p.stage}</GrowthBadge><Text style={s.link}>לסיפור המלא ←</Text></View>
  </Pressable>)}
  {!loading&&data?.users&&!visible.length?<View style={s.note}><Text style={s.body}>{follow?'אין אנשים עם כיוון למעקב בחלון הנבחר.':'לא נמצאו חשבונות חדשים בתקופה ובחלון שנבחרו.'}</Text></View>:null}
  <Text style={s.small}>הצעה למעקב אינה אבחון של קושי. פעולות ומקור הגעה מוצגים רק כשנשמרה להם ראיה. חשבונות בדיקה ומחוקים מוסתרים.</Text>
 </GrowthShell>;
}
