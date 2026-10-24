import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { GrowthBadge, GrowthShell, GrowthStatus, growthColors as c, growthStyles as s, useGrowthData } from '../components/GrowthUI';
import { clubInsight, isClubGroup, text } from '../services/growthInsights';
import { isolateText } from '../theme';
import { RtlTextInput } from '../components/RtlTextInput';

export function ClubsScreen(){
 const nav=useNavigation<any>();const {data,loading,failed,reload}=useGrowthData();const [query,setQuery]=useState('');const [filter,setFilter]=useState('all');
 const clubs=useMemo(()=>data?(data.groups?.rows??[]).filter(isClubGroup).map(g=>clubInsight(g,data,data.at)).sort((a,b)=>b.played.length-a.played.length||b.upcoming.length-a.upcoming.length||text(a.group.name).localeCompare(text(b.group.name),'he')):[],[data]);
 const visible=clubs.filter(p=>(!query.trim()||`${p.group.name} ${p.group.city}`.includes(query.trim()))&&(filter==='all'||filter==='played'&&p.played.length>0||filter==='starting'&&p.stage==='מתארגנים להתחלה'));
 return <GrowthShell loading={loading} onRefresh={reload} label="המועדונים שלנו">
  <View style={s.hero}><Text style={s.small}>● פעילות לפי מחזורים שנשמרו</Text><Text style={s.title}>מי כבר משחק.{ '\n' }<Text style={s.accent}>מי בדרך למגרש.</Text></Text><Text style={s.body}>{clubs.length} מועדונים נטענו · {clubs.filter(p=>p.played.length>0).length} שיחקו ב־30 הימים האחרונים</Text></View>
  <RtlTextInput accessibilityLabel="חיפוש מועדונים" placeholder="חיפוש מועדון או עיר" placeholderTextColor={c.muted} value={query} onChangeText={setQuery} style={{color:c.ink,backgroundColor:c.surface,padding:14,borderRadius:14,minHeight:48}}/>
  <View style={s.tabs}>{[{key:'all',label:'כל המועדונים'},{key:'played',label:'משחקים בפועל'},{key:'starting',label:'בתחילת הדרך'}].map(tab=><Pressable key={tab.key} accessibilityRole="button" accessibilityState={{selected:filter===tab.key}} onPress={()=>setFilter(tab.key)} style={[s.tab,filter===tab.key&&s.selected]}><Text style={[s.small,filter===tab.key&&{color:c.onAccent}]}>{tab.label}</Text></Pressable>)}</View>
  <GrowthStatus data={data} failed={failed} retry={reload}/>
  {visible.map(p=><Pressable key={p.group.id} onPress={()=>nav.navigate('ClubDetail',{groupId:p.group.id})} accessibilityRole="button" accessibilityLabel={`פרטי המועדון ${text(p.group.name,'ללא שם')}`} style={s.card}>
   <View style={s.row}><View style={[s.avatar,{backgroundColor:c.accent,borderBottomLeftRadius:22,borderBottomRightRadius:22}]}><Text style={[s.avatarText,{color:c.onAccent}]}>{text(p.group.name,'מ').slice(0,2)}</Text></View><View style={{flex:1,gap:4}}><Text style={s.name}>{isolateText(text(p.group.name,'מועדון ללא שם'))}</Text><Text style={s.small}>{text(p.group.city,'עיר לא תועדה')} · {p.managers.length} מנהלים</Text></View></View>
   <View style={s.tabs}><GrowthBadge warm={!p.played.length}>{p.stage}</GrowthBadge>{p.group.hidden===true?<GrowthBadge warm>מוסתר באפליקציה</GrowthBadge>:null}</View>
   <View style={[s.row,s.rule,{gap:22,flexWrap:'wrap'}]}>{[{value:p.members.length,label:'חברים ומנהלים'},{value:data?.games?p.played.length:'—',label:'מחזורים ב־30 יום'},{value:data?.games?p.upcoming.length:'—',label:'מחזורים קרובים'}].map(m=><View key={m.label} style={{gap:3}}><Text style={s.metric}>{m.value}</Text><Text style={s.small}>{m.label}</Text></View>)}</View>
   <Text style={s.link}>מי מגייס, מה הוגדר ומה הצעד הבא ←</Text>
  </Pressable>)}
  {!loading&&data?.groups&&!visible.length?<Text style={s.body}>אין מועדונים התואמים לחיפוש ולמסנן במידע שנטען.</Text>:null}
  <Text style={s.small}>״משחקים בפועל״ נקבע לפי המקור המשותף של טימדר למחזור שהתקיים. מועדון חדש אינו מסומן ככישלון בגלל שעדיין לא שיחק.</Text>
 </GrowthShell>;
}
