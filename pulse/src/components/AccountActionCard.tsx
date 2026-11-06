import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './ui';
import { colors, font } from '../theme';
import { fetchAccountActions, type AccountActionReport } from '../services/accountActionReport';
import { sortedActions } from '../services/actionReports';
import type { RangeKey } from '../services/analyticsFull';
import { observeCaughtError } from '../services/errorObservation';

const nf=new Intl.NumberFormat('he-IL');
export function AccountActionCard({range}: {range:RangeKey}){
  const [state,setState]=useState<'idle'|'loading'|'error'|'ready'>('idle');
  const [report,setReport]=useState<AccountActionReport|null>(null);
  const [expanded,setExpanded]=useState(8);
  const [sort,setSort]=useState<'users'|'events'>('users');
  const request=useRef(0);
  useEffect(()=>()=>{request.current++;},[]);
  async function read(){
    if(state==='loading')return;
    const current=++request.current;
    setState('loading');setReport(null);setExpanded(8);
    try{
      const next=await fetchAccountActions(range,()=>request.current===current);
      if(current===request.current){setReport(next);setState('ready');}
    }catch(error){
      if(current===request.current){
        observeCaughtError(error,{source:'pulse/src/components/AccountActionCard.tsx',handler:'read',site:'accountActionReportLoad'});
        setState('error');
      }
    }
  }
  const rows=useMemo(()=>sortedActions(report?.rows??[],sort),[report,sort]);
  const timing=report?.timeQuality??{device:0,received:0,unknown:report?.accepted??0};
  return <Card style={styles.card}>
    <Text style={font.h2}>חשבונות טימדר</Text>
    <Text style={font.small}>חשבון מחובר נספר פעם אחת לכל פעולה, גם אם השתמש בשני מכשירים. הדוח זמין רק עבור פעילות שנקלטה בגרסאות שבהן המדידה הופעלה.</Text>
    {range==='all'&&<Text style={font.small}>כאן ניתן לבדוק עד 30 ימים אחרונים.</Text>}
    {state==='loading'?<Text style={font.body}>קורא נתוני חשבונות לתקופה...</Text>:
      <Pressable style={styles.button} accessibilityRole="button" onPress={()=>void read()}><Text style={styles.link}>{state==='idle'?'טעינת דוח חשבונות':state==='error'?'ניסיון חוזר':'רענון דוח החשבונות'}</Text></Pressable>}
    {state==='error'&&<Text style={font.body}>קריאת הדוח נכשלה. אין תוצאה מאומתת לתקופה הזאת.</Text>}
    {report&&<>
      {report.partial&&<Text style={font.body}>הדוח חלקי. המספרים מתייחסים רק לרשומות שנקראו וזוהו.</Text>}
      {!report.accepted?<Text style={font.body}>אין כיסוי מדוד של פעולות חשבון בתקופה הזאת.</Text>:<>
        <Text style={font.body}>{'חשבונות שונים: '+nf.format(report.accounts)+'. ביצועים שנקלטו: '+nf.format(report.accepted)+'.'}</Text>
        {timing.received>0&&<Text style={font.small}>{'מספר הביצועים ששויכו לפי זמן הקליטה בשל זמן מכשיר לא אמין הוא '+nf.format(timing.received)+'.'}</Text>}
        {timing.unknown>0&&<Text style={font.small}>{'לא נשמרה איכות זמן עבור '+nf.format(timing.unknown)+' ביצועים. שיוכם לתקופה מבוסס על הזמן שנשמר ברשומה.'}</Text>}
        <View style={styles.metrics}>{(['users','events'] as const).map(key=>
          <Pressable key={key} accessibilityRole="button" accessibilityState={{selected:sort===key}} style={[styles.button,sort===key&&styles.selected]} onPress={()=>{setSort(key);setExpanded(8);}}>
            <Text style={styles.link}>{key==='users'?'לפי חשבונות':'לפי ביצועים'}</Text>
          </Pressable>)}</View>
        {rows.slice(0,expanded).map(row=><View key={row.id} style={styles.item}>
          <Text style={font.title}>{(row.id.startsWith('ui_')?'פקד: ':'פעולה: ')+row.label}</Text>
          <View style={styles.metrics}><Text style={font.small}>{'חשבונות: '+nf.format(row.users)}</Text>
            <Text style={font.small}>{'ביצועים: '+nf.format(row.events)}</Text></View>
        </View>)}
        {rows.length>expanded&&<Pressable accessibilityRole="button" style={styles.button} onPress={()=>setExpanded(n=>n+8)}><Text style={styles.link}>הצגת פעולות נוספות</Text></Pressable>}
      </>}
    </>}
  </Card>;
}
const styles=StyleSheet.create({card:{gap:9},button:{alignSelf:'flex-start',minHeight:44,justifyContent:'center',paddingHorizontal:10,borderRadius:8},
  link:{...font.small,color:colors.primary,fontWeight:'700'},selected:{backgroundColor:colors.primarySoft},
  metrics:{flexDirection:'row',flexWrap:'wrap',columnGap:18,rowGap:4},item:{gap:4,paddingVertical:8,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.border}});
